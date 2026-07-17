import {
  MCP_BRIDGE_PATH_ARG,
  parseMcpBridgeEndpointArg,
} from '@shared/mcp/mcpBridge.shared';
import { startBitterlessMcpStdioServer } from './mcpStdio.helper';

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error && error.message ? error.message : String(error);
};

const runMcpHelper = async (): Promise<void> => {
  const endpoint = parseMcpBridgeEndpointArg(process.argv);
  if (!endpoint) throw new Error(`${MCP_BRIDGE_PATH_ARG} is required`);
  await startBitterlessMcpStdioServer(endpoint);
};

void runMcpHelper().catch((err: unknown) => {
  process.stderr.write(`[bitterless-mcp] helper failed: ${getErrorMessage(err)}\n`);
  process.exitCode = 2;
});
