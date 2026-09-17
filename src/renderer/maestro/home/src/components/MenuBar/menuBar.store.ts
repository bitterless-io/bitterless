import { nextTick, reactive } from 'vue'
import { addressSubmissionTarget } from '@maestro-shared/browserAddress.service';
import { browserHistoryStore } from './browserHistory.store';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract, TabInfo } from '@maestro-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

// The address bar shows host/path WITHOUT the scheme. A pasted http(s):// URL is kept
// as-is on submit (the main process preserves the scheme); a schemeless entry defaults
// to http:// in the main process. Here we only strip the scheme for DISPLAY.
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

/**
 * Controller for the MenuBar's compact 42px address row. It owns the address bar.
 *
 * Platform note: on macOS the window is titleBarStyle 'hiddenInset', so the native
 * traffic lights overlap the bar's top-left and we reserve a left gutter for them.
 * On other platforms coach keeps the native window frame, so there are no custom
 * minimize/maximize/close controls here (unlike bitterless's frameless MenuBar).
 */
class MenuBarState {
  readonly isMac = /Mac/i.test(navigator.userAgent)
  /** Display value — host/path with NO scheme (see stripScheme). */
  url = ''
  /** Active page <title>; empty until the page reports one (tab falls back to URL host). */
  title = ''
  /** History availability of the active tab → enables/disables the back/forward buttons. */
  canGoBack = false
  canGoForward = false
  /**
   * The address `<input>` itself — MenuBar.vue hands it over on mount.
   *
   * Storing a DOM node in a `reactive()` store is safe: Vue 3 only proxies Object/Array/Map/Set,
   * and `HTMLInputElement` lands in `TargetType.INVALID`, so it is kept as-is (no `markRaw`).
   */
  private addressInput: HTMLInputElement | null = null
  private activeTabId = ''
  private activeTabUrl = ''

  async init(): Promise<void> {
    xpcRenderer.subscribe('coach/nav', (payload) => {
      browserHistoryStore.hide();
      this.url = stripScheme(String(payload.params || ''))
    })
    xpcRenderer.subscribe('coach/title', (payload) => {
      this.title = String(payload.params || '')
    })
    xpcRenderer.subscribe('coach/nav-state', (payload) => {
      const s = payload.params as { canGoBack?: boolean; canGoForward?: boolean } | undefined
      this.canGoBack = Boolean(s?.canGoBack)
      this.canGoForward = Boolean(s?.canGoForward)
    })
    // The main process only sends this after the operator opened a BLANK tab (`newTab()`); the
    // criterion lives there, not here (contract #3.1) — this end never inspects the tab.
    xpcRenderer.subscribe('coach/focus-address', () => void this.focusAddress())
  }

  // TabStore owns coach/tabs and the post-restore snapshot. XPC keeps one callback per channel,
  // so subscribing here too would leave the address/history identity frozen at its initial tab.
  applyTabs(tabs: TabInfo[]): void {
    const active = tabs.find((t) => t.active)
    const id = active?.id ?? ''
    const url = active?.displayUrl || active?.url || ''
    if (id !== this.activeTabId || url !== this.activeTabUrl) {
      browserHistoryStore.hide('tab-navigation');
      this.url = stripScheme(url)
    }
    browserHistoryStore.setActiveTab(id);
    this.activeTabId = id
    this.activeTabUrl = url
  }

  bindAddressInput(el: HTMLInputElement | null): void {
    this.addressInput = el
    browserHistoryStore.bind(el);
  }

  async focusAddress(): Promise<void> {
    // Wait one tick: `coach/tabs` arrived in the same burst (activateTab's last line), so Vue has
    // not applied the new tab's `:disabled` to the DOM yet — if the previous tab was a composite /
    // fixed one the input still carries `disabled`, and the browser silently ignores focus().
    await nextTick()
    this.addressInput?.focus()
    this.addressInput?.select()
  }

  keydown(event: KeyboardEvent): void {
    if (browserHistoryStore.keydown(event)) return;
    if (event.key === 'Enter') { event.preventDefault(); void this.go(); }
  }

  async go(): Promise<void> {
    browserHistoryStore.hide();
    const v = addressSubmissionTarget(this.url)
    if (v) await coach.navigate({ url: v })
  }

  async reload(): Promise<void> {
    await coach.reload()
  }

  async back(): Promise<void> {
    await coach.goBack()
  }

  async forward(): Promise<void> {
    await coach.goForward()
  }
}

export const menuBarStore = reactive<MenuBarState>(new MenuBarState())
