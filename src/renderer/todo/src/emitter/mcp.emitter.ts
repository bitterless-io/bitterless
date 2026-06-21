import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';

interface McpRendererApi {
  getIntegrationInfo(): Promise<McpIntegrationInfo>;
}

export const mcpEmitter = createXpcRendererEmitter<McpRendererApi>('McpHandler');
