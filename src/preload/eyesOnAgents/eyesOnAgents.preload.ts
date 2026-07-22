import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';

export interface EyesOnAgentsEnvApi {
  host: 'standalone' | 'omni';
}

const eyesOnAgentsEnvApi: EyesOnAgentsEnvApi = {
  host: process.argv.includes('--mode=omni') ? 'omni' : 'standalone',
};

contextBridge.exposeInMainWorld('eyesOnAgentsEnv', eyesOnAgentsEnvApi);
