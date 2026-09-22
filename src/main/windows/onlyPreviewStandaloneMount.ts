import type { BaseWindow, View } from 'electron';
import type {
  OnlyPreviewMount,
  OnlyPreviewMountChrome,
  OnlyPreviewMountKind
} from '@main/miniapps/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewSurfaceSize } from '@main/miniapps/onlypreview/onlyPreviewSurfaceLayout';

/**
 * The composite carried by its own window — today's behaviour, behind the seam.
 *
 * Every member is a plain window operation, which is the point: the standalone host was never
 * doing anything a second host could not also do, it was just doing it in the composite's own code.
 * Window creation, `windowStateService` registration, persisted bounds and the 800x600 minimum stay
 * with the window helper; this only exposes what the composite is allowed to ask for.
 */
export class OnlyPreviewStandaloneMount implements OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind = 'standalone';
  // A window can do all three. The Shell renders its own MenuBar controls from this.
  readonly chrome: OnlyPreviewMountChrome = { minimize: true, maximize: true, close: true };

  private container: View | null = null;
  private readonly resizeListeners = new Set<() => void>();
  private readonly activationListeners = new Set<(active: boolean) => void>();
  private readonly hostGoneListeners = new Set<() => void>();

  constructor(
    private readonly baseWindow: BaseWindow,
    // The persisted-geometry controller, when this window has one. Held here rather than in the
    // composite because restoring a window's size is a host concern and a tab has no equivalent.
    private readonly windowState: { show(): void } | null = null
  ) {}

  attach(container: View): void {
    if (!this.isAlive()) return;
    this.container = container;
    this.baseWindow.contentView.addChildView(container);
    this.applyContainerBounds();
  }

  detach(): void {
    const container = this.container;
    this.container = null;
    if (!container || !this.isAlive()) return;
    try {
      // One detach for the whole composite: the layers are children of the container, so removing
      // the container takes them with it.
      this.baseWindow.contentView.removeChildView(container);
    } catch {
      // Electron may already have released the child view during window teardown.
    }
  }

  contentSize(): OnlyPreviewSurfaceSize | null {
    if (!this.isAlive()) return null;
    const [width, height] = this.baseWindow.getContentSize();
    return { width, height };
  }

  /**
   * Keep the container over the window's content rect and tell the composite to re-lay-out.
   *
   * Driven by the window's own `resize`, which is also what covers the asynchronous settle of
   * `maximize()` and `setFullScreen(true)` on macOS.
   */
  refresh(): void {
    this.applyContainerBounds();
    for (const listener of this.resizeListeners) listener();
  }

  reportActivation(active: boolean): void {
    for (const listener of this.activationListeners) listener(active);
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  onActivation(listener: (active: boolean) => void): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  window(): BaseWindow | null {
    return this.isAlive() ? this.baseWindow : null;
  }

  isAlive(): boolean {
    return !this.baseWindow.isDestroyed();
  }

  requestClose(): void {
    if (this.isAlive()) this.baseWindow.close();
  }

  showSurface(): void {
    if (!this.isAlive()) return;
    // The window-state controller is what applies persisted bounds and any saved maximize or
    // full-screen, so it shows the window when there is one; otherwise a plain restore-and-show.
    if (this.windowState) {
      this.windowState.show();
    } else {
      if (this.baseWindow.isMinimized()) this.baseWindow.restore();
      this.baseWindow.show();
    }
    this.baseWindow.focus();
  }

  onHostGone(listener: () => void): () => void {
    this.hostGoneListeners.add(listener);
    return () => this.hostGoneListeners.delete(listener);
  }

  /** Called by the owner from the window's own `closed` event. */
  reportHostGone(): void {
    for (const listener of [...this.hostGoneListeners]) listener();
  }

  destroyHost(): void {
    if (this.isAlive()) this.baseWindow.destroy();
  }

  /** 独立窗口没有 Maestro tab,也就没有 tab 级刷新可捕获。 */
  maestroRendererArguments(): string[] {
    return [];
  }

  registerSurfaceView(): void {
    // Nothing to enroll: this composite's views live inside a window whose chords are already the
    // application's own.
  }

  reportTitle(title: string): void {
    if (this.isAlive()) this.baseWindow.setTitle(title);
  }

  reportDisplayUrl(): void {
    // **故意空操作。** 独立窗口没有地址栏 —— 它的标题栏已经由 `reportTitle` 说明在看什么。
    // 往一个不存在的控件写字不会报错,所以这里必须是一条有解释的空实现,而不是一个 TODO。
  }

  dispose(): void {
    this.resizeListeners.clear();
    this.activationListeners.clear();
    this.hostGoneListeners.clear();
    this.container = null;
  }

  private applyContainerBounds(): void {
    const size = this.contentSize();
    if (!size || !this.container) return;
    this.container.setBounds({ x: 0, y: 0, ...size });
  }
}
