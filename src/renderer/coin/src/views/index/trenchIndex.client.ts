import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  TRENCH_INDEX_CHANGED_EVENT,
  type TrenchIndexApi,
  type TrenchIndexChangedEvent,
} from '@shared/trench/trenchIndex.type';

const emitter = createXpcRendererEmitter<TrenchIndexApi>('TrenchHandler');

export const trenchIndexClient = {
  getWorkspace: async () => await emitter.getIndexWorkspace(),
  addTarget: async (input: Parameters<TrenchIndexApi['addIndexTargets']>[0]) =>
    await emitter.addIndexTargets(input),
  reanalyze: async (input: Parameters<TrenchIndexApi['reanalyzeIndex']>[0]) =>
    await emitter.reanalyzeIndex(input),
  subscribe: (listener: (event: TrenchIndexChangedEvent) => void): void => {
    xpcRenderer.subscribe(TRENCH_INDEX_CHANGED_EVENT, (payload) => listener(payload.params));
  },
};
