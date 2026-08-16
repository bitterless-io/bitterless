import { reactive } from 'vue';
import { trenchPersonClient } from './trenchPerson.client';
import { TrenchPersonStore } from './trenchPerson.store';

export const trenchPersonStore = reactive(new TrenchPersonStore(trenchPersonClient));
