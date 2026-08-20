import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { is } from '@electron-toolkit/utils';
import { XpcMainHandler } from 'electron-xpc/main';
import { join } from 'path';
import type { SubmodulesWindowApi } from '@shared/submodules/submodules.type';
import { windowStateService, type WindowStateController } from '@main/windows/windowState.service';

const WINDOW_STATE_KEY = 'submodules';

/**
 * Documented exception to the 800px house minimum (owner decision 2026-08-20): the two-line row list
 * works as a narrow side panel, exactly like the EyesOnAgents window. Passed to the window-state
 * service too, or a restored narrow width would be clamped back to the 800px default.
 */
const SUBMODULES_MIN_WIDTH = 480;
const SUBMODULES_MIN_HEIGHT = 600;
const WINDOW_STATE_OPTIONS = {
  minWidth: SUBMODULES_MIN_WIDTH,
  minHeight: SUBMODULES_MIN_HEIGHT
} as const;

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
      this.openDebugDevTools();
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
    this.openDebugDevTools();
  }

  /**
   * Debug-only DevTools, opened after the window is shown and focused. Opening it during creation
   * put the detached DevTools window behind the window that `focus()` then raised, so it looked like
   * DevTools never opened at all. The gate is the project-wide debug gate (`VITE_MODE`, never
   * `is.dev`) and stays out of E2E runs so a test never fights a DevTools window for focus.
   */
  private openDebugDevTools(): void {
    if (import.meta.env.VITE_MODE !== 'debug' || process.env.BITTERLESS_E2E === '1') return;
    const current = this.window;
    if (!current || current.isDestroyed()) return;
    const { webContents } = current;
    if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return;
    webContents.openDevTools({ mode: 'detach' });
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
    const restored = windowStateService.resolve(WINDOW_STATE_KEY, WINDOW_STATE_OPTIONS);
    const isMac = process.platform === 'darwin';
    const options: BrowserWindowConstructorOptions = {
      width: restored?.bounds.width ?? 900,
      height: restored?.bounds.height ?? 700,
      minWidth: SUBMODULES_MIN_WIDTH,
      minHeight: SUBMODULES_MIN_HEIGHT,
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
    this.windowStateController = windowStateService.register(
      WINDOW_STATE_KEY,
      created,
      WINDOW_STATE_OPTIONS
    );

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
