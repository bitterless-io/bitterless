import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import { TRENCH_DATA_CHANGED_EVENT } from '@shared/trench/trench.type';
import type { TrenchReadApi } from '@shared/trench/trenchXpc.type';
import type { TrenchVaultClient } from './trenchVault.type';

const emitter = createXpcRendererEmitter<TrenchReadApi>('TrenchHandler');

export const trenchVaultClient: TrenchVaultClient = {
  listAnalyses: async (params) => await emitter.listAnalyses(params),
  getAnalysis: async (params) => await emitter.getAnalysis(params),
  listIndexWallets: async (params) => await emitter.listIndexWallets(params),
  getIndexWallet: async (params) => await emitter.getIndexWallet(params),
  listNegativeWallets: async (params) => await emitter.listNegativeWallets(params),
  getNegativeWallet: async (params) => await emitter.getNegativeWallet(params),
  subscribe: (listener) => {
    xpcRenderer.subscribe(TRENCH_DATA_CHANGED_EVENT, (payload) => listener(payload.params));
  },
};
