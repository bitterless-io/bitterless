import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
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
  private authGeneration = 0
  private selectionGeneration = 0

  /**
   * 构造期就把恢复出来的 id 同步给 `messageStore.activeSessionId`(而不是等 `syncActiveSession()`)。
   *
   * `markUnread` 的判据读的是后者,而恢复链(`init` → `ensureMaestroSession` →
   * `loadPersistedSession`)是异步的、且内部会重放该会话未送达的回复——原来
   * `messageStore.activeSessionId` 停在默认值 `''` 直到 `syncActiveSession()` 在整条恢复链末尾
   * 才写,重放期间任何一条对着"即将变成当前会话"的回复跑 markUnread,判据看到的都是
   * `'' !== restoringId`,于是被误判成"另一个会话的"而置未读
   * (docs/issues/maestro-unread-badge-active-session-race.md)。这一行把窗口收窄到"构造之前"——
   * 事实上不存在。照搬 cowork 同一处修复(2026-09-17,同一天的对齐)。
   */
  constructor() {
    if (this.activeSessionId) messageStore.activeSessionId = this.activeSessionId
  }

  reset(): void {
    this.authGeneration += 1
    this.initialized = false
    this.creatingSession = false
    this.activeSource = 'cowork'
    this.activeSessionId = ''
    writeActiveId('')
  }

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
    // 过跨进程边界前必须**浅拷贝**:`session` 住在 `reactive()` 里,`detail.workspace` 因此是个
    // Proxy,而 Proxy 过不了 structured clone —— 直接递会在边界上抛
    // `An object could not be cloned.`(见 tests/maestro/maestroXpcPayloadCloneable.test.mjs)。
    // 它只在会话**绑了工作区**之后才发作,没绑时是 undefined、可克隆,所以看起来像"突然坏了"。
    const workspace = this.activeSession?.detail.workspace
    // 自己吞掉错误:skill view context 只是上报"面板此刻看的是谁",它失败不该让
    // `loadControlConfig` 起不来 —— `void` 不隔离同步抛出,而这条调用就在启动的 await 链上。
    void (async () => {
      try {
        await coach.setSkillViewContext({ sessionId, workspace: workspace ? { ...workspace } : undefined })
      } catch (error) {
        console.warn('[skills] view context sync failed', error)
      }
    })()
    if (sessionId) messageStore.markRead(sessionId)
  }

  async init(_tabs: TabInfo[] = []): Promise<void> {
    if (this.initialized) return
    const generation = this.authGeneration
    const selection = this.selectionGeneration
    this.initialized = true
    messageStore.resume()
    await messageStore.init()
    if (generation !== this.authGeneration) return
    const session = await this.ensureMaestroSession()
    if (generation !== this.authGeneration) return
    this.syncActiveSession()
    if (session) await messageStore.adoptPreviewWorkspace(session.id, () =>
      generation === this.authGeneration && selection === this.selectionGeneration
      && this.activeSessionId === session.id && messageStore.activeSessionId === session.id)
  }

  selectSource(source: ChannelSource): void {
    this.selectionGeneration++
    this.activeSource = source
    this.syncActiveSession()
  }

  async startNewMaestroSession(sessionId: string): Promise<boolean> {
    if (this.creatingSession) return false
    if (this.activeSource === 'connector') return false
    if (this.activeSessionId !== sessionId) return false
    const previous = messageStore.getSession(sessionId)
    if (!previous || previous.archivedAt) return false
    this.selectionGeneration++
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
    this.selectionGeneration++
    const generation = this.authGeneration
    this.activeSource = 'cowork'
    const currentId = this.activeSessionId
    const current = currentId ? messageStore.getSession(currentId) : undefined
    if (current?.turn) return undefined
    if (current && !current.archivedAt) await messageStore.archive(current.id)
    if (generation !== this.authGeneration) return undefined

    const session = messageStore.createSession({ title: title ?? 'New chat', intent: 'chat', autoTitlePending: title === undefined })
    this.activeSessionId = session.id
    this.syncActiveSession()
    return session
  }

  async selectMaestroHistorySession(sessionId: string): Promise<boolean> {
    this.selectionGeneration++
    const generation = this.authGeneration
    // 已在内存里的会话不必等落库读——这条短路是 cowork 原有的,bl 的港口漏掉了它
    // (`git show ec0ba426`),于是 bl 每次点击都要过 await,cowork 只在冷加载时才过。
    // 早写 `messageStore.activeSessionId`、失败回滚:见构造函数处的注释,`loadPersistedSession`
    // 内部会重放这个会话的未送达回复,重放期间 markUnread 判据必须已经看到这个 id
    // (docs/issues/maestro-unread-badge-active-session-race.md)。
    const previousActiveId = messageStore.activeSessionId
    messageStore.activeSessionId = sessionId
    const session = messageStore.getSession(sessionId) || (await messageStore.loadPersistedSession(sessionId))
    if (generation !== this.authGeneration) { messageStore.activeSessionId = previousActiveId; return false }
    if (!session || session.archivedAt) {
      messageStore.activeSessionId = previousActiveId
      return false
    }
    this.activeSource = 'cowork'
    this.activeSessionId = session.id
    this.syncActiveSession()
    return true
  }

  async selectAfterArchive(sessionId: string): Promise<void> {
    this.selectionGeneration++
    const generation = this.authGeneration
    if (this.activeSessionId !== sessionId) return
    await this.ensureMaestroSession()
    if (generation !== this.authGeneration) return
    this.syncActiveSession()
  }

  // Tab broadcasts update page context in main; they never select or create a chat.
  async syncOperationTabs(_tabs: TabInfo[]): Promise<void> {}

  private async ensureMaestroSession(): Promise<MessageSession | undefined> {
    const generation = this.authGeneration
    const existing = this.activeSessionId ? await messageStore.loadPersistedSession(this.activeSessionId) : undefined
    if (generation !== this.authGeneration) return undefined
    if (existing && !existing.archivedAt) return existing

    const persisted = await messageStore.latestActiveSession()
    if (generation !== this.authGeneration) return undefined
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
