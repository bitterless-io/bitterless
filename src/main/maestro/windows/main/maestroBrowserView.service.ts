import { Menu, WebContentsView, clipboard } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { randomUUID } from 'crypto'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { DebuggerCapture } from '@maestro-main/capture/debuggerCapture'
import { chromeIdentity } from '@maestro-main/capture/chromeIdentity'
import { ReplayEngine } from '@maestro-main/drive/replayEngine'
import { normalizeUrl } from '@maestro-main/settings/coachSettings.service'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import type { NetworkInterceptionRule } from '@maestro-main/capture/networkInterception'
import type {
  AgentActivityStep,
  CaptureState,
  CoachSettings,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  TabKind,
  TabInfo,
  ViewRect
} from '@maestro-shared/coach.api'
import type { InjectBtnApi, InjectBtnEntry, InjectBtnInput } from '@maestro-shared/injectBtn.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { createBoundsApplier } from './viewBounds'

export const AI_CRMS_URL = 'http://crms.micromeet.ai/'
export const AI_CRMS_LOGIN_URL = 'http://crms.micromeet.ai/?mrgn=ID#/login'
const AI_CRMS_TITLE = 'AI-CRMS'
const AI_CRMS_HOST = new URL(AI_CRMS_URL).hostname.toLowerCase()
const AI_CRMS_FAVICON = ''
const ATTACH_BEFORE_NAVIGATE_TIMEOUT_MS = 3000
const INJECTED_BUTTON_ROOT_ID = '__bitterless_maestro_button_root__'
const injectBtnStore = createXpcMainEmitter<InjectBtnApi>('InjectBtnDao')

const isWorkbenchInternalUrl = (url: string): boolean => /^micromeet:\/\/workbench(?:[/?#].*)?$/i.test(url.trim())

const isAiCrmsUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.toLowerCase() === AI_CRMS_HOST
  } catch {
    return false
  }
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const hostFromUrl = (url: string | undefined): string => {
  try {
    return new URL(url || '').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const clipInline = (value: unknown, max: number): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

const awaitAttach = async (ready: Promise<void> | undefined): Promise<void> => {
  if (!ready) return
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ATTACH_BEFORE_NAVIGATE_TIMEOUT_MS)
      })
    ])
  } catch {
    // The attach path already reports its own error; navigation remains the fallback.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface ViewSlot {
  view: WebContentsView
  capture: DebuggerCapture
  replay: ReplayEngine
  attachReady?: Promise<void>
}

export interface OperationTab {
  id: string
  kind: TabKind
  view: WebContentsView | null
  capture: DebuggerCapture | null
  replay: ReplayEngine | null
  attachReady?: Promise<void>
  url: string
  title: string
  favicon: string
  debuggerEnabled: boolean
  pinned: boolean
  lastActive: number
}

export interface MaestroBrowserViewServiceState {
  browserWindow: BrowserWindow | null
  operationView: WebContentsView | null
  capture: DebuggerCapture | null
  replayEngine: ReplayEngine | null
  currentUrl: string
  opBounds: ViewRect | null
  readonly capturing: boolean
  readonly captureTargetTabId: string | null
  tabsOpenedThisTurn: TabInfo[]
  readonly browserInterceptionRules: NetworkInterceptionRule[]

  emitTrace(event: TraceEvent): void
  layout(): void
  readMaestroSettings(): CoachSettings
  hasCustomStartUrl(): boolean
  stopCapture(): Promise<CaptureState>
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
  switchCaptureTarget(next: OperationTab): Promise<void>
  onCapturedEvent(event: TraceEvent, tabId: string): void
}

@injectable()
export class MaestroBrowserViewService extends CommonService<MaestroBrowserViewServiceState> {
  private readonly applyBounds = createBoundsApplier()

  tabs: OperationTab[] = []
  activeTabId: string | null = null
  private readonly MAX_WARM = 4
  private tabSeq = 0
  private startupTabOpened = false
  private spareSlot: ViewSlot | null = null
  private prewarming = false
  private creatingTab = false
  private injectedButtonNonces = new Map<string, string>()

  createPinnedHomeTab(): WebContentsView {
    const slot = this.buildViewSlot()
    const first: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'ai-crms',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      url: AI_CRMS_URL,
      title: AI_CRMS_TITLE,
      favicon: AI_CRMS_FAVICON,
      debuggerEnabled: true,
      pinned: true,
      lastActive: Date.now()
    }
    this.tabs.push(first)
    this.activeTabId = first.id
    this._state.operationView = slot.view
    this._state.capture = slot.capture
    this._state.replayEngine = slot.replay
    return slot.view
  }

  async openStartupTabIfNeeded(): Promise<void> {
    if (this.startupTabOpened) return
    this.startupTabOpened = true
    const settings = this._state.readMaestroSettings()
    if (!this._state.hasCustomStartUrl()) return
    const url = settings.startUrl
    if (!url) return
    await this.openTab({ url }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'startup tab: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async navigate(params: { url: string }): Promise<void> {
    if (!this._state.operationView) return
    const active = this.tabs.find((tab) => tab.id === this.activeTabId)
    if (active?.pinned) return
    if (isWorkbenchInternalUrl(params.url || '')) return
    const target = normalizeUrl(params.url)
    if (!target) return
    await this._state.operationView.webContents.loadURL(target).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'navigate: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async reload(): Promise<void> {
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed()) return
    wc.reload()
  }

  async goBack(): Promise<void> {
    const active = this.getActiveTab()
    if (this.isPinnedAiCrmsTab(active)) return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoBack()) return
    wc.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    const active = this.getActiveTab()
    if (this.isPinnedAiCrmsTab(active)) return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoForward()) return
    wc.navigationHistory.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return await this.getTabs()
    const enabled = Boolean(params.enabled)
    if (tab.debuggerEnabled !== enabled) {
      if (!enabled && this._state.capturing && this._state.captureTargetTabId === tab.id) {
        await this._state.stopCapture()
      }
      tab.debuggerEnabled = enabled
      if (tab.capture && tab.view && !tab.view.webContents.isDestroyed()) {
        if (enabled) {
          tab.attachReady = tab.capture.resume().catch((err) => {
            this._state.emitTrace({ kind: 'error', msg: 'debugger attach: ' + (err as Error).message, ts: Date.now() })
          })
          await tab.attachReady
        } else {
          tab.capture.suspend()
          tab.attachReady = undefined
        }
      }
    }
    this.broadcastTabs()
    return await this.getTabs()
  }

  openOperationDevTools(): void {
    if (process.env.COACH_DEVTOOLS !== '1') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || wc.isDevToolsOpened()) return
    try {
      wc.openDevTools({ mode: 'detach', activate: false })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'operation devtools: ' + (err as Error).message, ts: Date.now() })
    }
  }

  async listInjectedButtons(): Promise<InjectedButtonDomain[]> {
    const entries = await injectBtnStore.list({})
    return groupInjectedButtonDomains(entries)
  }

  async removeInjectedButtonDomain(params: { domain: string }): Promise<InjectedButtonRemoveResult> {
    const domain = normalizeInjectedButtonDomain(params.domain)
    if (!domain) return { ok: false, domain: '', removed: 0, unInjected: 0, error: 'Missing domain' }
    const removed = await injectBtnStore.removeDomain({ domain })
    const unInjected = await this.removeInjectedButtonFromTabs(domain)
    this.injectedButtonNonces.delete(domain)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return {
      ok: removed.ok,
      domain,
      removed: removed.count,
      unInjected,
      error: removed.ok ? undefined : 'Could not remove injected button rows'
    }
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this._state.operationView?.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this._state.operationView, rect)
  }

  private addTab(meta: { url?: string; title?: string; favicon?: string }): OperationTab {
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: null,
      capture: null,
      replay: null,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: 0
    }
    this.tabs.push(tab)
    return tab
  }

  private buildViewSlot(): ViewSlot {
    const view = new WebContentsView({ webPreferences: { partition: MAESTRO_PARTITION } })
    view.setBackgroundColor('#d9ecff')
    view.webContents.setUserAgent(chromeIdentity().userAgent)
    this._state.browserWindow?.contentView.addChildView(view, 0)
    view.setVisible(false)
    const capture = new DebuggerCapture(
      view.webContents,
      (event) => {
        const owner = this.ownerOf(view)
        if (owner) this._state.onCapturedEvent(event, owner.id)
      },
      () => this._state.capturing && this.ownerOf(view)?.id === this._state.captureTargetTabId
    )
    void capture.setInterceptionRules(this._state.browserInterceptionRules)
    const replay = new ReplayEngine(view.webContents)
    this.attachViewListeners(view)
    return { view, capture, replay }
  }

  private ownerOf(view: WebContentsView): OperationTab | undefined {
    return this.tabs.find((tab) => tab.view === view)
  }

  private ownerOfWebContents(wc: WebContents): OperationTab | undefined {
    return this.tabs.find((tab) => tab.view?.webContents === wc)
  }

  getActiveTab(): OperationTab | undefined {
    return this.activeTabId ? this.tabs.find((tab) => tab.id === this.activeTabId) : undefined
  }

  private isPinnedAiCrmsTab(tab?: OperationTab): boolean {
    return Boolean(tab?.pinned && tab.kind === 'ai-crms')
  }

  private isAllowedPinnedAiCrmsNavigation(url: string, wc: WebContents): boolean {
    if (isAiCrmsUrl(url)) return true
    return url === 'about:blank' && !wc.getURL()
  }

  private preventPinnedAiCrmsDomainEscape(tab: OperationTab | undefined, wc: WebContents, url: string): boolean {
    if (!this.isPinnedAiCrmsTab(tab)) return false
    if (this.isAllowedPinnedAiCrmsNavigation(url, wc)) return false
    this._state.emitTrace({ kind: 'info', msg: `blocked AI-CRMS navigation · ${url}`, ts: Date.now() })
    return true
  }

  async prewarmSpare(): Promise<void> {
    if (this.spareSlot || this.prewarming) return
    this.prewarming = true
    try {
      const slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'spare view attach: ' + (err as Error).message, ts: Date.now() })
      })
      this.spareSlot = slot
    } finally {
      this.prewarming = false
    }
  }

  private async ensureWarm(tab: OperationTab): Promise<void> {
    if (tab.view && !tab.view.webContents.isDestroyed()) return
    let slot = this.spareSlot
    if (slot) {
      this.spareSlot = null
    } else {
      slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'warm view attach: ' + (err as Error).message, ts: Date.now() })
      })
    }
    tab.view = slot.view
    tab.capture = slot.capture
    tab.replay = slot.replay
    tab.attachReady = slot.attachReady
    if (!tab.debuggerEnabled) tab.capture.suspend()
    tab.lastActive = Date.now()
    void this.prewarmSpare()
    this.enforceWarmCap()
  }

  async warmAndLoad(tab: OperationTab): Promise<void> {
    const wasCold = !tab.view || tab.view.webContents.isDestroyed()
    await this.ensureWarm(tab)
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (wasCold && tab.url && wc.getURL() !== tab.url) {
      await awaitAttach(tab.attachReady)
      await wc.loadURL(tab.url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'warm load: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  private coolTab(tab: OperationTab): void {
    try {
      tab.capture?.detach()
    } catch {
      // Already detached.
    }
    if (tab.view) {
      this._state.browserWindow?.contentView.removeChildView(tab.view)
      try {
        tab.view.webContents.close()
      } catch {
        // Best effort.
      }
    }
    tab.view = null
    tab.capture = null
    tab.replay = null
  }

  private enforceWarmCap(): void {
    const warm = this.tabs.filter((tab) => tab.view && !tab.view.webContents.isDestroyed())
    if (warm.length <= this.MAX_WARM) return
    const protectedIds = new Set<string>([
      ...(this.activeTabId ? [this.activeTabId] : []),
      ...(this._state.captureTargetTabId ? [this._state.captureTargetTabId] : []),
      ...this._state.tabsOpenedThisTurn.map((tab) => tab.id)
    ])
    const evictable = warm
      .filter((tab) => !tab.pinned && !protectedIds.has(tab.id))
      .sort((a, b) => a.lastActive - b.lastActive)
    let over = warm.length - this.MAX_WARM
    for (const tab of evictable) {
      if (over <= 0) break
      this.coolTab(tab)
      over -= 1
    }
  }

  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    if (this.tabs.some((tab) => !tab.pinned)) return
    for (const tab of params.tabs) {
      if (tab.url) this.addTab({ url: tab.url, title: tab.title, favicon: tab.favicon })
    }
    this.broadcastTabs()
  }

  private attachViewListeners(view: WebContentsView): void {
    const wc = view.webContents
    wc.on('will-navigate', (event, url) => {
      if (this.preventPinnedAiCrmsDomainEscape(this.ownerOf(view), wc, url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (this.preventPinnedAiCrmsDomainEscape(this.ownerOf(view), wc, url)) event.preventDefault()
    })
    wc.on('did-navigate', (_event, url) => {
      const tab = this.ownerOf(view)
      if (!tab || url === 'about:blank') return
      tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendNav(url, true)
      this.broadcastTabs()
    })
    wc.on('did-navigate-in-page', (_event, url) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendNav(url, false)
      this.broadcastTabs()
    })
    wc.on('page-title-updated', (_event, title) => {
      const tab = this.ownerOf(view)
      if (!tab) return
      if (!tab.pinned) {
        tab.title = title
        if (this.activeTabId === tab.id) this.sendTitle(title)
      }
      this.broadcastTabs()
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      const tab = this.ownerOf(view)
      if (!tab || tab.pinned) return
      if (Array.isArray(favicons) && favicons[0]) {
        tab.favicon = favicons[0]
        this.broadcastTabs()
      }
    })
    wc.on('did-start-loading', () => {
      if (this.ownerOf(view)?.id === this.activeTabId) this.broadcastLoading(true)
    })
    wc.on('did-stop-loading', () => {
      if (this.ownerOf(view)?.id === this.activeTabId) this.broadcastLoading(false)
    })
    wc.on('did-finish-load', () => {
      const tab = this.ownerOf(view)
      if (tab) void this.injectStoredButtonForTab(tab)
    })
    wc.setWindowOpenHandler((details) => {
      if (this.handleInjectedButtonOpen(details.url)) return { action: 'deny' }
      if (/^https?:\/\//i.test(details.url)) {
        const url = details.url
        queueMicrotask(() => void this.openTabWithUrl(url))
      }
      return { action: 'deny' }
    })
    wc.on('context-menu', (_event, params) => this.showPageMenu(wc, params))
  }

  private sendNav(url: string, resetTitle = false): void {
    this._state.currentUrl = url
    xpcMain.broadcast('coach/nav', url)
    if (resetTitle) xpcMain.broadcast('coach/title', '')
    this.broadcastNavState()
  }

  private sendTitle(title: string): void {
    xpcMain.broadcast('coach/title', String(title || ''))
  }

  private broadcastNavState(): void {
    const active = this.getActiveTab()
    const wc = this._state.operationView?.webContents
    const live = wc && !wc.isDestroyed() ? wc : null
    const historyLocked = this.isPinnedAiCrmsTab(active)
    xpcMain.broadcast('coach/nav-state', {
      canGoBack: !historyLocked && live ? live.navigationHistory.canGoBack() : false,
      canGoForward: !historyLocked && live ? live.navigationHistory.canGoForward() : false
    })
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return
    const index = this.tabs.findIndex((tab) => tab.id === params.id)
    if (index < 0) return
    const tab = this.tabs[index]
    const canClose = !tab.pinned && this.tabs.length > 1
    const canDuplicate = !tab.pinned && Boolean(tab.url)
    const otherClosable = this.tabs.some((item) => item.id !== tab.id && !item.pinned)
    const rightClosable = this.tabs.slice(index + 1).some((item) => !item.pinned)
    const menu = Menu.buildFromTemplate([
      { label: 'New tab', click: () => void this.newTab() },
      { type: 'separator' },
      {
        label: 'Reload',
        click: () => {
          if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload()
          else void this.warmAndLoad(tab)
        }
      },
      { label: 'Duplicate', enabled: canDuplicate, click: () => void this.openTabWithUrl(tab.url) },
      { type: 'separator' },
      { label: 'Close', enabled: canClose, click: () => void this.closeTab({ id: tab.id }) },
      { label: 'Close other tabs', enabled: otherClosable, click: () => void this.closeTabsExcept(tab.id) },
      { label: 'Close tabs to the right', enabled: rightClosable, click: () => void this.closeTabsToRight(tab.id) }
    ])
    menu.popup({ window: win })
  }

  private async closeTabsExcept(keepId: string): Promise<void> {
    const ids = this.tabs.filter((tab) => tab.id !== keepId && !tab.pinned).map((tab) => tab.id)
    for (const id of ids) await this.closeTab({ id })
  }

  private async closeTabsToRight(afterId: string): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === afterId)
    if (index < 0) return
    const ids = this.tabs
      .slice(index + 1)
      .filter((tab) => !tab.pinned)
      .map((tab) => tab.id)
    for (const id of ids) await this.closeTab({ id })
  }

  private showPageMenu(wc: WebContents, params: ContextMenuParams): void {
    const win = this._state.browserWindow
    if (!win) return
    const nav = wc.navigationHistory
    const historyLocked = this.isPinnedAiCrmsTab(this.ownerOfWebContents(wc))
    const sections: MenuItemConstructorOptions[][] = [
      [
        { label: 'Back', enabled: !historyLocked && nav.canGoBack(), click: () => void this.goBack() },
        { label: 'Forward', enabled: !historyLocked && nav.canGoForward(), click: () => void this.goForward() },
        { label: 'Reload', click: () => wc.reload() }
      ]
    ]
    if (params.linkURL) {
      sections.push([
        { label: 'Open link in new tab', click: () => void this.openTabWithUrl(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
      ])
    }
    if (params.mediaType === 'image' && params.srcURL) {
      sections.push([
        { label: 'Open image in new tab', click: () => void this.openTabWithUrl(params.srcURL) },
        { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
      ])
    }
    if (params.isEditable) {
      const flags = params.editFlags
      sections.push([
        { label: 'Cut', enabled: flags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: flags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: flags.canPaste, click: () => wc.paste() },
        { label: 'Select all', enabled: flags.canSelectAll, click: () => wc.selectAll() }
      ])
    } else if (params.selectionText) {
      sections.push([{ label: 'Copy', click: () => wc.copy() }])
    }
    if (is.dev) {
      sections.push([{ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }])
    }
    const template: MenuItemConstructorOptions[] = []
    for (const section of sections) {
      if (template.length) template.push({ type: 'separator' })
      template.push(...section)
    }
    Menu.buildFromTemplate(template).popup({ window: win })
  }

  private claimSpareTab(meta: { url?: string; title?: string; favicon?: string }): OperationTab {
    let slot = this.spareSlot
    this.spareSlot = null
    if (!slot || slot.view.webContents.isDestroyed()) {
      slot = this.buildViewSlot()
      slot.attachReady = slot.capture.attach().catch((err) => {
        this._state.emitTrace({ kind: 'error', msg: 'tab attach: ' + (err as Error).message, ts: Date.now() })
      })
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      attachReady: slot.attachReady,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: Date.now()
    }
    this.tabs.push(tab)
    void this.prewarmSpare()
    this.enforceWarmCap()
    return tab
  }

  private async openTabWithUrl(url: string): Promise<OperationTab> {
    const tab = this.claimSpareTab({ url })
    this._state.tabsOpenedThisTurn.push({
      id: tab.id,
      kind: tab.kind,
      url,
      title: '',
      active: true,
      pinned: false,
      favicon: '',
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: Boolean(tab.capture?.isAttached())
    })
    this._state.broadcastActivity('tab', `opened tab · ${hostnameOf(url) || url}`)
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await awaitAttach(tab.attachReady)
      await wc.loadURL(url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
    return tab
  }

  async newTab(): Promise<void> {
    if (this.creatingTab) return
    this.creatingTab = true
    try {
      const tab = this.claimSpareTab({})
      await this.activateTab({ id: tab.id })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'new tab: ' + (err as Error).message, ts: Date.now() })
    } finally {
      this.creatingTab = false
    }
  }

  async closeActiveTab(): Promise<void> {
    if (this.activeTabId) await this.closeTab({ id: this.activeTabId })
  }

  async openTab(params: { url: string }): Promise<void> {
    const url = (params.url || '').trim()
    if (!url) {
      await this.newTab()
      return
    }
    if (isWorkbenchInternalUrl(url)) return
    const tab = this.claimSpareTab({ url })
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await wc.loadURL(url).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'open tab: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  async openAiCrmsLoginTab(): Promise<void> {
    const tab = this.tabs.find((item) => item.kind === 'ai-crms' && item.pinned) || this.tabs[0]
    if (!tab) return
    await this.activateTab({ id: tab.id })
    const wc = tab.view?.webContents
    tab.url = AI_CRMS_LOGIN_URL
    this._state.currentUrl = AI_CRMS_LOGIN_URL
    this.broadcastTabs()
    xpcMain.broadcast('coach/nav', AI_CRMS_LOGIN_URL)
    if (wc && !wc.isDestroyed()) {
      await wc.loadURL(AI_CRMS_LOGIN_URL).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'AI-CRMS login: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  drainNewTabsNote(): string {
    if (this._state.tabsOpenedThisTurn.length === 0) return ''
    const opened = this._state.tabsOpenedThisTurn.splice(0)
    const lines = opened.map((tab) => `  - tab_id=${tab.id} url=${tab.url}`)
    return (
      `\n\nNOTE: ${opened.length} new browser tab(s) opened during this action — likely a ` +
      `result/confirmation page:\n${lines.join('\n')}\n` +
      `Inspect one with page_snapshot {"tab_id":"<tab_id>"} (does NOT change the active tab), ` +
      `or activate_tab to switch to it.`
    )
  }

  async activateTab(params: { id: string }): Promise<void> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    if (this.activeTabId === tab.id) {
      tab.lastActive = Date.now()
      this.broadcastTabs()
      return
    }
    let needsLoad = false
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      try {
        await this.ensureWarm(tab)
      } catch (err) {
        this._state.emitTrace({ kind: 'error', msg: 'activate: warm failed — ' + (err as Error).message, ts: Date.now() })
      }
      if (!tab.view || tab.view.webContents.isDestroyed()) {
        this.broadcastTabs()
        return
      }
      needsLoad = Boolean(tab.url) && tab.view.webContents.getURL() !== tab.url
    }
    const previous = this.tabs.find((item) => item.id === this.activeTabId)
    if (previous && previous.id !== tab.id && previous.view && !previous.view.webContents.isDestroyed()) {
      previous.view.setVisible(false)
    }
    this.activeTabId = tab.id
    tab.lastActive = Date.now()
    this._state.operationView = tab.view
    await this._state.switchCaptureTarget(tab)
    this._state.capture = tab.capture
    this._state.replayEngine = tab.replay
    this._state.currentUrl = tab.url || this._state.currentUrl
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.setVisible(true)
      if (this._state.opBounds) this.applyBounds(tab.view, this._state.opBounds)
      else this._state.layout()
      if (needsLoad) {
        const wc = tab.view.webContents
        void awaitAttach(tab.attachReady)
          .then(() => (wc.isDestroyed() ? undefined : wc.loadURL(tab.url)))
          .catch((err) => {
            if (!wc.isDestroyed()) {
              this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
            }
          })
      }
    }
    xpcMain.broadcast('coach/nav', tab.url || '')
    xpcMain.broadcast('coach/title', tab.title || '')
    this.broadcastNavState()
    this.broadcastTabs()
  }

  async reorderTabs(params: { ids: string[] }): Promise<void> {
    const ids = Array.isArray(params.ids) ? params.ids.filter((id) => typeof id === 'string') : []
    if (!ids.length) return
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length !== this.tabs.length) return
    const byId = new Map(this.tabs.map((tab) => [tab.id, tab]))
    if (uniqueIds.some((id) => !byId.has(id))) return
    const pinned = this.tabs.filter((tab) => tab.pinned)
    const reordered = uniqueIds.map((id) => byId.get(id)!).filter((tab) => !tab.pinned)
    if (reordered.length !== this.tabs.length - pinned.length) return
    const next = [...pinned, ...reordered]
    if (next.every((tab, index) => tab.id === this.tabs[index]?.id)) return
    this.tabs = next
    this.broadcastTabs()
  }

  async closeTab(params: { id: string }): Promise<void> {
    if (this.tabs.length <= 1) return
    const index = this.tabs.findIndex((tab) => tab.id === params.id)
    if (index < 0) return
    const tab = this.tabs[index]
    if (tab.pinned) return
    const wasActive = this.activeTabId === tab.id
    if (this._state.capturing && this._state.captureTargetTabId === tab.id) {
      await this._state.stopCapture()
    }
    try {
      tab.capture?.detach()
    } catch {
      // Already detached.
    }
    if (tab.view) {
      this._state.browserWindow?.contentView.removeChildView(tab.view)
      try {
        tab.view.webContents.close()
      } catch {
        // Best effort.
      }
    }
    this.tabs.splice(index, 1)
    if (wasActive) {
      const next = this.tabs[index] || this.tabs[this.tabs.length - 1]
      this.activeTabId = null
      if (next) await this.activateTab({ id: next.id })
    } else {
      this.broadcastTabs()
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    return this.tabs.map((tab) => this.tabInfo(tab))
  }

  private broadcastTabs(): void {
    xpcMain.broadcast('coach/tabs', this.tabs.map((tab) => this.tabInfo(tab)))
  }

  private tabInfo(tab: OperationTab): TabInfo {
    return {
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      url: tab.url,
      active: tab.id === this.activeTabId,
      pinned: tab.pinned,
      favicon: tab.favicon,
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: Boolean(tab.capture?.isAttached())
    }
  }

  private broadcastLoading(loading: boolean): void {
    xpcMain.broadcast('coach/load-progress', { loading, ts: Date.now() })
  }

  async toolInjectButton(skillsJson: string, domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this._state.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first.'
    const items = parseInjectedButtonItems(skillsJson)
    if (!items.length) {
      return 'ERROR: skills_json must contain at least one item with skillTitle and optional skillDescription.'
    }
    const saved = await injectBtnStore.upsertMany({ domain, items })
    const entries = await injectBtnStore.list({ domain })
    const injected = active ? await this.injectButtonIntoTab(active, domain, entries) : { ok: false, error: 'no active tab' }
    this._state.broadcastActivity('act', `injected micromeet button · ${domain}`, injected.ok)
    xpcMain.broadcast('coach/injected-buttons-changed', { domain, ts: Date.now() })
    return JSON.stringify(
      {
        ok: saved.ok && injected.ok,
        domain,
        saved: saved.count,
        triggers: entries.length,
        injected: injected.ok,
        error: injected.ok ? undefined : injected.error
      },
      null,
      2
    )
  }

  async toolRemoveInjectedButton(domainArg: string): Promise<string> {
    const active = this.getActiveTab()
    const wc = active?.view?.webContents
    const pageDomain = hostFromUrl(wc && !wc.isDestroyed() ? wc.getURL() : active?.url || this._state.currentUrl)
    const domain = normalizeInjectedButtonDomain(domainArg) || pageDomain
    if (!domain) return 'ERROR: no active page domain. Open the customer website first or pass a domain.'
    const result = await this.removeInjectedButtonDomain({ domain })
    this._state.broadcastActivity('act', `removed micromeet button · ${domain}`, result.ok)
    return JSON.stringify(result, null, 2)
  }

  private async injectStoredButtonForTab(tab: OperationTab): Promise<void> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const domain = hostFromUrl(wc.getURL() || tab.url)
    if (!domain) return
    const entries = await injectBtnStore.list({ domain }).catch(() => [] as InjectBtnEntry[])
    if (!entries.length) return
    await this.injectButtonIntoTab(tab, domain, entries)
  }

  private async injectButtonIntoTab(
    tab: OperationTab,
    domain: string,
    entries: InjectBtnEntry[]
  ): Promise<{ ok: boolean; error?: string }> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'tab webContents is not ready' }
    const liveDomain = hostFromUrl(wc.getURL() || tab.url)
    if (!liveDomain || liveDomain !== domain) {
      return { ok: false, error: `active page is ${liveDomain || 'blank'}, not ${domain}` }
    }
    if (!entries.length) return { ok: false, error: 'no inject button rows for domain' }
    try {
      const nonce = randomUUID()
      this.injectedButtonNonces.set(domain, nonce)
      await wc.executeJavaScript(buildInjectedButtonScript(domain, entries, nonce), true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async removeInjectedButtonFromTabs(domain: string): Promise<number> {
    let count = 0
    for (const tab of this.tabs) {
      const wc = tab.view?.webContents
      if (!wc || wc.isDestroyed()) continue
      const liveDomain = hostFromUrl(wc.getURL() || tab.url)
      if (liveDomain !== domain) continue
      try {
        await wc.executeJavaScript(removeInjectedButtonScript(), true)
        count += 1
      } catch (err) {
        this._state.emitTrace({ kind: 'error', msg: 'remove injected button: ' + (err as Error).message, ts: Date.now() })
      }
    }
    return count
  }

  private handleInjectedButtonOpen(url: string): boolean {
    const trigger = parseInjectedButtonTriggerUrl(url)
    if (!trigger) return false
    const expectedNonce = this.injectedButtonNonces.get(trigger.domain)
    if (!expectedNonce || expectedNonce !== trigger.nonce) return true
    const message = injectedButtonTriggerMessage(trigger)
    xpcMain.broadcast('coach/injected-skill-trigger', {
      domain: trigger.domain,
      skillTitle: trigger.skillTitle,
      skillDescription: trigger.skillDescription,
      message,
      ts: Date.now()
    })
    this._state.broadcastActivity('skill', `trigger ${trigger.skillTitle}`)
    return true
  }

  reset(): void {
    for (const tab of this.tabs) {
      try {
        tab.capture?.detach()
      } catch {
        // Already detached or destroyed.
      }
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.close()
        } catch {
          // Best effort.
        }
      }
    }
    this.tabs = []
    this.activeTabId = null
    if (this.spareSlot) {
      try {
        this.spareSlot.capture.detach()
      } catch {
        // Already detached or destroyed.
      }
      if (!this.spareSlot.view.webContents.isDestroyed()) {
        try {
          this.spareSlot.view.webContents.close()
        } catch {
          // Best effort.
        }
      }
      this.spareSlot = null
    }
    this.prewarming = false
    this.creatingTab = false
    this.startupTabOpened = false
    this.tabSeq = 0
  }
}

interface InjectedButtonTrigger {
  domain: string
  nonce: string
  skillTitle: string
  skillDescription: string
}

const normalizeInjectedButtonDomain = (value: string): string => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '')
  }
}

const parseInjectedButtonItems = (value: string): InjectBtnInput[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.skills)
        ? record.skills
        : parsed
          ? [parsed]
          : []
  const out: InjectBtnInput[] = []
  for (const item of rawItems.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const skillTitle = clipInline(firstNonEmptyString(record.skillTitle, record.title, record.name), 90)
    if (!skillTitle) continue
    out.push({
      skillTitle,
      skillDescription: clipInline(firstNonEmptyString(record.skillDescription, record.description, record.summary), 360)
    })
  }
  return out
}

const groupInjectedButtonDomains = (entries: InjectBtnEntry[]): InjectedButtonDomain[] => {
  const byDomain = new Map<string, InjectedButtonDomain>()
  for (const entry of entries) {
    const domain = normalizeInjectedButtonDomain(entry.domain)
    if (!domain) continue
    const group = byDomain.get(domain) || { domain, triggers: [], updatedAt: 0 }
    group.triggers.push(entry)
    group.updatedAt = Math.max(group.updatedAt, entry.updatedAt || 0)
    byDomain.set(domain, group)
  }
  return Array.from(byDomain.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.domain.localeCompare(b.domain)
  })
}

const removeInjectedButtonScript = (): string => `
(() => {
  const root = document.getElementById('__bitterless_maestro_button_root__');
  if (root) root.remove();
})();
`

const buildInjectedButtonScript = (domain: string, entries: InjectBtnEntry[], nonce: string): string => {
  const payload = {
    domain,
    nonce,
    entries: entries.map((entry) => ({
      skillTitle: entry.skillTitle,
      skillDescription: entry.skillDescription
    }))
  }
  return `
(() => {
  const payload = ${JSON.stringify(payload)};
  const rootId = ${JSON.stringify(INJECTED_BUTTON_ROOT_ID)};
  const old = document.getElementById(rootId);
  if (old) old.remove();
  if (!payload.entries.length || !document.body) return;

  const root = document.createElement('div');
  root.id = rootId;
  root.style.position = 'fixed';
  root.style.left = 'auto';
  root.style.right = '0';
  root.style.top = '42%';
  root.style.width = '0';
  root.style.height = '0';
  root.style.overflow = 'visible';
  root.style.zIndex = '2147483647';
  root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  root.style.colorScheme = 'light';

  const style = document.createElement('style');
  style.textContent = \`
    #\${rootId}, #\${rootId} * { box-sizing: border-box; }
    #\${rootId} .mmc-btn {
      position: absolute;
      top: 0;
      right: 0;
      min-width: 128px;
      height: 48px;
      border: 0;
      border-radius: 999px;
      background: #165dff;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      line-height: 48px;
      padding: 0 22px;
      cursor: grab;
      box-shadow: 0 12px 30px rgba(22, 93, 255, .28), 0 3px 10px rgba(15, 23, 42, .18);
      user-select: none;
      touch-action: none;
    }
    #\${rootId} .mmc-btn:active { cursor: grabbing; }
    #\${rootId} .mmc-modal {
      position: absolute;
      top: 58px;
      right: 8px;
      width: 292px;
      max-width: min(292px, calc(100vw - 28px));
      border: 1px solid rgba(148, 163, 184, .36);
      border-radius: 14px;
      background: #fff;
      color: #0f172a;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .24);
      overflow: hidden;
    }
    #\${rootId}[data-side="left"] .mmc-modal {
      left: 8px;
      right: auto;
    }
    #\${rootId} .mmc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: 38px;
      padding: 0 10px 0 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 800;
    }
    #\${rootId} .mmc-close {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 20px;
    }
    #\${rootId} .mmc-close:hover { background: #e2e8f0; color: #0f172a; }
    #\${rootId} .mmc-list {
      max-height: min(360px, calc(100vh - 120px));
      overflow: auto;
      padding: 6px;
    }
    #\${rootId} .mmc-row {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 10px;
      background: transparent;
      padding: 9px 10px;
      text-align: left;
      cursor: pointer;
    }
    #\${rootId} .mmc-row:hover { background: #eef4ff; }
    #\${rootId} .mmc-title {
      display: block;
      color: #0f172a;
      font-size: 12px;
      font-weight: 800;
      line-height: 16px;
    }
    #\${rootId} .mmc-desc {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
      line-height: 15px;
    }
  \`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mmc-btn';
  button.textContent = 'micromeet';
  button.setAttribute('aria-label', 'Open Micromeet skills');

  const modal = document.createElement('div');
  modal.className = 'mmc-modal';
  modal.hidden = true;
  modal.innerHTML = '<div class="mmc-head"><span>Micromeet skills</span><button type="button" class="mmc-close" aria-label="Close">×</button></div><div class="mmc-list"></div>';
  const list = modal.querySelector('.mmc-list');
  for (const item of payload.entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mmc-row';
    row.innerHTML = '<span class="mmc-title"></span><span class="mmc-desc"></span>';
    row.querySelector('.mmc-title').textContent = item.skillTitle || 'Untitled skill';
    row.querySelector('.mmc-desc').textContent = item.skillDescription || 'Trigger Maestro';
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const params = new URLSearchParams({
        domain: payload.domain,
        nonce: payload.nonce,
        title: item.skillTitle || '',
        description: item.skillDescription || ''
      });
      window.open('bitterless-maestro://trigger?' + params.toString(), '_blank', 'noopener');
      modal.hidden = true;
    });
    list.appendChild(row);
  }

  root.appendChild(style);
  root.appendChild(button);
  root.appendChild(modal);
  root.dataset.side = 'right';
  document.body.appendChild(root);

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const edgeOffset = () => Math.max(1, Math.round(button.offsetHeight / 2));
  const place = (x, y) => {
    root.dataset.side = 'drag';
    root.style.left = clamp(x, 8, window.innerWidth - button.offsetWidth - 8) + 'px';
    root.style.right = 'auto';
    root.style.top = clamp(y, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = '0';
    button.style.right = 'auto';
    button.style.transform = 'none';
  };
  const dock = (side, top) => {
    const offset = edgeOffset();
    root.style.setProperty('--mmc-edge-offset', offset + 'px');
    root.dataset.side = side;
    root.style.left = side === 'left' ? '0' : 'auto';
    root.style.right = side === 'right' ? '0' : 'auto';
    root.style.top = clamp(top, 8, window.innerHeight - button.offsetHeight - 8) + 'px';
    button.style.left = side === 'left' ? '0' : 'auto';
    button.style.right = side === 'right' ? '0' : 'auto';
    button.style.transform = side === 'left' ? 'translateX(-' + offset + 'px)' : 'translateX(' + offset + 'px)';
  };
  const snap = () => {
    const rect = button.getBoundingClientRect();
    const side = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    dock(side, rect.top);
  };
  dock('right', window.innerHeight * 0.42);

  button.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = button.getBoundingClientRect();
    originX = rect.left;
    originY = rect.top;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
    place(originX + dx, originY + dy);
  });
  button.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    button.releasePointerCapture(event.pointerId);
    snap();
    if (!moved) modal.hidden = !modal.hidden;
  });
  modal.querySelector('.mmc-close').addEventListener('click', () => {
    modal.hidden = true;
  });
  window.addEventListener('resize', snap);
})();
`
}

const parseInjectedButtonTriggerUrl = (url: string): InjectedButtonTrigger | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'bitterless-maestro:' || parsed.hostname !== 'trigger') return null
    const domain = normalizeInjectedButtonDomain(parsed.searchParams.get('domain') || '')
    const nonce = parsed.searchParams.get('nonce') || ''
    const skillTitle = clipInline(parsed.searchParams.get('title') || '', 120)
    if (!domain || !nonce || !skillTitle) return null
    return {
      domain,
      nonce,
      skillTitle,
      skillDescription: clipInline(parsed.searchParams.get('description') || '', 500)
    }
  } catch {
    return null
  }
}

const injectedButtonTriggerMessage = (trigger: InjectedButtonTrigger): string =>
  [
    `Run injected webpage skill: ${trigger.skillTitle}`,
    `Domain: ${trigger.domain}`,
    trigger.skillDescription ? `Details: ${trigger.skillDescription}` : ''
  ]
    .filter(Boolean)
    .join('\n')
