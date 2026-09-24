import { BrowserWindow } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type {
  AuthInvalidationPayload,
  AuthSessionApi,
  CustomerSessionPayload,
} from '@shared/auth/auth.type';
import { customerSessionService } from '@main/auth/customerSession.service';
import { applicationAuth } from '@main/auth/applicationAuth.service';
import { mainWindowHelper } from '@main/windows/mainWindow.helper';
import { sqliteWindowHelper } from '@main/windows/sqliteWindow.helper';
import { todoWindowHandler } from './todoWindow.handler';
import { eyesOnAgentsWindowHandler } from './eyesOnAgentsWindow.handler';
import {
  resumeEyesOnAgentsAfterAuth,
  suspendEyesOnAgentsForAuth,
} from './eyesOnAgents.handler';
import { coinWindowHandler } from './coinWindow.handler';
import { maestroWindowHandler } from './maestroWindow.handler';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import type { TodoistSyncSessionApi } from '@shared/todoistSync/todoistSync.type';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

const todoistSyncSessionClient = createBoundedTodoXpcClient(
  createXpcMainEmitter<TodoistSyncSessionApi>('TodoistSyncSessionHandler'),
  'TodoistSyncSessionHandler',
);
const AUTH_SQLITE_LOAD_TIMEOUT_MS = 10_000;

const waitForCoreSqliteWindowLoad = (window: BrowserWindow): Promise<void> =>
  new Promise((resolve, reject) => {
    const webContents = window.webContents;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      webContents.removeListener('did-finish-load', onLoaded);
      webContents.removeListener('did-fail-load', onFailed);
      webContents.removeListener('destroyed', onDestroyed);
    };
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoaded = (): void => settle();
    const onFailed = (_event: Electron.Event, code: number, description: string): void => {
      settle(new Error(`[AuthHandler] Core SQLite window failed to load: ${code} ${description}`));
    };
    const onDestroyed = (): void => {
      settle(new Error('[AuthHandler] Core SQLite window was destroyed before loading'));
    };

    if (window.isDestroyed() || webContents.isDestroyed()) {
      onDestroyed();
      return;
    }
    webContents.once('did-finish-load', onLoaded);
    webContents.once('did-fail-load', onFailed);
    webContents.once('destroyed', onDestroyed);
    timeoutHandle = setTimeout(() => {
      settle(new Error('[AuthHandler] Core SQLite window load timed out after 10 seconds'));
    }, AUTH_SQLITE_LOAD_TIMEOUT_MS);
  });

class AuthHandler extends XpcMainHandler implements AuthSessionApi {
  private deactivationPromise: Promise<void> | null = null;
  private sessionActivationGeneration = 0;
  private sessionShouldBeActive = false;

  async activateSession(): Promise<void> {
    this.sessionShouldBeActive = true;
    const generation = ++this.sessionActivationGeneration;
    try {
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
      await coinWindowHandler.prepareForAuthenticatedSession();
      if (this._stopStaleActivation(generation)) return;
      await maestroWindowHandler.prepareForAuthenticatedSession();
      if (this._stopStaleActivation(generation)) return;
      await this._showAuthenticatedPrimaryWindow(generation);
    } catch (err) {
      if (!this._stopStaleActivation(generation)) {
        await this._showMaestroPrimaryWindow().catch((recoveryError) => {
          console.warn(
            '[AuthHandler] Failed to keep Maestro visible after activation failure:',
            recoveryError,
          );
        });
      }
      throw err;
    }
  }

  async showHomeWindow(): Promise<void> {
    await this._showMaestroPrimaryWindow();
    maestroWindowHelper.requestLogin();
  }

  async showPrimaryWindow(): Promise<void> {
    await this._showMaestroPrimaryWindow();
  }

  async deactivateSession(params?: { sessionId: string }): Promise<void> {
    const current = customerSessionService.current;
    if (params && current && current.sessionId !== params.sessionId) return;
    // Revoke protected capabilities immediately; browsing and Control remain alive.
    void maestroWindowHelper.prepareForAuthShutdown();
    this.sessionShouldBeActive = false;
    customerSessionService.clear();
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

    // Only the exact current identity can revoke main-process work; Home also fences the broadcast.
    if (eventPayload.sessionId && customerSessionService.current?.sessionId === eventPayload.sessionId) {
      customerSessionService.clear();
      applicationAuth.invalidate();
    }
    console.warn('[AuthHandler] Session invalidation requested:', {
      source: eventPayload.source,
      status: eventPayload.status,
    });
    xpcMain.broadcast('auth/invalidated', eventPayload);
  }

  /**
   * 渲染层交来的 Core 登录态。主进程的 agent 工具(`web_search`)靠它调 Core;
   * 每次登录成功与会话恢复都会推一次,所以这里直接覆盖,不做合并。
   */
  async setCustomerSession(params: CustomerSessionPayload): Promise<void> {
    customerSessionService.set(params);
  }

  async clearCustomerSession(params?: { sessionId: string }): Promise<void> {
    if (params && customerSessionService.current?.sessionId !== params.sessionId) return;
    customerSessionService.clear();
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
    await waitForCoreSqliteWindowLoad(sqliteWindow);
  }

  private _stopStaleActivation(generation: number): boolean {
    return generation !== this.sessionActivationGeneration || !this.sessionShouldBeActive;
  }

  private async _showMaestroPrimaryWindow(): Promise<void> {
    try {
      await maestroWindowHandler.openMaestroWindow();
    } finally {
      mainWindowHelper.hide();
    }
  }

  private async _showAuthenticatedPrimaryWindow(generation: number): Promise<void> {
    if (this._stopStaleActivation(generation)) return;
    await this._showMaestroPrimaryWindow();
  }

  private async _deactivateSession(): Promise<void> {
    await this._closeSecondaryWindows();
    await this._ensureMainWindow();
    await this._showMaestroPrimaryWindow();
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
    await maestroWindowHandler._destroyForAuth().catch((err) => {
      console.warn('[AuthHandler] Failed to destroy Maestro window:', err);
    });
    // Only explicitly account-bound owners above are torn down. Public/local windows such as
    // OnlyPreview and Zellij must remain usable, so there is deliberately no all-window sweep.
  }
}

export const authHandler = new AuthHandler();
export type { AuthHandler };
