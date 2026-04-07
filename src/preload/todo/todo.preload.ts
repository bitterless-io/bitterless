// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';

export interface TodoEnvApi {
  isStandalone: boolean;
}

const isStandalone = process.argv.includes('--mode=standalone');

const todoEnvApi: TodoEnvApi = {
  isStandalone,
};

contextBridge.exposeInMainWorld('todoEnv', todoEnvApi);
