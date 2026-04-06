import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { MainWindowHandler } from '@main/xpc/mainWindow.handler';
import { homeEnv } from '@/contextBridge/homeEnv.bridge';

const mainWindowEmitter = createXpcRendererEmitter<MainWindowHandler>('MainWindowHandler');

class MenuBarState {
  isWindows: boolean = homeEnv.platform === 'win32';
  isMac: boolean = homeEnv.platform === 'darwin';
  maximized: boolean = false;

  async init(): Promise<void> {
    if (!this.isWindows) return;
    this.maximized = await mainWindowEmitter.isMaximized();
  }

  async minimize(): Promise<void> {
    await mainWindowEmitter.minimize();
  }

  async toggleMaximize(): Promise<void> {
    await mainWindowEmitter.toggleMaximize();
    this.maximized = !this.maximized;
  }

  async close(): Promise<void> {
    await mainWindowEmitter.close();
  }
}

export const menuBarStore = reactive<MenuBarState>(new MenuBarState());
