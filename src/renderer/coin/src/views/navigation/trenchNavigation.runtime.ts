import { reactive } from 'vue';
import { TrenchNavigationStore } from './trenchNavigation.store';

export const trenchNavigationStore = reactive(new TrenchNavigationStore());
