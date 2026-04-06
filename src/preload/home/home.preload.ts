// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge } from 'electron';
import 'electron-xpc/preload';
// Importing pathHelper/preload auto-exposes pathHelper to window
import '../../shared/pathHelper/preload/pathPreload.helper';
import { extraResourceHelper } from './extraResource.helper';

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
