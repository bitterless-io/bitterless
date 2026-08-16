import { app, ipcMain, net, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { is } from '@electron-toolkit/utils';
import {
  MONITORING_IPC_CHANNELS,
  type MonitoringBridge
} from '@shared/monitoring/monitoringBridge.type';
import { coinWindowManager } from '@main/coin/coinWindow.manager';
import { omniWindowHelper } from '@main/windows/omniWindow.helper';
import { authHandler } from '@main/xpc/auth.handler';
import {
  assertSnipingRendererSender,
  createSnipingOmniTrenchTargets,
  createSnipingRendererTargets,
  type SnipingRendererTargets,
  type SnipingSenderWebContents
} from '../sniping/snipingSender.guard';
import { SnipingRelayClient, type SnipingFetch } from '../sniping/snipingRelay.client';
import {
  snipingSessionService,
  type SnipingSessionService
} from '../sniping/snipingSession.service';
import { MonitoringBridgeService } from './monitoringBridge.service';

export interface MonitoringIpcDependencies {
  bridge: MonitoringBridge;
  session: SnipingSessionService;
  getStandaloneWindow(): BrowserWindow | null;
  isLiveOmniTrench(sender: SnipingSenderWebContents): boolean;
  rendererTargets: SnipingRendererTargets;
  omniTrenchTargets: string[];
}

let registered = false;

const defaultDependencies = (): MonitoringIpcDependencies => {
  const relay = new SnipingRelayClient({
    session: snipingSessionService,
    fetchImpl: net.fetch as unknown as SnipingFetch,
    onCurrentUnauthorized: (sessionId) => {
      void authHandler
        .invalidateSession({
          sessionId,
          status: 401,
          source: 'sniping-core'
        })
        .catch(() => undefined);
    }
  });
  return {
    bridge: new MonitoringBridgeService(relay),
    session: snipingSessionService,
    getStandaloneWindow: () => coinWindowManager.browserWindow,
    isLiveOmniTrench: (sender) =>
      omniWindowHelper.isLiveMiniAppWebContents('trench', sender as Electron.WebContents),
    rendererTargets: createSnipingRendererTargets(
      app.getAppPath(),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
    ),
    omniTrenchTargets: createSnipingOmniTrenchTargets(
      app.getAppPath(),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
    )
  };
};

export const registerMonitoringIpc = (dependencies = defaultDependencies()): void => {
  if (registered) return;
  registered = true;
  const handle = (channel: string, listener: (input: unknown) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => {
      assertSnipingRendererSender(
        event,
        dependencies.getStandaloneWindow(),
        dependencies.isLiveOmniTrench,
        dependencies.rendererTargets.coin,
        dependencies.omniTrenchTargets
      );
      return listener(input);
    });
  };
  const invoke = <T>(method: (input: T) => unknown, input: unknown): unknown => method(input as T);
  handle(MONITORING_IPC_CHANNELS.list, (input) => invoke(dependencies.bridge.list, input));
  handle(MONITORING_IPC_CHANNELS.get, (input) => invoke(dependencies.bridge.get, input));
  handle(MONITORING_IPC_CHANNELS.save, (input) => invoke(dependencies.bridge.save, input));
  handle(MONITORING_IPC_CHANNELS.start, (input) => invoke(dependencies.bridge.start, input));
  handle(MONITORING_IPC_CHANNELS.stop, (input) => invoke(dependencies.bridge.stop, input));
  handle(MONITORING_IPC_CHANNELS.listSamples, (input) =>
    invoke(dependencies.bridge.listSamples, input)
  );
  handle(MONITORING_IPC_CHANNELS.listAnomalies, (input) =>
    invoke(dependencies.bridge.listAnomalies, input)
  );
};
