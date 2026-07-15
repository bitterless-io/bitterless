import { contextBridge, ipcRenderer } from 'electron';
import {
  COIN_IPC_CHANNELS,
  type CoinBridge,
  type CoinHostPlatform,
  type CoinShellStatus,
  type CoinWindowSnapshot,
} from '@shared/coin/coinBridge.type';
import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';

const hostPlatform = (): CoinHostPlatform => {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform;
  return 'other';
};

const shell = Object.freeze({
  getStatus: async (): Promise<CoinShellStatus> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.shellGetStatus),
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
  platform: hostPlatform(),
  language,
  shell,
  window: windowControls,
});

contextBridge.exposeInMainWorld('coin', coinBridge);
