import { app, BrowserWindow, WebContentsView } from 'electron';
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { mainWindowHelper } from '../windows/mainWindow.helper';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';
import {
  windowStateService,
  type WindowStateController,
} from '@main/windows/windowState.service';

const SIDER_WIDTH = 56;
const MENUBAR_HEIGHT = 36;
const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'todo';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');
const resolveTodoOutPath = (...segments: string[]): string =>
  join(app.getAppPath(), 'out', ...segments);

class TodoWindowHandler extends XpcMainHandler {
  private todoView: WebContentsView | null = null;
  private standaloneWindow: BrowserWindow | null = null;
  private creationPromise: Promise<BrowserWindow> | null = null;
  private resizeHandler: (() => void) | null = null;
  private windowStateController: WindowStateController | null = null;

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
        preload: resolveTodoOutPath('preload', 'todo.js'),
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
      this.todoView.webContents.loadFile(resolveTodoOutPath('renderer', 'todo', 'index.html'));
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
    if (this.creationPromise) {
      const created = await this.creationPromise;
      if (!created.isDestroyed()) {
        this.windowStateController?.show();
        created.focus();
      }
      return;
    }

    if (this.standaloneWindow && !this.standaloneWindow.isDestroyed()) {
      if (this.windowStateController) {
        this.windowStateController.show();
      } else {
        this.standaloneWindow.show();
      }
      this.standaloneWindow.focus();
      return;
    }

    this.creationPromise = this.createStandaloneWindow().finally(() => {
      this.creationPromise = null;
    });

    const created = await this.creationPromise;
    if (!created.isDestroyed()) {
      if (this.windowStateController) {
        this.windowStateController.show();
      } else {
        created.show();
      }
      created.focus();
    }
  }

  private async createStandaloneWindow(): Promise<BrowserWindow> {
    const isMac = process.platform === 'darwin';
    if (!windowStateService.has('todo')) {
      const legacyLayout = await this.loadLayout();
      if (legacyLayout) windowStateService.importLegacy('todo', legacyLayout);
    }
    const restored = windowStateService.resolve('todo');

    const windowOptions: any = {
      width: restored?.bounds.width ?? 900,
      height: restored?.bounds.height ?? 670,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Todo',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(isMac && { trafficLightPosition: { x: 12, y: 8 } }),
      webPreferences: {
        preload: resolveTodoOutPath('preload', 'todo.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: ['--mode=standalone'],
      },
    };

    if (restored) {
      windowOptions.x = restored.bounds.x;
      windowOptions.y = restored.bounds.y;
    }

    const created = new BrowserWindow(windowOptions);
    const stateController = windowStateService.register(
      'todo',
      created,
    );
    this.standaloneWindow = created;
    this.windowStateController = stateController;

    created.on('ready-to-show', () => {
      stateController.show();
    });

    created.on('closed', () => {
      if (this.standaloneWindow === created) this.standaloneWindow = null;
      if (this.windowStateController === stateController) {
        this.windowStateController = null;
      }
    });

    try {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        await created.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/todo/index.html`);
      } else {
        await created.loadFile(resolveTodoOutPath('renderer', 'todo', 'index.html'));
      }

      if (is.dev && import.meta.env.VITE_MODE !== 'release') {
        created.webContents.openDevTools({ mode: 'detach' });
      }
      return created;
    } catch (error) {
      if (!created.isDestroyed()) {
        stateController.flushAndDispose();
        created.destroy();
      }
      if (this.standaloneWindow === created) this.standaloneWindow = null;
      if (this.windowStateController === stateController) {
        this.windowStateController = null;
      }
      throw error;
    }
  }

  async minimize(): Promise<void> {
    this.standaloneWindow?.minimize();
  }

  async toggleMaximize(): Promise<void> {
    const win = this.standaloneWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  async close(): Promise<void> {
    this.standaloneWindow?.close();
  }

  async _destroyForAuth(): Promise<void> {
    const pending = this.creationPromise;
    if (pending) await pending.catch(() => undefined);
    const mainWindow = mainWindowHelper.browserWindow;

    if (this.resizeHandler && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.todoView && !this.todoView.webContents.isDestroyed()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(this.todoView);
      }
      this.todoView.webContents.close();
    }
    this.todoView = null;

    if (this.standaloneWindow && !this.standaloneWindow.isDestroyed()) {
      this.windowStateController?.flushAndDispose();
      this.standaloneWindow.destroy();
    }
    this.standaloneWindow = null;
    this.windowStateController = null;
  }

  async destroyForHostQuit(): Promise<void> {
    await this._destroyForAuth();
  }

  async isMaximized(): Promise<boolean> {
    const win = this.standaloneWindow;
    if (win && !win.isDestroyed()) {
      return win.isMaximized();
    }
    return false;
  }

  async setAlwaysOnTop(params: { enable: boolean }): Promise<void> {
    const win = this.standaloneWindow;
    if (!win || win.isDestroyed()) return;
    if (params.enable) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setAlwaysOnTop(true, 'floating');
    } else {
      win.setAlwaysOnTop(false);
      win.setVisibleOnAllWorkspaces(false);
    }
  }

  async reloadTodoData(): Promise<void> {
    if (this.standaloneWindow && !this.standaloneWindow.isDestroyed()) {
      this.standaloneWindow.webContents.reload();
    }
    if (this.todoView && !this.todoView.webContents.isDestroyed()) {
      this.todoView.webContents.reload();
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
