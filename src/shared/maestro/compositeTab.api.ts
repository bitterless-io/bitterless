import type { BaseWindow, View } from 'electron'
import type { ViewRect } from './coach.api'

/**
 * What a Maestro tab offers a mini app whose content is not one web page.
 *
 * Maestro knows how to carry a native `View` in a tab; it does not know what is inside one. A host
 * mini app implements its own mount on top of this and registers a spec, so the dependency points
 * from the host into Maestro and never back — the direction `check:maestro`'s alias boundary exists
 * to keep. That is also why this lives in `maestro-shared` rather than beside the mini app: it is
 * Maestro's offer, expressed in Maestro's own terms.
 */
export interface MaestroCompositeTabHostApi {
  /**
   * This tab's stable identity — minted by Maestro, persisted with the tab, handed back verbatim
   * when the tab is restored.
   *
   * Deliberately NOT the tab id: that is `tab-${++tabSeq}`, a per-process sequence number that
   * restarts at 0 every launch, so a restored tab would address a stranger's state. A mini app that
   * keeps something outside the process (Zellij keeps a session) keys it on THIS.
   */
  readonly instanceId: string
  /** The window carrying the tab. For menu arbitration and parented dialogs, never for geometry. */
  window(): BaseWindow | null
  /** The rect Maestro reserves for tab content, or null before the renderer has measured one. */
  contentRect(): ViewRect | null
  /** Attach at the tab-view position, so the whole composite sits below Maestro's own chrome. */
  attach(container: View): void
  detach(container: View): void
  /** Bring this tab forward. */
  activate(): void
  /** Close this tab — not the window it lives in. */
  close(): void
  setTitle(title: string): void
  /**
   * 这个 tab 的地址栏该显示什么 —— 空串 = 退回注册时那个静态 `displayUrl`。
   *
   * 为什么需要它:composite tab 没有网页,地址栏原来永远显示注册时那一行
   * (`bitterless://only-preview`)。Ral 2026-09-10 要的是**看起来像真实浏览器** —— 里面在看哪个
   * 文件,地址栏就显示那个文件的 `file://`。而"在看哪个文件"只有 mini app 知道,所以和 `setTitle`
   * 同一类:mini app 把自己的状态推给承载它的 tab。
   * 见 `docs/features/onlypreview-address-bar-shows-file-url.md`。
   */
  setDisplayUrl(url: string): void
  /** Whether this tab is still in the strip. */
  isOpen(): boolean
}

/** A registered composite mini app: how to build it into a tab, and how to take it down. */
export interface MaestroCompositeTabSpec {
  /** Stable id, also the tab kind: `'onlypreview'`. */
  id: string
  title: string
  favicon: string
  displayUrl: string
  /** Confirmed currently displayed absolute file path; pending/empty content returns null. */
  getDisplayedFile?(host: MaestroCompositeTabHostApi): string | null
  /**
   * At most one tab of this kind; opening again brings the existing one forward.
   *
   * Opt-IN, because it is a property of the mini app rather than of composite tabs in general:
   * OnlyPreview and Trench each bind one workspace and one runtime, so a second copy is meaningless,
   * while Zellij's shared piece is an HTTP server — and a server is multi-client by construction, so
   * N tabs are simply N clients (Ral 2026-09-11:「支持开多个不是单例类型的」).
   */
  singleton?: boolean
  /**
   * This tab comes back on the next launch, keyed on its `instanceId`.
   *
   * Also opt-in, and for a blunt reason: persistence is decided per mini app, not per tab kind.
   * Letting every composite kind persist would quietly turn OnlyPreview and Trench into
   * start-on-boot apps, which nobody asked for.
   */
  restorable?: boolean
  /**
   * 没设过主页时,固有槽位装我。至多一个 spec 可以声明。
   *
   * 住在 spec 上而不是 settings 的 `DEFAULT_SETTINGS` 里,理由和 `singleton` / `restorable` 同一条:
   * 「哪个 mini app 是默认主页」是**宿主**的事实,而 `check:maestro` 的别名边界不许 maestro 那棵树
   * 认识任何一个具体 mini app。写进默认设置还会有第二个后果 —— 每台机器都被写进一个
   * `homeCompositeId`,于是「还原默认主页」清空之后又得立刻写回默认值,清空变成假的。
   * 见 `docs/features/onlypreview-default-homepage.md` #1。
   */
  defaultHome?: boolean
  /** Existing app-account requirement, not a default for public/local miniapps. */
  requiresAuthentication?: boolean
  /** Build the mini app onto this tab. Rejecting leaves no tab behind. */
  open(host: MaestroCompositeTabHostApi): Promise<void>
  /**
   * The tab is gone; tear the mini app down.
   *
   * Every lifecycle callback is addressed BY HOST rather than relying on the registration to
   * remember one: a spec is registered once and can now carry several live tabs, so a module-level
   * `let host` would be overwritten by the second tab and orphan the first one's teardown.
   */
  close(host: MaestroCompositeTabHostApi): void
  /** The tab became, or stopped being, the foreground content. */
  setActive(host: MaestroCompositeTabHostApi, active: boolean): void
  /** The tab's content rect changed. */
  refresh(host: MaestroCompositeTabHostApi): void
  /**
   * Show an absolute path inside the mini app, if it can (optional — most composites cannot).
   *
   * Declared here rather than reached for directly because `check:maestro`'s alias boundary forbids
   * Maestro from importing a mini app: Maestro owns the tab and knows nothing about what fills it,
   * so "open this folder in whatever is in that tab" has to arrive as a capability the host
   * supplied. The host is also the only side that can order the two steps correctly — the tab must
   * exist before the target is handed over.
   */
  openTarget?(absolutePath: string): Promise<void>
}
