import { contextBridge, ipcRenderer } from 'electron';
import {
  COIN_IPC_CHANNELS,
  type CoinBridge,
  type CoinHostPlatform,
  type CoinShellStatus,
  type CoinWindowSnapshot,
} from '@shared/coin/coinBridge.type';
import type { CoinCodexDeviceCodeNotice } from '@shared/coin/coinResource.type';
import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';

const hostPlatform = (): CoinHostPlatform => {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform;
  return 'other';
};

const shell = Object.freeze({
  getStatus: async (): Promise<CoinShellStatus> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.shellGetStatus),
});

const codex = Object.freeze({
  getStatus: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.codexGetStatus),
  connect: async (params: Parameters<CoinBridge['codex']['connect']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.codexConnect, params),
  disconnect: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.codexDisconnect),
  onDeviceCode: (
    listener: (notice: CoinCodexDeviceCodeNotice | null) => void,
  ): (() => void) => {
    const handleNotice = (_event: Electron.IpcRendererEvent, notice: unknown): void => {
      listener(notice as CoinCodexDeviceCodeNotice | null);
    };
    ipcRenderer.on(COIN_IPC_CHANNELS.codexDeviceCode, handleNotice);
    return () => ipcRenderer.removeListener(COIN_IPC_CHANNELS.codexDeviceCode, handleNotice);
  },
});

const resources = Object.freeze({
  getStatus: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.resourcesGetStatus),
  detectGmgn: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnDetect),
  saveGmgnApiKey: async (params: Parameters<CoinBridge['resources']['saveGmgnApiKey']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnSaveApiKey, params),
  verifyGmgn: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnVerify),
  cancelGmgnVerify: async () =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnCancelVerify),
  openGmgnOfficialLink: async (
    params: Parameters<CoinBridge['resources']['openGmgnOfficialLink']>[0],
  ) => await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnOpenOfficialLink, params),
  saveService: async (params: Parameters<CoinBridge['resources']['saveService']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.serviceSave, params),
});

const state = Object.freeze({
  load: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.stateLoad),
  save: async (params: Parameters<CoinBridge['state']['save']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.stateSave, params),
  recover: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.stateRecover),
});

const data = Object.freeze({
  getSources: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataGetSources),
  monitor: async (params: Parameters<CoinBridge['data']['monitor']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataMonitor, params),
  refreshMonitor: async (params: Parameters<CoinBridge['data']['refreshMonitor']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataRefreshMonitor, params),
  parseScreener: async (params: Parameters<CoinBridge['data']['parseScreener']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataParseScreener, params),
  screen: async (params: Parameters<CoinBridge['data']['screen']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataScreen, params),
  analyzeMeme: async (params: Parameters<CoinBridge['data']['analyzeMeme']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataAnalyzeMeme, params),
  startDiscover: async (params: Parameters<CoinBridge['data']['startDiscover']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataStartDiscover, params),
  stopDiscover: async () => await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataStopDiscover),
  cancel: async (params: Parameters<CoinBridge['data']['cancel']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.dataCancel, params),
  onMonitorEvent: (
    listener: Parameters<CoinBridge['data']['onMonitorEvent']>[0],
  ): (() => void) => {
    const handleEvent = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(value as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(COIN_IPC_CHANNELS.dataMonitorEvent, handleEvent);
    return () => ipcRenderer.removeListener(COIN_IPC_CHANNELS.dataMonitorEvent, handleEvent);
  },
  onDiscoverEvent: (
    listener: Parameters<CoinBridge['data']['onDiscoverEvent']>[0],
  ): (() => void) => {
    const handleEvent = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(value as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(COIN_IPC_CHANNELS.dataDiscoverEvent, handleEvent);
    return () => ipcRenderer.removeListener(COIN_IPC_CHANNELS.dataDiscoverEvent, handleEvent);
  },
});

const strategy = Object.freeze({
  evaluate: async (params: Parameters<CoinBridge['strategy']['evaluate']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.strategyEvaluate, params),
});

const ai = Object.freeze({
  analyze: async (params: Parameters<CoinBridge['ai']['analyze']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.aiAnalyze, params),
  cancel: async (params: Parameters<CoinBridge['ai']['cancel']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.aiCancel, params),
});

const clipboard = Object.freeze({
  readText: async (): Promise<string> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.clipboardReadText),
});

const xBrowser = Object.freeze({
  getStatus: async () =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.xBrowserGetStatus),
  setDisplayMode: async (params: Parameters<CoinBridge['xBrowser']['setDisplayMode']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.xBrowserSetDisplayMode, params),
  open: async (params: Parameters<CoinBridge['xBrowser']['open']>[0]) =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.xBrowserOpen, params),
  focus: async () =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.xBrowserFocus),
  close: async () =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.xBrowserClose),
});

const language = Object.freeze({
  getCurrent: async (): Promise<ApplicationLanguageSnapshot> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.languageGetCurrent),
  onChanged: (
    listener: (snapshot: ApplicationLanguageSnapshot) => void,
  ): (() => void) => {
    const handleChange = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => {
      listener(snapshot as ApplicationLanguageSnapshot);
    };
    ipcRenderer.on(COIN_IPC_CHANNELS.languageChanged, handleChange);
    return () => ipcRenderer.removeListener(COIN_IPC_CHANNELS.languageChanged, handleChange);
  },
});

const windowControls = Object.freeze({
  minimize: async (): Promise<void> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.windowMinimize),
  toggleMaximize: async (): Promise<CoinWindowSnapshot> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.windowToggleMaximize),
  close: async (): Promise<void> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.windowClose),
});

const coinBridge: CoinBridge = Object.freeze({
  ai,
  clipboard,
  platform: hostPlatform(),
  codex,
  data,
  language,
  resources,
  shell,
  state,
  strategy,
  window: windowControls,
  xBrowser,
});

contextBridge.exposeInMainWorld('coin', coinBridge);
