import { app, shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type {
  CodingAgentProvider,
  CodingAgentIntegrationStatus,
  CodingAgentSessionApi,
  CodingAgentSessionDaoApi,
  CodingAgentSessionRecord,
  OpenCodingAgentSessionResult,
  RefreshCodingAgentSessionsResult,
  RegisterCodingAgentSessionParams
} from '@shared/codingAgent/codingAgentSession.type';
import { ClaudeDiscoveryAdapter } from '../codingAgent/claudeDiscovery.adapter';
import { CodexDiscoveryAdapter } from '../codingAgent/codexDiscovery.adapter';
import { CodingAgentSessionService } from '../codingAgent/codingAgentSession.service';
import { CodingAgentStatusBridgeService } from '../codingAgent/codingAgentStatusBridge.service';
import { agentSessionEventBridgeServer } from '../codingAgent/agentSessionEventBridge.server';
import { getCodingAgentBridgeEndpoint } from '@shared/codingAgent/codingAgentHookBridge.contract';

const repository = createXpcMainEmitter<CodingAgentSessionDaoApi>('CodingAgentSessionDao');
const codingAgentStatusBridgeService = new CodingAgentStatusBridgeService({
  userDataPath: app.getPath('userData'),
  homePath: app.getPath('home'),
  execPath: process.execPath,
  appPath: app.isPackaged ? null : app.getAppPath(),
  bridgeStatus: (provider) => ({
    listening: agentSessionEventBridgeServer.isListening(),
    lastEventAt: agentSessionEventBridgeServer.getLastEventAt(provider)
  })
});
const codingAgentSessionService = new CodingAgentSessionService({
  repository,
  codexDiscovery: new CodexDiscoveryAdapter(),
  claudeDiscovery: new ClaudeDiscoveryAdapter(),
  openExternal: async (url) => await shell.openExternal(url),
  broadcastChanged: (ids, revision) => {
    xpcMain.broadcast('coding-agent-session/changed', { ids, revision });
  },
  integration: codingAgentStatusBridgeService
});

export const startCodingAgentSessionBridge = async (): Promise<void> => {
  const installationId = codingAgentStatusBridgeService.ensureInstallationId();
  await agentSessionEventBridgeServer.start({
    endpoint: getCodingAgentBridgeEndpoint(app.getPath('userData')),
    installationId,
    consume: async (event) => {
      await codingAgentSessionService.applyHookEvent(event);
    }
  });
};

export const stopCodingAgentSessionBridge = async (): Promise<void> => {
  await agentSessionEventBridgeServer.stop();
};

export class CodingAgentSessionXpcHandler extends XpcMainHandler implements CodingAgentSessionApi {
  async list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]> {
    return await codingAgentSessionService.list(params);
  }

  async register(params: RegisterCodingAgentSessionParams): Promise<CodingAgentSessionRecord> {
    return await codingAgentSessionService.register(params);
  }

  async refresh(params?: {
    provider?: CodingAgentProvider;
  }): Promise<RefreshCodingAgentSessionsResult> {
    return await codingAgentSessionService.refresh(params);
  }

  async open(params: { id: string }): Promise<OpenCodingAgentSessionResult> {
    return await codingAgentSessionService.open(params);
  }

  async rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord> {
    return await codingAgentSessionService.rename(params);
  }

  async remove(params: { id: string }): Promise<boolean> {
    return await codingAgentSessionService.remove(params);
  }

  async getIntegrationStatus(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    return await codingAgentSessionService.getIntegrationStatus(params);
  }

  async installStatusBridge(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    return await codingAgentSessionService.installStatusBridge(params);
  }

  async removeStatusBridge(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    return await codingAgentSessionService.removeStatusBridge(params);
  }
}

export const codingAgentSessionXpcHandler = new CodingAgentSessionXpcHandler();
