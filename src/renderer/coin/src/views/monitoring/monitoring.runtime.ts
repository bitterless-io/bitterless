import { reactive } from 'vue';
import { monitoringBridge } from '../../contextBridge/monitoring.bridge';
import { MonitoringStore } from './monitoring.store';

export const monitoringStore = reactive(new MonitoringStore(monitoringBridge));
