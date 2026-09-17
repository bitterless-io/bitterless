import { XpcMainHandler, xpcIgnore, xpcMain } from 'electron-xpc/main';
import { CoinWindowLifecycle } from '@main/coin/coinWindow.lifecycle';
import { coinWindowManager } from '@main/coin/coinWindow.manager';
import { applicationAuth } from '@main/auth/applicationAuth.service';
import type { CoinWindowSurface } from '@main/coin/coinWindow.type';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import { getMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';
import { MAESTRO_TRENCH_TAB_ID } from '@maestro-shared/compositeTab.identity';
import {
  TRENCH_HOST_CHANGED_EVENT,
  type TrenchHostApi,
  type TrenchHostState
} from '@shared/trench/trenchHost.type';

class CoinWindowHandler extends XpcMainHandler implements TrenchHostApi {
  private pendingTab: Promise<void> | null = null;
  private pendingToggle: Promise<void> | null = null;
  private sessionRevision = 0;
  private readonly lifecycle = new CoinWindowLifecycle<CoinWindowSurface>({
    getCurrent: () => coinWindowManager.surface,
    isDestroyed: (window) => window.isDestroyed(),
    create: async (signal) => await coinWindowManager.create(signal),
    showAndFocus: (window) => coinWindowManager.showAndFocus(window),
    destroy: async (window) => await coinWindowManager.destroy(window)
  });

  async openCoinWindow(): Promise<void> {
    if (!applicationAuth.ready) { maestroWindowHelper.requestLogin(); return; }
    const revision = this.sessionRevision;
    await this.pendingToggle;
    if (revision !== this.sessionRevision)
      throw new Error('[trench] Session changed while opening');
    await this.lifecycle.open();
    this.broadcastHostState();
  }

  async openCoinTab(): Promise<void> {
    if (!applicationAuth.ready) {
      await maestroWindowHelper.openCompositeTab({ id: MAESTRO_TRENCH_TAB_ID });
      maestroWindowHelper.requestLogin();
      return;
    }
    const revision = this.sessionRevision;
    await this.pendingToggle;
    if (revision !== this.sessionRevision)
      throw new Error('[trench] Session changed while opening');
    await this.openTabInternal();
  }

  @xpcIgnore
  private async openTabInternal(): Promise<void> {
    this.lifecycle.assertCanOpen();
    if (this.pendingTab) return this.pendingTab;
    const revision = this.sessionRevision;
    const opening = (async () => {
      if (!this.canDock()) throw new Error('[trench] Open Maestro before docking Trench');
      await maestroWindowHelper.whenReady();
      this.lifecycle.assertCanOpen();
      if (revision !== this.sessionRevision)
        throw new Error('[trench] Session changed while opening');
      if (!this.canDock()) throw new Error('[trench] Maestro is no longer available');
      await maestroWindowHelper.openCompositeTab({ id: MAESTRO_TRENCH_TAB_ID });
    })();
    this.pendingTab = opening;
    try {
      await opening;
    } finally {
      if (this.pendingTab === opening) this.pendingTab = null;
    }
  }

  async getHostState(input: { token: string }): Promise<TrenchHostState> {
    this.requireSurfaceToken(input.token);
    return this.hostState();
  }

  async toggleHost(input: { token: string }): Promise<void> {
    this.lifecycle.assertCanOpen();
    this.requireSurfaceToken(input.token);
    if (this.pendingToggle) return this.pendingToggle;
    const moving = (async () => {
      if (coinWindowManager.hostKind === 'standalone') await this.openTabInternal();
      else {
        const tabs = await maestroWindowHelper.getTabs();
        this.lifecycle.assertCanOpen();
        this.requireSurfaceToken(input.token);
        const surface = await this.lifecycle.ensure();
        this.lifecycle.assertCanOpen();
        this.requireSurfaceToken(input.token);
        coinWindowManager.mountStandalone(surface);
        coinWindowManager.showAndFocus(surface);
        for (const tab of tabs.filter((item) => item.kind === MAESTRO_TRENCH_TAB_ID)) {
          await maestroWindowHelper.closeTab({ id: tab.id });
        }
      }
    })();
    this.pendingToggle = moving;
    this.broadcastHostState();
    try {
      await moving;
    } finally {
      if (this.pendingToggle === moving) this.pendingToggle = null;
      this.broadcastHostState();
    }
  }

  @xpcIgnore
  async openOnTab(host: MaestroCompositeTabHostApi): Promise<void> {
    const surface = await this.lifecycle.ensure();
    try {
      this.lifecycle.assertCanOpen();
      coinWindowManager.mountTab(surface, host);
      coinWindowManager.showAndFocus(surface);
      this.broadcastHostState();
    } catch (error) {
      if (!coinWindowManager.hasHost) await coinWindowManager.destroy(surface);
      throw error;
    }
  }

  @xpcIgnore
  private requireSurfaceToken(token: string): void {
    const surface = coinWindowManager.surface;
    if (!surface || surface.isDestroyed() || !token || token !== surface.token) {
      throw new Error('[trench] Invalid or expired display surface');
    }
  }

  @xpcIgnore
  private canDock(): boolean {
    const window = maestroWindowHelper.browserWindow;
    return Boolean(
      window && !window.isDestroyed() && getMaestroCompositeTab(MAESTRO_TRENCH_TAB_ID)
    );
  }

  @xpcIgnore
  private hostState(): TrenchHostState {
    return {
      host: coinWindowManager.hostKind,
      canDock: this.canDock(),
      pending: this.pendingToggle !== null
    };
  }

  @xpcIgnore
  private broadcastHostState(): void {
    xpcMain.broadcast(TRENCH_HOST_CHANGED_EVENT, this.hostState());
  }

  @xpcIgnore
  lockForAuthInvalidation(): void {
    this.sessionRevision += 1;
    this.pendingTab = null;
    this.pendingToggle = null;
    this.lifecycle.lockForAuthInvalidation();
  }

  async _destroyForAuth(): Promise<void> {
    this.lockForAuthInvalidation();
    await this.lifecycle.destroyForAuth();
  }

  @xpcIgnore
  async prepareForAuthenticatedSession(): Promise<void> {
    await this.lifecycle.prepareForAuthenticatedSession();
  }

  @xpcIgnore
  async destroyForHostQuit(): Promise<void> {
    this.lockForAuthInvalidation();
    await this.lifecycle.destroyForHostQuit();
  }
}

export const coinWindowHandler = new CoinWindowHandler();
export type { CoinWindowHandler };
