// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge } from 'electron';
import { randomUUID } from 'crypto';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';
import '../omni/omniCellActiveFrame.sdk';

export interface TodoEnvApi {
  isStandalone: boolean;
  host: 'home' | 'standalone' | 'omni';
  originRendererId: string;
}

const isStandalone = process.argv.includes('--mode=standalone');
const isOmni = process.argv.includes('--mode=omni');

const todoEnvApi: TodoEnvApi = {
  isStandalone,
  host: isStandalone ? 'standalone' : isOmni ? 'omni' : 'home',
  originRendererId: randomUUID(),
};

contextBridge.exposeInMainWorld('todoEnv', todoEnvApi);
