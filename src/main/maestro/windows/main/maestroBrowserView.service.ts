import { prepareBrowserDocument } from './browserDocumentPreparation'
import { bindBrowserHistoryRecorder } from './browserHistoryRecorder';
import type { BrowserHistoryApi } from '@maestro-shared/browserHistory.api';
import { Menu, WebContentsView, clipboard } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, View, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { injectable } from 'inversify'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { DebuggerCapture } from '@maestro-main/capture/debuggerCapture'
import { chromeIdentity } from '@maestro-main/capture/chromeIdentity'
import { ReplayEngine } from '@maestro-main/drive/replayEngine'
import { normalizeUrl } from '@maestro-main/settings/coachSettings.service'
import { getMaestroPreviewOpener } from './previewOpener.registry'
import { focusAddressBarForBlankTab } from './newTabFocus'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import type {
  AgentActivityStep,
  CaptureState,
  CoachSettings,
  InjectedButtonDomain,
  InjectedButtonRemoveResult,
  ActiveTabContent,
  AgentBrowserTabState,
  TabKind,
  TabInfo,
  WorkbenchTabState,
  ViewRect
} from '@maestro-shared/coach.api'
import { MAESTRO_LOCAL_HOME_DISPLAY_URL } from '@maestro-shared/coach.api'
import { MAESTRO_ONLY_PREVIEW_DISPLAY_URL } from '@maestro-shared/compositeTab.identity'
import type {
  MaestroCompositeTabHostApi,
  MaestroCompositeTabSpec
} from '@maestro-shared/compositeTab.api'
import type { InjectBtnApi, InjectBtnEntry, InjectBtnInput } from '@maestro-shared/injectBtn.api'
import type { SavedTab } from '@maestro-shared/tabs.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { createBoundsApplier, maestroFirstFrameOperationRect } from './viewBounds'
import {
  defaultHomeMaestroCompositeTabId,
  getMaestroCompositeTab,
  listMaestroCompositeTabs
} from './compositeTab.registry'

/**
 * A composite tab's persistent identity.
 *
 * 12 hex chars, not a full UUID: the identity ends up inside a Zellij session name, which is capped
 * at 48 characters behind a profile prefix that already costs 22 (`bitterless-test-debug-`).
 * Truncation there would fold two tabs onto ONE session — the exact silent pane-sharing this design
 * exists to prevent — and 12 hex is both short enough to never reach the cap and wide enough
 * (2^48) that a collision is not a thing that happens.
 */
const mintTabInstanceId = (): string => randomBytes(6).toString('hex')

export const shouldOpenOperationDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  if (process.env.BITTERLESS_E2E === '1') return false
  return process.env.COACH_DEVTOOLS === '1'
}

export const shouldOpenPinnedHomeDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  return process.env.BITTERLESS_E2E !== '1'
}

const LOCAL_HOME_TITLE = 'Home'
const LOCAL_HOME_FAVICON = ''
// Chromium may keep a page "loading" for a stalled subresource or never emit a stop event when
// its renderer dies. The tab spinner is only a status hint, so always settle it after this cap.
const LOAD_WATCHDOG_MS = 30_000
const INJECTED_BUTTON_ROOT_ID = '__bitterless_maestro_button_root__'
const injectBtnStore = createXpcMainEmitter<InjectBtnApi>('InjectBtnDao')
const browserHistory = createXpcMainEmitter<BrowserHistoryApi>('BrowserHistoryDao');

const isWorkbenchInternalUrl = (url: string): boolean => /^(?:bitterless|micromeet):\/\/workbench(?:[/?#].*)?$/i.test(url.trim())

interface LocalHomeEntry {
  url: string
  file?: string
}

const localHomeEntry = (): LocalHomeEntry => {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')
    return { url: `${base}/maestro/localHome/index.html` }
  }
  const file = join(__dirname, '../renderer/maestro/localHome/index.html')
  return { url: pathToFileURL(file).toString(), file }
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

export interface ViewSlot {
  view: WebContentsView
  capture: DebuggerCapture
  replay: ReplayEngine
  attachReady?: Promise<void>
  documentReady?: Promise<void>
}

export interface OperationTab {
  id: string
  kind: TabKind
  /**
   * A composite mini-app tab's PERSISTENT identity, minted here and handed to the mini app.
   *
   * `id` cannot serve: `tabSeq` restarts at 0 each launch, so a restored `tab-2` would address
   * whatever `tab-2` happened to own last time. Anything a mini app keeps outside the process — a
   * Zellij session, say — is keyed on this instead, which is what makes a restored tab come back to
   * its own state rather than a stranger's.
   */
  instanceId?: string
  view: WebContentsView | null
  /**
   * A composite mini-app's own container `View`, for a tab whose content is not one web page.
   *
   * `view` stays `null` for such a tab, which is what keeps it out of `enforceWarmCap` — its `warm`
   * filter only counts tabs with a live `view`. That matters: cooling an OnlyPreview tab would
   * detach the container while leaving its four renderers, its hidden search runtime, its bound
   * workspace and its host capability alive and unreachable.
   */
  surface?: View | null
  /**
   * A composite mini-app's LIVE address-bar string, pushed up by the mini app itself.
   *
   * Empty/absent = fall back to the spec's static `displayUrl`. OnlyPreview uses this to show the
   * `file://` URL of whatever it is currently previewing, so the address bar reads like a real
   * browser's (Ral 2026-09-10) instead of a fixed `bitterless://only-preview`.
   */
  compositeDisplayUrl?: string
  /**
   * 这个 tab 上一次作为**网页 tab** 时停在哪个 URL —— 只在页面类型切换时读写。
   *
   * 换类型是就地改造同一个 tab(见 `setTabKind`),`tab.url` 会被新类型覆盖;没有这一格,
   * 「切去 Zellij 看一眼再切回来」就等于把那个网页丢了。
   */
  websiteUrl?: string
  capture: DebuggerCapture | null
  replay: ReplayEngine | null
  attachReady?: Promise<void>
  documentReady?: Promise<void>
  /** Runtime state for this view only; blank prewarming is not an intended navigation. */
  navigationStarted?: boolean
  navigationRequest?: number
  navigationPending?: Promise<void>
  navigationTarget?: string
  navigationPreparationFailed?: boolean
  externalNavigation?: boolean
  coolingReady?: Promise<void>
  cooling?: boolean
  closeReady?: Promise<void>
  url: string
  title: string
  /**
   * 操作者给这个 tab 起的名字。**独立字段,永远不写进 `title`**。
   *
   * `title` 有六个写入方(`page-title-updated`、composite 的 `setTitle`、两个 tab 工厂、
   * `setTabKind`、restore),任何一条一响就把用户起的名字静默冲掉 —— 这正是 alias 必须自己一格
   * 的全部理由(docs/features/tab-alias.md #1)。空/未定义 = 没有别名,显示页面标题。
   */
  alias?: string
  favicon: string
  /** agent 正在驱动这个 tab(deep_fetch 渲染中 / ui_act 点击中)。渲染层据此给 favicon 槽上动画。 */
  controlled?: boolean
  browserError?: { status: 'crashed' | 'destroyed' | 'load-failed'; error: string }
  debuggerEnabled: boolean
  pinned: boolean
  lastActive: number
  /** Page load in flight; projected to the tab chip instead of a global progress bar. */
  loading: boolean
  /** Hard cap for a missing did-stop-loading event. Cleared whenever the view loses ownership. */
  loadWatchdog: ReturnType<typeof setTimeout> | null
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
  protectedBrowserTabIds?(): string[]
  isCaptureTab?(id: string): boolean
  isDrillBranchTab?(id: string): boolean
  tabsOpenedThisTurn: TabInfo[]
  browserTabsChanged?(): void
  browserPopupOwner?(sourceTabId: string): string | undefined
  browserPopupOpened?(sessionId: string, tabId: string, sourceTabId?: string): Promise<void>
  browserPopupActivity?(sessionId: string, tabId: string, on: boolean, generation?: number): void
  browserUseGeneration?(sessionId: string): number
  browserPopupStillOwned?(sessionId: string, sourceTabId: string | undefined, generation: number | undefined): boolean

  dismissBrowserHistory?(): void;
  emitTrace(event: TraceEvent): void
  layout(): void
  readMaestroSettings(): CoachSettings
  hasCustomStartUrl(): boolean
  /**
   * 设置落盘口(自定义主页要写 `homeCompositeId`)。设置服务归 controller 所有,它也管 `startUrl`。
   *
   * 与下面两条一样**声明成可选**:测试夹具喂的是一个手写的 state 字面量,而这些都是宿主能力
   * ——取不到时的降级行为都是「就当没设过」,那正是默认行为,fail closed。
   */
  saveMaestroSettings?(patch: Partial<CoachSettings>): CoachSettings
  /**
   * 这次启动是不是「登出 / 鉴权拆卸后的强制回固有 Home」那一发。
   *
   * 是的话固有槽位**无视自定义主页**,装回内置本地 Home —— 拆卸必须落在第一方登录门上
   * (docs/features/custom-homepage-tab.md #3.5 与 `maestroLogoutHomeLanding` 的验收 A8)。
   * 作为 state 的一条读能力而不是 `createPinnedHomeTab()` 的入参,是因为那个调用点被
   * `check-ioc-composition.mjs` 按字面量钉着。
   */
  forcePinnedHomeBoot?(): boolean
  /** 弹别名表单,`null` = 取消(不改动 alias)。覆盖层归 controller,见 `maestroTabAliasView.service.ts`。 */
  requestTabAlias?(params: { tabLabel: string; alias: string }): Promise<string | null>
  openWorkbenchTab(): Promise<WorkbenchTabState>
  /**
   * Send the Workbench to the background.
   *
   * Needed here because the Workbench is a foreground VIEW rather than an `OperationTab`: activating
   * a tab does not hide it, so anything in this file that brings a tab forward on its own (the +
   * button's mini-app rows) has to say so explicitly, the way `newTab()` already does.
   */
  backgroundWorkbenchTab(): Promise<WorkbenchTabState>
  newTab(): Promise<void>
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
  private spareWarmTask: ReturnType<typeof setImmediate> | null = null
  private activationGeneration = 0
  private readonly initializingViews = new WeakMap<WebContentsView, object>()
  private creatingTab = false
  private injectedButtonNonces = new Map<string, string>()
  private readonly compositeTabs = new Map<string, MaestroCompositeTabSpec>()
  /**
   * Each composite tab's own host object, by tab id.
   *
   * A spec is registered once and can now carry several live tabs, so the host cannot live in the
   * registration's closure — the second tab would overwrite the first one's geometry and teardown
   * callbacks. Every `spec.close/setActive/refresh` call is addressed with the host from here.
   */
  private readonly compositeHosts = new Map<string, MaestroCompositeTabHostApi>()
  private lifecycleEpoch = 0
  private contentCovered = false

  /**
   * 用户**自己设过**的主页 id —— 空串 = 没设过。
   *
   * 与 `resolveHomeCompositeId()` 刻意分开:后者会替没设过的机器答出 registry 的默认值,而
   * 「用户设没设过」本身是三个判据的依据(`Alias…` 能不能点、`Restore default homepage` 能不能点、
   * 还原之后槽位该装谁),拿「解析结果非空」去问会恒真。
   * 见 `docs/features/onlypreview-default-homepage.md` #2。
   */
  private homeCompositeSetting(): string {
    return String(this._state.readMaestroSettings?.().homeCompositeId || '').trim()
  }

  /**
   * 固有槽位装哪个 composite mini-app —— 返回 `null` 意思是「内置本地 Home」。
   *
   * 两级:用户设过的值优先,没设过就用 registry 里声明 `defaultHome` 的那个(bl 是 OnlyPreview,
   * cowork 不声明 ⇒ 仍然是内置本地 Home)。
   *
   * **fail closed**,与 `getMaestroCompositeTab` 的「未知 id 返回 null,不兜底到某个默认
   * mini-app」同一条纪律:降级、改名、脏数据都只该让主页回到默认,不该让固有槽位空着。
   */
  private resolveHomeCompositeId(): string | null {
    const id = this.homeCompositeSetting() || defaultHomeMaestroCompositeTabId() || ''
    if (!id) return null
    return getMaestroCompositeTab(id) ? id : null
  }

  /**
   * 自定义主页那个 composite tab 的 `instanceId` —— 按 spec id 推导,**不是**随机铸的。
   *
   * 随机铸的话每次启动都是一条新身份,mini app 每次都从零开始(Zellij 每启动一次多一条孤儿会话)。
   * 固有槽位每台机器只有一个,按 spec id 推导就足以稳定且互不相撞;取 12 位十六进制是因为它会
   * 进 Zellij 的会话名,那里有 48 字符上限(见 `mintTabInstanceId`),而随机铸的 48 位空间与这条
   * 派生值也不会相撞。
   */
  private homeCompositeInstanceId(id: string): string {
    return createHash('sha256').update(`maestro-home-composite:${id}`).digest('hex').slice(0, 12)
  }

  /**
   * 固有槽位上次记下的身份与别名 —— 重建那一格时按这两个值还原。
   *
   * 为什么不能靠 tab 持久化拿回来:固有 tab 是 `pinned` 的,而 pinned tab 按设计不进 SavedTab
   * (`tab.store.ts` 的 `isRestorableComposite` 要求 `!t.pinned`,**那条过滤不许放松**)。所以
   * 这一格身上的一切都只能从设置里重建。
   *
   * `homeInstanceId` 空 = 这份设置写于加这一格之前,退回按 spec id 推导的那个值
   * (`homeCompositeInstanceId`)—— **只是存量兜底**:推导值保证每次启动稳定(不会每启动一次漏
   * 一条 Zellij 会话),但它跟设为主页那一刻真正在槽位里的那条会话对不上,那条会话会变成孤儿。
   * 新写入一律记真实 `instanceId`,见 `setAsHomepage`。
   */
  private readHomeCompositeSlot(id: string): { instanceId: string; alias?: string } {
    const settings = this._state.readMaestroSettings?.()
    const instanceId = String(settings?.homeInstanceId || '').trim()
    const alias = String(settings?.homeAlias || '').trim()
    return {
      instanceId: instanceId || this.homeCompositeInstanceId(id),
      ...(alias ? { alias } : {})
    }
  }

  /**
   * 固有槽位那一格 composite tab 的**对象**(还没挂内容 —— 挂载在 `loadPinnedHomeTab()`)。
   *
   * 抽出来是因为有两个入口要建出**同一形状**的一格:启动链的 `createPinnedHomeTab()`,和
   * 「还原默认主页」时把默认 mini app 装回槽位那一步。身份与别名都从设置还原(见
   * `readHomeCompositeSlot`),两处必须同源,否则还原出来的那一格会拿到一个新铸的身份。
   */
  private buildPinnedCompositeTab(compositeId: string): OperationTab {
    const slot = this.readHomeCompositeSlot(compositeId)
    return {
      id: `tab-${++this.tabSeq}`,
      kind: compositeId as TabKind,
      instanceId: slot.instanceId,
      view: null,
      surface: null,
      capture: null,
      replay: null,
      url: '',
      title: getMaestroCompositeTab(compositeId)?.title ?? '',
      // 别名跨重启只能走设置这一条路(见 `readHomeCompositeSlot`)。
      ...(slot.alias ? { alias: slot.alias } : {}),
      favicon: getMaestroCompositeTab(compositeId)?.favicon ?? '',
      debuggerEnabled: false,
      pinned: true,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
  }

  /**
   * 固有槽位那一格内置本地 Home 的**对象与 view**。
   *
   * 同上一条同一个理由:启动链与「还原默认主页」的兜底支都要建它,而它带着一个真的
   * `WebContentsView`(第一方 preload、导航禁闭都挂在上面)——两处各拼一份迟早只改一处。
   */
  private buildPinnedLocalHomeTab(): OperationTab {
    const view = this.buildPinnedHomeView()
    const entry = localHomeEntry()
    return {
      id: `tab-${++this.tabSeq}`,
      kind: 'home',
      view,
      capture: null,
      replay: null,
      url: entry.url,
      title: LOCAL_HOME_TITLE,
      favicon: LOCAL_HOME_FAVICON,
      debuggerEnabled: false,
      pinned: true,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
  }

  /**
   * 建固有 tab 的**对象与 view 槽位**。真正的导航发生在 `loadPinnedHomeTab()`。
   *
   * 两处分离是仓里既有的形状,也是这个功能最典型的「假完成」——只改其中一个,新装的机器看起来
   * 对,启动后那一格是空的(docs/features/custom-homepage-tab.md #3.1)。
   *
   * 固有槽位装 mini app 时返回 `null`:那一格没有 `WebContentsView`。**新装的机器也走这一支**
   * —— bl 的默认主页就是一个 mini app(docs/features/onlypreview-default-homepage.md)。
   */
  createPinnedHomeTab(): WebContentsView | null {
    // 登出那一发无视自定义主页 —— 拆卸必须落在第一方本地 Home 上。
    const compositeId = this._state.forcePinnedHomeBoot?.() ? null : this.resolveHomeCompositeId()
    if (compositeId) {
      const pinned = this.buildPinnedCompositeTab(compositeId)
      this.tabs.push(pinned)
      this.activeTabId = pinned.id
      this.setOperationView(null)
      this._state.capture = null
      this._state.replayEngine = null
      return null
    }
    const first = this.buildPinnedLocalHomeTab()
    const view = first.view
    this.tabs.push(first)
    this.activeTabId = first.id
    this.setOperationView(view)
    this._state.capture = null
    this._state.replayEngine = null
    return view
  }

  /**
   * 把固有槽位真正装起来。跟着 `createPinnedHomeTab()` 建出来的那个 tab 的 kind 走,所以两者
   * 不可能对「今天装谁」有两种看法。
   *
   * 自定义主页走 `mountComposite` —— 与 `openCompositeTab` / `setTabKind` **同一条挂载路径**,
   * 而不是在启动链上多开一个 tab:`restoreTabs` 见到任何非 pinned tab 就整条罢工,启动期多开一个
   * tab 会把会话恢复永久且静默地关掉(它与 `openStartupTabIfNeeded` 都是一次性的)。
   */
  async loadPinnedHomeTab(): Promise<void> {
    const tab = this.tabs.find((item) => item.pinned)
    if (!tab) throw new Error('Bundled Home view is unavailable.')
    if (tab.kind !== 'home') {
      try {
        const spec = getMaestroCompositeTab(tab.kind)
        if (!spec) throw new Error(`No composite mini app '${tab.kind}' for the pinned slot.`)
        await this.mountComposite(tab, spec)
        this.setCompositeActive(tab.id, tab.id === this.activeTabId)
        this.sendTabNav(tab, true)
        this.broadcastTabs()
        return
      } catch (err) {
        // mini app **合法地**拒绝开(Zellij 在 Terminal 开关关着时就会拒 —— `restoreTabs` 的注释
        // 点名了这一条)。抛出去的代价不是「主页没装起来」而已:启动链上 `openStartupTabIfNeeded`
        // 挂在同一个 promise 的 `.then()` 上,一起被跳过,而条上那唯一的固有 tab 没有任何内容 ——
        // 用户看到一条空条,没有可回落的 Home(验收 A6:不崩、不空条)。
        //
        // 所以**这一发启动**退回内置本地 Home,设置一个字不动:拒绝的原因通常是可恢复的(把
        // Terminal 开关打开),下次启动照样再试它。trace 里点名是哪个 mini app、为什么拒 ——
        // 否则「主页怎么变回去了」无从查起。
        this._state.emitTrace({
          kind: 'error',
          msg: `homepage mini app ${tab.kind} refused to open, falling back to the built-in Home for this boot: ` +
            (err as Error).message,
          ts: Date.now()
        })
        this.demotePinnedTabToLocalHome(tab)
      }
    }
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) throw new Error('Bundled Home view is unavailable.')
    const entry = localHomeEntry()
    tab.url = entry.url
    tab.navigationStarted = true
    if (entry.file) await wc.loadFile(entry.file)
    else await wc.loadURL(entry.url)
    this.sendTabNav(tab, true)
    this.broadcastTabs()
  }

  /**
   * 把装不起来的自定义主页**就地**换成内置本地 Home,只影响这一发启动。
   *
   * 就地改造而不是「关掉再建一个」:`MenuBar.vue` 在没有任何 tab 报 `pinned` 时会回落到 index 0
   * (注释写着「不该发生」),所以零 pinned 的中间态一次都不许出现
   * (custom-homepage-tab.md #3.2)。`pinned` / tab id 都原样留着,换掉的只是内容。
   *
   * 可见性要**自己补**:启动链只会把 `createPinnedHomeTab()` 返回的那个 view 显出来,而自定义
   * 主页那一支返回的是 `null`(composite tab 没有 `WebContentsView`)—— 这里新建的 view 没人管,
   * 不自己 `setVisible(true)` 就是一块看不见的白板,症状与「空条」难以区分。
   */
  private demotePinnedTabToLocalHome(tab: OperationTab): void {
    tab.kind = 'home'
    tab.instanceId = undefined
    tab.compositeDisplayUrl = undefined
    // 别名跟着自定义主页走:这一格现在装的是内置 Home,而内置 Home 的名字来自 registry
    // (`isDefaultHomeTab` 据此禁掉 `Alias…`)。设置里那份一个字没动,下次启动照旧还原。
    tab.alias = undefined
    tab.favicon = LOCAL_HOME_FAVICON
    tab.title = LOCAL_HOME_TITLE
    tab.debuggerEnabled = false
    tab.view = this.buildPinnedHomeView()
    this.setOperationView(tab.view)
    if (this.activeTabId === tab.id) {
      tab.view.setVisible(true)
      if (this._state.opBounds) this.applyBounds(tab.view, this._state.opBounds)
      else this._state.layout()
    }
  }

  async openStartupTabIfNeeded(params?: { skipForThisBoot?: boolean }): Promise<void> {
    if (this.startupTabOpened) return
    this.startupTabOpened = true
    if (params?.skipForThisBoot) return
    const settings = this._state.readMaestroSettings()
    if (!this._state.hasCustomStartUrl()) return
    const url = settings.startUrl
    if (!url) return
    await this.openTab({ url }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'startup tab: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async navigate(params: { url: string }): Promise<void> {
    this._state.dismissBrowserHistory?.();
    if (isWorkbenchInternalUrl(params.url || '')) {
      await this._state.openWorkbenchTab()
      return
    }
    if (!this._state.operationView) return
    const active = this.tabs.find((tab) => tab.id === this.activeTabId)
    if (active?.kind !== 'browser') return
    const raw = (params.url || '').trim()
    // 本机绝对路径 —— **判据与落法都问宿主的预览端口**,maestro 不认识 OnlyPreview
    // (`check:maestro` 的别名边界;`MaestroPreviewOpener.resolveLocalTarget` 上写了完整理由)。
    //
    // `null` = 不是本机路径,按地址原路走。`preview` 交给预览应用;`chrome` 与 `missing` 都落下面
    // 那一发加载 —— 一个是 Chromium 自己渲染这个文件,一个是 Chromium 自己的「文件不存在」页,
    // 两张落地页都不是我们画的,这也是它们能共用一条代码路径的原因。
    const previewOpener = getMaestroPreviewOpener()
    const localTarget = previewOpener?.resolveLocalTarget(raw) ?? null
    if (localTarget?.kind === 'preview') {
      if (!previewOpener?.openInTab) throw new Error('File preview tabs are unavailable.')
      await previewOpener.openInTab(localTarget.path, { tabId: active.id })
      return
    }
    // 路径那一支**不能**过 `normalizeUrl` —— 它会把 `/Users/…` 补成 `https:///Users/…`,
    // 落地是一张无解的错误页,而不是「这个文件不存在」。
    const target = localTarget ? localTarget.fileUrl : normalizeUrl(params.url)
    if (!target) return
    await this.startTabNavigation(active, { url: target, explicit: true }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'navigate: ' + (err as Error).message, ts: Date.now() })
    })
  }

  async reload(): Promise<void> {
    const active = this.getActiveTab()
    if (!active) return
    const wc = active.view?.webContents
    if (!wc || wc.isDestroyed()) {
      await this.warmAndLoad(active)
      return
    }
    if (active.kind === 'browser' && (active.navigationPending || active.navigationPreparationFailed || !active.navigationStarted)) {
      await this.startTabNavigation(active, { url: active.navigationTarget || active.url, explicit: true }).catch((error) => {
        this._state.emitTrace({ kind: 'error', msg: 'reload: ' + (error as Error).message, ts: Date.now() })
      })
      return
    }
    active.navigationRequest = (active.navigationRequest ?? 0) + 1
    wc.reload()
  }

  async goBack(): Promise<void> {
    const active = this.getActiveTab()
    if (!active || active.kind !== 'browser') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoBack()) return
    active.navigationRequest = (active.navigationRequest ?? 0) + 1
    wc.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    const active = this.getActiveTab()
    if (!active || active.kind !== 'browser') return
    const wc = this._state.operationView?.webContents
    if (!wc || wc.isDestroyed() || !wc.navigationHistory.canGoForward()) return
    active.navigationRequest = (active.navigationRequest ?? 0) + 1
    wc.navigationHistory.goForward()
  }

  async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return await this.getTabs()
    if (tab.kind !== 'browser') return await this.getTabs()
    const enabled = Boolean(params.enabled)
    if (tab.debuggerEnabled !== enabled) {
      if (!enabled && this._state.capturing && this._state.captureTargetTabId === tab.id && !this._state.isDrillBranchTab?.(tab.id)) {
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
    if (!shouldOpenOperationDevTools()) return
    if (this.getActiveTab()?.kind !== 'browser') return
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

  /**
   * `operationView` 的**唯一写入口**。
   *
   * 收成一个口子是为了圆角:原生圆角按 view 设,而后台 view 错过了它不在前台时的每一次 control
   * 翻转 —— 所以"成为前台内容"这件事本身必须补一次。这条路有三个入口(固有 Home 装配、切到
   * composite 时置空、切到网页 tab),散着挂钩子必然漏一条,漏掉的症状是"某个 tab 切回来是方角",
   * 而且**不报错**。
   */
  private setOperationView(view: WebContentsView | null): void {
    this._state.operationView = view
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this._state.operationView, rect)
  }

  private addTab(meta: { url?: string; title?: string; favicon?: string; alias?: string }): OperationTab {
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      navigationStarted: false,
      view: null,
      capture: null,
      replay: null,
      url: meta.url || '',
      title: meta.title || '',
      ...(meta.alias ? { alias: meta.alias } : {}),
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: 0,
      loading: false,
      loadWatchdog: null
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
      () => { const id = this.ownerOf(view)?.id; return Boolean(id && (this._state.isCaptureTab?.(id) ?? (this._state.capturing && id === this._state.captureTargetTabId))) }
    )
    const replay = new ReplayEngine(view.webContents)
    this.attachViewListeners(view)
    return this.initializeViewSlot({ view, capture, replay })
  }

  private initializeViewSlot(slot: ViewSlot): ViewSlot {
    const { view, capture } = slot
    const token = {}
    this.initializingViews.set(view, token)
    slot.documentReady = prepareBrowserDocument(view.webContents).finally(() => {
      if (this.initializingViews.get(view) === token) this.initializingViews.delete(view)
    })
    slot.attachReady = slot.documentReady.then(() => capture.attach()).catch((error) => {
      if (!view.webContents.isDestroyed() && !capture.isSuspended()) {
        this._state.emitTrace({ kind: 'error', msg: 'browser preparation: ' + (error as Error).message, ts: Date.now() })
      }
    })
    return slot
  }

  private schedulePrewarmSpare(): void {
    if (this.spareWarmTask || this.spareSlot) return
    const epoch = this.lifecycleEpoch
    this.spareWarmTask = setImmediate(() => {
      this.spareWarmTask = null
      if (epoch === this.lifecycleEpoch) void this.prewarmSpare()
    })
  }

  private startTabNavigation(tab: OperationTab, options: { url?: string; explicit?: boolean } = {}): Promise<void> {
    const view = tab.view
    if (!view || !this.isLiveTabView(tab, view) || tab.closeReady) return Promise.resolve()
    if (!options.explicit && (tab.externalNavigation || tab.navigationStarted)) return tab.navigationPending ?? Promise.resolve()
    const target = options.url ?? tab.url
    if (!target) return Promise.resolve()
    const request = (tab.navigationRequest ?? 0) + 1
    const epoch = this.lifecycleEpoch
    tab.navigationRequest = request
    tab.navigationStarted = true
    tab.navigationTarget = target
    tab.browserError = undefined
    this.setTabLoading(tab, true)
    const current = (): boolean => this.isLiveTabView(tab, view, epoch) && !tab.closeReady && tab.navigationRequest === request
    const pending = (async (): Promise<void> => {
      try {
        if (tab.kind === 'browser') {
          if (tab.navigationPreparationFailed && options.explicit && tab.capture) {
            tab.capture.detach()
            view.webContents.stop()
            const slot = this.initializeViewSlot({ view, capture: tab.capture, replay: tab.replay! })
            tab.documentReady = slot.documentReady
            tab.attachReady = slot.attachReady
          }
          try {
            await tab.documentReady
            if (!current()) return
            if (tab.debuggerEnabled) await tab.capture?.prepareNavigation()
          } catch (error) {
            if (current()) tab.navigationPreparationFailed = true
            throw error
          }
        }
        if (!current()) return
        tab.navigationPreparationFailed = false
        await view.webContents.loadURL(target)
      } catch (error) {
        if (!current()) return
        this.setTabLoading(tab, false)
        tab.browserError = { status: 'load-failed', error: String(error) }
        this.broadcastTabs()
        throw error
      } finally {
        if (current()) tab.navigationPending = undefined
      }
    })()
    tab.navigationPending = pending
    return pending
  }

  /**
   * Open a registered composite mini app as a tab, or bring the existing one forward.
   *
   * The tab carries the mini app's own container view instead of a web view, so `view` stays `null`
   * and every path that reaches for `tab.view` skips it — including the warm cap, which must never
   * cool a whole sub-application. Nothing here knows which mini app it is: the host registered a
   * spec, and this drives it.
   */
  /**
   * Open a composite tab and show `path` inside it (Ral 2026-09-07: the chat workspace chip should
   * land in OnlyPreview, not in a folder picker).
   *
   * Both steps here rather than in the caller, because the ORDER is load-bearing and easy to get
   * backwards: the tab has to exist before the target is handed over, or the mini app's own
   * "ensure a host" path finds none and opens a standalone window instead of filling the tab.
   * Maestro still learns nothing about what is in the tab — `openTarget` is a capability the host
   * registered with the spec.
   */
  async openCompositeTabTarget(params: {
    id: string
    path: string
  }): Promise<{ ok: boolean; error?: string }> {
    const target = String(params?.path || '').trim()
    if (!target) return { ok: false, error: 'A path is required.' }
    try {
      const tab = await this.openCompositeTab({ id: params.id })
      if (!tab) return { ok: false, error: `No composite tab is registered as '${params.id}'.` }
      const spec = this.compositeTabs.get(tab.id)
      if (!spec?.openTarget) {
        return { ok: false, error: `'${params.id}' cannot open a path.` }
      }
      await spec.openTarget(target)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  /**
   * Open a registered composite mini app as a tab.
   *
   * Reuse is decided by the SPEC, not by this method: `singleton` mini apps bring their one tab
   * forward, everything else gets a brand-new tab with a brand-new `instanceId` — which is what
   * makes "Initialize and open" start a fresh Zellij session rather than reattach to the last one
   * (Ral 2026-09-11). Passing `instanceId` explicitly is the restore path: same id, same session.
   */
  async openCompositeTab(params: {
    spec?: MaestroCompositeTabSpec
    id: string
    instanceId?: string
    /** Restore opens tabs COLD — the pinned Home tab keeps focus until `restoreLastActive` runs. */
    activate?: boolean
  }): Promise<OperationTab | null> {
    const spec = params.spec ?? getMaestroCompositeTab(params.id)
    if (!spec) return null
    // Reopening a known instance is always a reuse, singleton or not — that is how a restored tab
    // that is asked for twice does not become two tabs sharing one session.
    const existing = params.instanceId
      ? this.tabs.find((tab) => tab.instanceId === params.instanceId)
      : spec.singleton
        ? this.tabs.find((tab) => tab.kind === spec.id)
        : undefined
    if (existing) {
      if (params.activate !== false) await this.activateTab({ id: existing.id })
      return existing
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: spec.id as TabKind,
      instanceId: params.instanceId || mintTabInstanceId(),
      view: null,
      surface: null,
      capture: null,
      replay: null,
      url: '',
      title: spec.title,
      favicon: spec.favicon,
      debuggerEnabled: false,
      pinned: false,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(tab)
    try {
      await this.mountComposite(tab, spec)
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: `composite tab ${spec.id}: ` + (err as Error).message, ts: Date.now() })
      const index = this.tabs.indexOf(tab)
      if (index >= 0) this.tabs.splice(index, 1)
      this.broadcastTabs()
      throw err
    }
    // The mount may finish after Workbench covered the operation area, including cold restores.
    this.setCompositeActive(tab.id, tab.id === this.activeTabId)
    if (params.activate === false) {
      this.broadcastTabs()
      return tab
    }
    await this.activateTab({ id: tab.id })
    return tab
  }

  /**
   * Build a registered composite mini app onto an EXISTING tab.
   *
   * Extracted so the two ways a tab can come to hold a mini app — `openCompositeTab` (a brand-new
   * tab) and `setTabKind` (converting one in place) — mount through ONE code path. The host object
   * below is the mini app's entire view of Maestro; a second copy of it would drift the first time
   * a capability is added to one and not the other.
   *
   * A failed mount leaves nothing registered. What happens to the tab afterwards is deliberately
   * the caller's call, because the two callers differ: a brand-new tab is removed, while a tab
   * being converted has to land back on something.
   */
  private async mountComposite(tab: OperationTab, spec: MaestroCompositeTabSpec): Promise<void> {
    this.compositeTabs.set(tab.id, spec)
    // Hoisted into a variable rather than passed inline, because every later lifecycle call
    // (`close` / `setActive` / `refresh`) must name THIS tab's host — see `compositeHosts`.
    const host: MaestroCompositeTabHostApi = {
      instanceId: tab.instanceId as string,
      window: () => this._state.browserWindow,
      contentRect: () => this._state.opBounds ?? this.firstFrameOperationRect(),
      attach: (container) => {
        tab.surface = container
        // Index 0 is the tab-view position, so the whole composite sits below Maestro's chrome and
        // control sidebar by construction — no re-assertion rule needed.
        this._state.browserWindow?.contentView.addChildView(container, 0)
      },
      detach: (container) => {
        if (tab.surface === container) tab.surface = null
        try {
          this._state.browserWindow?.contentView.removeChildView(container)
        } catch {
          // The parent window may already have released the child view.
        }
      },
      activate: () => void this.activateTab({ id: tab.id }),
      close: () => void this.closeTab({ id: tab.id }),
      setTitle: (title) => {
        tab.title = title || spec.title
        this.broadcastTabs()
      },
      setDisplayUrl: (url) => {
        const next = String(url || '')
        if (tab.compositeDisplayUrl === next) return
        tab.compositeDisplayUrl = next
        // 地址栏是 `sendNav` 推的,tab 条是 `broadcastTabs` 推的 —— 两处都显示这个串,所以都要推。
        // 只在这个 tab **是当前活动 tab** 时推地址栏:后台 tab 改了地址会把前台那一行覆盖掉。
        if (this.activeTabId === tab.id) this.sendTabNav(tab)
        this.broadcastTabs()
      },
      // 「这个 host 还拥有这个 tab 的内容吗」。两个条件缺一不可:tab 还在条上,**而且**这个 tab
      // 的 host 还是它自己 —— 换页面类型是就地改造,tab 不会离开条,但它的 mini-app 已经被注销了,
      // 而 `close(host)` 里好几个 mount 是按「宿主没了」来走拆卸的。注销先于 `close` 调用,
      // 所以拆卸期间这里必然是 false,和关 tab 那条路径看到的一致。
      isOpen: () => this.compositeHosts.get(tab.id) === host && this.tabs.includes(tab)
    }
    this.compositeHosts.set(tab.id, host)
    try {
      await spec.open(host)
    } catch (err) {
      this.compositeTabs.delete(tab.id)
      this.compositeHosts.delete(tab.id)
      throw err
    }
  }

  /**
   * The rect a tab's content occupies before the Home renderer has measured one.
   *
   * A web tab can afford to wait — it is loading anyway. A composite tab cannot: with no rect its
   * container gets no bounds, and a zero-size container hides its children, so the mini app would
   * open to nothing at all.
   */
  private firstFrameOperationRect(): ViewRect | null {
    const win = this._state.browserWindow
    if (!win) return null
    const [width, height] = win.getContentSize()
    return maestroFirstFrameOperationRect(width, height)
  }

  /**
   * Re-position every composite tab after the host reports new content bounds.
   *
   * Web tab views are moved by `setBounds` on the active view; a composite tab is moved by its own
   * mini app, and nothing else in this file knows how to reach it.
   */
  refreshCompositeTabs(): void {
    for (const [tabId, spec] of this.compositeTabs) {
      const host = this.compositeHosts.get(tabId)
      if (host) spec.refresh(host)
    }
  }

  private buildPinnedHomeView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroLocalHome.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    view.setBackgroundColor('#f4f6ff')
    this._state.browserWindow?.contentView.addChildView(view, 0)
    view.setVisible(false)
    this.attachViewListeners(view)
    return view
  }

  /** Hide a tab's content, whichever kind of content it has. */
  private hideTabContent(tab: OperationTab): void {
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      this.setCompositeActive(tab.id, false)
      return
    }
    if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.setVisible(false)
  }

  /** Tell one composite tab's mount whether it is the foreground content. No host = not ours. */
  private setCompositeActive(tabId: string, active: boolean): void {
    const spec = this.compositeTabs.get(tabId)
    const host = this.compositeHosts.get(tabId)
    if (spec && host) spec.setActive(host, active && !this.contentCovered)
  }

  setContentCovered(covered: boolean): void {
    this.contentCovered = covered
    for (const tabId of this.compositeTabs.keys()) {
      this.setCompositeActive(tabId, tabId === this.activeTabId)
    }
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

  /**
   * 「这是**默认**固有 tab 吗」 —— 也就是「这一格不是用户自己选进来的」。
   *
   * 与 `isPinnedHomeTab` **不再同义**:那一个护的是内置 Home 的几条安全不变量(导航禁闭、
   * 第一方 preload、登出落地),这一个回答的是**产品问题**「这个 tab 能不能改名」。bl 的默认主页
   * 现在是一个 mini app,所以判据是**设置里写没写过**,不是 `kind === 'home'`
   * (docs/features/onlypreview-default-homepage.md #2)。
   *
   * 内置本地 Home 单独留一条:登出那一发、以及默认 mini app 装不起来的降级,都会在设置里**有值**
   * 的情况下把它装进槽位 —— 它的名字来自 registry,那两种情况下同样不该能改。
   *
   * 为什么这一条必须跟上默认值的改动:`coachSettings.service` 的归一在 `homeCompositeId` 为空时
   * **会把 `homeAlias` 一起丢掉**。允许默认那一格改名 = 允许一个改完就丢的名字,而且不报错。
   */
  private isDefaultHomeTab(tab?: OperationTab): boolean {
    if (!tab?.pinned) return false
    return tab.kind === 'home' || !this.homeCompositeSetting()
  }

  private isPinnedHomeTab(tab?: OperationTab): boolean {
    return Boolean(tab?.pinned && tab.kind === 'home')
  }

  private openPinnedHomeDevTools(tab: OperationTab | undefined, view: WebContentsView | null): void {
    if (!shouldOpenPinnedHomeDevTools()) return
    if (!tab || !view || !this.isPinnedHomeTab(tab) || !this.isLiveTabView(tab, view)) return
    const wc = view.webContents
    if (wc.isDevToolsOpened()) return
    try {
      wc.openDevTools({ mode: 'detach', activate: false })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'Home devtools: ' + (err as Error).message, ts: Date.now() })
    }
  }

  private isAllowedPinnedHomeNavigation(tab: OperationTab, url: string): boolean {
    const withoutHash = (value: string): string => value.replace(/#.*$/, '')
    return withoutHash(url) === withoutHash(tab.url)
  }

  private preventPinnedHomeEscape(tab: OperationTab | undefined, url: string): boolean {
    if (!tab || !this.isPinnedHomeTab(tab)) return false
    if (this.isAllowedPinnedHomeNavigation(tab, url)) return false
    this._state.emitTrace({ kind: 'info', msg: `blocked bundled Home navigation · ${url}`, ts: Date.now() })
    return true
  }

  private isLiveTabView(tab: OperationTab, view: WebContentsView, epoch = this.lifecycleEpoch): boolean {
    return (
      this.lifecycleEpoch === epoch &&
      !tab.cooling &&
      this.tabs.includes(tab) &&
      tab.view === view &&
      !view.webContents.isDestroyed()
    )
  }

  async prewarmSpare(): Promise<void> {
    if (this.spareSlot || this.prewarming) return
    this.prewarming = true
    try {
      this.spareSlot = this.buildViewSlot()
    } finally {
      this.prewarming = false
    }
  }

  private async ensureWarm(tab: OperationTab): Promise<void> {
    if (tab.cooling) throw new Error('Tab is cooling down.')
    if (tab.view && !tab.view.webContents.isDestroyed()) return
    if (tab.kind === 'home') {
      const entry = localHomeEntry()
      tab.url = entry.url
      tab.view = this.buildPinnedHomeView()
      tab.capture = null
      tab.replay = null
      tab.attachReady = undefined
      tab.navigationStarted = false
      tab.debuggerEnabled = false
      tab.lastActive = Date.now()
      return
    }
    let slot = this.spareSlot
    if (slot && !slot.view.webContents.isDestroyed()) {
      this.spareSlot = null
    } else {
      this.spareSlot = null
      slot = this.buildViewSlot()
    }
    tab.view = slot.view
    tab.capture = slot.capture
    tab.replay = slot.replay
    tab.attachReady = slot.attachReady
    tab.documentReady = slot.documentReady
    tab.navigationStarted = false
    tab.navigationPending = undefined
    tab.navigationPreparationFailed = false
    if (!tab.debuggerEnabled) tab.capture.suspend()
    tab.lastActive = Date.now()
    this.schedulePrewarmSpare()
    await this.enforceWarmCap()
  }

  async warmAndLoad(tab: OperationTab): Promise<void> {
    await this.ensureWarm(tab)
    await this.startTabNavigation(tab)
  }

  private coolTab(tab: OperationTab): Promise<void> {
    if (tab.coolingReady) return tab.coolingReady
    const cooling = this.performCoolTab(tab)
    tab.coolingReady = cooling
    void cooling.then(
      () => {
        if (tab.coolingReady === cooling) tab.coolingReady = undefined
      },
      () => {
        if (tab.coolingReady === cooling) tab.coolingReady = undefined
      }
    )
    return cooling
  }

  private async performCoolTab(tab: OperationTab): Promise<void> {
    tab.cooling = true
    const view = tab.view
    const capture = tab.capture

    // The old view cannot promise a stop event after this point. Settle before detaching ownership.
    this.setTabLoading(tab, false)

    // Drop the old slot from the tab before touching it, so nothing can pick it back up.
    tab.view = null
    tab.capture = null
    tab.replay = null
    tab.attachReady = undefined
    tab.documentReady = undefined
    tab.navigationStarted = false
    tab.navigationPending = undefined
    tab.navigationRequest = (tab.navigationRequest ?? 0) + 1

    try {
      capture?.detach()
    } catch {
      // Already detached.
    }
    if (view) {
      try {
        this._state.browserWindow?.contentView.removeChildView(view)
      } catch {
        // The parent window may already have released the child view.
      }
      try {
        view.webContents.close()
      } catch {
        // Best effort.
      }
    }
    tab.cooling = false
  }

  private async enforceWarmCap(extraProtectedIds: string[] = []): Promise<void> {
    const warm = this.tabs.filter((tab) => tab.view && !tab.view.webContents.isDestroyed())
    if (warm.length <= this.MAX_WARM) return
    const protectedIds = new Set<string>([
      ...(this.activeTabId ? [this.activeTabId] : []),
      ...(this._state.captureTargetTabId ? [this._state.captureTargetTabId] : []),
      ...[...this.newTabsBySession.values()].flatMap((tabs) => tabs.map((tab) => tab.id)),
      ...(this._state.protectedBrowserTabIds?.() ?? []),
      ...extraProtectedIds
    ])
    const evictable = warm
      .filter((tab) => !tab.pinned && !tab.controlled && !protectedIds.has(tab.id))
      .sort((a, b) => a.lastActive - b.lastActive)
    let over = warm.length - this.MAX_WARM
    for (const tab of evictable) {
      if (over <= 0) break
      await this.coolTab(tab)
      over -= 1
    }
  }

  /**
   * Recreate the persisted strip. Runs exactly once, before any startup tab.
   *
   * A composite row is rebuilt through its registered spec with its STORED `instanceId`, which is
   * what puts a Zellij tab back on its own session. Sequential and individually guarded: a mini app
   * can legitimately refuse to open (Zellij rejects while the Terminal switch is off), and one
   * refusal must not take the rest of the strip with it.
   */
  async restoreTabs(params: { tabs: SavedTab[] }): Promise<void> {
    if (this.tabs.some((tab) => !tab.pinned)) return
    for (const tab of params.tabs) {
      if (tab.kind && getMaestroCompositeTab(tab.kind)) {
        try {
          const restored = await this.openCompositeTab({ id: tab.kind, instanceId: tab.instanceId, activate: false })
          // alias 必须在 `openCompositeTab` **之后**补写:那条路径按 spec 盖 `title`/`favicon`,
          // 存下来的那一行除了 id 之外一个字段都不看。少这一步,composite tab 的别名跨不过重启
          // ——而三个 Zellij tab 全叫 "Zellij" 正是最需要起名的场景(tab-alias.md PQ-3)。
          if (restored && tab.alias) restored.alias = tab.alias
        } catch (err) {
          this._state.emitTrace({
            kind: 'error',
            msg: `restore composite tab ${tab.kind}: ` + (err as Error).message,
            ts: Date.now()
          })
        }
        continue
      }
      if (tab.url) this.addTab({ url: tab.url, title: tab.title, favicon: tab.favicon, alias: tab.alias })
    }
    this.broadcastTabs()
  }

  private attachViewListeners(view: WebContentsView): void {
    const wc = view.webContents
    const preparing = (): boolean => this.initializingViews.has(view)
    const blankDocument = (): boolean => preparing() || wc.getURL() === 'about:blank'
    bindBrowserHistoryRecorder(wc, {
      history: browserHistory,
      isBrowser: () => this.ownerOf(view)?.kind === 'browser',
      dismiss: () => { if (this.ownerOf(view)?.id === this.activeTabId) this._state.dismissBrowserHistory?.(); },
    });
    wc.on('will-navigate', (event) => {
      if (this.preventPinnedHomeEscape(this.ownerOf(view), event.url)) event.preventDefault()
    })
    wc.on('will-redirect', (event) => {
      const tab = this.ownerOf(view)
      if (event.isMainFrame && this.preventPinnedHomeEscape(tab, event.url)) event.preventDefault()
    })
    wc.on('did-navigate', (_event, url) => {
      const tab = this.ownerOf(view)
      if (!tab || url === 'about:blank') return
      if (tab.kind !== 'home') tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendTabNav(tab, true)
      this.broadcastTabs()
    })
    wc.on('did-navigate-in-page', (event, url) => {
      const tab = this.ownerOf(view)
      if (!tab || !event.isMainFrame || url === 'about:blank' || preparing()) return
      if (tab.kind !== 'home') tab.url = url
      if (this.activeTabId === tab.id || this._state.captureTargetTabId === tab.id) this.sendTabNav(tab, false)
      this.broadcastTabs()
    })
    wc.on('page-title-updated', (_event, title) => {
      const tab = this.ownerOf(view)
      if (!tab || blankDocument()) return
      if (tab.kind === 'browser') {
        tab.title = title
        if (this.activeTabId === tab.id) this.sendTitle(title)
      }
      this.broadcastTabs()
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      const tab = this.ownerOf(view)
      if (!tab || tab.kind !== 'browser' || blankDocument()) return
      if (Array.isArray(favicons) && favicons[0]) {
        tab.favicon = favicons[0]
        this.broadcastTabs()
      }
    })
    wc.on('did-start-loading', () => {
      if (blankDocument()) return
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, true)
    })
    wc.on('did-stop-loading', () => {
      if (blankDocument()) return
      const tab = this.ownerOf(view)
      if (tab) this.setTabLoading(tab, false)
    })
    wc.on('did-start-navigation', (event) => {
      if (!event.isMainFrame || event.isSameDocument || event.url === 'about:blank' || preparing()) return
      const tab = this.ownerOf(view)
      if (tab) { tab.navigationStarted = true; tab.browserError = undefined; this.broadcastTabs() }
    })
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || _validatedUrl === 'about:blank' || preparing()) return
      const tab = this.ownerOf(view)
      if (tab && errorCode !== -3) tab.browserError = { status: 'load-failed', error: `${errorDescription} (${errorCode})` }
      if (tab) this.setTabLoading(tab, false)
      this.broadcastTabs()
    })
    wc.on('render-process-gone', (_event, details) => {
      const tab = this.ownerOf(view)
      if (tab) this.clearTabControl(tab)
      if (tab) tab.browserError = { status: 'crashed', error: `Renderer ${details.reason} (exit ${details.exitCode}).` }
      if (tab) this.setTabLoading(tab, false)
      this.broadcastTabs()
    })
    wc.once('destroyed', () => {
      const tab = this.ownerOf(view)
      if (tab) this.clearTabControl(tab)
      if (tab) tab.browserError = { status: 'destroyed', error: 'The tab WebContents was destroyed.' }
      this.broadcastTabs()
    })
    wc.on('did-finish-load', () => {
      if (blankDocument()) return
      const tab = this.ownerOf(view)
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, view)
      if (tab?.kind === 'browser') void this.injectStoredButtonForTab(tab)
    })
    wc.setWindowOpenHandler((details) => {
      if (this.handleInjectedButtonOpen(details.url)) return { action: 'deny' }
      if (/^https?:\/\//i.test(details.url)) {
        const url = details.url
        const source = this.ownerOf(view)
        const owner = source && this._state.browserPopupOwner?.(source.id)
        queueMicrotask(() => void this.openTabWithUrl(url, owner, source?.id).catch((error) => {
          this._state.emitTrace({ kind: 'error', msg: `popup: ${String(error)}`, ts: Date.now() })
        }))
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

  /**
   * `TabKind` → D3 三态。**用 `Record` 而不是 `switch`** —— `tsconfig.node.json` 是
   * `"strict": false` + `"noImplicitReturns": false`,漏一个 switch 分支**不报错**,会静默
   * 落进"非 browser"那一侧。而对象字面量缺键是赋值错误,与 strict 无关,**能真的拦住下一个新 kind**。
   * (`displayUrl()` 今天漏掉 trench/zellij 就是这个机制造成的。)
   */
  private static readonly CONTENT_STATE: Record<TabKind, 'file' | 'miniapp' | 'web'> = {
    browser: 'web',
    onlypreview: 'file',
    home: 'miniapp',
    trench: 'miniapp',
    zellij: 'miniapp'
  }

  /**
   * **D3 的取数 —— 全同步,零新 XPC。**
   *
   * 三态所需的字段都已经在活动 `OperationTab` 上:`compositeDisplayUrl`(文件)、
   * composite spec 的 `title`(miniapp)、`url` + `title`(网页)。
   *
   * **刻意不去问 OnlyPreview 子系统。** maestro 曾经直接 import `@shared/onlypreview/*` 与
   * `@main/miniapps/onlypreview/*`,那把宿主整棵 onlypreview 子树(连 fileSearch / menu)拖进了
   * maestro 的测试打包 —— 那次失败与修法记在 `shared/maestro/previewOpener.api.ts:43-51`。
   *
   * 文件态取不到真值时**降级成 miniapp 态**,而不是报一个假路径:`compositeDisplayUrl` 靠
   * `notifyOnlyPreviewDisplayUrl` 推送,那条路**刻意吞异常**(地址栏被当装饰性的),所以它可以
   * 静默停在上一个文件。宁可少说,不可说错。
   */
  describeActiveContent(): ActiveTabContent | null {
    const tab = this.getActiveTab()
    if (!tab) return null
    const app = this.compositeTabs.get(tab.id)?.title ?? tab.title
    switch (MaestroBrowserViewService.CONTENT_STATE[tab.kind]) {
      case 'web':
        return { state: 'web', url: tab.url, title: tab.title }
      case 'file': {
        const fileUrl = tab.compositeDisplayUrl ?? ''
        return fileUrl && fileUrl !== MAESTRO_ONLY_PREVIEW_DISPLAY_URL
          ? { state: 'file', fileUrl, app }
          : { state: 'miniapp', app }
      }
      default:
        return { state: 'miniapp', app }
    }
  }

  private displayUrl(tab: OperationTab): string {
    if (tab.kind === 'home') return MAESTRO_LOCAL_HOME_DISPLAY_URL
    if (tab.kind === 'onlypreview') {
      // live 值优先,注册时那个静态串是**兜底** —— 没有项目、没有选中文件时仍然显示
      // `bitterless://only-preview`。次序反过来会让 live 值永远到不了地址栏(Ral 2026-09-10)。
      return tab.compositeDisplayUrl || (this.compositeTabs.get(tab.id)?.displayUrl ?? '')
    }
    return tab.url
  }

  private sendTabNav(tab: OperationTab, resetTitle = false): void {
    this.sendNav(this.displayUrl(tab), resetTitle)
  }

  private sendTitle(title: string): void {
    xpcMain.broadcast('coach/title', String(title || ''))
  }

  private broadcastNavState(): void {
    const active = this.getActiveTab()
    const wc = this._state.operationView?.webContents
    const live = wc && !wc.isDestroyed() ? wc : null
    const historyLocked = active?.kind !== 'browser'
    xpcMain.broadcast('coach/nav-state', {
      canGoBack: !historyLocked && live ? live.navigationHistory.canGoBack() : false,
      canGoForward: !historyLocked && live ? live.navigationHistory.canGoForward() : false
    })
  }

  /**
   * The + button's hover menu: a blank tab, or one of the registered composite mini apps.
   *
   * Built and popped in MAIN, like the tab context menu beside it — the operation view is a native
   * view composited OVER the renderer's DOM, so an in-renderer dropdown taller than a line would be
   * painted behind the page. The mini-app rows come from the registry rather than a written list,
   * because "which mini apps can a tab hold" is one fact and a second copy of it goes stale.
   */
  async showNewTabMenu(params: { x: number; y: number }): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return
    const composites = listMaestroCompositeTabs()
    const menu = Menu.buildFromTemplate([
      // Same first row as the tab context menu — one action should look the same in both menus.
      { label: 'New tab', click: () => void this._state.newTab() },
      ...(composites.length
        ? ([
            { type: 'separator' },
            ...composites.map((spec) => ({
              label: spec.title,
              click: () => void this.openCompositeTabFromMenu(spec.id)
            }))
          ] as MenuItemConstructorOptions[])
        : [])
    ])
    menu.popup({ window: win, x: Math.round(params.x), y: Math.round(params.y) })
  }

  /**
   * Pick a mini-app row: send the Workbench back first, then open the tab.
   *
   * The order matters and the failure is invisible otherwise — the Workbench is a foreground view,
   * not an `OperationTab`, so a freshly activated tab would open underneath it and read as "nothing
   * happened". `newTab()` on the row above already does exactly this.
   */
  private async openCompositeTabFromMenu(id: string): Promise<void> {
    try {
      await this._state.backgroundWorkbenchTab()
      await this.openCompositeTab({ id })
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: `new-tab menu ${id}: ` + (err as Error).message, ts: Date.now() })
    }
  }

  /**
   * 地址栏左侧 `menubar__pagetype__button` 的原生菜单:把**当前这个 tab** 换成另一种内容。
   *
   * 和它旁边的 `+` hover 菜单、tab 右键菜单同一个理由弹在 main 里:操作区是一个原生 view,绘制在
   * Home 渲染进程的 DOM **之上**,超过一行的下拉必被它盖住。坐标(DIP)由 renderer 测按钮 rect
   * 传进来 —— 只有 renderer 知道那个 rect。
   *
   * mini-app 行来自 registry 而不是一张写死的表:「一个 tab 能装哪些 mini-app」是一条事实,
   * 抄第二份就会过期。见 docs/features/maestro-page-type-switcher.md。
   */
  async showPageTypeMenu(params: { tabId: string; x: number; y: number }): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return
    const tab = this.tabs.find((item) => item.id === params.tabId)
    if (!tab) return
    // 固定 Home tab 不可切 —— 整个菜单置灰而不是隐藏,这样「为什么不能点」是看得见的。
    const enabled = !tab.pinned
    const menu = Menu.buildFromTemplate([
      {
        label: 'Website',
        type: 'radio',
        checked: tab.kind === 'browser',
        enabled,
        // click 不回调 renderer:改完 main 侧状态后 `broadcastTabs()` 让每个渲染进程从快照重渲染。
        // 这是仓内既有约定(`showTabMenu` 同形)。
        click: () => void this.setTabKind({ id: tab.id, kind: 'browser' })
      },
      ...listMaestroCompositeTabs().map((spec) => ({
        label: spec.title,
        type: 'radio' as const,
        checked: tab.kind === spec.id,
        enabled,
        click: () => void this.setTabKind({ id: tab.id, kind: spec.id as TabKind })
      }))
    ])
    menu.popup({ window: win, x: Math.round(params.x), y: Math.round(params.y) })
  }

  /**
   * 就地把一个 tab 换成另一种内容。**同一个 tab**:不新开、不关旧的,tab 条长度不变。
   *
   * 四道前置拒绝:tab 不存在(菜单是异步弹的,快照可能已过期)、`pinned`、未注册的 composite id
   * (fail-closed,不静默回落)、类型没变(否则重复点同一项会白拆一次内容)。
   *
   * **从 composite 切走必须走它自己的 `close(host)`**,而不是只 detach 容器:那个回调才是 mini app
   * 的拆卸入口,Zellij 的会话关闭就挂在上面(`zellijWindow.service.ts` → `closeZellijTerminal`,
   * 无条件强关,pane 里有进程在跑也照关)。只 detach 会留下一条没有任何 tab 连着的孤儿会话。
   *
   * 反过来,**通用拆卸不许挂关闭意图**:退出 app / 窗口重置那条路径不走 `close(host)`,`restorable`
   * 的会话要留到下次启动恢复。所以关闭只写在这条显式切换上。
   *
   * 换到 composite 时 `instanceId` **重铸**:它是「这条会话是谁的」的键,切走已经把会话关了,沿用
   * 旧 id 等于让新内容去认领一条刚被杀掉的会话(zellij-multi-tab.md 的「新开即新会话」)。
   */
  async setTabKind(params: { id: string; kind: TabKind; spec?: MaestroCompositeTabSpec }): Promise<void> {
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    if (tab.pinned) {
      this._state.emitTrace({ kind: 'info', msg: 'setTabKind refused: the pinned tab is fixed', ts: Date.now() })
      return
    }
    const nextKind = params.kind
    const spec = nextKind === 'browser' ? null : params.spec ?? getMaestroCompositeTab(nextKind)
    if (nextKind !== 'browser' && !spec) {
      this._state.emitTrace({ kind: 'error', msg: `setTabKind refused: no composite mini app '${nextKind}'`, ts: Date.now() })
      return
    }
    if (tab.kind === nextKind) return
    // 单例 mini-app:已经有一个了就聚焦它,不把第二个 tab 也切过去。
    if (spec?.singleton) {
      const existing = this.tabs.find((item) => item.id !== tab.id && item.kind === spec.id)
      if (existing) {
        this._state.emitTrace({ kind: 'info', msg: `setTabKind: ${spec.id} 是单例,聚焦已有的那个`, ts: Date.now() })
        await this.activateTab({ id: existing.id })
        return
      }
    }

    const wasActive = this.activeTabId === tab.id
    this.clearTabControl(tab)
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      this.compositeTabs.delete(tab.id)
      const host = this.compositeHosts.get(tab.id)
      this.compositeHosts.delete(tab.id)
      if (host) composite.close(host)
      tab.instanceId = undefined
      tab.compositeDisplayUrl = undefined
    } else {
      this.setTabLoading(tab, false)
      // 录制目标跟着这个 tab 的 view 走,view 马上要没了 —— 和 `performCloseTab` 同一条理由。
      if (this._state.capturing && this._state.captureTargetTabId === tab.id && !this._state.isDrillBranchTab?.(tab.id)) {
        await this._state.stopCapture()
      }
      // 切回 Website 时要回到这个网页,所以在覆盖 `tab.url` 之前把它收好。
      tab.websiteUrl = tab.url
      await this.coolTab(tab)
    }
    if (wasActive) {
      // 内容已经拆掉了,`activateTab` 要走完整的切换路径(它按 `activeTabId` 找「上一个」)。
      this.activeTabId = null
      this.setOperationView(null)
      this._state.capture = null
      this._state.replayEngine = null
    }

    // 落回网页 tab —— 既是「切到 Website」这一支,也是 mount 失败时的兜底:内容已经拆了,
    // 这个 tab 必须落在某种东西上。
    // **`tab.alias` 在这里一动不动。** 名字是**这个 tab 的**,不是它当前内容的,所以换页面类型
    // 要保留(tab-alias.md PQ-4)。这一支把 `title` 清空,alias 若寄生在 `title` 上就会跟着没。
    const becomeWebTab = (): void => {
      tab.kind = 'browser'
      tab.url = tab.websiteUrl || ''
      tab.title = ''
      tab.favicon = ''
      tab.debuggerEnabled = true
    }
    if (spec) {
      tab.kind = spec.id as TabKind
      tab.instanceId = mintTabInstanceId()
      tab.url = ''
      tab.title = spec.title
      tab.favicon = spec.favicon
      tab.debuggerEnabled = false
      try {
        await this.mountComposite(tab, spec)
        this.setCompositeActive(tab.id, tab.id === this.activeTabId)
      } catch (err) {
        this._state.emitTrace({ kind: 'error', msg: `setTabKind ${spec.id}: ` + (err as Error).message, ts: Date.now() })
        becomeWebTab()
      }
    } else {
      becomeWebTab()
    }

    if (wasActive) await this.activateTab({ id: tab.id })
    else this.broadcastTabs()
  }

  async showTabMenu(params: { id: string }): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return
    const index = this.tabs.findIndex((tab) => tab.id === params.id)
    if (index < 0) return
    const tab = this.tabs[index]
    const canClose = !tab.pinned && this.tabs.length > 1
    const canDuplicate = tab.kind === 'browser' && !tab.pinned && Boolean(tab.url)
    const otherClosable = this.tabs.some((item) => item.id !== tab.id && !item.pinned)
    const rightClosable = this.tabs.slice(index + 1).some((item) => !item.pinned)
    // 判据是「不是**默认**固有 tab」,不是 `!tab.pinned` —— 自定义主页是用户自己选进来的,
    // 理应能起名(Ral 2026-09-14)。默认固有 tab 的名字来自 registry,页面从来没给过它标题,
    // 所以「改页面的名字」在它身上没有意义 ⇒ **置灰而不是隐藏**,「为什么不能点」要看得见。
    const canAlias = !this.isDefaultHomeTab(tab)
    // 只有 mini-app 能当主页:每一条按 `kind` 写的保护(地址栏锁死、不当录制继承者、第一方
    // preload、登出落地)在一个远端网页上都会变成 bug,其中两条是安全级的
    // (docs/features/custom-homepage-tab.md #1)。
    const canSetHome = !tab.pinned && Boolean(getMaestroCompositeTab(tab.kind))
    // 判据是「设置里确实写着一个自定义值」,**不是** `resolveHomeCompositeId()` 非空 —— 后者现在
    // 会替没设过的机器答出 registry 的默认值,于是这一项永远亮着,点下去什么都不变
    // (docs/features/onlypreview-default-homepage.md #2)。
    const canRestoreHome = tab.pinned && Boolean(this.homeCompositeSetting())
    const menu = Menu.buildFromTemplate([
      { label: 'New tab', click: () => void this._state.newTab() },
      { type: 'separator' },
      {
        label: 'Reload',
        click: () => {
          if (tab.view && !tab.view.webContents.isDestroyed()) {
            tab.view.webContents.reload()
          } else {
            void this.warmAndLoad(tab)
          }
        }
      },
      { label: 'Duplicate', enabled: canDuplicate, click: () => void this.openTabWithUrl(tab.url) },
      { type: 'separator' },
      { label: 'Alias…', enabled: canAlias, click: () => void this.promptTabAlias(tab.id) },
      { label: 'Set as homepage', enabled: canSetHome, click: () => void this.setAsHomepage(tab.id) },
      {
        label: 'Restore default homepage',
        enabled: canRestoreHome,
        click: () => void this.restoreDefaultHomepage()
      },
      { type: 'separator' },
      { label: 'Close', enabled: canClose, click: () => void this.closeTab({ id: tab.id }) },
      { label: 'Close other tabs', enabled: otherClosable, click: () => void this.closeTabsExcept(tab.id) },
      { label: 'Close tabs to the right', enabled: rightClosable, click: () => void this.closeTabsToRight(tab.id) }
    ])
    menu.popup({ window: win })
  }

  /**
   * 弹别名表单,把结果写回 tab。
   *
   * 表单是异步的,回来时这个 tab 可能已经被关掉 / 被换了类型 —— 所以按 id **重新找一次**,
   * 而不是闭包捕获那个对象。
   *
   * `null` = 取消,一个字都不改;空串 = **删除**别名,回到页面标题(G4)。
   */
  private async promptTabAlias(tabId: string): Promise<void> {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab || this.isDefaultHomeTab(tab)) return
    const request = this._state.requestTabAlias
    if (!request) return
    const answer = await request({ tabLabel: tab.alias || tab.title || this.displayUrl(tab), alias: tab.alias || '' }).catch(
      (err) => {
        this._state.emitTrace({ kind: 'error', msg: 'tab alias: ' + (err as Error).message, ts: Date.now() })
        return null
      }
    )
    if (answer === null) return
    const current = this.tabs.find((item) => item.id === tabId)
    if (!current) return
    const next = answer.trim()
    // 全空白与空串同义:「清空并保存」是删除,不是「别名是几个空格」。
    current.alias = next || undefined
    // 固有槽位那个 tab 是 pinned 的,不进 SavedTab —— 它的名字只有设置这一个落脚点。晋升那一刻
    // 落过一次还不够:设为主页**之后**再改名走的是这里,不补写就重启即失(tab-alias.md G5)。
    // 默认固有 Home 走不到这儿(`isDefaultHomeTab` 已经在方法开头挡掉了)。
    if (current.pinned) this._state.saveMaestroSettings?.({ homeAlias: current.alias || '' })
    this.broadcastTabs()
  }

  /**
   * 把一个 composite mini-app tab 就地换进固有槽位。
   *
   * 换槽位这一段是**一个同步块**:`MenuBar.vue` 在没有任何 tab 报 `pinned` 时回落到 index 0,
   * 注释写着「不该发生」—— 所以中间态一次都不许被广播出去(custom-homepage-tab.md #3.2)。
   * 先给新的置 `pinned`,再摘旧的,最后才 `broadcastTabs()`。
   *
   * 旧的默认 Home tab 直接**关掉**:它是内置的、无状态的、随时能重建的本地页;而反向操作
   * (`restoreDefaultHomepage`)不关那个 mini-app —— 它身上有用户的状态(一条 Zellij 会话),
   * 不该因为换主页被杀。带状态的留着,不带状态的回收。
   */
  private async setAsHomepage(tabId: string): Promise<void> {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab || tab.pinned) return
    const spec = getMaestroCompositeTab(tab.kind)
    if (!spec) {
      this._state.emitTrace({ kind: 'info', msg: 'set as homepage refused: only a mini app can be the homepage', ts: Date.now() })
      return
    }
    const previous = this.tabs.find((item) => item.pinned)
    tab.pinned = true
    const index = this.tabs.indexOf(tab)
    if (index > 0) {
      this.tabs.splice(index, 1)
      this.tabs.unshift(tab)
    }
    if (previous && previous !== tab) previous.pinned = false
    // 三格一起落。`homeInstanceId` 记的是**这个 tab 此刻真实的** `instanceId`,不是按 spec id
    // 推导的那个:下次启动固有槽位要接回的正是现在装在里面的那条会话 —— 换成推导值,这条会话
    // 既不会被接管也不会被关掉,一次晋升留一条孤儿。`homeAlias` 同理:tab 一旦 pinned 就不再进
    // SavedTab,设置是它的名字唯一的落脚点(tab-alias.md G5)。
    this._state.saveMaestroSettings?.({
      homeCompositeId: spec.id,
      homeInstanceId: tab.instanceId || '',
      homeAlias: tab.alias || ''
    })
    await this.activateTab({ id: tab.id })
    if (previous && previous !== tab && previous.kind === 'home') await this.closeTab({ id: previous.id })
    else this.broadcastTabs()
  }

  /**
   * 固有槽位换回**默认主页** —— bl 是 registry 里声明 `defaultHome` 的那个 mini app(OnlyPreview),
   * 没有任何 spec 声明时才是内置本地 Home。
   *
   * 「还原」不能写死成内置 Home:默认值换掉之后那等于「这一发回 Home、下次启动又变回 OnlyPreview」
   * ——同一个动作两种说法(docs/features/onlypreview-default-homepage.md #3)。
   *
   * 每一支都先建/先置 `pinned`、再摘旧的:`MenuBar.vue` 在没有任何 tab 报 `pinned` 时会回落到
   * index 0(注释写着「不该发生」),零 pinned 的中间态一次都不许被广播出去。
   */
  private async restoreDefaultHomepage(): Promise<void> {
    const custom = this.tabs.find((item) => item.pinned)
    if (!custom) return
    // 三格一起清:留着 `homeInstanceId` / `homeAlias`,下一次设主页会捡到上一任的会话和名字。
    // 清在最前面,后面那句 `resolveHomeCompositeId()` 才答得出「默认是谁」而不是刚被还原掉的那个。
    this._state.saveMaestroSettings?.({ homeCompositeId: '', homeInstanceId: '', homeAlias: '' })
    const defaultId = this.resolveHomeCompositeId()
    // 槽位已经是内置 Home 而设置还留着自定义值 —— 登出那一发就是这个状态(它无视设置装回 Home)。
    // 这时「还原」要清掉设置,否则这一项亮着却什么都不做,而下次启动又变回自定义主页。这一发留在
    // Home,下次启动装默认值。
    if (custom.kind === 'home' || custom.kind === defaultId) {
      this.broadcastTabs()
      return
    }
    if (defaultId) {
      // 默认那个 mini app 已经作为普通 tab 开着 —— **晋升它**,不再开第二个。OnlyPreview 是
      // `singleton`,第二份拿不到内容(mini app 那一侧只认一个活着的承载),条上会多一格空白。
      const existing = this.tabs.find((item) => item.id !== custom.id && item.kind === defaultId)
      if (existing) {
        existing.pinned = true
        const index = this.tabs.indexOf(existing)
        if (index > 0) {
          this.tabs.splice(index, 1)
          this.tabs.unshift(existing)
        }
        custom.pinned = false
        await this.activateTab({ id: existing.id })
        return
      }
      const restored = this.buildPinnedCompositeTab(defaultId)
      this.tabs.unshift(restored)
      custom.pinned = false
      // 复用启动那条路:它按固有 tab 的 kind 分流,装不起来还会就地降级成内置本地 Home。
      await this.loadPinnedHomeTab()
      await this.activateTab({ id: restored.id })
      return
    }
    // registry 没有声明默认 mini app(cowork 那一份、或者降级/改名)—— 落回内置本地 Home。
    const home = this.buildPinnedLocalHomeTab()
    this.tabs.unshift(home)
    custom.pinned = false
    // 复用启动那条路:它按固有 tab 的 kind 分流,这里已经是内置 Home 了。
    await this.loadPinnedHomeTab()
    await this.activateTab({ id: home.id })
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
    const owner = this.ownerOfWebContents(wc)
    const historyLocked = owner?.kind !== 'browser'
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
    if (is.dev && owner?.kind === 'browser') {
      sections.push([{ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }])
    }
    const template: MenuItemConstructorOptions[] = []
    for (const section of sections) {
      if (template.length) template.push({ type: 'separator' })
      template.push(...section)
    }
    Menu.buildFromTemplate(template).popup({ window: win })
  }

  private async claimSpareTab(meta: { url?: string; title?: string; favicon?: string; externalNavigation?: boolean }): Promise<OperationTab> {
    let slot = this.spareSlot
    this.spareSlot = null
    if (!slot || slot.view.webContents.isDestroyed()) {
      slot = this.buildViewSlot()
    }
    const tab: OperationTab = {
      id: `tab-${++this.tabSeq}`,
      kind: 'browser',
      view: slot.view,
      capture: slot.capture,
      replay: slot.replay,
      attachReady: slot.attachReady,
      documentReady: slot.documentReady,
      navigationStarted: false,
      externalNavigation: meta.externalNavigation,
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      debuggerEnabled: true,
      pinned: false,
      lastActive: Date.now(),
      loading: false,
      loadWatchdog: null
    }
    this.tabs.push(tab)
    this.schedulePrewarmSpare()
    await this.enforceWarmCap([tab.id])
    return tab
  }

  private readonly newTabsBySession = new Map<string, TabInfo[]>()

  private async openTabWithUrl(url: string, agentSessionId?: string, sourceTabId?: string): Promise<OperationTab> {
    const generation = agentSessionId ? this._state.browserUseGeneration?.(agentSessionId) : undefined
    const tab = await this.claimSpareTab({ url })
    const owner = agentSessionId && (this._state.browserPopupStillOwned?.(agentSessionId, sourceTabId, generation) ?? true) ? agentSessionId : undefined
    if (owner && !this.newTabsBySession.has(owner)) this.newTabsBySession.set(owner, [])
    if (owner) this.newTabsBySession.get(owner)!.push({
      id: tab.id,
      kind: tab.kind,
      url,
      title: '',
      active: true,
      pinned: false,
      favicon: '',
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: Boolean(tab.capture?.isAttached()),
      controlled: Boolean(tab.controlled),
      loading: tab.loading
    })
    if (owner) this._state.browserPopupActivity?.(owner, tab.id, true, generation)
    try {
      if (owner) await this._state.browserPopupOpened?.(owner, tab.id, sourceTabId)
      this._state.broadcastActivity('tab', `opened tab · ${hostnameOf(url) || url}`)
      if (agentSessionId) {
        if (tab.view) this.applyBounds(tab.view, this._state.opBounds || { x: 0, y: 0, width: 1280, height: 800 })
      } else await this.activateTab({ id: tab.id, deferNavigation: true })
      const wc = tab.view?.webContents
      if (wc && !wc.isDestroyed()) {
        await this.startTabNavigation(tab, { url }).catch((err) => {
          if (!wc.isDestroyed()) {
            this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (err as Error).message, ts: Date.now() })
          }
        })
      }
    } finally {
      if (owner) this._state.browserPopupActivity?.(owner, tab.id, false)
    }
    return tab
  }

  async newTab(): Promise<void> {
    if (this.creatingTab) return
    this.creatingTab = true
    try {
      const tab = await this.claimSpareTab({})
      await this.activateTab({ id: tab.id })
      // 必须排在 activateTab 之后:抢焦点的不是某个 view 主动 focus,而是 activateTab 里
      // `previous.view.setVisible(false)` 把焦点丢掉 —— 先聚焦就会被那一行抹掉。空白 tab 的
      // 没有目标 URL,所以 activateTab 返回之后不再有导航把焦点带走(契约 #3.3)。
      focusAddressBarForBlankTab(this._state.browserWindow)
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: 'new tab: ' + (err as Error).message, ts: Date.now() })
    } finally {
      this.creatingTab = false
    }
  }

  async closeActiveTab(): Promise<void> {
    if (this.activeTabId) await this.closeTab({ id: this.activeTabId })
  }

  async openFilePreviewTab(params: { path: string; tabId?: string }): Promise<void> {
    const opener = getMaestroPreviewOpener()
    if (!opener?.createFileTabSpec) throw new Error('File preview tabs are unavailable.')
    await this._state.backgroundWorkbenchTab()
    const spec = opener.createFileTabSpec(params.path)
    if (params.tabId) {
      const tab = this.tabs.find((candidate) => candidate.id === params.tabId)
      if (!tab || tab.pinned || tab.kind !== 'browser') {
        throw new Error('The initiating browser tab is no longer available.')
      }
      await this.setTabKind({ id: tab.id, kind: spec.id as TabKind, spec })
      if (this.compositeTabs.get(tab.id) !== spec) throw new Error('The file preview could not open.')
      return
    }
    await this.openCompositeTab({ id: spec.id, spec })
  }

  async openTab(params: { url: string }): Promise<void> {
    const url = (params.url || '').trim()
    if (!url) {
      await this.newTab()
      return
    }
    if (isWorkbenchInternalUrl(url)) {
      await this._state.openWorkbenchTab()
      return
    }
    const tab = await this.claimSpareTab({ url })
    await this.activateTab({ id: tab.id, deferNavigation: true })
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      await this.startTabNavigation(tab, { url }).catch((err) => {
        if (!wc.isDestroyed()) {
          this._state.emitTrace({ kind: 'error', msg: 'open tab: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }
  }

  drainNewTabsNote(sessionId?: string): string {
    if (!sessionId) return ''
    const opened = this.newTabsBySession.get(sessionId)?.splice(0) ?? []
    if (!opened.length) return ''
    const lines = opened.map((tab) => `  - tab_id=${tab.id} url=${tab.url}`)
    return (
      `\n\nNOTE: ${opened.length} new browser tab(s) opened during this action — likely a ` +
      `result/confirmation page:\n${lines.join('\n')}\n` +
      `Inspect one with page_snapshot {"tab_id":"<tab_id>"} (does NOT change the active tab), ` +
      `or activate_tab to switch to it.`
    )
  }

  clearNewTabsNote(sessionId: string): void { this.newTabsBySession.delete(sessionId) }

  /**
   * 标记 / 取消标记「agent 正在驱动这个 tab」。
   *
   * **只改状态并广播,不碰页面** —— 它是一个展示事实,不是一道闸:被标记的 tab 照样可以被人
   * 点击、切换、关闭。把它做成闸会让"agent 忙着"变成"用户被锁住",而那是两件事。
   *
   * 计数而非布尔:同一个 tab 上可能同时有两件事在驱动它(deep_fetch 渲染 + 一次快照),
   * 先结束的那一件不该把动画关掉。
   */
  setTabControlled(id: string, on: boolean): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const next = Math.max(0, (this.controlDepth.get(id) ?? 0) + (on ? 1 : -1))
    if (next === 0) this.controlDepth.delete(id)
    else this.controlDepth.set(id, next)
    const controlled = next > 0 || this.activeBrowserUseTabs.has(id)
    if (Boolean(tab.controlled) === controlled) return
    tab.controlled = controlled
    this.broadcastTabs()
  }

  /** 每个 tab 上还有几件事在驱动它。见 setTabControlled 的计数说明。 */
  private readonly controlDepth = new Map<string, number>()
  private activeBrowserUseTabs = new Set<string>()

  setActiveBrowserUseTabs(ids: string[]): void {
    this.activeBrowserUseTabs = new Set(ids)
    let changed = false
    for (const tab of this.tabs) {
      const controlled = this.activeBrowserUseTabs.has(tab.id) || (this.controlDepth.get(tab.id) ?? 0) > 0
      if (Boolean(tab.controlled) !== controlled) { tab.controlled = controlled; changed = true }
    }
    if (changed) this.broadcastTabs()
  }

  private clearTabControl(tab: OperationTab): void {
    this.controlDepth.delete(tab.id)
    this.activeBrowserUseTabs.delete(tab.id)
    tab.controlled = false
  }

  /**
   * `deep_fetch` 的载体:开一个**空白**受控 tab,把它的 webContents 交出去。
   *
   * **空白是硬要求,不是省事** —— 导航由 `deep_fetch` 自己做:它的三道闸(重定向白名单、
   * `window.open` 拒绝、下载拒绝)都必须装在 `loadURL` 之前,由这里顺手导航会让第一跳
   * 绕过全部闸门(见 `deepFetch.ts` 的 `DeepFetchSurface`)。
   *
   * 用真实 tab 而不是隐藏窗口,换来的正是这条路存在的理由:**与浏览器共用 session** ——
   * 内置浏览器登录过的站点,agent 直接读得到。
   *
   * `done()` 可能被调用两次(正常收尾一次、超时那条路再一次),所以它是幂等的。
   */
  async openControlledBlankTab(url: string): Promise<{ tabId: string; wc: WebContents; done: () => Promise<void> }> {
    // The visible URL is only a label. This caller installs guards before navigating itself.
    const tab = await this.claimSpareTab({ url, externalNavigation: true })
    this.setTabControlled(tab.id, true)
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) throw new Error('could not open a browser tab to render the page')
    try {
      await tab.documentReady
      await tab.capture?.prepareNavigation()
      if (!tab.view || !this.isLiveTabView(tab, tab.view) || tab.closeReady) throw new Error('The controlled browser tab was closed.')
    } catch (error) {
      this.setTabControlled(tab.id, false)
      await this.closeTab({ id: tab.id }).catch(() => {})
      throw error
    }
    /**
     * **不 activate**。它在 tab 条上看得见(chip 带受控动画),但不抢走当前 tab:
     * 一次取页几秒钟,把人从正在看的页面上拽走再拽回来比看不见更糟,而受控动画存在的意义
     * 正是"不用切过去也知道它在被驱动"。
     *
     * 代价是必须**手动给它一个视口**:新建的 view 建完就隐藏且从未摆过位置,零尺寸视口会让
     * 响应式页面按 0×0 布局(列表干脆不渲染)。摆位不等于显示。
     */
    if (tab.view) this.applyBounds(tab.view, this._state.opBounds || { x: 0, y: 0, width: 1280, height: 800 })

    let settled = false
    const done = async (): Promise<void> => {
      if (settled) return
      settled = true
      this.setTabControlled(tab.id, false)
      // 取完页就关掉:一次取页不该在 tab 条上留下一个用户没开过的页面。
      await this.closeTab({ id: tab.id }).catch(() => undefined)
    }
    return { tabId: tab.id, wc, done }
  }

  async activateTab(params: { id: string; deferNavigation?: boolean }): Promise<void> {
    const activation = ++this.activationGeneration
    this._state.dismissBrowserHistory?.();
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    // A composite mini-app tab has no web view to warm, load, capture or replay. Hiding the outgoing
    // tab and telling this one's mount it is foreground is the whole switch: hiding a container
    // hides its children, and each layer keeps its own visibility flag, so the composite's layer
    // state survives the round trip.
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      const previous = this.tabs.find((item) => item.id === this.activeTabId)
      if (previous && previous.id !== tab.id) this.hideTabContent(previous)
      this.activeTabId = tab.id
      tab.lastActive = Date.now()
      this.setOperationView(null)
      this._state.capture = null
      this._state.replayEngine = null
      this.setCompositeActive(tab.id, true)
      this.sendTabNav(tab)
      this.sendTitle(tab.title)
      this.broadcastTabs()
      return
    }
    // Leaving a composite tab: it is not the `previous` branch below, because that one only knows
    // how to hide a `WebContentsView`.
    const leaving = this.tabs.find((item) => item.id === this.activeTabId)
    if (leaving && leaving.id !== tab.id) this.setCompositeActive(leaving.id, false)
    if (this.activeTabId === tab.id && tab.view && !tab.view.webContents.isDestroyed()) {
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, tab.view)
      tab.lastActive = Date.now()
      if (!params.deferNavigation) void this.startTabNavigation(tab).catch((error) => {
        this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (error as Error).message, ts: Date.now() })
      })
      this.broadcastTabs()
      return
    }
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
    }
    if (activation !== this.activationGeneration || !this.tabs.includes(tab) || tab.closeReady) return
    const previous = this.tabs.find((item) => item.id === this.activeTabId)
    if (previous && previous.id !== tab.id && previous.view && !previous.view.webContents.isDestroyed()) {
      previous.view.setVisible(false)
    }
    this.activeTabId = tab.id
    tab.lastActive = Date.now()
    this.setOperationView(tab.view)
    this._state.capture = tab.kind === 'browser' ? tab.capture : null
    this._state.replayEngine = tab.kind === 'browser' ? tab.replay : null
    this._state.currentUrl = this.displayUrl(tab) || this._state.currentUrl
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.setVisible(true)
      if (this.isPinnedHomeTab(tab)) this.openPinnedHomeDevTools(tab, tab.view)
      if (this._state.opBounds) this.applyBounds(tab.view, this._state.opBounds)
      else this._state.layout()
      if (!params.deferNavigation) void this.startTabNavigation(tab).catch((error) => {
        this._state.emitTrace({ kind: 'error', msg: 'tab load: ' + (error as Error).message, ts: Date.now() })
      })
    }
    void this._state.switchCaptureTarget(tab).catch((error) => {
      if (this.activeTabId === tab.id) this._state.emitTrace({ kind: 'error', msg: 'capture target: ' + (error as Error).message, ts: Date.now() })
    })
    xpcMain.broadcast('coach/nav', this.displayUrl(tab))
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
    this._state.dismissBrowserHistory?.();
    if (this.tabs.length <= 1) return
    const tab = this.tabs.find((item) => item.id === params.id)
    if (!tab) return
    if (tab.pinned) return
    if (tab.closeReady) return await tab.closeReady
    const closing = this.performCloseTab(tab)
    tab.closeReady = closing
    try {
      await closing
    } finally {
      if (tab.closeReady === closing) tab.closeReady = undefined
    }
  }

  private async performCloseTab(tab: OperationTab): Promise<void> {
    this.clearTabControl(tab)
    // A composite tab owns a whole sub-application, so closing it must reach that sub-application's
    // own teardown — cooling a web view it does not have would silently orphan four renderers, a
    // hidden search runtime and a bound workspace.
    const composite = this.compositeTabs.get(tab.id)
    if (composite) {
      const index = this.tabs.indexOf(tab)
      if (index >= 0) this.tabs.splice(index, 1)
      this.compositeTabs.delete(tab.id)
      const host = this.compositeHosts.get(tab.id)
      this.compositeHosts.delete(tab.id)
      if (host) composite.close(host)
      const wasActive = this.activeTabId === tab.id
      if (wasActive) {
        const next = this.tabs[index] || this.tabs[this.tabs.length - 1]
        this.activeTabId = null
        if (next) await this.activateTab({ id: next.id })
      } else {
        this.broadcastTabs()
      }
      return
    }
    // Closing can wait on capture teardown; never leave a watchdog armed during that interval.
    this.setTabLoading(tab, false)
    if (this._state.capturing && this._state.captureTargetTabId === tab.id && !this._state.isDrillBranchTab?.(tab.id)) {
      await this._state.stopCapture()
    }
    await this.coolTab(tab)
    const index = this.tabs.indexOf(tab)
    if (index < 0) return
    const wasActive = this.activeTabId === tab.id
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

  describeAgentTab(id: string): AgentBrowserTabState | undefined {
    const tab = this.tabs.find((item) => item.id === id)
    if (!tab) return undefined
    const info = { id, title: tab.title, url: this.displayUrl(tab) }
    if (tab.kind !== 'browser') return { ...info, status: 'unavailable', error: 'This tab is not a browser page.' }
    if (tab.browserError) return { ...info, ...tab.browserError }
    const wc = tab.view?.webContents
    if (wc?.isDestroyed()) return { ...info, status: 'destroyed', error: 'The tab WebContents was destroyed.' }
    if (wc?.isCrashed()) return { ...info, status: 'crashed', error: 'The tab renderer crashed.' }
    if (!wc) return { ...info, status: 'cold' }
    if (!tab.debuggerEnabled) return { ...info, status: 'unavailable', error: 'Browser debugging is disabled for this tab.' }
    return { ...info, status: tab.loading ? 'loading' : 'ready' }
  }

  async requireAgentTab(id: string): Promise<OperationTab> {
    const assertAvailable = (): OperationTab => {
      const info = this.describeAgentTab(id)
      if (!info || !['ready', 'cold', 'loading'].includes(info.status)) {
        throw new Error(`Tab ${id}: ${info?.status || 'closed'} — ${info?.error || 'The tab is no longer open.'} Reopen the intended URL explicitly with open_tab, then inspect it before continuing.`)
      }
      return this.tabs.find((item) => item.id === id)!
    }
    const tab = assertAvailable()
    await this.warmAndLoad(tab)
    await tab.capture?.prepareNavigation()
    assertAvailable()
    if (!tab.capture || !tab.replay || !tab.view) throw new Error(`Tab ${id}: browser capture/replay is not ready.`)
    if (tab.view) this.applyBounds(tab.view, this._state.opBounds || { x: 0, y: 0, width: 1280, height: 800 })
    return tab
  }

  async openAgentTab(url: string, opened: (id: string) => void | Promise<void>, sessionId?: string, show = false): Promise<OperationTab> {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('open_tab requires an absolute http(s) URL.')
    const generation = sessionId ? this._state.browserUseGeneration?.(sessionId) : undefined
    const tab = await this.claimSpareTab({ url })
    this.setTabControlled(tab.id, true)
    if (sessionId) this._state.browserPopupActivity?.(sessionId, tab.id, true, generation)
    try {
      await opened(tab.id)
      if (tab.view) this.applyBounds(tab.view, this._state.opBounds || { x: 0, y: 0, width: 1280, height: 800 })
      const wc = tab.view?.webContents
      if (!wc || wc.isDestroyed()) throw new Error(`Tab ${tab.id}: WebContents is unavailable.`)
      await this.startTabNavigation(tab, { url })
      const ready = await this.requireAgentTab(tab.id)
      if (show) await this.activateTab({ id: tab.id })
      return ready
    } catch (error) {
      if (!tab.browserError) tab.browserError = { status: 'load-failed', error: String(error) }
      this.broadcastTabs()
      throw new Error(`Tab ${tab.id}: ${String(error)}`)
    } finally {
      if (sessionId) this._state.browserPopupActivity?.(sessionId, tab.id, false)
      this.setTabControlled(tab.id, false)
    }
  }

  private broadcastTabs(): void {
    xpcMain.broadcast('coach/tabs', this.tabs.map((tab) => this.tabInfo(tab)))
    this._state.browserTabsChanged?.()
  }

  private tabInfo(tab: OperationTab): TabInfo {
    const url = this.displayUrl(tab)
    return {
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      ...(tab.alias ? { alias: tab.alias } : {}),
      url,
      ...(tab.kind !== 'browser' ? { displayUrl: url } : {}),
      // Persistence is renderer-driven, and a composite tab carries no URL to persist by — so its
      // identity and its opt-in have to reach the renderer on the wire.
      ...(tab.instanceId ? { instanceId: tab.instanceId } : {}),
      ...(this.compositeTabs.get(tab.id)?.restorable ? { restorable: true } : {}),
      active: tab.id === this.activeTabId,
      pinned: tab.pinned,
      favicon: tab.favicon,
      debuggerEnabled: tab.debuggerEnabled,
      debuggerAttached: tab.kind === 'browser' && Boolean(tab.capture?.isAttached()),
      controlled: Boolean(tab.controlled),
      loading: tab.loading
    }
  }

  /**
   * The only writer of a tab's visible loading state. Starting always rearms the watchdog, while
   * redirects that keep the boolean true avoid redundant tab-list broadcasts.
   */
  private setTabLoading(tab: OperationTab, loading: boolean): void {
    if (tab.loadWatchdog) {
      clearTimeout(tab.loadWatchdog)
      tab.loadWatchdog = null
    }
    if (loading) {
      tab.loadWatchdog = setTimeout(() => {
        tab.loadWatchdog = null
        if (!tab.loading) return
        tab.loading = false
        console.warn(`[maestro] load watchdog settled tab ${tab.id}`)
        this.broadcastTabs()
      }, LOAD_WATCHDOG_MS)
    }
    if (tab.loading === loading) return
    tab.loading = loading
    this.broadcastTabs()
  }

  async toolInjectButton(skillsJson: string, domainArg: string, tabId?: string): Promise<string> {
    const active = tabId ? this.tabs.find((tab) => tab.id === tabId) : this.getActiveTab()
    if (active?.kind !== 'browser') return 'ERROR: open a normal browser tab before injecting a button.'
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

  async toolRemoveInjectedButton(domainArg: string, tabId?: string): Promise<string> {
    const active = tabId ? this.tabs.find((tab) => tab.id === tabId) : this.getActiveTab()
    if (active?.kind !== 'browser' && !normalizeInjectedButtonDomain(domainArg)) {
      return 'ERROR: open a normal browser tab or pass a domain.'
    }
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
    if (tab.kind !== 'browser') return { ok: false, error: 'button injection requires a normal browser tab' }
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
      if (tab.kind !== 'browser') continue
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
    this.controlDepth.clear()
    this.activeBrowserUseTabs.clear()
    this.newTabsBySession.clear()
    this.contentCovered = false
    this.lifecycleEpoch += 1
    for (const tab of this.tabs) {
      if (tab.loadWatchdog) {
        clearTimeout(tab.loadWatchdog)
        tab.loadWatchdog = null
      }
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
    if (this.spareWarmTask) clearImmediate(this.spareWarmTask)
    this.spareWarmTask = null
    this.activationGeneration += 1
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
