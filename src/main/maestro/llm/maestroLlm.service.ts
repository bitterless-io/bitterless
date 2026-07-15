import { shell } from 'electron'
import { dirname } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'node:http'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { CoachSettings } from '@maestro-shared/coach.api'
import type { AuthSession, SessionApi } from '@maestro-shared/session.api'
import { AUTH_BROADCAST } from '@maestro-shared/session.api'
import { writeMicromeetCliCredential } from '@maestro-main/cli/micromeetCli.service'
import type { ConfigApi } from '@maestro-shared/config.api'
import { LLM_COMPRESSION_REMAINING_KEY, LLM_CONFIG_DOMAIN, LLM_TARGET_KEY } from '@maestro-shared/config.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import type { LlmConfig, LlmEffort, LlmProviderState } from '@maestro-shared/coach.api'
import {
  DEFAULT_COMPRESSION_REMAINING_PERCENT,
  DEFAULT_PRESET_MODEL,
  LLM_PRESETS,
  LLM_PROVIDERS,
  applyCompressionPrefs,
  firstPresetForProvider,
  modelPresetKey,
  normalizeCompressionRemainingPercent,
  normalizeLlmProvider,
  normalizeLlmTarget,
  normalizeSelectableLlmTarget,
  parseStoredLlmCompressionPrefs,
  parseStoredLlmTarget,
  providerLabel,
  resolveLoginMethod,
  selectableLlmLoginProviders,
  selectableLlmPresets,
  type LlmCompressionPrefs,
  type LlmStoredTarget
} from './llmModels'
import { maestroAuthPath, maestroModelsPath } from './llmPaths'
import { buildAiCrmsPiProviderConfig } from '@maestro-main/networking/api/aiCrmsRelay.api'
import { codexCredentialService } from '../../codex/codexCredential.runtime'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')
const aiCrmsSession = createXpcMainEmitter<SessionApi>('MaestroSessionDao')

interface PiAuthStorage {
  login: (
    provider: string,
    callbacks: {
      onSelect: () => Promise<string>
      onAuth: (params: { url: string }) => void
      onManualCodeInput: () => Promise<string>
      onDeviceCode: (params: { userCode: string; verificationUri: string }) => void
      onPrompt: () => Promise<string>
      onProgress: (message: string) => void
    }
  ) => Promise<unknown>
  logout: (provider: string) => void
}

interface PiAuthModule {
  AuthStorage: { create: (path: string) => PiAuthStorage }
  ModelRegistry: {
    create: (
      authStorage: PiAuthStorage,
      modelsPath?: string
    ) => { find: (provider: string, model: string) => unknown; hasConfiguredAuth: (model: unknown) => boolean }
  }
}

const loadPiAuthModule = async (): Promise<PiAuthModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule

export interface MaestroLlmServiceState {
  applyLlmTarget(provider: string, model: string, effort: LlmEffort): void
  getLlmRuntimeTarget(): LlmStoredTarget
  resetLlmTurnState(): void
  resetLlmAgentSessions(): void
  readMaestroSettings(): CoachSettings
  saveMaestroSettings(patch: Partial<CoachSettings>): CoachSettings
  openAiCrmsLoginTab(): Promise<void>
  emitTrace(e: TraceEvent): void
}

@injectable()
export class MaestroLlmService extends CommonService<MaestroLlmServiceState> {
  private activeLlmLoginProvider = ''
  private anthropicIpv6Server: ReturnType<typeof createServer> | null = null
  private anthropicCaptureResolve: ((url: string) => void) | null = null

  private readPiModelsJson(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(readFileSync(maestroModelsPath(), 'utf8')) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  private async syncAiCrmsProviderModels(session?: AuthSession | null): Promise<boolean> {
    const activeSession = session ?? (await aiCrmsSession.getSession().catch(() => null))
    if (!activeSession?.jwt_token) {
      console.log('[coach llm] AI-CRMS provider not ready: no shared session')
      return false
    }
    try {
      const compressionPrefs = await this.readStoredLlmCompressionPrefs()
      const compressionRemainingPercent =
        compressionPrefs[modelPresetKey('ai-crms', 'qwen3.7-plus')] ?? DEFAULT_COMPRESSION_REMAINING_PERCENT
      const doc = this.readPiModelsJson()
      const providers = doc.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers) ? (doc.providers as Record<string, unknown>) : {}
      const providerConfig = buildAiCrmsPiProviderConfig({ session: activeSession, compressionRemainingPercent })
      providers['ai-crms'] = providerConfig
      doc.providers = providers
      mkdirSync(dirname(maestroModelsPath()), { recursive: true })
      writeFileSync(maestroModelsPath(), JSON.stringify(doc, null, 2), 'utf8')
      console.log('[coach llm] AI-CRMS provider synced', {
        baseUrl: providerConfig.baseUrl,
        region: providerConfig.headers['x-region'] || '',
        compressionRemainingPercent
      })
      return true
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'sync AI-CRMS provider: ' + (err as Error).message, ts: Date.now() })
      console.error('[coach llm] AI-CRMS provider sync failed:', err)
      return false
    }
  }

  private async readStoredLlmTarget(): Promise<LlmStoredTarget> {
    const fallback = this._state.readMaestroSettings()
    const fromDb = await configStore.get({ domain: LLM_CONFIG_DOMAIN, key: LLM_TARGET_KEY }).catch(() => null)
    const parsed = parseStoredLlmTarget(fromDb?.options)
    return normalizeSelectableLlmTarget(parsed || { provider: fallback.llmProvider, model: fallback.llmModel, effort: fallback.llmEffort })
  }

  private async writeStoredLlmTarget(target: LlmStoredTarget): Promise<void> {
    await configStore.upsert({ domain: LLM_CONFIG_DOMAIN, key: LLM_TARGET_KEY, options: target }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'save LLM config: ' + (err as Error).message, ts: Date.now() })
    })
    this._state.saveMaestroSettings({ llmProvider: target.provider, llmModel: target.model, llmEffort: target.effort })
  }

  private async readStoredLlmCompressionPrefs(): Promise<LlmCompressionPrefs> {
    const fromDb = await configStore.get({ domain: LLM_CONFIG_DOMAIN, key: LLM_COMPRESSION_REMAINING_KEY }).catch(() => null)
    return parseStoredLlmCompressionPrefs(fromDb?.options)
  }

  private async writeStoredLlmCompressionPrefs(prefs: LlmCompressionPrefs): Promise<void> {
    await configStore.upsert({ domain: LLM_CONFIG_DOMAIN, key: LLM_COMPRESSION_REMAINING_KEY, options: prefs }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'save LLM compression config: ' + (err as Error).message, ts: Date.now() })
    })
  }

  private async checkLlmProviderReady(provider: string, model: string): Promise<boolean> {
    if (provider === 'ai-crms') {
      const session = await aiCrmsSession.getSession().catch(() => null)
      return Boolean(session?.jwt_token) && (await this.syncAiCrmsProviderModels(session))
    }
    if (provider === 'openai-codex') {
      return (await codexCredentialService.getStatus()).connected
    }
    try {
      const pi = await loadPiAuthModule()
      const modelRegistry = pi.ModelRegistry.create(pi.AuthStorage.create(maestroAuthPath()), maestroModelsPath())
      const found = modelRegistry.find(provider, model)
      return Boolean(found && modelRegistry.hasConfiguredAuth(found))
    } catch {
      return false
    }
  }

  private async buildLlmProviderStates(activeProvider: string): Promise<LlmProviderState[]> {
    const out: LlmProviderState[] = []
    for (const provider of LLM_PROVIDERS) {
      const preset = firstPresetForProvider(provider.provider)
      const ready = await this.checkLlmProviderReady(provider.provider, preset?.model || '')
      out.push({
        provider: provider.provider,
        label: provider.label,
        authLabel: provider.authLabel,
        ready,
        active: provider.provider === activeProvider,
        hint: ready ? undefined : provider.hint
      })
    }
    return out
  }

  private async getAndBroadcastLlmConfig(): Promise<LlmConfig> {
    const cfg = await this.getLlmConfig()
    xpcMain.broadcast('coach/llm-config', cfg)
    return cfg
  }

  private broadcastLlmLoginState(provider: string, loading: boolean): void {
    this.activeLlmLoginProvider = loading ? provider : ''
    xpcMain.broadcast('coach/llm-login-state', { provider, loading, ts: Date.now() })
  }

  async getLlmConfig(): Promise<LlmConfig> {
    const target = await this.readStoredLlmTarget()
    if (target.provider === 'ai-crms') await this.syncAiCrmsProviderModels()
    const active = this._state.getLlmRuntimeTarget()
    if (active.provider !== target.provider || active.model !== target.model || active.effort !== target.effort) {
      this._state.applyLlmTarget(target.provider, target.model, target.effort)
    }
    const providers = await this.buildLlmProviderStates(target.provider)
    const selectedProvider = providers.find((item) => item.provider === target.provider)
    const ready = Boolean(selectedProvider?.ready)
    const presets = applyCompressionPrefs(selectableLlmPresets(), await this.readStoredLlmCompressionPrefs())
    return {
      provider: target.provider,
      model: target.model,
      effort: target.effort,
      ready,
      hint: ready ? undefined : selectedProvider?.hint,
      providers,
      presets,
      loginProviders: selectableLlmLoginProviders()
    }
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    const target = normalizeSelectableLlmTarget(params)
    if (target.provider === 'ai-crms') await this.syncAiCrmsProviderModels()
    await this.writeStoredLlmTarget(target)
    this._state.applyLlmTarget(target.provider, target.model, target.effort)
    this._state.resetLlmTurnState()
    this._state.emitTrace({ kind: 'info', msg: `LLM backend -> ${target.provider}/${target.model}/${target.effort} (conversations reset)`, ts: Date.now() })
    return await this.getAndBroadcastLlmConfig()
  }

  async setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig> {
    const provider = normalizeLlmProvider(params.provider || '')
    const model = String(params.model || '').trim()
    const preset = LLM_PRESETS.find((item) => item.provider === provider && item.model === model)
    if (!preset) return await this.getAndBroadcastLlmConfig()

    const prefs = await this.readStoredLlmCompressionPrefs()
    prefs[modelPresetKey(preset.provider, preset.model)] = normalizeCompressionRemainingPercent(params.compressionRemainingPercent)
    await this.writeStoredLlmCompressionPrefs(prefs)
    if (preset.provider === 'ai-crms') await this.syncAiCrmsProviderModels()
    return await this.getAndBroadcastLlmConfig()
  }

  private ensureAnthropicIpv6Server(): void {
    if (this.anthropicIpv6Server) return
    const server = createServer((req, res) => {
      if ((req.url || '').startsWith('/callback')) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end('<html><body>Claude sign-in complete - you can close this tab.</body></html>')
        this.anthropicCaptureResolve?.('http://localhost:53692' + (req.url || ''))
      } else {
        res.statusCode = 404
        res.end()
      }
    })
    server.on('error', (err) => {
      this._state.emitTrace({ kind: 'info', msg: 'claude login (ipv6 callback unavailable): ' + err.message, ts: Date.now() })
      this.anthropicIpv6Server = null
    })
    server.listen(53692, '::1')
    this.anthropicIpv6Server = server
  }

  async loginLlm(params: { provider?: string; method?: string }): Promise<LlmConfig> {
    const active = this._state.getLlmRuntimeTarget()
    const provider = normalizeLlmProvider(params?.provider || active.provider || 'openai-codex')
    if (this.activeLlmLoginProvider) return await this.getLlmConfig()
    this.broadcastLlmLoginState(provider, true)
    try {
      return await this.performLlmLogin(provider, params?.method)
    } finally {
      this.broadcastLlmLoginState(provider, false)
    }
  }

  private async performLlmLogin(provider: string, requestedMethod?: string): Promise<LlmConfig> {
    const method = resolveLoginMethod(provider, requestedMethod)
    const active = this._state.getLlmRuntimeTarget()
    const target = normalizeLlmTarget({
      provider,
      model: active.provider === provider ? active.model : DEFAULT_PRESET_MODEL[provider],
      effort: active.provider === provider ? active.effort : undefined
    })
    await this.writeStoredLlmTarget(target)
    this._state.applyLlmTarget(target.provider, target.model, target.effort)
    if (provider === 'ai-crms') {
      await this._state.openAiCrmsLoginTab()
      return await this.getAndBroadcastLlmConfig()
    }
    try {
      if (provider === 'openai-codex') {
        await codexCredentialService.connect({
          method,
          onDeviceCode: (info) => {
            this._state.emitTrace({ kind: 'info', msg: `codex device login: enter code ${info.userCode} at ${info.verificationHost}`, ts: Date.now() })
            xpcMain.broadcast('coach/codex-device', {
              userCode: info.userCode,
              verificationUri: `https://${info.verificationHost}/codex/device`
            })
          },
          onProgress: (message) => this._state.emitTrace({ kind: 'info', msg: `OpenAI Codex (ChatGPT) login: ${message}`, ts: Date.now() })
        })
        xpcMain.broadcast('coach/codex-device', null)
        return await this.getAndBroadcastLlmConfig()
      }
      const pi = await loadPiAuthModule()
      mkdirSync(dirname(maestroAuthPath()), { recursive: true })
      const auth = pi.AuthStorage.create(maestroAuthPath())
      let captureResolve: ((url: string) => void) | undefined
      const captured = new Promise<string>((resolve) => {
        captureResolve = resolve
      })
      if (method === 'browser') {
        this.ensureAnthropicIpv6Server()
        this.anthropicCaptureResolve = captureResolve ?? null
      }
      const timeoutMs = method === 'device_code' ? 16 * 60_000 : 180_000
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('sign-in timed out — authorization did not complete')), timeoutMs)
      })
      try {
        await Promise.race([
          auth.login(provider, {
            onSelect: async () => method,
            onAuth: ({ url }: { url: string }) => {
              void shell.openExternal(url)
            },
            onManualCodeInput: () => captured,
            onDeviceCode: (info: { userCode: string; verificationUri: string }) => {
              void shell.openExternal(info.verificationUri)
              this._state.emitTrace({ kind: 'info', msg: `codex device login: enter code ${info.userCode} at ${info.verificationUri}`, ts: Date.now() })
              xpcMain.broadcast('coach/codex-device', { userCode: info.userCode, verificationUri: info.verificationUri })
            },
            onPrompt: () => new Promise<string>(() => {}),
            onProgress: (m: string) => this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} login: ${m}`, ts: Date.now() })
          }),
          timeout
        ])
      } finally {
        if (timer) clearTimeout(timer)
        this.anthropicCaptureResolve = null
      }
    } catch (err) {
      const e = err as Error
      const msg = e?.message || String(err)
      this._state.emitTrace({ kind: 'error', msg: providerLabel(provider) + ' login failed: ' + msg + (e?.stack ? '\n' + e.stack : ''), ts: Date.now() })
      const cfg = await this.getLlmConfig()
      xpcMain.broadcast('coach/codex-device', null)
      const next = { ...cfg, ready: false, hint: 'Sign-in failed: ' + msg }
      xpcMain.broadcast('coach/llm-config', next)
      return next
    }
    xpcMain.broadcast('coach/codex-device', null)
    return await this.getAndBroadcastLlmConfig()
  }

  async loginCodex(params: { method?: string }): Promise<LlmConfig> {
    return await this.loginLlm({ provider: 'openai-codex', method: params?.method })
  }

  async logoutLlm(params?: { provider?: string }): Promise<LlmConfig> {
    const active = this._state.getLlmRuntimeTarget()
    const provider = normalizeLlmProvider(params?.provider || active.provider || 'openai-codex')
    if (provider === 'ai-crms') {
      await aiCrmsSession.clearSession().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'AI-CRMS logout failed: ' + (err as Error).message, ts: Date.now() })
      })
      writeMicromeetCliCredential(null)
      xpcMain.broadcast(AUTH_BROADCAST, { loggedIn: false, session: null })
      await this._state.openAiCrmsLoginTab()
      const cfg = await this.getLlmConfig()
      const next = { ...cfg, ready: false, hint: undefined }
      xpcMain.broadcast('coach/llm-config', next)
      return next
    }
    try {
      if (provider === 'openai-codex') {
        await codexCredentialService.disconnect()
      } else {
        const pi = await loadPiAuthModule()
        pi.AuthStorage.create(maestroAuthPath()).logout(provider)
      }
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: providerLabel(provider) + ' logout failed: ' + (err as Error).message, ts: Date.now() })
    }
    this._state.resetLlmAgentSessions()
    const cfg = await this.getLlmConfig()
    const next = { ...cfg, ready: false, hint: undefined }
    xpcMain.broadcast('coach/llm-config', next)
    return next
  }

  async logoutCodex(): Promise<LlmConfig> {
    return await this.logoutLlm({ provider: 'openai-codex' })
  }
}
