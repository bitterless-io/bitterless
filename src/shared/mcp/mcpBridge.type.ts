export type McpBridgeTransport = 'unix' | 'win32-named-pipe';

export interface McpBridgeEndpoint {
  transport: McpBridgeTransport;
  path: string;
}

export interface McpIntegrationInfo {
  commandPath: string;
  configJson: string;
  instruction: string;
  bridgePath: string;
  transport: McpBridgeTransport;
}

export interface LocalRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface LocalRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

export interface LocalRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type LocalRpcResponse = LocalRpcSuccess | LocalRpcFailure;
