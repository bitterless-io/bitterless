import { BrowserWindow, WebContentsView } from 'electron';
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { mainWindowHelper } from '../windows/mainWindow.helper';
import { throttle } from 'es-toolkit';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';

const SIDER_WIDTH = 56;
const MENUBAR_HEIGHT = 36;
const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'todo';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class TodoWindowHandler extends XpcMainHandler {
  private todoView: WebContentsView | null = null;
  private standaloneWindow: BrowserWindow | null = null;
  private resizeHandler: (() => void) | null = null;
  private _throttledSaveLayoutFn: (() => void) | null = null;

  private throttledSaveLayout(): void {
    if (!this._throttledSaveLayoutFn) {
      this._throttledSaveLayoutFn = throttle(() => {
        this.saveLayout();
      }, 100, { trailing: true });
    }
    this._throttledSaveLayoutFn();
  }

  private async saveLayout(): Promise<void> {
    if (!this.standaloneWindow || this.standaloneWindow.isDestroyed()) return;
    try {
      const bounds = this.standaloneWindow.getBounds();
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
      console.log('[TodoWindowHandler] Layout saved:', layout);
    } catch (err) {
      console.error('[TodoWindowHandler] Failed to save layout:', err);
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
      console.error('[TodoWindowHandler] Failed to load layout:', err);
      return null;
    }
  }

  async showTodoView(): Promise<void> {
    const mainWindow = mainWindowHelper.browserWindow;
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (this.todoView && !this.todoView.webContents.isDestroyed()) {
      this.todoView.setVisible(true);
      this.updateBounds(mainWindow);
      return;
    }

    this.todoView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/todo.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    mainWindow.contentView.addChildView(this.todoView);
    this.updateBounds(mainWindow);

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.todoView.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/todo/index.html`);
    } else {
      this.todoView.webContents.loadFile(join(__dirname, '../renderer/todo/index.html'));
    }

    if (is.dev && import.meta.env.VITE_MODE !== 'release') {
      this.todoView.webContents.openDevTools({ mode: 'detach' });
    }

    this.resizeHandler = () => {
      if (this.todoView && !this.todoView.webContents.isDestroyed() && mainWindow && !mainWindow.isDestroyed()) {
        this.updateBounds(mainWindow);
      }
    };
    mainWindow.on('resize', this.resizeHandler);
  }

  async hideTodoView(): Promise<void> {
    const mainWindow = mainWindowHelper.browserWindow;

    if (this.todoView && !this.todoView.webContents.isDestroyed()) {
      this.todoView.setVisible(false);
    }

    if (this.resizeHandler && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  async openTodoWindow(): Promise<void> {
    if (this.standaloneWindow && !this.standaloneWindow.isDestroyed()) {
      this.standaloneWindow.focus();
      return;
    }

    const isMac = process.platform === 'darwin';
    const savedLayout = await this.loadLayout();

    const windowOptions: any = {
      width: savedLayout?.width ?? 900,
      height: savedLayout?.height ?? 670,
      title: 'Todo',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(isMac && { trafficLightPosition: { x: 12, y: 8 } }),
      webPreferences: {
        preload: join(__dirname, '../preload/todo.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: ['--mode=standalone'],
      },
    };

    if (savedLayout) {
      windowOptions.x = savedLayout.x;
      windowOptions.y = savedLayout.y;
    }

    this.standaloneWindow = new BrowserWindow(windowOptions);

    this.standaloneWindow.on('ready-to-show', () => {
      this.standaloneWindow?.show();
    });

    this.standaloneWindow.on('move', () => {
      this.throttledSaveLayout();
    });

    this.standaloneWindow.on('resize', () => {
      this.throttledSaveLayout();
    });

    this.standaloneWindow.on('closed', () => {
      this.standaloneWindow = null;
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await this.standaloneWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/todo/index.html`);
    } else {
      await this.standaloneWindow.loadFile(join(__dirname, '../renderer/todo/index.html'));
    }

    const windowId = this.standaloneWindow.id;
    await this.standaloneWindow.webContents.executeJavaScript(`window.__WINDOW_ID__ = ${windowId};`);

    if (is.dev && import.meta.env.VITE_MODE !== 'release') {
      this.standaloneWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  private updateBounds(mainWindow: BrowserWindow): void {
    if (!this.todoView || this.todoView.webContents.isDestroyed()) return;
    const [contentWidth, contentHeight] = mainWindow.getContentSize();
    this.todoView.setBounds({
      x: SIDER_WIDTH,
      y: MENUBAR_HEIGHT,
      width: Math.max(contentWidth - SIDER_WIDTH, 0),
      height: Math.max(contentHeight - MENUBAR_HEIGHT, 0),
    });
  }
}

export const todoWindowHandler = new TodoWindowHandler();
export type { TodoWindowHandler };
