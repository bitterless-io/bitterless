interface BrowserUseTab {
  status: string
  instance: object | null
}

/** Active-use markers are task-owned facts, separate from targets and recording membership. */
export class AgentBrowserUse {
  private readonly owners = new Map<string, Map<string, object | null>>()
  private readonly drillMembers = new Map<string, Set<string>>()
  private readonly generations = new Map<string, number>()

  constructor(
    private readonly describe: (id: string) => BrowserUseTab | undefined,
    private readonly changed: (sessionId: string) => void
  ) {}

  tabIds(sessionId: string): string[] { return [...(this.owners.get(sessionId)?.keys() ?? [])] }
  allTabIds(): string[] { return [...new Set([...this.owners.values()].flatMap((tabs) => [...tabs.keys()]))] }
  generation(sessionId: string): number {
    if (!this.generations.has(sessionId)) this.generations.set(sessionId, 0)
    return this.generations.get(sessionId)!
  }

  start(sessionId: string, tabId: string, generation = this.generation(sessionId)): void {
    if (generation !== this.generation(sessionId)) return
    const tab = this.describe(tabId)
    if (!tab || !['ready', 'loading', 'cold'].includes(tab.status)) {
      throw new Error(`Tab ${tabId} is ${tab?.status || 'closed or unknown'}. Choose an available browser tab from list_tabs.`)
    }
    let tabs = this.owners.get(sessionId)
    if (!tabs) { tabs = new Map(); this.owners.set(sessionId, tabs) }
    const added = !tabs.has(tabId)
    tabs.set(tabId, tab.instance)
    if (added) this.changed(sessionId)
  }

  end(sessionId: string, tabId?: string): void {
    const tabs = this.owners.get(sessionId)
    if (!tabs || (tabId !== undefined && !tabs.has(tabId))) return
    if (tabId !== undefined) tabs.delete(tabId)
    else tabs.clear()
    if (!tabs.size) this.owners.delete(sessionId)
    this.changed(sessionId)
  }

  endTurn(sessionId: string): void {
    this.generations.set(sessionId, this.generation(sessionId) + 1)
    if (!this.drillMembers.get(sessionId)?.size) this.end(sessionId)
  }

  syncDrillMembers(sessionId: string, ids: string[] | null): void {
    const previous = this.drillMembers.get(sessionId) ?? new Set<string>()
    if (!ids?.length) {
      if (this.drillMembers.has(sessionId)) this.generations.set(sessionId, this.generation(sessionId) + 1)
      this.drillMembers.delete(sessionId)
      this.end(sessionId)
      return
    }
    const next = new Set(ids)
    this.drillMembers.set(sessionId, next)
    for (const id of previous) if (!next.has(id)) this.end(sessionId, id)
    // An unchanged member may have been explicitly ended; do not re-light it.
    for (const id of next) if (!previous.has(id)) this.start(sessionId, id)
  }

  refresh(): void {
    for (const [owner, tabs] of this.owners) {
      for (const [id, instance] of tabs) {
        const current = this.describe(id)
        if (!current || !['ready', 'loading', 'cold'].includes(current.status) || (instance && current.instance !== instance)) {
          this.end(owner, id)
        } else if (!instance && current.instance) tabs.set(id, current.instance)
      }
    }
  }

  clear(): void {
    this.drillMembers.clear()
    for (const owner of new Set([...this.owners.keys(), ...this.generations.keys()])) this.endTurn(owner)
  }
}
