import { app, BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  COIN_WINDOW_DEFAULT_HEIGHT,
  COIN_WINDOW_DEFAULT_WIDTH,
  COIN_WINDOW_MIN_HEIGHT,
  COIN_WINDOW_MIN_WIDTH,
  CoinWindowStateStore,
} from './coinWindowState';
import {
  windowStateService,
  type WindowStateController,
} from '@main/windows/windowState.service';

const normalizedRendererUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  return url.href;
};

class CoinWindowManager {
  private currentWindow: BrowserWindow | null = null;
  private windowStateController: WindowStateController | null = null;

  get browserWindow(): BrowserWindow | null {
    return this.currentWindow;
  }

  isDestroyed(window: BrowserWindow): boolean {
    return window.isDestroyed();
  }

  async create(signal: AbortSignal): Promise<BrowserWindow> {
    const existing = this.currentWindow;
    if (existing && !existing.isDestroyed()) return existing;
    if (signal.aborted) throw new Error('[coin] startup aborted');

    if (!windowStateService.has('coin')) {
      const legacy = new CoinWindowStateStore(app.getPath('userData')).readLegacy();
      if (legacy) {
        windowStateService.importLegacy('coin', {
          ...legacy.bounds,
          maximized: legacy.maximized,
        });
      }
    }
    const restored = windowStateService.resolve('coin');
    const rendererUrl = this.getRendererUrl();
    const isMac = process.platform === 'darwin';
    const window = new BrowserWindow({
      width: restored?.bounds.width ?? COIN_WINDOW_DEFAULT_WIDTH,
      height: restored?.bounds.height ?? COIN_WINDOW_DEFAULT_HEIGHT,
      ...(restored
        ? { x: restored.bounds.x, y: restored.bounds.y }
        : { center: true }),
      minWidth: COIN_WINDOW_MIN_WIDTH,
      minHeight: COIN_WINDOW_MIN_HEIGHT,
      show: false,
      title: 'BL Trench',
      titleBarStyle: isMac ? 'hidden' : 'default',
      ...(isMac ? { trafficLightPosition: { x: 12, y: 11 } } : {}),
      autoHideMenuBar: true,
      backgroundColor: '#F3F5FC',
      webPreferences: {
        preload: join(__dirname, '../preload/trench.js'),
        additionalArguments: ['--mode=standalone'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    this.currentWindow = window;
    this.windowStateController = windowStateService.register('coin', window);

    const abortStartup = (): void => {
      if (!window.isDestroyed()) {
        this.windowStateController?.flushAndDispose();
        window.destroy();
      }
    };
    signal.addEventListener('abort', abortStartup, { once: true });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (normalizedRendererUrl(targetUrl) !== normalizedRendererUrl(rendererUrl)) {
        event.preventDefault();
      }
    });

    window.on('closed', () => {
      signal.removeEventListener('abort', abortStartup);
      if (this.currentWindow === window) {
        this.currentWindow = null;
        this.windowStateController = null;
      }
    });

    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        await window.loadURL(rendererUrl);
      } else {
        await window.loadFile(join(__dirname, '../renderer/coin/index.html'));
      }
      if (signal.aborted || window.isDestroyed()) throw new Error('[coin] startup aborted');
      return window;
    } catch (error) {
      if (!window.isDestroyed()) {
        this.windowStateController?.flushAndDispose();
        window.destroy();
      }
      throw error;
    }
  }

  showAndFocus(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    if (this.windowStateController) {
      this.windowStateController.show();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
    }
    window.focus();
  }

  async destroy(window: BrowserWindow | null): Promise<void> {
    if (!window || window.isDestroyed()) {
      if (this.currentWindow === window) this.currentWindow = null;
      return;
    }
    this.windowStateController?.flushAndDispose();
    window.destroy();
    if (this.currentWindow === window) {
      this.currentWindow = null;
      this.windowStateController = null;
    }
  }

  private getRendererUrl(): string {
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      return `${process.env.ELECTRON_RENDERER_URL}/coin/index.html`;
    }
    return pathToFileURL(join(__dirname, '../renderer/coin/index.html')).href;
  }

}

export const coinWindowManager = new CoinWindowManager();
