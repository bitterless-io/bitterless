import { BrowserWindow } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import {
  windowStateService,
  type WindowStateController,
} from '@main/windows/windowState.service';

class PluginTestHandler extends XpcMainHandler {
  private contentWindow: BrowserWindow | null = null;
  private optionWindow: BrowserWindow | null = null;
  private contentWindowState: WindowStateController | null = null;
  private optionWindowState: WindowStateController | null = null;

  async openContentWindow(params: { url: string }): Promise<void> {
    if (this.contentWindow && !this.contentWindow.isDestroyed()) {
      if (this.contentWindow.webContents.isLoading()) return;
      if (this.contentWindowState) {
        this.contentWindowState.show();
      } else {
        this.contentWindow.show();
      }
      this.contentWindow.focus();
      return;
    }

    const restored = windowStateService.resolve('plugin-content');
    this.contentWindow = new BrowserWindow({
      width: restored?.bounds.width ?? 800,
      height: restored?.bounds.height ?? 600,
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Plugin Content',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true,
      },
    });
    this.contentWindowState = windowStateService.register(
      'plugin-content',
      this.contentWindow,
    );

    this.contentWindow.on('ready-to-show', () => {
      if (this.contentWindowState) {
        this.contentWindowState.show();
      } else {
        this.contentWindow?.show();
      }
      if (import.meta.env.VITE_MODE !== 'release') {
        this.contentWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    });

    this.contentWindow.on('closed', () => {
      this.contentWindow = null;
      this.contentWindowState = null;
    });

    await this.contentWindow.loadURL(params.url);
  }

  async openOptionWindow(params: { url: string }): Promise<void> {
    if (this.optionWindow && !this.optionWindow.isDestroyed()) {
      if (this.optionWindow.webContents.isLoading()) return;
      if (this.optionWindowState) {
        this.optionWindowState.show();
      } else {
        this.optionWindow.show();
      }
      this.optionWindow.focus();
      return;
    }

    const restored = windowStateService.resolve('plugin-options');
    this.optionWindow = new BrowserWindow({
      width: restored?.bounds.width ?? 800,
      height: restored?.bounds.height ?? 600,
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Plugin Options',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true,
      },
    });
    this.optionWindowState = windowStateService.register(
      'plugin-options',
      this.optionWindow,
    );

    this.optionWindow.on('ready-to-show', () => {
      if (this.optionWindowState) {
        this.optionWindowState.show();
      } else {
        this.optionWindow?.show();
      }
      if (import.meta.env.VITE_MODE !== 'release') {
        this.optionWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    });

    this.optionWindow.on('closed', () => {
      this.optionWindow = null;
      this.optionWindowState = null;
    });

    await this.optionWindow.loadURL(params.url);
  }

  async _destroyForAuth(): Promise<void> {
    if (this.contentWindow && !this.contentWindow.isDestroyed()) {
      this.contentWindowState?.flushAndDispose();
      this.contentWindow.destroy();
    }
    this.contentWindow = null;
    this.contentWindowState = null;

    if (this.optionWindow && !this.optionWindow.isDestroyed()) {
      this.optionWindowState?.flushAndDispose();
      this.optionWindow.destroy();
    }
    this.optionWindow = null;
    this.optionWindowState = null;
  }

  async destroyForHostQuit(): Promise<void> {
    await this._destroyForAuth();
  }
}

export const pluginTestHandler = new PluginTestHandler();
export type { PluginTestHandler };
