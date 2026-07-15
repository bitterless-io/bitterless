import { shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type {
  CodingAgentProvider,
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

const repository = createXpcMainEmitter<CodingAgentSessionDaoApi>('CodingAgentSessionDao');
const codingAgentSessionService = new CodingAgentSessionService({
  repository,
  codexDiscovery: new CodexDiscoveryAdapter(),
  claudeDiscovery: new ClaudeDiscoveryAdapter(),
  openExternal: async (url) => await shell.openExternal(url),
  broadcastChanged: (ids, revision) => {
    xpcMain.broadcast('coding-agent-session/changed', { ids, revision });
  }
});

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
}

export const codingAgentSessionXpcHandler = new CodingAgentSessionXpcHandler();
