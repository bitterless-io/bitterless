import { XpcMainHandler } from 'electron-xpc/main';
import { mainWindowHelper } from '../windows/mainWindow.helper';
import { startupDiagnosticsService } from '../startup/startupDiagnostics.service';
import type {
  StartupDiagnosticsApi,
  StartupDiagnosticsSnapshot,
} from '@shared/startup/startupDiagnostics';

class MainWindowHandler extends XpcMainHandler implements StartupDiagnosticsApi {
  async getStartupDiagnostics(): Promise<StartupDiagnosticsSnapshot> {
    return startupDiagnosticsService.getSnapshot();
  }

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
