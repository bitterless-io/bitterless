import { createHash } from 'crypto';
import { join } from 'path';
import type { McpBridgeEndpoint } from './mcpBridge.type';
export type {
  LocalRpcFailure,
  LocalRpcRequest,
  LocalRpcResponse,
  LocalRpcSuccess,
  McpBridgeEndpoint,
  McpBridgeTransport,
  McpIntegrationInfo,
} from './mcpBridge.type';

export const MCP_LOCAL_RPC_MAX_BYTES = 8 * 1024 * 1024;

export const getMcpBridgeEndpoint = (userDataPath: string): McpBridgeEndpoint => {
  if (process.platform === 'win32') {
    const suffix = createHash('sha1').update(userDataPath).digest('hex').slice(0, 12);
    return {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-mcp-${suffix}`,
    };
  }

  return {
    transport: 'unix',
    path: join(userDataPath, 'mcp', 'bridge.sock'),
  };
};

export const getMcpShimPath = (userDataPath: string): string => {
  const fileName = process.platform === 'win32' ? 'bitterless-mcp.cmd' : 'bitterless-mcp';
  return join(userDataPath, 'bin', fileName);
};

export const createMcpConfigJson = (commandPath: string): string => {
  return JSON.stringify(
    {
      mcpServers: {
        bitterless: {
          command: commandPath,
        },
      },
    },
    null,
    2,
  );
};
