import { XpcMainHandler } from 'electron-xpc/main';
import { mainWindowHelper } from '../windows/mainWindow.helper';

class MainWindowHandler extends XpcMainHandler {
  async minimize(): Promise<void> {
    const win = mainWindowHelper.browserWindow;
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  }

  async toggleMaximize(): Promise<void> {
    const win = mainWindowHelper.browserWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  }

  async close(): Promise<void> {
    const win = mainWindowHelper.browserWindow;
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  async isMaximized(): Promise<boolean> {
    const win = mainWindowHelper.browserWindow;
    if (win && !win.isDestroyed()) {
      return win.isMaximized();
    }
    return false;
  }
}

export const mainWindowHandler = new MainWindowHandler();
export type { MainWindowHandler };
