import { contextBridge } from 'electron';
import 'electron-xpc/preload';
import '../omni/omniCellActiveFrame.sdk';
import type { TrenchHostContext } from '@shared/trench/trenchXpc.type';

const platform = (): TrenchHostContext['platform'] => {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'other';
};

const trenchHost = Object.freeze<TrenchHostContext>({
  host: process.argv.includes('--mode=omni') ? 'omni' : 'standalone',
  platform: platform(),
});

contextBridge.exposeInMainWorld('trenchHost', trenchHost);
