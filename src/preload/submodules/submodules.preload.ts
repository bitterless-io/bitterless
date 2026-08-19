// Submodules reads and watches nothing here: one Main-owned runtime does that for every view. This
// preload only opens the typed XPC channel, mounts the shared Omni active-frame SDK, and states
// which host renders this instance.
import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../omni/omniCellActiveFrame.sdk';
import type { SubmodulesEnvApi } from '../../shared/submodules/submodules.type';

const submodulesEnvApi: SubmodulesEnvApi = {
  host: process.argv.includes('--mode=omni') ? 'omni' : 'standalone'
};

contextBridge.exposeInMainWorld('submodulesEnv', submodulesEnvApi);
