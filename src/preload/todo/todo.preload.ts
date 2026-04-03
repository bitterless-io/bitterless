// Importing xpc/preload auto-exposes xpcRenderer to window
import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';

export interface TodoEnvApi {
  isStandalone: boolean;
  getWindowId: () => number;
}

const isStandalone = process.argv.includes('--mode=standalone');

const todoEnvApi: TodoEnvApi = {
  isStandalone,
  getWindowId: () => (window as any).__WINDOW_ID__ || 0,
};

contextBridge.exposeInMainWorld('todoEnv', todoEnvApi);
