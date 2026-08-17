import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../../shared/pathHelper/preload/pathPreload.helper';
import '../omni/omniCellActiveFrame.sdk';
import type { EyesOnAgentsEnvApi } from '../../shared/eyesOnAgents/eyesOnAgentsWindow.type';

const eyesOnAgentsEnvApi: EyesOnAgentsEnvApi = {
  host: process.argv.includes('--mode=omni') ? 'omni' : 'standalone',
};

contextBridge.exposeInMainWorld('eyesOnAgentsEnv', eyesOnAgentsEnvApi);
