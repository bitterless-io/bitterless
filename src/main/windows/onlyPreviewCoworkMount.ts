import type { BaseWindow, View, WebContents } from 'electron';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';
import type {
  OnlyPreviewMount,
  OnlyPreviewMountChrome,
  OnlyPreviewMountKind
} from '@main/miniapps/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewSurfaceSize } from '@main/miniapps/onlypreview/onlyPreviewSurfaceLayout';

/**
 * 这个 mount 向 OnlyPreview 那一格 tab 的胶水要的东西 —— Maestro 的 tab,外加一件 Maestro 对其
 * 没有任何意见的事。
 *
 * `defer()` 不住在 `MaestroCompositeTabHostApi` 上,因为它不是 tab 的能力:「这一格现在装占位页
 * 而不是 composite」是 **OnlyPreview 自己的双态**,而 Maestro 连那一格里装的是什么都不知道
 * (`check:maestro` 的别名边界)。所以它住在胶水与 mount 之间这一层,由
 * `onlyPreviewCoworkTab.ts` 提供 —— 与 micromeet-cowork 那一份把 `CoworkCompositeTabHostApi`
 * 定义在 mount 旁边同一个理由。
 */
export interface OnlyPreviewCoworkTabDeps extends MaestroCompositeTabHostApi {
  /**
   * 把这一格交还给占位页:composite 正在拆,但 tab 要留下。
   *
   * 见 `destroyHost()` 下面那段注释,以及
   * docs/features/onlypreview-deferred-tab-placeholder.md #1。
   */
  defer(): void;
}

/**
 * The OnlyPreview composite carried by a Maestro (Cowork) tab.
 *
 * Everything host-shaped in one place: the composite asks for an extent and gets the tab's content
 * rect, asks to be shown and gets its tab activated, asks to close and closes one tab rather than
 * the window everyone else's tabs live in.
 *
 * Two things it deliberately does not do. It never joins `MAESTRO_PARTITION` — the composite keeps
 * its own default-session views, its `bitterless-preview://` registration and its sandboxed content
 * preload, so an embedded OnlyPreview shares no cookies or storage with the remote pages in sibling
 * tabs. And it never reaches into Maestro's view order beyond the tab position it is given: the
 * composite's four layers are children of one container, so two independent stacks nest, and
 * OnlyPreview's own sort can never interleave with Maestro's chrome.
 */
export class OnlyPreviewCoworkMount implements OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind = 'cowork';
  // A tab has no traffic lights and no window of its own to minimize. Close is the tab's own close.
  readonly chrome: OnlyPreviewMountChrome = { minimize: false, maximize: false, close: true };

  private container: View | null = null;
  private visible = false;
  private lastBounds = '';
  private readonly resizeListeners = new Set<() => void>();
  private readonly activationListeners = new Set<(active: boolean) => void>();
  private readonly hostGoneListeners = new Set<() => void>();

  constructor(private readonly deps: OnlyPreviewCoworkTabDeps) {}

  attach(container: View): void {
    this.container = container;
    this.deps.attach(container);
    // Hidden until the tab is activated, exactly like every other tab view. Hiding the container
    // hides its children — measured on Electron 40.10.6 — while each layer keeps its own visibility
    // flag, so the composite's layer state survives a tab switch untouched.
    container.setVisible(this.visible);
    this.applyContainerBounds();
  }

  detach(): void {
    const container = this.container;
    this.container = null;
    if (!container) return;
    this.deps.detach(container);
  }

  contentSize(): OnlyPreviewSurfaceSize | null {
    const rect = this.deps.contentRect();
    if (!rect) return null;
    return { width: rect.width, height: rect.height };
  }

  refresh(): void {
    this.applyContainerBounds();
    for (const listener of this.resizeListeners) listener();
  }

  /** The host reporting that this tab is, or is no longer, the foreground content. */
  reportActivation(active: boolean): void {
    this.visible = active;
    if (this.container) this.container.setVisible(active);
    if (active) this.applyContainerBounds();
    for (const listener of this.activationListeners) listener(active);
  }

  /** The host reporting that this tab is gone. */
  reportHostGone(): void {
    for (const listener of [...this.hostGoneListeners]) listener();
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  onActivation(listener: (active: boolean) => void): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  onHostGone(listener: () => void): () => void {
    this.hostGoneListeners.add(listener);
    return () => this.hostGoneListeners.delete(listener);
  }

  window(): BaseWindow | null {
    return this.deps.window();
  }

  isAlive(): boolean {
    return this.deps.isOpen() && Boolean(this.deps.window());
  }

  requestClose(): void {
    this.deps.close();
  }

  showSurface(): void {
    this.deps.activate();
  }

  /**
   * **不关这一格 tab —— 把它降级成占位页(Ral 2026-09-17)。**
   *
   * 这一行是 2026-09-07 那条「独立窗口打开,浏览器里的 tab 就得关掉」的反转
   * (docs/issues/onlypreview-host-toggle-leaves-empty-cowork-tab.md 的 Reversal 段)。原来是
   * `this.deps.close()`,而那条决定在默认配置下**根本执行不了**:`onlyPreviewCoworkTab.ts` 声明了
   * `defaultHome: true`,于是没设过主页的机器上这一格就是 pinned 的固有 tab,而 `closeTab` 对
   * pinned 直接静默返回(`maestroBrowserView.service.ts` 里 `tabs.length <= 1` 与 `tab.pinned` 两条)。
   * 关不掉的结果不是「tab 关掉了」,是一格关不掉的空白 —— 外加没有任何回到那个窗口的入口,
   * 这正是 Ral 说的「关闭这个事情 UI 上不友好」。
   *
   * 所以这里改成 `defer()`:composite 照常拆干净,tab 留在原地显示「已在独立窗口打开 ＋ 前往」。
   * 关掉那个独立窗口时这一格就地升格回真正的 OnlyPreview
   * (docs/features/onlypreview-deferred-tab-placeholder.md #1、#4)。
   *
   * 2026-09-07 同一场里定的另外两条**不受影响**:teardown-first 的顺序
   * (`onlyPreviewHostToggle.service.ts` 的 `relocate`)、以及来回切换时索引要能继续创建
   * (`beginHostTransition()`)。
   */
  destroyHost(): void {
    this.deps.defer();
  }

  maestroRendererArguments(): string[] {
    return this.deps.rendererArguments();
  }

  registerSurfaceView(): void {
    // Nothing to register. Maestro's tab chords are decided per keystroke from the FOCUSED WINDOW,
    // so a view inside the Maestro window is covered the moment it exists — the enrollment this
    // used to perform was exactly the step whose omission broke Zellij
    // (maestro-zellij-chrome-cmd-w-closes-window.md). Kept as a no-op because the mount interface
    // is shared with the standalone mount, which also has nothing to do here.
  }

  reportTitle(title: string): void {
    this.deps.setTitle(title);
  }

  reportDisplayUrl(url: string): void {
    this.deps.setDisplayUrl(url);
  }

  dispose(): void {
    this.resizeListeners.clear();
    this.activationListeners.clear();
    this.hostGoneListeners.clear();
    this.container = null;
  }

  /**
   * Position the container over the tab's content rect, suppressing redundant rects.
   *
   * Same reason `createBoundsApplier` exists for Maestro's `WebContentsView`s — a ResizeObserver
   * reports the same rect repeatedly during a layout pass — but written out here because that helper
   * is typed for a web view and the composite's container is a plain `View`.
   */
  private applyContainerBounds(): void {
    const rect = this.deps.contentRect();
    const container = this.container;
    if (!rect || !container) return;
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (this.lastBounds === key) return;
    this.lastBounds = key;
    container.setBounds(bounds);
  }
}
