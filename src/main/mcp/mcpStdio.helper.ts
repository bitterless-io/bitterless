import net from 'net';
import readline from 'readline';
import type {
  LocalRpcFailure,
  LocalRpcRequest,
  McpBridgeEndpoint,
} from '@shared/mcp/mcpBridge.shared';
import { MCP_LOCAL_RPC_MAX_BYTES } from '@shared/mcp/mcpBridge.shared';

type JsonRpcId = string | number | null;

interface McpRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 10000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  return error instanceof Error && error.message ? error.message : fallback;
};

const tools: McpTool[] = [
  {
    name: 'domain.list',
    description: 'List unarchived human-managed Bitterless todo domains with descriptions and the virtual Focus/star policy. Agents must choose an existing domain before creating todos.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'domain.create',
    description: 'Create an active human-managed Bitterless todo domain only when Ral explicitly requests or authorizes it. Never create a domain implicitly while creating a todo.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'event.list',
    description: 'Poll Bitterless todo events after a cursor. Use at session start/resume to learn whether human-blocking todos were completed or changed.',
    inputSchema: {
      type: 'object',
      properties: {
        afterEventId: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'event.wait',
    description: 'Long-poll Bitterless todo events after a cursor while actively waiting for human action. This is polling, not push notification.',
    inputSchema: {
      type: 'object',
      properties: {
        afterEventId: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000, default: 25000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.list',
    description: 'List incomplete Bitterless todos from unarchived domains. Completed todos are intentionally omitted to keep MCP reads small.',
    inputSchema: {
      type: 'object',
      properties: {
        domainId: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.get',
    description: 'Get one Bitterless todo by id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.status',
    description: 'Get active/completed/deleted/missing status for known todo IDs without listing completed history. Use this when an agent is tracking todos it created.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'integer', minimum: 1 },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.create',
    description: 'Create a Bitterless todo. Set important=true only when the current agent session is blocked on an immediate human action; leave false/unset for deferred follow-ups.',
    inputSchema: {
      type: 'object',
      required: ['domainId', 'title'],
      properties: {
        domainId: { type: 'integer', minimum: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        dueAt: { type: ['integer', 'null'] },
        remindAt: { type: ['integer', 'null'] },
        important: {
          type: 'boolean',
          description: 'Star the todo into Focus. Use true only for live-session human blockers; do not star backlog or deferrable work.',
        },
        note: {
          type: 'string',
          maxLength: 10000,
          description: 'Use an empty string to clear the note.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.update',
    description: 'Update a Bitterless todo. Set important=true only when the current agent session is blocked on an immediate human action; leave false/unset for deferred follow-ups.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        dueAt: { type: ['integer', 'null'] },
        remindAt: { type: ['integer', 'null'] },
        important: {
          type: 'boolean',
          description: 'Star the todo into Focus. Use true only for live-session human blockers; do not star backlog or deferrable work.',
        },
        note: {
          type: 'string',
          maxLength: 10000,
          description: 'Use an empty string to clear the note.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.complete',
    description: 'Mark a Bitterless todo as completed.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.uncomplete',
    description: 'Mark a Bitterless todo as active.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.delete',
    description: 'Delete a Bitterless todo and its subtodos.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todo.move',
    description: 'Move a Bitterless todo to another domain.',
    inputSchema: {
      type: 'object',
      required: ['id', 'domainId'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        domainId: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
];

const writeMessage = (message: object): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const writeError = (id: JsonRpcId, code: number, message: string, data?: unknown): void => {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
};

const callBridge = (endpoint: McpBridgeEndpoint, method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const request: LocalRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const socket = net.createConnection(endpoint.path);
    socket.setEncoding('utf8');

    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Bitterless MCP bridge request timed out'));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MCP_LOCAL_RPC_MAX_BYTES) {
        cleanup();
        reject(new Error('Bitterless MCP bridge response is too large'));
        return;
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;

      const line = buffer.slice(0, newlineIndex).trim();
      if (!line) return;

      try {
        const response = JSON.parse(line) as unknown;
        const hasResult = isRecord(response) && Object.hasOwn(response, 'result');
        const hasError = isRecord(response) && Object.hasOwn(response, 'error');
        if (
          !isRecord(response) ||
          response.jsonrpc !== '2.0' ||
          response.id !== id ||
          hasResult === hasError
        ) {
          throw new Error('Bitterless MCP bridge returned an invalid JSON-RPC response');
        }
        cleanup();
        if (hasError) {
          const message = isRecord(response.error) && typeof response.error.message === 'string'
            ? response.error.message
            : 'Bitterless MCP bridge returned an invalid error response';
          reject(new Error(message));
          return;
        }
        resolve(response.result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    socket.on('error', (err: Error) => {
      cleanup();
      reject(new Error(
        `Bitterless is not running or the MCP bridge is unavailable: ${endpoint.path}. ${err.message}`.trim(),
      ));
    });
  });
};

const createToolText = (toolName: string): string => {
  if (toolName.endsWith('.list')) {
    return `Bitterless ${toolName} completed.`;
  }
  return `Bitterless ${toolName} succeeded.`;
};

const getBridgeTimeoutMs = (toolName: string, args: unknown): number => {
  if (toolName !== 'event.wait') return REQUEST_TIMEOUT_MS;
  const timeoutValue = isRecord(args) ? args.timeoutMs : undefined;
  const timeoutMs = typeof timeoutValue === 'number' && Number.isFinite(timeoutValue)
    ? Math.max(1000, Math.min(30000, Math.floor(timeoutValue)))
    : 25000;
  return timeoutMs + 5000;
};

const handleRequest = async (
  request: McpRequest,
  endpoint: McpBridgeEndpoint,
): Promise<void> => {
  const id = request.id ?? null;

  if (request.method.startsWith('notifications/')) {
    return;
  }

  if (request.method === 'initialize') {
    const params = isRecord(request.params) ? request.params : {};
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: typeof params.protocolVersion === 'string'
          ? params.protocolVersion
          : '2025-06-18',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'bitterless-todo',
          version: '0.1.0',
        },
      },
    });
    return;
  }

  if (request.method === 'ping') {
    writeMessage({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (request.method === 'tools/list') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        tools,
      },
    });
    return;
  }

  if (request.method === 'tools/call') {
    const params = isRecord(request.params) ? request.params : {};
    const toolName = params.name;
    if (typeof toolName !== 'string' || !tools.some((tool) => tool.name === toolName)) {
      writeError(id, -32602, 'Unknown Bitterless MCP tool');
      return;
    }

    try {
      const args = params.arguments ?? {};
      const result = await callBridge(endpoint, toolName, args, getBridgeTimeoutMs(toolName, args));
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: createToolText(toolName),
            },
          ],
          structuredContent: result,
        },
      });
    } catch (err) {
      writeError(id, -32000, getErrorMessage(err, 'Bitterless MCP tool failed'));
    }
    return;
  }

  writeError(id, -32601, `Method not found: ${request.method}`);
};

export const startBitterlessMcpStdioServer = (
  endpoint: McpBridgeEndpoint,
): Promise<void> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    let inputClosed = false;
    let pendingRequests = 0;
    let finished = false;

    const finishWhenIdle = (): void => {
      if (!finished && inputClosed && pendingRequests === 0) {
        finished = true;
        resolve();
      }
    };

    const runRequest = (request: McpRequest): void => {
      pendingRequests += 1;
      handleRequest(request, endpoint).catch((err: unknown) => {
        const failure: LocalRpcFailure = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: {
            code: -32000,
            message: getErrorMessage(err, 'Bitterless MCP request failed'),
          },
        };
        writeMessage(failure);
      }).finally(() => {
        pendingRequests -= 1;
        finishWhenIdle();
      });
    };

    process.stderr.write(`[bitterless-mcp] stdio server started (${endpoint.path})\n`);

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (Buffer.byteLength(trimmed, 'utf8') > MCP_LOCAL_RPC_MAX_BYTES) {
        writeError(null, -32600, 'Bitterless MCP request is too large');
        return;
      }

      try {
        const request = JSON.parse(trimmed) as McpRequest;
        runRequest(request);
      } catch (err) {
        writeError(null, -32700, getErrorMessage(err, 'Parse error'));
      }
    });

    rl.on('close', () => {
      inputClosed = true;
      finishWhenIdle();
    });
  });
};
