import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import {
  DEFAULT_COACH_START_URL,
  MAESTRO_FORCE_PINNED_HOME_QUERY,
  MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE,
  type CoachXpcContract,
  type TabInfo
} from '@maestro-shared/coach.api'
import type { TabsApi, SavedTab } from '@maestro-shared/tabs.api'
import { MAESTRO_ZELLIJ_TAB_ID } from '@maestro-shared/compositeTab.identity'
import { MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH } from '@maestro-shared/tabAlias.api'
import { menuBarStore } from './menuBar.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
// Reaches the encrypted tabs store hosted in the sqlite window's preload (TabsDao). The home
// renderer OWNS tab persistence: it reads the saved strip on boot and writes it on every change.
const tabsDao = createXpcRendererEmitter<TabsApi>('TabsDao') as TabsApi

// Last-activated tab, persisted in THIS renderer's localStorage so boot reopens it. Tabs get fresh
// ids each launch, so the key is a stable identity: fixed tab kind for built-ins, else the URL
// (non-pinned tabs are restored by URL). Missing / no match → default to bundled Home.
const LAST_ACTIVE_KEY = 'coach.lastActiveTab'
// A composite mini-app tab has an EMPTY url, so keying it by url would collapse every one of them
// onto the same key — and onto `'home'` at that, since the empty string is not persistable. Its own
// `instanceId` is the only thing about it that survives a restart.
//
// `'home'` is the FIXED-SLOT sentinel, not "the bundled Home renderer": any pinned tab keys to it,
// so a custom homepage (a pinned mini-app tab) records the same literal. That is deliberate — the
// slot's occupant is decided at boot by main, so "last active = the fixed slot" must not also carry
// WHICH mini app was in it, or switching the homepage leaves a key pointing at a tab that is no
// longer there. The `'ai-crms'` → `'home'` rewrite below is the recorded precedent for what a stale
// sentinel costs.
const tabKey = (t: TabInfo): string =>
  t.pinned || t.kind === 'home' ? 'home' : t.instanceId ? `${t.kind}:${t.instanceId}` : t.url
const consumeForcePinnedHomeBootQuery = (): boolean => {
  const url = new URL(window.location.href)
  const forcePinnedHome =
    url.searchParams.get(MAESTRO_FORCE_PINNED_HOME_QUERY) ===
    MAESTRO_FORCE_PINNED_HOME_QUERY_VALUE
  if (!forcePinnedHome) return false
  url.searchParams.delete(MAESTRO_FORCE_PINNED_HOME_QUERY)
  try {
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    console.warn('[maestro tabs] Could not consume the force-Home boot query.')
  }
  return true
}

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
 * A composite mini-app tab whose mini app asked to come back next launch.
 *
 * Opt-in per mini app, decided in main (`spec.restorable`) and carried on the wire — NOT "any tab
 * whose kind isn't browser". Persisting every composite kind would quietly turn OnlyPreview and
 * Trench into start-on-boot apps, which is a change nobody asked for.
 */
const isRestorableComposite = (t: TabInfo): boolean =>
  Boolean(t.restorable && t.instanceId && !t.pinned)

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
  /**
   * 正在就地改名的那个 tab(`null` = 没有)。
   *
   * 只可能是一个 Zellij tab(docs/features/zellij-tab-inline-rename.md #2)。编辑期间 chip 的点击
   * 与拖拽都要让路,否则「选一段文字」会变成「把 tab 拖走」。
   */
  renamingTabId: string | null = null
  renameDraft = ''
  readonly renameMaxLength = MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH

  get activeTab(): TabInfo | undefined {
    return this.tabs.find((t) => t.active)
  }

  /** Non-browser tabs have a fixed address and cannot accept arbitrary navigation. */
  get activeLocked(): boolean {
    return Boolean(this.activeTab && this.activeTab.kind !== 'browser')
  }

  async init(): Promise<void> {
    const forcePinnedHome = consumeForcePinnedHomeBootQuery()
    if (forcePinnedHome) localStorage.setItem(LAST_ACTIVE_KEY, 'home')
    xpcRenderer.subscribe('coach/tabs', (payload) => {
      this.applyTabs((payload.params as TabInfo[]) || [])
      // Main observes each operation view's URL/title/favicon changes and re-broadcasts the strip;
      // persist it (debounced) so the sqlite cache tracks the live URLs, and remember which tab is
      // active so the next launch reopens it.
      if (this.restored) {
        const active = this.tabs.find((t) => t.active)
        if (active) {
          // A demo/localhost tab is never persisted, so don't make it the restore target either —
          // Record Home so the next launch falls back to the fixed local tab.
          const key =
            active.pinned || isRestorableComposite(active) || isPersistableUrl(active.url)
              ? tabKey(active)
              : 'home'
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
    const saved = (await tabsDao.listAll().catch(() => [] as SavedTab[])).filter((t) =>
      t.kind ? Boolean(t.instanceId) : isPersistableUrl(t.url)
    )
    if (saved.length) await coach.restoreTabs({ tabs: saved })
    this.restored = true
    // Initial snapshot (covers a broadcast that landed before we subscribed + the just-restored set).
    this.applyTabs(await coach.getTabs())
    if (forcePinnedHome) {
      const pinnedHome = this.tabs.find((tab) => tab.kind === 'home' && tab.pinned)
      if (pinnedHome && !pinnedHome.active) {
        await coach.activateTab({ id: pinnedHome.id })
        this.applyTabs(await coach.getTabs())
      }
      localStorage.setItem(LAST_ACTIVE_KEY, 'home')
      return
    }
    await this.restoreLastActive()
  }

  private applyTabs(tabs: TabInfo[]): void {
    this.tabs = tabs
    menuBarStore.applyTabs(tabs)
  }

  // On boot, activate the last-activated tab (from localStorage) and load its page. Main defaults
  // the bundled Home tab to active; built-ins activate by kind, restored browser tabs by URL.
  private async restoreLastActive(): Promise<void> {
    const savedKey = localStorage.getItem(LAST_ACTIVE_KEY)
    // Migrate the pre-local-Home fixed-tab sentinel. The AI-CRMS provider was retired in 2026-09,
    // but this key survives on any machine that ran the old build — without the rewrite the first
    // screen lands on a tab kind that no longer exists. Pure string migration: it references no
    // AI-CRMS code, so it outlives the provider.
    const key = savedKey === 'ai-crms' ? 'home' : savedKey
    if (savedKey === 'ai-crms') localStorage.setItem(LAST_ACTIVE_KEY, 'home')
    if (!key || key === 'home') return
    if (key === 'workbench') {
      localStorage.setItem(LAST_ACTIVE_KEY, 'home')
      return
    }
    // Only ever re-activate a real persisted tab — never a demo/localhost one (固化兜底: anything
    // unclean leaves the fixed Home tab active).
    const target = this.tabs.find(
      (t) =>
        (isRestorableComposite(t) && tabKey(t) === key) ||
        (t.kind === 'browser' && t.url === key && isPersistableUrl(t.url))
    )
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
        .filter((t) => isRestorableComposite(t) || (t.kind === 'browser' && isPersistableUrl(t.url)))
        .map((t, i) => ({
          url: t.kind === 'browser' ? t.url : '',
          title: t.title,
          favicon: t.favicon,
          position: i,
          // A field missing from THIS map silently never reaches the DB — the row is rebuilt from
          // literals here, not spread from the reactive tab (a Vue proxy can't be structured-cloned).
          ...(t.alias ? { alias: t.alias } : {}),
          ...(t.kind !== 'browser' ? { kind: t.kind, instanceId: t.instanceId } : {})
        }))
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

  // Hover the + button → native menu anchored under it (main builds and pops it: an in-renderer
  // dropdown would be painted behind the operation view, which is a native view above this DOM).
  async showNewTabMenu(anchor: { left: number; bottom: number }): Promise<void> {
    await coach.showNewTabMenu({ x: anchor.left, y: anchor.bottom })
  }

  // 地址栏左侧的页面类型按钮 → 原生菜单,锚在按钮下沿。同样在 main 里弹:操作区那个原生 view 画在
  // 这份 DOM 之上。菜单只针对**当前活动的** tab —— 地址栏行显示的就是它。
  async showPageTypeMenu(anchor: { left: number; bottom: number }): Promise<void> {
    const active = this.activeTab
    if (!active) return
    await coach.showPageTypeMenu({ tabId: active.id, x: anchor.left, y: anchor.bottom })
  }

  async toggleActiveDebugger(): Promise<void> {
    const tab = this.activeTab
    if (!tab || this.debuggerToggling) return
    this.debuggerToggling = true
    try {
      this.applyTabs(await coach.setTabDebugger({ id: tab.id, enabled: !tab.debuggerEnabled }))
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

  /** 这个 tab 允不允许双击改名。**只有 Zellij** —— 其余每一种上这个手势不存在(G2)。 */
  canRename(tab: TabInfo): boolean {
    return tab.kind === MAESTRO_ZELLIJ_TAB_ID
  }

  isRenaming(id: string): boolean {
    return this.renamingTabId === id
  }

  /** 双击进入编辑,预填**当前显示的名字**(alias 优先,没有就是 spec 的 `Zellij`)。 */
  beginRename(tab: TabInfo): void {
    if (!this.canRename(tab)) return
    this.renamingTabId = tab.id
    this.renameDraft = (tab.alias?.trim() || tab.title || '').slice(0, MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH)
  }

  /**
   * 截断在**写进状态之前**,不是只靠 `maxlength`:输入法组字、粘贴、拖放三条路都能绕过那个属性,
   * 而 chip 的宽度账已经按 20 个字算好了(#5)。
   */
  updateRenameDraft(value: string): void {
    this.renameDraft = String(value ?? '').slice(0, MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH)
  }

  cancelRename(): void {
    this.renamingTabId = null
    this.renameDraft = ''
  }

  /**
   * 提交(回车 / 失焦)。空串 = **删除别名**,chip 退回 spec 给的 `Zellij`(G6)。
   *
   * 先清本地编辑态再发 XPC:main 会广播一份新的 tab 条回来,留着编辑态会让那一份广播在输入框还开
   * 着的时候盖掉草稿。
   */
  async commitRename(): Promise<void> {
    const id = this.renamingTabId
    if (!id) return
    const alias = this.renameDraft.trim()
    this.cancelRename()
    await coach.setTabAlias({ id, alias })
  }
}

export const tabStore = reactive<TabStoreState>(new TabStoreState())
