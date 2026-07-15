import { reactive } from 'vue'
import type { TabInfo } from '@maestro-shared/coach.api'
import { messageStore } from './message.store'
import type { MessageSession } from './message.type'

export type ChannelSource = 'cowork' | 'connector'

const FALLBACK_OPERATION_TAB_ID = 'active-operation-tab'

class ChannelStoreState {
  activeSource: ChannelSource = 'cowork'
  currentOperationTabId = FALLBACK_OPERATION_TAB_ID
  maestroSessionByTabId: Record<string, string> = {}
  initialized = false

  get activeSession(): MessageSession | undefined {
    if (this.activeSource === 'connector') return undefined
    const sessionId = this.maestroSessionByTabId[this.currentOperationTabId]
    return sessionId ? messageStore.getSession(sessionId) : undefined
  }

  async init(tabs: TabInfo[] = []): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await messageStore.init()
    await this.syncOperationTabs(tabs)
  }

  selectSource(source: ChannelSource): void {
    this.activeSource = source
  }

  async startNewMaestroSession(sessionId: string): Promise<boolean> {
    if (this.activeSource === 'connector') return false
    if (this.maestroSessionByTabId[this.currentOperationTabId] !== sessionId) return false
    const current = messageStore.getSession(sessionId)
    if (current?.busy) return false
    // New chat does NOT archive the old session — it stays sendable and available in the
    // history drawer; we only drop it when it's an empty draft. (Real archive comes later.)
    await messageStore.discardIfEmpty(sessionId)

    const session = messageStore.createSession({ title: 'Maestro', intent: 'chat', operationTabId: this.currentOperationTabId })
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    return true
  }

  async startFreshMaestroSession(title = 'Maestro'): Promise<MessageSession | undefined> {
    this.activeSource = 'cowork'
    const currentId = this.maestroSessionByTabId[this.currentOperationTabId]
    const current = currentId ? messageStore.getSession(currentId) : undefined
    if (current?.busy) return undefined
    if (current && !current.archivedAt) await messageStore.archive(current.id)

    const session = messageStore.createSession({ title, intent: 'chat', operationTabId: this.currentOperationTabId })
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    return session
  }

  async selectMaestroHistorySession(sessionId: string): Promise<boolean> {
    const session = await messageStore.loadPersistedSession(sessionId)
    if (!session) return false
    this.activeSource = 'cowork'
    this.maestroSessionByTabId[this.currentOperationTabId] = session.id
    return true
  }

  async syncOperationTabs(tabs: TabInfo[]): Promise<void> {
    const activeTab = tabs.find((tab) => tab.active)
    this.currentOperationTabId = activeTab?.id || FALLBACK_OPERATION_TAB_ID
    await this.ensureMaestroSession(this.currentOperationTabId)
  }

  private async ensureMaestroSession(operationTabId: string): Promise<MessageSession> {
    const existingId = this.maestroSessionByTabId[operationTabId]
    const existing = existingId ? messageStore.getSession(existingId) : undefined
    if (existing && !existing.archivedAt) return existing

    const persisted = await messageStore.latestActiveSessionForOperationTab(operationTabId)
    if (persisted && !persisted.archivedAt) {
      this.maestroSessionByTabId[operationTabId] = persisted.id
      return persisted
    }

    const session = messageStore.createSession({ title: 'Maestro', intent: 'chat', operationTabId })
    this.maestroSessionByTabId[operationTabId] = session.id
    return session
  }
}

export const channelStore = reactive<ChannelStoreState>(new ChannelStoreState())
