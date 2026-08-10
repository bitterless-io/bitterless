import { BrowserWindow } from 'electron';
import { XpcMainHandler, xpcIgnore } from 'electron-xpc/main';
import { CoinWindowLifecycle } from '@main/coin/coinWindow.lifecycle';
import { coinWindowManager } from '@main/coin/coinWindow.manager';

class CoinWindowHandler extends XpcMainHandler {
  private readonly lifecycle = new CoinWindowLifecycle<BrowserWindow>({
    getCurrent: () => coinWindowManager.browserWindow,
    isDestroyed: (window) => coinWindowManager.isDestroyed(window),
    create: async (signal) => await coinWindowManager.create(signal),
    showAndFocus: (window) => coinWindowManager.showAndFocus(window),
    destroy: async (window) => await coinWindowManager.destroy(window),
  });

  async openCoinWindow(): Promise<void> {
    await this.lifecycle.open();
  }

  @xpcIgnore
  lockForAuthInvalidation(): void {
    this.lifecycle.lockForAuthInvalidation();
  }

  async _destroyForAuth(): Promise<void> {
    await this.lifecycle.destroyForAuth();
  }

  @xpcIgnore
  async prepareForAuthenticatedSession(): Promise<void> {
    await this.lifecycle.prepareForAuthenticatedSession();
  }

  @xpcIgnore
  async destroyForHostQuit(): Promise<void> {
    await this.lifecycle.destroyForHostQuit();
  }
}

export const coinWindowHandler = new CoinWindowHandler();
export type { CoinWindowHandler };
