import type { AgentBrowserSessionState, AgentBrowserTabState } from '@maestro-shared/coach.api'

/** Runtime identities only. A human foreground/chat switch never writes this registry. */
export class AgentBrowserSessions {
  private readonly sessions = new Map<string, AgentBrowserSessionState>()
  private readonly running = new Set<string>()
  private readonly initiatingTabs = new Map<string, AgentBrowserTabState | undefined>()

  constructor(
    private readonly describe: (id: string) => AgentBrowserTabState | undefined,
    private readonly changed: (state: AgentBrowserSessionState) => void
  ) {}

  beginTurn(sessionId: string, tabId?: string): void {
    this.running.add(sessionId)
    this.initiatingTabs.set(sessionId, tabId ? this.describe(tabId) : undefined)
  }

  endTurn(sessionId: string): void { this.running.delete(sessionId) }

  protectedTabIds(): string[] {
    return [...new Set([...this.running].flatMap((id) => [
      ...this.snapshot(id).tabs.map((tab) => tab.id),
      ...(this.initiatingTabs.get(id)?.id ? [this.initiatingTabs.get(id)!.id] : [])
    ]))]
  }

  snapshot(sessionId: string): AgentBrowserSessionState {
    const state = this.sessions.get(sessionId)
    return {
      sessionId,
      selectedTabId: state?.selectedTabId,
      ...(!state?.selectedTabId && this.initiatingTabs.get(sessionId) ? { initiatingTab: this.initiatingTabs.get(sessionId) } : {}),
      tabs: (state?.tabs ?? []).map((tab) => this.describe(tab.id) ?? {
        ...tab, status: 'closed', error: 'The tab was closed. Reopen its URL explicitly.'
      })
    }
  }

  target(sessionId: string, explicitId?: string): string {
    const id = explicitId || this.sessions.get(sessionId)?.selectedTabId || this.initiatingTabs.get(sessionId)?.id
    if (!id) throw new Error('This chat has no browser target. Use open_tab or an explicit tab_id from list_tabs.')
    this.enroll(sessionId, id, false)
    return id
  }

  enroll(sessionId: string, id: string, select: boolean, defaultIfEmpty = true): void {
    let state = this.sessions.get(sessionId)
    const existing = state?.tabs.find((tab) => tab.id === id)
    const initial = this.initiatingTabs.get(sessionId)
    const tab = this.describe(id) ?? existing ?? (initial?.id === id ? initial : undefined)
    if (!tab) throw new Error(`Tab ${id} is closed or unknown. Use list_tabs or reopen its intended URL with open_tab.`)
    if (!state) {
      state = { sessionId, tabs: [] }
      this.sessions.set(sessionId, state)
    }
    if (!existing) state.tabs.push({ ...tab })
    if (select || (defaultIfEmpty && !state.selectedTabId)) state.selectedTabId = id
    this.changed(this.snapshot(sessionId))
  }

  owns(sessionId: string, tabId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.tabs.some((tab) => tab.id === tabId))
  }

  release(sessionId: string, tabId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state?.tabs.some((tab) => tab.id === tabId)) return
    state.tabs = state.tabs.filter((tab) => tab.id !== tabId)
    if (state.selectedTabId === tabId) state.selectedTabId = undefined
    this.changed(this.snapshot(sessionId))
  }

  refresh(): void {
    for (const [id, state] of this.sessions) {
      // Retain the latest metadata when a page is subsequently closed.
      state.tabs = this.snapshot(id).tabs
      this.changed(this.snapshot(id))
    }
  }

  clear(): void {
    this.running.clear()
    this.sessions.clear()
    this.initiatingTabs.clear()
  }
}
