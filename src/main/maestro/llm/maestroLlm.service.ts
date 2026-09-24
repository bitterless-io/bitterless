import { DEFAULT_COMPACT_PROMPT } from '@main/agent/runtime/piNativeCompaction'
import { shell } from 'electron'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import { createServer } from 'node:http'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { CoachSettings } from '@maestro-shared/coach.api'
import type { ConfigApi } from '@maestro-shared/config.api'
import { LLM_COMPRESSION_REMAINING_KEY, LLM_CONFIG_DOMAIN, LLM_TARGET_KEY } from '@maestro-shared/config.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import type { LlmConfig, LlmEffort, LlmProviderState, LlmTarget } from '@maestro-shared/coach.api'
import {
  DEFAULT_COMPRESSION_REMAINING_PERCENT,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_PRESET_MODEL,
  LLM_PRESETS,
  LLM_PROVIDERS,
  applyCompressionPrefs,
  applyResolvedContextWindows,
  firstPresetForProvider,
  modelPresetKey,
  normalizeCompressionRemainingPercent,
  normalizeLlmProvider,
  normalizeLlmTarget,
  normalizeSelectableLlmTarget,
  parseStoredLlmCompressionPrefs,
  parseStoredLlmTarget,
  providerLabel,
  requireSelectableLlmProvider,
  requireSelectableLlmTarget,
  resolveLoginMethod,
  selectableLlmLoginProviders,
  selectableLlmPresets,
  type LlmCompressionPrefs,
  type LlmStoredTarget
} from './llmModels'
import { PiRuntimeAdapter } from '@main/agent/runtime/piRuntimeAdapter'
import {
  BITTERLESS_PROVIDER_ID,
  isBitterlessProvider
} from '@main/agent/runtime/bitterlessProvider'
import { customerSessionService } from '@main/auth/customerSession.service'
import { maestroAgentDir, maestroAuthPath, maestroModelsPath } from './llmPaths'
import { codexCredentialService } from '../../codex/codexCredential.runtime'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

/**
 * 上下文窗口解析的封顶。查的是 pi 目录里的静态模型表,正常是毫秒级;
 * 留 3s 是给冷启动那次 `import('@earendil-works/pi-coding-agent')` 的。
 * 与 cowork 同一数值(coworkLlm.service.ts),两边保持一致。
 */
const CONTEXT_WINDOW_TIMEOUT_MS = 3000

/** 单个 provider 就绪探测的封顶,与 cowork `PROVIDER_READY_TIMEOUT_MS` 同值。 */
const PROVIDER_READY_TIMEOUT_MS = 8000

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

interface PiModelRuntime {
  getModel: (provider: string, model: string) => unknown | undefined
  hasConfiguredAuth: (provider: string) => boolean
  login: (
    provider: string,
    type: 'oauth',
    interaction: {
      signal?: AbortSignal
      prompt: (prompt: { type: 'text' | 'secret' | 'select' | 'manual_code'; signal?: AbortSignal }) => Promise<string>
      notify: (event: {
        type: 'info' | 'auth_url' | 'device_code' | 'progress'
        message?: string
        url?: string
        userCode?: string
        verificationUri?: string
      }) => void
    }
  ) => Promise<unknown>
  logout: (provider: string) => Promise<void>
}

interface PiModelRegistry {
  find: (provider: string, model: string) => unknown
  hasConfiguredAuth: (model: unknown) => boolean
  refresh?: () => Promise<void>
}

interface PiLegacyModelRegistryFactory {
  create: (authStorage: PiAuthStorage, modelsPath?: string) => PiModelRegistry
}

interface PiModernModelRegistryFactory {
  new (modelRuntime: PiModelRuntime): PiModelRegistry
}

interface PiAuthModule {
  AuthStorage: { create: (path: string) => PiAuthStorage }
  ModelRuntime?: { create: (options?: { authPath?: string; modelsPath?: string | null }) => Promise<PiModelRuntime> }
  ModelRegistry: PiLegacyModelRegistryFactory | PiModernModelRegistryFactory
}

const loadPiAuthModule = async (): Promise<PiAuthModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule

const createPiModelRuntime = async (pi: PiAuthModule): Promise<PiModelRuntime | null> =>
  pi.ModelRuntime?.create ? await pi.ModelRuntime.create({ authPath: maestroAuthPath(), modelsPath: maestroModelsPath() }) : null

const createPiModelRegistry = async (pi: PiAuthModule): Promise<{ modelRuntime?: PiModelRuntime; modelRegistry: PiModelRegistry }> => {
  const modelRuntime = await createPiModelRuntime(pi)
  if (modelRuntime) {
    const modelRegistry = new (pi.ModelRegistry as PiModernModelRegistryFactory)(modelRuntime)
    await modelRegistry.refresh?.()
    return { modelRuntime, modelRegistry }
  }
  const auth = pi.AuthStorage.create(maestroAuthPath())
  return {
    modelRegistry: (pi.ModelRegistry as PiLegacyModelRegistryFactory).create(auth, maestroModelsPath())
  }
}

export interface MaestroLlmServiceState {
  applyLlmTarget(provider: string, model: string, effort: LlmEffort): void
  getLlmRuntimeTarget(): LlmStoredTarget
  hasActiveAgentTurn(): boolean
  resetLlmTurnState(): void
  resetLlmAgentSessions(): void
  readMaestroSettings(): CoachSettings
  saveMaestroSettings(patch: Partial<CoachSettings>): CoachSettings
  emitTrace(e: TraceEvent): void
}

@injectable()
export class MaestroLlmService extends CommonService<MaestroLlmServiceState> {
  private activeLlmLoginProvider = ''
  private anthropicIpv6Server: ReturnType<typeof createServer> | null = null
  private anthropicCaptureResolve: ((url: string) => void) | null = null
  private llmConfigBroadcastGeneration = 0
  private unwatchAccountSession: (() => void) | null = null

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
    if (provider === 'openai-codex') {
      return (await codexCredentialService.getStatus()).connected
    }
    // Bitterless 的凭据就是应用账号会话:就绪 = 会话在 main 里 + 模型属于 Bitterless 预设。**纯读** ——
    // 不建 runtime、不进锁、不走网络(与 cowork `checkLlmProviderReady` 的 ai-crms 分支同形)。
    // 不能走下面那条自建 runtime 的路:pi 没有内置 `bitterless`,注册只落在建会话的那个 runtime 上,
    // 这里新建的从没注册过,于是永远 not ready(docs/issues/bitterless-provider-asks-to-sign-in-inside-chat.md)。
    if (isBitterlessProvider(provider)) {
      const known = LLM_PRESETS.some(
        (preset) => preset.provider === BITTERLESS_PROVIDER_ID && preset.model === model
      )
      return known && Boolean(customerSessionService.current)
    }
    try {
      const pi = await loadPiAuthModule()
      const { modelRuntime, modelRegistry } = await createPiModelRegistry(pi)
      if (modelRuntime) {
        const found = modelRuntime.getModel(provider, model)
        return Boolean(found && modelRuntime.hasConfiguredAuth(provider))
      }
      const found = modelRegistry.find(provider, model)
      return Boolean(found && modelRegistry.hasConfiguredAuth(found))
    } catch {
      return false
    }
  }

  /**
   * 并行探测,每个都封顶(与 cowork `coworkLlm.service.ts` 同一形状)。
   *
   * 原来是串行且**不封顶**的:`checkLlmProviderReady` 底下是
   * `ModelRuntime.create()`,它默认跑一趟 availability refresh,对每个 provider 调
   * `models.checkAuth()` —— 网络调用,没 signal 没超时。没登录时一个 provider 就能挂住整条
   * `getLlmConfig`,而它正是控制面板"Loading control config"等的那一个。
   */
  private async buildLlmProviderStates(activeProvider: string): Promise<LlmProviderState[]> {
    return await Promise.all(
      LLM_PROVIDERS.map(async (provider) => {
        const preset = firstPresetForProvider(provider.provider)
        const ready = await Promise.race([
          this.checkLlmProviderReady(provider.provider, preset?.model || '').catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROVIDER_READY_TIMEOUT_MS))
        ])
        if (!ready) console.warn(`[maestro llm] provider readiness "${provider.provider}" not ready (or timed out after ${PROVIDER_READY_TIMEOUT_MS}ms)`)
        return {
          provider: provider.provider,
          label: provider.label,
          authLabel: provider.authLabel,
          ready,
          active: provider.provider === activeProvider,
          hint: ready ? undefined : provider.hint
        }
      })
    )
  }

  private async getAndBroadcastLlmConfig(): Promise<LlmConfig> {
    // 最后开始的那次求值说了算:两次求值重叠(连着两次会话变化、会话变化撞上切模型)时,先开始的
    // 那次晚到也不再广播,免得旧的就绪状态盖掉新的。返回值照旧交给各自的调用方。
    const generation = ++this.llmConfigBroadcastGeneration
    const cfg = await this.getLlmConfig()
    if (generation === this.llmConfigBroadcastGeneration) {
      xpcMain.broadcast('coach/llm-config', cfg)
    }
    return cfg
  }

  /**
   * 应用账号会话一变(登录、恢复、登出、失效)就重算并广播一次 `coach/llm-config` —— Bitterless 的就绪
   * 读的正是这份会话,不重播的话 Control 里它的就绪要等下一次别的原因取配置才会跟上。
   *
   * 幂等,只订阅一次。监听器**绝不向外抛**:`customerSessionService` 是同步遍历监听器的,
   * 这里一抛就打断这次通知,其余订阅者(skillCloud、institutionScope 等)可能收不到这次变化。
   */
  watchAccountSession(): void {
    if (this.unwatchAccountSession) return
    this.unwatchAccountSession = customerSessionService.subscribe(() => {
      void this.getAndBroadcastLlmConfig().catch((err) => {
        console.warn(
          '[maestro llm] re-broadcast after account session change failed:',
          err instanceof Error ? err.message : err
        )
      })
    })
  }

  private broadcastLlmLoginState(provider: string, loading: boolean): void {
    this.activeLlmLoginProvider = loading ? provider : ''
    xpcMain.broadcast('coach/llm-login-state', { provider, loading, ts: Date.now() })
  }

  async getLlmConfig(): Promise<LlmConfig> {
    const target = await this.readStoredLlmTarget()
    const active = this._state.getLlmRuntimeTarget()
    if (active.provider !== target.provider || active.model !== target.model || active.effort !== target.effort) {
      this._state.applyLlmTarget(target.provider, target.model, target.effort)
    }
    const providers = await this.buildLlmProviderStates(target.provider)
    const selectedProvider = providers.find((item) => item.provider === target.provider)
    const ready = Boolean(selectedProvider?.ready)
    const { presets, windows } = await this.withResolvedContextWindows(
      applyCompressionPrefs(selectableLlmPresets(), await this.readStoredLlmCompressionPrefs())
    )
    return {
      compactPrompt: this._state.readMaestroSettings().compactPrompt || '',
      defaultCompactPrompt: DEFAULT_COMPACT_PROMPT,
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

  /**
   * 把预设里**手写**的 `contextLengthK` 换成 pi 目录里的真实窗口。
   *
   * 手写值与 pi 实际用的窗口没有任何同步机制 —— 而压缩的触发线、reserve 预算、summary 上限
   * 全都乘在它上面。1M 的模型被当 256K 会提前压;200K 的被当 1M,压缩**永远不触发直到溢出**。
   *
   * 解析失败或超时**不阻断配置** —— 沿用各预设配置的窗口并留日志。
   * 个别模型未解析到窗口时也沿用配置。
   */
  private async withResolvedContextWindows(
    presets: LlmTarget[]
  ): Promise<{ presets: LlmTarget[]; windows: Record<string, number> }> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      // 封顶,不只 try/catch:catch 只接得住抛出、接不住**挂住**,而
      // `ModelRuntime.create()` 那趟 availability refresh 没登录时能挂几分钟
      // (cowork 2026-09-17 实测 `getLlmConfig` 跑了 333,784ms,把整机启动判定成 stalled;
      //  见 micromeet-cowork/docs/issues/boot-stall-renderer-config-pi-availability-refresh.md)。
      // 超时退 `{}` 与解析失败同一口径 —— 沿用各预设配置的窗口。
      const windows = await Promise.race([
        new PiRuntimeAdapter().describeContextWindows({
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          targets: presets.map((preset) => ({ providerId: preset.provider, modelId: preset.model }))
        }),
        new Promise<Record<string, number>>((resolve) => {
          timeout = setTimeout(() => {
            console.warn(`[llm] 解析上下文窗口超时(${CONTEXT_WINDOW_TIMEOUT_MS}ms),沿用预设里配置的窗口`)
            resolve({})
          }, CONTEXT_WINDOW_TIMEOUT_MS)
        })
      ])
      return { presets: applyResolvedContextWindows(presets, windows), windows }
    } catch (err) {
      console.warn('[llm] 解析上下文窗口失败,沿用预设里配置的窗口:', err instanceof Error ? err.message : err)
      return { presets: applyResolvedContextWindows(presets, {}), windows: {} }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    if (this._state.hasActiveAgentTurn()) {
      throw new Error('The model cannot be changed while a Maestro turn is active.')
    }
    const target = requireSelectableLlmTarget(params)
    await this.writeStoredLlmTarget(target)
    this._state.applyLlmTarget(target.provider, target.model, target.effort)
    this._state.resetLlmTurnState()
    this._state.emitTrace({ kind: 'info', msg: `LLM backend -> ${target.provider}/${target.model}/${target.effort} (conversations reset)`, ts: Date.now() })
    return await this.getAndBroadcastLlmConfig()
  }

  async setCompactPrompt(params: { compactPrompt: string }): Promise<LlmConfig> {
    if (typeof params?.compactPrompt !== 'string') throw new Error('compactPrompt must be text.')
    this._state.saveMaestroSettings({ compactPrompt: params.compactPrompt })
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
    const provider = requireSelectableLlmProvider(
      params?.provider || active.provider || 'openai-codex'
    )
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
      mkdirSync(dirname(maestroAuthPath()), { recursive: true })
      const pi = await loadPiAuthModule()
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
        const modelRuntime = await createPiModelRuntime(pi)
        const manualCodeInput = async (): Promise<string> => await captured
        if (modelRuntime) {
          await Promise.race([
            modelRuntime.login(provider, 'oauth', {
              signal: AbortSignal.timeout(timeoutMs),
              prompt: async (prompt) => {
                if (prompt.type === 'select') return method
                if (prompt.type === 'manual_code') return await manualCodeInput()
                return await new Promise<string>(() => {})
              },
              notify: (event) => {
                if (event.type === 'auth_url' && event.url) void shell.openExternal(event.url)
                if (event.type === 'device_code' && event.verificationUri) {
                  void shell.openExternal(event.verificationUri)
                  this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} device login: enter code ${event.userCode || ''} at ${event.verificationUri}`, ts: Date.now() })
                  xpcMain.broadcast('coach/codex-device', { userCode: event.userCode || '', verificationUri: event.verificationUri })
                }
                if ((event.type === 'progress' || event.type === 'info') && event.message) {
                  this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} login: ${event.message}`, ts: Date.now() })
                }
              }
            }),
            timeout
          ])
        } else {
          const auth = pi.AuthStorage.create(maestroAuthPath())
          await Promise.race([
            auth.login(provider, {
              onSelect: async () => method,
              onAuth: ({ url }: { url: string }) => {
                void shell.openExternal(url)
              },
              onManualCodeInput: manualCodeInput,
              onDeviceCode: (info: { userCode: string; verificationUri: string }) => {
                void shell.openExternal(info.verificationUri)
                this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} device login: enter code ${info.userCode} at ${info.verificationUri}`, ts: Date.now() })
                xpcMain.broadcast('coach/codex-device', { userCode: info.userCode, verificationUri: info.verificationUri })
              },
              onPrompt: () => new Promise<string>(() => {}),
              onProgress: (m: string) => this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} login: ${m}`, ts: Date.now() })
            }),
            timeout
          ])
        }
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
    const provider = requireSelectableLlmProvider(
      params?.provider || active.provider || 'openai-codex'
    )
    try {
      if (provider === 'openai-codex') {
        await codexCredentialService.disconnect()
      } else {
        const pi = await loadPiAuthModule()
        const modelRuntime = await createPiModelRuntime(pi)
        if (modelRuntime) {
          await modelRuntime.logout(provider)
        } else {
          pi.AuthStorage.create(maestroAuthPath()).logout(provider)
        }
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
