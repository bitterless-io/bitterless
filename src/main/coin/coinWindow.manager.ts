import { app, BaseWindow, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';
import {
  COIN_WINDOW_DEFAULT_HEIGHT,
  COIN_WINDOW_DEFAULT_WIDTH,
  COIN_WINDOW_MIN_HEIGHT,
  COIN_WINDOW_MIN_WIDTH,
  CoinWindowStateStore
} from './coinWindowState';
import { windowStateService, type WindowStateController } from '@main/windows/windowState.service';
import type { CoinWindowSurface } from './coinWindow.type';

const normalizedRendererUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  return url.href;
};

export class CoinWindowManager {
  private currentSurface: CoinWindowSurface | null = null;
  private currentWindow: BaseWindow | null = null;
  private tabHost: MaestroCompositeTabHostApi | null = null;
  private windowStateController: WindowStateController | null = null;

  get surface(): CoinWindowSurface | null {
    return this.currentSurface;
  }

  get hostKind(): 'standalone' | 'tab' {
    return this.tabHost ? 'tab' : 'standalone';
  }

  get hasHost(): boolean {
    return Boolean(this.tabHost || this.currentWindow);
  }

  async create(signal: AbortSignal): Promise<CoinWindowSurface> {
    if (this.currentSurface && !this.currentSurface.isDestroyed()) return this.currentSurface;
    if (signal.aborted) throw new Error('[coin] startup aborted');

    const token = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/trench.js'),
        // `MAESTROSDK` 的身份。建 view 时可能还没 dock 进 tab(`this.tabHost` 为 null),而
        // `openOnTab` 是**搬**这同一个 view、不重建 —— 所以「先开独立窗口、后 dock」的那份收不到
        // 刷新事件。已知缺口,记在 docs/features/maestro-sdk-refresh-events.md 的 PQ-4;
        // 严格胜于误触发:拿不到身份就一条都不跑,绝不去替别的 tab 刷新。
        additionalArguments: [
          '--mode=standalone',
          `--trenchSurfaceToken=${token}`,
          ...(this.tabHost?.rendererArguments() ?? [])
        ],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    const contents = view.webContents;
    const surface: CoinWindowSurface = {
      view,
      webContents: contents,
      token,
      isDestroyed: () => contents.isDestroyed()
    };
    this.currentSurface = surface;
    const rendererUrl = this.getRendererUrl();
    const abortStartup = (): void => {
      void this.destroy(surface);
    };
    signal.addEventListener('abort', abortStartup, { once: true });
    contents.once('destroyed', () => {
      signal.removeEventListener('abort', abortStartup);
      if (this.currentSurface === surface) {
        this.releaseHost();
        this.currentSurface = null;
      }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-navigate', (event, targetUrl) => {
      if (normalizedRendererUrl(targetUrl) !== normalizedRendererUrl(rendererUrl)) {
        event.preventDefault();
      }
    });
    contents.on('before-input-event', (event, input) => {
      const mod = process.platform === 'darwin' ? input.meta : input.control;
      if (
        this.tabHost &&
        input.type === 'keyDown' &&
        mod &&
        !input.alt &&
        !input.shift &&
        input.key.toLowerCase() === 'w'
      ) {
        event.preventDefault();
        this.tabHost.close();
      }
    });

    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) await contents.loadURL(rendererUrl);
      else await contents.loadFile(join(__dirname, '../renderer/coin/index.html'));
      if (signal.aborted || surface.isDestroyed()) throw new Error('[coin] startup aborted');
      return surface;
    } catch (error) {
      await this.destroy(surface);
      throw error;
    } finally {
      signal.removeEventListener('abort', abortStartup);
    }
  }

  mountTab(surface: CoinWindowSurface, host: MaestroCompositeTabHostApi): void {
    this.requireSurface(surface);
    const window = host.window();
    if (!host.isOpen() || !window || window.isDestroyed()) {
      throw new Error('[trench] Maestro tab is no longer available');
    }
    if (this.tabHost === host) return;
    this.detachView(surface);
    try {
      host.attach(surface.view);
    } catch (error) {
      this.restoreView(surface);
      throw error;
    }
    // Clear ownership before closing the old carrier; its late close event must be harmless.
    const oldWindow = this.currentWindow;
    const oldTab = this.tabHost;
    this.windowStateController?.flushAndDispose();
    this.windowStateController = null;
    this.currentWindow = null;
    this.tabHost = host;
    if (oldWindow && !oldWindow.isDestroyed()) oldWindow.destroy();
    oldTab?.close();
    this.refreshTab(host);
    surface.view.setVisible(true);
  }

  mountStandalone(surface: CoinWindowSurface): void {
    this.requireSurface(surface);
    if (this.currentWindow && !this.currentWindow.isDestroyed()) return;
    if (!windowStateService.has('coin')) {
      const legacy = new CoinWindowStateStore(app.getPath('userData')).readLegacy();
      if (legacy)
        windowStateService.importLegacy('coin', { ...legacy.bounds, maximized: legacy.maximized });
    }
    const restored = windowStateService.resolve('coin');
    const isMac = process.platform === 'darwin';
    const window = new BaseWindow({
      width: restored?.bounds.width ?? COIN_WINDOW_DEFAULT_WIDTH,
      height: restored?.bounds.height ?? COIN_WINDOW_DEFAULT_HEIGHT,
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : { center: true }),
      minWidth: COIN_WINDOW_MIN_WIDTH,
      minHeight: COIN_WINDOW_MIN_HEIGHT,
      show: false,
      title: 'BL Trench',
      titleBarStyle: isMac ? 'hidden' : 'default',
      ...(isMac ? { trafficLightPosition: { x: 12, y: 11 } } : {}),
      autoHideMenuBar: true,
      backgroundColor: '#F3F5FC'
    });
    this.detachView(surface);
    try {
      window.contentView.addChildView(surface.view);
    } catch (error) {
      window.destroy();
      this.restoreView(surface);
      throw error;
    }
    const oldTab = this.tabHost;
    this.tabHost = null;
    this.currentWindow = window;
    this.windowStateController = windowStateService.register('coin', window);
    const resize = (): void => {
      if (this.currentWindow !== window || surface.isDestroyed()) return;
      const [width, height] = window.getContentSize();
      surface.view.setBounds({ x: 0, y: 0, width, height });
    };
    window.on('resize', resize);
    window.on('closed', () => {
      if (this.currentWindow !== window) return;
      this.currentWindow = null;
      this.windowStateController = null;
      void this.destroy(surface);
    });
    oldTab?.close();
    surface.view.setVisible(true);
    resize();
  }

  setTabActive(host: MaestroCompositeTabHostApi, active: boolean): void {
    if (this.tabHost !== host || !this.currentSurface || this.currentSurface.isDestroyed()) return;
    this.currentSurface.view.setVisible(active);
    if (active) this.refreshTab(host);
  }

  refreshTab(host: MaestroCompositeTabHostApi): void {
    if (this.tabHost !== host || !this.currentSurface || this.currentSurface.isDestroyed()) return;
    const rect = host.contentRect();
    if (!rect) return;
    this.currentSurface.view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    });
  }

  closeTab(host: MaestroCompositeTabHostApi): void {
    if (this.tabHost !== host) return;
    this.tabHost = null;
    if (this.currentSurface) host.detach(this.currentSurface.view);
    void this.destroy(this.currentSurface);
  }

  showAndFocus(surface: CoinWindowSurface): void {
    this.requireSurface(surface);
    if (this.tabHost) {
      this.tabHost.activate();
      const window = this.tabHost.window();
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    } else {
      this.mountStandalone(surface);
      this.windowStateController?.show();
      this.currentWindow?.focus();
    }
    surface.webContents.focus();
  }

  async destroy(surface: CoinWindowSurface | null): Promise<void> {
    if (!surface) return;
    if (this.currentSurface === surface) this.releaseHost();
    if (!surface.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) =>
        surface.webContents.once('destroyed', resolve)
      );
      surface.webContents.close({ waitForBeforeUnload: false });
      await destroyed;
    }
    if (this.currentSurface === surface) this.currentSurface = null;
  }

  private requireSurface(surface: CoinWindowSurface): void {
    if (surface !== this.currentSurface || surface.isDestroyed()) {
      throw new Error('[trench] display surface is no longer available');
    }
  }

  private detachView(surface: CoinWindowSurface): void {
    if (this.tabHost) this.tabHost.detach(surface.view);
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.currentWindow.contentView.removeChildView(surface.view);
    }
  }

  private restoreView(surface: CoinWindowSurface): void {
    if (this.tabHost) this.tabHost.attach(surface.view);
    else this.currentWindow?.contentView.addChildView(surface.view);
  }

  private releaseHost(): void {
    if (this.currentSurface && !this.currentSurface.isDestroyed())
      this.detachView(this.currentSurface);
    const window = this.currentWindow;
    const tab = this.tabHost;
    this.windowStateController?.flushAndDispose();
    this.windowStateController = null;
    this.currentWindow = null;
    this.tabHost = null;
    if (window && !window.isDestroyed()) window.destroy();
    tab?.close();
  }

  private getRendererUrl(): string {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      return `${process.env.ELECTRON_RENDERER_URL}/coin/index.html`;
    return pathToFileURL(join(__dirname, '../renderer/coin/index.html')).href;
  }
}

export const coinWindowManager = new CoinWindowManager();
