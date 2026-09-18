import { app, View, WebContentsView, type BaseWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'node:path';
import { autoOpenZellijDevTools, bindZellijDevTools } from './zellijDevTools.helper';
import { ZellijTerminalView, type ZellijTerminalRect } from './zellijTerminalView';
import {
  ZELLIJ_CHROME_BACKGROUND,
  ZELLIJ_CHROME_HEIGHT,
  ZELLIJ_SURFACE_QUERY,
  ZELLIJ_SURFACE_STATE_EVENT,
  type ZellijSnapshot
} from '@shared/zellij/zellij.type';
import { xpcMain } from 'electron-xpc/main';
import { blurZellijTerminal } from './zellijRuntime.service';
import { zellijLog, zellijSurfaceTag } from './zellijLog.service';
import { zellijErrorCode } from './zellijProcess.service';
import { loadZellijRenderer } from './zellijRendererLoad.service';
import { promptZellijRendererRetry } from './zellijRendererDialog.service';
import { i18nHelper } from '@main/i18n/i18n.helper';

/**
 * The Zellij mini app as a self-contained, host-agnostic composite: one container `View` holding the
 * chrome (`zellij/index.html`) and, when the runtime is ready, the terminal.
 *
 * Previously the chrome WAS the standalone window's own page, which is exactly what pinned Zellij
 * to a window — a BrowserWindow's web contents cannot be carried into a tab. Making the chrome a
 * `WebContentsView` inside a container lets the SAME surface be attached to a window today and to a
 * Maestro tab or an Omni cell tomorrow, the way Trench already moves between the two.
 *
 * Geometry has two levels and they must not be confused:
 *  - the CONTAINER is placed in host coordinates (window content rect, or the tab's content rect);
 *  - its children are CONTAINER-relative, which is also the frame the renderer measures its hole in,
 *    so `setContentBounds` needs no translation.
 */
export class ZellijSurface {
  readonly container = new View();
  private controls: WebContentsView;
  private chromeReady = false;
  private chromeError: ZellijSnapshot['error'] = null;
  private loading: Promise<void> | null = null;
  private readonly lifetime = new AbortController();
  private prompt: AbortController | null = null;
  private readonly terminal: ZellijTerminalView;
  private hostRect: ZellijTerminalRect = { x: 0, y: 0, width: 0, height: 0 };
  /**
   * Renderer-measured hole, container-relative. Height 0 means "not measured yet".
   *
   * `y` 的首帧兜底读 shared 的 `ZELLIJ_CHROME_HEIGHT` —— chrome 的 CSS 用的是同一个常量,各写一个
   * 字面量的话漂移**不会报错**:渲染层第一次量完就会把它盖掉,错的那一帧只是闪一下
   * (docs/features/zellij-terminal-chrome.md #2)。
   */
  private contentBounds: ZellijTerminalRect = { x: 0, y: ZELLIJ_CHROME_HEIGHT, width: 0, height: 0 };
  private visible = true;
  private destroyed = false;
  private opened = false;

  constructor(private readonly surfaceId: string) {
    this.controls = this.createControls();
    this.terminal = new ZellijTerminalView({
      surfaceId: this.surfaceId,
      container: this.container,
      bounds: () => this.terminalRect(),
      visible: () => this.visible,
      destroyed: () => this.destroyed,
      opened: () => this.opened && this.chromeReady,
      changed: (snapshot) =>
        xpcMain.broadcast(ZELLIJ_SURFACE_STATE_EVENT, {
          surfaceId: this.surfaceId,
          snapshot: this.chromeError ? this.snapshot() : snapshot
        })
    });
  }

  /**
   * Load the chrome, telling it which surface it is.
   *
   * The id travels in the URL rather than over XPC because the chrome needs it for its FIRST
   * message: `setContentBounds` fires as soon as it has measured, and an `XpcMainHandler` method
   * receives only `params` — no sender web contents — so with several surfaces live an id-less
   * measurement would lay out whichever terminal happened to be addressed last.
   */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.destroyed || this.chromeReady) return Promise.resolve();
    if (this.controls.webContents.isDestroyed()) this.controls = this.createControls();
    this.chromeError = null;
    this.layout();
    const startedAt = Date.now();
    const loading = (async () => {
      try {
        await loadZellijRenderer(
          this.controls.webContents,
          () => this.loadChrome(),
          'controls',
          this.lifetime.signal
        );
        if (this.destroyed) return;
        this.chromeReady = true;
        zellijLog.info('chrome-load', {
          surface: zellijSurfaceTag(this.surfaceId),
          elapsedMs: Date.now() - startedAt
        });
      } catch (error) {
        if (this.destroyed) return;
        this.chromeError = zellijErrorCode(error);
        this.container.removeChildView(this.controls);
        if (!this.controls.webContents.isDestroyed()) this.controls.webContents.close();
        zellijLog.warn('chrome-load-failed', {
          surface: zellijSurfaceTag(this.surfaceId),
          reason: this.chromeError,
          elapsedMs: Date.now() - startedAt
        });
      }
    })().finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  private createControls(): WebContentsView {
    const controls = new WebContentsView({
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'zellij.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    // chrome 现在是暗的,而 `WebContentsView` 的默认底色是白 —— 不设的话每次打开都先闪一帧白屏,
    // 在这套配色下非常刺眼。值与终端背景一致(zellij-terminal-chrome.md #3)。
    controls.setBackgroundColor(ZELLIJ_CHROME_BACKGROUND);
    bindZellijDevTools(controls.webContents);
    autoOpenZellijDevTools(controls.webContents);
    this.container.addChildView(controls);
    return controls;
  }

  private async loadChrome(): Promise<void> {
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(`${process.env.ELECTRON_RENDERER_URL}/zellij/index.html`);
      url.searchParams.set(ZELLIJ_SURFACE_QUERY, this.surfaceId);
      await this.controls.webContents.loadURL(url.toString());
    } else {
      await this.controls.webContents.loadFile(
        join(app.getAppPath(), 'out', 'renderer', 'zellij', 'index.html'),
        { query: { [ZELLIJ_SURFACE_QUERY]: this.surfaceId } }
      );
    }
  }

  /** The host's content rect, in the host's own coordinates. */
  setHostRect(rect: ZellijTerminalRect): void {
    this.hostRect = rect;
    this.layout();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      blurZellijTerminal(this.surfaceId);
      this.prompt?.abort();
    }
    this.container.setVisible(visible);
    this.layout();
  }

  /** The hole the chrome measured for the terminal, container-relative. */
  setContentBounds(input: ZellijTerminalRect): void {
    if (!Object.values(input).every(Number.isFinite)) return;
    const { width, height } = this.hostRect;
    const x = Math.max(0, Math.min(width, Math.round(input.x)));
    const y = Math.max(0, Math.min(height, Math.round(input.y)));
    this.contentBounds = {
      x,
      y,
      width: Math.max(0, Math.min(width - x, Math.round(input.width))),
      height: Math.max(0, Math.min(height - y, Math.round(input.height)))
    };
    this.terminal.layout();
  }

  sync(): void {
    this.opened = true;
    if (this.chromeReady) this.terminal.sync();
  }

  snapshot(): ZellijSnapshot {
    const snapshot = this.terminal.snapshot();
    return this.chromeError ? { ...snapshot, status: 'error', error: this.chromeError } : snapshot;
  }

  async initialize(): Promise<ZellijSnapshot> {
    await this.load();
    if (this.destroyed || !this.chromeReady) return this.snapshot();
    return this.terminal.initialize();
  }

  focus(owner?: BaseWindow): void {
    if (this.destroyed || !this.visible) return;
    if (this.chromeError && owner) {
      this.offerRetry(owner);
      return;
    }
    if (this.terminal.attached()) this.terminal.focus();
    else if (!this.controls.webContents.isDestroyed()) this.controls.webContents.focus();
  }

  private offerRetry(owner: BaseWindow): void {
    if (this.prompt || !this.chromeError) return;
    const prompt = new AbortController();
    this.prompt = prompt;
    const labels = i18nHelper.getMessages().zellij;
    void promptZellijRendererRetry(
      owner,
      {
        title: labels.title,
        message: labels.errors[this.chromeError],
        retry: labels.retry,
        dismiss: labels.dismiss
      },
      prompt.signal
    )
      .then(async (retry) => {
        if (this.prompt === prompt) this.prompt = null;
        if (!retry || this.destroyed || !this.visible) return;
        await this.initialize();
        if (!this.destroyed && this.visible) this.focus(owner);
      })
      .catch((error) => console.error('[zellij] renderer retry failed', error));
  }

  dispose(): void {
    if (this.destroyed) return;
    this.terminal.dispose();
    // Mark destroyed only after the terminal has detached — it asks the host before removing its
    // child view, and a surface that claims to be gone would leak that view instead.
    this.destroyed = true;
    this.lifetime.abort();
    this.prompt?.abort();
    this.container.removeChildView(this.controls);
    if (!this.controls.webContents.isDestroyed()) this.controls.webContents.close();
  }

  private layout(): void {
    if (this.destroyed) return;
    this.container.setBounds({
      x: Math.round(this.hostRect.x),
      y: Math.round(this.hostRect.y),
      width: Math.max(0, Math.round(this.hostRect.width)),
      height: Math.max(0, Math.round(this.hostRect.height))
    });
    // The chrome fills the container; the terminal overlays the hole it measured.
    if (!this.controls.webContents.isDestroyed())
      this.controls.setBounds({
        x: 0,
        y: 0,
        width: Math.max(0, Math.round(this.hostRect.width)),
        height: Math.max(0, Math.round(this.hostRect.height))
      });
    this.terminal.layout();
  }

  private terminalRect(): ZellijTerminalRect {
    const { width, height } = this.hostRect;
    const bounds = this.contentBounds;
    return {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(0, Math.min(bounds.width || width, width - bounds.x)),
      height: Math.max(0, Math.min(bounds.height || height - bounds.y, height - bounds.y))
    };
  }
}
