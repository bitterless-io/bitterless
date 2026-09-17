import { View, WebContentsView, type BaseWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { enrollMaestroShortcutContents } from '@maestro-main/common/shortcutsHelper/shortcuts.helper';
import { configureOnlyPreviewNavigationFence } from '@main/miniapps/onlypreview/views/onlyPreviewRendererTarget.service';

/**
 * 占位 surface 向承载要的东西 —— 结构上就是一个 composite tab 的 host api 的子集。
 *
 * 写成本地接口而不是 import `MaestroCompositeTabHostApi`:这一格什么都不知道,它只要一个窗口、
 * 一个内容矩形和一次 attach。`OnlyPreviewFileTabHost` 同一个形状、同一个理由。
 */
export interface OnlyPreviewDeferredTabHost {
  window(): BaseWindow | null;
  contentRect(): { x: number; y: number; width: number; height: number } | null;
  attach(container: View): void;
  detach(container: View): void;
  isOpen(): boolean;
}

/**
 * 独立窗口占着 OnlyPreview 时,那一格 tab 装的东西 —— **一张纸**。
 *
 * 按已经落地的 `OnlyPreviewFileTabSurface` 同形:容器自持、同一套 dev/packaged 入口解析、同一道
 * 导航禁闭。区别在于它刻意什么都不持有:**没有 hostToken、没有 workspace、没有索引、没有文件
 * 路径**。理由是这一格随时会被就地升格成真正的 OnlyPreview(关掉那个窗口),而一个持有承载能力的
 * 占位页会在升格那一刻和真正的承载抢同一个单例。
 *
 * 所以它也不出现在 `onlyPreviewHostRegistry` 里:`getStandaloneHost()` 在占位状态下仍然指向那个
 * 独立窗口,于是工作区芯片的点击照旧路由到**窗口**而不是这一格
 * (docs/features/onlypreview-deferred-tab-placeholder.md #2)。
 */
export class OnlyPreviewDeferredTabSurface {
  readonly container = new View();
  private page: WebContentsView | null = null;
  private disposed = false;
  private active = false;

  /**
   * `initiallyActive` 不是可选的方便参数 —— **降级那一条路不经过 maestro**。
   *
   * `OnlyPreviewFileTabSurface` 可以在构造时一律 `setVisible(false)`,因为它总是由
   * `openCompositeTab` 建出来,maestro 随后会补一次 `setActive`。占位页有一条 maestro 完全不知道的
   * 入口(composite 拆卸时的 `deps.defer()`),那一次没人会替它补,于是不传这一位就是一块看不见的
   * 白板 —— 和「空条」难以区分。
   */
  constructor(
    private readonly owner: OnlyPreviewDeferredTabHost,
    initiallyActive: boolean
  ) {
    this.active = initiallyActive;
    this.container.setVisible(initiallyActive);
  }

  async open(): Promise<void> {
    try {
      const entryPath = join(__dirname, '../renderer/onlypreview/detached/index.html');
      const entryUrl =
        is.dev && process.env.ELECTRON_RENDERER_URL
          ? `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/onlypreview/detached/index.html`
          : pathToFileURL(entryPath).href;
      if (!this.isLive()) throw new Error('The OnlyPreview placeholder tab closed during startup.');
      this.page = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/onlypreview.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          // **只有 mode,没有 host token。** 这一格不持有承载能力(见类注释),而 `mode` 是
          // preload 认出这个入口所需要的全部。
          additionalArguments: ['--onlypreview-mode=detached']
        }
      });
      configureOnlyPreviewNavigationFence(this.page.webContents, entryUrl, false);
      // 与 composite 的那四层同一个理由:这个 view 不在 Maestro 的 session 里,不登记的话 Cmd+W
      // 会穿到菜单的 `close` role 上,把整个窗口带走。
      enrollMaestroShortcutContents(this.page.webContents);
      this.container.addChildView(this.page);
      this.owner.attach(this.container);
      this.refresh();
      await this.page.webContents.loadURL(entryUrl);
      if (!this.isLive()) throw new Error('The OnlyPreview placeholder tab closed during startup.');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  setActive(active: boolean): void {
    if (!this.isLive()) return;
    this.active = active;
    this.container.setVisible(active);
    if (active) this.refresh();
  }

  refresh(): void {
    if (!this.isLive()) return;
    const rect = this.owner.contentRect();
    if (!rect) return;
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    this.container.setBounds(bounds);
    this.page?.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const page = this.page;
    this.page = null;
    if (page && !page.webContents.isDestroyed()) page.webContents.close();
    this.owner.detach(this.container);
  }

  private isLive(): boolean {
    const window = this.owner.window();
    return !this.disposed && this.owner.isOpen() && Boolean(window) && !window!.isDestroyed();
  }
}
