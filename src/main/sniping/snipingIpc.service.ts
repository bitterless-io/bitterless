import { app, ipcMain, net, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { is } from '@electron-toolkit/utils';
import { SNIPING_IPC_CHANNELS, type SnipingBridge } from '@shared/sniping/snipingBridge.type';
import { SNIPING_SESSION_IPC_CHANNELS } from '@shared/sniping/snipingSession.type';
import { coinWindowManager } from '@main/coin/coinWindow.manager';
import { mainWindowHelper } from '@main/windows/mainWindow.helper';
import { omniWindowHelper } from '@main/windows/omniWindow.helper';
import { authHandler } from '@main/xpc/auth.handler';
import { SnipingBridgeService } from './snipingBridge.service';
import { SnipingRelayClient, type SnipingFetch } from './snipingRelay.client';
import {
  assertSnipingHomeSender,
  assertSnipingRendererSender,
  createSnipingRendererTargets,
  createSnipingOmniTrenchTargets,
  type SnipingRendererTargets,
  type SnipingSenderWebContents,
} from './snipingSender.guard';
import { snipingSessionService, type SnipingSessionService } from './snipingSession.service';

export interface SnipingIpcDependencies {
  bridge: SnipingBridge;
  session: SnipingSessionService;
  getHomeWindow(): BrowserWindow | null;
  getStandaloneWindow(): BrowserWindow | null;
  isLiveOmniTrench(sender: SnipingSenderWebContents): boolean;
  rendererTargets: SnipingRendererTargets;
  omniTrenchTargets: string[];
}

let registered = false;

const defaultDependencies = (): SnipingIpcDependencies => {
  const relay = new SnipingRelayClient({
    session: snipingSessionService,
    fetchImpl: net.fetch as unknown as SnipingFetch,
    onCurrentUnauthorized: (sessionId) => {
      void authHandler.invalidateSession({
        sessionId,
        status: 401,
        source: 'sniping-core',
      }).catch(() => undefined);
    },
  });
  return {
    bridge: new SnipingBridgeService(relay),
    session: snipingSessionService,
    getHomeWindow: () => mainWindowHelper.browserWindow,
    getStandaloneWindow: () => coinWindowManager.browserWindow,
    isLiveOmniTrench: (sender) =>
      omniWindowHelper.isLiveMiniAppWebContents('trench', sender as Electron.WebContents),
    rendererTargets: createSnipingRendererTargets(
      app.getAppPath(),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    ),
    omniTrenchTargets: createSnipingOmniTrenchTargets(
      app.getAppPath(),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    ),
  };
};

export const registerSnipingIpc = (dependencies = defaultDependencies()): void => {
  if (registered) return;
  registered = true;

  ipcMain.handle(SNIPING_SESSION_IPC_CHANNELS.activate, (event, input) => {
    assertSnipingHomeSender(event, dependencies.getHomeWindow(), dependencies.rendererTargets.home);
    return dependencies.session.activate(input);
  });
  ipcMain.handle(SNIPING_SESSION_IPC_CHANNELS.clear, (event, input) => {
    assertSnipingHomeSender(event, dependencies.getHomeWindow(), dependencies.rendererTargets.home);
    return dependencies.session.clear(input);
  });

  const trenchHandle = (
    channel: string,
    listener: (input: unknown) => unknown,
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => {
      assertSnipingRendererSender(
        event,
        dependencies.getStandaloneWindow(),
        dependencies.isLiveOmniTrench,
        dependencies.rendererTargets.coin,
        dependencies.omniTrenchTargets,
      );
      return listener(input);
    });
  };
  const invokeWithUnknown = <T>(method: (input: T) => unknown, input: unknown): unknown =>
    method(input as T);

  trenchHandle(SNIPING_IPC_CHANNELS.listComponents, () => dependencies.bridge.listComponents());
  trenchHandle(SNIPING_IPC_CHANNELS.listConfigs, (input) =>
    invokeWithUnknown(dependencies.bridge.listConfigs, input));
  trenchHandle(SNIPING_IPC_CHANNELS.getConfig, (input) =>
    invokeWithUnknown(dependencies.bridge.getConfig, input));
  trenchHandle(SNIPING_IPC_CHANNELS.validateConfig, (input) =>
    invokeWithUnknown(dependencies.bridge.validateConfig, input));
  trenchHandle(SNIPING_IPC_CHANNELS.saveConfig, (input) =>
    invokeWithUnknown(dependencies.bridge.saveConfig, input));
  trenchHandle(SNIPING_IPC_CHANNELS.startMonitoring, (input) =>
    invokeWithUnknown(dependencies.bridge.startMonitoring, input));
  trenchHandle(SNIPING_IPC_CHANNELS.stopMonitoring, (input) =>
    invokeWithUnknown(dependencies.bridge.stopMonitoring, input));
  trenchHandle(SNIPING_IPC_CHANNELS.listRuntimes, (input) =>
    invokeWithUnknown(dependencies.bridge.listRuntimes, input));
  trenchHandle(SNIPING_IPC_CHANNELS.listSimulationEvents, (input) =>
    invokeWithUnknown(dependencies.bridge.listSimulationEvents, input));
  trenchHandle(SNIPING_IPC_CHANNELS.requestExactSimulation, (input) =>
    invokeWithUnknown(dependencies.bridge.requestExactSimulation, input));
  trenchHandle(SNIPING_IPC_CHANNELS.listExactSimulations, (input) =>
    invokeWithUnknown(dependencies.bridge.listExactSimulations, input));
  trenchHandle(SNIPING_IPC_CHANNELS.requestShadowSimulation, (input) =>
    invokeWithUnknown(dependencies.bridge.requestShadowSimulation, input));
  trenchHandle(SNIPING_IPC_CHANNELS.listShadowSimulations, (input) =>
    invokeWithUnknown(dependencies.bridge.listShadowSimulations, input));
  trenchHandle(SNIPING_IPC_CHANNELS.listActivity, (input) =>
    invokeWithUnknown(dependencies.bridge.listActivity, input));
};
