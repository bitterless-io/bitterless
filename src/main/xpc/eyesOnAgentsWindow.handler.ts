import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { is } from '@electron-toolkit/utils';
import { throttle } from 'es-toolkit';
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';
import { join } from 'path';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';
import type { EyesOnAgentsWindowApi } from '@shared/eyesOnAgents/eyesOnAgentsWindow.type';

const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'eyes-on-agents';
const WINDOW_PREFERENCES_KEY = 'window_preferences';
const WINDOW_PREFERENCES_SUB_KEY = 'eyes-on-agents';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

interface EyesOnAgentsWindowPreferences {
  alwaysOnTop: boolean;
}

const resolveEyesOnAgentsOutPath = (...segments: string[]): string =>
  join(app.getAppPath(), 'out', ...segments);

class EyesOnAgentsWindowHandler extends XpcMainHandler implements EyesOnAgentsWindowApi {
  private window: BrowserWindow | null = null;
  private creationPromise: Promise<BrowserWindow> | null = null;
  private readonly saveLayoutThrottled = throttle(
    () => void this.saveLayout(),
    100,
    { trailing: true },
  );

  async openEyesOnAgentsWindow(): Promise<void> {
    const current = this.window;
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
      return;
    }

    if (!this.creationPromise) {
      this.creationPromise = this.createWindow().finally(() => {
        this.creationPromise = null;
      });
    }

    const created = await this.creationPromise;
    if (!created.isDestroyed()) {
      created.show();
      created.focus();
    }
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

  async isMaximized(): Promise<boolean> {
    const current = this.window;
    return Boolean(current && !current.isDestroyed() && current.isMaximized());
  }

  async getAlwaysOnTop(): Promise<boolean> {
    const preferences = await this.loadPreferences();
    return preferences.alwaysOnTop;
  }

  async setAlwaysOnTop(params: { enable: boolean }): Promise<void> {
    const current = this.window;
    if (current && !current.isDestroyed()) {
      current.setAlwaysOnTop(params.enable, params.enable ? 'floating' : 'normal');
      current.setVisibleOnAllWorkspaces(params.enable, {
        visibleOnFullScreen: params.enable,
      });
    }
    await settingEmitter.upsert({
      key: WINDOW_PREFERENCES_KEY,
      sub_key: WINDOW_PREFERENCES_SUB_KEY,
      value: { alwaysOnTop: params.enable } satisfies EyesOnAgentsWindowPreferences,
    });
  }

  async _destroyForAuth(): Promise<void> {
    const pending = this.creationPromise;
    if (pending) {
      await pending.catch(() => undefined);
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }

  async destroyForHostQuit(): Promise<void> {
    await this._destroyForAuth();
  }

  private async createWindow(): Promise<BrowserWindow> {
    const [savedLayout, preferences] = await Promise.all([
      this.loadLayout(),
      this.loadPreferences(),
    ]);
    const isMac = process.platform === 'darwin';
    const options: BrowserWindowConstructorOptions = {
      width: savedLayout?.width ?? 1120,
      height: savedLayout?.height ?? 720,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'EyesOnAgents',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(isMac && { trafficLightPosition: { x: 12, y: 8 } }),
      webPreferences: {
        preload: resolveEyesOnAgentsOutPath('preload', 'eyesOnAgents.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    };

    if (savedLayout) {
      options.x = savedLayout.x;
      options.y = savedLayout.y;
    }

    const created = new BrowserWindow(options);
    this.window = created;
    created.setAlwaysOnTop(preferences.alwaysOnTop, preferences.alwaysOnTop ? 'floating' : 'normal');
    if (preferences.alwaysOnTop) {
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    created.on('move', this.saveLayoutThrottled);
    created.on('resize', this.saveLayoutThrottled);
    created.once('closed', () => {
      if (this.window === created) this.window = null;
    });

    try {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        await created.loadURL(
          `${process.env['ELECTRON_RENDERER_URL']}/eyesOnAgents/index.html`,
        );
      } else {
        await created.loadFile(
          resolveEyesOnAgentsOutPath('renderer', 'eyesOnAgents', 'index.html'),
        );
      }

      if (is.dev && import.meta.env.VITE_MODE !== 'release') {
        created.webContents.openDevTools({ mode: 'detach' });
      }
      return created;
    } catch (error) {
      if (!created.isDestroyed()) created.destroy();
      if (this.window === created) this.window = null;
      throw error;
    }
  }

  private async saveLayout(): Promise<void> {
    const current = this.window;
    if (!current || current.isDestroyed() || current.isMaximized()) return;
    const bounds = current.getBounds();
    const layout: WindowLayout = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    await settingEmitter.upsert({
      key: WINDOW_LAYOUT_KEY,
      sub_key: WINDOW_LAYOUT_SUB_KEY,
      value: layout,
    }).catch((error) => {
      console.error('[EyesOnAgentsWindowHandler] Failed to save layout:', error);
    });
  }

  private async loadLayout(): Promise<WindowLayout | null> {
    return await settingEmitter.get<WindowLayout>({
      key: WINDOW_LAYOUT_KEY,
      sub_key: WINDOW_LAYOUT_SUB_KEY,
    }).catch((error) => {
      console.error('[EyesOnAgentsWindowHandler] Failed to load layout:', error);
      return null;
    });
  }

  private async loadPreferences(): Promise<EyesOnAgentsWindowPreferences> {
    const preferences = await settingEmitter.get<EyesOnAgentsWindowPreferences>({
      key: WINDOW_PREFERENCES_KEY,
      sub_key: WINDOW_PREFERENCES_SUB_KEY,
    }).catch((error) => {
      console.error('[EyesOnAgentsWindowHandler] Failed to load preferences:', error);
      return null;
    });
    return { alwaysOnTop: preferences?.alwaysOnTop === true };
  }
}

export const eyesOnAgentsWindowHandler = new EyesOnAgentsWindowHandler();
export type { EyesOnAgentsWindowHandler };
