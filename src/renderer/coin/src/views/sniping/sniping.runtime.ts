import { reactive } from 'vue';
import { snipingBridge } from '../../contextBridge/sniping.bridge';
import { SnipingStore } from './sniping.store';

export const snipingStore = reactive(new SnipingStore(snipingBridge));
