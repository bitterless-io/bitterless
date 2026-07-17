import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';
import { debounce } from 'es-toolkit';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';

const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'main';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

interface MainWindowCreateOptions {
  canCreate?: () => boolean;
}

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
  private _layoutPersistenceReady = false;
  private _hasLocalLayoutChange = false;
  private _isApplyingPersistedLayout = false;

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
    return await settingEmitter.get<WindowLayout>({
      key: WINDOW_LAYOUT_KEY,
      sub_key: WINDOW_LAYOUT_SUB_KEY,
    });
  }

  create({
    canCreate = () => true,
  }: MainWindowCreateOptions = {}): BrowserWindow | null {
    if (!canCreate()) return null;

    this._layoutPersistenceReady = false;
    this._hasLocalLayoutChange = false;
    this._isApplyingPersistedLayout = false;
    const window = super.create();

    window.on('move', () => {
      this.handleLayoutChange();
    });

    window.on('resize', () => {
      this.handleLayoutChange();
    });

    return window;
  }

  async hydratePersistedLayout(): Promise<void> {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) return;

    const savedLayout = await this.loadLayout();
    if (this.browserWindow !== window || window.isDestroyed()) return;

    if (savedLayout && !this._hasLocalLayoutChange) {
      this._isApplyingPersistedLayout = true;
      try {
        window.setBounds(savedLayout);
      } finally {
        this._isApplyingPersistedLayout = false;
      }
    }

    this._layoutPersistenceReady = true;
    if (this._hasLocalLayoutChange) this.debouncedSaveLayout();
  }

  private handleLayoutChange(): void {
    if (this._isApplyingPersistedLayout) return;
    this._hasLocalLayoutChange = true;
    if (this._layoutPersistenceReady) this.debouncedSaveLayout();
  }
}

export const mainWindowHelper = new MainWindowHelper();
