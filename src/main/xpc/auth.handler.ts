import { BrowserWindow } from 'electron';
import { XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { AuthInvalidationPayload } from '@shared/auth/auth.type';
import { connectorWindowHelper } from '@main/windows/connectorWindow.helper';
import { fsWindowHelper } from '@main/windows/fsWindow.helper';
import { llamaWindowHelper } from '@main/windows/llamaWindow.helper';
import { mainWindowHelper } from '@main/windows/mainWindow.helper';
import { omniWindowHelper } from '@main/windows/omniWindow.helper';
import { sqliteWindowHelper } from '@main/windows/sqliteWindow.helper';
import { pluginTestHandler } from './pluginTest.handler';
import { todoWindowHandler } from './todoWindow.handler';

class AuthHandler extends XpcMainHandler {
  private invalidating = false;

  async activateSession(): Promise<void> {
    await this._ensureSqliteWindow();
    this._ensureFsWindow();
  }

  async invalidateSession(params: AuthInvalidationPayload = {}): Promise<void> {
    if (this.invalidating) return;

    this.invalidating = true;
    try {
      const eventPayload: AuthInvalidationPayload = {
        reason: params.reason || '登录已失效，请重新登录',
        source: params.source || 'unknown',
        status: params.status || 401
      };

      console.warn('[AuthHandler] Session invalidated:', eventPayload);
      await this._closeSecondaryWindows();
      const mainWindow = await this._ensureMainWindow();

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }

      xpcMain.broadcast('auth/invalidated', eventPayload);
    } finally {
      this.invalidating = false;
    }
  }

  private async _ensureMainWindow(): Promise<BrowserWindow | null> {
    const current = mainWindowHelper.browserWindow;
    if (current && !current.isDestroyed()) return current;

    try {
      return await mainWindowHelper.create();
    } catch (err) {
      console.error('[AuthHandler] Failed to create main window after auth invalidation:', err);
      return null;
    }
  }

  private async _ensureSqliteWindow(): Promise<void> {
    const current = sqliteWindowHelper.browserWindow;
    if (current && !current.isDestroyed()) return;

    const sqliteWindow = sqliteWindowHelper.create();
    await new Promise<void>((resolve) => {
      sqliteWindow.webContents.once('did-finish-load', resolve);
      sqliteWindow.webContents.once('did-fail-load', () => resolve());
    });
  }

  private _ensureFsWindow(): void {
    const current = fsWindowHelper.browserWindow;
    if (current && !current.isDestroyed()) return;
    fsWindowHelper.create();
  }

  private async _closeSecondaryWindows(): Promise<void> {
    await todoWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy todo window:', err);
    });
    await pluginTestHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy plugin test windows:', err);
    });

    try {
      omniWindowHelper.destroy();
    } catch (err) {
      console.warn('[AuthHandler] Failed to destroy omni window:', err);
    }

    const preservedWindows = new Set<BrowserWindow | null>([
      mainWindowHelper.browserWindow,
      sqliteWindowHelper.browserWindow,
      fsWindowHelper.browserWindow,
      connectorWindowHelper.browserWindow,
      llamaWindowHelper.browserWindow
    ]);
    for (const window of BrowserWindow.getAllWindows()) {
      if (preservedWindows.has(window) || window.isDestroyed()) continue;
      window.destroy();
    }
  }
}

export const authHandler = new AuthHandler();
export type { AuthHandler };
