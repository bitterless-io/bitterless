import { app, BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { is } from '@electron-toolkit/utils';
import { WindowHelper } from './window.helper';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';
import {
  createSnipingRendererTargets,
  matchesSnipingRendererTarget,
} from '@main/sniping/snipingSender.guard';

const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'main';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

interface MainWindowCreateOptions {
  canCreate?: () => boolean;
}

class MainWindowHelper extends WindowHelper {
  protected preloadFile = 'home.js';
  protected rendererPath = 'home/index.html';
  protected showOnReady = false;
  protected windowStateKey = 'main' as const;
  protected deferInitialWindowStateSave = true;
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'BitterLess',
    skipTaskbar: true,
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
    const expectedHomeUrl = createSnipingRendererTargets(
      app.getAppPath(),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    ).home;
    return super.create((window) => {
      window.on('show', () => {
        if (!window.isDestroyed()) window.hide();
      });
      const fenceNavigation = (event: Electron.Event, targetUrl: string): void => {
        if (!matchesSnipingRendererTarget(targetUrl, expectedHomeUrl)) event.preventDefault();
      };
      window.webContents.on('will-navigate', fenceNavigation);
      window.webContents.on('will-redirect', fenceNavigation);
    });
  }

  override show(): void {
    this.hide();
  }

  async hydratePersistedLayout(): Promise<void> {
    if (!this.hasPersistedWindowState()) {
      const savedLayout = await this.loadLayout();
      if (savedLayout) this.importLegacyWindowState(savedLayout);
    }
    this.enableWindowStatePersistence();
  }
}

export const mainWindowHelper = new MainWindowHelper();
