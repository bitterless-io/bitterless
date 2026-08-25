import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { DEFAULT_COACH_START_URL, type CoachXpcContract, type TabInfo } from '@maestro-shared/coach.api'
import type { TabsApi, SavedTab } from '@maestro-shared/tabs.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
// Reaches the encrypted tabs store hosted in the sqlite window's preload (TabsDao). The home
// renderer OWNS tab persistence: it reads the saved strip on boot and writes it on every change.
const tabsDao = createXpcRendererEmitter<TabsApi>('TabsDao') as TabsApi

// Last-activated tab, persisted in THIS renderer's localStorage so boot reopens it. Tabs get fresh
// ids each launch, so the key is a stable identity: fixed tab kind for built-ins, else the URL
// (non-pinned tabs are restored by URL). Missing / no match → default to bundled Home.
const LAST_ACTIVE_KEY = 'coach.lastActiveTab'
const tabKey = (t: TabInfo): string => (t.kind === 'home' ? t.kind : t.url)

// A tab worth persisting / restoring across launches: a real remote http(s) page. Ephemeral local
// servers — notably the Demo (http://127.0.0.1:<random-port>/booking, which is GONE next launch) —
// and blank tabs are NOT persisted, so a dead demo tab can't reappear on boot and break the strip.
const isPersistableUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0'
  } catch {
    return false
  }
}

/**
 * Open operation-view tabs. The main process owns the live views + their bindings and is the
 * source of truth for the strip (broadcast on 'coach/tabs', incl. URL changes it observes on each
 * operation view). This store mirrors that list, drives switching/closing via XPC, AND persists
 * the (non-pinned) strip to the sqlite store so it reopens next launch.
 *
 * `activeLocked` is true for first-party fixed-purpose tabs — the MenuBar uses it to disable the
 * address bar because only ordinary browser tabs accept arbitrary navigation.
 */
class TabStoreState {
  tabs: TabInfo[] = []
  // Persistence only starts AFTER the initial restore, so early boot broadcasts can't clobber the
  // saved set before we've read + re-created it.
  private restored = false
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  // Guards the + button: ignore clicks while a new tab is mid-creation, so rapid clicks (esp. if
  // main is momentarily busy) can't queue up and spawn a burst of tabs at once.
  private creatingTab = false
  private draggingTabId: string | null = null
  private dragStartOrder: string[] = []
  private dragOrderDirty = false
  private finishingDrag = false
  debuggerToggling = false

  get activeTab(): TabInfo | undefined {
    return this.tabs.find((t) => t.active)
  }

  /** Non-browser tabs have a fixed address and cannot accept arbitrary navigation. */
  get activeLocked(): boolean {
    return Boolean(this.activeTab && this.activeTab.kind !== 'browser')
  }

  async init(): Promise<void> {
    xpcRenderer.subscribe('coach/tabs', (payload) => {
      this.tabs = (payload.params as TabInfo[]) || []
      // Main observes each operation view's URL/title/favicon changes and re-broadcasts the strip;
      // persist it (debounced) so the sqlite cache tracks the live URLs, and remember which tab is
      // active so the next launch reopens it.
      if (this.restored) {
        const active = this.tabs.find((t) => t.active)
        if (active) {
          // A demo/localhost tab is never persisted, so don't make it the restore target either —
          // Record Home so the next launch falls back to the fixed local tab.
          const key = active.pinned || isPersistableUrl(active.url) ? tabKey(active) : 'home'
          localStorage.setItem(LAST_ACTIVE_KEY, key)
        }
        this.persistSoon()
      }
    })
    // Main hands off "open this URL in a new tab" here (e.g. the Demo button in the control panel).
    xpcRenderer.subscribe('coach/open-tab', (payload) => {
      void this.openInNewTab(String(payload.params || ''))
    })
    // Restore the persisted strip: read from sqlite, then ask main to recreate them as cold tabs
    // (main warms each lazily on first activation). The pinned Home tab stays active.
    // Drop any non-persistable entries on read too — a dead demo/localhost tab saved by an older
    // build must not be restored; the next persistSoon then rewrites the cache without it.
    const saved = (await tabsDao.listAll().catch(() => [] as SavedTab[])).filter((t) => isPersistableUrl(t.url))
    if (saved.length) await coach.restoreTabs({ tabs: saved })
    this.restored = true
    // Initial snapshot (covers a broadcast that landed before we subscribed + the just-restored set).
    this.tabs = await coach.getTabs()
    await this.restoreLastActive()
  }

  // On boot, activate the last-activated tab (from localStorage) and load its page. Main defaults
  // the bundled Home tab to active; built-ins activate by kind, restored browser tabs by URL.
  private async restoreLastActive(): Promise<void> {
    const savedKey = localStorage.getItem(LAST_ACTIVE_KEY)
    // Migrate the pre-local-Home fixed-tab sentinel without reviving a remote AI-CRMS tab.
    const key = savedKey === 'ai-crms' ? 'home' : savedKey
    if (savedKey === 'ai-crms') localStorage.setItem(LAST_ACTIVE_KEY, 'home')
    if (!key || key === 'home') return
    if (key === 'workbench') {
      localStorage.setItem(LAST_ACTIVE_KEY, 'home')
      return
    }
    // Only ever re-activate a real persisted tab — never a demo/localhost one (固化兜底: anything
    // unclean leaves the fixed Home tab active).
    const target = this.tabs.find((t) => t.kind === 'browser' && t.url === key && isPersistableUrl(t.url))
    if (target && !target.active) await coach.activateTab({ id: target.id })
  }

  // Debounced write of the non-pinned, persistable strip to the sqlite store. Blank New Tab and
  // local Demo tabs still participate in the live order, then get filtered out here with compact
  // saved positions. Reactive rows are mapped to plain literals (XPC transfers raw JSON only — a
  // Vue proxy can't be structured-cloned).
  private persistSoon(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      const saved = this.tabs
        .filter((t) => t.kind === 'browser' && isPersistableUrl(t.url))
        .map((t, i) => ({ url: t.url, title: t.title, favicon: t.favicon, position: i }))
      void tabsDao.replaceAll({ tabs: saved }).catch(() => {
        /* DB not ready / closing — best effort; the next change re-persists */
      })
    }, 500)
  }

  isDragging(id: string): boolean {
    return this.draggingTabId === id
  }

  startDrag(event: DragEvent, id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || tab.pinned) {
      event.preventDefault()
      return
    }
    this.draggingTabId = id
    this.dragStartOrder = this.tabs.map((t) => t.id)
    this.dragOrderDirty = false
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', id)
    }
  }

  dragOver(event: DragEvent, id: string): void {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const draggingId = this.draggingTabId
    if (!draggingId || draggingId === id) return

    const from = this.tabs.findIndex((t) => t.id === draggingId)
    const to = this.tabs.findIndex((t) => t.id === id)
    if (from < 0 || to < 0) return

    const target = this.tabs[to]
    const dragged = this.tabs[from]
    if (!target || !dragged) return
    if (target.pinned || dragged.pinned) return

    const next = this.tabs.slice()
    const [moved] = next.splice(from, 1)
    if (!moved) return

    let insertAt = next.findIndex((t) => t.id === id)
    if (insertAt < 0) return
    const targetEl = event.currentTarget as HTMLElement | null
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      if (event.clientX > rect.left + rect.width / 2) insertAt += 1
    }
    next.splice(insertAt, 0, moved)
    this.tabs = next
    this.dragOrderDirty = this.dragStartOrder.join('\0') !== this.tabs.map((t) => t.id).join('\0')
  }

  async finishDrag(): Promise<void> {
    if (this.finishingDrag) return
    const ids = this.tabs.map((t) => t.id)
    const shouldCommit = this.dragOrderDirty
    this.draggingTabId = null
    this.dragStartOrder = []
    this.dragOrderDirty = false
    if (!shouldCommit) return

    this.finishingDrag = true
    try {
      await coach.reorderTabs({ ids })
    } finally {
      this.finishingDrag = false
    }
  }

  async newTab(): Promise<void> {
    if (this.creatingTab) return
    this.creatingTab = true
    try {
      await coach.newTab()
    } finally {
      this.creatingTab = false
    }
  }

  // Right-click a tab → ask main to pop a native context menu (renders above the view).
  async showMenu(id: string): Promise<void> {
    await coach.showTabMenu({ id })
  }

  async toggleActiveDebugger(): Promise<void> {
    const tab = this.activeTab
    if (!tab || this.debuggerToggling) return
    this.debuggerToggling = true
    try {
      this.tabs = await coach.setTabDebugger({ id: tab.id, enabled: !tab.debuggerEnabled })
    } finally {
      this.debuggerToggling = false
    }
  }

  // Open a URL in a NEW tab (used by the main process's Demo hand-off via 'coach/open-tab').
  // One atomic call: the tab is born with the URL and loaded into its own view, so it can't desync
  // the current tab (the old newTab()+navigate() two-step loaded into the active view and raced).
  async openInNewTab(url: string): Promise<void> {
    if (!url) return
    await coach.openTab({ url })
  }

  async setActiveAsStartup(): Promise<void> {
    const tab = this.activeTab
    if (!tab || tab.pinned || !isPersistableUrl(tab.url)) return
    await coach.saveSettings({ startUrl: tab.url })
  }

  async resetStartupToDefault(): Promise<void> {
    await coach.saveSettings({ startUrl: DEFAULT_COACH_START_URL })
  }

  async activate(id: string): Promise<void> {
    await coach.activateTab({ id })
  }

  async close(id: string): Promise<void> {
    await coach.closeTab({ id })
  }
}

export const tabStore = reactive<TabStoreState>(new TabStoreState())
