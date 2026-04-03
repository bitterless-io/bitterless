import { BrowserWindow } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';

class PluginTestHandler extends XpcMainHandler {
  private contentWindow: BrowserWindow | null = null;
  private optionWindow: BrowserWindow | null = null;

  async openContentWindow(params: { url: string }): Promise<void> {
    if (this.contentWindow && !this.contentWindow.isDestroyed()) {
      this.contentWindow.focus();
      return;
    }

    this.contentWindow = new BrowserWindow({
      width: 800,
      height: 600,
      title: 'Plugin Content',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true,
      },
    });

    this.contentWindow.on('ready-to-show', () => {
      this.contentWindow?.show();
      if (import.meta.env.VITE_MODE !== 'release') {
        this.contentWindow?.webContents.openDevTools();
      }
    });

    this.contentWindow.on('closed', () => {
      this.contentWindow = null;
    });

    await this.contentWindow.loadURL(params.url);
  }

  async openOptionWindow(params: { url: string }): Promise<void> {
    if (this.optionWindow && !this.optionWindow.isDestroyed()) {
      this.optionWindow.focus();
      return;
    }

    this.optionWindow = new BrowserWindow({
      width: 800,
      height: 600,
      title: 'Plugin Options',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true,
      },
    });

    this.optionWindow.on('ready-to-show', () => {
      this.optionWindow?.show();
      if (import.meta.env.VITE_MODE !== 'release') {
        this.optionWindow?.webContents.openDevTools();
      }
    });

    this.optionWindow.on('closed', () => {
      this.optionWindow = null;
    });

    await this.optionWindow.loadURL(params.url);
  }
}

export const pluginTestHandler = new PluginTestHandler();
export type { PluginTestHandler };
