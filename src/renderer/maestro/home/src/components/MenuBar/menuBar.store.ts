import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract, LoadProgress, TabInfo } from '@maestro-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

// The address bar shows host/path WITHOUT the scheme. A pasted http(s):// URL is kept
// as-is on submit (the main process preserves the scheme); a schemeless entry defaults
// to http:// in the main process. Here we only strip the scheme for DISPLAY.
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

/**
 * Controller for the MenuBar — the app's 48px top chrome. It owns the address bar
 * and the simulated page-load progress.
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
  /** 0–100; the bar is visible while `loading` and animates a simulated trickle. */
  progress = 0
  loading = false
  /** History availability of the active tab → enables/disables the back/forward buttons. */
  canGoBack = false
  canGoForward = false
  private trickle = 0

  async init(): Promise<void> {
    xpcRenderer.subscribe('coach/nav', (payload) => {
      this.url = stripScheme(String(payload.params || ''))
    })
    xpcRenderer.subscribe('coach/title', (payload) => {
      this.title = String(payload.params || '')
    })
    xpcRenderer.subscribe('coach/tabs', (payload) => {
      const tabs = (payload.params as TabInfo[]) || []
      const active = tabs.find((tab) => tab.active)
      if (active) this.url = stripScheme(active.url || '')
    })
    xpcRenderer.subscribe('coach/load-progress', (payload) => {
      const p = payload.params as LoadProgress | undefined
      if (p?.loading) this.startBar()
      else this.finishBar()
    })
    xpcRenderer.subscribe('coach/nav-state', (payload) => {
      const s = payload.params as { canGoBack?: boolean; canGoForward?: boolean } | undefined
      this.canGoBack = Boolean(s?.canGoBack)
      this.canGoForward = Boolean(s?.canGoForward)
    })
    // Seed the bar from the active tab's URL — we no longer persist/restore a URL here
    // (also covers a coach/nav broadcast that may have fired before we subscribed).
    const tabs = await coach.getTabs()
    const active = tabs.find((t) => t.active)
    this.url = stripScheme(active?.url || '')
  }

  async go(): Promise<void> {
    const v = this.url.trim()
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

  // Electron has no real load percentage: trickle toward 90% and only complete on stop.
  private startBar(): void {
    this.loading = true
    this.progress = 8
    if (this.trickle) clearInterval(this.trickle)
    this.trickle = window.setInterval(() => {
      const remaining = 90 - this.progress
      if (remaining > 0) this.progress += Math.max(0.4, remaining * 0.1)
    }, 300)
  }

  private finishBar(): void {
    if (this.trickle) {
      clearInterval(this.trickle)
      this.trickle = 0
    }
    this.progress = 100
    window.setTimeout(() => {
      this.loading = false
      this.progress = 0
    }, 300)
  }
}

export const menuBarStore = reactive<MenuBarState>(new MenuBarState())
