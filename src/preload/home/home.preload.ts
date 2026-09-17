// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge, ipcRenderer } from 'electron';
import 'electron-xpc/preload';
// Importing pathHelper/preload auto-exposes pathHelper to window
import '../../shared/pathHelper/preload/pathPreload.helper';
import { extraResourceHelper } from './extraResource.helper';
import {
  SNIPING_SESSION_IPC_CHANNELS,
  type SnipingSessionBridge,
} from '@shared/sniping/snipingSession.type';

export interface ExtraResourceApi {
  checkNeedsExtract: () => Promise<boolean>;
  startExtract: () => Promise<void>;
}

const extraResourceApi: ExtraResourceApi = {
  checkNeedsExtract: () => extraResourceHelper.checkNeedsExtract(),
  startExtract: () => extraResourceHelper.startExtract(),
};

contextBridge.exposeInMainWorld('extraResource', extraResourceApi);

export interface HomeEnvApi {
  platform: string;
  authOnlyE2E?: { coreOrigin: string; mode: string; env: string };
}

const homeEnvApi: HomeEnvApi = {
  platform: process.platform,
  ...(process.env.BITTERLESS_E2E === '1' && process.env.BITTERLESS_AUTH_E2E === '1' &&
      import.meta.env.VITE_MODE === 'debug' && import.meta.env.VITE_ENV === 'prod'
    ? { authOnlyE2E: { coreOrigin: import.meta.env.VITE_BITTERLESS_CORE_URL || '', mode: import.meta.env.VITE_MODE, env: import.meta.env.VITE_ENV } }
    : {}),
};

contextBridge.exposeInMainWorld('homeEnv', homeEnvApi);

const snipingSessionBridge = Object.freeze<SnipingSessionBridge>({
  activate: async (input) =>
    await ipcRenderer.invoke(SNIPING_SESSION_IPC_CHANNELS.activate, input),
  clear: async (input) =>
    await ipcRenderer.invoke(SNIPING_SESSION_IPC_CHANNELS.clear, input),
});

contextBridge.exposeInMainWorld('snipingSession', snipingSessionBridge);
