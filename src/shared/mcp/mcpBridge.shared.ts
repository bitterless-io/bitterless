import { createHash } from 'crypto';
import { join } from 'path';
import type { McpBridgeEndpoint } from './mcpBridge.type';
export type {
  CoreSqliteBootApi,
  CoreSqliteBootResult,
  CoreSqliteReadyParams,
  CoreSqliteTargetPreloadRegistration,
  LocalRpcFailure,
  LocalRpcRequest,
  LocalRpcResponse,
  LocalRpcSuccess,
  McpBridgeEndpoint,
  McpBridgeTransport,
  McpIntegrationInfo,
} from './mcpBridge.type';

export const MCP_LOCAL_RPC_MAX_BYTES = 8 * 1024 * 1024;
export const MCP_BRIDGE_PATH_ARG = '--mcp-bridge-path';
export const CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT =
  'core-sqlite/target-preload-registered';

const assertSafeArgument = (value: string, label: string): void => {
  if (!value || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
};

export const getMcpServerName = (appName: string): string => {
  const trimmedName = appName.trim();
  if (!trimmedName) throw new Error('Bitterless app name is required for MCP routing');

  const suffix = trimmedName
    .replace(/^bitterless(?:[_-]?)/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return suffix ? `bitterless-${suffix}` : 'bitterless';
};

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

export const createMcpConfigJson = (
  commandPath: string,
  serverName = 'bitterless',
): string => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serverName)) {
    throw new Error(`Invalid MCP server name: ${serverName}`);
  }
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          command: commandPath,
        },
      },
    },
    null,
    2,
  );
};

const shellQuote = (value: string): string => {
  assertSafeArgument(value, 'POSIX shim argument');
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

const windowsBatchQuote = (value: string): string => {
  assertSafeArgument(value, 'Windows shim argument');
  if (value.includes('"')) throw new Error('Windows shim arguments cannot contain double quotes');
  return `"${value.replace(/%/g, '%%')}"`;
};

export const createPosixMcpShim = (
  execPath: string,
  helperPath: string,
  bridgePath: string,
): string => {
  const command = [
    shellQuote(execPath),
    shellQuote(helperPath),
    MCP_BRIDGE_PATH_ARG,
    shellQuote(bridgePath),
    '"$@"',
  ].join(' ');
  return `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${command}\n`;
};

export const createWindowsMcpShim = (
  execPath: string,
  helperPath: string,
  bridgePath: string,
): string => {
  const command = [
    windowsBatchQuote(execPath),
    windowsBatchQuote(helperPath),
    MCP_BRIDGE_PATH_ARG,
    windowsBatchQuote(bridgePath),
    '%*',
  ].join(' ');
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${command}\r\n`;
};

export const parseMcpBridgeEndpointArg = (
  argv: string[],
  platform: NodeJS.Platform = process.platform,
): McpBridgeEndpoint | undefined => {
  let bridgePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(`${MCP_BRIDGE_PATH_ARG}=`)) {
      throw new Error(`${MCP_BRIDGE_PATH_ARG} must be followed by a separate path argument`);
    }
    if (arg !== MCP_BRIDGE_PATH_ARG) continue;
    if (bridgePath !== undefined) throw new Error(`${MCP_BRIDGE_PATH_ARG} may be provided only once`);
    const value = argv[index + 1];
    assertSafeArgument(value ?? '', MCP_BRIDGE_PATH_ARG);
    bridgePath = value;
    index += 1;
  }

  if (bridgePath === undefined) return undefined;
  if (platform === 'win32') {
    if (!bridgePath.startsWith('\\\\.\\pipe\\')) {
      throw new Error(`${MCP_BRIDGE_PATH_ARG} must be a local Windows named pipe`);
    }
    return { transport: 'win32-named-pipe', path: bridgePath };
  }
  if (!bridgePath.startsWith('/')) {
    throw new Error(`${MCP_BRIDGE_PATH_ARG} must be an absolute Unix socket path`);
  }
  return { transport: 'unix', path: bridgePath };
};
