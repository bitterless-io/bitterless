import { markRaw, nextTick, reactive } from 'vue'
import { countTokens } from 'gpt-tokenizer'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type {
  AgentActivityStep,
  AgentCompactRequest,
  AgentCompactMessage,
  AgentConversationContext,
  AgentReply,
  AgentStreamDelta,
  AgentThinkingState,
  CoachXpcContract,
  WorkspaceRef
} from '@cowork-shared/coach.api'
import type { CoworkChatApi, CoworkChatMessage, CoworkChatSession } from '@cowork-shared/coworkChat.api'
import type {
  ChatAttachment,
  ChatContextUsage,
  ChatFile,
  ChatMessage,
  MessageIntent,
  MessageSession,
  MessageSessionSummary,
  MessageSource
} from './message.type'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const coworkChat = createXpcRendererEmitter<CoworkChatApi>('CoworkChatDao')

interface SessionOptions {
  title: string
  intent: MessageIntent
  source?: MessageSource
  operationTabId?: string
}

const DEFAULT_OPERATION_TAB_ID = 'active-operation-tab'
const DEFAULT_CONTEXT_LIMIT_K = 256
const DEFAULT_CONTEXT_LIMIT_LABEL = '256K'
const DEFAULT_COMPRESSION_REMAINING_PERCENT = 10
const COMPACTING_CONTENT = 'Compacting...'
const COMPACTED_CONTENT = 'Compacting complete.'
const COMPACT_SUMMARY_MAX_CONTEXT_SHARE = 0.45
const COMPACT_SUMMARY_HARD_MAX_CHARS = 500_000
const CHAT_TURN_TIMEOUT_MS = 11 * 60_000
// Auto-scroll "stick to bottom" threshold. While streaming we keep pinning the list to the bottom,
// but once the user scrolls up more than this many px from the bottom we stop — until they scroll
// back down near the bottom, or send a new message. ~120px ≈ a couple of lines of breathing room.
const STICK_TO_BOTTOM_THRESHOLD_PX = 120

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const welcomeFor = (): string => {
  return 'Hi — how can I help you today?'
}

const placeholderFor = (): string => {
  return 'Start a Cowork conversation…'
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

const messageTextForPrompt = (message: ChatMessage): string => {
  if (message.type === 'files') {
    // @path references (Claude Code / Codex / opencode convention); text/doc files are
    // read via read_file, while image paths are handed to a capable runtime adapter.
    const refs = (message.files || []).map((file) => (file.path ? `@${file.path}` : file.name))
    return refs.length
      ? `Attached files (documents can be read with read_file; images are path refs for a vision-capable adapter):\n${refs.join('\n')}`
      : 'Attached files: (none)'
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
    size: file.size
  }))

const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string, onTimeout?: () => Promise<void>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error(message))
        }, ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut && onTimeout) await onTimeout().catch(() => undefined)
  }
}

const summarizeTitle = (text: string): string => {
  const firstLine = text.trim().split('\n')[0]?.trim() || 'Cowork'
  return firstLine.length > 36 ? firstLine.slice(0, 36) + '…' : firstLine
}

class MessageStoreState {
  private scrollNearRaf = 0
  private streamFlushRaf = 0
  private streamBuffers = markRaw(new Map<string, string>())

  sessions: MessageSession[] = []
  historySessions: MessageSessionSummary[] = []
  defaultWorkspace: WorkspaceRef | undefined = undefined
  globalBusySessionId = ''
  contextLimitK = DEFAULT_CONTEXT_LIMIT_K
  contextLimitLabel = DEFAULT_CONTEXT_LIMIT_LABEL
  compressionRemainingPercent = DEFAULT_COMPRESSION_REMAINING_PERCENT
  initialized = false
  // While true, streaming/agent updates keep the message list pinned to the bottom. Flipped off when
  // the user scrolls up past STICK_TO_BOTTOM_THRESHOLD_PX (see onListScroll), back on when they
  // return near the bottom or send a new message. This is the bool that gates the auto-scroll.
  stickToBottom = true
  private listEl: HTMLElement | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/workspace-changed', (payload) => {
      const params = payload.params as { sessionId?: string; workspace?: WorkspaceRef | null }
      void this.applyWorkspaceBroadcast(params)
    })
    await this.refreshDefaultWorkspace()
    await this.refreshHistory()
  }

  createSession(options: SessionOptions): MessageSession {
    const session = this.createEmptySession(options)
    session.messages.push(this.welcomeMessage(session))
    this.updateSessionContextUsage(session)
    this.sessions.push(session)
    return session
  }

  async latestActiveSessionForOperationTab(operationTabId: string): Promise<MessageSession | undefined> {
    await this.init()
    const existing = this.sessions
      .filter((session) => session.operationTabId === operationTabId && !session.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (existing) return existing

    const summary = this.historySessions.find((item) => item.operationTabId === operationTabId && !item.archivedAt)
    return summary ? await this.loadPersistedSession(summary.id) : undefined
  }

  async loadPersistedSession(sessionId: string): Promise<MessageSession | undefined> {
    const existing = this.getSession(sessionId)
    if (existing) return existing

    const stored = await coworkChat.getSession({ id: sessionId }).catch(() => null)
    if (!stored) return undefined
    const session = this.fromStoredSession(stored)
    this.sessions.push(session)
    await this.refreshWorkspace(session.id)
    return session
  }

  getSession(id: string): MessageSession | undefined {
    return this.sessions.find((session) => session.id === id)
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
      if (session.archivedAt || session.busy) {
        this.updateSessionContextUsage(session)
        continue
      }
      await this.compactSessionIfNeeded(session)
    }
  }

  async send(sessionId: string, message: string, files?: ChatAttachment[]): Promise<AgentReply | null> {
    const session = this.getSession(sessionId)
    const text = message.trim()
    if (!session || session.archivedAt || !text || session.busy || this.globalBusySessionId) return null
    await this.refreshWorkspace(session.id)

    const turnId = uid()
    session.busy = true
    session.aborting = false
    session.activeTurnId = turnId
    session.updatedAt = Date.now()
    this.globalBusySessionId = session.id

    // Register attachments with main by ABSOLUTE PATH (never bytes); the agent reads them
    // via the read_file tool. Keep name + path on the message (path → @ref in the prompt).
    const stagedFiles: { name: string; path: string }[] = []
    if (files && files.length) {
      const registered = await coach.attachFiles({ sessionId: session.id, paths: files.map((file) => file.path) }).catch(() => null)
      for (const entry of registered || []) {
        if (entry.ok && entry.path) stagedFiles.push({ name: entry.name || entry.path, path: entry.path })
      }
    }
    if (stagedFiles.length) {
      const fileMessage = this.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'human',
        type: 'files',
        content: '',
        files: stagedFiles,
        streaming: false,
        ts: Date.now()
      })
      session.messages.push(fileMessage)
    }

    const humanMessage = this.withTokenCount({ id: uid(), source: 'cowork', role: 'human', content: text, streaming: false, ts: Date.now() })
    session.messages.push(humanMessage)
    if (session.title === 'Cowork') session.title = summarizeTitle(text)
    this.updateSessionContextUsage(session)
    await this.compactSessionIfNeeded(session, { protectMessageIds: new Set([humanMessage.id]) })

    const assistant: ChatMessage = this.withTokenCount({ id: uid(), source: 'cowork', role: 'ai', content: '', streaming: true, ts: Date.now() })
    session.messages.push(assistant)
    this.updateSessionContextUsage(session)
    // New turn: always re-pin to the bottom, even if the user had scrolled up while idle.
    this.stickToBottom = true
    this.scrollToBottom(true)
    void this.persistSession(session)

    let reply: AgentReply
    try {
      reply = await withTimeout(
        this.dispatch(session, text, humanMessage.id, stagedFiles.map((file) => file.path)),
        CHAT_TURN_TIMEOUT_MS,
        `Cowork did not finish after ${Math.round(CHAT_TURN_TIMEOUT_MS / 60_000)} minutes. I stopped this turn so the chat does not keep spinning. Check the AI login/provider state and try again.`,
        async () => {
          await coach.abortAgent({ sessionId: session.id }).catch(() => undefined)
        }
      )
    } catch (err) {
      reply = { ok: false, text: String(err), ts: Date.now(), error: String(err) }
    }

    if (session.activeTurnId !== turnId) return reply

    const wasAborted = session.aborting
    const fallback = wasAborted ? 'Stopped.' : reply.ok ? 'Done.' : 'Failed.'
    assistant.error = wasAborted ? false : !reply.ok
    assistant.promptExcluded = wasAborted
    assistant.files = reply.files?.map((file) => ({ ...file, kind: 'artifact' }))
    assistant.skill = reply.skill
    assistant.skills = reply.skills?.length ? reply.skills : reply.skill ? [reply.skill] : undefined
    assistant.replay = reply.replay
    this.finishAssistant(assistant, reply.text?.trim() || fallback)
    session.busy = false
    session.aborting = false
    session.activeTurnId = undefined
    session.updatedAt = Date.now()
    await this.compactSessionIfNeeded(session)
    this.globalBusySessionId = ''
    await this.persistSession(session)
    return reply
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session || session.archivedAt || !session.busy || session.aborting) return
    const turnId = session.activeTurnId
    session.aborting = true
    try {
      await Promise.race([coach.abortAgent({ sessionId: session.id }), delay(900)])
    } catch {
      /* best effort */
    }
    this.forceStopTurn(session, turnId)
  }

  async archive(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId)
    if (!session || session.busy || session.archivedAt) return false
    if (!this.shouldPersistSession(session)) {
      this.sessions = this.sessions.filter((item) => item.id !== session.id)
      await coworkChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
      await this.refreshHistory()
      return true
    }
    session.archivedAt = Date.now()
    session.updatedAt = session.archivedAt
    await this.persistSession(session)
    return true
  }

  // Drop a never-used empty draft (welcome-only) so "new chat" doesn't leak it.
  // A session with real content is left untouched — NOT archived: it stays sendable
  // and reachable via the history drawer. (Real archive is a later feature.)
  async discardIfEmpty(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session || session.busy || this.shouldPersistSession(session)) return
    this.sessions = this.sessions.filter((item) => item.id !== session.id)
    await coworkChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
    await this.refreshHistory()
  }

  async persistSession(session: MessageSession): Promise<void> {
    if (session.source !== 'cowork') return
    this.updateSessionContextUsage(session)
    if (!this.shouldPersistSession(session)) {
      await coworkChat.deleteSession({ id: session.id }).catch(() => ({ ok: false }))
      await this.refreshHistory()
      return
    }
    try {
      await coworkChat.saveSession({ session: this.toStoredSession(session) })
    } catch {
      /* best effort */
    }
    await this.refreshHistory()
  }

  async chooseWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) return
    const result = await coach.chooseWorkspaceDirectory({ sessionId: session.id }).catch(() => null)
    if (!result?.ok) return
    this.defaultWorkspace = result.workspace ? this.cloneWorkspace(result.workspace) : undefined
    session.detail = { ...session.detail, workspace: result.workspace }
    session.updatedAt = Date.now()
    await this.persistSession(session)
  }

  async clearWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) return
    await coach.setWorkspaceDirectory({ sessionId: session.id, path: '' }).catch(() => null)
    this.defaultWorkspace = undefined
    session.detail = { ...session.detail, workspace: undefined }
    session.updatedAt = Date.now()
    await this.persistSession(session)
  }

  async refreshDefaultWorkspace(): Promise<void> {
    const result = await coach.getWorkspaceDirectory({}).catch(() => null)
    this.defaultWorkspace = result?.ok && result.workspace ? this.cloneWorkspace(result.workspace) : undefined
  }

  async refreshWorkspace(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.detail.workspace) return
    const result = await coach.setWorkspaceDirectory({ sessionId: session.id, path: session.detail.workspace.path }).catch(() => null)
    if (result?.ok && result.workspace) {
      this.defaultWorkspace = this.cloneWorkspace(result.workspace)
      session.detail = { ...session.detail, workspace: result.workspace }
      return
    }
    if (result?.missing || !result?.ok) {
      if (this.defaultWorkspace?.path === session.detail.workspace.path) this.defaultWorkspace = undefined
      session.detail = { ...session.detail, workspace: undefined }
      session.updatedAt = Date.now()
      await this.persistSession(session)
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
    await this.persistSession(session)
  }

  async refreshHistory(): Promise<void> {
    const list = await coworkChat.listSessions({}).catch(() => [] as MessageSessionSummary[])
    this.historySessions = list
  }

  pushActivity(step: AgentActivityStep): void {
    if (step.phase === 'think') return
    const session = this.sessions.find((item) => item.id === this.globalBusySessionId)
    if (!session) return
    const last = session.messages[session.messages.length - 1]
    if (!last || last.role !== 'ai' || !last.streaming) return
    if (!last.activity) last.activity = []
    last.activity.push(step)
    this.scheduleScrollToBottomIfNear()
  }

  pushThinking(payload: AgentThinkingState): void {
    const session = this.getSession(payload.sessionId) || this.getSession(this.globalBusySessionId)
    if (!session) return
    const last = session.messages[session.messages.length - 1]
    if (!last || last.role !== 'ai' || !last.streaming) return
    last.thinking = payload.active
    if (payload.active) this.scheduleScrollToBottomIfNear()
  }

  pushStream(payload: AgentStreamDelta): void {
    const session = this.getSession(payload.sessionId) || this.getSession(this.globalBusySessionId)
    if (!session || !payload.delta) return
    const last = session.messages[session.messages.length - 1]
    if (!last || last.role !== 'ai' || !last.streaming) return
    this.streamBuffers.set(session.id, (this.streamBuffers.get(session.id) || '') + payload.delta)
    this.scheduleStreamFlush()
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

  private createEmptySession(options: SessionOptions): MessageSession {
    const now = Date.now()
    const session: MessageSession = {
      id: uid(),
      source: options.source || 'cowork',
      operationTabId: options.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: options.title,
      intent: options.intent,
      placeholder: placeholderFor(),
      welcome: welcomeFor(),
      // Cowork chats accept file attachments (read by the agent's read_file tool);
      // connector/customer-facing channels do not.
      allowFiles: (options.source || 'cowork') === 'cowork',
      messages: [],
      detail: { ...emptyDetail(), workspace: this.cloneWorkspace(this.defaultWorkspace) },
      contextUsage: emptyUsage(),
      busy: false,
      aborting: false,
      createdAt: now,
      updatedAt: now
    }
    return session
  }

  private async dispatch(session: MessageSession, message: string, currentHumanMessageId?: string, attachedPaths?: string[]): Promise<AgentReply> {
    return await coach.sendAgentMessage({
      sessionId: session.id,
      message,
      context: this.buildAgentContext(session, currentHumanMessageId, attachedPaths)
    })
  }

  private welcomeMessage(session: MessageSession): ChatMessage {
    return this.withTokenCount({ id: 'welcome-' + uid(), source: 'cowork', role: 'ai', content: session.welcome, streaming: false, ts: Date.now() })
  }

  private finishAssistant(msg: ChatMessage, full: string): void {
    const session = this.sessions.find((item) => item.messages.includes(msg))
    if (session) this.flushStreamBuffer(session.id)
    if (full && msg.content.trim() !== full.trim()) msg.content = full
    if (!msg.content.trim()) msg.content = full
    msg.thinking = false
    msg.streaming = false
    this.withTokenCount(msg)
    this.scrollToBottom()
  }

  private cloneWorkspace(workspace?: WorkspaceRef): WorkspaceRef | undefined {
    return workspace ? { ...workspace } : undefined
  }

  private forceStopTurn(session: MessageSession, turnId?: string): void {
    if (turnId && session.activeTurnId !== turnId) return
    this.flushStreamBuffer(session.id)
    const last = session.messages[session.messages.length - 1]
    if (last?.role === 'ai' && last.streaming) {
      last.promptExcluded = true
      this.finishAssistant(last, last.content.trim() || 'Stopped.')
    }
    session.busy = false
    session.aborting = false
    session.activeTurnId = undefined
    session.updatedAt = Date.now()
    if (this.globalBusySessionId === session.id) this.globalBusySessionId = ''
    void this.persistSession(session)
  }

  private shouldPersistSession(session: MessageSession): boolean {
    return session.source === 'cowork' && session.messages.length >= 2
  }

  private async compactSessionIfNeeded(session: MessageSession, options?: { protectMessageIds?: Set<string> }): Promise<boolean> {
    this.updateSessionContextUsage(session)
    if (!session.contextUsage.compressionTriggered) return false

    const candidates = this.selectCompactCandidates(session, options?.protectMessageIds || new Set<string>())
    if (!candidates.length) return false

    const until = candidates[candidates.length - 1]
    const compactMessage: ChatMessage = this.withTokenCount({
      id: uid(),
      source: 'cowork',
      role: 'ai',
      type: 'compact',
      content: COMPACTING_CONTENT,
      streaming: true,
      promptExcluded: true,
      compactUntilMessageId: until.id,
      ts: Date.now()
    })
    session.messages.push(compactMessage)
    this.scrollToBottom()
    await this.persistSession(session)
    await delay(80)

    const bridgeMessages = this.selectCompactBridgeMessages(session, candidates)
    const compactSummary = await this.buildCompactSummary(session, candidates, bridgeMessages)
    for (const message of candidates) {
      message.compressed = true
      this.withTokenCount(message)
    }
    compactMessage.content = COMPACTED_CONTENT
    compactMessage.streaming = false
    compactMessage.compactSummary = compactSummary
    compactMessage.compactUntilMessageId = until.id
    session.detail = {
      ...session.detail,
      compressedContext: compactSummary,
      compressedUntilMessageId: until.id,
      compressedAt: Date.now()
    }
    session.updatedAt = Date.now()
    this.updateSessionContextUsage(session)
    this.scrollToBottom()
    await this.persistSession(session)
    return true
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
      '- Continue the Cowork chat using the compacted history plus newer verbatim turns.',
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

  private buildAgentContext(session: MessageSession, currentHumanMessageId?: string, attachedPaths?: string[]): AgentConversationContext {
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
      workspace: session.detail.workspace
    }
  }

  private withTokenCount<T extends ChatMessage>(message: T): T {
    if (message.promptExcluded) {
      message.tokenCount = 0
      return message
    }
    message.tokenCount = safeTokenCount(contentForTokenCount(message))
    return message
  }

  private updateSessionContextUsage(session: MessageSession): void {
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

  private toStoredSession(session: MessageSession): CoworkChatSession {
    return {
      id: session.id,
      operationTabId: session.operationTabId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archivedAt: session.archivedAt,
      detail: {
        compressedContext: session.detail.compressedContext || '',
        compressedUntilMessageId: session.detail.compressedUntilMessageId,
        compressedAt: session.detail.compressedAt,
        workspace: session.detail.workspace
      },
      messages: session.messages.map((message) => ({
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
        compressed: message.compressed,
        promptExcluded: message.promptExcluded,
        compactSummary: message.compactSummary,
        compactUntilMessageId: message.compactUntilMessageId,
        tokenCount: message.tokenCount,
        ts: message.ts
      }))
    }
  }

  private fromStoredSession(stored: CoworkChatSession): MessageSession {
    const session: MessageSession = {
      id: stored.id,
      source: 'cowork',
      operationTabId: stored.operationTabId || DEFAULT_OPERATION_TAB_ID,
      title: stored.title || 'Cowork',
      intent: 'chat',
      placeholder: placeholderFor(),
      welcome: welcomeFor(),
      allowFiles: true,
      messages: stored.messages.map((message: CoworkChatMessage) =>
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
      busy: false,
      aborting: false,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt
    }
    this.updateSessionContextUsage(session)
    return session
  }

  private scheduleScrollToBottomIfNear(): void {
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

  private flushStreamBuffer(sessionId: string): void {
    const delta = this.streamBuffers.get(sessionId)
    if (!delta) return
    this.streamBuffers.delete(sessionId)
    this.appendStreamDelta(sessionId, delta)
  }

  private appendStreamDelta(sessionId: string, delta: string): void {
    const session = this.getSession(sessionId)
    if (!session || !delta) return
    const last = session.messages[session.messages.length - 1]
    if (!last || last.role !== 'ai' || !last.streaming) return
    last.thinking = false
    last.content += delta
    this.scheduleScrollToBottomIfNear()
  }
}

export const messageStore = reactive<MessageStoreState>(new MessageStoreState())
