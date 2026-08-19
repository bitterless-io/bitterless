import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { is } from '@electron-toolkit/utils';
import { XpcMainHandler } from 'electron-xpc/main';
import { join } from 'path';
import type { SubmodulesWindowApi } from '@shared/submodules/submodules.type';
import { windowStateService, type WindowStateController } from '@main/windows/windowState.service';

const WINDOW_STATE_KEY = 'submodules';

const resolveSubmodulesOutPath = (...segments: string[]): string =>
  join(app.getAppPath(), 'out', ...segments);

class SubmodulesWindowHandler extends XpcMainHandler implements SubmodulesWindowApi {
  private window: BrowserWindow | null = null;
  private creationPromise: Promise<BrowserWindow> | null = null;
  private windowStateController: WindowStateController | null = null;

  async openSubmodulesWindow(): Promise<void> {
    const current = this.window;
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore();
      if (this.windowStateController) {
        this.windowStateController.show();
      } else {
        current.show();
      }
      current.focus();
      return;
    }

    if (!this.creationPromise) {
      this.creationPromise = this.createWindow().finally(() => {
        this.creationPromise = null;
      });
    }

    const created = await this.creationPromise;
    if (created.isDestroyed()) return;
    if (this.windowStateController) {
      this.windowStateController.show();
    } else {
      created.show();
    }
    created.focus();
  }

  async minimize(): Promise<void> {
    this.window?.minimize();
  }

  async toggleMaximize(): Promise<void> {
    const current = this.window;
    if (!current || current.isDestroyed()) return;
    if (current.isMaximized()) {
      current.unmaximize();
    } else {
      current.maximize();
    }
  }

  async close(): Promise<void> {
    this.window?.close();
  }

  /** `_` prefix keeps this out of XPC registration: Main-internal liveness query, not a channel. */
  _hasLiveWindow(): boolean {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  async _destroyForAuth(): Promise<void> {
    const pending = this.creationPromise;
    if (pending) await pending.catch(() => undefined);
    if (this.window && !this.window.isDestroyed()) {
      this.windowStateController?.flushAndDispose();
      this.window.destroy();
    }
    this.window = null;
    this.windowStateController = null;
  }

  async destroyForHostQuit(): Promise<void> {
    await this._destroyForAuth();
  }

  private async createWindow(): Promise<BrowserWindow> {
    const restored = windowStateService.resolve(WINDOW_STATE_KEY);
    const isMac = process.platform === 'darwin';
    const options: BrowserWindowConstructorOptions = {
      width: restored?.bounds.width ?? 900,
      height: restored?.bounds.height ?? 700,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Submodules',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(isMac && { trafficLightPosition: { x: 12, y: 8 } }),
      webPreferences: {
        preload: resolveSubmodulesOutPath('preload', 'submodules.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    };

    if (restored) {
      options.x = restored.bounds.x;
      options.y = restored.bounds.y;
    }

    const created = new BrowserWindow(options);
    this.window = created;
    this.windowStateController = windowStateService.register(WINDOW_STATE_KEY, created);

    created.once('closed', () => {
      if (this.window === created) {
        this.window = null;
        this.windowStateController = null;
      }
    });

    try {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        await created.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/submodules/index.html`);
      } else {
        await created.loadFile(resolveSubmodulesOutPath('renderer', 'submodules', 'index.html'));
      }

      if (is.dev && import.meta.env.VITE_MODE !== 'release') {
        created.webContents.openDevTools({ mode: 'detach' });
      }
      return created;
    } catch (error) {
      if (!created.isDestroyed()) {
        this.windowStateController?.flushAndDispose();
        created.destroy();
      }
      if (this.window === created) {
        this.window = null;
        this.windowStateController = null;
      }
      throw error;
    }
  }
}

export const submodulesWindowHandler = new SubmodulesWindowHandler();
export type { SubmodulesWindowHandler };
