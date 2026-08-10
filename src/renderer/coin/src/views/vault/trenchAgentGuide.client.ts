import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';
import type { TrenchAgentGuideClient } from './trenchAgentGuide.type';

interface TrenchMcpRendererApi {
  getTrenchIntegrationInfo(): Promise<McpIntegrationInfo>;
}

const emitter = createXpcRendererEmitter<TrenchMcpRendererApi>('McpHandler');

export const trenchAgentGuideClient: TrenchAgentGuideClient = {
  getIntegrationInfo: async () => await emitter.getTrenchIntegrationInfo(),
};
