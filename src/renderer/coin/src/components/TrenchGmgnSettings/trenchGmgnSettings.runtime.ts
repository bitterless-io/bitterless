import { reactive } from 'vue';
import { TrenchGmgnSettingsStore } from './trenchGmgnSettings.store';

export const trenchGmgnSettingsStore = reactive(new TrenchGmgnSettingsStore(window.coin.resources));
