import { BrowserWindow, BrowserWindowConstructorOptions, shell, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import {
  windowStateService,
  type WindowStateController,
} from './windowState.service';
import type { WindowStateKey } from '@shared/window/window.types';

export abstract class WindowHelper {
  browserWindow: BrowserWindow | null = null;
  private isQuitting = false;

  protected abstract preloadFile: string;
  protected abstract rendererPath: string;
  protected abstract windowOptions: Partial<BrowserWindowConstructorOptions>;
  protected showOnReady = true;
  protected windowStateKey: WindowStateKey | null = null;
  protected deferInitialWindowStateSave = false;
  protected windowStateController: WindowStateController | null = null;

  create(onCreated?: (window: BrowserWindow) => void): BrowserWindow {
    this.isQuitting = false;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    const windowWidth = Math.floor(screenWidth / 2);
    const windowHeight = Math.floor(screenHeight / 2);
    const x = 0;
    const y = screenHeight - windowHeight;
    const restored = this.windowStateKey
      ? windowStateService.resolve(this.windowStateKey, {
          minWidth: this.windowOptions.minWidth,
          minHeight: this.windowOptions.minHeight,
        })
      : null;

    const options: BrowserWindowConstructorOptions = {
      show: false,
      autoHideMenuBar: true,
      width: windowWidth,
      height: windowHeight,
      x: x,
      y: y,
      ...this.windowOptions,
      ...(restored?.bounds ?? {}),
      webPreferences: {
        preload: join(__dirname, `../preload/${this.preloadFile}`),
        sandbox: false,
        ...this.windowOptions.webPreferences,
      },
    };

    this.browserWindow = new BrowserWindow(options);
    this.windowStateController = this.windowStateKey
      ? windowStateService.register(this.windowStateKey, this.browserWindow, {
          minWidth: this.windowOptions.minWidth,
          minHeight: this.windowOptions.minHeight,
          deferInitialSave: this.deferInitialWindowStateSave,
        })
      : null;
    onCreated?.(this.browserWindow);

    this.browserWindow.on('ready-to-show', () => {
      if (this.showOnReady) {
        if (this.windowStateController) {
          this.windowStateController.show();
        } else {
          this.browserWindow?.show();
        }
      }
      const shouldOpenDevTools =
        process.env.BITTERLESS_E2E !== '1' && import.meta.env.VITE_MODE === 'debug';
      if (shouldOpenDevTools) {
        this.browserWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    });

    this.browserWindow.on('close', (event) => {
      if (this.browserWindow && !this.browserWindow.isDestroyed() && !this.isQuitting) {
        event.preventDefault();
        this.browserWindow.hide();
      }
    });

    this.browserWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${this.rendererPath}`);
    } else {
      this.browserWindow.loadFile(join(__dirname, `../renderer/${this.rendererPath}`));
    }

    return this.browserWindow;
  }

  show(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (this.windowStateController) {
        this.windowStateController.show();
        this.browserWindow.focus();
        return;
      }
      if (this.browserWindow.isMinimized()) {
        this.browserWindow.restore();
      }
      this.browserWindow.show();
      this.browserWindow.focus();
    }
  }

  hide(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.hide();
    }
  }

  destroy(): void {
    this.isQuitting = true;
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.windowStateController?.flushAndDispose();
      this.browserWindow.destroy();
    }
    this.browserWindow = null;
    this.windowStateController = null;
  }

  protected importLegacyWindowState(value: unknown): boolean {
    return this.windowStateController?.importLegacy(value) ?? false;
  }

  protected hasPersistedWindowState(): boolean {
    return this.windowStateKey ? windowStateService.has(this.windowStateKey) : false;
  }

  protected enableWindowStatePersistence(): void {
    this.windowStateController?.enablePersistence();
  }
}
