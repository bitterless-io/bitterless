import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';
import { debounce } from 'es-toolkit';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';

const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'main';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class MainWindowHelper extends WindowHelper {
  protected preloadFile = 'home.js';
  protected rendererPath = 'home/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'BitterLess',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#F3F5FC',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 8 } }
      : { frame: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  };
  private _debouncedSaveLayoutFn: (() => void) | null = null;

  private debouncedSaveLayout(): void {
    if (!this._debouncedSaveLayoutFn) {
      this._debouncedSaveLayoutFn = debounce(() => {
        void this.saveLayout();
      }, 300);
    }
    this._debouncedSaveLayoutFn();
  }

  private async saveLayout(): Promise<void> {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    try {
      const bounds = this.browserWindow.getBounds();
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
      });
      console.log('[MainWindowHelper] Layout saved:', layout);
    } catch (err) {
      console.error('[MainWindowHelper] Failed to save layout:', err);
    }
  }

  private async loadLayout(): Promise<WindowLayout | null> {
    try {
      const layout = await settingEmitter.get<WindowLayout>({
        key: WINDOW_LAYOUT_KEY,
        sub_key: WINDOW_LAYOUT_SUB_KEY,
      });
      return layout;
    } catch (err) {
      console.error('[MainWindowHelper] Failed to load layout:', err);
      return null;
    }
  }

  async create(): Promise<any> {
    const savedLayout = await this.loadLayout();
    if (savedLayout) {
      this.windowOptions = {
        ...this.windowOptions,
        x: savedLayout.x,
        y: savedLayout.y,
        width: savedLayout.width,
        height: savedLayout.height,
      };
    }

    const window = super.create();

    window.on('move', () => {
      this.debouncedSaveLayout();
    });

    window.on('resize', () => {
      this.debouncedSaveLayout();
    });

    return window;
  }
}

export const mainWindowHelper = new MainWindowHelper();
