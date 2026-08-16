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
}

const homeEnvApi: HomeEnvApi = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld('homeEnv', homeEnvApi);

const snipingSessionBridge = Object.freeze<SnipingSessionBridge>({
  activate: async (input) =>
    await ipcRenderer.invoke(SNIPING_SESSION_IPC_CHANNELS.activate, input),
  clear: async (input) =>
    await ipcRenderer.invoke(SNIPING_SESSION_IPC_CHANNELS.clear, input),
});

contextBridge.exposeInMainWorld('snipingSession', snipingSessionBridge);
