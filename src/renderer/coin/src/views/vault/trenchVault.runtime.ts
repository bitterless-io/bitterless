import { reactive } from 'vue';
import { trenchVaultClient } from './trenchVault.client';
import { TrenchVaultStore } from './trenchVault.store';

export const trenchVaultStore = reactive(new TrenchVaultStore(trenchVaultClient));
