import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  TRENCH_PERSON_CHANGED_EVENT,
  type TrenchPersonApi,
  type TrenchPersonChangedEvent,
} from '@shared/trench/trenchPerson.type';

const emitter = createXpcRendererEmitter<TrenchPersonApi>('TrenchHandler');

export const trenchPersonClient = {
  listPersons: async (input?: Parameters<TrenchPersonApi['listPersons']>[0]) =>
    await emitter.listPersons(input),
  getPerson: async (input: Parameters<TrenchPersonApi['getPerson']>[0]) =>
    await emitter.getPerson(input),
  updatePersonProfile: async (input: Parameters<TrenchPersonApi['updatePersonProfile']>[0]) =>
    await emitter.updatePersonProfile(input),
  attachWalletToPerson: async (input: Parameters<TrenchPersonApi['attachWalletToPerson']>[0]) =>
    await emitter.attachWalletToPerson(input),
  subscribe: (listener: (event: TrenchPersonChangedEvent) => void): void => {
    xpcRenderer.subscribe(TRENCH_PERSON_CHANGED_EVENT, (payload) => listener(payload.params));
  },
};
