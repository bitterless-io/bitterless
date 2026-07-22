// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';

export interface TodoEnvApi {
  isStandalone: boolean;
  host: 'home' | 'standalone' | 'omni';
}

const isStandalone = process.argv.includes('--mode=standalone');
const isOmni = process.argv.includes('--mode=omni');

const todoEnvApi: TodoEnvApi = {
  isStandalone,
  host: isStandalone ? 'standalone' : isOmni ? 'omni' : 'home',
};

contextBridge.exposeInMainWorld('todoEnv', todoEnvApi);
