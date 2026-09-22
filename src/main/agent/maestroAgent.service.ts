import { createArchive } from '@main/maestro/files/archive.service';
import { agentDecisionRegistry } from '@main/agent/decisionRegistry.service';
import { skillAuthoringRuntime } from './runtime/skillAuthoring'
import { workflowLibraryRuntime } from '@main/workflowLibrary/workflowLibraryRuntime';
import { applicationAuth } from '@main/auth/applicationAuth.service';
import { ensureDefaultWorkspace } from '@maestro-main/files/defaultWorkspace'
import { skillCloud } from '@maestro-main/skills/skillCloud.runtime'
import { selectedSkillPrompt } from '@maestro-main/skills/skillSelection'
import { onSkillContextChanged, skillScopeContext, assertSkillContext } from '@maestro-main/skills/skillScope.context'
import { workflowCompletionId, workflowCompletionContext } from './workflowEngine/completion'
import { workflowWaitContinuationText } from './workflowEngine/workflowWait'
import { SessionIoInitialization } from './sessionIoInitialization'
import { WorkflowHostIntegration } from './workflowEngine/hostIntegration'
import { buildWebSearchTools } from './tools/webSearchTools'
import { buildWebFetchTools } from './tools/webFetchTools'
import { readProjectInstructions } from './prompt/projectInstructions'
import { isAbsolute } from 'node:path'
import { app, clipboard, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { createHash, randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { basename, extname, join, resolve, sep } from 'path'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { fetch } from 'undici'
import { injectable } from 'inversify'
import { i18nHelper } from '@main/i18n/i18n.helper'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { BaseAgent, type PiToolSpec } from '@main/agent/BaseAgent'
import { TurnSteeringInbox } from './steering/turnSteeringInbox'
import { buildContextRecord, contextEntriesOfSurface, entriesOfSurface, renderContextText } from '@main/agent/contextExport.service'
import { buildContextGraph } from '@main/agent/contextGraph.service'
import { assertContextTextSize } from './runtime/contextExportLimit.service'
import { A7_DISCIPLINE, BASE_SYSTEM_PROMPT } from './prompt/sysPrompt'
import type {
  ContextExportRequest,
  ContextExportSummary,
  ContextGraphRequest,
  ContextGraphResult,
  SessionIoPathResult, SessionIoExportResult, SessionIoExportTarget } from '@maestro-shared/coach.api'
import { MaestroAgent } from '@main/agent/MaestroAgent'
import { DelegateAgent } from '@main/agent/DelegateAgent'
import { readHostToolCatalog } from '@main/agent/hostToolCatalog'
import { DEEP_FETCH_BUILTIN_SKILL } from '@main/agent/deepFetch.skill'
import { RELOAD_SKILLS_BUILTIN_SKILL } from '@main/agent/reloadSkills.skill'
import { DRILL_BUILTIN_SKILL } from '@main/agent/drill.skill'
import { extractVariablesFromMessage } from '@main/agent/naturalLanguageVariables'
import {
  hasRequiredInputs,
  requiredInputNames,
  requiredInputsSatisfied
} from '@maestro-main/skills/skillContract.helper'
import type {
  AgentRuntimeImage,
  AgentRuntimeMediaRef
} from '@main/agent/runtime/agentRuntime.types'
import { HostApprovalHistory } from '@main/agent/runtime/hostApprovalHistory'
import {
  HostToolRegistry,
  type HostToolConfirmRequest
} from '@main/agent/runtime/hostToolRegistry'
import {
  mediaTransportForProvider,
  resolveRuntimeMediaRefs
} from '@main/agent/runtime/mediaRefResolver'
import { sanitizeRuntimeError } from '@main/agent/runtime/errorSanitizer'
import { usageLedger } from '@main/agent/runtime/usageLedger'
import { currentAgentRun, runInAgentSession } from './runtime/agentSessionContext'
import {
  broadcastAgentActivity,
  broadcastAgentStream,
  broadcastAgentThinking,
  broadcastCodexDebug
} from '@main/agent/runtime/agentBroadcast'
import {
  AGENT_IMAGE_MIME_BY_EXT,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_MEDIA_REFS,
  MAX_ATTACHMENT_BYTES,
  agentMediaMimeForPath,
  buildAgentTurnPrompt,
  buildSessionSkillGuidance,
  buildConversationCompactPrompt,
  describeActiveTabLine,
  localNow,
  normalizeCompactSummary,
  normalizeHostToolPolicies,
  normalizeHostToolPolicyMode,
  safeUrlForDebug,
  summarizeApprovalArgs,
  type AgentSkillBrief
} from '@main/agent/runtime/agentPrompt'
import type { CaptureRecordSource } from '@maestro-main/capture/captureRecordSource'
import {
  MAX_ARCHIVE_ATTACHMENT_BYTES,
  isArchivePath
} from '@maestro-main/files/archive.service'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { buildUnknownConfirmPayload } from '@maestro-main/drive/confirmPayload'
import { taskRegistry } from '@maestro-main/tasks/taskRegistry.service'
import { modelIoLog } from './runtime/modelIoLog'
import { maestroAgentDir, maestroAuthPath, maestroLongPasteDir, maestroModelsPath, maestroUserChainDir } from '@maestro-main/llm/llmPaths'
import { appendUserChainRecord, chainFilePath, ensureSessionChainFile } from './userChainStore.service'
import { offloadLongPaste } from './longPaste.service'
import { describeLlmTarget, providerLabel, type LlmStoredTarget } from '@maestro-main/llm/llmModels'
import { PiRuntimeAdapter } from './runtime/piRuntimeAdapter'
import { uploadMediaRefsForProvider } from '@maestro-main/networking/api/mediaUpload.api'
import type { SkillGeneratorService } from '@maestro-main/skills/skillGenerator.service'
import type { SkillRegistryService } from '@maestro-main/skills/skillRegistry.service'
import type {
  AgentActivityStep,
  AgentCompactReply,
  AgentCompactRequest,
  AgentConversationContext,
  AgentBrowserSessionState,
  AgentFileArtifact,
  AgentMessageRequest,
  AgentReply,
  AgentTurnClaimRequest,
  AgentTurnClaimResult,
  AgentTurnFinished,
  AgentTurnRecoverySnapshot,
  AgentTurnSnapshot,
  AgentTurnUpdate,
  AgentThinkingState,
  AttachFileResult,
  HostApprovalEvent,
  HostApprovalExportResult,
  HostApprovalHistoryResult,
  HostToolCatalogResult,
  HostToolPolicyMap,
  HostToolPolicyMode,
  HostToolPolicyResult,
  ActiveTabContent,
  AgentWindowTabSnapshot,
  HostToolScope,
  LlmEffort,
  ReplayResult,
  SkillSummary,
  TabInfo,
  WorkspaceRef
} from '@maestro-shared/coach.api'
import { AGENT_TURN_CHANNEL, MODEL_RETRY_CHANNEL, type ModelRetryProgress } from '@maestro-shared/coach.api'
import {
  HOST_APPROVAL_HISTORY_KEY,
  HOST_TOOL_CONFIG_DOMAIN,
  HOST_TOOL_POLICY_KEY,
  type ConfigApi
} from '@maestro-shared/config.api'
import type { TraceEvent } from '@maestro-shared/trace.types'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

const MODEL_RETRY_MAX = 5
const MODEL_RETRY_GAP_MS = 3_000
const AGENT_TURN_RESERVATION_TIMEOUT_MS = 3 * 60_000
const FINISHED_AGENT_TURN_TTL_MS = 30 * 60_000
const MAX_RECENT_FINISHED_AGENT_TURNS = 20
const MAX_CONCURRENT_AGENT_TURNS = 4

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


/**
 * SDK `BaseAgent` 的两个**必填端口**。两个都刻意没有默认值 —— 见
 * `@main/agent/BaseAgent` 里 `BaseAgentOptions.runtime` / `describeTarget` 的注释:
 * 给默认值等于让宿主"忘了传"也能编译过,于是 agent 又静默分叉一次。
 *
 * 每个 agent 一个 `PiRuntimeAdapter`,不共享。
 *
 * **2026-09-10 拆掉了中间那层 `CoachRuntimeAdapter`。** 它是 21 行的纯转发:
 * 持有一个 `new PiRuntimeAdapter()`,`select()` 恒返回它。保留它的理由曾是
 * 「下一个非 pi 运行时接回来的接缝」—— 但 2026-09 AI-CRMS 退役后只剩 pi 一条路,
 * 那是**为一个不存在的第二条路付抽象税**,而且税是实的:每次给会话加一个入参
 * (比如 A1 要往下传的 `resourceLoader`),这一层都得跟着改一次签名,纯过路费。
 * 真要接第二个运行时时再加回来 —— **那时才知道接缝该长什么样,现在这个形状是猜的。**
 */
const agentPorts = (): { runtime: PiRuntimeAdapter; describeTarget: typeof describeLlmTarget } => ({
  runtime: new PiRuntimeAdapter(),
  describeTarget: describeLlmTarget
})

export interface MaestroAgentServiceState {
  readMaestroSettings(): import('@maestro-shared/coach.api').CoachSettings
  browserWindow: BrowserWindow | null
  activeTabId: string | null
  currentUrl: string
  /** D3 and D4 are one synchronous snapshot of the user-facing window tabs. */
  describeWindowTabs(): AgentWindowTabSnapshot
  beginBrowserTurn(sessionId: string, tabId?: string): void
  endBrowserTurn(sessionId: string): void
  agentBrowserSession(sessionId: string): AgentBrowserSessionState

  ensureServices(): MaestroAgentRuntimeServices
  existingSkillRegistry(): SkillRegistryService | null
  buildPiTools(opts?: { ingest?: boolean; sessionKey?: string }): PiToolSpec[]
  buildCaptureAnalysisTools(): PiToolSpec[]
  ensurePersistedCaptureRecordsLoaded(): Promise<void>
  captureRecordsForAgent(): CaptureRecordSource
  replaySkill(params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  replayAgentSkill(sessionId: string, params: { skillId: string; variables: Record<string, string> }): Promise<ReplayResult>
  syncWorkspaceFromContext(sessionKey: string, workspace?: WorkspaceRef): void
  projectRootForSession(sessionKey: string): string | undefined
  emitTrace(event: TraceEvent): void
}

export interface MaestroAgentInstances {
  pi: MaestroAgent
  piDelegate: DelegateAgent
  piGen: BaseAgent
}

interface ActiveAgentTurn extends AgentTurnSnapshot {
  continuationOf?: string
  generation: number
  rootStarted: boolean
  steeringInbox: TurnSteeringInbox
  finished: Promise<AgentTurnFinished>
  resolveFinished: (finished: AgentTurnFinished) => void
  rootStartPromise: Promise<boolean>
  resolveRootStart: (started: boolean) => void
  reservationTimer: ReturnType<typeof setTimeout> | undefined
}

type AgentTurnIdentity = Pick<AgentTurnSnapshot, 'sessionId' | 'turnId' | 'generation'>


@injectable()
export class MaestroAgentService extends CommonService<MaestroAgentServiceState> {
  private readonly stopSkillContextListener = onSkillContextChanged(() => {
    for (const turn of this.activeAgentTurns.values()) {
      turn.steeringInbox.cancel('Skill institution changed')
      turn.state = 'aborting'
      turn.resolveRootStart(false)
    }
    this.resetAgentSessions()
    this.lastAgentRun = {}
  })

  private workflowHost: WorkflowHostIntegration | null = null

  getWorkflowHost(): WorkflowHostIntegration {
    this.assertAgentRuntimeActive()
    if (!this.workflowHost) this.workflowHost = new WorkflowHostIntegration({
      broadcast: (snapshot) => xpcMain.broadcast('agent/workflows', snapshot),
      onRunSettled: async run => {
        const agent = this.getExistingMaestroAgent(run.sessionId)
        agent?.retainBackgroundContext(workflowCompletionId(run), workflowCompletionContext(run))
      },
      onWaitSatisfied: async ({ sessionId, runs }) => {
        // The outcomes already reached this chat's background context above; this only re-enters the
        // model loop. If the chat is busy, do nothing: the user's own turn wins and still gets them.
        const turnId = randomUUID()
        const rootText = workflowWaitContinuationText(runs)
        let claim: AgentTurnClaimResult
        try {
          claim = this.claimAgentTurn({ sessionId, turnId, rootText, startedAt: Date.now(), hostAuthored: true })
        } catch (error) {
          console.warn('[workflow] chat continuation not claimed', sessionId, String(error))
          return
        }
        if (!claim.ok) return
        try {
          await this.sendAgentMessage({ sessionId, turnId, intent: 'root', message: rootText })
        } catch (error) {
          console.warn('[workflow] chat continuation failed', sessionId, String(error))
        }
      },
      assertCanStartShortcut: (sessionId, otherWorkflowSessions) => {
        this.assertAgentRuntimeActive()
        // Background workflows do not reserve an ordinary chat turn.
        void sessionId; void otherWorkflowSessions
      },
      runtime: async (sessionId, requestedCwd) => {
        await this.loadHostToolPolicies()
        const cwd = requestedCwd || this._state.projectRootForSession(sessionId)
        if (!cwd || !isAbsolute(cwd)) throw new Error('Select a project workspace before starting a workflow.')
        if (!statSync(cwd).isDirectory()) throw new Error('The selected workflow workspace is not a directory.')
        const providerId = this.activeLlmProvider
        const modelId = this.activeLlmModel
        if (!providerId || !modelId) throw new Error('Select a provider and model before starting a workflow.')
        return {
          cwd, providerId, modelId, thinkingLevel: this.activeLlmEffort === 'default' ? 'low' : this.activeLlmEffort,
          authPath: maestroAuthPath(), modelsPath: maestroModelsPath(), agentDir: maestroAgentDir(),
          systemPrompt: ['You are a workflow Agent. Complete only your assigned task with the enabled tools. Do not recursively delegate. Report evidence and limitations concisely.', await readProjectInstructions(cwd), A7_DISCIPLINE,
            'You are a workflow subagent inside Bitterless. Report verifiable findings for your assigned task. Browser, recorded-skill, and integration tools are unavailable in this workflow runtime; report missing evidence explicitly.']
            .filter(Boolean).join('\n\n')
        }
      },
      // A cheap, tool-free sentence for the chat status bar; the same short-job model as titles.
      activity: {
        runtime: new PiRuntimeAdapter(),
        target: () => ({
          providerId: 'openai-codex', modelId: 'gpt-5.6-luna', thinkingLevel: 'low',
          authPath: maestroAuthPath(), modelsPath: maestroModelsPath(), agentDir: maestroAgentDir()
        })
      },
      tools: (signal, onApproval, sessionId) => {
        const registry = new HostToolRegistry({
          scope: 'cowork', policies: this.hostToolPolicies,
          onConfirm: async (request) => {
            onApproval?.(true)
            try { return await this.confirmHostToolCall(request, signal, sessionId) }
            finally { onApproval?.(false) }
          }
        })
        registry.add(...buildWebSearchTools(signal), ...buildWebFetchTools(undefined, signal).filter((tool) => tool.name === 'web_fetch'))
        return registry.toRuntimeTools()
      }
    })
    return this.workflowHost
  }

  workflowTools(sessionId: string): PiToolSpec[] { return this.getWorkflowHost().chatTools(sessionId) }

  async shutdownWorkflows(): Promise<void> {
    this.stopSkillContextListener()
    await this.workflowHost?.dispose()
    this.workflowHost = null
  }

  private pi: MaestroAgent | null = null
  private piDelegate: DelegateAgent | null = null
  private piGen: BaseAgent | null = null

  private readonly maestroAgents = new Map<string, MaestroAgent>()
  private readonly delegateAgents = new Map<string, DelegateAgent>()
  private readonly manualCompactionCancels = new Map<string, () => void | Promise<void>>()
  private readonly manualCompactions = new Map<string, Promise<unknown>>()
  private readonly hydratedMaestroAgentSessions = new Set<string>()
  private readonly attachedPaths = new Map<string, Set<string>>()
  /**
   * Claim before workspace/attachment/compaction awaits. Each chat owns at most one root Turn;
   * other chats may run independently while this chat's additional messages remain steering.
   */
  private readonly activeAgentTurns = new Map<string, ActiveAgentTurn>()
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
    { finished: AgentTurnFinished; expiresAt: number; acknowledged?: boolean; continuationBlocked?: boolean }
  >()

  private lastAgentRunFallback: {
    skill?: SkillSummary
    skills?: SkillSummary[]
    replay?: ReplayResult
  } = {}

  get lastAgentRun(): { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult } {
    return (currentAgentRun()?.lastAgentRun ?? this.lastAgentRunFallback) as typeof this.lastAgentRunFallback
  }

  set lastAgentRun(value: { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult }) {
    const run = currentAgentRun()
    if (run) run.lastAgentRun = value
    else this.lastAgentRunFallback = value
  }

  private lastAgentArtifactsFallback: AgentFileArtifact[] = []
  get lastAgentArtifacts(): AgentFileArtifact[] {
    return (currentAgentRun()?.lastAgentArtifacts ?? this.lastAgentArtifactsFallback) as AgentFileArtifact[]
  }

  set lastAgentArtifacts(value: AgentFileArtifact[]) {
    const run = currentAgentRun()
    if (run) run.lastAgentArtifacts = value
    else this.lastAgentArtifactsFallback = value
  }

  private tabsOpenedThisTurnFallback: TabInfo[] = []
  get tabsOpenedThisTurn(): TabInfo[] {
    return (currentAgentRun()?.tabsOpenedThisTurn ?? this.tabsOpenedThisTurnFallback) as TabInfo[]
  }

  set tabsOpenedThisTurn(value: TabInfo[]) {
    const run = currentAgentRun()
    if (run) run.tabsOpenedThisTurn = value
    else this.tabsOpenedThisTurnFallback = value
  }

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
    // Constructing configuration helpers is also used by anonymous browser startup. Execution
    // entrypoints below still assert application auth independently of provider OAuth.
    if (this.shuttingDown) throw new Error('Maestro runtime is shutting down.');
    if (!this.piGen) {
      this.piGen = this.configureAgent(
        new BaseAgent({
          ...agentPorts(),
          compactPrompt: () => this._state.readMaestroSettings().compactPrompt,
          buildTools: () => [],
          scope: 'summarize',
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          agentDir: maestroAgentDir(),
          // Tool-free generation agent: it binds no project and never resolves a relative path, so it
          // keeps the agent dir like the other short-job workers rather than a workspace.
          cwd: maestroAgentDir(),
          onDebug: broadcastCodexDebug
        })
      )
    }
    if (!this.pi) {
      this.pi = this.configureAgent(
        new MaestroAgent({
          ...agentPorts(),
          compactPrompt: () => this._state.readMaestroSettings().compactPrompt,
          skillGuidance: root => this.sessionSkillGuidance(root),
          onCompaction: (state) => xpcMain.broadcast('coach/agent-compaction', { sessionId: 'default', ...state }),
          buildTools: () => this._state.buildPiTools({ ingest: true, sessionKey: 'default' }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          agentDir: maestroAgentDir(),
          // No project bound yet -> the one shared default workspace, the same directory the workspace
          // tools already fall back to. setProjectRoot() overrides it per session. See
          // docs/features/agent-cwd-follows-workspace.md.
          cwd: ensureDefaultWorkspace(),
          onDebug: broadcastCodexDebug,
          // **聊天回合不设墙钟上限**(`0`)。Ral 2026-09-22:「有的任务或 tool 耗时就是就 例如,
          // 下载 … 不能设置超时的,一直静默就静默着」。一个工具跑几小时是合法的,而
          // `BaseAgent` 的默认 600s 会把它当成挂死掐掉 —— 掐掉的是耗时,不是故障。
          // 回合只由「跑完」或「人按 Stop」结束。
          turnTimeoutMs: 0,
          onActivity: (step) => this.relayAgentActivity('default', step),
          onThinking: (state) => this.relayAgentThinking('default', state),
          onStream: (delta) => this.relayAgentStream('default', delta),
          // 逐轮把**本回合累计**用量记到账本上。压缩的触发线要问「上一轮模型实际吃进去多少」,
          // 而那个数只有模型往返知道 —— 渲染端自己的 token 计量是另一把尺。
          // 与 cowork 同一份设计(`areas/agent-runtime/agent-design-parity.md`)。
          onUsage: (_delta, total) => usageLedger.set('default', total)
        })
      )
    }
    if (!this.piDelegate) {
      this.piDelegate = this.configureAgent(
        new DelegateAgent({
          ...agentPorts(),
          autoCompaction: false,
          buildTools: () => this._state.buildPiTools({ sessionKey: 'default' }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          agentDir: maestroAgentDir(),
          // No project bound yet -> the one shared default workspace, the same directory the workspace
          // tools already fall back to. setProjectRoot() overrides it per session. See
          // docs/features/agent-cwd-follows-workspace.md.
          cwd: ensureDefaultWorkspace(),
          onDebug: broadcastCodexDebug
        })
      )
    }
    return {
      pi: this.pi,
      piDelegate: this.piDelegate,
      piGen: this.piGen
    }
  }

  applyLlmTarget(provider: string, model: string, effort: LlmEffort = 'low'): void {
    const targetChanged =
      provider !== this.activeLlmProvider ||
      model !== this.activeLlmModel ||
      effort !== this.activeLlmEffort
    if (targetChanged && this.hasActiveAgentTurn()) {
      throw new Error('The model cannot be changed while a Maestro turn is active.')
    }
    this.activeLlmProvider = provider
    this.activeLlmModel = model
    this.activeLlmEffort = effort
    this.piGen?.setTarget(provider, model, effort)
    this.pi?.setTarget(provider, model, effort)
    this.piDelegate?.setTarget(provider, model, effort)
    for (const agent of this.maestroAgents.values()) {
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
  }

  resetAgentSessions(): void {
    this.pi?.reset()
    this.piDelegate?.reset()
    this.piGen?.reset()
    for (const agent of this.maestroAgents.values()) agent.reset()
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
    const activeTurns = [...this.activeAgentTurns.values()]
    for (const activeTurn of activeTurns) {
      activeTurn.steeringInbox.cancel('The application stopped before this message was delivered.')
      activeTurn.state = 'aborting'
      if (activeTurn.reservationTimer) clearTimeout(activeTurn.reservationTimer)
      activeTurn.reservationTimer = undefined
      activeTurn.resolveRootStart(false)
      this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(activeTurn) })
    }
    try {
      await this.shutdownWorkflows()
    } catch (error) {
      this.shuttingDown = false
      for (const activeTurn of activeTurns) {
        activeTurn.stopError = error instanceof Error ? error.message : String(error)
        this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(activeTurn) })
      }
      throw error
    }
    const agents = new Set(
      [
        this.pi,
        this.piDelegate,
        this.piGen,
        ...this.maestroAgents.values(),
        ...this.delegateAgents.values()
      ].filter((agent): agent is BaseAgent => Boolean(agent))
    )
    // SDK 的 BaseAgent 没有 dispose() —— 带排空的销毁属于 bitterless 独有的 15 项生命周期机制,
    // abort() 是等价出口:有界等待 + finally 里 reset() 清掉会话与 busy。
    await Promise.allSettled([...this.manualCompactionCancels.values()].map((cancel) => Promise.resolve().then(cancel)))
    await Promise.allSettled([...agents].map((agent) => agent.abort()))

    this.attachedPaths.clear()
    this.maestroAgents.clear()
    this.delegateAgents.clear()
    this.hydratedMaestroAgentSessions.clear()
    this.pi = null
    this.piDelegate = null
    this.piGen = null
    this.lastAgentRun = {}
    this.lastAgentArtifacts = []
    this.tabsOpenedThisTurn = []
    for (const activeTurn of activeTurns) this.finishAgentTurn(activeTurn, 'stopped')
  }

  async getHostToolCatalog(params?: {
    scope?: HostToolScope
    category?: string
    query?: string
  }): Promise<HostToolCatalogResult> {
    await this.loadHostToolPolicies()
    return readHostToolCatalog({
      // 只剩 'cowork' 一个 scope(trainer 随 Coach agent 一起退役,2026-09-10)——
      // 入参保留是为了不改 XPC 契约的形状,但它只可能是这一个值。
      scope: 'cowork',
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
    const known = readHostToolCatalog({
      scope: 'cowork',
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

  claimAgentTurn(params: AgentTurnClaimRequest): AgentTurnClaimResult {
    this.assertAgentRuntimeActive()
    const sessionId = this.agentSessionKey(params.sessionId)
    const turnId = params.turnId.trim()
    const rootText = params.rootText.trim()
    if (!turnId || !rootText) {
      throw new Error('A Maestro Turn requires a turnId and root text.')
    }

    const current = this.activeAgentTurns.get(sessionId)
    if (current) {
      const sameTurn = current.turnId === turnId
      return {
        ok: sameTurn,
        turn: this.agentTurnSnapshot(current),
        reason: sameTurn ? undefined : 'busy-here'
      }
    }

    if (this.activeAgentTurns.size >= MAX_CONCURRENT_AGENT_TURNS) {
      return {
        ok: false,
        turn: this.agentTurnSnapshot(this.activeAgentTurns.values().next().value!),
        reason: 'busy-elsewhere'
      }
    }

    this.pruneFinishedAgentTurns()
    if (params.continuationOf) {
      const record = this.recentFinishedAgentTurns.get(this.agentTurnKey(sessionId, params.continuationOf))
      if (record?.continuationBlocked || record?.finished.reason !== 'completed' || !record.finished.reply?.ok) {
        throw new Error('The previous turn cannot be continued after stopping or failing.')
      }
    }
    for (const record of this.recentFinishedAgentTurns.values()) {
      if (record.finished.turn.sessionId === sessionId && record.finished.turn.turnId !== params.continuationOf) record.continuationBlocked = true
    }

    let resolveRootStart: (started: boolean) => void = () => undefined
    const rootStartPromise = new Promise<boolean>((resolveStart) => {
      resolveRootStart = resolveStart
    })
    let resolveFinished: ActiveAgentTurn['resolveFinished'] = () => undefined
    const finished = new Promise<AgentTurnFinished>(resolve => { resolveFinished = resolve })
    const turn: ActiveAgentTurn = {
      continuationOf: params.continuationOf,
      sessionId,
      // A host-authored continuation binds to the chat that owns it, not to whatever tab is on screen.
      operationTabId: params.operationTabId || (params.hostAuthored ? undefined : this._state.activeTabId || undefined),
      turnId,
      rootText,
      hostAuthored: params.hostAuthored,
      startedAt: Number.isFinite(params.startedAt) ? params.startedAt : Date.now(),
      state: 'reserved',
      generation: ++this.agentTurnGeneration,
      rootStarted: false,
      steeringInbox: new TurnSteeringInbox(),
      finished, resolveFinished,
      rootStartPromise,
      resolveRootStart,
      reservationTimer: undefined
    }
    turn.reservationTimer = setTimeout(() => {
      if (this.activeAgentTurns.get(sessionId) !== turn || turn.rootStarted) return
      this.finishAgentTurn(turn, 'reservation-expired')
    }, AGENT_TURN_RESERVATION_TIMEOUT_MS)
    this.activeAgentTurns.set(sessionId, turn)
    // The user outranks a pending wait: their own turn cancels it, so the status bar stops showing a
    // wait they have already overtaken and no continuation fires behind them.
    if (!params.hostAuthored) this.workflowHost?.cancelWait(sessionId)
    this._state.beginBrowserTurn(sessionId, turn.operationTabId)
    this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(turn) })
    return { ok: true, turn: this.agentTurnSnapshot(turn) }
  }

  getActiveAgentTurn(): AgentTurnRecoverySnapshot {
    this.pruneFinishedAgentTurns()
    const turns = [...this.activeAgentTurns.values()].map((turn) => this.agentTurnSnapshot(turn))
    return {
      revision: this.agentTurnRevision,
      turn: turns[0] ?? null,
      turns,
      finished: [...this.recentFinishedAgentTurns.values()].filter(record => !record.acknowledged).map((record) => record.finished)
    }
  }

  ackAgentTurnFinished(params: { sessionId: string; turnId: string }): void {
    const record = this.recentFinishedAgentTurns.get(this.agentTurnKey(params.sessionId, params.turnId))
    if (record) record.acknowledged = true
  }

  hasActiveAgentTurn(): boolean {
    return this.activeAgentTurns.size > 0 || this.manualCompactions.size > 0
  }

  private agentTurnSnapshot(turn: ActiveAgentTurn): AgentTurnSnapshot {
    return {
      sessionId: turn.sessionId,
      operationTabId: turn.operationTabId,
      turnId: turn.turnId,
      generation: turn.generation,
      rootText: turn.rootText,
      startedAt: turn.startedAt,
      state: turn.state,
      stopError: turn.stopError,
      hostAuthored: turn.hostAuthored
    }
  }

  private activeTurnFor(sessionId: string, turnId: string): ActiveAgentTurn | null {
    const active = this.activeAgentTurns.get(sessionId)
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
    if (this.activeAgentTurns.get(turn.sessionId) !== turn) return
    // Root completion can race resource cleanup. Only confirmed cleanup may finish a stopped turn.
    if (reason === 'completed' && turn.state === 'aborting') return
    const snapshot = this.agentTurnSnapshot(turn)
    if (turn.reservationTimer) clearTimeout(turn.reservationTimer)
    turn.reservationTimer = undefined
    turn.resolveRootStart(false)
    turn.steeringInbox.cancel('The turn ended before this message was delivered.')
    this.activeAgentTurns.delete(turn.sessionId)
    turn.resolveFinished({ turn: snapshot, reason, reply })
    this._state.endBrowserTurn(turn.sessionId)
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

  /** Saved evidence is read unchanged; new/missing chats receive a clearly labelled configuration snapshot. */
  private readonly sessionIoInitialization = new SessionIoInitialization()

  async ensureSessionIo(params: { sessionId: string; workspace?: WorkspaceRef }, source: 'new-chat' | 'missing-history' = 'new-chat'): Promise<SessionIoPathResult> {
    try {
      const path = await this.sessionIoInitialization.ensure(params?.sessionId, source, async () => {
        const key = this.agentSessionKey(params.sessionId)
        const existing = key === 'default' ? this.pi : this.maestroAgents.get(key)
        const agent = existing || this.getMaestroAgent(key)
        const workspace = params.workspace?.path || this._state.projectRootForSession(key)
        // A running agent owns its prompt; inspection must never mutate it.
        if (!existing) await agent.setProjectRoot(workspace)
        return { ...agent.sessionIoConfiguration(), workspace }
      })
      return { ok: true, path }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async copySessionIoPath(params: { sessionId: string; workspace?: WorkspaceRef }): Promise<SessionIoPathResult> {
    try {
      const dir = await this.resolveSessionIoDirectory(params?.sessionId, params.workspace)
      clipboard.writeText(dir)
      return { ok: true, path: dir }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * `/export` 的**第一步**:解析目录 + 让人选保存位置。**不压缩。**
   *
   * 拆成两步是因为界面要在压缩期间显示等待提示(Ral 2026-09-22),而保存对话框开着的那段时间
   * 是**人在想**,不是机器在忙 —— 一次调用里做完的话,加载态会盖住人挑目录的全过程,
   * 显示的是一个假的"正在压缩"。
   *
   * 目录经 `resolveSessionIoDirectory` 按**会话身份**取,与 `/copy_session_path`、右键"打开目录"
   * 同一个来源,三者不会指向不同的地方。第二步会再取一次,所以界面拿到的 `target` 只是保存位置,
   * 不是可以绕过身份校验的源路径。
   *
   * 用 `showSaveDialog` 而不是只选目录:存一个压缩包要定的是目录**和**文件名两件事。
   * 默认名带会话目录名,免得几次导出互相覆盖。取消返回 `cancelled`,不是错误。
   */
  async pickSessionIoExportTarget(params: { sessionId: string; workspace?: WorkspaceRef }): Promise<SessionIoExportTarget> {
    try {
      const dir = await this.resolveSessionIoDirectory(params?.sessionId, params.workspace);
      const chosen = await dialog.showSaveDialog({
        title: 'Export session logs',
        defaultPath: join(app.getPath('downloads'), `${basename(dir)}.zip`),
        filters: [{ name: 'Zip archive', extensions: ['zip'] }]
      });
      if (chosen.canceled || !chosen.filePath) return { ok: false, cancelled: true };
      return { ok: true, path: dir, target: chosen.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * `/export` 的**第二步**:真正压缩。界面在调它之前亮出等待提示,它返回之后才收 ——
   * 于是提示的存续区间恰好等于"压缩 + 落盘"。
   *
   * 目录**再解析一次**而不是接收第一步的返回值:两步之间界面可能换了会话,而这条命令的语义是
   * "导出这个会话" —— 身份是判据,路径只是结果。
   */
  async writeSessionIoArchive(params: { sessionId: string; target: string; workspace?: WorkspaceRef }): Promise<SessionIoExportResult> {
    try {
      const dir = await this.resolveSessionIoDirectory(params?.sessionId, params.workspace);
      const target = typeof params?.target === 'string' ? params.target.trim() : '';
      if (!target) throw new Error('A save location is required.');
      // `cwd` 设成目录的父级、输入用目录名 —— 压缩包里是一个顶层文件夹,不是一堆散文件摊在解压处。
      // `-y` 覆盖同名,人已经在保存对话框里确认过一次了。
      await createArchive(target, [basename(dir)], { cwd: join(dir, '..') });
      return { ok: true, path: dir, archive: target };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async resolveSessionIoDirectory(sessionId: string, workspace?: WorkspaceRef): Promise<string> {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) throw new Error('A chat session is required.')
    const result = await this.ensureSessionIo({ sessionId: id, workspace }, 'missing-history')
    if (!result.ok) throw new Error(result.error)
    return result.path
  }

  async openSessionIoDirectory(params: { sessionId: string }): Promise<SessionIoPathResult> {
    try {
      const dir = await this.resolveSessionIoDirectory(params?.sessionId)
      const error = await shell.openPath(dir)
      return error ? { ok: false, error } : { ok: true, path: dir }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async copyNextTurnContext(params: ContextExportRequest): Promise<ContextExportSummary> {
    try {
      this.assertAgentRuntimeActive()
      const windowTabs = this._state.describeWindowTabs()
      if (!params || typeof params.sessionId !== 'string' || !params.sessionId.trim() || typeof params.draft !== 'string') {
        throw new Error('A chat session and draft are required for context export.')
      }
      const sessionKey = this.agentSessionKey(params.sessionId)
      this._state.syncWorkspaceFromContext(sessionKey, params.context?.workspace)
      if (skillScopeContext.current()) {
        await skillScopeContext.authorize().catch(() => null)
        if (skillScopeContext.current()) await skillCloud.ensureCatalog()
      }
      assertContextTextSize(params.draft)
      const agent = (sessionKey === 'default' ? this.pi : this.maestroAgents.get(sessionKey)) || (existsSync(this.nativeSessionFile(sessionKey)) ? this.getMaestroAgent(sessionKey) : undefined)
      if (agent) {
        await agent.setProjectRoot(this._state.projectRootForSession(sessionKey))
        if (await agent.hasConversation()) this.hydratedMaestroAgentSessions.add(sessionKey)
      }
      const context = params.context
      const attachmentPaths = context?.attachedPaths ?? []
      if (!Array.isArray(attachmentPaths) || attachmentPaths.some((path) => typeof path !== 'string')) {
        throw new Error('Attachment references must be paths.')
      }
      const surface = agent ? await agent.existingContextSurface({ readOnly: true }) : null
      if (agent !== (sessionKey === 'default' ? this.pi : this.maestroAgents.get(sessionKey))) {
        throw new Error('The model session changed during context export. Retry.')
      }
      const message = params.draft.trim()
      const registry = this._state.existingSkillRegistry()
      if (!registry) throw new Error('The skill catalog is not ready for context export. Retry after initialization.')
      const browserSession = this._state.agentBrowserSession(sessionKey)
      const currentUrl = browserSession.tabs.find((tab) => tab.id === browserSession.selectedTabId)?.url || browserSession.initiatingTab?.url || this._state.currentUrl
      const recordings = registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => registry.listSkills())
      const pending = buildAgentTurnPrompt({
        message,
        context,
        includeConversationMemory: !this.hydratedMaestroAgentSessions.has(sessionKey),
        nowLocal: localNow(),
        activeTab: windowTabs.activeTab,
        openTabs: windowTabs.openTabs,
        userChainPath: chainFilePath(maestroUserChainDir(), sessionKey),
        currentUrl,
        catalog: registry.catalogPrompt(this._state.projectRootForSession(sessionKey)),
        skillAuthoring: skillAuthoringRuntime(registry.scopeStorage.shared),
        // Where the model is actually working when nothing is selected (Ral 2026-09-18).
        defaultWorkspacePath: ensureDefaultWorkspace(),
        briefs: this.agentSkillBriefs(message, recordings, registry)
      })
      // 组装走 SDK 的 entry 级实现(`@main/agent/contextExport.service`),与 cowork 同一份:
      // 条目分型、工具调用参数单独成行、逐条字符数,图片只写 `[image]` 不展开 base64。
      // 原来 bitterless 这条路是 `JSON.stringify(messages)` 平铺 —— 拿不到工具调用参数,
      // 而那正是上下文里最容易被忽略的一块。
      const record = buildContextRecord({
        sessionId: sessionKey,
        provider: this.activeLlmProvider,
        model: this.activeLlmModel,
        /**
         * 活实例的组装结果 —— 用 `sessionIoConfiguration().systemPrompt`,也就是
         * `resolveRuntimeSystemPrompt()` 的 finalSystemPrompt:表 1 + 表 2 **再加**末尾那行
         * `Current working directory:`。`composedSystemPrompt()` 不含 cwd 行,拿它导出会让
         * 查看入口和真实请求在 cwd 上长期漂开 —— 而 cwd 恰恰是要在这里被核对的东西
         * (docs/features/agent-cwd-follows-workspace.md)。它只读配置,不建运行时、不读凭据。
         *
         * 还没有 agent 时展示固定 A1–A5 + A7(也没有 cwd 行:cwd 属于会话,没有会话就没有取值)。
         * 另一处差别:没有活实例就没有后端事实块(`targetBlock()` 要读活的 provider/model)。
         */
        systemPrompt: agent ? agent.sessionIoConfiguration().systemPrompt : `${BASE_SYSTEM_PROMPT}\n\n${A7_DISCIPLINE}`,
        entries: contextEntriesOfSurface(surface),
        ioLogDir: await modelIoLog.dirForSession(sessionKey) ?? undefined,
        pending: { attachments: attachmentPaths, draft: pending },
        timestamp: new Date().toISOString()
      })
      const text = renderContextText(record)
      // 尺寸闸是**宿主策略**(见 contextExportLimit.service):一次往剪贴板塞多大算过分,
      // 不该由 SDK 替宿主决定。
      assertContextTextSize(text)
      clipboard.writeText(text)
      return { ok: true, chars: text.length, entries: record.entries.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * `/view_context_graph` 的执行体 —— **与 `copyNextTurnContext` 同一批真源**,但出的是**结构投影**
   * 而不是正文,所以它可以过 xpc 而那条不行(那条不截断,原则上无界 ⇒ 它去剪贴板)。
   *
   * 刻意与 `copyNextTurnContext` 并列,而不是给它加一个"要不要顺便回结构"的开关:一个出剪贴板、
   * 一个出渲染层,两条出口的失败语义与载荷约束都不同,一个函数同时承担会让两边互相牵制。
   * 共享的是**下面这几行来源**与 `flattenEntryRows` 那一份映射,不是这个方法。
   *
   * 逐条说明这里为什么留下 / 去掉了那条路上的哪些步骤 —— 别把任何一条当成抄漏:
   * · `assertAgentRuntimeActive()` **留** —— 这份结构读的是**活着的** runtime(条目面 +
   *   `composedSystemPrompt()`)。与 `copySessionIoPath` 刻意不调它正好相反:那条只问盘上的路径。
   * · 会话键 + **换会话再检测一次** 留 —— `existingContextSurface()` 是 await,期间会话可能被换掉;
   *   拿一个已经不属于这个会话的条目面画结构,画的是**别人的**上下文,而且看起来完全正常。
   * · `buildAgentTurnPrompt` **留** —— pending 那一块的真实体量是**整块拼装后的** turn prompt
   *   (含每轮注入的上下文与技能简介),不是输入框里那几十个字。只送原始草稿会把 pending 少报一整个
   *   前缀,而"谁在吃窗口"正是这个弹窗存在的理由;顺带让 `/view_context` 与这条对同一状态报同一个
   *   pending,不出现两个口径。里面那次 `new Date()` 是**提示词内容**的一部分(真 send 也这么读),
   *   与投影本身的确定性无关 —— 确定性那条在 `buildContextGraph`(它一个时钟都不读)。
   * · 静态系统提示词兜底 留 —— 还没有 agent 时(会话一轮都没发过)它就是下一轮会注入的那份。
   * · `assertContextTextSize(params.draft)` 留 —— 草稿是这条路上**唯一**无界的入参,同一条宿主闸
   *   (8 MiB)把"载荷有界"这个承诺守住。闸的文案提到剪贴板是因为它是共用的那一份,不为此分叉。
   * · **不写剪贴板、不抛异常** —— 失败回 `{ ok: false, error }`,渲染层把它显示成一行提示
   *   (弹窗根本不开);抛出去只会变成一个没人接的 xpc 拒绝。
   */
  async readContextGraph(params: ContextGraphRequest): Promise<ContextGraphResult> {
    try {
      this.assertAgentRuntimeActive()
      const windowTabs = this._state.describeWindowTabs()
      if (!params || typeof params.sessionId !== 'string' || !params.sessionId.trim() || typeof params.draft !== 'string') {
        throw new Error('A chat session and draft are required to read the context graph.')
      }
      const sessionKey = this.agentSessionKey(params.sessionId)
      assertContextTextSize(params.draft)
      // 与 `copyNextTurnContext` 里那个内联表达式同一个解析(default → this.pi,否则会话表),
      // 只是走已有的具名口子,免得同一句话在这个文件里出现第四遍。
      this._state.syncWorkspaceFromContext(sessionKey, params.context?.workspace)
      const agent = this.getExistingMaestroAgent(sessionKey) || (existsSync(this.nativeSessionFile(sessionKey)) ? this.getMaestroAgent(sessionKey) : undefined)
      if (agent) {
        await agent.setProjectRoot(this._state.projectRootForSession(sessionKey))
        if (await agent.hasConversation()) this.hydratedMaestroAgentSessions.add(sessionKey)
      }
      const context = params.context
      const attachmentPaths = context?.attachedPaths ?? []
      if (!Array.isArray(attachmentPaths) || attachmentPaths.some((path) => typeof path !== 'string')) {
        throw new Error('Attachment references must be paths.')
      }
      const surface = agent ? await agent.existingContextSurface() : null
      if (agent !== this.getExistingMaestroAgent(sessionKey)) {
        throw new Error('The model session changed while reading the context graph. Retry.')
      }
      const message = params.draft.trim()
      const registry = this._state.existingSkillRegistry()
      // 技能简介进 pending 提示词,所以目录没就绪时**明确失败**,而不是回一个少了简介的 pending 体量
      // ——后者是一个没人会察觉的错数。窗口创建时就 `ensureServices()`,所以这条在实践中不会挡人。
      if (!registry) throw new Error('The skill catalog is not ready for the context graph. Retry after initialization.')
      const browserSession = this._state.agentBrowserSession(sessionKey)
      const currentUrl = browserSession.tabs.find((tab) => tab.id === browserSession.selectedTabId)?.url || browserSession.initiatingTab?.url || this._state.currentUrl
      const recordings = registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => registry.listSkills())
      const pending = buildAgentTurnPrompt({
        message,
        context,
        includeConversationMemory: !this.hydratedMaestroAgentSessions.has(sessionKey),
        nowLocal: localNow(),
        activeTab: windowTabs.activeTab,
        openTabs: windowTabs.openTabs,
        userChainPath: chainFilePath(maestroUserChainDir(), sessionKey),
        currentUrl,
        catalog: registry.catalogPrompt(this._state.projectRootForSession(sessionKey)),
        skillAuthoring: skillAuthoringRuntime(registry.scopeStorage.shared),
        // Where the model is actually working when nothing is selected (Ral 2026-09-18).
        defaultWorkspacePath: ensureDefaultWorkspace(),
        briefs: this.agentSkillBriefs(message, recordings, registry)
      })
      const graph = buildContextGraph({
        sessionId: sessionKey,
        provider: this.activeLlmProvider,
        model: this.activeLlmModel,
        // No live agent: fixed A1–A5 + A7 only, without loading project instructions.
        systemPrompt: agent ? agent.sessionIoConfiguration().systemPrompt : `${BASE_SYSTEM_PROMPT}\n\n${A7_DISCIPLINE}`,
        entries: entriesOfSurface(surface),
        pending: {
          // workspace 从入参里的 `WorkspaceRef` 取:渲染层早就把它一起送上来了,不为一行显示字段
          // 给这个服务新增一个依赖(cowork 那边是控制器补的,因为它那条入参不带 context)。
          workspace: context?.workspace?.path,
          // 附件给**绝对路径**而不是 basename —— 与本仓 `copyNextTurnContext` 同一口径。两条命令
          // 描述的是同一个 pending 集合,这里改成短名就会出现"同一状态两种说法"。
          attachments: attachmentPaths,
          draft: pending
        },
        messages: params.messages,
        // 结构投影不用时间戳 —— 但 `ContextExportInput` 要求它。给一个确定的空串比给 `Date.now()` 好:
        // 这条路上没有任何东西读它,而读时钟会让守卫拿不到确定输出。**别把它"修"成真时钟。**
        timestamp: ''
      })
      return { ok: true, graph }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 超长粘贴 → `<userData>/pastes/` 的文件,提示词里只留摘头摘尾 + 绝对路径。
   *
   * 挂在这里是因为这是用户文本进入 agent 的**唯一**入口(root 与 steer 两条路都过它),
   * 也是最后一个"消息还是个纯字符串"的地方。取舍与阈值的理由都在 `longPaste.service.ts`。
   *
   * **渲染端那份不动** —— UI 与历史里仍是用户真正敲进去的原文;被换掉的只有交给模型的那一份。
   */
  private offloadLongPasteIfNeeded(message: string, sessionId?: string): string {
    const result = offloadLongPaste({ dir: maestroLongPasteDir(), message, sessionId })
    if (result.error) {
      console.warn('[agent] 超长粘贴落盘失败,原文照发:', result.error)
    } else if (result.path) {
      console.log(`[agent] 超长粘贴 ${result.originalChars.toLocaleString()} 字符 -> ${result.path}`)
    }
    return result.text
  }

  /**
   * 把这一条用户原话记进 `<userData>/chain/<sessionId>.jsonl`。
   *
   * **记的是 `message`,也就是 main 真正发出去的那一份**(长粘贴已换成引用)——
   * 不是渲染端存的原文。上一版的链由渲染端建,两份不一致,后果是被换掉的长粘贴在第一次压缩时
   * 又被原样注入回来。这里从源头消掉那类矛盾。
   *
   * 三样元数据只有 main 知道(它就是拼 D1/D2/D3 的地方),所以必须在这里取:
   * 发送时间、当时的 workspace、当时激活的页面。Ral 2026-09-11 指定要带。
   */
  private recordUserChainMessage(message: string, sessionId?: string, context?: AgentConversationContext, activeTab?: ActiveTabContent | null): void {
    const path = ensureSessionChainFile(maestroUserChainDir(), this.agentSessionKey(sessionId))
    const tab = activeTab === undefined ? this._state.describeWindowTabs().activeTab : activeTab
    const written = appendUserChainRecord(path, {
      at: localNow(),
      ws: context?.workspace?.path || '',
      tab: tab ? describeActiveTabLine(tab) : '',
      text: message
    })
    if (!written) console.warn('[agent] 用户原话未能写入历史文件:', path)
  }

  async sendAgentMessage(params: AgentMessageRequest): Promise<AgentReply> {
    this.assertAgentRuntimeActive();
    // Fix D3/D4 at receipt, before turn reservations, persistence, or media preparation can await.
    const windowTabs = params.snapshot?.windowTabs || this._state.describeWindowTabs()
    const snapshot = { windowTabs, sentAt: params.snapshot?.sentAt || localNow() }
    const message = this.offloadLongPasteIfNeeded(params.message.trim(), params.sessionId)
    if (message) this.recordUserChainMessage(message, params.sessionId, params.context, windowTabs.activeTab)
    if (!message) {
      return {
        ok: false,
        text: 'Empty message.',
        ts: Date.now(),
        error: 'empty-message'
      }
    }
    const sessionKey = this.agentSessionKey(params.sessionId)
    const compaction = this.manualCompactions.get(sessionKey)
    if (compaction && params.intent === 'root') {
      // The root payload arrived; waiting for native compaction is not a lost reservation.
      const reserved = this.activeTurnFor(sessionKey, params.turnId)
      if (reserved?.reservationTimer) clearTimeout(reserved.reservationTimer)
      if (reserved) reserved.reservationTimer = undefined
    }
    await compaction?.catch(() => undefined)
    const turn = this.activeTurnFor(sessionKey, params.turnId)
    if (!turn || turn.state === 'aborting') {
      if (!turn && params.intent === 'steering') {
        const record = this.recentFinishedAgentTurns.get(this.agentTurnKey(sessionKey, params.turnId))
        const previous = record?.finished
        const successor = this.activeAgentTurns.get(sessionKey)
        if (!record?.continuationBlocked && previous?.reason === 'completed' && previous.reply?.ok && (!successor || successor.continuationOf === params.turnId)) {
          return { ok: false, text: '', ts: Date.now(), continueAsRoot: { turnId: params.turnId, reply: previous.reply, snapshot } }
        }
      }
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
    } else {
      // Capture all dynamic context before any root preparation or provider work can await.
      const registry = this._state.existingSkillRegistry() || this._state.ensureServices().registry
      const selected = await registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => selectedSkillPrompt(registry, params.context?.selectedSkillRef))
      const text = this.buildMessagePrompt(message + selected, params.context, windowTabs, sessionKey, false, snapshot.sentAt)
      if (turn.steeringInbox.isClosed) {
        const finished = await turn.finished
        const successor = this.activeAgentTurns.get(sessionKey)
        const blocked = this.recentFinishedAgentTurns.get(this.agentTurnKey(sessionKey, turn.turnId))?.continuationBlocked
        if (!blocked && finished.reason === 'completed' && finished.reply?.ok && (!successor || successor.continuationOf === turn.turnId)) {
          return { ok: false, text: '', ts: Date.now(), continueAsRoot: { turnId: turn.turnId, reply: finished.reply, snapshot } }
        }
        return { ok: false, text: 'The previous turn stopped or failed before this message could be added.', ts: Date.now(), error: 'steer-failed' }
      }
      const delivered = await turn.steeringInbox.enqueue({ text, messageId: params.messageId, turnId: params.turnId })
      return delivered.outcome === 'delivered'
        ? { ok: true, text: '', ts: Date.now(), mergedIntoTurn: true }
        : { ok: false, text: delivered.error || 'The message was not delivered.', ts: Date.now(), error: 'steer-failed' }
    }

    let reply: AgentReply
    try {
      await this._state.ensurePersistedCaptureRecordsLoaded()
      reply = await this.routeAgentMessage(
        message,
        params.sessionId,
        params.context,
        turn,
        !root,
        windowTabs,
        params.messageId, snapshot.sentAt
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

  async testAutoCompaction(params: { sessionId: string; filePath?: string }): Promise<import('./runtime/piAutoCompactionTest').AutoCompactionTestReport> {
    this.assertAgentRuntimeActive()
    if (!params?.sessionId?.trim()) throw new Error('A chat session is required.')
    const key = this.agentSessionKey(params.sessionId)
    if (this.activeAgentTurns.has(key) || this.manualCompactions.has(key)) throw new Error('Wait for the current operation to finish before testing compaction.')
    const agent = this.getMaestroAgent(key)
    const cancellation = new AbortController()
    this.manualCompactionCancels.set(key, () => cancellation.abort())
    const operation = (async () => {
      await agent.setProjectRoot(this._state.projectRootForSession(key))
      const config = agent.sessionIoConfiguration()
      xpcMain.broadcast('coach/agent-compaction', { sessionId: key, active: true })
      try {
        return await new PiRuntimeAdapter().testAutoCompaction({
          target: { providerId: config.providerId, modelId: config.modelId, thinkingLevel: config.thinkingLevel as import('./runtime/agentRuntime.types').AgentRuntimeThinkingLevel },
          authPath: maestroAuthPath(), modelsPath: maestroModelsPath(), cwd: config.cwd,
          systemPrompt: agent.composedSystemPrompt(), compactPrompt: this._state.readMaestroSettings().compactPrompt,
          filePath: params.filePath, signal: cancellation.signal,
          onCompaction: (state) => xpcMain.broadcast('coach/agent-compaction', { sessionId: key, ...state })
        })
      } finally { xpcMain.broadcast('coach/agent-compaction', { sessionId: key, active: false }) }
    })()
    this.manualCompactions.set(key, operation)
    try { return await operation } finally { this.manualCompactions.delete(key); this.manualCompactionCancels.delete(key) }
  }

  async cancelCompaction(params: { sessionId: string }): Promise<void> {
    await this.manualCompactionCancels.get(this.agentSessionKey(params.sessionId))?.()
  }

  async compactSession(params: { sessionId: string; instructions?: string }): Promise<AgentCompactReply & { tokensBefore?: number; estimatedTokensAfter?: number }> {
    try {
      this.assertAgentRuntimeActive()
      if (!params?.sessionId?.trim()) throw new Error('A chat session is required.')
      const key = this.agentSessionKey(params.sessionId)
      if (this.activeAgentTurns.has(key)) throw new Error('Wait for the current turn to finish before using /compact.')
      if (this.manualCompactions.has(key)) throw new Error('This conversation is already compacting.')
      const agent = this.getMaestroAgent(key)
      this.manualCompactionCancels.set(key, () => agent.abort())
      const operation = (async () => {
        await agent.setProjectRoot(this._state.projectRootForSession(key))
        return await agent.compact(params.instructions)
      })()
      this.manualCompactions.set(key, operation)
      let result: Awaited<ReturnType<BaseAgent['compact']>>
      try { result = await operation } finally { this.manualCompactions.delete(key); this.manualCompactionCancels.delete(key) }
      this.hydratedMaestroAgentSessions.add(key)
      return { ok: true, ...result, ts: Date.now() }
    } catch (error) {
      return { ok: false, summary: '', ts: Date.now(), error: error instanceof Error ? error.message : String(error) }
    }
  }

  async deleteNativeSession(params: { sessionId: string }): Promise<{ ok: true }> {
    this.assertAgentRuntimeActive()
    const key = this.agentSessionKey(params.sessionId)
    if (!params.sessionId?.trim() || key === 'default') throw new Error('A named chat session is required.')
    await this.manualCompactionCancels.get(key)?.()
    await this.manualCompactions.get(key)?.catch(() => undefined)
    const turn = this.activeAgentTurns.get(key)
    if (turn) await this.abortAgent({ sessionId: key, turnId: turn.turnId })
    this.maestroAgents.get(key)?.reset()
    this.maestroAgents.delete(key)
    this.hydratedMaestroAgentSessions.delete(key)
    rmSync(this.nativeSessionFile(key), { force: true })
    return { ok: true }
  }

  private nativeSessionFile(sessionKey: string): string {
    const id = createHash('sha256').update(sessionKey).digest('hex')
    return join(maestroAgentDir(), 'chat-sessions', id + '.jsonl')
  }

  async compactConversation(_params: AgentCompactRequest): Promise<AgentCompactReply> {
    return { ok: false, summary: '', ts: Date.now(), error: 'Use /compact to invoke native Pi compaction.' }
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
    return await this.handleAgentTurn(message, this.getDelegateAgent(params.sessionId), undefined, {
      sessionKey: params.sessionId
    })
  }

  async resetDelegateConversation(params?: { sessionId?: string }): Promise<{ ok: boolean }> {
    this.lastAgentRun = {}
    this.getExistingDelegateAgent(params?.sessionId)?.reset()
    return { ok: true }
  }

  async abortAgent(params: { sessionId: string; turnId: string }): Promise<{ ok: true }> {
    const sessionKey = this.agentSessionKey(params.sessionId)
    const turn = this.activeTurnFor(sessionKey, params.turnId)
    for (const record of this.recentFinishedAgentTurns.values()) {
      if (record.finished.turn.sessionId === sessionKey) record.continuationBlocked = true
    }
    if (!turn) return { ok: true }
    turn.state = 'aborting'
    turn.stopError = undefined
    turn.steeringInbox.cancel('Stopped before this message was delivered.')
    if (turn.reservationTimer) clearTimeout(turn.reservationTimer)
    turn.reservationTimer = undefined
    turn.resolveRootStart(false)
    this.broadcastAgentTurn({ turn: this.agentTurnSnapshot(turn) })
    this.hydratedMaestroAgentSessions.delete(sessionKey)
    taskRegistry.cancelSessionTasks({ sessionId: sessionKey, reason: 'active turn stopped' })
    // **挂着的拍板也要了结。**(docs/features/agent-decision-sheet.md)
    // `ask_user` 是阻塞的:没人 resolve 它,那个工具调用会永远挂着,而它所在的回合已经没了。
    agentDecisionRegistry.cancelSession(sessionKey);
    /**
     * **取消同步、清理后台**(Ral 2026-09-22:「stop 应该立刻结束会话并尽量结束正在执行的命令」)。
     *
     * 上面每一句都是同步的:取消 steering、取消拍板、取消本会话的任务。下面这一句
     * `agent.abort()` 现在也是同步的(BaseAgent.abort:丢 session + 放行,旧 session 由 `reset()`
     * 异步 abort)—— 它就是 pi 的 `agent.abort()`,一次 `AbortController.abort()`;内置工具全都
     * 拿着那个 signal,bash 收到就杀整棵进程树。
     *
     * 原来这里要 `await` workflow worker 终止 + agent abort **之后**才 `finishAgentTurn`,于是回合
     * 的释放被挂在了一段秒级起步的清理后面,而界面只能跟着等
     * (docs/issues/chat-stop-never-confirms-and-the-ui-has-no-escape.md)。现在回合当场结束,
     * worker 的终止(SIGTERM → 宽限 → SIGKILL → 确认)留在后台跑完 —— 取消信号早发出去了,
     * 剩下的是清理,不是前置条件。
     */
    this.getExistingMaestroAgent(params.sessionId)?.abort()
    void Promise.resolve()
      .then(() => this.workflowHost?.stopSession({ sessionId: sessionKey }))
      .catch(() => undefined)
    this.finishAgentTurn(turn, 'stopped')
    return { ok: true }
  }

  async abortDelegate(params?: { sessionId?: string }): Promise<void> {
    await this.getExistingDelegateAgent(params?.sessionId)?.abort()
  }

  agentSessionKey(sessionId?: string): string {
    return sessionId?.trim() || 'default'
  }

  private assertAgentRuntimeActive(): void {
    applicationAuth.assertReady();
    if (this.shuttingDown) {
      throw new Error('Maestro runtime is shutting down.')
    }
  }

  private configureAgent<T extends BaseAgent>(agent: T): T {
    agent.setTarget(this.activeLlmProvider, this.activeLlmModel, this.activeLlmEffort)
    return agent
  }

  private agentTurnIdentity(sessionKey: string): AgentTurnIdentity | null {
    const turn = this.activeAgentTurns.get(sessionKey)
    if (!turn || turn.state !== 'running') return null
    const originatingTurn = this.agentTurnContext.getStore()
    if (originatingTurn && (originatingTurn.sessionId !== sessionKey || originatingTurn.turnId !== turn.turnId || originatingTurn.generation !== turn.generation)) return null
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
    const active = this.activeAgentTurns.get(identity.sessionId)
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
    const active = this.activeAgentTurns.get(identity.sessionId)
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
          ...agentPorts(),
          compactPrompt: () => this._state.readMaestroSettings().compactPrompt,
          skillGuidance: root => this.sessionSkillGuidance(root),
          onCompaction: (state) => xpcMain.broadcast('coach/agent-compaction', { sessionId: key, ...state }),
          buildTools: () => this._state.buildPiTools({ ingest: true, sessionKey: key }),
          sessionFile: this.nativeSessionFile(key),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          agentDir: maestroAgentDir(),
          // No project bound yet -> the one shared default workspace, the same directory the workspace
          // tools already fall back to. setProjectRoot() overrides it per session. See
          // docs/features/agent-cwd-follows-workspace.md.
          cwd: ensureDefaultWorkspace(),
          onDebug: broadcastCodexDebug,
          // **聊天回合不设墙钟上限**(`0`)。Ral 2026-09-22:「有的任务或 tool 耗时就是就 例如,
          // 下载 … 不能设置超时的,一直静默就静默着」。一个工具跑几小时是合法的,而
          // `BaseAgent` 的默认 600s 会把它当成挂死掐掉 —— 掐掉的是耗时,不是故障。
          // 回合只由「跑完」或「人按 Stop」结束。
          turnTimeoutMs: 0,
          onActivity: (step) => this.relayAgentActivity(key, step),
          onThinking: (state) => this.relayAgentThinking(key, state),
          onStream: (delta) => this.relayAgentStream(key, delta),
          // 同上 —— 按 sessionKey 记,压缩按 renderer 传来的 sessionId 取得对上。
          onUsage: (_delta, total) => usageLedger.set(key, total)
        })
      )
      this.maestroAgents.set(key, agent)
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
          ...agentPorts(),
          autoCompaction: false,
          buildTools: () => this._state.buildPiTools({ sessionKey: key }),
          authPath: maestroAuthPath(),
          modelsPath: maestroModelsPath(),
          agentDir: maestroAgentDir(),
          // No project bound yet -> the one shared default workspace, the same directory the workspace
          // tools already fall back to. setProjectRoot() overrides it per session. See
          // docs/features/agent-cwd-follows-workspace.md.
          cwd: ensureDefaultWorkspace(),
          onDebug: broadcastCodexDebug
        })
      )
      this.delegateAgents.set(key, agent)
    }
    return agent
  }

  /**
   * 这个会话在 main 侧**已存在**的 agent —— 压缩的候选批从它的 pi entry 树来。
   *
   * public 而不是 private:`xpc/compaction.handler` 要它(与 cowork 的
   * `getExistingCoworkAgent` 同一形状,`areas/agent-runtime/agent-design-parity.md`)。
   * **"已存在"是承重的**:没有 pi 会话 ⇒ 模型侧没有上下文 ⇒ 压缩无事可做,
   * 而不是开一个会话来凑一个候选批。
   */
  getExistingMaestroAgent(sessionId?: string): MaestroAgent | null {
    const key = this.agentSessionKey(sessionId)
    if (key === 'default') return this.pi
    return this.maestroAgents.get(key) ?? null
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
        refs: media
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

  private async routeAgentMessage(
    message: string,
    sessionId?: string,
    context?: AgentConversationContext,
    turn?: ActiveAgentTurn,
    steeringOnly = false,
    windowTabs?: AgentWindowTabSnapshot,
    messageId?: string,
    messageSentAt?: string
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
    return await this.agentTurnContext.run(identity, () => runInAgentSession(sessionKey, async () => {
      await this.loadHostToolPolicies()
      this._state.syncWorkspaceFromContext(sessionKey, context?.workspace)
      const registry = this._state.existingSkillRegistry() || this._state.ensureServices().registry
      const selected = await registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => selectedSkillPrompt(registry, context?.selectedSkillRef))
      const currentAgent = this.getMaestroAgent(sessionKey)
      await currentAgent.setProjectRoot(this._state.projectRootForSession(sessionKey))
      const includeConversationMemory = !this.hydratedMaestroAgentSessions.has(sessionKey) && !(await currentAgent.hasConversation())
      const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)
      if (isCancelled()) {
        return {
          ok: false,
          text: '',
          ts: Date.now(),
          error: 'turn-aborted'
        }
      }
      return await this.handleAgentTurn(message + selected, this.getMaestroAgent(sessionId), context, {
        sessionKey: sessionId,
        includeConversationMemory,
        mediaInput,
        onAgentSessionUsed: () => this.hydratedMaestroAgentSessions.add(sessionKey),
        isCancelled,
        steeringOnly,
        steeringInbox: turn.steeringInbox,
        messageId, messageSentAt, turnId: turn.turnId,
        windowTabs
      })
    }))
  }

  /**
   * 钻探必须**prepend**进 skillBriefs,**不能混进 `recordings`**（cowork `check-auto-explore` 钉着这条）——
   * 混进去会被确定性快路径当成**文件技能**去读 recipe,而它没有 recipe 文件,于是整条触发静默失效。
   *
   * 中英文都要能触发（Ral 2026-08-11）:他会说「钻探」也会说 drill / 探站。
   * `id: 'builtin:drill'` 是稳定标识,不许改。
   */
  private agentSkillBriefs(message: string, recordings: SkillSummary[], registry: SkillRegistryService): AgentSkillBrief[] {
    return [
      DRILL_BUILTIN_SKILL,
      DEEP_FETCH_BUILTIN_SKILL,
      RELOAD_SKILLS_BUILTIN_SKILL,
      ...recordings.map((skill) => {
      const recipe = skill.recipePath ? registry.readRecipe(skill.id) : null
      const seed = recipe ? extractVariablesFromMessage(message, recipe) : {}
      const missing = recipe ? requiredInputNames(recipe).filter((name) => !seed[name]) : []
      return {
        id: skill.reference || skill.id,
        scope: skill.scope === 'institution' ? 'institution' as const : 'shared' as const, institutionId: skill.institutionId, reference: skill.reference, path: skill.path,
        layer: skill.layer, skillRevision: skill.skillRevision, allowImplicitInvocation: skill.allowImplicitInvocation,
        name: skill.name,
        triggers: skill.triggers,
        description: skill.description,
        inputs: skill.inputs,
        seed,
        missing
      }
      })
    ]
  }

  /**
   * 表 2 的会话级技能指引。与 cowork 的 `sessionSkillGuidance()` 成对。
   *
   * 只含**内置文本流程**:recordings 那份完整目录已经走 A8(`catalogText`),重复一遍就是
   * 同一份清单发两遍(2026-09-22 实测一条消息 57,083 tok,三份目录占 92.1%)。
   */
  private sessionSkillGuidance(projectRoot?: string): string {
    // 根目录由 `MaestroAgent.systemPrompt()` 给出 —— 那个 agent 自己绑定的那个,与 cwd 同源。
    // 不在这里按 sessionKey 再查一次:未绑定时它会回落成默认工作区,把 package root 指到
    // 一个和 cwd 不同的目录(cowork 2026-09-22 实测)。
    const registry = this._state.existingSkillRegistry() || this._state.ensureServices().registry
    return buildSessionSkillGuidance({
      briefs: [DRILL_BUILTIN_SKILL, DEEP_FETCH_BUILTIN_SKILL, RELOAD_SKILLS_BUILTIN_SKILL],
      skillAuthoring: skillAuthoringRuntime(registry.scopeStorage.shared),
      workspacePath: projectRoot
    })
  }

  private buildMessagePrompt(message: string, context: AgentConversationContext | undefined, windowTabs: AgentWindowTabSnapshot, sessionKey: string, includeConversationMemory: boolean, sentAt = localNow()): string {
    const currentUrl = windowTabs.activeTab?.kind === 'web' ? windowTabs.activeTab.url : ''
    const registry = this._state.existingSkillRegistry() || this._state.ensureServices().registry
    const recordings = registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => registry.listSkills())
    return buildAgentTurnPrompt({
      message, context, includeConversationMemory, nowLocal: sentAt,
      activeTab: windowTabs.activeTab, openTabs: windowTabs.openTabs,
      userChainPath: chainFilePath(maestroUserChainDir(), sessionKey), currentUrl,
      catalog: registry.catalogPrompt(this._state.projectRootForSession(sessionKey)),
      skillAuthoring: skillAuthoringRuntime(registry.scopeStorage.shared),
        // Where the model is actually working when nothing is selected (Ral 2026-09-18).
        defaultWorkspacePath: ensureDefaultWorkspace(),
        briefs: this.agentSkillBriefs(message, recordings, registry)
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
      steeringInbox?: TurnSteeringInbox
      messageId?: string
      messageSentAt?: string
      turnId?: string
      /** D3/D4 fixed at message receipt, including an empty window. */
      windowTabs?: AgentWindowTabSnapshot
      /** 这一轮属于哪个聊天会话 —— 表 3 那行用户原话历史路径要按它取。缺省 `'default'`。 */
      sessionKey?: string
    }
  ): Promise<AgentReply> {
    const sessionKey = this.agentSessionKey(options?.sessionKey)
    const authorizedSkillContext = skillScopeContext.current() ? await skillScopeContext.authorize().catch(() => null) : null
    if (authorizedSkillContext) await skillCloud.ensureCatalog()
    const cancelledReply = (): AgentReply => ({
      ok: false,
      text: 'Stopped.',
      ts: Date.now(),
      error: 'aborted'
    })
    if (options?.isCancelled?.()) return cancelledReply()
    // Page context belongs to this message, including steering into an existing turn. Capture it
    // before the first await so a tab switch cannot mix one page's identity with another's skills.
    const browserSession = this._state.agentBrowserSession(this.agentSessionKey(options?.sessionKey))
    const currentUrl = browserSession.tabs.find((tab) => tab.id === browserSession.selectedTabId)?.url || browserSession.initiatingTab?.url || this._state.currentUrl
    const windowTabs = options?.windowTabs ?? this._state.describeWindowTabs()
    const registry = this._state.existingSkillRegistry() || this._state.ensureServices().registry
    const recordings = registry.withWorkspace(this._state.projectRootForSession(sessionKey), () => registry.listSkills()).filter(skill => skill.scope !== 'institution' || Boolean(authorizedSkillContext))
    // `revision()` 每次 prompt 前都会跑,**绝不能抛** —— 抛了就建不出会话。workflow 那份在运行时
    // provider 还没注册时取不到(启动早期,以及只加载部分模块的测试),那时按空目录算:少触发一次
    // reload 是可恢复的,建不出会话不是。
    const workflowCatalogSafe = (): string => { try { return workflowLibraryRuntime?.catalogPrompt() || '' } catch { return '' } }
    agent.setSkillCatalogProvider(async () => {
      if (skillScopeContext.current()) {
        await skillScopeContext.authorize().catch(() => null)
        if (skillScopeContext.current()) await skillCloud.ensureCatalog()
      }
      return registry.catalogPrompt(this._state.projectRootForSession(sessionKey))
    }, {
      revision: () => `${registry.resourceRevision(this._state.projectRootForSession(sessionKey))}|${createHash('sha1').update(workflowCatalogSafe()).digest('hex')}`,
      getSkills: () => registry.getPiSkills(this._state.projectRootForSession(sessionKey)),
      reload: () => { registry.reload(this._state.projectRootForSession(sessionKey)) },
      // 完整目录进系统提示词(每会话一份),不再每轮随消息发。
      catalogText: () => registry.catalogPrompt(this._state.projectRootForSession(sessionKey)),
      // workflow 目录同路进系统提示词,不再每轮随消息发。版本号把它算进去 —— 否则库变了
      // (fs watcher 已更新)而资源版本没变,系统提示词里那份目录会一直是旧的。
      workflowCatalogText: workflowCatalogSafe
    })
    const skillBriefs = this.agentSkillBriefs(message, recordings, registry)
    const nowLocal = options?.messageSentAt || localNow()
    const buildTurnPrompt = (includeConversationMemory: boolean): string => buildAgentTurnPrompt({
      message,
      context,
      includeConversationMemory,
      nowLocal,
      activeTab: windowTabs.activeTab,
      openTabs: windowTabs.openTabs,
      userChainPath: chainFilePath(maestroUserChainDir(), this.agentSessionKey(options?.sessionKey)),
      currentUrl,
      catalog: registry.catalogPrompt(this._state.projectRootForSession(sessionKey)),
      skillAuthoring: skillAuthoringRuntime(registry.scopeStorage.shared),
      briefs: skillBriefs
    })
    if (!options?.steeringInbox) {
      assertSkillContext(authorizedSkillContext)
      const steered = await agent.steerActiveTurn(buildTurnPrompt(false))
      if (options?.isCancelled?.()) return cancelledReply()
      if (steered.outcome === 'delivered') return { ok: true, text: '', ts: Date.now(), mergedIntoTurn: true }
      if (steered.outcome === 'failed' || options?.steeringOnly) {
        return { ok: false, text: steered.error || 'The turn has finished; this message was not queued.', ts: Date.now(), error: 'steer-failed' }
      }
    }

    for (const candidate of recordings) {
      if (candidate.allowImplicitInvocation === false && context?.selectedSkillRef !== candidate.reference) continue
      if (candidate.domain && candidate.domain !== (() => { try { return new URL(currentUrl).hostname } catch { return '' } })()) continue
      const recipe = registry.readRecipe(candidate.id)
      if (!recipe) continue
      const seed = extractVariablesFromMessage(message, recipe)
      if (hasRequiredInputs(recipe) && requiredInputsSatisfied(recipe, seed)) {
        const replay = await this._state.replayAgentSkill(this.agentSessionKey(options?.sessionKey), {
          skillId: candidate.id,
          variables: seed
        })
        const replayReply = this.replayReply(candidate, replay)
        if (!replayReply.ok || options?.isCancelled?.()) {
          options?.steeringInbox?.cancel('The replay stopped or failed before this message was delivered.')
          return replayReply
        }
        const next = options?.steeringInbox?.next()
        if (!next) return replayReply
        await agent.setProjectRoot(this._state.projectRootForSession(this.agentSessionKey(options?.sessionKey)))
        if (options?.isCancelled?.()) return cancelledReply()
        assertSkillContext(authorizedSkillContext)
        const follow = await agent.prompt(next.text, undefined, { steeringInbox: options?.steeringInbox, messageId: next.messageId, turnId: next.turnId })
        return { ...replayReply, ok: follow.ok && !follow.errorMessage, text: [replayReply.text, follow.text].filter(Boolean).join('\n\n'), error: follow.error || follow.errorMessage }
      }
    }

    await agent.setProjectRoot(this._state.projectRootForSession(this.agentSessionKey(options?.sessionKey)))
    if (options?.isCancelled?.()) return cancelledReply()
    this.lastAgentRun = {}
    this.lastAgentArtifacts = []
    this.tabsOpenedThisTurn = []
    const turnMedia = options?.mediaInput || { note: '' }
    if (agent === this.getExistingMaestroAgent(options?.sessionKey)) {
      const completedWorkflows = (await this.getWorkflowHost().listRuns({ sessionId: this.agentSessionKey(options?.sessionKey) })).runs
      for (const run of completedWorkflows) if (run.status !== 'running' && run.status !== 'stopping') {
        agent.retainBackgroundContext(workflowCompletionId(run), workflowCompletionContext(run))
      }
    }
    const runPrompt = async (): Promise<Awaited<ReturnType<BaseAgent['prompt']>>> => {
      assertSkillContext(authorizedSkillContext)
      return await agent.prompt(
        buildTurnPrompt(Boolean(options?.includeConversationMemory)) + turnMedia.note,
        undefined,
        {
          freshSession: false,
          steeringInbox: options?.steeringInbox?.isClosed ? undefined : options?.steeringInbox,
          messageId: options?.messageId, turnId: options?.turnId,
          media: turnMedia.media,
          images: turnMedia.images
        }
      )
    }

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
    /**
     * **气泡里的话是给人看的,诊断进日志。**(Ral 2026-09-22,在 Cowork 上报告,同一份代码)
     *
     * 原来这两句把 `stop: toolUse`、`tools used: 4`、`re-record the skill` 直接写进聊天 ——
     * 前两个是协议字段,第三个在这一轮根本没有技能时不成立。判据没变,只是分流:人得到一句
     * 能照着做的话,原始事实进 Workbench ▸ Log。
     *
     * 见 `micromeet-cowork/apps/cowork/docs/issues/chat-shows-internal-diagnostics-as-user-facing-text.md`
     * ——聊天是两个产品的共同功能(BL 叫 Maestro,Cowork 叫 Cowork),这段按同一份判据同步修改。
     */
    broadcastCodexDebug({
      scope: 'agent',
      phase: 'empty-agent-turn',
      level: 'warn',
      message: `这一轮没有可用产出:${backend} stop=${result.stopReason || 'unknown'} tools=${result.toolCalls ?? 0}`,
      detail: {
        stopReason: result.stopReason || null,
        toolCalls: result.toolCalls ?? 0,
        modelReturnedNothing,
        // 技能/重放都没有的一轮,「re-record the skill」那句建议从来就不成立 —— 记下来,
        // 免得下次又有人把它写回气泡。
        hadSkill: Boolean(skill || skills?.length)
      },
      ts: Date.now()
    })
    // ⚠ 这两句是**契约文案**:渲染层按原文认出它们,再换成 `i18nHelper.maestroControl.chat` 里
    // 那一条(BL 的聊天文案一律在渲染侧组装)。改动必须两边一起改 —— `check-empty-turn-copy.mjs` 会拦。
    const text = modelReturnedNothing
      ? 'The model returned nothing this turn. Send it again, or pick a different model above.'
      : 'I did not get a usable result this turn. Send it again, in different words if that helps.'
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

  private async confirmHostToolCall(request: HostToolConfirmRequest, signal?: AbortSignal, sessionId?: string): Promise<boolean> {
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
    if (signal?.aborted) {
      await this.resolveHostApprovalEvent(eventId, 'denied')
      signal.throwIfAborted()
    }
    const allowed = await taskRegistry.askOperator({
      signal, sessionId,
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
