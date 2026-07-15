import { app, BrowserWindow, screen, type Display } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { COIN_IPC_CHANNELS } from '@shared/coin/coinBridge.type';
import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';
import {
  COIN_WINDOW_DEFAULT_HEIGHT,
  COIN_WINDOW_DEFAULT_WIDTH,
  COIN_WINDOW_MIN_HEIGHT,
  COIN_WINDOW_MIN_WIDTH,
  CoinWindowStateStore,
  type CoinDisplayBounds,
  type CoinPersistedWindowState,
} from './coinWindowState';

const GEOMETRY_SAVE_DELAY_MS = 250;

const displayWorkAreas = (displays: Display[]): CoinDisplayBounds[] =>
  displays.map(({ workArea }) => ({ ...workArea }));

const normalizedRendererUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  return url.href;
};

class CoinWindowManager {
  private currentWindow: BrowserWindow | null = null;
  private stateStore: CoinWindowStateStore | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private closeCleanup: (() => void) | null = null;

  get browserWindow(): BrowserWindow | null {
    return this.currentWindow;
  }

  isDestroyed(window: BrowserWindow): boolean {
    return window.isDestroyed();
  }

  setCloseCleanup(cleanup: () => void): void {
    this.closeCleanup = cleanup;
  }

  async create(signal: AbortSignal): Promise<BrowserWindow> {
    const existing = this.currentWindow;
    if (existing && !existing.isDestroyed()) return existing;
    if (signal.aborted) throw new Error('[coin] startup aborted');

    this.stateStore = new CoinWindowStateStore(app.getPath('userData'));
    const saved = this.stateStore.read(displayWorkAreas(screen.getAllDisplays()));
    const rendererUrl = this.getRendererUrl();
    const isMac = process.platform === 'darwin';
    const window = new BrowserWindow({
      width: saved?.bounds.width ?? COIN_WINDOW_DEFAULT_WIDTH,
      height: saved?.bounds.height ?? COIN_WINDOW_DEFAULT_HEIGHT,
      ...(saved ? { x: saved.bounds.x, y: saved.bounds.y } : { center: true }),
      minWidth: COIN_WINDOW_MIN_WIDTH,
      minHeight: COIN_WINDOW_MIN_HEIGHT,
      show: false,
      title: 'Coin',
      titleBarStyle: 'hidden',
      ...(isMac ? { trafficLightPosition: { x: 12, y: 11 } } : {}),
      autoHideMenuBar: true,
      backgroundColor: '#F3F5FC',
      webPreferences: {
        preload: join(__dirname, '../preload/coin.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    this.currentWindow = window;

    const abortStartup = (): void => {
      if (!window.isDestroyed()) window.destroy();
    };
    signal.addEventListener('abort', abortStartup, { once: true });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (normalizedRendererUrl(targetUrl) !== normalizedRendererUrl(rendererUrl)) {
        event.preventDefault();
      }
    });

    const scheduleGeometrySave = (): void => this.scheduleGeometrySave(window);
    window.on('move', scheduleGeometrySave);
    window.on('resize', scheduleGeometrySave);
    window.on('maximize', scheduleGeometrySave);
    window.on('unmaximize', scheduleGeometrySave);
    window.on('close', () => {
      this.closeCleanup?.();
      this.flushGeometry(window);
    });
    window.on('closed', () => {
      this.closeCleanup?.();
      signal.removeEventListener('abort', abortStartup);
      this.clearSaveTimer();
      if (this.currentWindow === window) this.currentWindow = null;
    });

    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        await window.loadURL(rendererUrl);
      } else {
        await window.loadFile(join(__dirname, '../renderer/coin/index.html'));
      }
      if (signal.aborted || window.isDestroyed()) throw new Error('[coin] startup aborted');
      if (saved?.maximized) window.maximize();
      return window;
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  showAndFocus(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  async destroy(window: BrowserWindow | null): Promise<void> {
    if (!window || window.isDestroyed()) {
      if (this.currentWindow === window) this.currentWindow = null;
      return;
    }
    this.flushGeometry(window);
    window.destroy();
    if (this.currentWindow === window) this.currentWindow = null;
  }

  sendLanguageSnapshot(snapshot: ApplicationLanguageSnapshot): void {
    const window = this.currentWindow;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(COIN_IPC_CHANNELS.languageChanged, snapshot);
  }

  private getRendererUrl(): string {
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      return `${process.env.ELECTRON_RENDERER_URL}/coin/index.html`;
    }
    return pathToFileURL(join(__dirname, '../renderer/coin/index.html')).href;
  }

  private scheduleGeometrySave(window: BrowserWindow): void {
    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushGeometry(window);
    }, GEOMETRY_SAVE_DELAY_MS);
  }

  private clearSaveTimer(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private flushGeometry(window: BrowserWindow): void {
    this.clearSaveTimer();
    if (!this.stateStore || window.isDestroyed()) return;
    const state: CoinPersistedWindowState = {
      version: 1,
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    };
    this.stateStore.save(state, displayWorkAreas(screen.getAllDisplays()));
  }
}

export const coinWindowManager = new CoinWindowManager();
