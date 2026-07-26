import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';
import { omniWindowHelper } from '../windows/omniWindow.helper';
import type { OmniLayoutConfig, OmniPaneNode } from '@shared/omni/omni.types';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';

const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');
const LAYOUT_KEY = 'omni_layout';

class OmniWindowHandler extends XpcMainHandler {
  async openOmniWindow(): Promise<void> {
    console.log('[OmniWindowHandler] openOmniWindow called');
    if (omniWindowHelper.baseWindow && !omniWindowHelper.baseWindow.isDestroyed()) {
      console.log('[OmniWindowHandler] baseWindow exists, focusing');
      omniWindowHelper.show();
      return;
    }
    if (omniWindowHelper.isCreating) {
      console.log('[OmniWindowHandler] create already in progress, ignoring duplicate open');
      return;
    }
    console.log('[OmniWindowHandler] creating new omni window');
    await omniWindowHelper.create();
    console.log('[OmniWindowHandler] omni window created');
  }

  async updateLayout(params: { tree: OmniPaneNode }): Promise<void> {
    omniWindowHelper.updateLayout(params.tree);
  }

  async commitLayout(params: { tree: OmniPaneNode }): Promise<void> {
    await omniWindowHelper.commitLayout(params.tree);
  }

  async navigateCell(params: { cellId: string; url: string }): Promise<void> {
    console.log('[OmniWindowHandler] navigateCell called, cellId:', params.cellId, 'url:', params.url);
    omniWindowHelper.navigateCell(params.cellId, params.url);
  }

  async cellGoBack(params: { cellId: string }): Promise<void> {
    omniWindowHelper.cellGoBack(params.cellId);
  }

  async cellGoForward(params: { cellId: string }): Promise<void> {
    omniWindowHelper.cellGoForward(params.cellId);
  }

  async cellRefresh(params: { cellId: string }): Promise<void> {
    omniWindowHelper.cellRefresh(params.cellId);
  }

  async closeCell(params: { cellId: string }): Promise<void> {
    omniWindowHelper.closeCell(params.cellId);
  }

  async toggleOmniControl(): Promise<void> {
    console.log('[OmniWindowHandler] toggleOmniControl called');
    omniWindowHelper.toggleControl();
  }

  async minimize(): Promise<void> {
    omniWindowHelper.baseWindow?.minimize();
  }

  async toggleMaximize(): Promise<void> {
    const win = omniWindowHelper.baseWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  async close(): Promise<void> {
    omniWindowHelper.baseWindow?.close();
  }

  async isMaximized(): Promise<boolean> {
    const win = omniWindowHelper.baseWindow;
    if (win && !win.isDestroyed()) {
      return win.isMaximized();
    }
    return false;
  }

  async loadLayout(): Promise<OmniLayoutConfig | null> {
    console.log('[OmniWindowHandler] loadLayout called');
    return omniWindowHelper.getLayoutConfig() ??
      await settingEmitter.get<OmniLayoutConfig>({ key: LAYOUT_KEY });
  }
}

export const omniWindowHandler = new OmniWindowHandler();
export type { OmniWindowHandler };
