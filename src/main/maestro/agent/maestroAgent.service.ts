import { clipboard, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
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
  AgentMessageRequest,
  AgentReply,
  AgentTurnClaimRequest,
  AgentTurnClaimResult,
  AgentTurnFinished,
  AgentTurnRecoverySnapshot,
  AgentTurnSnapshot,
  AgentTurnUpdate,
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
import { AGENT_TURN_CHANNEL, MODEL_RETRY_CHANNEL, type ModelRetryProgress } from '@maestro-shared/coach.api'
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
const AGENT_TURN_RESERVATION_TIMEOUT_MS = 3 * 60_000
const FINISHED_AGENT_TURN_TTL_MS = 30 * 60_000
const MAX_RECENT_FINISHED_AGENT_TURNS = 20

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

interface ActiveAgentTurn extends AgentTurnSnapshot {
  generation: number
  rootStarted: boolean
  rootStartPromise: Promise<boolean>
  resolveRootStart: (started: boolean) => void
  reservationTimer: ReturnType<typeof setTimeout> | undefined
}

type AgentTurnIdentity = Pick<AgentTurnSnapshot, 'sessionId' | 'turnId' | 'generation'>

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
  /**
   * Main-process source of truth for the one global Maestro root Turn. The renderer must claim this
   * slot before workspace/attachment/compaction awaits, so a second message can only be steering.
   */
  private activeAgentTurn: ActiveAgentTurn | null = null
  private agentTurnGeneration = 0
  /**
   * Captures the exact Turn generation around the complete async tool loop. Direct activity emitted
   * by nested services must use this identity instead of looking up whichever Turn happens to be
   * active when an old async operation eventually returns.
   */
  private readonly agentTurnContext = new AsyncLocalStorage<AgentTurnIdentity>()
  private agentTurnRevision = 0
  private readonly recentFinishedAgentTurns = new Map<
    string,
    { finished: AgentTurnFinished; expiresAt: number }
  >()

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
          onDebug: broadcastCodexDebug
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
          onActivity: (step) => this.relayAgentActivity('default', step),
          onThinking: (state) => this.relayAgentThinking('default', state),
          onStream: (delta) => this.relayAgentStream('default', delta)
        })
      )
    }
    if (!this.piTrainer) {
      this.piTrainer = this.configureAgent(
        new CoachAgent({
          buildTools: () => this.buildTrainerTools(),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug
        })
      )
    }
    if (!this.piDelegate) {
      this.piDelegate = this.configureAgent(
        new DelegateAgent({
          buildTools: () => this._state.buildPiTools({ sessionKey: 'default' }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          onDebug: broadcastCodexDebug
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
    const targetChanged =
      provider !== this.activeLlmProvider ||
      model !== this.activeLlmModel ||
      effort !== this.activeLlmEffort
    if (targetChanged && this.activeAgentTurn) {
      throw new Error('The model cannot be changed while a Maestro turn is active.')
    }
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
    const activeTurn = this.activeAgentTurn
    if (activeTurn) {
      activeTurn.state = 'aborting'
      if (activeTurn.reservationTimer) clearTimeout(activeTurn.reservationTimer)
      activeTurn.reservationTimer = undefined
      activeTurn.resolveRootStart(false)
      this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(activeTurn) })
    }
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
    if (activeTurn) this.finishAgentTurn(activeTurn, 'stopped')
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

  claimAgentTurn(params: AgentTurnClaimRequest): AgentTurnClaimResult {
    const sessionId = this.agentSessionKey(params.sessionId)
    const turnId = params.turnId.trim()
    const rootText = params.rootText.trim()
    if (!turnId || !rootText) {
      throw new Error('A Maestro Turn requires a turnId and root text.')
    }

    const current = this.activeAgentTurn
    if (current) {
      const sameTurn = current.sessionId === sessionId && current.turnId === turnId
      return {
        ok: sameTurn,
        turn: this.agentTurnSnapshot(current),
        reason: sameTurn ? undefined : current.sessionId === sessionId ? 'busy-here' : 'busy-elsewhere'
      }
    }

    let resolveRootStart: (started: boolean) => void = () => undefined
    const rootStartPromise = new Promise<boolean>((resolveStart) => {
      resolveRootStart = resolveStart
    })
    const turn: ActiveAgentTurn = {
      sessionId,
      operationTabId: params.operationTabId,
      turnId,
      rootText,
      startedAt: Number.isFinite(params.startedAt) ? params.startedAt : Date.now(),
      state: 'reserved',
      generation: ++this.agentTurnGeneration,
      rootStarted: false,
      rootStartPromise,
      resolveRootStart,
      reservationTimer: undefined
    }
    turn.reservationTimer = setTimeout(() => {
      if (this.activeAgentTurn !== turn || turn.rootStarted) return
      this.finishAgentTurn(turn, 'reservation-expired')
    }, AGENT_TURN_RESERVATION_TIMEOUT_MS)
    this.activeAgentTurn = turn
    this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(turn) })
    return { ok: true, turn: this.agentTurnSnapshot(turn) }
  }

  getActiveAgentTurn(): AgentTurnRecoverySnapshot {
    this.pruneFinishedAgentTurns()
    return {
      revision: this.agentTurnRevision,
      turn: this.activeAgentTurn ? this.agentTurnSnapshot(this.activeAgentTurn) : null,
      finished: [...this.recentFinishedAgentTurns.values()].map((record) => record.finished)
    }
  }

  ackAgentTurnFinished(params: { sessionId: string; turnId: string }): void {
    this.recentFinishedAgentTurns.delete(this.agentTurnKey(params.sessionId, params.turnId))
  }

  hasActiveAgentTurn(): boolean {
    return Boolean(this.activeAgentTurn)
  }

  private agentTurnSnapshot(turn: ActiveAgentTurn): AgentTurnSnapshot {
    return {
      sessionId: turn.sessionId,
      operationTabId: turn.operationTabId,
      turnId: turn.turnId,
      generation: turn.generation,
      rootText: turn.rootText,
      startedAt: turn.startedAt,
      state: turn.state
    }
  }

  private activeTurnFor(sessionId: string, turnId: string): ActiveAgentTurn | null {
    const active = this.activeAgentTurn
    return active?.sessionId === sessionId && active.turnId === turnId ? active : null
  }

  private broadcastAgentTurn(update: Omit<AgentTurnUpdate, 'revision'>): void {
    const versioned: AgentTurnUpdate = { ...update, revision: ++this.agentTurnRevision }
    if (versioned.finished) {
      const key = this.agentTurnKey(versioned.finished.turn.sessionId, versioned.finished.turn.turnId)
      this.recentFinishedAgentTurns.delete(key)
      this.recentFinishedAgentTurns.set(key, {
        finished: versioned.finished,
        expiresAt: Date.now() + FINISHED_AGENT_TURN_TTL_MS
      })
      this.pruneFinishedAgentTurns()
    }
    xpcMain.broadcast(AGENT_TURN_CHANNEL, versioned)
  }

  private finishAgentTurn(
    turn: ActiveAgentTurn,
    reason: AgentTurnFinished['reason'],
    reply?: AgentReply
  ): void {
    if (this.activeAgentTurn !== turn) return
    const snapshot = this.agentTurnSnapshot(turn)
    if (turn.reservationTimer) clearTimeout(turn.reservationTimer)
    turn.reservationTimer = undefined
    turn.resolveRootStart(false)
    this.activeAgentTurn = null
    this.broadcastAgentTurn({
      turn: null,
      finished: { turn: snapshot, reason, reply }
    })
  }

  private agentTurnKey(sessionId: string, turnId: string): string {
    return `${sessionId}\u0000${turnId}`
  }

  private pruneFinishedAgentTurns(): void {
    const now = Date.now()
    for (const [key, record] of this.recentFinishedAgentTurns) {
      if (record.expiresAt <= now) this.recentFinishedAgentTurns.delete(key)
    }
    while (this.recentFinishedAgentTurns.size > MAX_RECENT_FINISHED_AGENT_TURNS) {
      const oldest = this.recentFinishedAgentTurns.keys().next().value as string | undefined
      if (!oldest) break
      this.recentFinishedAgentTurns.delete(oldest)
    }
  }

  async sendAgentMessage(params: AgentMessageRequest): Promise<AgentReply> {
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
    const turn = this.activeTurnFor(sessionKey, params.turnId)
    if (!turn || turn.state === 'aborting') {
      return {
        ok: false,
        text: 'This Maestro turn is no longer active.',
        ts: Date.now(),
        error: 'turn-not-active'
      }
    }

    const root = params.intent === 'root'
    if (root) {
      if (turn.rootStarted) {
        return {
          ok: false,
          text: 'This Maestro root turn has already started.',
          ts: Date.now(),
          error: 'duplicate-root-turn'
        }
      }
      turn.rootStarted = true
      turn.state = 'running'
      if (turn.reservationTimer) clearTimeout(turn.reservationTimer)
      turn.reservationTimer = undefined
      turn.resolveRootStart(true)
      this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(turn) })
    } else if (!turn.rootStarted) {
      const started = await turn.rootStartPromise
      if (!started || this.activeTurnFor(sessionKey, params.turnId) !== turn || turn.state === 'aborting') {
        return {
          ok: false,
          text: 'The root turn ended before this message could be added.',
          ts: Date.now(),
          error: 'steer-failed'
        }
      }
    }

    let reply: AgentReply
    try {
      await this._state.ensurePersistedCaptureRecordsLoaded()
      reply = await this.routeAgentMessage(
        message,
        params.sessionId,
        params.context,
        turn,
        !root
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
      if (root) this.finishAgentTurn(turn, 'completed', reply)
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

  async abortAgent(params: { sessionId: string; turnId: string }): Promise<void> {
    const sessionKey = this.agentSessionKey(params.sessionId)
    const turn = this.activeTurnFor(sessionKey, params.turnId)
    if (!turn || turn.state === 'aborting') return
    turn.state = 'aborting'
    if (turn.reservationTimer) clearTimeout(turn.reservationTimer)
    turn.reservationTimer = undefined
    turn.resolveRootStart(false)
    this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(turn) })
    this.hydratedMaestroAgentSessions.delete(sessionKey)
    taskRegistry.cancelTransient('active turn stopped')
    try {
      await this.getExistingMaestroAgent(params.sessionId)?.abort()
    } finally {
      this.finishAgentTurn(turn, 'stopped')
    }
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

  private agentTurnIdentity(sessionKey: string): AgentTurnIdentity | null {
    const turn = this.activeAgentTurn
    if (!turn || turn.sessionId !== sessionKey || turn.state !== 'running') return null
    return { sessionId: turn.sessionId, turnId: turn.turnId, generation: turn.generation }
  }

  private relayAgentActivity(sessionKey: string, step: AgentActivityStep): void {
    const identity = this.agentTurnIdentity(sessionKey)
    if (identity) broadcastAgentActivity(step.phase, step.label, step.ok, identity)
  }

  private relayAgentThinking(sessionKey: string, state: Omit<AgentThinkingState, 'sessionId'>): void {
    const identity = this.agentTurnIdentity(sessionKey)
    if (identity) broadcastAgentThinking(identity, state)
  }

  private relayAgentStream(sessionKey: string, delta: string): void {
    const identity = this.agentTurnIdentity(sessionKey)
    if (identity) broadcastAgentStream(identity, delta)
  }

  broadcastActiveAgentActivity(phase: AgentActivityStep['phase'], label: string, ok = true): void {
    const identity = this.agentTurnContext.getStore()
    if (!identity) return
    const active = this.activeAgentTurn
    if (
      !active ||
      active.state !== 'running' ||
      active.sessionId !== identity.sessionId ||
      active.turnId !== identity.turnId ||
      active.generation !== identity.generation
    ) {
      return
    }
    broadcastAgentActivity(phase, label, ok, identity)
  }

  private broadcastModelRetry(progress: Pick<ModelRetryProgress, 'attempt' | 'max' | 'recovered'>): void {
    const identity = this.agentTurnContext.getStore()
    if (!identity) return
    const active = this.activeAgentTurn
    if (
      !active ||
      active.state !== 'running' ||
      active.sessionId !== identity.sessionId ||
      active.turnId !== identity.turnId ||
      active.generation !== identity.generation
    ) {
      return
    }
    xpcMain.broadcast(MODEL_RETRY_CHANNEL, { ...identity, ...progress } satisfies ModelRetryProgress)
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
          onActivity: (step) => this.relayAgentActivity(key, step),
          onThinking: (state) => this.relayAgentThinking(key, state),
          onStream: (delta) => this.relayAgentStream(key, delta)
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
          onDebug: broadcastCodexDebug
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
          onDebug: broadcastCodexDebug
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
        this.broadcastActiveAgentActivity(
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
      this.broadcastActiveAgentActivity(
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
    turn?: ActiveAgentTurn,
    steeringOnly = false
  ): Promise<AgentReply> {
    const sessionKey = this.agentSessionKey(sessionId)
    const isCancelled = (): boolean =>
      Boolean(
        turn &&
          (this.activeTurnFor(sessionKey, turn.turnId) !== turn || turn.state === 'aborting')
      )
    if (!turn) {
      return {
        ok: false,
        text: 'This Maestro turn is no longer active.',
        ts: Date.now(),
        error: 'turn-not-active'
      }
    }
    const identity: AgentTurnIdentity = {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      generation: turn.generation
    }
    return await this.agentTurnContext.run(identity, async () => {
      await this.loadHostToolPolicies()
      this._state.syncWorkspaceFromContext(sessionKey, context?.workspace)
      const includeConversationMemory = !this.hydratedMaestroAgentSessions.has(sessionKey)
      const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)
      if (isCancelled()) {
        return {
          ok: false,
          text: '',
          ts: Date.now(),
          error: 'turn-aborted'
        }
      }
      return await this.handleAgentTurn(message, this.getMaestroAgent(sessionId), context, {
        includeConversationMemory,
        mediaInput,
        onAgentSessionUsed: () => this.hydratedMaestroAgentSessions.add(sessionKey),
        isCancelled,
        steeringOnly
      })
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
    const steered = await agent.steerActiveTurn(message, Boolean(options?.steeringOnly))
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
      // A whole-turn retry after any tool ran can repeat writes or external side effects. Leave
      // recovery to an explicit user retry, which preserves the completed tool evidence.
      if ((result.toolCalls ?? 0) > 0) break
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
      this.broadcastModelRetry({
        attempt,
        max: MODEL_RETRY_MAX
      })
      retriedAttempts = attempt
      await new Promise((resolveDelay) => setTimeout(resolveDelay, MODEL_RETRY_GAP_MS))
      if (options?.isCancelled?.()) return cancelledReply()
      result = await runPrompt()
      if (options?.isCancelled?.()) return cancelledReply()
    }
    if (retriedAttempts > 0 && !result.errorMessage && result.ok) {
      this.broadcastModelRetry({
        attempt: 0,
        max: MODEL_RETRY_MAX,
        recovered: true
      })
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
    this.broadcastActiveAgentActivity('tool', `read host_tool_catalog (${payload.tools.length})`)
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
    this.broadcastActiveAgentActivity('tool', `awaiting approval: ${request.toolName}`)
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
    this.broadcastActiveAgentActivity(
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
