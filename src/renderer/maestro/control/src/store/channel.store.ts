import { reactive } from 'vue'
import type { TabInfo } from '@maestro-shared/coach.api'
import { messageStore } from './message.store'
import type { MessageSession } from './message.type'

export type ChannelSource = 'cowork' | 'connector'

const ACTIVE_SESSION_KEY = 'bitterless.maestro.activeSessionId'

const readActiveId = (): string => {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) || ''
  } catch {
    return ''
  }
}

const writeActiveId = (id: string): void => {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id)
  } catch {
    // Storage unavailable: the selected chat still survives tab changes in this renderer.
  }
}

export class ChannelStoreState {
  activeSource: ChannelSource = 'cowork'
  activeSessionId = readActiveId()
  initialized = false
  private creatingSession = false

  get activeSession(): MessageSession | undefined {
    if (this.activeSource === 'connector') return undefined
    return this.activeSessionId ? messageStore.getSession(this.activeSessionId) : undefined
  }

  /**
   * 把「面板此刻显示的是谁」单向写进 `message.store`,并给它置读。
   *
   * 会话选择独立于浏览器 tab;新建、选历史与切 source 都从同一 getter 同步。
   *
   * 连接器 tab 活跃时 `activeSession` 为 undefined ⇒ 写空串。那时结束的回合**会**置未读,
   * 这是对的:人正看着 connector,那条结论他确实没看到
   * (docs/features/maestro-session-list-unread.md #1)。
   */
  private syncActiveSession(): void {
    const sessionId = this.activeSession?.id || ''
    messageStore.activeSessionId = sessionId
    writeActiveId(this.activeSessionId)
    if (sessionId) messageStore.markRead(sessionId)
  }

  async init(_tabs: TabInfo[] = []): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await messageStore.init()
    await this.ensureMaestroSession()
    this.syncActiveSession()
  }

  selectSource(source: ChannelSource): void {
    this.activeSource = source
    this.syncActiveSession()
  }

  async startNewMaestroSession(sessionId: string): Promise<boolean> {
    if (this.creatingSession) return false
    if (this.activeSource === 'connector') return false
    if (this.activeSessionId !== sessionId) return false
    const previous = messageStore.getSession(sessionId)
    if (!previous || previous.archivedAt) return false
    this.creatingSession = true
    try {
      const session = messageStore.createSession({ title: 'New chat', intent: 'chat', autoTitlePending: true })
      this.activeSessionId = session.id
      this.syncActiveSession()
      // A running chat retains its work; optional draft cleanup cannot undo the new selection.
      if (!previous.turn) {
        void messageStore.discardIfEmpty(sessionId).catch((error) => console.warn('[maestro] empty draft cleanup failed', error))
      }
      return true
    } finally {
      this.creatingSession = false
    }
  }

  async startFreshMaestroSession(title?: string): Promise<MessageSession | undefined> {
    this.activeSource = 'cowork'
    const currentId = this.activeSessionId
    const current = currentId ? messageStore.getSession(currentId) : undefined
    if (current?.turn) return undefined
    if (current && !current.archivedAt) await messageStore.archive(current.id)

    const session = messageStore.createSession({ title: title ?? 'New chat', intent: 'chat', autoTitlePending: title === undefined })
    this.activeSessionId = session.id
    this.syncActiveSession()
    return session
  }

  async selectMaestroHistorySession(sessionId: string): Promise<boolean> {
    const session = await messageStore.loadPersistedSession(sessionId)
    if (!session || session.archivedAt) return false
    this.activeSource = 'cowork'
    this.activeSessionId = session.id
    this.syncActiveSession()
    return true
  }

  async selectAfterArchive(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) return
    await this.ensureMaestroSession()
    this.syncActiveSession()
  }

  // Tab broadcasts update page context in main; they never select or create a chat.
  async syncOperationTabs(_tabs: TabInfo[]): Promise<void> {}

  private async ensureMaestroSession(): Promise<MessageSession> {
    const existing = this.activeSessionId ? await messageStore.loadPersistedSession(this.activeSessionId) : undefined
    if (existing && !existing.archivedAt) return existing

    const persisted = await messageStore.latestActiveSession()
    if (persisted && !persisted.archivedAt) {
      this.activeSessionId = persisted.id
      return persisted
    }

    const session = messageStore.createSession({ title: 'New chat', intent: 'chat', autoTitlePending: true })
    this.activeSessionId = session.id
    return session
  }
}

export const channelStore = reactive<ChannelStoreState>(new ChannelStoreState())
