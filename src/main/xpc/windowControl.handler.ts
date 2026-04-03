import { BrowserWindow } from 'electron';
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';

const WINDOW_LAYOUT_KEY = 'window_layout';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class WindowControlHandler extends XpcMainHandler {
  async minimizeWindow(params: { windowId: number }): Promise<void> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      window.minimize();
    }
  }

  async maximizeWindow(params: { windowId: number }): Promise<void> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  }

  async closeWindow(params: { windowId: number }): Promise<void> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      window.close();
    }
  }

  async isMaximized(params: { windowId: number }): Promise<boolean> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      return window.isMaximized();
    }
    return false;
  }

  async getWindowBounds(params: { windowId: number }): Promise<WindowLayout | null> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      const bounds = window.getBounds();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }
    return null;
  }

  async setWindowBounds(params: { windowId: number; layout: WindowLayout }): Promise<void> {
    const window = BrowserWindow.fromId(params.windowId);
    if (window && !window.isDestroyed()) {
      window.setBounds({
        x: params.layout.x,
        y: params.layout.y,
        width: params.layout.width,
        height: params.layout.height,
      });
    }
  }

  async saveWindowLayout(params: { subKey: string; layout: WindowLayout }): Promise<void> {
    await settingEmitter.upsert({
      key: WINDOW_LAYOUT_KEY,
      sub_key: params.subKey,
      value: params.layout,
    });
  }

  async loadWindowLayout(params: { subKey: string }): Promise<WindowLayout | null> {
    return await settingEmitter.get<WindowLayout>({
      key: WINDOW_LAYOUT_KEY,
      sub_key: params.subKey,
    });
  }
}

export const windowControlHandler = new WindowControlHandler();
export type { WindowControlHandler };
