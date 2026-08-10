import { clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  COIN_IPC_CHANNELS,
  type CoinShellStatus,
  type CoinWindowSnapshot,
} from '@shared/coin/coinBridge.type';
import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';
import type { CoinResourceService } from './resources/coinResource.service';
import type { CoinDataService } from './data/coinData.service';
import type { CoinStateService } from './state/coinState.service';
import type { CoinStrategyService } from './strategy/coinStrategy.service';
import type { CoinAiAnalysisService } from './ai/coinAiAnalysis.service';
import type { CoinXBrowserService } from './x/coinXBrowser.service';
import { assertCoinIpcSender } from './coinSender.guard';

export interface CoinIpcDependencies {
  getWindow(): BrowserWindow | null;
  getLanguage(): ApplicationLanguageSnapshot;
  resources: CoinResourceService;
  data: CoinDataService;
  state: CoinStateService;
  strategy: CoinStrategyService;
  ai: CoinAiAnalysisService;
  xBrowser: CoinXBrowserService;
}

const shellStatus = async (resources: CoinResourceService): Promise<CoinShellStatus> => {
  const codex = await resources.getCodexStatus();
  return {
    schema: 'coin-shell-v1',
    shell: 'ready',
    analysis: 'ready',
    codex: codex.errorCode ? 'error' : codex.connected ? 'connected' : 'disconnected',
  };
};

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

  const scopedHandle = (
    channel: string,
    listener: (window: BrowserWindow, value?: unknown) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, value) => {
      const window = withCoinWindow(channel, event, dependencies.getWindow);
      return listener(window, value);
    });
  };

  const sendToLiveCoin = (
    owner: BrowserWindow,
    channel: string,
    value: unknown,
  ): void => {
    if (
      dependencies.getWindow() !== owner ||
      owner.isDestroyed() ||
      owner.webContents.isDestroyed()
    ) {
      return;
    }
    owner.webContents.send(channel, value);
  };

  scopedHandle(COIN_IPC_CHANNELS.shellGetStatus, async () =>
    await shellStatus(dependencies.resources));

  scopedHandle(COIN_IPC_CHANNELS.resourcesGetStatus, async () =>
    await dependencies.resources.getStatus());

  scopedHandle(COIN_IPC_CHANNELS.codexGetStatus, async () =>
    await dependencies.resources.getCodexStatus());

  scopedHandle(COIN_IPC_CHANNELS.codexConnect, async (window, value) => {
    const result = await dependencies.resources.connectCodex(value, {
      onDeviceCode: (notice) =>
        sendToLiveCoin(window, COIN_IPC_CHANNELS.codexDeviceCode, notice),
    });
    sendToLiveCoin(window, COIN_IPC_CHANNELS.codexDeviceCode, null);
    return result;
  });

  scopedHandle(COIN_IPC_CHANNELS.codexDisconnect, async (window) => {
    dependencies.ai.stopAll();
    const result = await dependencies.resources.disconnectCodex();
    sendToLiveCoin(window, COIN_IPC_CHANNELS.codexDeviceCode, null);
    return result;
  });

  scopedHandle(COIN_IPC_CHANNELS.gmgnDetect, async () =>
    await dependencies.resources.detectGmgn());

  scopedHandle(COIN_IPC_CHANNELS.gmgnSaveApiKey, async (_window, value) =>
    await dependencies.resources.saveGmgnApiKey(value));

  scopedHandle(COIN_IPC_CHANNELS.gmgnVerify, async () =>
    await dependencies.resources.verifyGmgn());

  scopedHandle(COIN_IPC_CHANNELS.gmgnCancelVerify, () =>
    dependencies.resources.cancelGmgnVerify());

  scopedHandle(COIN_IPC_CHANNELS.gmgnOpenOfficialLink, async (_window, value) =>
    await dependencies.resources.openGmgnOfficialLink(value));

  scopedHandle(COIN_IPC_CHANNELS.serviceSave, async (_window, value) =>
    await dependencies.resources.saveService(value));

  scopedHandle(COIN_IPC_CHANNELS.stateLoad, () => dependencies.state.load());

  scopedHandle(COIN_IPC_CHANNELS.stateSave, async (_window, value) =>
    await dependencies.state.save(value));

  scopedHandle(COIN_IPC_CHANNELS.stateRecover, async () =>
    await dependencies.state.recover());

  scopedHandle(COIN_IPC_CHANNELS.dataGetSources, async () =>
    await dependencies.data.getSources());

  scopedHandle(COIN_IPC_CHANNELS.dataMonitor, async (window, value) =>
    await dependencies.data.monitor(value, (event) =>
      sendToLiveCoin(window, COIN_IPC_CHANNELS.dataMonitorEvent, event)));

  scopedHandle(COIN_IPC_CHANNELS.dataRefreshMonitor, async (_window, value) =>
    await dependencies.data.refreshMonitor(value));

  scopedHandle(COIN_IPC_CHANNELS.dataParseScreener, async (_window, value) =>
    await dependencies.data.parseScreener(value));

  scopedHandle(COIN_IPC_CHANNELS.dataScreen, async (_window, value) =>
    await dependencies.data.screen(value));

  scopedHandle(COIN_IPC_CHANNELS.dataAnalyzeMeme, async (_window, value) =>
    await dependencies.data.analyzeMeme(value));

  scopedHandle(COIN_IPC_CHANNELS.dataAutoAnalyzeMeme, async (_window, value) =>
    await dependencies.data.autoAnalyzeMeme(value));

  scopedHandle(COIN_IPC_CHANNELS.dataStartDiscover, async (window, value) =>
    await dependencies.data.startDiscover(value, (snapshot) =>
      sendToLiveCoin(window, COIN_IPC_CHANNELS.dataDiscoverEvent, snapshot)));

  scopedHandle(COIN_IPC_CHANNELS.dataStopDiscover, () =>
    dependencies.data.stopDiscover());

  scopedHandle(COIN_IPC_CHANNELS.dataCancel, (_window, value) =>
    dependencies.data.cancel(value));

  scopedHandle(COIN_IPC_CHANNELS.strategyEvaluate, (_window, value) =>
    dependencies.strategy.evaluate(value));

  scopedHandle(COIN_IPC_CHANNELS.aiAnalyze, async (_window, value) =>
    await dependencies.ai.analyze(value));

  scopedHandle(COIN_IPC_CHANNELS.aiCancel, (_window, value) =>
    dependencies.ai.cancel(value));

  scopedHandle(COIN_IPC_CHANNELS.clipboardReadText, () =>
    clipboard.readText().trim().slice(0, 2_048));

  scopedHandle(COIN_IPC_CHANNELS.xBrowserGetStatus, async () =>
    await dependencies.xBrowser.getStatus());

  scopedHandle(COIN_IPC_CHANNELS.xBrowserSetDisplayMode, async (_window, value) =>
    await dependencies.xBrowser.setDisplayMode(value));

  scopedHandle(COIN_IPC_CHANNELS.xBrowserOpen, async (_window, value) =>
    await dependencies.xBrowser.open(value));

  scopedHandle(COIN_IPC_CHANNELS.xBrowserFocus, async () =>
    await dependencies.xBrowser.focus());

  scopedHandle(COIN_IPC_CHANNELS.xBrowserClose, async () =>
    await dependencies.xBrowser.close());

  scopedHandle(COIN_IPC_CHANNELS.languageGetCurrent, () => dependencies.getLanguage());

  scopedHandle(COIN_IPC_CHANNELS.windowMinimize, (window) => {
    window.minimize();
  });

  scopedHandle(COIN_IPC_CHANNELS.windowToggleMaximize, (window) => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return windowSnapshot(window);
  });

  scopedHandle(COIN_IPC_CHANNELS.windowClose, async (window) => {
    dependencies.ai.stopAll();
    dependencies.data.stopAll();
    await dependencies.xBrowser.close();
    window.close();
  });
};
