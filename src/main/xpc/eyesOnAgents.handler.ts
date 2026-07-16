import { app, shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsSnapshot
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { getCodexHookBridgeEndpoint } from '@shared/eyesOnAgents/codexHookBridge.contract';
import {
  parseEyesOnAgentsCreateDomainParams,
  parseEyesOnAgentsDomainParams,
  parseEyesOnAgentsMoveThreadParams,
  parseEyesOnAgentsRenameDomainParams,
  parseEyesOnAgentsReorderDomainsParams,
  parseEyesOnAgentsThreadIdParams,
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { codexHookBridgeServer } from '../eyesOnAgents/codexHookBridge.server';
import { CodexDesktopBridgeService } from '../eyesOnAgents/codexDesktopBridge.service';
import { CodexAppServerSupervisor } from '../eyesOnAgents/codexAppServer.supervisor';
import { EyesOnAgentsService } from '../eyesOnAgents/eyesOnAgents.service';

const repository = createXpcMainEmitter<EyesOnAgentsRepositoryApi>('EyesOnAgentsRepositoryDao');
const settings = createXpcMainEmitter<SettingDao>('SettingDao');

const desktopBridge = new CodexDesktopBridgeService({
  userDataPath: app.getPath('userData'),
  homePath: app.getPath('home'),
  execPath: process.execPath,
  appPath: app.isPackaged ? null : app.getAppPath(),
  runtimeStatus: () => ({
    listening: codexHookBridgeServer.isListening(),
    lastEventAt: codexHookBridgeServer.getLastEventAt()
  })
});

let eyesOnAgentsService: EyesOnAgentsService;
const appServer = new CodexAppServerSupervisor({
  onNotification: async (method, params) => {
    await eyesOnAgentsService.handleAppServerNotification(method, params);
  },
  onStatusChanged: () => {
    xpcMain.broadcast('eyes-on-agents/changed', {});
  }
});

eyesOnAgentsService = new EyesOnAgentsService({
  repository,
  settings,
  appServer,
  desktopBridge,
  openExternal: async (url) => await shell.openExternal(url),
  broadcastChanged: () => xpcMain.broadcast('eyes-on-agents/changed', {})
});

export const startEyesOnAgentsRuntime = async (): Promise<void> => {
  const installationId = desktopBridge.ensureInstallationId();
  await codexHookBridgeServer.start({
    endpoint: getCodexHookBridgeEndpoint(app.getPath('userData')),
    installationId,
    consume: async (event) => {
      await eyesOnAgentsService.applyCodexHookEvent(event);
    }
  });
  await eyesOnAgentsService.initialize();
};

export const stopEyesOnAgentsRuntime = async (): Promise<void> => {
  await eyesOnAgentsService.shutdown();
  await codexHookBridgeServer.stop();
};

export const suspendEyesOnAgentsForAuth = async (): Promise<void> => {
  await eyesOnAgentsService.shutdown();
};

export const resumeEyesOnAgentsAfterAuth = async (): Promise<void> => {
  await eyesOnAgentsService.initialize();
};

export class EyesOnAgentsHandler extends XpcMainHandler implements EyesOnAgentsApi {
  async getSnapshot(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.getSnapshot();
  }

  async connectAppServer(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.connectAppServer();
  }

  async disconnectAppServer(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.disconnectAppServer();
  }

  async syncThreads(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.syncThreads();
  }

  async openThread(params: { threadId: string }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    return await eyesOnAgentsService.openThread(parseEyesOnAgentsThreadIdParams(params));
  }

  async installCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.installCodexBridge();
  }

  async removeCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.removeCodexBridge();
  }

  async getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus> {
    return await eyesOnAgentsService.getCodexBridgeStatus();
  }

  async createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.createDomain(parseEyesOnAgentsCreateDomainParams(params));
  }

  async renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.renameDomain(parseEyesOnAgentsRenameDomainParams(params));
  }

  async deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.deleteDomain(parseEyesOnAgentsDomainParams(params));
  }

  async reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.reorderDomains(parseEyesOnAgentsReorderDomainsParams(params));
  }

  async moveThread(params: { threadId: string; domainId: number }): Promise<EyesOnAgentsSnapshot> {
    return await eyesOnAgentsService.moveThread(parseEyesOnAgentsMoveThreadParams(params));
  }
}

export const eyesOnAgentsHandler = new EyesOnAgentsHandler();
