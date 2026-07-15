import { BrowserWindow } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { CoinWindowLifecycle } from '@main/coin/coinWindow.lifecycle';
import { registerCoinIpc } from '@main/coin/coinIpc.service';
import { coinWindowManager } from '@main/coin/coinWindow.manager';
import { applicationLanguageService } from '@main/i18n/applicationLanguage.service';

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

  lockForAuthInvalidation(): void {
    this.lifecycle.lockForAuthInvalidation();
  }

  async _destroyForAuth(): Promise<void> {
    await this.lifecycle.destroyForAuth();
  }

  async prepareForAuthenticatedSession(): Promise<void> {
    await this.lifecycle.prepareForAuthenticatedSession();
  }

  async destroyForHostQuit(): Promise<void> {
    await this.lifecycle.destroyForHostQuit();
  }
}

export const coinWindowHandler = new CoinWindowHandler();
registerCoinIpc({
  getWindow: () => coinWindowManager.browserWindow,
  getLanguage: () => applicationLanguageService.getCurrentLanguage(),
});
export type { CoinWindowHandler };
