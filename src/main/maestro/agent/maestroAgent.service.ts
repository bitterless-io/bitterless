import { clipboard, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { randomUUID } from 'crypto'
import { basename, extname, join, resolve, sep } from 'path'
import { mkdirSync, statSync, writeFileSync } from 'fs'
import { fetch } from 'undici'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { BaseAgent, STEER_NOT_STREAMING, type PiToolSpec } from '@maestro-main/agent/BaseAgent'
import { MaestroAgent } from '@maestro-main/agent/MaestroAgent'
import { CoachAgent } from '@maestro-main/agent/CoachAgent'
import { DelegateAgent } from '@maestro-main/agent/DelegateAgent'
import { readHostToolCatalog } from '@maestro-main/agent/hostToolCatalog'
import { extractVariablesFromMessage } from '@maestro-main/agent/naturalLanguageVariables'
import {
  hasRequiredInputs,
  requiredInputNames,
  requiredInputsSatisfied
} from '@maestro-main/skills/skillContract.helper'
import type {
  AgentRuntimeImage,
  AgentRuntimeMediaRef
} from '@maestro-main/agent/runtime/agentRuntime.types'
import { HostApprovalHistory } from '@maestro-main/agent/runtime/hostApprovalHistory'
import {
  HostToolRegistry,
  type HostToolConfirmRequest
} from '@maestro-main/agent/runtime/hostToolRegistry'
import {
  mediaTransportForProvider,
  resolveRuntimeMediaRefs
} from '@maestro-main/agent/runtime/mediaRefResolver'
import { sanitizeRuntimeError } from '@maestro-main/agent/runtime/errorSanitizer'
import {
  broadcastAgentActivity,
  broadcastAgentStream,
  broadcastAgentThinking,
  broadcastCodexDebug
} from '@maestro-main/agent/runtime/agentBroadcast'
import {
  AGENT_IMAGE_MIME_BY_EXT,
  AI_CRMS_ASR_MODEL,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_MEDIA_REFS,
  MAX_ASR_AUDIO_BYTES,
  MAX_ATTACHMENT_BYTES,
  agentMediaMimeForPath,
  bailianMultimodalGenerationUrl,
  buildAgentTurnPrompt,
  buildConversationCompactPrompt,
  buildTrainerTurnPrompt,
  normalizeAsrFormat,
  normalizeCompactSummary,
  normalizeHostToolPolicies,
  normalizeHostToolPolicyMode,
  readScribeText,
  safeUrlForDebug,
  summarizeApprovalArgs,
  summarizeRecordsForTrainer,
  type AgentSkillBrief
} from '@maestro-main/agent/runtime/agentPrompt'
import type { CaptureRecordSource } from '@maestro-main/capture/captureRecordSource'
import { cleanupTempFile } from '@maestro-main/files/tempCleanup.service'
import {
  MAX_ARCHIVE_ATTACHMENT_BYTES,
  isArchivePath
} from '@maestro-main/files/archive.service'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { buildUnknownConfirmPayload } from '@maestro-main/drive/confirmPayload'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import { maestroAuthPath, maestroModelsPath } from '@maestro-main/llm/llmPaths'
import { providerLabel, type LlmStoredTarget } from '@maestro-main/llm/llmModels'
import { uploadFileThroughAiCrmsCore } from '@maestro-main/networking/api/aiCrmsCoreFileUpload.api'
import { uploadMediaRefsForProvider } from '@maestro-main/networking/api/mediaUpload.api'
import { resolveAiCrmsRelayEndpoint } from '@maestro-main/networking/clients/relay.client'
import type { SkillGeneratorService } from '@maestro-main/skills/skillGenerator.service'
import type { SkillRegistryService } from '@maestro-main/skills/skillRegistry.service'
import type {
  AgentActivityStep,
  AgentCompactReply,
  AgentCompactRequest,
  AgentConversationContext,
  AgentFileArtifact,
  AgentReply,
  AttachFileResult,
  AudioScribeRequest,
  AudioScribeResult,
  HostApprovalEvent,
  HostApprovalExportResult,
  HostApprovalHistoryResult,
  HostToolCatalogResult,
  HostToolPolicyMap,
  HostToolPolicyMode,
  HostToolPolicyResult,
  HostToolScope,
  LlmEffort,
  ReplayResult,
  SkillSummary,
  TabInfo,
  WorkspaceRef
} from '@maestro-shared/coach.api'
import { MODEL_RETRY_CHANNEL, type ModelRetryProgress } from '@maestro-shared/coach.api'
import type { AuthSession, SessionApi } from '@maestro-shared/session.api'
import {
  HOST_APPROVAL_HISTORY_KEY,
  HOST_TOOL_CONFIG_DOMAIN,
  HOST_TOOL_POLICY_KEY,
  type ConfigApi
} from '@maestro-shared/config.api'
import type { TraceEvent } from '@maestro-shared/trace.types'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')
const aiCrmsSession = createXpcMainEmitter<SessionApi>('MaestroSessionDao')

const MODEL_RETRY_MAX = 5
const MODEL_RETRY_GAP_MS = 3_000

const isTransientModelError = (raw: string): boolean => {
  const text = String(raw || '').toLowerCase()
  if (!text) return false
  if (
    /not signed in|auth file|missing provider|no provider credentials|credential|unauthorized|forbidden|invalid[_ -]?api[_ -]?key/.test(
      text
    )
  ) {
    return false
  }
  if (/\b(400|401|403|404|422)\b/.test(text)) return false
  if (
    /insufficient[_ -]?quota|quota (?:exceeded|exhausted)|exceeded your (?:current )?quota|check your plan and billing|usage limit reached|(?:out of|exhausted your) credits|no credits (?:left|remaining)/.test(
      text
    )
  ) {
    return false
  }
  return (
    /server_error|internal error|internal server|bad gateway|service unavailable|gateway timeout/.test(
      text
    ) ||
    /\b(500|502|503|504|429)\b/.test(text) ||
    /timed? ?out|timeout|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|stream (?:closed|error)/.test(
      text
    ) ||
    /you can retry/.test(text)
  )
}

interface MaestroAgentRuntimeServices {
  registry: SkillRegistryService
  generator: SkillGeneratorService
}

export interface MaestroAgentServiceState {
  browserWindow: BrowserWindow | null
  currentUrl: string

  ensureServices(): MaestroAgentRuntimeServices
  buildPiTools(opts?: { ingest?: boolean; sessionKey?: string }): PiToolSpec[]
  buildCaptureAnalysisTools(): PiToolSpec[]
  ensurePersistedCaptureRecordsLoaded(): Promise<void>
  captureRecordsForAgent(): CaptureRecordSource
  replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  syncWorkspaceFromContext(sessionKey: string, workspace?: WorkspaceRef): void
  trainerToolDetail(skillId: string): string
  trainerToolCreate(guidance: string): Promise<string>
  trainerToolOptimize(skillId: string, guidance: string): Promise<string>
  trainerToolDelete(skillId: string): string
  emitTrace(event: TraceEvent): void
}

export interface MaestroAgentInstances {
  pi: MaestroAgent
  piTrainer: CoachAgent
  piDelegate: DelegateAgent
  piGen: BaseAgent
}

/**
 * Maestro's agent runtime and session boundary.
 *
 * Tool implementations stay in their owning domains. This service owns agent instances, session
 * hydration, media and attachment registration, turn results, model targeting, host-tool policy,
 * approval history, and shutdown disposal.
 */
@injectable()
export class MaestroAgentService extends CommonService<MaestroAgentServiceState> {
  private pi: MaestroAgent | null = null
  private piTrainer: CoachAgent | null = null
  private piDelegate: DelegateAgent | null = null
  private piGen: BaseAgent | null = null

  private readonly maestroAgents = new Map<string, MaestroAgent>()
  private readonly trainerAgents = new Map<string, CoachAgent>()
  private readonly delegateAgents = new Map<string, DelegateAgent>()
  private readonly hydratedMaestroAgentSessions = new Set<string>()
  private readonly attachedPaths = new Map<string, Set<string>>()
  /** Generation per chat session. Stop increments it so retry gaps cannot launch a ghost prompt. */
  private readonly agentAbortEpochs = new Map<string, number>()
  /** Logical Turn owner spans setup and retry gaps, where BaseAgent itself can temporarily be idle. */
  private readonly agentTurnOwners = new Map<string, symbol>()

  lastAgentRun: {
    skill?: SkillSummary
    skills?: SkillSummary[]
    replay?: ReplayResult
  } = {}

  lastAgentArtifacts: AgentFileArtifact[] = []
  tabsOpenedThisTurn: TabInfo[] = []
  lastTrainerRun: { skill?: SkillSummary } = {}

  private activeLlmProvider = 'openai-codex'
  private activeLlmModel = 'gpt-5.6-luna'
  private activeLlmEffort: LlmEffort = 'low'
  private shuttingDown = false

  private hostToolPolicies: HostToolPolicyMap = {}
  private hostToolPolicyLoadPromise: Promise<void> | null = null
  private readonly hostApprovalHistory = new HostApprovalHistory()
  private hostApprovalHistoryLoadPromise: Promise<void> | null = null

  activate(): void {
    this.shuttingDown = false
    this.tabsOpenedThisTurn = []
  }

  ensureAgents(): MaestroAgentInstances {
    this.assertAgentRuntimeActive()
    if (!this.piGen) {
      this.piGen = this.configureAgent(
        new BaseAgent({
          buildTools: () => [],
          scope: 'summarize',
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity
        })
      )
    }
    if (!this.pi) {
      this.pi = this.configureAgent(
        new MaestroAgent({
          buildTools: () => this._state.buildPiTools({ ingest: true, sessionKey: 'default' }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity,
          onThinking: (state) => broadcastAgentThinking('default', state),
          onStream: (delta) => broadcastAgentStream('default', delta)
        })
      )
    }
    if (!this.piTrainer) {
      this.piTrainer = this.configureAgent(
        new CoachAgent({
          buildTools: () => this.buildTrainerTools(),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity
        })
      )
    }
    if (!this.piDelegate) {
      this.piDelegate = this.configureAgent(
        new DelegateAgent({
          buildTools: () => this._state.buildPiTools({ sessionKey: 'default' }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity
        })
      )
    }
    return {
      pi: this.pi,
      piTrainer: this.piTrainer,
      piDelegate: this.piDelegate,
      piGen: this.piGen
    }
  }

  applyLlmTarget(provider: string, model: string, effort: LlmEffort = 'low'): void {
    this.activeLlmProvider = provider
    this.activeLlmModel = model
    this.activeLlmEffort = effort
    this.piGen?.setTarget(provider, model, effort)
    this.pi?.setTarget(provider, model, effort)
    this.piTrainer?.setTarget(provider, model, effort)
    this.piDelegate?.setTarget(provider, model, effort)
    for (const agent of this.maestroAgents.values()) {
      agent.setTarget(provider, model, effort)
    }
    for (const agent of this.trainerAgents.values()) {
      agent.setTarget(provider, model, effort)
    }
    for (const agent of this.delegateAgents.values()) {
      agent.setTarget(provider, model, effort)
    }
    this.hydratedMaestroAgentSessions.clear()
  }

  getLlmRuntimeTarget(): LlmStoredTarget {
    return {
      provider: this.activeLlmProvider,
      model: this.activeLlmModel,
      effort: this.activeLlmEffort
    }
  }

  resetTurnState(): void {
    this.lastAgentRun = {}
    this.lastTrainerRun = {}
  }

  resetAgentSessions(): void {
    this.pi?.reset()
    this.piTrainer?.reset()
    this.piDelegate?.reset()
    this.piGen?.reset()
    for (const agent of this.maestroAgents.values()) agent.reset()
    for (const agent of this.trainerAgents.values()) agent.reset()
    for (const agent of this.delegateAgents.values()) agent.reset()
    this.hydratedMaestroAgentSessions.clear()
  }

  recordAgentArtifact(file: AgentFileArtifact): void {
    const existing = this.lastAgentArtifacts.find((item) => item.path === file.path)
    if (existing) {
      existing.action = file.action
      existing.size = file.size
      existing.name = file.name
      return
    }
    this.lastAgentArtifacts.push(file)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const agents = new Set(
      [
        this.pi,
        this.piTrainer,
        this.piDelegate,
        this.piGen,
        ...this.maestroAgents.values(),
        ...this.trainerAgents.values(),
        ...this.delegateAgents.values()
      ].filter((agent): agent is BaseAgent => Boolean(agent))
    )
    await Promise.allSettled([...agents].map((agent) => agent.dispose()))

    this.attachedPaths.clear()
    this.maestroAgents.clear()
    this.trainerAgents.clear()
    this.delegateAgents.clear()
    this.hydratedMaestroAgentSessions.clear()
    this.pi = null
    this.piTrainer = null
    this.piDelegate = null
    this.piGen = null
    this.lastAgentRun = {}
    this.lastAgentArtifacts = []
    this.tabsOpenedThisTurn = []
    this.lastTrainerRun = {}
  }

  async getHostToolCatalog(params?: {
    scope?: HostToolScope
    category?: string
    query?: string
  }): Promise<HostToolCatalogResult> {
    await this.loadHostToolPolicies()
    return readHostToolCatalog({
      scope: params?.scope === 'trainer' ? 'trainer' : 'cowork',
      category: params?.category || '',
      query: params?.query || '',
      policies: this.hostToolPolicies
    })
  }

  async setHostToolPolicy(params: {
    toolName: string
    mode: HostToolPolicyMode
  }): Promise<HostToolPolicyResult> {
    await this.loadHostToolPolicies()
    const toolName = String(params.toolName || '').trim()
    const mode = normalizeHostToolPolicyMode(params.mode)
    if (!toolName) {
      return {
        ok: false,
        policies: this.hostToolPolicies,
        error: 'toolName is required'
      }
    }
    const known =
      readHostToolCatalog({
        scope: 'cowork',
        policies: this.hostToolPolicies
      }).tools.some((tool) => tool.name === toolName) ||
      readHostToolCatalog({
        scope: 'trainer',
        policies: this.hostToolPolicies
      }).tools.some((tool) => tool.name === toolName)
    if (!known) {
      return {
        ok: false,
        policies: this.hostToolPolicies,
        error: `unknown tool: ${toolName}`
      }
    }

    this.hostToolPolicies = {
      ...this.hostToolPolicies,
      [toolName]: { toolName, mode, updatedAt: Date.now() }
    }
    await configStore
      .upsert({
        domain: HOST_TOOL_CONFIG_DOMAIN,
        key: HOST_TOOL_POLICY_KEY,
        options: this.hostToolPolicies
      })
      .catch((err) => {
        this._state.emitTrace({
          kind: 'error',
          msg: 'save host tool policy: ' + (err as Error).message,
          ts: Date.now()
        })
      })
    this.resetAgentSessions()
    return { ok: true, policies: this.hostToolPolicies }
  }

  async getHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    await this.loadHostApprovalHistory()
    return { ok: true, events: this.hostApprovalHistory.list() }
  }

  async exportHostApprovalEvents(): Promise<HostApprovalExportResult> {
    await this.loadHostApprovalHistory()
    const result = this._state.browserWindow
      ? await dialog.showOpenDialog(this._state.browserWindow, {
          title: 'Choose host approval export directory',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Choose host approval export directory',
          properties: ['openDirectory', 'createDirectory']
        })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, canceled: true }
    }
    try {
      const payload = this.hostApprovalHistory.exportPayload()
      const stamp = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-')
      const file = join(result.filePaths[0], `coach-host-approvals-${stamp}.json`)
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      shell.showItemInFolder(file)
      return { ok: true, path: file, count: payload.count }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async clearHostApprovalEvents(): Promise<HostApprovalHistoryResult> {
    await this.loadHostApprovalHistory()
    const events = this.hostApprovalHistory.clear()
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', { cleared: true, events: [] })
    return { ok: true, events }
  }

  async loadHostApprovalHistory(): Promise<void> {
    if (this.hostApprovalHistoryLoadPromise) {
      return await this.hostApprovalHistoryLoadPromise
    }
    this.hostApprovalHistoryLoadPromise = configStore
      .get({ domain: HOST_TOOL_CONFIG_DOMAIN, key: HOST_APPROVAL_HISTORY_KEY })
      .then((entry) => {
        this.hostApprovalHistory.replace(
          Array.isArray(entry?.options) ? (entry.options as HostApprovalEvent[]) : []
        )
      })
      .catch((err) => {
        this._state.emitTrace({
          kind: 'error',
          msg: 'load host approval history: ' + (err as Error).message,
          ts: Date.now()
        })
      })
      .finally(() => {
        this.hostApprovalHistoryLoadPromise = null
      })
    return await this.hostApprovalHistoryLoadPromise
  }

  private async saveHostApprovalHistory(): Promise<void> {
    await configStore
      .upsert({
        domain: HOST_TOOL_CONFIG_DOMAIN,
        key: HOST_APPROVAL_HISTORY_KEY,
        options: this.hostApprovalHistory.snapshot()
      })
      .catch((err) => {
        this._state.emitTrace({
          kind: 'error',
          msg: 'save host approval history: ' + (err as Error).message,
          ts: Date.now()
        })
      })
  }

  async loadHostToolPolicies(): Promise<void> {
    if (this.hostToolPolicyLoadPromise) {
      return await this.hostToolPolicyLoadPromise
    }
    this.hostToolPolicyLoadPromise = configStore
      .get({ domain: HOST_TOOL_CONFIG_DOMAIN, key: HOST_TOOL_POLICY_KEY })
      .then((entry) => {
        this.hostToolPolicies = normalizeHostToolPolicies(entry?.options)
      })
      .catch((err) => {
        this._state.emitTrace({
          kind: 'error',
          msg: 'load host tool policy: ' + (err as Error).message,
          ts: Date.now()
        })
        this.hostToolPolicies = {}
      })
      .finally(() => {
        this.hostToolPolicyLoadPromise = null
      })
    return await this.hostToolPolicyLoadPromise
  }

  async attachFiles(params: { sessionId?: string; paths: string[] }): Promise<AttachFileResult[]> {
    const key = this.agentSessionKey(params.sessionId)
    let allow = this.attachedPaths.get(key)
    if (!allow) {
      allow = new Set<string>()
      this.attachedPaths.set(key, allow)
    }
    const results: AttachFileResult[] = []
    for (const raw of params.paths || []) {
      const abs = resolve(String(raw || ''))
      const name = abs.split(sep).pop() || abs
      if (!raw) {
        results.push({ ok: false, name, path: abs, error: 'empty-path' })
        continue
      }
      try {
        const stats = statSync(abs)
        if (stats.isDirectory()) {
          allow.add(abs)
          results.push({ ok: true, name, path: abs, isDirectory: true })
          continue
        }
        if (!stats.isFile()) {
          results.push({ ok: false, name, path: abs, error: 'not-a-file' })
          continue
        }
        const limit = isArchivePath(abs)
          ? MAX_ARCHIVE_ATTACHMENT_BYTES
          : MAX_ATTACHMENT_BYTES
        if (stats.size > limit) {
          const asGb = limit >= 1024 * 1024 * 1024
          const shown = asGb
            ? `${(stats.size / 1024 / 1024 / 1024).toFixed(1)} GB`
            : `${(stats.size / 1024 / 1024).toFixed(1)} MB`
          const cap = asGb
            ? `${(limit / 1024 / 1024 / 1024).toFixed(0)} GB`
            : `${(limit / 1024 / 1024).toFixed(0)} MB`
          results.push({
            ok: false,
            name,
            path: abs,
            error: `too-large (${shown}; limit ${cap})`
          })
          continue
        }
        allow.add(abs)
        results.push({ ok: true, name, path: abs, size: stats.size })
      } catch {
        results.push({ ok: false, name, path: abs, error: 'not-found' })
      }
    }
    return results
  }

  async attachClipboardImage(params?: { sessionId?: string }): Promise<AttachFileResult> {
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return {
        ok: false,
        name: 'clipboard.png',
        error: 'clipboard-has-no-image'
      }
    }
    const png = image.toPNG()
    if (!png.length) {
      return {
        ok: false,
        name: 'clipboard.png',
        error: 'clipboard-image-empty'
      }
    }
    if (png.length > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        name: 'clipboard.png',
        error: `too-large (${(png.length / 1024 / 1024).toFixed(1)} MB)`
      }
    }
    const key = this.agentSessionKey(params?.sessionId)
    const sanitizedKey = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96)
    const safeKey =
      sanitizedKey && sanitizedKey !== '.' && sanitizedKey !== '..'
        ? sanitizedKey
        : 'default'
    const dir = join(maestroDataRoot(), 'attachments', safeKey)
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `${stamp}-${randomUUID().slice(0, 8)}.png`)
    writeFileSync(file, png)
    const [registered] = await this.attachFiles({
      sessionId: params?.sessionId,
      paths: [file]
    })
    return (
      registered || {
        ok: false,
        name: basename(file),
        path: file,
        error: 'register-failed'
      }
    )
  }

  async scribeAudio(params: AudioScribeRequest): Promise<AudioScribeResult> {
    const startedAt = Date.now()
    const fail = (code: AudioScribeResult['code'], error: string): AudioScribeResult => ({
      ok: false,
      text: '',
      model: AI_CRMS_ASR_MODEL,
      durationMs: Date.now() - startedAt,
      code,
      error
    })
    const session = await aiCrmsSession.getSession().catch(() => null)
    if (!session?.jwt_token) {
      return fail('ai-crms-login-required', 'Sign in to AI-CRMS before using voice scribe.')
    }

    const audioPath = resolve(String(params.path || ''))
    let audioSize = 0
    try {
      const stats = statSync(audioPath)
      if (!stats.isFile()) {
        return fail('audio-not-found', 'Audio file is not a file.')
      }
      if (stats.size <= 0) return fail('invalid-audio', 'Audio file is empty.')
      if (stats.size > MAX_ASR_AUDIO_BYTES) {
        return fail(
          'audio-too-large',
          `Audio is too large for ASR (${(stats.size / 1024 / 1024).toFixed(1)} MB).`
        )
      }
      audioSize = stats.size
    } catch {
      return fail('audio-not-found', 'Audio file not found.')
    }

    let stage: 'core-upload' | 'asr-request' = 'core-upload'
    try {
      const format = normalizeAsrFormat(params.format, params.mime)
      const uploadStartedAt = Date.now()
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'ai-crms-asr-upload',
        level: 'info',
        message: 'AI-CRMS ASR audio upload starting.',
        detail: {
          transport: 'core-sts-private-url',
          bytes: audioSize,
          format,
          mimeType: params.mime || 'audio/wav',
          purpose: 'coach_voice_scribe'
        },
        ts: Date.now()
      })
      const upload = await uploadFileThroughAiCrmsCore({
        session,
        path: audioPath,
        mimeType: params.mime || 'audio/wav',
        name: basename(audioPath),
        size: audioSize,
        purpose: 'coach_voice_scribe'
      })
      const audioUrl = upload.fileUrl
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'ai-crms-asr-upload',
        level: 'info',
        message: 'AI-CRMS ASR core upload completed.',
        detail: {
          transport: 'core-sts-private-url',
          durationMs: Date.now() - uploadStartedAt,
          fileId: upload.fileId,
          coreBaseUrl: upload.coreBaseUrl,
          audioUrl: safeUrlForDebug(audioUrl),
          uploadUrl: safeUrlForDebug(upload.uploadUrl)
        },
        ts: Date.now()
      })
      const endpoint = resolveAiCrmsRelayEndpoint(session)
      const url = bailianMultimodalGenerationUrl(endpoint.baseUrl)
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${session.jwt_token}`,
        'Content-Type': 'application/json',
        'x-region': endpoint.region
      }
      if (session.tenant_id) headers['x-workspace-id'] = session.tenant_id
      const parameters: Record<string, unknown> = { format }
      const sampleRate = Math.round(Number(params.sampleRate))
      if (Number.isFinite(sampleRate) && sampleRate > 0) {
        parameters.sample_rate = String(sampleRate)
      }
      const body = {
        model: AI_CRMS_ASR_MODEL,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: audioUrl
                  }
                }
              ]
            }
          ]
        },
        parameters
      }
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'ai-crms-asr-request',
        level: 'info',
        message: 'AI-CRMS ASR request.',
        detail: {
          url,
          model: AI_CRMS_ASR_MODEL,
          transport: 'core-sts-private-url',
          endpoint: 'multimodal-generation.generation',
          format,
          parameters,
          bytes: audioSize,
          fileId: upload.fileId,
          audioUrl: safeUrlForDebug(audioUrl),
          region: endpoint.region,
          headerKeys: Object.keys(headers).sort(),
          hasAuthorizationHeader: true
        },
        ts: Date.now()
      })
      stage = 'asr-request'
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
      const text = await res.text()
      let json: unknown = {}
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        json = { raw: text }
      }
      if (!res.ok) {
        const error = sanitizeRuntimeError(text || `HTTP ${res.status}`, 'AI-CRMS ASR')
        broadcastCodexDebug({
          scope: 'agent',
          phase: 'ai-crms-asr-error',
          level: 'error',
          message: 'AI-CRMS ASR failed.',
          detail: {
            status: res.status,
            transport: 'core-sts-private-url',
            durationMs: Date.now() - startedAt,
            error
          },
          ts: Date.now()
        })
        return fail('relay-error', `AI-CRMS ASR HTTP ${res.status}${error ? ` ${error}` : ''}`)
      }
      const transcript = readScribeText(json)
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'ai-crms-asr-response',
        level: transcript ? 'info' : 'warn',
        message: 'AI-CRMS ASR response.',
        detail: {
          durationMs: Date.now() - startedAt,
          status: res.status,
          transport: 'core-sts-private-url',
          outputChars: transcript.length,
          requestId:
            typeof (json as Record<string, any>)?.request_id === 'string'
              ? (json as Record<string, any>).request_id
              : ''
        },
        ts: Date.now()
      })
      if (!transcript) {
        return fail('relay-error', 'AI-CRMS ASR returned no transcript.')
      }
      return {
        ok: true,
        text: transcript,
        model: AI_CRMS_ASR_MODEL,
        durationMs: Date.now() - startedAt
      }
    } catch (err) {
      const error = sanitizeRuntimeError(
        err instanceof Error ? err.message : String(err),
        'AI-CRMS ASR'
      )
      broadcastCodexDebug({
        scope: 'agent',
        phase: stage === 'core-upload' ? 'ai-crms-asr-upload' : 'ai-crms-asr-error',
        level: 'error',
        message:
          stage === 'core-upload'
            ? 'AI-CRMS ASR core upload failed.'
            : 'AI-CRMS ASR failed before response.',
        detail: {
          transport: 'core-sts-private-url',
          durationMs: Date.now() - startedAt,
          error
        },
        ts: Date.now()
      })
      return fail(stage === 'core-upload' ? 'media-upload-unavailable' : 'relay-error', error)
    } finally {
      cleanupTempFile(audioPath)
    }
  }

  async sendAgentMessage(params: {
    message: string
    sessionId?: string
    context?: AgentConversationContext
  }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) {
      return {
        ok: false,
        text: 'Empty message.',
        ts: Date.now(),
        error: 'empty-message'
      }
    }
    const sessionKey = this.agentSessionKey(params.sessionId)
    const abortEpoch = this.agentAbortEpochs.get(sessionKey) ?? 0
    const activeOwner = this.agentTurnOwners.get(sessionKey)
    const turnOwner = activeOwner ?? Symbol(sessionKey)
    if (!activeOwner) this.agentTurnOwners.set(sessionKey, turnOwner)
    let reply: AgentReply
    try {
      await this._state.ensurePersistedCaptureRecordsLoaded()
      reply = await this.routeAgentMessage(
        message,
        params.sessionId,
        params.context,
        abortEpoch,
        Boolean(activeOwner)
      )
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      reply = {
        ok: false,
        text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error),
        ts: Date.now(),
        error
      }
    }
    try {
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'agent-reply',
        level: reply.ok ? 'info' : 'warn',
        message: 'agent reply returned to renderer.',
        detail: {
          sessionId: sessionKey,
          ok: reply.ok,
          textChars: reply.text?.length || 0,
          error: reply.error
        },
        ts: Date.now()
      })
      return reply
    } finally {
      if (!activeOwner && this.agentTurnOwners.get(sessionKey) === turnOwner) {
        this.agentTurnOwners.delete(sessionKey)
      }
    }
  }

  async compactConversation(params: AgentCompactRequest): Promise<AgentCompactReply> {
    const maxSummaryChars = Math.max(
      800,
      Math.min(500_000, Math.round(params.maxSummaryChars || 6000))
    )
    if (!params.messages?.length && !params.previousSummary?.trim()) {
      return {
        ok: false,
        summary: '',
        ts: Date.now(),
        error: 'nothing-to-compact'
      }
    }
    const prompt = buildConversationCompactPrompt({
      ...params,
      maxSummaryChars
    })
    try {
      const { piGen } = this.ensureAgents()
      const result = await piGen.oneShot(prompt, 120_000)
      const summary = normalizeCompactSummary(result.text || '', maxSummaryChars)
      if (!result.ok || !summary) {
        return {
          ok: false,
          summary: '',
          ts: Date.now(),
          error: result.error || result.errorMessage || 'compact-summary-empty'
        }
      }
      return { ok: true, summary, ts: Date.now() }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: '', ts: Date.now(), error }
    }
  }

  async delegateMessage(params: { message: string; sessionId?: string }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) {
      return {
        ok: false,
        text: 'Empty message.',
        ts: Date.now(),
        error: 'empty-message'
      }
    }
    await this.loadHostToolPolicies()
    return await this.handleAgentTurn(message, this.getDelegateAgent(params.sessionId))
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    this.lastAgentRun = {}
    this.getExistingDelegateAgent(params?.sessionId)?.reset()
    return { ok: true }
  }

  async abortAgent(params?: { sessionId?: string }): Promise<void> {
    const sessionKey = this.agentSessionKey(params?.sessionId)
    this.agentAbortEpochs.set(sessionKey, (this.agentAbortEpochs.get(sessionKey) ?? 0) + 1)
    this.agentTurnOwners.delete(sessionKey)
    this.hydratedMaestroAgentSessions.delete(sessionKey)
    taskRegistry.cancelTransient('active turn stopped')
    await this.getExistingMaestroAgent(params?.sessionId)?.abort()
  }

  async abortTrainer(params?: { sessionId?: string }): Promise<void> {
    await this.getExistingTrainerAgent(params?.sessionId)?.abort()
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await this.getExistingDelegateAgent(params?.sessionId)?.abort()
  }

  agentSessionKey(sessionId?: string): string {
    return sessionId?.trim() || 'default'
  }

  private assertAgentRuntimeActive(): void {
    if (this.shuttingDown) {
      throw new Error('Maestro runtime is shutting down.')
    }
  }

  private configureAgent<T extends BaseAgent>(agent: T): T {
    agent.setTarget(this.activeLlmProvider, this.activeLlmModel, this.activeLlmEffort)
    return agent
  }

  private readonly relayAgentActivity = (step: AgentActivityStep): void => {
    broadcastAgentActivity(step.phase, step.label, step.ok)
  }

  private getMaestroAgent(sessionId?: string): MaestroAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureAgents().pi
    let agent = this.maestroAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new MaestroAgent({
          buildTools: () => this._state.buildPiTools({ ingest: true, sessionKey: key }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity,
          onThinking: (state) => broadcastAgentThinking(key, state),
          onStream: (delta) => broadcastAgentStream(key, delta)
        })
      )
      this.maestroAgents.set(key, agent)
    }
    return agent
  }

  private getTrainerAgent(sessionId?: string): CoachAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureAgents().piTrainer
    let agent = this.trainerAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new CoachAgent({
          buildTools: () => this.buildTrainerTools(),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity
        })
      )
      this.trainerAgents.set(key, agent)
    }
    return agent
  }

  private getDelegateAgent(sessionId?: string): DelegateAgent {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.ensureAgents().piDelegate
    let agent = this.delegateAgents.get(key)
    if (!agent) {
      agent = this.configureAgent(
        new DelegateAgent({
          buildTools: () => this._state.buildPiTools({ sessionKey: key }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug,
          onActivity: this.relayAgentActivity
        })
      )
      this.delegateAgents.set(key, agent)
    }
    return agent
  }

  private getExistingMaestroAgent(sessionId?: string): MaestroAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.pi
    return this.maestroAgents.get(key) ?? null
  }

  private getExistingTrainerAgent(sessionId?: string): CoachAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.piTrainer
    return this.trainerAgents.get(key) ?? null
  }

  private getExistingDelegateAgent(sessionId?: string): DelegateAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.piDelegate
    return this.delegateAgents.get(key) ?? null
  }

  private async buildAgentMediaInput(
    sessionKey: string,
    attachedPaths?: string[]
  ): Promise<{
    media?: AgentRuntimeMediaRef[]
    images?: AgentRuntimeImage[]
    note: string
  }> {
    const paths = (attachedPaths || []).map((item) => resolve(String(item || ''))).filter(Boolean)
    if (!paths.length) return { note: '' }
    const allow = this.attachedPaths.get(sessionKey)
    const media: AgentRuntimeMediaRef[] = []
    const skipped: string[] = []
    const directories: string[] = []
    const archives: string[] = []
    for (const path of paths) {
      if (!allow?.has(path)) {
        skipped.push(`${basename(path)} (not registered)`)
        continue
      }
      let stats: ReturnType<typeof statSync>
      try {
        stats = statSync(path)
      } catch {
        skipped.push(`${basename(path)} (unreadable)`)
        continue
      }
      if (stats.isDirectory()) {
        directories.push(path)
        continue
      }
      if (isArchivePath(path)) {
        archives.push(path)
        continue
      }
      if (media.length >= MAX_AGENT_MEDIA_REFS) {
        skipped.push(`${basename(path)} (too many media refs)`)
        continue
      }
      const mimeType = agentMediaMimeForPath(path)
      const isImage = Boolean(AGENT_IMAGE_MIME_BY_EXT[extname(path).toLowerCase()])
      try {
        if (!stats.isFile()) {
          skipped.push(`${basename(path)} (not a file)`)
          continue
        }
        if (isImage && stats.size > MAX_AGENT_IMAGE_BYTES) {
          skipped.push(`${basename(path)} (${(stats.size / 1024 / 1024).toFixed(1)} MB > 8 MB)`)
          continue
        }
        media.push({
          kind: isImage ? 'image' : 'file',
          path,
          mimeType,
          name: basename(path),
          size: stats.size
        })
      } catch {
        skipped.push(`${basename(path)} (unreadable)`)
      }
    }
    const uploadWarnings: string[] = []
    let refs = media
    if (
      mediaTransportForProvider(this.activeLlmProvider) === 'url' &&
      media.some((item) => item.path && !item.url)
    ) {
      const upload = await uploadMediaRefsForProvider({
        providerId: this.activeLlmProvider,
        refs: media,
        session: await this.mediaUploadSessionForProvider(this.activeLlmProvider)
      })
      refs = upload.refs
      uploadWarnings.push(...upload.warnings)
      if (upload.uploaded > 0) {
        broadcastAgentActivity(
          'tool',
          `uploaded ${upload.uploaded} media ref${upload.uploaded === 1 ? '' : 's'} for URL transport`
        )
      }
    }
    const resolved = resolveRuntimeMediaRefs({
      providerId: this.activeLlmProvider,
      modelId: this.activeLlmModel,
      media: refs,
      maxImages: MAX_AGENT_IMAGES
    })
    if (media.length > 0) {
      broadcastAgentActivity(
        'tool',
        `attached ${media.length} media path ref${media.length === 1 ? '' : 's'}`
      )
    }
    const parts: string[] = []
    if (resolved.labels.length) {
      parts.push(
        `Attached media references (preferred transport: ${resolved.transport}):\n` +
          resolved.labels.map((item) => `- ${item}`).join('\n')
      )
    }
    const warnings = [...uploadWarnings, ...resolved.warnings]
    if (warnings.length) {
      parts.push(
        'Attached media transport warnings:\n' + warnings.map((item) => `- ${item}`).join('\n')
      )
    }
    if (directories.length) {
      parts.push(
        'Attached directories (folders, not files — nothing was uploaded; use list_workspace_files to see what is inside, then read_file on the entries you need):\n' +
          directories.map((item) => `- ${item}`).join('\n')
      )
    }
    if (archives.length) {
      parts.push(
        'Attached archives (not uploaded and not readable directly; use list_archive or extract_archive):\n' +
          archives.map((item) => `- ${item}`).join('\n')
      )
    }
    if (skipped.length) {
      parts.push('Attached media skipped:\n' + skipped.map((item) => `- ${item}`).join('\n'))
    }
    return {
      media: resolved.media.length ? resolved.media : undefined,
      images: resolved.images.length ? resolved.images : undefined,
      note: parts.length ? '\n\n' + parts.join('\n') : ''
    }
  }

  private async mediaUploadSessionForProvider(providerId: string): Promise<AuthSession | null> {
    if (providerId.trim().toLowerCase() !== 'ai-crms') return null
    return await aiCrmsSession.getSession().catch(() => null)
  }

  private async routeAgentMessage(
    message: string,
    sessionId?: string,
    context?: AgentConversationContext,
    abortEpoch?: number,
    steeringOnly = false
  ): Promise<AgentReply> {
    await this.loadHostToolPolicies()
    const sessionKey = this.agentSessionKey(sessionId)
    this._state.syncWorkspaceFromContext(sessionKey, context?.workspace)
    const includeConversationMemory = !this.hydratedMaestroAgentSessions.has(sessionKey)
    const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)
    const isCancelled = (): boolean =>
      abortEpoch !== undefined && (this.agentAbortEpochs.get(sessionKey) ?? 0) !== abortEpoch
    return await this.handleAgentTurn(message, this.getMaestroAgent(sessionId), context, {
      includeConversationMemory,
      mediaInput,
      onAgentSessionUsed: () => this.hydratedMaestroAgentSessions.add(sessionKey),
      isCancelled,
      steeringOnly
    })
  }

  private async handleAgentTurn(
    message: string,
    agent: BaseAgent,
    context?: AgentConversationContext,
    options?: {
      includeConversationMemory?: boolean
      mediaInput?: {
        media?: AgentRuntimeMediaRef[]
        images?: AgentRuntimeImage[]
        note: string
      }
      onAgentSessionUsed?: () => void
      isCancelled?: () => boolean
      steeringOnly?: boolean
    }
  ): Promise<AgentReply> {
    const cancelledReply = (): AgentReply => ({
      ok: false,
      text: 'Stopped.',
      ts: Date.now(),
      error: 'aborted'
    })
    if (options?.isCancelled?.()) return cancelledReply()
    const steered = await agent.steerActiveTurn(message)
    if (options?.isCancelled?.()) return cancelledReply()
    if (steered.outcome === 'delivered') {
      return { ok: true, text: '', ts: Date.now(), mergedIntoTurn: true }
    }
    if (steered.outcome === 'failed') {
      return {
        ok: false,
        text: steered.error || 'Could not deliver the message into the active turn.',
        ts: Date.now(),
        error: 'steer-failed'
      }
    }
    if (options?.steeringOnly) {
      return {
        ok: false,
        text: STEER_NOT_STREAMING,
        ts: Date.now(),
        error: 'steer-failed'
      }
    }

    const services = this._state.ensureServices()
    const recordings = services.registry.listSkillsForDomain(this._state.currentUrl)
    const skillBriefs: AgentSkillBrief[] = recordings.map((skill) => {
      const recipe = services.registry.readRecipe(skill.id)
      const seed = recipe ? extractVariablesFromMessage(message, recipe) : {}
      const missing = recipe ? requiredInputNames(recipe).filter((name) => !seed[name]) : []
      return {
        id: skill.id,
        name: skill.name,
        triggers: skill.triggers,
        description: skill.description,
        inputs: skill.inputs,
        seed,
        missing
      }
    })

    for (const candidate of recordings) {
      const recipe = services.registry.readRecipe(candidate.id)
      if (!recipe) continue
      const seed = extractVariablesFromMessage(message, recipe)
      if (hasRequiredInputs(recipe) && requiredInputsSatisfied(recipe, seed)) {
        const replay = await this._state.replaySkill({
          skillId: candidate.id,
          variables: seed
        })
        return this.replayReply(candidate, replay)
      }
    }

    this.lastAgentRun = {}
    this.lastAgentArtifacts = []
    this.tabsOpenedThisTurn = []
    const turnMedia = options?.mediaInput || { note: '' }
    const runPrompt = async (): Promise<Awaited<ReturnType<BaseAgent['prompt']>>> =>
      await agent.prompt(
        buildAgentTurnPrompt({
          message,
          context,
          includeConversationMemory: Boolean(options?.includeConversationMemory),
          nowIso: new Date().toISOString(),
          currentUrl: this._state.currentUrl,
          briefs: skillBriefs
        }) + turnMedia.note,
        undefined,
        {
          freshSession: false,
          media: turnMedia.media,
          images: turnMedia.images
        }
      )

    if (options?.isCancelled?.()) return cancelledReply()
    let result = await runPrompt()
    if (options?.isCancelled?.()) return cancelledReply()
    let retriedAttempts = 0
    for (let attempt = 2; attempt <= MODEL_RETRY_MAX; attempt += 1) {
      const error = result.errorMessage || (result.ok ? '' : result.error || '')
      if (!error || !isTransientModelError(error)) break
      broadcastCodexDebug({
        scope: 'agent',
        phase: 'model-retry',
        level: 'warn',
        message: `retried: ${attempt}/${MODEL_RETRY_MAX}`,
        detail: {
          attempt,
          max: MODEL_RETRY_MAX,
          gapMs: MODEL_RETRY_GAP_MS,
          error: error.slice(0, 400)
        },
        ts: Date.now()
      })
      xpcMain.broadcast(MODEL_RETRY_CHANNEL, {
        attempt,
        max: MODEL_RETRY_MAX
      } satisfies ModelRetryProgress)
      retriedAttempts = attempt
      await new Promise((resolveDelay) => setTimeout(resolveDelay, MODEL_RETRY_GAP_MS))
      if (options?.isCancelled?.()) return cancelledReply()
      result = await runPrompt()
      if (options?.isCancelled?.()) return cancelledReply()
    }
    if (retriedAttempts > 0 && !result.errorMessage && result.ok) {
      xpcMain.broadcast(MODEL_RETRY_CHANNEL, {
        attempt: 0,
        max: MODEL_RETRY_MAX,
        recovered: true
      } satisfies ModelRetryProgress)
    }
    if (result.ok) options?.onAgentSessionUsed?.()
    const { skill, skills, replay } = this.lastAgentRun
    const files = this.lastAgentArtifacts.slice()
    if (!result.ok) {
      const error = result.error || 'Agent failed.'
      const retryExhausted = retriedAttempts && isTransientModelError(error)
        ? { attempt: retriedAttempts, max: MODEL_RETRY_MAX }
        : undefined
      return {
        ok: false,
        text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error),
        ts: Date.now(),
        skill,
        skills,
        replay,
        files,
        error: 'agent-failed',
        retryExhausted
      }
    }
    if (replay) {
      return {
        ok: replay.ok,
        text: result.text || (replay.ok ? '✓ Done.' : '✗ Failed.'),
        ts: Date.now(),
        skill,
        skills,
        replay,
        files,
        error: replay.ok ? undefined : 'replay-failed',
        authoredByModel: Boolean(result.text)
      }
    }
    const backend = `${providerLabel(this.activeLlmProvider)} (${this.activeLlmModel})`
    if (result.errorMessage) {
      const retryExhausted = retriedAttempts && isTransientModelError(result.errorMessage)
        ? { attempt: retriedAttempts, max: MODEL_RETRY_MAX }
        : undefined
      return {
        ok: false,
        text: describeModelError(
          this.activeLlmProvider,
          this.activeLlmModel,
          result.errorMessage,
          Boolean(retryExhausted)
        ),
        ts: Date.now(),
        skill,
        skills,
        files,
        error: 'model-error',
        retryExhausted
      }
    }
    if (result.text) {
      return {
        ok: true,
        text: result.text,
        ts: Date.now(),
        skill,
        skills,
        files
      }
    }
    const modelReturnedNothing = (result.toolCalls ?? 0) === 0 && !result.stopReason
    const text = modelReturnedNothing
      ? `${backend} returned an empty response (no text, no action). This usually means that subscription is rate-limited or temporarily unavailable — wait a bit and retry, or switch the model from the provider selector. It is not a problem with the skill or this page.`
      : `The assistant (${backend}) ended without acting (stop: ${result.stopReason || 'unknown'}, tools used: ${result.toolCalls ?? 0}). Try a clearer instruction, make sure the page is logged in, or re-record the skill if its steps no longer fit this page.`
    return {
      ok: false,
      text,
      ts: Date.now(),
      skill,
      skills,
      files,
      error: 'empty-agent-turn'
    }
  }

  async trainerMessage(params: {
    message: string
    sessionId?: string
    files?: { name: string; content: string }[]
  }): Promise<AgentReply> {
    const message = params.message.trim()
    if (!message) {
      return {
        ok: false,
        text: 'Empty message.',
        ts: Date.now(),
        error: 'empty-message'
      }
    }
    const services = this._state.ensureServices()
    await this._state.ensurePersistedCaptureRecordsLoaded()
    await this.loadHostToolPolicies()
    const trainer = this.getTrainerAgent(params.sessionId)
    this.lastTrainerRun = {}
    const files = (params.files || []).filter(
      (file) => file && file.name && typeof file.content === 'string'
    )
    const withFiles = files.length
      ? files.map((file) => `# Attached file: ${file.name}\n\n${file.content}`).join('\n\n') +
        `\n\n---\n\n${message}`
      : message
    const result = await trainer.prompt(
      buildTrainerTurnPrompt({
        message: withFiles,
        skills: services.registry.promptContext(this._state.currentUrl) || '(none)',
        recording: summarizeRecordsForTrainer(this._state.captureRecordsForAgent().records),
        currentUrl: this._state.currentUrl
      })
    )
    if (!result.ok) {
      const error = result.error || 'Trainer is unavailable.'
      return {
        ok: false,
        text: describeAgentPromptError(this.activeLlmProvider, this.activeLlmModel, error),
        ts: Date.now(),
        error: 'trainer-failed'
      }
    }
    const skill = this.lastTrainerRun.skill
    if (!skill && result.errorMessage) {
      return {
        ok: false,
        text: describeModelError(this.activeLlmProvider, this.activeLlmModel, result.errorMessage),
        ts: Date.now(),
        error: 'model-error'
      }
    }
    this._state.emitTrace({
      kind: 'info',
      msg: `trainer: ${skill ? `updated ${skill.name}` : 'reply'}`,
      ts: Date.now()
    })
    return {
      ok: true,
      text: result.text || 'OK.',
      ts: Date.now(),
      skill
    }
  }

  async resetTrainerConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    this.lastTrainerRun = {}
    this.getExistingTrainerAgent(params?.sessionId)?.reset()
    return { ok: true }
  }

  private buildTrainerTools(): PiToolSpec[] {
    return this.wrapHostTools('trainer', [
      this.buildHostToolCatalogTool('trainer'),
      ...this._state.buildCaptureAnalysisTools(),
      {
        name: 'get_skill_detail',
        description:
          "Read a skill's full detail (description, triggers, inputs, body) before deciding how to change it.",
        params: [
          {
            name: 'skill_id',
            required: true,
            description: 'Skill id from the existing-skills list.'
          }
        ],
        execute: async (args) => this._state.trainerToolDetail(String(args.skill_id ?? ''))
      },
      {
        name: 'create_or_update_skill',
        description:
          'Create a skill from the CURRENT RECORDING after inspecting capture evidence (or update the same-named skill — the previous version is archived automatically). guidance steers the name, triggers, and intent.',
        params: [
          {
            name: 'guidance',
            required: false,
            description: 'Operator goal/guidance steering the generated skill.'
          }
        ],
        execute: async (args) =>
          this._state.trainerToolCreate(typeof args.guidance === 'string' ? args.guidance : '')
      },
      {
        name: 'optimize_skill',
        description:
          "Refine an EXISTING skill's metadata/notes per guidance; the previous version is archived automatically.",
        params: [
          {
            name: 'skill_id',
            required: true,
            description: 'Skill id to optimize.'
          },
          {
            name: 'guidance',
            required: true,
            description: 'What to improve or change.'
          }
        ],
        execute: async (args) =>
          this._state.trainerToolOptimize(String(args.skill_id ?? ''), String(args.guidance ?? ''))
      },
      {
        name: 'delete_skill',
        description:
          'Delete an existing skill by id. Destructive — only when the user clearly asks for removal.',
        params: [
          {
            name: 'skill_id',
            required: true,
            description: 'Skill id to delete.'
          }
        ],
        execute: async (args) => this._state.trainerToolDelete(String(args.skill_id ?? ''))
      }
    ])
  }

  buildHostToolCatalogTool(scope: HostToolScope): PiToolSpec {
    return {
      name: 'host_tool_catalog',
      description:
        'Read the Coach host tool catalog for this agent: categories, when to use each tool, risk level, and safety boundaries. Use when unsure whether to observe, call API, drive UI, inspect capture, manage skills, or use workspace/file tools.',
      params: [
        {
          name: 'category',
          required: false,
          description:
            'Optional category filter: observe, act, api, capture, skill, workspace, file, tab, training.'
        },
        {
          name: 'query',
          required: false,
          description: 'Optional words to search in tool names/summaries/safety notes.'
        }
      ],
      execute: async (args) => this.toolHostToolCatalog(scope, args)
    }
  }

  private toolHostToolCatalog(scope: HostToolScope, args: Record<string, unknown>): string {
    const payload = readHostToolCatalog({
      scope,
      category: args.category ? String(args.category) : '',
      query: args.query ? String(args.query) : '',
      policies: this.hostToolPolicies
    })
    broadcastAgentActivity('tool', `read host_tool_catalog (${payload.tools.length})`)
    return JSON.stringify(payload, null, 2)
  }

  wrapHostTools(scope: HostToolScope, tools: PiToolSpec[]): PiToolSpec[] {
    const registry = new HostToolRegistry({
      scope,
      policies: this.hostToolPolicies,
      onConfirm: (request) => this.confirmHostToolCall(request),
      onWarning: (message, detail) =>
        this._state.emitTrace({
          kind: 'info',
          msg: `host tool registry: ${message} ${JSON.stringify(detail || {})}`,
          ts: Date.now()
        })
    })
    registry.add(...tools)
    return registry.toRuntimeTools()
  }

  private async confirmHostToolCall(request: HostToolConfirmRequest): Promise<boolean> {
    const argsSummary = summarizeApprovalArgs(request.args)
    const detail = clipHostApprovalDetail(
      JSON.stringify(
        {
          scope: request.scope,
          toolName: request.toolName,
          args: argsSummary
        },
        null,
        2
      )
    )
    const eventId = await this.pushHostApprovalEvent({
      kind: 'tool',
      status: 'pending',
      label: request.toolName,
      detail: argsSummary,
      scope: request.scope,
      toolName: request.toolName
    })
    broadcastAgentActivity('tool', `awaiting approval: ${request.toolName}`)
    broadcastCodexDebug({
      scope: 'agent',
      phase: 'tool-confirm',
      level: 'info',
      message: `Awaiting approval for ${request.toolName}.`,
      detail: {
        toolName: request.toolName,
        toolScope: request.scope,
        args: argsSummary
      },
      ts: Date.now()
    })
    const allowed = await taskRegistry.askOperator({
      name: 'tool-approval',
      title: `Allow the agent to run ${request.toolName}?`,
      detail,
      confirmLabel: 'Allow once',
      cancelLabel: 'Deny',
      payload: buildUnknownConfirmPayload({
        summary: `${request.scope} · ${request.toolName}`,
        body: { args: argsSummary }
      })
    })
    await this.resolveHostApprovalEvent(eventId, allowed ? 'approved' : 'denied')
    broadcastAgentActivity(
      'tool',
      `${allowed ? 'approved' : 'denied'}: ${request.toolName}`,
      allowed
    )
    broadcastCodexDebug({
      scope: 'agent',
      phase: allowed ? 'tool-confirmed' : 'tool-denied',
      level: allowed ? 'info' : 'warn',
      message: `${request.toolName} ${allowed ? 'approved' : 'denied'} by operator.`,
      detail: {
        toolName: request.toolName,
        toolScope: request.scope
      },
      ts: Date.now()
    })
    return allowed
  }

  async pushHostApprovalEvent(
    event: Omit<HostApprovalEvent, 'id' | 'requestedAt'>
  ): Promise<string> {
    await this.loadHostApprovalHistory()
    const item = this.hostApprovalHistory.push(event)
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', item)
    return item.id
  }

  async resolveHostApprovalEvent(id: string, status: HostApprovalEvent['status']): Promise<void> {
    await this.loadHostApprovalHistory()
    const item = this.hostApprovalHistory.resolve(id, status)
    if (!item) return
    await this.saveHostApprovalHistory()
    xpcMain.broadcast('coach/host-approval', item)
  }

  private replayReply(skill: SkillSummary, replay: ReplayResult, note?: string): AgentReply {
    const detail =
      replay.mode === 'api'
        ? ` (${replay.apiCalls || 0} API call${replay.apiCalls === 1 ? '' : 's'})`
        : ''
    const text = replay.ok
      ? [note, `✓ Done — ${skill.name}${detail}.`].filter(Boolean).join('\n')
      : `✗ Couldn't run ${skill.name}:\n${replay.errors.join('\n')}`
    return {
      ok: replay.ok,
      text,
      ts: Date.now(),
      skill,
      skills: [skill],
      replay,
      error: replay.ok ? undefined : 'replay-failed'
    }
  }
}

const describeModelError = (
  provider: string,
  model: string,
  errorMessage: string,
  retried = false
): string => {
  const head = `${providerLabel(provider)} (${model}) rejected the request: ${errorMessage}`
  if (/blocked|cloudflare|html error page|unreachable/i.test(errorMessage)) {
    return (
      head +
      '\n\nThe request was blocked or the provider is unreachable from this network. Check your proxy/VPN route to ' +
      'OpenAI (Codex is geo-restricted in some regions), then retry.'
    )
  }
  return retried
    ? head
    : head +
        '\n\nRetry once the provider is available, or check that the app is signed in to this provider.'
}

const describeAgentPromptError = (
  provider: string,
  model: string,
  errorMessage: string
): string => {
  const backend = `${providerLabel(provider)} (${model})`
  if (
    /not signed in|auth file|missing provider|no provider credentials|credential/i.test(
      errorMessage
    )
  ) {
    return `${backend} is not ready for this turn.\n\n${errorMessage}\n\nOpen AI Login for this provider, or switch to a provider/model that shows as signed in.`
  }
  if (/session start timed out/i.test(errorMessage)) {
    return (
      `${backend} did not finish starting within the timeout.\n\n` +
      'This usually means the coding-agent auth check or token refresh is stuck. The app now stops the turn instead of spinning forever. ' +
      'Open AI Login for this provider, then retry; if you were already logged in, the auth file may be in an older Maestro/Coach userData directory or the provider token may be expired.\n\n' +
      errorMessage
    )
  }
  if (/timed out/i.test(errorMessage)) {
    return (
      `${backend} timed out while handling the request.\n\n` +
      'The turn was stopped so the chat bubble will not keep spinning. Retry with a smaller recording, switch provider/model, or check whether the provider is reachable from this network.\n\n' +
      errorMessage
    )
  }
  return errorMessage
}

const clipHostApprovalDetail = (text: string): string => {
  if (text.length <= 4_000) return text
  return text.slice(0, 4_000) + `\n...[truncated ${text.length - 4_000} chars]`
}
