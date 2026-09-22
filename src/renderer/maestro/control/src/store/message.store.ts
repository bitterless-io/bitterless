import { AGENT_DECISIONS_CHANGED, type AgentDecisionRequest } from '@shared/agentDecision.api';
import { workflowCompletionId } from '@shared/workflowCompletion'
import { workflowCompletionChatText } from '../workflow.presentation'
import { workflowText } from '../workflow.text'
import type { WorkflowIpcApi, WorkflowSnapshot, WorkflowRunSnapshot } from '@shared/agentWorkflow.api'
import { markRaw, nextTick, reactive, toRaw } from 'vue'
import { inject, injectable } from 'inversify'
import { countTokens } from 'gpt-tokenizer'
import { iocHelper } from '@maestro-shared/iocHelper/ioc.helper'
import { AGENT_TURN_CHANNEL, MODEL_RETRY_CHANNEL } from '@maestro-shared/coach.api'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { subscribeControlChannel } from '../controlSubscriptions.service'
import type {
  AgentActivityStep,
  AgentCompactRequest,
  AgentCompactMessage,
  AgentConversationContext,
  AgentMessageSnapshot,
  AgentReply,
  AgentStreamDelta,
  AgentThinkingState,
  AgentTurnFinished,
  AgentTurnRecoverySnapshot,
  AgentTurnSnapshot,
  AgentTurnUpdate,
  CoachXpcContract,
  ModelRetryProgress,
  WorkspaceRef,
  WorkspaceRefResult
} from '@maestro-shared/coach.api'
import type { MaestroChatApi, MaestroChatDetail, MaestroChatMessage, MaestroChatSession, MaestroChatSessionMeta, MaestroCompactionApi } from '@maestro-shared/maestroChat.api'
import type { MaestroTask, MaestroTaskPart } from '@maestro-shared/task.api'
import type {
  ChatAttachment,
  ChatContextUsage,
  ChatFile,
  ChatMessage,
  MessageIntent,
  MessageSession,
  ChatErrorCard,
  MessageSessionSummary,
  MessageSource,
  SessionListItem
} from './message.type'
import { TurnService, type SendResult } from './turn.service'
import { turnDiagnostics } from './turnDiagnostics.service'
import { buildErrorCard } from './errorCard.service'

const workflowApi = createXpcRendererEmitter<WorkflowIpcApi>('WorkflowHandler')
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const maestroChat = createXpcRendererEmitter<MaestroChatApi>('MaestroChatDao')
/**
 * main 侧 `CompactionHandler` —— **凡调 pi 的都在那边**(渲染端 import pi 拿到的是空壳,
 * 编译期一声不吭、运行期才炸;而且摘要要调模型、provider 凭据不进渲染进程)。
 * 字符串必须是 handler 的**类名**。与 cowork 同一份设计
 * (`areas/agent-runtime/agent-design-parity.md` 裁决一)。
 */
const compaction = createXpcRendererEmitter<MaestroCompactionApi>('CompactionHandler')

// 未读会话 id 的落点。localStorage 而不是库:它是**这台机器上这个人看没看过**,
// 不是会话本身的属性 —— 换机器重新算一遍才是对的。cowork 侧同一份设计,键名各自独立。
const UNREAD_STORAGE_KEY = 'bitterless.maestro.unreadSessions'

const readUnreadIds = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(UNREAD_STORAGE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const writeUnreadIds = (ids: string[]): void => {
  try {
    localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* 隐私模式/配额满 —— 未读退化成本次会话内有效,不值得为此报错 */
  }
}

interface SessionOptions {
  title: string
  intent: MessageIntent
  source?: MessageSource
  operationTabId?: string
  autoTitlePending?: boolean
}

const DEFAULT_OPERATION_TAB_ID = 'active-operation-tab'
const DEFAULT_CONTEXT_LIMIT_K = 256
const DEFAULT_CONTEXT_LIMIT_LABEL = '256K'
const DEFAULT_COMPRESSION_REMAINING_PERCENT = 10
const COMPACTING_CONTENT = 'Compacting...'
const COMPACTED_CONTENT = 'Compacting complete.'
// 摘要出来了但没落回 pi 会话 —— 补水通路有了内容,而活着的会话没变小。
// 照实说,不拿 'Compacting complete.' 冒充。
const COMPACT_NOT_APPLIED_CONTENT = 'Compacted summary saved, but the live session was not shrunk.'
const COMPACT_SUMMARY_MAX_CONTEXT_SHARE = 0.45
const COMPACT_SUMMARY_HARD_MAX_CHARS = 500_000
// Auto-scroll "stick to bottom" threshold. While streaming we keep pinning the list to the bottom,
// but once the user scrolls up more than this many px from the bottom we stop — until they scroll
// back down near the bottom, or send a new message. ~120px ≈ a couple of lines of breathing room.
const STICK_TO_BOTTOM_THRESHOLD_PX = 120
// 跳转后那条消息闪光的存活时长。**与 `MessageItem.less` 里 `message-item--jumped` 的动画时长是同一个数**
// —— 改一处必须改另一处:CSS 更短会留下一个静止不动的光环挂在行上,CSS 更长则会被这里提前掐断。
const MESSAGE_JUMP_HIGHLIGHT_MS = 1600

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const placeholderFor = (): string => {
  return 'Start a Maestro conversation…'
}

const emptyDetail = () => ({ compressedContext: '' })

const emptyUsage = (): ChatContextUsage => ({
  usedTokens: 0,
  maxTokens: DEFAULT_CONTEXT_LIMIT_K * 1024,
  ratio: 0,
  percent: 0,
  label: `0 / ${DEFAULT_CONTEXT_LIMIT_LABEL}`,
  compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
  compressionTriggerPercent: 100 - DEFAULT_COMPRESSION_REMAINING_PERCENT,
  compressionTriggered: false
})

const safeTokenCount = (text: string): number => {
  const input = text || ''
  try {
    return countTokens(input)
  } catch {
    return Math.ceil(input.length / 4)
  }
}

const normalizeCompressionRemainingPercent = (value: number): number => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_COMPRESSION_REMAINING_PERCENT
  return Math.max(1, Math.min(90, n))
}

const contentForTokenCount = (message: ChatMessage): string => {
  if (message.promptExcluded) return ''
  const files = message.files?.length ? `\nfiles: ${message.files.map((file) => file.name).join(', ')}` : ''
  return `${message.role}: ${message.content}${files}`
}

const clipChars = (text: string, limit: number): string => {
  const value = (text || '').trim()
  if (value.length <= limit) return value
  return value.slice(0, Math.max(0, limit - 14)).trimEnd() + '\n...[truncated]'
}

const ARCHIVE_PATH = /\.(?:zip|7z|rar|tar|tgz|gz|xz|bz2|bz3|zst|lz4|lzma|lz|sz|br)$/i

const messageTextForPrompt = (message: ChatMessage): string => {
  if (message.type === 'files') {
    const files = (message.files || []).filter(
      (file) => !file.isDirectory && !ARCHIVE_PATH.test(file.path || file.name)
    )
    const archives = (message.files || []).filter(
      (file) => !file.isDirectory && ARCHIVE_PATH.test(file.path || file.name)
    )
    const directories = (message.files || []).filter((file) => file.isDirectory)
    const blocks: string[] = []
    if (files.length) {
      blocks.push(
        'Attached files (documents can be read with read_file; images are path refs for a vision-capable adapter):\n' +
          files.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    if (directories.length) {
      blocks.push(
        'Attached folders (directories — list with list_workspace_files or search_files, then use read_file on an individual entry):\n' +
          directories.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    if (archives.length) {
      blocks.push(
        'Attached archives (inspect with list_archive or unpack with extract_archive; do not use read_file directly):\n' +
          archives.map((file) => (file.path ? `@${file.path}` : file.name)).join('\n')
      )
    }
    return blocks.length ? blocks.join('\n\n') : 'Attached files: (none)'
  }
  return message.content || ''
}

const isPromptContextMessage = (message: ChatMessage): boolean => {
  if (message.promptExcluded || message.compressed || message.streaming || message.type === 'compact') return false
  if (message.id.startsWith('welcome-')) return false
  return Boolean(messageTextForPrompt(message).trim())
}

const plainActivity = (activity?: AgentActivityStep[]): AgentActivityStep[] | undefined =>
  activity
    ?.filter((step) => step.phase !== 'think')
    .map((step) => ({
      phase: step.phase,
      label: step.label,
      ok: Boolean(step.ok),
      ts: step.ts
    }))

const plainFiles = (files?: ChatFile[]): ChatFile[] | undefined =>
  files?.map((file) => ({
    name: file.name,
    path: file.path,
    kind: file.kind,
    action: file.action,
    size: file.size,
    isDirectory: file.isDirectory
  }))

const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T


/**
 * The confirm cards in this session that nobody has answered yet.
 *
 * This is the ONE predicate for "something is waiting on you", shared by the action sheet (which
 * draws the buttons), the status line, and the session list / Sessions entry dot. Sharing is not
 * tidiness: separate copies produce the two self-contradicting states we already shipped once —
 * a status line with no button under it, and a dot still lit after the click
 * (issues/tool-approval-has-no-clickable-button.md).
 *
 * It keys on the MESSAGE, not the task registry: the answer lands on the card first, and a
 * `resolveConfirm` that does not match never clears `pendingConfirm` at all.
 */
export const pendingConfirmMessages = (session: Pick<MessageSession, 'messages'>): ChatMessage[] =>
  (session.messages || []).filter((message) => message.type === 'confirm' && message.confirm && !message.confirm.answer)

export const pendingDecisionMessages = (session: Pick<MessageSession, 'messages'>): ChatMessage[] =>
  (session.messages || []).filter(
    (message) => message.type === 'decision' && message.decision && !message.decision.picked && !message.decision.cancelled
  );

/** 「这个会话有事等你」的唯一判据 —— 审批和拍板都算。状态条、黄点、底部操作面共用它。 */
export const sessionAwaitsAnswer = (session: Pick<MessageSession, 'messages'>): boolean =>
  pendingConfirmMessages(session).length > 0 || pendingDecisionMessages(session).length > 0;

/** @deprecated 名字只说了 confirm,实际语义已扩成"有事等你"。新代码用 `sessionAwaitsAnswer`。 */
export const sessionAwaitsConfirm = sessionAwaitsAnswer;

@injectable()
export class MessageStoreState {
  editingTitleSessionId = ''
  constructor(
    @inject(Symbol.for(TurnService.name))
    public readonly turnService: TurnService
  ) {
    this.turnService.setState(this)
  }

  private scrollNearRaf = 0
  private streamFlushRaf = 0
  private streamBuffers = markRaw(new Map<string, string>())
  private taskBindings = markRaw(new Map<string, { sessionId: string; messageId: string }>())
  private confirmMessages = markRaw(new Map<string, string>())
  private latestTasks = markRaw([] as MaestroTask[])
  private agentTurnRevision = 0
  private pendingAgentTurnFinishes = markRaw(new Map<string, AgentTurnFinished>())
  private agentTurnFinishReplays = markRaw(new Map<string, Promise<void>>())
  private highlightTimer: ReturnType<typeof setTimeout> | null = null
  private sessionSaves = markRaw(new Map<string, Promise<boolean>>())

  sessions: MessageSession[] = []
  historySessions: MessageSessionSummary[] = []
  unreadSessionIds: string[] = readUnreadIds()
  /**
   * 面板此刻显示的会话 —— **由 `channel.store` 单向写进来**。
   *
   * 不反过来让本文件读 `channel.store`:那边已经 import 了本文件,反向 import 会成环,
   * 而 `iocHelper.bind()` 的即时 `container.get` 会把环变成启动崩溃
   * (cowork 侧在 `serviceBag.types.ts` 顶部记过同一个坑)。
   *
   * 连接器 tab 活跃时是空串 —— 那时结束的回合**会**置未读,因为人确实没在看它。
   */
  activeSessionId = ''
  defaultWorkspace: WorkspaceRef | undefined = undefined
  contextLimitK = DEFAULT_CONTEXT_LIMIT_K
  contextLimitLabel = DEFAULT_CONTEXT_LIMIT_LABEL
  compressionRemainingPercent = DEFAULT_COMPRESSION_REMAINING_PERCENT
  initialized = false
  private authGeneration = 0
  private workspaceSelectionGeneration = 0
  private authActive = true
  private subscriptionsBound = false
  activeAgentTurnSnapshots: AgentTurnSnapshot[] = []

  resume(): void {
    this.authActive = true
  }

  reset(): void {
    this.authActive = false
    this.authGeneration += 1
    this.initialized = false
    for (const session of this.sessions) session.turn = undefined
    this.sessions = []
    this.historySessions = []
    this.unreadSessionIds = []
    this.activeSessionId = ''
    this.editingTitleSessionId = ''
    this.defaultWorkspace = undefined
    this.activeAgentTurnSnapshots = []
    this.agentTurnRevision += 1
    this.pendingAgentTurnFinishes.clear()
    this.agentTurnFinishReplays.clear()
    this.sessionSaves.clear()
    this.taskBindings.clear()
    this.confirmMessages.clear()
    this.latestTasks = markRaw([])
    this.workflowUnsaved.clear()
    this.workflowDeliveries.clear()
    this.streamBuffers.clear()
    if (this.streamFlushRaf) cancelAnimationFrame(this.streamFlushRaf)
    if (this.scrollNearRaf) cancelAnimationFrame(this.scrollNearRaf)
    this.streamFlushRaf = 0
    this.scrollNearRaf = 0
    if (this.highlightTimer) clearTimeout(this.highlightTimer)
    this.highlightTimer = null
    this.highlightMessageId = null
    this.listEl = null
  }

  get activeAgentTurnSnapshot(): AgentTurnSnapshot | null {
    return this.activeAgentTurnSnapshots[0] ?? null
  }
  // While true, streaming/agent updates keep the message list pinned to the bottom. Flipped off when
  // the user scrolls up past STICK_TO_BOTTOM_THRESHOLD_PX (see onListScroll), back on when they
  // return near the bottom or send a new message. This is the bool that gates the auto-scroll.
  stickToBottom = true
  /**
   * 刚跳过去的那条消息 —— `MessageItem` 只读它、自己不留副本
   * (留副本就会有两份状态,而"哪条在闪"只有一个真相)。
   *
   * 存 id 而不是 DOM 节点:行归 `MessageList` 的 `v-for` 所有,换会话时 `<ChatPanel :key>`
   * 整棵重挂,存下来的节点当场变野指针。`MESSAGE_JUMP_HIGHLIGHT_MS` 后自清。
   */
  highlightMessageId: string | null = null
  private listEl: HTMLElement | null = null

  async init(): Promise<void> {
    if (!this.authActive || this.initialized) return
    const generation = this.authGeneration
    this.initialized = true
    if (!this.subscriptionsBound) {
      this.subscriptionsBound = true
      xpcRenderer.subscribe(MODEL_RETRY_CHANNEL, (payload) => {
        if (!this.initialized) return
        const progress = payload?.params as ModelRetryProgress | undefined
        const session = progress ? this.getSession(progress.sessionId) : undefined
        if (
          !progress ||
          !session?.turn ||
          session.turn.id !== progress.turnId ||
          session.turn.generation !== progress.generation ||
          session.turn.aborting
        ) {
          return
        }
        session.turn.retry = progress.recovered
          ? undefined
          : { attempt: progress.attempt, max: progress.max }
      })
      xpcRenderer.subscribe(AGENT_TURN_CHANNEL, (payload) => {
        if (!this.initialized) return
        this.applyAgentTurnUpdate(payload.params as AgentTurnUpdate)
      })
      xpcRenderer.subscribe('coach/workspace-changed', (payload) => {
        if (!this.initialized) return
        const params = payload.params as { sessionId?: string; workspace?: WorkspaceRef | null }
        void this.applyWorkspaceBroadcast(params)
      })
      // 经 relay 扇出,不要裸 subscribe:workflow.store 也订阅同一个频道,而 electron-xpc 的
      // subscribe() 是 set(handleName, cb),两处裸订阅会互相静默顶掉。
      subscribeControlChannel('agent/workflows', payload => {
        if (this.initialized) void this.applyWorkflowCompletions(payload.params as WorkflowSnapshot)
      })
      // 待人拍板的 decision(`ask_user`)。主进程持有 pending 状态并广播,渲染端把它投影成
      // 时间线上的一条消息。经 relay 扇出,理由同上。
      subscribeControlChannel(AGENT_DECISIONS_CHANGED, payload => {
        const params = payload.params as { decisions?: AgentDecisionRequest[] } | undefined
        this.applyDecisions(params?.decisions || [])
      })
    }
    const recovery = await coach.getActiveAgentTurn().catch(() => null)
    if (generation !== this.authGeneration) return
    if (recovery) this.applyAgentTurnRecovery(recovery)
    await this.restoreActiveTurnSessions()
    if (generation !== this.authGeneration) return
    await this.refreshDefaultWorkspace()
    if (generation !== this.authGeneration) return
    await this.refreshHistory()
    if (generation !== this.authGeneration) return
    const workflows = await workflowApi.listRuns({}).catch(() => null)
    if (generation !== this.authGeneration) return
    if (workflows) await this.applyWorkflowCompletions(workflows)
  }

  private readonly workflowUnsaved = markRaw(new Set<string>())
  private readonly workflowDeliveries = markRaw(new Map<string, Promise<void>>())
  private async applyWorkflowCompletions(snapshot: WorkflowSnapshot): Promise<void> {
    if (!Array.isArray(snapshot?.runs)) return
    await Promise.all(snapshot.runs.filter(run => run.status !== 'running' && run.status !== 'stopping').map(run => {
      const key = workflowCompletionId(run)
      const existing = this.workflowDeliveries.get(key)
      if (existing) return existing
      const pending = this.applyWorkflowCompletion(run).finally(() => this.workflowDeliveries.delete(key))
      this.workflowDeliveries.set(key, pending)
      return pending
    }))
  }
  private async applyWorkflowCompletion(run: WorkflowRunSnapshot): Promise<void> {
    const session = await this.loadPersistedSession(run.sessionId)
    if (!session) return // The persisted run remains replayable when this chat is available.
    const id = workflowCompletionId(run)
    if (session.messages.some(message => message.id === id)) {
      const existing = session.messages.find((message) => message.id === id)
      if (this.workflowUnsaved.has(id) && existing && await this.persistMessages(session, [existing])) this.workflowUnsaved.delete(id)
      return
    }
    this.workflowUnsaved.add(id)
    const appended = this.withTokenCount({ id, source: 'cowork', role: 'ai', content: workflowCompletionChatText(run, workflowText()), streaming: false,
      // Main inserts this result into its own context, independently of the renderer's hydration.
      promptExcluded: true, ts: run.endedAt ?? run.createdAt })
    session.messages.push(appended)
    if (await this.persistMessages(session, [appended])) this.workflowUnsaved.delete(id)
    if (this.activeSessionId === session.id) this.scrollToBottom()

  }

  createSession(options: SessionOptions): MessageSession {
    const session = this.createEmptySession(options)
    this.updateSessionContextUsage(session)
    this.sessions.push(session)
    // Start durable diagnostics with the chat identity before any model turn or shortcut.
    if (session.source === 'cowork') void (async () => {
      try {
        const result = await coach.ensureSessionIo({ sessionId: session.id, workspace: this.cloneWorkspace(session.detail.workspace) })
        if (!result?.ok) console.warn('[session-io] initialization failed:', result?.error || 'No response')
      } catch (error) {
        console.warn('[session-io] initialization failed:', error)
      }
    })()
    this.restoreActiveTurn(session)
    this.replayTaskSnapshot()
    return session
  }

  async latestActiveSession(): Promise<MessageSession | undefined> {
    const generation = this.authGeneration
    await this.init()
    if (!this.authActive || generation !== this.authGeneration) return undefined
    const existing = this.sessions
      .filter((session) => !session.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (existing) return existing

    const activeSnapshot = this.activeAgentTurnSnapshot
    if (activeSnapshot) {
      const active = await this.loadPersistedSession(activeSnapshot.sessionId)
      if (generation !== this.authGeneration) return undefined
      if (active && !active.archivedAt) return active
      if (!active) return this.createRecoveredTurnSession(activeSnapshot)
    }

    const missedFinish = [...this.pendingAgentTurnFinishes.values()]
      .sort((a, b) => b.turn.startedAt - a.turn.startedAt)[0]
    if (missedFinish) {
      const persisted = await this.loadPersistedSession(missedFinish.turn.sessionId)
      if (generation !== this.authGeneration) return undefined
      if (persisted && !persisted.archivedAt) return persisted
      if (!persisted) {
        const recovered = this.createRecoveredTurnSession(missedFinish.turn)
        await this.replayFinishedAgentTurns(recovered)
        if (generation !== this.authGeneration) return undefined
        return recovered
      }
    }

    for (const summary of this.historySessions.filter((item) => !item.archivedAt)) {
      const session = await this.loadPersistedSession(summary.id)
      if (generation !== this.authGeneration) return undefined
      if (session && !session.archivedAt) return session
    }
    return undefined
  }

  private createRecoveredTurnSession(
    snapshot: AgentTurnSnapshot
  ): MessageSession {
    const session = this.createEmptySession({
      title: snapshot.rootText.trim().split('\n')[0]?.slice(0, 36) || 'Maestro',
      intent: 'chat',
      operationTabId: snapshot.operationTabId
    })
    session.id = snapshot.sessionId
    session.createdAt = snapshot.startedAt
    session.updatedAt = Date.now()
    // A host-authored root — a background workflow finishing — is not something the user said, so
    // it must never enter the transcript as their message, here or on any later reload.
    if (snapshot.state !== 'reserved' && !snapshot.hostAuthored) {
      session.messages.push(
        this.withTokenCount({
          id: uid(),
          source: 'cowork',
          role: 'human',
          content: snapshot.rootText,
          streaming: false,
          ts: snapshot.startedAt
        })
      )
    }
    this.sessions.push(session)
    this.restoreTurnFromSnapshot(session, snapshot)
    this.updateSessionContextUsage(session)
    return session
  }

  async loadPersistedSession(sessionId: string): Promise<MessageSession | undefined> {
    if (!this.authActive) return undefined
    const generation = this.authGeneration
    const existing = this.getSession(sessionId)
    if (existing) return existing

    const stored = await maestroChat.getSession({ id: sessionId }).catch(() => null)
    if (generation !== this.authGeneration) return undefined
    const loadedWhileWaiting = this.getSession(sessionId)
    if (loadedWhileWaiting) return loadedWhileWaiting
    if (!stored) return undefined
    const session = this.fromStoredSession(stored)
    this.sessions.push(session)
    this.restorePersistedBindings(session)
    await this.replayFinishedAgentTurns(session)
    if (generation !== this.authGeneration) return undefined
    this.restoreActiveTurn(session)
    this.replayTaskSnapshot()
    await this.refreshWorkspace(session.id)
    if (generation !== this.authGeneration) return undefined
    return session
  }

  getSession(id: string): MessageSession | undefined {
    return this.sessions.find((session) => session.id === id)
  }

  setActiveAgentTurnSnapshot(snapshot: AgentTurnSnapshot | null, expectedTurnId?: string): void {
    if (!snapshot) {
      this.activeAgentTurnSnapshots = expectedTurnId
        ? this.activeAgentTurnSnapshots.filter((turn) => turn.turnId !== expectedTurnId)
        : []
      return
    }
    const current = this.activeAgentTurnSnapshots.find((turn) => turn.sessionId === snapshot.sessionId)
    if (expectedTurnId && current && current.turnId !== expectedTurnId) return
    this.activeAgentTurnSnapshots = [
      ...this.activeAgentTurnSnapshots.filter((turn) => turn.sessionId !== snapshot.sessionId),
      snapshot
    ]
    const session = this.getSession(snapshot.sessionId)
    if (session) this.restoreActiveTurn(session)
  }

  private applyAgentTurnUpdate(update: AgentTurnUpdate): void {
    if (update.finished) this.queueAgentTurnFinish(update.finished)
    // A getActiveAgentTurn() response can race a newer broadcast. Revisions are Main-monotonic, so
    // stale snapshots may contribute replayable finishes but must never overwrite current ownership.
    if (update.revision < this.agentTurnRevision) {
      this.replayLoadedAgentTurnFinishes()
      return
    }
    this.agentTurnRevision = update.revision
    if (update.finished) this.setActiveAgentTurnSnapshot(null, update.finished.turn.turnId)
    if (update.turn) this.setActiveAgentTurnSnapshot(update.turn)
    this.replayLoadedAgentTurnFinishes()
  }

  private applyAgentTurnRecovery(recovery: AgentTurnRecoverySnapshot): void {
    for (const finished of recovery.finished) this.queueAgentTurnFinish(finished)
    if (recovery.revision >= this.agentTurnRevision) {
      this.agentTurnRevision = recovery.revision
      this.activeAgentTurnSnapshots = recovery.turns ?? (recovery.turn ? [recovery.turn] : [])
      for (const session of this.sessions) this.restoreActiveTurn(session)
    }
    this.replayLoadedAgentTurnFinishes()
  }

  private async restoreActiveTurnSessions(): Promise<void> {
    for (const snapshot of this.activeAgentTurnSnapshots.slice()) {
      const session = await this.loadPersistedSession(snapshot.sessionId)
      const current = this.activeAgentTurnSnapshots.find((turn) => turn.sessionId === snapshot.sessionId)
      if (!current) continue
      if (session) this.restoreActiveTurn(session)
      else this.createRecoveredTurnSession(current)
    }
  }

  private queueAgentTurnFinish(finished: AgentTurnFinished): void {
    this.pendingAgentTurnFinishes.set(
      this.agentTurnKey(finished.turn.sessionId, finished.turn.turnId),
      finished
    )
  }

  private replayLoadedAgentTurnFinishes(): void {
    for (const session of this.sessions) void this.replayFinishedAgentTurns(session)
  }

  private replayFinishedAgentTurns(session: MessageSession): Promise<void> {
    const existing = this.agentTurnFinishReplays.get(session.id)
    if (existing) return existing
    const replay = this.runFinishedAgentTurnReplay(session)
    this.agentTurnFinishReplays.set(session.id, replay)
    const cleanup = (): void => {
      if (this.agentTurnFinishReplays.get(session.id) === replay) {
        this.agentTurnFinishReplays.delete(session.id)
      }
    }
    void replay.then(cleanup, cleanup)
    return replay
  }

  private async runFinishedAgentTurnReplay(session: MessageSession): Promise<void> {
    while (true) {
      const pending = [...this.pendingAgentTurnFinishes.values()]
        .filter((finished) => finished.turn.sessionId === session.id)
        .sort((a, b) => a.turn.startedAt - b.turn.startedAt)
      if (!pending.length) return
      const finished = session.turn
        ? pending.find((candidate) => candidate.turn.turnId === session.turn?.id)
        : pending[0]
      // A different active generation owns this session. Its finish broadcast will clear it and
      // trigger another pass; never replace that live Turn with an older replay.
      if (!finished) return
      if (!session.turn) this.restoreTurnFromSnapshot(session, finished.turn)
      try {
        await this.turnService.finishFromMain(
          session,
          finished.turn.turnId,
          finished.reply,
          finished.reason
        )
      } catch {
        // Keep the unacknowledged Main record for the next renderer/session replay.
        return
      }
      if (session.turn?.id === finished.turn.turnId) return
      this.pendingAgentTurnFinishes.delete(
        this.agentTurnKey(finished.turn.sessionId, finished.turn.turnId)
      )
      await coach
        .ackAgentTurnFinished({
          sessionId: finished.turn.sessionId,
          turnId: finished.turn.turnId
        })
        .catch(() => undefined)
    }
  }

  private restoreActiveTurn(session: MessageSession): void {
    const snapshot = this.activeAgentTurnSnapshots.find((turn) => turn.sessionId === session.id)
    if (!snapshot) return
    if (session.turn?.id === snapshot.turnId) {
      session.turn.generation = snapshot.generation
      session.turn.aborting = snapshot.state === 'aborting'
      session.turn.stopError = snapshot.stopError
      return
    }
    if (session.turn) return
    this.restoreTurnFromSnapshot(session, snapshot)
  }

  private restoreTurnFromSnapshot(session: MessageSession, snapshot: AgentTurnSnapshot): void {
    const root = session.messages.find(
      (message) =>
        message.role === 'human' &&
        message.type !== 'files' &&
        message.ts >= snapshot.startedAt - 1_000 &&
        message.content.trim() === snapshot.rootText
    )
    const nextHuman = root
      ? session.messages.find(
          (message) =>
            message.role === 'human' &&
            message.type !== 'files' &&
            message.id !== root.id &&
            message.ts > root.ts
        )
      : undefined
    const segments = session.messages.filter(
      (message) =>
        message.role === 'ai' &&
        (message.type === undefined || message.type === 'text') &&
        !message.id.startsWith('welcome-') &&
        message.ts >= snapshot.startedAt &&
        (!nextHuman || message.ts < nextHuman.ts)
    )
    session.turn = {
      id: snapshot.turnId,
      generation: snapshot.generation,
      rootText: snapshot.rootText,
      rootHumanMessageId: root?.id,
      hostAuthored: snapshot.hostAuthored,
      phase: segments.some((message) => message.content.trim()) ? 'streaming' : 'accepted',
      lastAssistantMessageId: segments[segments.length - 1]?.id,
      sealedAssistantSegments: segments.length,
      hasStreamedText: segments.some((message) => message.content.trim()),
      streamCoverageComplete: false,
      activity: [],
      thinking: false,
      startedAt: snapshot.startedAt,
      aborting: snapshot.state === 'aborting',
      stopError: snapshot.stopError
    }
  }

  private agentTurnKey(sessionId: string, turnId: string): string {
    return `${sessionId}\u0000${turnId}`
  }

  private restorePersistedBindings(session: MessageSession): void {
    for (const message of session.messages) {
      if (message.type === 'task') {
        for (const task of message.tasks || []) {
          if (!this.taskBindings.has(task.taskId)) {
            this.taskBindings.set(task.taskId, { sessionId: session.id, messageId: message.id })
          }
        }
      }
    }
    // Persisted unanswered cards remain live until the authoritative task snapshot says otherwise.
    // Rebuild the dedupe map before replay; if legacy data contains more than one unanswered card,
    // keep only the newest actionable and close the older duplicate locally.
    const restored = new Set<string>()
    for (const message of session.messages.slice().reverse()) {
      const confirm = message.confirm
      if (!confirm || confirm.answer) continue
      if (restored.has(confirm.taskId) || this.confirmMessages.has(confirm.taskId)) {
        confirm.answer = 'elsewhere'
        continue
      }
      restored.add(confirm.taskId)
      this.confirmMessages.set(confirm.taskId, confirm.confirmId)
    }
  }

  private replayTaskSnapshot(): void {
    if (this.latestTasks.length) this.applyTaskSnapshot(this.latestTasks, false)
  }

  setContextWindow(limitK: number, label: string, compressionRemainingPercent = DEFAULT_COMPRESSION_REMAINING_PERCENT): void {
    this.contextLimitK = limitK > 0 ? limitK : DEFAULT_CONTEXT_LIMIT_K
    this.contextLimitLabel = label || `${this.contextLimitK}K`
    this.compressionRemainingPercent = normalizeCompressionRemainingPercent(compressionRemainingPercent)
    for (const session of this.sessions) this.updateSessionContextUsage(session)
  }

  setListEl(el: HTMLElement | null): void {
    this.listEl = el ? markRaw(el) : null
    if (this.listEl) {
      this.stickToBottom = true
      this.scrollToBottom(true)
    }
  }

  // Bound to the list's scroll event. Sticky while the user is within the threshold of the bottom;
  // scrolling up past it turns auto-scroll off. Guarded write so it only reacts on transitions.
  onListScroll(): void {
    const el = this.listEl
    if (!el) return
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
    if (next !== this.stickToBottom) this.stickToBottom = next
  }

  async compactAllIfNeeded(): Promise<void> {
    for (const session of this.sessions) {
      if (session.archivedAt || session.turn) {
        this.updateSessionContextUsage(session)
        continue
      }
      await this.compactSessionIfNeeded(session)
    }
  }

  async send(sessionId: string, message: string, files?: ChatAttachment[]): Promise<SendResult | null> {
    return await this.turnService.send(sessionId, message, files)
  }

  async stop(sessionId: string): Promise<void> {
    await this.turnService.stop(sessionId)
  }

  async archive(sessionId: string): Promise<boolean> {
    return this.setArchived(sessionId, true)
  }

  async restore(sessionId: string): Promise<boolean> {
    return this.setArchived(sessionId, false)
  }

  private async setArchived(sessionId: string, archived: boolean): Promise<boolean> {
    const session = await this.loadPersistedSession(sessionId)
    if (!session) return false
    return this.queueSessionSave(session.id, async () => {
      if (session.turn || this.activeAgentTurnSnapshots.some((turn) => turn.sessionId === sessionId) || Boolean(session.archivedAt) === archived) return false
      const previous = { archivedAt: session.archivedAt, updatedAt: session.updatedAt }
      session.archivedAt = archived ? Date.now() : undefined
      session.updatedAt = Date.now()
      const ok = await this.saveSessionNow(session)
      if (!ok) Object.assign(session, previous)
      return ok
    })
  }

  async renameSession(sessionId: string, title: string, customized = true): Promise<boolean> {
    const value = title.trim()
    if (!value) return false
    const session = await this.loadPersistedSession(sessionId)
    if (!session) return false
    return this.queueSessionSave(session.id, async () => {
      if (session.archivedAt) return false
      const previous = { title: session.title, titleCustomized: session.detail.titleCustomized, titleRevision: session.detail.titleRevision, updatedAt: session.updatedAt }
      session.title = value
      session.detail.titleCustomized = customized || undefined
      session.detail.titleRevision = (session.detail.titleRevision || 0) + 1
      session.updatedAt = Date.now()
      const ok = await this.saveSessionNow(session)
      if (!ok) {
        session.title = previous.title
        session.detail.titleCustomized = previous.titleCustomized
        session.detail.titleRevision = previous.titleRevision
        session.updatedAt = previous.updatedAt
      }
      return ok
    })
  }

  /** Called once when the first human text supplies the fallback; never from session restore. */
  scheduleSessionTitle(session: MessageSession, message: ChatMessage): void {
    if (session.detail.titleGeneration || session.detail.titleCustomized) return
    const attempt = { requestId: uid(), firstMessageId: message.id, expectedRevision: session.detail.titleRevision || 0 }
    session.detail.titleGeneration = { ...attempt }
    void this.persistSession(session).then(async (saved) => {
      if (!saved || !this.canApplySessionTitle(session, attempt)) return
      const result = await coach.generateSessionTitle({ sessionId: session.id, requestId: attempt.requestId, firstMessageId: attempt.firstMessageId, text: message.content })
      if (result.ok) await this.applySessionTitle(session, attempt, result.title)
    }).catch(() => undefined)
  }

  private canApplySessionTitle(session: MessageSession, attempt: NonNullable<MaestroChatDetail['titleGeneration']>): boolean {
    const current = session.detail.titleGeneration
    return this.getSession(session.id) === session && !session.archivedAt && !session.detail.titleCustomized
      && this.editingTitleSessionId !== session.id && (session.detail.titleRevision || 0) === attempt.expectedRevision
      && current?.requestId === attempt.requestId && current.firstMessageId === attempt.firstMessageId
      && current.expectedRevision === attempt.expectedRevision
      && session.messages.some((message) => message.id === attempt.firstMessageId && message.role === 'human'
        && !message.localOnly && !message.promptExcluded && (!message.type || message.type === 'text') && Boolean(message.content.trim()))
  }

  private async applySessionTitle(session: MessageSession, attempt: NonNullable<MaestroChatDetail['titleGeneration']>, title: string): Promise<boolean> {
    // Check on arrival as well as under the queue: a result received during editing is discarded.
    if (!this.canApplySessionTitle(session, attempt) || typeof title !== 'string' || !title.trim()) return false
    return this.queueSessionSave(session.id, async () => {
      if (!this.canApplySessionTitle(session, attempt)) return false
      const previous = session.title
      session.title = title
      const saved = await this.saveSessionNow(session)
      if (!saved) session.title = previous
      return saved
    })
  }

  // Drop a never-used empty draft; persisted messages are always retained.
  // A session with real content is left untouched — NOT archived: it stays sendable
  // and reachable via the history drawer.
  async discardIfEmpty(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session || this.activeSessionId === sessionId || session.turn || this.shouldPersistSession(session)) return
    const result = await maestroChat.deleteSession({ id: session.id, onlyIfEmpty: true }).catch((error) => {
      console.warn('[maestro] empty draft cleanup failed', error)
      return { ok: false }
    })
    if (!result.ok) return
    if (this.getSession(sessionId) !== session || this.activeSessionId === sessionId || session.turn || this.shouldPersistSession(session)) return
    this.sessions = this.sessions.filter((item) => item.id !== session.id)
    this.markRead(session.id)
    await this.refreshHistory()
  }

  async persistSession(session: MessageSession): Promise<boolean> {
    if (session.source !== 'cowork') return false
    // this.reportAbnormalSaveRate()  // diagnostic, see below
    return this.queueSessionSave(session.id, () => this.saveSessionNow(session))
  }

  // Disabled 2026-09-18 at Ral's request. Kept because it is what named the runaway
  // caller during the workspace-changed incident; re-enable by uncommenting the call above.
//   /**
//    * A save costs the WHOLE session: every message is deep-cloned and the DAO rewrites every row. At
//    * a handful per second that is enough to burn a core and churn gigabytes, and the caller is
//    * invisible afterwards because the work happens inside the write queue's async callback — which is
//    * exactly why a runaway rate shows up in a CPU profile but cannot be attributed to anyone. Naming
//    * the caller costs one stack capture per window, and only while the rate is already abnormal.
//    */
//   private saveRate = { since: 0, count: 0, stack: '' }

//   private reportAbnormalSaveRate(): void {
//     const now = Date.now()
//     if (now - this.saveRate.since >= 2000) {
//       if (this.saveRate.count > 5) {
//         console.warn(`[persist-probe] persistSession ${this.saveRate.count}x in ${now - this.saveRate.since}ms — caller:\n${this.saveRate.stack}`)
//       }
//       this.saveRate = { since: now, count: 0, stack: '' }
//     }
//     this.saveRate.count += 1
//     if (this.saveRate.count === 4) this.saveRate.stack = String(new Error('persist-probe').stack || '').split('\n').slice(1, 8).join('\n')
//   }

  private queueSessionSave(id: string, operation: () => Promise<boolean>): Promise<boolean> {
    const generation = this.authGeneration
    const previous = this.sessionSaves.get(id) || Promise.resolve(true)
    const next = previous.catch(() => false).then(() =>
      this.authActive && generation === this.authGeneration ? operation() : false
    )
    this.sessionSaves.set(id, next)
    void next.finally(() => {
      if (this.sessionSaves.get(id) === next) this.sessionSaves.delete(id)
    }).catch(() => undefined)
    return next
  }

  /**
   * One set of fences, three payload sizes. `write` decides what actually crosses the bridge;
   * the account fence, the identity check, the usage refresh and the history reload are identical
   * no matter how much is written, so a caller can pick the narrowest payload without having to
   * re-implement any of the guarantees
   * (docs/issues/session-save-rewrites-the-whole-session.md).
   */
  private async saveSessionNow(session: MessageSession, write?: () => Promise<boolean>): Promise<boolean> {
    if (!this.authActive || toRaw(this.getSession(session.id)) !== toRaw(session)) return false
    const generation = this.authGeneration
    this.updateSessionContextUsage(session)
    try {
      const ok = write
        ? await write()
        : (await maestroChat.saveSession({ session: this.toStoredSession(session) }))?.ok
      if (generation !== this.authGeneration) return false
      if (!ok) return false
    } catch {
      return false
    }
    await this.refreshHistoryRow(session.id)
    return true
  }

  /**
   * The session row only: title, archive flag, workspace binding, plan. Costs nothing proportional
   * to the history, which is what a metadata change should cost.
   */
  async persistSessionMeta(session: MessageSession): Promise<boolean> {
    if (session.source !== 'cowork') return false
    return this.queueSessionSave(session.id, () => this.saveSessionNow(session, async () =>
      (await maestroChat.saveSessionMeta({ session: this.toStoredSessionMeta(session) }))?.ok === true))
  }

  /**
   * The messages that actually changed, upserted by id, plus the session row. `sortOrder` is the
   * message's index among the session's PERSISTED messages — `localOnly` ones are never written, so
   * the index has to be counted over the same filter `toStoredSession` applies, or a later full
   * rewrite would renumber the rows this wrote.
   */
  async persistMessages(session: MessageSession, changed: ChatMessage[]): Promise<boolean> {
    if (session.source !== 'cowork') return false
    const persisted = session.messages.filter((message) => !message.localOnly)
    // **Match by id, not by object identity.** `session.messages` lives in `reactive()`, so
    // `filter` hands back PROXIES, while a caller that just built and pushed a message holds the
    // RAW literal — `indexOf(raw)` is then `-1`. The old code dropped that entry, fell through to
    // the metadata lane, and **returned `true` for a message it never wrote**
    // (`applyWorkflowCompletion` retired its own retry on that answer, so the workflow result was
    // shown on screen and lost on reload). Resolving through the live element also means the row
    // written is the reactive one, not a stale copy.
    const ordered: Array<{ message: ChatMessage; sortOrder: number }> = []
    for (const message of changed) {
      if (message.localOnly) continue
      const sortOrder = persisted.findIndex((item) => item.id === message.id)
      if (sortOrder < 0) {
        // Not in this session. Never report success for it: the caller decides whether to retry,
        // and a false "saved" is how an unwritten message stops being retried at all.
        console.warn('[maestro] persistMessages: message is not in this session, refusing to report it saved', { sessionId: session.id, messageId: message.id })
        return false
      }
      ordered.push({ message: persisted[sortOrder], sortOrder })
    }
    if (!ordered.length) return this.persistSessionMeta(session)
    return this.queueSessionSave(session.id, () => this.saveSessionNow(session, async () =>
      (await maestroChat.saveMessages({
        session: this.toStoredSessionMeta(session),
        messages: ordered.map(({ message, sortOrder }) => ({ ...this.toStoredMessage(message), sortOrder }))
      }))?.ok === true))
  }

  async chooseWorkspace(sessionId: string): Promise<WorkspaceRefResult | null> {
    this.workspaceSelectionGeneration++
    const session = this.getSession(sessionId)
    if (!session) return null
    const result = await coach.chooseWorkspaceDirectory({ sessionId: session.id }).catch(() => null)
    if (!result?.ok) return result
    this.defaultWorkspace = result.workspace ? this.cloneWorkspace(result.workspace) : undefined
    session.detail = { ...session.detail, workspace: result.workspace }
    session.updatedAt = Date.now()
    // Main already opened Preview; saving history must not delay its failure feedback either.
    void this.persistSessionMeta(session).catch(() => undefined)
    return result
  }

  async stopUsingWorkspace(sessionId: string): Promise<void> {
    this.workspaceSelectionGeneration++
    const session = this.getSession(sessionId)
    if (!session) return
    // 解绑**之前**先把路径拿在手上 —— 下面要用它去比对预览里开着的是不是同一个目录。
    const previousPath = session.detail.workspace?.path
    await coach.setWorkspaceDirectory({ sessionId: session.id, path: '' }).catch(() => null)
    this.defaultWorkspace = undefined
    session.detail = { ...session.detail, workspace: undefined }
    session.updatedAt = Date.now()
    await this.persistSessionMeta(session)
    // Main 只解绑匹配的 Project,保留预览 tab/窗口和独立外部文件。
    if (previousPath) await coach.closeWorkspacePreview({ path: previousPath }).catch(() => null)
  }

  async adoptPreviewWorkspace(sessionId: string, isCurrent: () => boolean): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session || !this.authActive || !isCurrent()) return
    const generation = this.authGeneration
    const selection = this.workspaceSelectionGeneration
    const current = () => this.authActive && generation === this.authGeneration
      && selection === this.workspaceSelectionGeneration && toRaw(this.getSession(sessionId)) === toRaw(session) && isCurrent()
    const result = await coach.adoptPreviewWorkspaceDirectory({ sessionId }).catch(() => null)
    if (!current()) {
      // Main already bound the session, so drop it: this Chat never adopted that Project and
      // `refreshWorkspace` cannot undo it — it re-pushes an existing path and returns early
      // without one. Main compares before releasing, so a newer explicit choice for this session
      // survives; releasing falls back to the shared default workspace until the Chat's own path
      // is re-pushed before its next send.
      if (result?.workspace) await coach.releaseWorkspaceBinding({ sessionId, path: result.workspace.path }).catch(() => null)
      // Main may already have committed the default. Re-read its current value without touching
      // the newer Chat, while logout must not publish anything into the next account's stores.
      if (this.authActive && generation === this.authGeneration) await this.refreshDefaultWorkspace()
      return
    }
    if (!result?.ok || !result.workspace) return
    this.defaultWorkspace = this.cloneWorkspace(result.workspace)
    session.detail = { ...session.detail, workspace: this.cloneWorkspace(result.workspace) }
    session.updatedAt = Date.now()
    await this.persistSessionMeta(session)
  }

  async refreshDefaultWorkspace(): Promise<void> {
    if (!this.authActive) return
    const generation = this.authGeneration
    const selection = this.workspaceSelectionGeneration
    const result = await coach.getWorkspaceDirectory({}).catch(() => null)
    if (generation !== this.authGeneration || selection !== this.workspaceSelectionGeneration) return
    this.defaultWorkspace = result?.ok && result.workspace ? this.cloneWorkspace(result.workspace) : undefined
  }

  async refreshWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.detail.workspace) return
    const result = await coach.setWorkspaceDirectory({ sessionId: session.id, path: session.detail.workspace.path }).catch(() => null)
    if (this.getSession(sessionId) !== session) return
    if (result?.ok && result.workspace) {
      this.defaultWorkspace = this.cloneWorkspace(result.workspace)
      session.detail = { ...session.detail, workspace: result.workspace }
      return
    }
    if (result?.missing || !result?.ok) {
      if (this.defaultWorkspace?.path === session.detail.workspace.path) this.defaultWorkspace = undefined
      session.detail = { ...session.detail, workspace: undefined }
      session.updatedAt = Date.now()
      await this.persistSessionMeta(session)
    }
  }

  async applyWorkspaceBroadcast(params: { sessionId?: string; workspace?: WorkspaceRef | null }): Promise<void> {
    const sessionId = params.sessionId || ''
    if (sessionId === 'default') {
      this.defaultWorkspace = params.workspace ? this.cloneWorkspace(params.workspace) : undefined
      return
    }
    const session = sessionId ? this.getSession(sessionId) : undefined
    if (!session) return
    session.detail = { ...session.detail, workspace: params.workspace || undefined }
    session.updatedAt = Date.now()
    await this.persistSessionMeta(session)
  }

  /**
   * **失败不再静默。** 原来是 `.catch(() => [])`:启动期这一次要是失败(sqlite 窗口/preload 还没就绪
   * 是现实可能),`historySessions` 会永久留空 —— 之后只有写操作才重拉,而空历史的新会话在发出
   * 第一条之前不触发任何写。于是「Cmd+H 永远是空的」且没有任何痕迹
   * (docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md #2)。
   *
   * 兜底行为保持不变(仍然退化成空列表、不往上抛),改的只是**它会说话**;
   * 而「开抽屉时重拉」在 `ChatPanel.vue` 的 `toggleHistory()` 里补。
   */
  /**
   * 往时间线里插一条**本地留痕** —— 不经过模型,也不进模型的上下文。
   *
   * 目前唯一的用处是 `/copy_session_path` 把 jsonl 路径回在会话里(Ral 2026-09-09):
   * toast 会消失,而那个路径正是要拿去 audit 的东西,得留在会话里可选中、可回翻。
   *
   * `promptExcluded: true` 是这条的关键 —— 少了它,一句给人看的路径会占进下一轮的提示词,
   * 而且会被 `/view_context` 导出成"模型看过的历史",那是假的。
   * 也**不落库**:不改 `updatedAt`、不调 `persistSession`，且 `localOnly` 在后续保存时排除它。
   */
  pushLocalNote(sessionId: string, content: string): void {
    const session = this.getSession(sessionId)
    if (!session) return
    // 本地提示不构成模型对话边界，不能封口正在 streaming 的 assistant。
    session.messages.push(
      this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        content,
        streaming: false,
        promptExcluded: true,
        localOnly: true,
        ts: Date.now()
      })
    )
    this.scrollToBottom()
  }

  /**
   * 往时间线插一张**错误卡** —— 所有失败路径的**唯一出口**
   * （Ral 2026-09-10：「需要统一的返回 error 的函数封装」；构造在 `errorCard.service.ts`）。
   *
   * `promptExcluded: true` 是关键:这张卡是给**人**看的诊断,不该占下一轮的提示词,
   * 更不该被 `/view_context` 导出成"模型看过的历史" —— 模型从没见过这段栈。
   */
  pushErrorCard(sessionId: string, err: unknown, options?: { subtitle?: string; title?: string }): void {
    const session = this.getSession(sessionId)
    if (!session) return
    this.turnService.appendTimelineEntry(
      session,
      this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        type: 'error',
        content: '',
        errorCard: buildErrorCard(err, options),
        error: true,
        streaming: false,
        promptExcluded: true,
        ts: Date.now()
      })
    )
    this.scrollToBottom()
  }

  /**
   * 「看全文」弹窗当前展示的那一张。挂在 store 上而不是用 `emit` 往上冒:
   * 卡片长在消息列表深处,而弹窗必须挂在**面板根**（遮罩只该盖住这一个面板，
   * 且落点要与遮罩同一个定位上下文 —— 与 `ContextGraphModal` 同一条先例）。
   */
  errorDetail: ChatErrorCard | null = null

  showErrorDetail(card: ChatErrorCard): void {
    this.errorDetail = card
  }

  closeErrorDetail(): void {
    this.errorDetail = null
  }

  markUnread(sessionId: string): void {
    if (!sessionId || this.unreadSessionIds.includes(sessionId)) return
    this.unreadSessionIds = [...this.unreadSessionIds, sessionId]
    writeUnreadIds(this.unreadSessionIds)
  }

  markRead(sessionId: string): void {
    if (!this.unreadSessionIds.includes(sessionId)) return
    this.unreadSessionIds = this.unreadSessionIds.filter((id) => id !== sessionId)
    writeUnreadIds(this.unreadSessionIds)
  }

  /**
   * 会话列表:**未读 → 进行中 → 已读**,段内按 `updatedAt` 倒序
   * (docs/features/maestro-session-list-unread.md #1)。
   *
   * 未读排在进行中之前,是因为进行中的**还会自己回来找你**(它结束时会变成未读),
   * 而未读是已经等着你、且没人会再提醒的那些 —— 把「需要你现在做事」的排前面。
   *
   * 数据来自两处并合:活着的会话(带 `turn`,只有内存里有)+ 库里的概要(标题/预览/时间)。
   * 两处都要遍历 —— 只读库的话「刚新建、还没发过消息」的会话不在列表里。
   */
  get sessionListItems(): SessionListItem[] {
    const live = new Map(this.sessions.map((session) => [session.id, session]))
    const seen = new Set<string>()
    const items: SessionListItem[] = []
    const push = (id: string, title: string, preview: string, updatedAt: number, archivedAt?: number): void => {
      const session = live.get(id)
      if (seen.has(id) || (session ? session.archivedAt : archivedAt)) return
      seen.add(id)
      items.push({
        id,
        title: session?.title || title || 'Maestro',
        preview,
        updatedAt: session?.updatedAt || updatedAt,
        running: Boolean(session?.turn || this.activeAgentTurnSnapshots.some((turn) => turn.sessionId === id)),
        unread: this.unreadSessionIds.includes(id),
        // Only a live session can hold a pending confirm — the task registry is in memory and a
        // persisted summary carries no messages.
        awaitingConfirm: Boolean(session && sessionAwaitsConfirm(session))
      })
    }
    for (const summary of this.historySessions) {
      push(summary.id, summary.title || '', summary.preview || '', summary.updatedAt, summary.archivedAt)
    }
    for (const session of this.sessions) push(session.id, session.title, '', session.updatedAt, session.archivedAt)
    const rank = (item: SessionListItem): number => (item.unread ? 0 : item.running ? 1 : 2)
    return items.sort((a, b) => (rank(a) === rank(b) ? b.updatedAt - a.updatedAt : rank(a) - rank(b)))
  }

  /** 正在跑的会话数 —— 工具条上的转圈计数(灰的:在跑是「还没到你」)。 */
  get runningSessionCount(): number {
    return this.sessionListItems.filter((item) => item.running).length
  }

  /** 有未读结论的会话数 —— Sessions 图标上的蓝色角标。 */
  /**
   * Sessions with a confirm still waiting for an answer — the amber count on the Sessions entry
   * (Ral 2026-09-18:「chat header 操作栏如果需要 confirm 这里应该显示一个黄点+数字，点开的
   * session 列表应该也有黄点，点进去操作 confirm 或拒绝后更新黄点的展示」).
   */
  get awaitingConfirmSessionCount(): number {
    return this.sessionListItems.filter((item) => item.awaitingConfirm).length
  }

  get unreadSessionCount(): number {
    return this.sessionListItems.filter((item) => item.unread).length
  }

  async refreshHistory(): Promise<void> {
    if (!this.authActive) return
    const generation = this.authGeneration
    try {
      const list = await maestroChat.listSessions({})
      if (generation !== this.authGeneration) return
      this.historySessions = list
      turnDiagnostics.emit('history', { action: 'refresh', ok: true, count: list.length })
    } catch (err) {
      turnDiagnostics.emit('history', { action: 'refresh', ok: false, error: String(err), kept: this.historySessions.length })
    }
  }

  /**
   * Re-read the history row of the ONE session a save touched, instead of the whole list.
   *
   * A save changes one conversation; recomputing `messageCount` and `preview` for every other one
   * re-reads the entire message table to arrive at values that cannot have changed. That was
   * invisible while a save itself cost the whole session — now that the write is proportional to
   * the edit, this read is the remaining whole-database cost on every save
   * (docs/issues/every-save-recounts-the-whole-history.md).
   *
   * Still derived, never cached: the row comes from the same projection `listSessions` uses, so
   * there is no stored counter to drift out of step with the messages it counts.
   *
   * **Empty list ⇒ fall back to the full pull.** An empty `historySessions` means the startup load
   * never succeeded (sqlite window / preload not ready is a real possibility), and the recovery for
   * that is precisely "the next write re-pulls"
   * (docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md #2). Narrowing every save would
   * quietly remove that recovery, so the narrow path only applies once there is a list to patch.
   */
  private async refreshHistoryRow(sessionId: string): Promise<void> {
    if (!this.authActive) return
    if (!this.historySessions.length) return await this.refreshHistory()
    const generation = this.authGeneration
    try {
      const summary = await maestroChat.getSessionSummary({ id: sessionId })
      if (generation !== this.authGeneration) return
      const rest = this.historySessions.filter((item) => item.id !== sessionId)
      // Stable sort on `updatedAt` descending reproduces the list query's `ORDER BY s.updated_at
      // DESC`; ties keep their previous relative order, which is as defined as the query itself is.
      this.historySessions = (summary ? [...rest, summary] : rest).sort((a, b) => b.updatedAt - a.updatedAt)
      turnDiagnostics.emit('history', { action: 'row', ok: true, sessionId, found: Boolean(summary), count: this.historySessions.length })
    } catch (err) {
      turnDiagnostics.emit('history', { action: 'row', ok: false, sessionId, error: String(err), kept: this.historySessions.length })
    }
  }

  applyTaskSnapshot(tasks: MaestroTask[], remember = true): void {
    if (remember) this.latestTasks = markRaw(tasks.slice())
    for (const task of tasks) {
      const confirmSession = task.sessionId ? this.getSession(task.sessionId) : undefined
      if (confirmSession) this.syncTaskConfirm(confirmSession, task)
      if (task.transient) continue

      const bound = this.taskBindings.get(task.id) || this.registerTaskBinding(task)
      if (!bound) continue
      const session = this.getSession(bound.sessionId)
      const message = session?.messages.find((item) => item.id === bound.messageId)
      if (!message || !session) continue
      if (!message.tasks) message.tasks = []
      const index = message.tasks.findIndex((item) => item.taskId === task.id)
      const current = index < 0 ? undefined : message.tasks[index]
      if (
        current &&
        current.state.time.update === task.state.time.update &&
        current.state.stalled === task.state.stalled
      ) {
        continue
      }
      const part: MaestroTaskPart = {
        type: 'task',
        taskId: task.id,
        callId: task.callId,
        name: task.name,
        kind: task.kind,
        state: task.state
      }
      if (index < 0) {
        message.tasks.push(part)
        this.scheduleScrollToBottomIfNear()
      } else {
        message.tasks[index] = part
      }
      if (task.state.status === 'completed' || task.state.status === 'error') {
        void this.persistSession(session)
      }
    }
  }

  /**
   * 广播来的待答 decision → 时间线消息。**只增不改**:已经在时间线上的不重画(会抹掉人点了
   * 一半的选择);从广播里消失的说明已被答掉,答案由 `answerDecision()` 就地写在卡上。
   */
  private applyDecisions(decisions: AgentDecisionRequest[]): void {
    for (const decision of decisions) {
      const session = this.getSession(decision.sessionId);
      if (!session) continue;
      if (session.messages.some(message => message.decision?.decisionId === decision.decisionId)) continue;
      session.messages.push(this.withTokenCount({
        id: uid(), source: 'cowork', role: 'ai', type: 'decision', content: '', streaming: false,
        promptExcluded: true, ts: Date.now(), decision: { ...decision }
      }));
    }
  }

  /**
   * 人点了提交或取消。**先写卡、再发 XPC** —— 判据是"卡上有没有答案",答案一落卡,
   * 状态条与黄点立刻消失;反过来先等主进程回,那几十毫秒里状态条还在喊「等你」而人已经点完了。
   */
  async answerDecision(decisionId: string, picked?: string[][]): Promise<{ ok: boolean }> {
    for (const session of this.sessions) {
      const message = session.messages.find(item => item.decision?.decisionId === decisionId);
      if (!message?.decision) continue;
      if (picked) message.decision.picked = picked;
      else message.decision.cancelled = true;
      break;
    }
    return await coach.respondAgentDecision(picked ? { decisionId, picked } : { decisionId, cancelled: true });
  }

  private syncTaskConfirm(session: MessageSession, task: MaestroTask): void {
    const pending = task.state.pendingConfirm
    const emitted = this.confirmMessages.get(task.id)
    if (pending) {
      if (emitted === pending.id) return
      if (emitted) {
        const previous = session.messages.find(
          (item) => item.confirm?.taskId === task.id && item.confirm?.confirmId === emitted
        )
        if (previous?.confirm && !previous.confirm.answer) previous.confirm.answer = 'elsewhere'
      }
      const message = this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        type: 'confirm',
        content: '',
        streaming: false,
        promptExcluded: true,
        ts: Date.now(),
        confirm: {
          taskId: task.id,
          confirmId: pending.id,
          title: pending.title,
          detail: pending.detail,
          confirmLabel: pending.confirmLabel,
          cancelLabel: pending.cancelLabel,
          payload: pending.payload
        }
      })
      this.turnService.appendTimelineEntry(session, message)
      this.confirmMessages.set(task.id, pending.id)
      this.stickToBottom = true
      this.scrollToBottom(true)
      // 这一处仍走全量:`appendTimelineEntry` 会顺手封口上一个助手段落,那一条不在任何
      // `changed` 里,换成窄通道会把它的终稿留到回合结束才写
      // (docs/issues/turn-and-compaction-saves-still-rewrite.md 的第 4 步)。
      void this.persistSession(session)
      return
    }
    if (!emitted) return
    this.confirmMessages.delete(task.id)
    const message = session.messages.find(
      (item) => item.confirm?.taskId === task.id && item.confirm?.confirmId === emitted
    )
    if (message?.confirm && !message.confirm.answer) {
      message.confirm.answer = 'elsewhere'
      // 撤回这一支只改一条已有消息,没有追加、没有封口 → 走窄通道(审计的第 2 步)。
      void this.persistMessages(session, [message])
    }
  }

  async answerConfirm(message: ChatMessage, confirm: boolean): Promise<{ ok: boolean }> {
    const card = message.confirm
    if (!card || card.answer) return { ok: false }
    const session = this.sessions.find((item) => item.messages.includes(message))
    card.answer = confirm ? 'confirm' : 'cancel'
    const result = await coach
      .respondTaskConfirm({ taskId: card.taskId, confirmId: card.confirmId, confirm })
      .catch(() => ({ ok: false }))
    if (!result.ok) card.answer = 'elsewhere'
    // 一条消息、没有追加 → 窄通道(审计的第 2 步)。落库在 await 之后:写的是最终答案,
    // 包含失败时改成的 `elsewhere`,不然库里会留一个乐观的 confirm 而那次投递其实失败了。
    if (session) await this.persistMessages(session, [message])
    return result
  }

  pushActivity(step: AgentActivityStep): void {
    this.turnService.pushActivity(step)
  }

  pushThinking(payload: AgentThinkingState): void {
    this.turnService.pushThinking(payload)
  }

  pushStream(payload: AgentStreamDelta): void {
    this.turnService.pushStream(payload)
  }

  // Pin the list to the bottom. `force` scrolls unconditionally (mount / user-sent message); without
  // it, the scroll is gated by stickToBottom — and re-checked inside the deferred callbacks so a
  // scroll scheduled before the user scrolled up won't yank them back down mid-stream.
  scrollToBottom(force = false): void {
    if (!force && !this.stickToBottom) return
    if (!this.listEl) return
    nextTick(() => {
      if (!force && !this.stickToBottom) return
      const el = this.listEl
      if (!el) return
      el.scrollTop = el.scrollHeight
      requestAnimationFrame(() => {
        if (!force && !this.stickToBottom) return
        const node = this.listEl
        if (node) node.scrollTop = node.scrollHeight
      })
    })
  }

  /**
   * 滚到某条消息并让它闪一下 —— `/view_context_graph` 弹窗里点一个块的落点。
   *
   * **第一件事必须是松开黏底**,而且要在写闪光、在任何测量之前:本文件里有 5 处无条件的
   * `scrollToBottom(true)`,`setListEl` 每次挂载还会把 `stickToBottom` 重新武装成 true。
   * 晚松一步,流式回合就会在下一帧把人从跳转落点拽回底部 —— 现场表现是「点了没反应」,
   * 而不是「跳过去又回来」,因果极难对上。
   *
   * **返回值来自第一次同步测量。** 调用方(弹窗)要当场知道跳到没跳到才能决定关不关自己,
   * 等不到 `nextTick`。后两次测量只补偿行高变化,不会改变这个结论。
   *
   * 找不到时**不把 `stickToBottom` 还原**:弹窗里认领不到消息的块本身就是不可点的,
   * 这条 `false` 只是防御性的死路;为它加一条还原分支等于给一个走不到的分支写状态回滚。
   */
  scrollToMessage(messageId: string): boolean {
    this.stickToBottom = false
    this.highlightMessageId = messageId
    if (this.highlightTimer) clearTimeout(this.highlightTimer)
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = null
      // 这 1.6s 内又跳去了别的消息 —— 那次闪光归它自己的定时器管,这里不能顺手抹掉。
      if (this.highlightMessageId === messageId) this.highlightMessageId = null
    }, MESSAGE_JUMP_HIGHLIGHT_MS)

    if (!this.parkMessageRow(messageId)) return false
    // 与 `scrollToBottom` 同一套三次测量:同步一次定结论,`nextTick` + `requestAnimationFrame`
    // 两次跟住流式 markdown 改出来的行高(代码块与表格落地时行高会跳,一次测量会停偏)。
    nextTick(() => {
      this.parkMessageRow(messageId)
      requestAnimationFrame(() => {
        this.parkMessageRow(messageId)
      })
    })
    return true
  }

  /**
   * 把某条消息停在视口**上四分之一处**,不贴顶 —— 跳过去的目的是**读它**,贴顶会把
   * 它上面的来龙去脉全推出屏幕。
   *
   * 遍历比对 `data-message-id` 而不是拼一个属性选择器:消息 id 来自 `uid()` 与库里的历史数据,
   * 拼进选择器就得先做 CSS 转义,漏一次是运行期 `SyntaxError`,而不是一次落空的跳转。
   *
   * `offsetTop` 的 offsetParent 是 `.message-list`(它 `position: relative`),而滚动容器
   * `.message-list__scroll` 正好铺在它原点上 —— 于是这个值就是内容坐标系里的位置,只差滚动容器
   * 那 8px padding,落点上无所谓。关键是 **`offsetTop` 与 `scrollTop` 无关**,所以连续三次
   * 测量不会自我叠加着把列表越滚越远。
   */
  private parkMessageRow(messageId: string): boolean {
    const el = this.listEl
    if (!el) return false
    for (const node of Array.from(el.querySelectorAll('[data-message-id]'))) {
      if (node.getAttribute('data-message-id') !== messageId) continue
      el.scrollTop = Math.max(0, (node as HTMLElement).offsetTop - el.clientHeight / 4)
      return true
    }
    return false
  }

  private createEmptySession(options: SessionOptions): MessageSession {
    const now = Date.now()
    const session: MessageSession = {
      id: uid(),
      source: options.source || 'cowork',
      operationTabId: options.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: options.title,
      intent: options.intent,
      placeholder: placeholderFor(),
      // Maestro chats accept file attachments (read by the agent's read_file tool);
      // connector/customer-facing channels do not.
      allowFiles: (options.source || 'cowork') === 'cowork',
      messages: [],
      detail: { ...emptyDetail(), autoTitlePending: options.autoTitlePending || undefined, workspace: this.cloneWorkspace(this.defaultWorkspace) },
      contextUsage: emptyUsage(),
      createdAt: now,
      updatedAt: now
    }
    return session
  }

  async dispatch(
    session: MessageSession,
    message: string,
    currentHumanMessageId: string | undefined,
    attachedPaths: string[] | undefined,
    intent: 'root' | 'steering',
    turnId: string,
    context?: AgentConversationContext,
    snapshot?: AgentMessageSnapshot
  ): Promise<AgentReply> {
    return await coach.sendAgentMessage({
      sessionId: session.id,
      turnId,
      intent,
      message,
      messageId: currentHumanMessageId,
      snapshot,
      context: context || this.buildAgentContext(session, currentHumanMessageId, attachedPaths)
    })
  }

  finishAssistant(msg: ChatMessage, full: string): void {
    const session = this.sessions.find((item) => item.messages.includes(msg))
    if (session) this.flushStreamBuffer(session.id)
    if (!msg.content.trim()) msg.content = full
    msg.thinking = false
    msg.streaming = false
    this.withTokenCount(msg)
    this.scrollToBottom()
  }

  private cloneWorkspace(workspace?: WorkspaceRef): WorkspaceRef | undefined {
    return workspace ? { ...workspace } : undefined
  }

  private shouldPersistSession(session: MessageSession): boolean {
    return session.source === 'cowork' && Boolean(session.archivedAt || session.detail.titleCustomized || session.detail.draft?.text || session.detail.draft?.files.length || session.messages.some((message) => !message.id.startsWith('welcome-')))
  }

  async compactSessionIfNeeded(session: MessageSession, _options?: { protectMessageIds?: Set<string> }): Promise<boolean> {
    this.updateSessionContextUsage(session)
    return false // Pi AgentSession exclusively schedules native compaction.
  }

  private selectCompactCandidates(session: MessageSession, protectMessageIds: Set<string>): ChatMessage[] {
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    const recentFloor = maxTokens <= 2048 ? 2 : 6
    const recentTokenTarget = maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000)
    const promptMessages = session.messages.filter(isPromptContextMessage)
    const protectedTail = new Set<string>(protectMessageIds)
    let recentCount = 0
    let recentTokens = 0

    for (let i = promptMessages.length - 1; i >= 0; i -= 1) {
      const message = promptMessages[i]
      if (protectMessageIds.has(message.id)) {
        protectedTail.add(message.id)
        continue
      }
      if (recentCount < recentFloor || recentTokens < recentTokenTarget) {
        protectedTail.add(message.id)
        recentCount += 1
        recentTokens += message.tokenCount || safeTokenCount(contentForTokenCount(message))
        continue
      }
      break
    }

    const removable = promptMessages.filter((message) => !protectedTail.has(message.id))
    if (!removable.length) return []

    const targetTokens = Math.round(maxTokens * 0.62)
    const needReduce = Math.max(1, session.contextUsage.usedTokens - targetTokens)
    const selected: ChatMessage[] = []
    let selectedTokens = 0
    for (const message of removable) {
      selected.push(message)
      selectedTokens += (message.tokenCount || safeTokenCount(contentForTokenCount(message))) + 4
      if (selectedTokens >= needReduce) break
    }
    return selected
  }

  private selectCompactBridgeMessages(session: MessageSession, compactedMessages: ChatMessage[]): ChatMessage[] {
    const compactedIds = new Set(compactedMessages.map((message) => message.id))
    const last = compactedMessages[compactedMessages.length - 1]
    const startIndex = last ? session.messages.findIndex((message) => message.id === last.id) + 1 : 0
    return session.messages
      .slice(Math.max(0, startIndex))
      .filter((message) => !compactedIds.has(message.id) && isPromptContextMessage(message))
      .slice(0, 4)
  }

  /**
   * 真数据的**否决票** —— 渲染端的启发式先说该压了,再问 main「按真 usage 算,到线了吗」。
   *
   * **只有 `under-threshold` 会拦下来**:那是真数说没到线,那就是没到线。`no-usage`(账本里
   * 还没有这个会话)、跨进程异常、解析不到模型 —— 一律放行,回落到渲染端自己的判断。
   * 与 cowork 的 `confirmRealUsage` 同一语义。
   *
   * 为什么是否决而不是主触发:渲染端的账是**它自己**要用的(进度条、`compressed` 标记都按它走),
   * 而真 usage 只有 main 知道。让真数当主触发就等于把渲染端的显示与它自己的决定拆成两套口径。
   *
   * 参数不发明新数字,用本仓已有的两个:
   * · `reserveTokens` = 「要留多少余量」,正是 `compressionRemainingPercent` 的语义(pi 的判据是
   *   `used > window - reserve`)。**按比例算,不写死** —— 写死的余量在小窗口模型上会让它永远在压缩;
   * · `keepRecentTokens` = `selectCompactCandidates` 里那个受保护尾部预算,同一把尺。
   */
  private async confirmRealUsage(session: MessageSession): Promise<boolean> {
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    try {
      const reply = await compaction.shouldCompact({
        sessionId: session.id,
        reserveTokens: Math.round((maxTokens * this.compressionRemainingPercent) / 100),
        keepRecentTokens: maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000)
      })
      return reply.shouldCompact || reply.reason !== 'under-threshold'
    } catch {
      return true
    }
  }

  /**
   * 让 main 压一次 —— 摘要 + **把结果落回活着的 pi 会话**。
   *
   * 返回 `applied` 而不只是一段摘要,是因为两者的后果不同:摘要生成成功只代表有一段文字,
   * **只有 `applied:true` 才代表模型看到的上下文真的变小了**。调用方按它决定要不要给渲染端
   * 消息打 `compressed` 标 —— 打错的后果见 `compactSessionIfNeeded` 里那段注释。
   *
   * 失败时回落到确定性摘要(`buildFallbackCompactSummary`):那段文字对**补水**仍然有用
   * (重启后 `compressedContext` 是恢复历史的唯一来源),只是它没有让活着的会话变小。
   * 所以 `applied` 照实报 false,不拿兜底冒充一次成功的压缩。
   */
  private async requestMainCompaction(
    session: MessageSession,
    candidates: ChatMessage[],
    bridgeMessages: ChatMessage[]
  ): Promise<{ summary: string; applied: boolean; error?: string }> {
    const maxChars = this.compactSummaryMaxChars()
    const maxTokens = Math.max(1, session.contextUsage.maxTokens || this.contextLimitK * 1024)
    try {
      const reply = await compaction.compact({
        sessionId: session.id,
        keepRecentTokens: maxTokens <= 2048 ? Math.round(maxTokens * 0.3) : Math.min(Math.round(maxTokens * 0.25), 12000),
        // 迁移兜底而已:main 优先用自己 entry 树上最后一条 compaction entry 作为 S₁,
        // 只有树上还没有时才用这个(老会话的 `detail.compressedContext`)。
        // ② 用户原话链**不在这里给** —— main 自己从 `<userData>/chain/<sessionId>.jsonl` 建
        // (`compaction.handler.ts`)。渲染端存的是用户敲的原文,而 main 发出去的是长粘贴换过的
        // 引用;渲染端建链等于把被换掉的长粘贴在第一次压缩时原样注入回来。这条路只能有一个来源。
        previousSummary: session.detail.compressedContext || undefined
      })
      if (reply.ok && reply.summary.trim()) {
        return { summary: clipChars(reply.summary, maxChars), applied: reply.applied, error: reply.error }
      }
      return {
        summary: await this.buildCompactSummary(session, candidates, bridgeMessages),
        applied: false,
        error: reply.error || 'compact-failed'
      }
    } catch (error) {
      return {
        summary: await this.buildCompactSummary(session, candidates, bridgeMessages),
        applied: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async buildCompactSummary(session: MessageSession, messages: ChatMessage[], bridgeMessages: ChatMessage[]): Promise<string> {
    const maxChars = this.compactSummaryMaxChars()
    const previousSummary = session.detail.compressedContext || ''
    const previous = previousSummary.trim()
    const request: AgentCompactRequest = {
      previousSummary,
      messages: messages.map((message) => this.toCompactMessage(message)),
      bridgeMessages: bridgeMessages.map((message) => this.toCompactMessage(message)),
      maxSummaryChars: maxChars,
      targetContextLabel: this.contextLimitLabel
    }

    try {
      const reply = await coach.compactConversation(jsonSafe(request))
      if (reply.ok && reply.summary.trim()) return clipChars(reply.summary, maxChars)
    } catch {
      /* fall through to deterministic compact summary */
    }

    return this.buildFallbackCompactSummary(previous, messages, bridgeMessages, maxChars)
  }

  private compactSummaryMaxChars(): number {
    const maxTokens = Math.max(1, this.contextLimitK * 1024)
    const summaryChars = Math.round(maxTokens * 4 * COMPACT_SUMMARY_MAX_CONTEXT_SHARE)
    return Math.max(1600, Math.min(COMPACT_SUMMARY_HARD_MAX_CHARS, summaryChars))
  }

  private toCompactMessage(message: ChatMessage): AgentCompactMessage {
    return {
      role: message.role,
      content: messageTextForPrompt(message),
      ts: message.ts
    }
  }

  private buildFallbackCompactSummary(previous: string, messages: ChatMessage[], bridgeMessages: ChatMessage[], maxChars: number): string {
    const lines = [
      '# Compact Summary',
      '## Durable Facts',
      `Updated at: ${new Date().toISOString()}`,
      previous ? clipChars(previous, Math.round(maxChars * 0.72)) : '- No previous summary.',
      '## Current User Goal',
      '- Continue the Maestro chat using the compacted history plus newer verbatim turns.',
      '## Decisions And Constraints',
      '- Newer uncompressed messages override older compacted details if they conflict.',
      '## Open Threads',
      '- Preserve unresolved user requests, important data, and browser/app state from the compacted range.',
      '## Newly Compacted Range'
    ].filter(Boolean)

    for (const message of messages) {
      const role = message.role === 'human' ? 'Human' : 'Assistant'
      const text = clipChars(messageTextForPrompt(message), 700)
      if (text) lines.push(`- ${role}: ${text}`)
    }

    if (bridgeMessages.length) {
      lines.push('## Recent Handoff Notes')
      for (const message of bridgeMessages) {
        const role = message.role === 'human' ? 'Human' : 'Assistant'
        const text = clipChars(messageTextForPrompt(message), 360)
        if (text) lines.push(`- Boundary ${role}: ${text}`)
      }
    }

    return clipChars(lines.join('\n'), maxChars)
  }

  private latestCompactSummary(session: MessageSession): string {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.type === 'compact' && message.compactSummary) return message.compactSummary
    }
    return session.detail.compressedContext || ''
  }

  buildAgentContext(session: MessageSession, currentHumanMessageId?: string, attachedPaths?: string[]): AgentConversationContext {
    const recentMessages: AgentConversationContext['recentMessages'] = []
    const recentBudget = Math.max(256, Math.min(Math.round((session.contextUsage.maxTokens || this.contextLimitK * 1024) * 0.35), 16000))
    let used = 0

    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.id === currentHumanMessageId || !isPromptContextMessage(message)) continue
      const text = messageTextForPrompt(message).trim()
      const tokens = message.tokenCount || safeTokenCount(contentForTokenCount(message))
      if (recentMessages.length >= 4 && used + tokens > recentBudget) break
      recentMessages.unshift({ role: message.role, content: clipChars(text, 4000), ts: message.ts })
      used += tokens + 4
    }

    return {
      compactSummary: this.latestCompactSummary(session),
      recentMessages,
      attachedPaths: attachedPaths?.length ? attachedPaths.slice() : undefined,
      /**
       * **必须 clone,不能按引用递。**
       *
       * `session` 住在 `reactive()` 里,所以 `session.detail.workspace` 是一个 **Proxy**,
       * 而 Proxy **过不了 structured clone** —— 整个 `sendAgentMessage` 会在跨进程边界当场抛
       * `An object could not be cloned.`,消息**根本没离开渲染进程**(所以 main 侧一行日志都没有,
       * 耗时 0ms)。症状是「发了没回复、状态条永久 waiting」(Ral 2026-09-10)。
       *
       * 为什么以前没坏:`workspace` 只在**绑定了工作区之后**才非空 —— 没绑时是 `undefined`,
       * 可克隆。所以它是"绑了工作区就再也发不出消息",不是随机故障。
       *
       * 上面那三个字段本来就安全:`recentMessages` 每一项都是新建的字面量、`attachedPaths`
       * 是 `.slice()` 出来的字符串数组、`compactSummary` 是字符串。**只有这一个是引用**。
       *
       * `cloneWorkspace()` 这个方法本来就在(refreshWorkspace / applyWorkspaceBroadcast 都用它),
       * 唯独这里漏了。`WorkspaceRef` 全是原始值,浅拷贝就够。
       */
      workspace: this.cloneWorkspace(session.detail.workspace)
    }
  }

  withTokenCount<T extends ChatMessage>(message: T): T {
    if (message.promptExcluded) {
      message.tokenCount = 0
      return message
    }
    message.tokenCount = safeTokenCount(contentForTokenCount(message))
    return message
  }

  updateSessionContextUsage(session: MessageSession): void {
    const compressedTokens = session.detail.compressedContext ? safeTokenCount(session.detail.compressedContext) : 0
    const messageTokens = session.messages.reduce((sum, message) => {
      if (message.compressed || message.promptExcluded) return sum
      const tokens = message.tokenCount || safeTokenCount(contentForTokenCount(message))
      message.tokenCount = tokens
      return sum + tokens + 4
    }, 0)
    const usedTokens = compressedTokens + messageTokens
    const maxTokens = this.contextLimitK * 1024
    const ratio = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0
    const compressionRemainingPercent = this.compressionRemainingPercent
    const compressionTriggerPercent = 100 - compressionRemainingPercent
    const percent = Math.round(ratio * 100)
    session.contextUsage = {
      usedTokens,
      maxTokens,
      ratio,
      percent,
      label: `${usedTokens.toLocaleString()} / ${this.contextLimitLabel}`,
      compressionRemainingPercent,
      compressionTriggerPercent,
      compressionTriggered: percent >= compressionTriggerPercent
    }
  }

  private toStoredSessionMeta(session: MessageSession): MaestroChatSessionMeta {
    return {
      id: session.id,
      operationTabId: session.operationTabId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archivedAt: session.archivedAt,
      detail: {
        compressedContext: session.detail.compressedContext || '',
        titleCustomized: session.detail.titleCustomized,
        autoTitlePending: session.detail.autoTitlePending,
        titleRevision: session.detail.titleRevision,
        titleGeneration: session.detail.titleGeneration ? { ...session.detail.titleGeneration } : undefined,
        draft: session.detail.draft ? jsonSafe(session.detail.draft) : undefined,
        compressedUntilMessageId: session.detail.compressedUntilMessageId,
        compressedAt: session.detail.compressedAt,
        // 同 `buildAgentContext`:**必须 clone**。`saveSession` 也是跨进程边界,
        // 递一个响应式 Proxy 会让整次持久化抛 `An object could not be cloned.` ——
        // 而 `persistSession` 把它 `catch { /* best effort */ }` 吞了,于是
        // **只要绑了工作区,会话就一直静默存不进库**(2026-09-10 与发送失败同一根因)。
        workspace: this.cloneWorkspace(session.detail.workspace)
      }
    }
  }

  // One message, in exactly the shape the row binding expects. Shared by the full rewrite and
  // the incremental upsert so the two paths cannot drift apart.
  private toStoredMessage(message: ChatMessage): MaestroChatMessage {
    return {
      id: message.id,
      source: 'cowork',
      role: message.role,
      type: message.type || 'text',
      content: message.content,
      files: plainFiles(message.files),
      skill: message.skill ? jsonSafe(message.skill) : undefined,
      skills: message.skills?.length ? jsonSafe(message.skills) : undefined,
      replay: message.replay ? jsonSafe(message.replay) : undefined,
      streaming: message.streaming,
      error: message.error,
      activity: plainActivity(message.activity),
      tasks: message.tasks?.length ? jsonSafe(message.tasks) : undefined,
      confirm: message.confirm ? jsonSafe(message.confirm) : undefined,
      // 同 confirm:走 jsonSafe —— 它同样来自响应式状态,直接递会撞 structured clone
      // (与本文件 workspace 那两处同一根因)。
      errorCard: message.errorCard ? jsonSafe(message.errorCard) : undefined,
      compressed: message.compressed,
      promptExcluded: message.promptExcluded,
      compactSummary: message.compactSummary,
      compactUntilMessageId: message.compactUntilMessageId,
      tokenCount: message.tokenCount,
      ts: message.ts
    }
  }

  private toStoredSession(session: MessageSession): MaestroChatSession {
    return {
      ...this.toStoredSessionMeta(session),
      messages: session.messages.filter((message) => !message.localOnly).map((message) => this.toStoredMessage(message))
    }
  }

  private fromStoredSession(stored: MaestroChatSession): MessageSession {
    const session: MessageSession = {
      id: stored.id,
      source: 'cowork',
      operationTabId: stored.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: stored.title || 'Maestro',
      intent: 'chat',
      placeholder: placeholderFor(),
      allowFiles: true,
      messages: stored.messages.map((message: MaestroChatMessage) =>
        this.withTokenCount({
          id: message.id,
          source: 'cowork',
          role: message.role,
          type: message.type,
          content: message.content,
          files: message.files,
          skill: message.skill,
          skills: message.skills,
          replay: message.replay,
          streaming: false,
          error: message.error,
          activity: message.activity,
          tasks: message.tasks,
          // 历史里的确认卡一律按【已了结】读回:任务注册表是内存态,重开之后没有任何东西还在等
          // 这个答案,留一对能点的按钮只会让人以为还能影响什么 —— 点下去发给一个已经不存在的
          // 任务,失败,再弹一句"已在别处回答",而那句话与实情无关。
          //
          // 了结成 `expired` 而不是 `elsewhere`:没人回答过它,是进程没了。说成"别处答了"
          // 是在编造一件没发生的事(docs/issues/confirm-card-survives-restart.md)。
          confirm: message.confirm ? { ...message.confirm, answer: message.confirm.answer || 'expired' } : undefined,
          errorCard: message.errorCard ? { ...message.errorCard } : undefined,
          compressed: message.compressed,
          promptExcluded: message.promptExcluded,
          compactSummary: message.compactSummary,
          compactUntilMessageId: message.compactUntilMessageId,
          tokenCount: message.tokenCount,
          ts: message.ts
        })
      ),
      detail: stored.detail || emptyDetail(),
      contextUsage: emptyUsage(),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt
    }
    this.updateSessionContextUsage(session)
    return session
  }

  scheduleScrollToBottomIfNear(): void {
    if (this.scrollNearRaf) return
    this.scrollNearRaf = requestAnimationFrame(() => {
      this.scrollNearRaf = 0
      // Gated by stickToBottom inside scrollToBottom — no-ops once the user has scrolled up.
      this.scrollToBottom()
    })
  }

  private scheduleStreamFlush(): void {
    if (this.streamFlushRaf) return
    this.streamFlushRaf = requestAnimationFrame(() => this.flushStreamBuffers())
  }

  private flushStreamBuffers(): void {
    this.streamFlushRaf = 0
    if (!this.streamBuffers.size) return
    const entries = Array.from(this.streamBuffers.entries())
    this.streamBuffers.clear()
    for (const [sessionId, delta] of entries) this.appendStreamDelta(sessionId, delta)
  }

  flushStreamBuffer(sessionId: string): void {
    const delta = this.streamBuffers.get(sessionId)
    if (!delta) return
    this.streamBuffers.delete(sessionId)
    this.appendStreamDelta(sessionId, delta)
  }

  private appendStreamDelta(sessionId: string, delta: string): void {
    const session = this.getSession(sessionId)
    if (!session || !delta) return
    const sink = this.turnService.sink(session)
    if (!sink) return
    sink.thinking = false
    sink.content += delta
    this.scheduleScrollToBottomIfNear()
  }

  messageById(session: MessageSession, id: string): ChatMessage | undefined {
    return session.messages.find((message) => message.id === id)
  }

  lastStreamingMessage(session: MessageSession): ChatMessage | undefined {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i]
      if (message.role === 'ai' && message.streaming) return message
    }
    return undefined
  }

  bufferStreamDelta(sessionId: string, delta: string): void {
    this.streamBuffers.set(sessionId, (this.streamBuffers.get(sessionId) || '') + delta)
    this.scheduleStreamFlush()
  }

  private registerTaskBinding(task: MaestroTask): { sessionId: string; messageId: string } | null {
    const bound = this.turnService.bindTask(task)
    if (!bound) return null
    const session = this.getSession(bound.sessionId)
    if (!session) return null
    const message = this.turnService.appendTimelineEntry(
      session,
      this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        type: 'task',
        content: '',
        streaming: false,
        promptExcluded: true,
        ts: Date.now()
      })
    )
    const binding = { sessionId: session.id, messageId: message.id }
    this.taskBindings.set(task.id, binding)
    this.scheduleScrollToBottomIfNear()
    return binding
  }

  async stageAttachments(
    session: MessageSession,
    files?: ChatAttachment[]
  ): Promise<(ChatFile & { path: string })[]> {
    if (!files?.length) return []
    const registered = await coach
      .attachFiles({ sessionId: session.id, paths: files.map((file) => file.path) })
      .catch(() => null)
    const staged: (ChatFile & { path: string })[] = []
    const failed: string[] = []
    if (!registered) {
      failed.push(...files.map((file) => file.name || file.path))
    } else {
      // Main returns one result per input, in input order. Pairing by path is incorrect because
      // Main resolves/normalizes paths before returning them.
      for (let index = 0; index < files.length; index += 1) {
        const entry = registered[index]
        const file = files[index]
        if (entry?.ok && entry.path) {
          staged.push({
            name: entry.name || entry.path,
            path: entry.path,
            kind: 'attachment',
            size: entry.size,
            isDirectory: entry.isDirectory
          })
          continue
        }
        const reason = entry?.error
          ? ` (${entry.error})`
          : registered.length !== files.length
            ? ' (no result returned)'
            : ''
        failed.push(`${file.name || file.path}${reason}`)
      }
    }
    if (failed.length) {
      this.turnService.appendTimelineEntry(
        session,
        this.withTokenCount({
          id: uid(),
          source: 'cowork',
          role: 'ai',
          content:
            `Could not attach ${failed.length} file(s) — they were NOT sent to the agent:\n` +
            failed.map((name) => `· ${name}`).join('\n'),
          streaming: false,
          error: true,
          promptExcluded: true,
          ts: Date.now()
        })
      )
    }
    return staged
  }

}

export const messageStore = reactive<MessageStoreState>(
  iocHelper.bind({ controller: MessageStoreState, services: [TurnService] }) as MessageStoreState
)
