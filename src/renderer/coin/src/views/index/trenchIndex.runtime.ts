import { reactive } from 'vue';
import { trenchIndexClient } from './trenchIndex.client';
import { TrenchIndexStore } from './trenchIndex.store';

export const trenchIndexStore = reactive(new TrenchIndexStore(trenchIndexClient));
