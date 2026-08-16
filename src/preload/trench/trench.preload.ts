import { contextBridge, ipcRenderer } from 'electron';
import 'electron-xpc/preload';
import '../omni/omniCellActiveFrame.sdk';
import { COIN_IPC_CHANNELS, type CoinBridge } from '../../shared/coin/coinBridge.type';
import type { TrenchHostContext } from '@shared/trench/trenchXpc.type';
import { SNIPING_IPC_CHANNELS, type SnipingBridge } from '@shared/sniping/snipingBridge.type';
import {
  MONITORING_IPC_CHANNELS,
  type MonitoringBridge,
} from '@shared/monitoring/monitoringBridge.type';

const platform = (): TrenchHostContext['platform'] => {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'other';
};

const trenchHost = Object.freeze<TrenchHostContext>({
  host: process.argv.includes('--mode=omni') ? 'omni' : 'standalone',
  platform: platform(),
});

const gmgnResources = Object.freeze({
  detectGmgn: async (): ReturnType<CoinBridge['resources']['detectGmgn']> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnDetect),
  saveGmgnApiKey: async (
    params: Parameters<CoinBridge['resources']['saveGmgnApiKey']>[0],
  ): ReturnType<CoinBridge['resources']['saveGmgnApiKey']> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnSaveApiKey, params),
  verifyGmgn: async (): ReturnType<CoinBridge['resources']['verifyGmgn']> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnVerify),
  openGmgnOfficialLink: async (
    params: Parameters<CoinBridge['resources']['openGmgnOfficialLink']>[0],
  ): ReturnType<CoinBridge['resources']['openGmgnOfficialLink']> =>
    await ipcRenderer.invoke(COIN_IPC_CHANNELS.gmgnOpenOfficialLink, params),
});

const snipingBridge = Object.freeze<SnipingBridge>({
  listComponents: async () => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listComponents),
  listConfigs: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listConfigs, input),
  getConfig: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.getConfig, input),
  validateConfig: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.validateConfig, input),
  saveConfig: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.saveConfig, input),
  startMonitoring: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.startMonitoring, input),
  stopMonitoring: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.stopMonitoring, input),
  listRuntimes: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listRuntimes, input),
  listSimulationEvents: async (input) =>
    await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listSimulationEvents, input),
  requestExactSimulation: async (input) =>
    await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.requestExactSimulation, input),
  listExactSimulations: async (input) =>
    await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listExactSimulations, input),
  requestShadowSimulation: async (input) =>
    await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.requestShadowSimulation, input),
  listShadowSimulations: async (input) =>
    await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listShadowSimulations, input),
  listActivity: async (input) => await ipcRenderer.invoke(SNIPING_IPC_CHANNELS.listActivity, input),
});

const monitoringBridge = Object.freeze<MonitoringBridge>({
  list: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.list, input),
  get: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.get, input),
  save: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.save, input),
  start: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.start, input),
  stop: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.stop, input),
  listSamples: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.listSamples, input),
  listAnomalies: async (input) => await ipcRenderer.invoke(MONITORING_IPC_CHANNELS.listAnomalies, input),
});

contextBridge.exposeInMainWorld('trenchHost', trenchHost);
contextBridge.exposeInMainWorld('coin', Object.freeze({ resources: gmgnResources }));
contextBridge.exposeInMainWorld('sniping', snipingBridge);
contextBridge.exposeInMainWorld('monitoring', monitoringBridge);
