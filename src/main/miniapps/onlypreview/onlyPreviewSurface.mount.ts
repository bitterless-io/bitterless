import type { BaseWindow, View, WebContents } from 'electron';
import type { OnlyPreviewSurfaceSize } from './onlyPreviewSurfaceLayout';

export type OnlyPreviewMountKind = 'standalone' | 'cowork';

/**
 * What the host can actually honour, so the Shell renders only that.
 *
 * A Cowork tab has no traffic lights and no window of its own to minimize; offering the controls
 * anyway would put buttons on screen whose only possible behaviour is to do nothing.
 */
export interface OnlyPreviewMountChrome {
  minimize: boolean;
  maximize: boolean;
  close: boolean;
}

/**
 * The seam between the OnlyPreview composite and whatever carries it.
 *
 * The composite owns a container `View` holding its four layers and knows its own size; it does not
 * know what that container is attached to. A host implements this interface and hands it in, so the
 * dependency points one way only: **nothing under `src/main/miniapps/onlypreview/` may import a host.** That
 * is the same inversion the existing `OnlyPreviewGlobalSearchWindowService` and
 * `OnlyPreviewAlertWindowService` already use, where the owner supplies the window and the view
 * factory and the view service owns its own surface.
 *
 * Two implementations are intended: the standalone window, and a tab in the Maestro (Cowork)
 * browser window. A third — an Omni cell — is recorded as deferred in
 * `docs/plan/tasks/onlypreview-omni-embedding-026.md` and would be a third implementation here
 * rather than a rewrite.
 */
export interface OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind;
  readonly chrome: OnlyPreviewMountChrome;

  /** Put the composite's container where this host wants it, and size it. */
  attach(container: View): void;

  /** Release the container. The composite's views are not touched: this is not a teardown. */
  detach(): void;

  /**
   * The composite's extent, in the surface's own coordinate space — origin always `(0, 0)`, because
   * child bounds are relative to the container. `null` once the host is gone.
   */
  contentSize(): OnlyPreviewSurfaceSize | null;

  /** Fires whenever `contentSize` changes for any reason this host knows about. */
  onResize(listener: () => void): () => void;

  /**
   * Re-measure now and notify, without waiting for the host's own next change.
   *
   * The composite needs this for its first frame: on macOS `maximize()` and `setFullScreen(true)`
   * settle asynchronously, and a tab is positioned from a rect its renderer measured, so in both
   * hosts there is a moment where the extent is known but nothing has announced it yet.
   */
  refresh(): void;

  /** Fires when the composite becomes, or stops being, this host's foreground content. */
  onActivation(listener: (active: boolean) => void): () => void;

  /**
   * The window the composite currently lives in — for menu-accelerator arbitration and for
   * parenting the Settings and Guide windows. Never for geometry: that is `contentSize`.
   */
  window(): BaseWindow | null;

  /**
   * Whether the host is still there. `View` exposes no `isDestroyed()`, so the composite's services
   * ask this instead of interrogating a window they should not hold.
   */
  isAlive(): boolean;

  /** Close the composite the way this host closes things: a window, or one tab. */
  requestClose(): void;

  /**
   * Bring the composite in front of the owner: show and focus a window, or activate a tab.
   *
   * Named for the intent rather than the mechanism, because the mechanism is the whole difference
   * between the two hosts and the composite must not care which one it got.
   */
  showSurface(): void;

  /**
   * Fires once when the host itself goes away — the window was closed, or the tab was.
   *
   * This is the signal the composite tears itself down on. It exists because the composite used to
   * listen to `window.once('closed')` directly, which is exactly the assumption that made it
   * unhostable anywhere else.
   */
  onHostGone(listener: () => void): () => void;

  /**
   * Take the host down as part of the composite's own teardown. Distinct from `requestClose()`,
   * which is the owner asking; this is the composite finishing.
   *
   * **「Take down」是每个承载自己的说法,而它们两个不对称(Ral 2026-09-17)。** 独立窗口那一种
   * `destroy()` 掉自己的窗口。Cowork 那一种**不关**那一格 tab —— 它把那一格降级成一张
   * 「已在独立窗口打开 ＋ 前往」的占位页,关掉那个窗口时再就地升格回来。所以这个方法的契约是
   * 「这个承载不再装 composite 了」,不是「这个承载消失」;把它读成后者会得出「切走之后那一格
   * 就该没了」这个错误结论,而那正是 2026-09-07 到 2026-09-17 之间留下一格关不掉的空白的原因
   * (docs/features/onlypreview-deferred-tab-placeholder.md #1)。
   */
  destroyHost(): void;

  /**
   * Hand the host one of the composite's views, as it is created.
   *
   * A host may need to know a view is part of this mini app even though the view is not in the
   * host's own session — a Cowork tab enrolls it with Maestro's tab chords so Cmd+W closes the tab
   * rather than the window. The standalone host needs nothing: its window already owns its chords.
   */
  registerSurfaceView(webContents: WebContents): void;
  /**
   * 建 surface view 时要摊进 `additionalArguments` 的宿主参数。
   *
   * Maestro 的 tab 承载时给出这个 tab 的身份(`MAESTROSDK` 靠它认出发给自己的刷新广播);独立窗口
   * 承载时是空的 —— 那儿没有 tab,也就没有 tab 级的刷新可捕获。
   * 见 `docs/features/maestro-sdk-refresh-events.md` #2.1。
   */
  maestroRendererArguments(): string[];

  reportTitle(title: string): void;

  /**
   * 承载的地址栏该显示什么。空串 = 退回承载自己的缺省。
   *
   * **不是每个承载都有地址栏** —— 独立窗口那一种实现为空操作。放进接口而不是让调用方分情况,
   * 是因为"当前在预览哪个文件"是 mini app 侧的知识,而"我有没有地方显示它"是承载侧的知识;
   * 让调用方去问后者等于把承载的种类漏进上游(Ral 2026-09-10,地址栏显示 `file://`)。
   */
  reportDisplayUrl(url: string): void;

  /** Release the mount's own listeners. Called by the composite as the last step of teardown. */
  dispose(): void;
}
