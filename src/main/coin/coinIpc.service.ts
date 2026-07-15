import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  COIN_IPC_CHANNELS,
  type CoinShellStatus,
  type CoinWindowSnapshot,
} from '@shared/coin/coinBridge.type';
import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';
import { assertCoinIpcSender } from './coinSender.guard';

export interface CoinIpcDependencies {
  getWindow(): BrowserWindow | null;
  getLanguage(): ApplicationLanguageSnapshot;
}

const shellStatus = (): CoinShellStatus => ({
  schema: 'coin-shell-v1',
  shell: 'ready',
  analysis: 'unavailable',
  codex: 'unavailable',
});

const windowSnapshot = (window: BrowserWindow): CoinWindowSnapshot => ({
  maximized: window.isMaximized(),
});

const withCoinWindow = (
  channel: string,
  event: IpcMainInvokeEvent,
  getWindow: CoinIpcDependencies['getWindow'],
): BrowserWindow =>
  assertCoinIpcSender(channel, event, getWindow()) as BrowserWindow;

let registered = false;

export const registerCoinIpc = (dependencies: CoinIpcDependencies): void => {
  if (registered) return;
  registered = true;

  ipcMain.handle(COIN_IPC_CHANNELS.shellGetStatus, (event) => {
    withCoinWindow(COIN_IPC_CHANNELS.shellGetStatus, event, dependencies.getWindow);
    return shellStatus();
  });

  ipcMain.handle(COIN_IPC_CHANNELS.languageGetCurrent, (event) => {
    withCoinWindow(COIN_IPC_CHANNELS.languageGetCurrent, event, dependencies.getWindow);
    return dependencies.getLanguage();
  });

  ipcMain.handle(COIN_IPC_CHANNELS.windowMinimize, (event) => {
    const window = withCoinWindow(
      COIN_IPC_CHANNELS.windowMinimize,
      event,
      dependencies.getWindow,
    );
    window.minimize();
  });

  ipcMain.handle(COIN_IPC_CHANNELS.windowToggleMaximize, (event) => {
    const window = withCoinWindow(
      COIN_IPC_CHANNELS.windowToggleMaximize,
      event,
      dependencies.getWindow,
    );
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return windowSnapshot(window);
  });

  ipcMain.handle(COIN_IPC_CHANNELS.windowClose, (event) => {
    const window = withCoinWindow(
      COIN_IPC_CHANNELS.windowClose,
      event,
      dependencies.getWindow,
    );
    window.close();
  });
};
