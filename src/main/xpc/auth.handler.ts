import { BrowserWindow } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { AuthInvalidationPayload, AuthSessionApi } from '@shared/auth/auth.type';
import { connectorWindowHelper } from '@main/windows/connectorWindow.helper';
import { llamaWindowHelper } from '@main/windows/llamaWindow.helper';
import { mainWindowHelper } from '@main/windows/mainWindow.helper';
import { omniWindowHelper } from '@main/windows/omniWindow.helper';
import { sqliteWindowHelper } from '@main/windows/sqliteWindow.helper';
import { pluginTestHandler } from './pluginTest.handler';
import { todoWindowHandler } from './todoWindow.handler';
import { eyesOnAgentsWindowHandler } from './eyesOnAgentsWindow.handler';
import { submodulesWindowHandler } from './submodulesWindow.handler';
import {
  resumeEyesOnAgentsAfterAuth,
  suspendEyesOnAgentsForAuth,
} from './eyesOnAgents.handler';
import { coinWindowHandler } from './coinWindow.handler';
import { maestroWindowHandler } from './maestroWindow.handler';
import { destroyOnlyPreviewForAuth } from './onlyPreview.handler';
import type { TodoistSyncSessionApi } from '@shared/todoistSync/todoistSync.type';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

const todoistSyncSessionClient = createBoundedTodoXpcClient(
  createXpcMainEmitter<TodoistSyncSessionApi>('TodoistSyncSessionHandler'),
  'TodoistSyncSessionHandler',
);

class AuthHandler extends XpcMainHandler implements AuthSessionApi {
  private deactivationPromise: Promise<void> | null = null;
  private sessionActivationGeneration = 0;
  private sessionShouldBeActive = false;

  async activateSession(): Promise<void> {
    this.sessionShouldBeActive = true;
    const generation = ++this.sessionActivationGeneration;
    const deactivationPromise = this.deactivationPromise;
    if (deactivationPromise) {
      await deactivationPromise.catch((err) => {
        console.warn('[AuthHandler] Previous session teardown failed:', err);
      });
    }
    if (this._stopStaleActivation(generation)) return;
    await this._ensureSqliteWindow();
    if (this._stopStaleActivation(generation)) return;
    await resumeEyesOnAgentsAfterAuth();
    if (this._stopStaleActivation(generation)) return;
    await maestroWindowHandler.prepareForAuthenticatedSession();
    if (this._stopStaleActivation(generation)) return;
    await coinWindowHandler.prepareForAuthenticatedSession();
    if (this._stopStaleActivation(generation)) return;
    await this._showAuthenticatedPrimaryWindow(generation);
  }

  async showPrimaryWindow(): Promise<void> {
    if (!this.sessionShouldBeActive) {
      mainWindowHelper.show();
      return;
    }

    await this._showAuthenticatedPrimaryWindow(this.sessionActivationGeneration);
  }

  async deactivateSession(): Promise<void> {
    this.sessionShouldBeActive = false;
    this.sessionActivationGeneration += 1;
    coinWindowHandler.lockForAuthInvalidation();
    if (this.deactivationPromise) return await this.deactivationPromise;

    const request = this._deactivateSession();
    const tracked = request.finally(() => {
      if (this.deactivationPromise === tracked) {
        this.deactivationPromise = null;
      }
    });
    this.deactivationPromise = tracked;
    await tracked;
  }

  async invalidateSession(params: AuthInvalidationPayload = {}): Promise<void> {
    const eventPayload: AuthInvalidationPayload = {
      reason: params.reason || '登录已失效，请重新登录',
      sessionId: params.sessionId,
      source: params.source || 'unknown',
      status: params.status || 401,
    };

    console.warn('[AuthHandler] Session invalidation requested:', {
      source: eventPayload.source,
      status: eventPayload.status,
    });
    xpcMain.broadcast('auth/invalidated', eventPayload);
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

  private _stopStaleActivation(generation: number): boolean {
    return generation !== this.sessionActivationGeneration || !this.sessionShouldBeActive;
  }

  private async _showAuthenticatedPrimaryWindow(generation: number): Promise<void> {
    try {
      await maestroWindowHandler.openMaestroWindow();
    } catch (err) {
      if (!this._stopStaleActivation(generation)) mainWindowHelper.show();
      throw err;
    }
    if (this._stopStaleActivation(generation)) return;
    mainWindowHelper.hide();
  }

  private async _deactivateSession(): Promise<void> {
    await this._closeSecondaryWindows();
    const mainWindow = await this._ensureMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindowHelper.show();
    }
  }

  private async _closeSecondaryWindows(): Promise<void> {
    await todoistSyncSessionClient.deactivate().catch((err) => {
      console.warn('[AuthHandler] Failed to deactivate Todo sync:', err);
    });
    await suspendEyesOnAgentsForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to suspend EyesOnAgents runtime:', err);
    });
    await coinWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy Coin window:', err);
    });
    await todoWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy todo window:', err);
    });
    await eyesOnAgentsWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy EyesOnAgents window:', err);
    });
    await submodulesWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy Submodules window:', err);
    });
    await maestroWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy Maestro window:', err);
    });
    await pluginTestHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy plugin test windows:', err);
    });

    try {
      omniWindowHelper.destroy();
    } catch (err) {
      console.warn('[AuthHandler] Failed to destroy omni window:', err);
    }

    try {
      destroyOnlyPreviewForAuth();
    } catch (err) {
      console.warn('[AuthHandler] Failed to destroy OnlyPreview windows:', err);
    }

    const preservedWindows = new Set<BrowserWindow | null>([
      mainWindowHelper.browserWindow,
      sqliteWindowHelper.browserWindow,
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
