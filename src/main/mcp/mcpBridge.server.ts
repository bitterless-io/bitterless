import { app } from 'electron';
import { xpcMain, createXpcMainEmitter } from 'electron-xpc/main';
import { dirname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import net, { Server, Socket } from 'net';
import type {
  LocalRpcFailure,
  LocalRpcRequest,
  LocalRpcResponse,
  McpBridgeEndpoint,
} from '@shared/mcp/mcpBridge.shared';
import { MCP_LOCAL_RPC_MAX_BYTES, getMcpBridgeEndpoint } from '@shared/mcp/mcpBridge.shared';
import type { DomainRow } from '@preload/sqlite/dao/domain.dao';
import type { TodoEventListResult } from '@preload/sqlite/dao/todoEvent.dao';
import type { TodoRow } from '@preload/sqlite/dao/todo.dao';

type AnyParams = Record<string, any>;

const todoEmitter = createXpcMainEmitter<any>('TodoDao');
const domainEmitter = createXpcMainEmitter<any>('DomainDao');
const eventEmitter = createXpcMainEmitter<any>('TodoEventDao');

const MCP_FOCUS_DESCRIPTION = 'Focus 是当前立刻要做的任务视图。只有未完成且被打星标/important 的 todo 才会进入 Focus。';
const MCP_STAR_RULE = '打星标 means todo.important=true. Use it only when current agent work is blocked on a human next action in the live conversation/current session. Do not star deferred follow-ups that can wait several days or do not block the current session.';

const isRecord = (value: unknown): value is AnyParams => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const getRequiredNumber = (params: AnyParams, key: string): number => {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
};

const getOptionalInteger = (params: AnyParams, key: string, defaultValue: number): number => {
  const value = params[key];
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return Math.floor(value);
};

const getRequiredIdList = (params: AnyParams, key: string): number[] => {
  const value = params[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }
  if (value.length > 100) {
    throw new Error(`${key} can contain at most 100 ids`);
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const id of value) {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`${key} must contain positive integer ids`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
};

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const getOptionalTimestamp = (params: AnyParams, camelKey: string, snakeKey: string): number | null | undefined => {
  const value = params[camelKey] ?? params[snakeKey];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${camelKey} must be a timestamp or null`);
  }
  return value;
};

const isActiveDomain = (domain: DomainRow): boolean => {
  return domain.archived === 0 && domain.is_deleted === 0;
};

const assertTodoListActiveStatus = (status: unknown): void => {
  if (status === undefined || status === null || status === 'active' || status === 0) return;
  throw new Error('todo.list only returns incomplete todos from unarchived domains');
};

const writeResponse = (socket: Socket, response: LocalRpcResponse): void => {
  socket.write(`${JSON.stringify(response)}\n`);
};

class McpBridgeServer {
  private server: Server | null = null;
  private endpoint: McpBridgeEndpoint | null = null;

  getEndpoint(): McpBridgeEndpoint {
    return getMcpBridgeEndpoint(app.getPath('userData'));
  }

  async start(): Promise<McpBridgeEndpoint> {
    if (this.server && this.endpoint) return this.endpoint;

    const endpoint = this.getEndpoint();
    if (endpoint.transport === 'unix') {
      mkdirSync(dirname(endpoint.path), { recursive: true });
      if (existsSync(endpoint.path)) {
        unlinkSync(endpoint.path);
      }
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.endpoint = endpoint;

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(endpoint.path, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    console.log('[mcpBridge] listening:', endpoint.path);
    return endpoint;
  }

  stop(): void {
    if (!this.server) return;
    const endpoint = this.endpoint;
    this.server.close();
    this.server = null;
    this.endpoint = null;
    if (endpoint?.transport === 'unix' && existsSync(endpoint.path)) {
      try {
        unlinkSync(endpoint.path);
      } catch (err) {
        console.warn('[mcpBridge] failed to remove socket:', err);
      }
    }
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MCP_LOCAL_RPC_MAX_BYTES) {
        writeResponse(socket, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: 'MCP bridge message is too large',
          },
        });
        socket.destroy();
        return;
      }

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          this.handleLine(socket, line);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: LocalRpcRequest | null = null;
    try {
      request = JSON.parse(line) as LocalRpcRequest;
      if (request.jsonrpc !== '2.0' || request.id === undefined || typeof request.method !== 'string') {
        throw new Error('Invalid JSON-RPC request');
      }
      const result = await this.dispatch(request.method, request.params);
      writeResponse(socket, {
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (err: any) {
      const failure: LocalRpcFailure = {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: {
          code: -32000,
          message: err?.message ?? 'Unknown MCP bridge error',
        },
      };
      writeResponse(socket, failure);
    }
  }

  private async dispatch(method: string, rawParams: unknown): Promise<unknown> {
    const params = isRecord(rawParams) ? rawParams : {};
    switch (method) {
      case 'domain.list':
        return this.listDomains();
      case 'event.list':
        return this.listEvents(params);
      case 'event.wait':
        return this.waitEvents(params);
      case 'todo.list':
        return this.listTodos(params);
      case 'todo.get':
        return todoEmitter.getById({ id: getRequiredNumber(params, 'id') });
      case 'todo.status':
        return todoEmitter.getStatusByIds({ ids: getRequiredIdList(params, 'ids') });
      case 'todo.create':
        return this.createTodo(params);
      case 'todo.update':
        return this.updateTodo(params);
      case 'todo.complete':
        return this.completeTodo(params);
      case 'todo.uncomplete':
        return this.uncompleteTodo(params);
      case 'todo.delete':
        return this.deleteTodo(params);
      case 'todo.move':
        return this.moveTodo(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async listDomains(): Promise<{
    domains: DomainRow[];
    focus: {
      id: 'focus';
      title: 'Focus';
      description: string;
      rule: string;
      starPolicy: {
        field: 'important';
        starWhen: string;
        doNotStarWhen: string;
      };
    };
  }> {
    const domains = (await domainEmitter.getAll()).filter(isActiveDomain);
    return {
      domains,
      focus: {
        id: 'focus',
        title: 'Focus',
        description: MCP_FOCUS_DESCRIPTION,
        rule: MCP_STAR_RULE,
        starPolicy: {
          field: 'important',
          starWhen: 'The agent cannot continue current work until Ral acts now: approve, provide missing input, create an account/domain, confirm a decision, or perform a manual step.',
          doNotStarWhen: 'The todo is a backlog item, a reminder, can wait several days, or does not block the current live work session.',
        },
      },
    };
  }

  private async listTodos(params: AnyParams): Promise<{
    domains: DomainRow[];
    todos: TodoRow[];
    todosByDomain: Record<number, TodoRow[]>;
  }> {
    assertTodoListActiveStatus(params.status);
    const domains = (await domainEmitter.getAll()).filter(isActiveDomain);
    const requestedDomainId = typeof params.domainId === 'number' ? params.domainId : undefined;
    const targetDomains = requestedDomainId
      ? domains.filter((domain) => domain.id === requestedDomainId)
      : domains;

    const todosByDomain: Record<number, TodoRow[]> = {};
    const todos: TodoRow[] = [];
    for (const domain of targetDomains) {
      const domainTodos = await todoEmitter.getByDomainId({ domainId: domain.id, status: 0 });
      todosByDomain[domain.id] = domainTodos;
      todos.push(...domainTodos);
    }
    return { domains: targetDomains, todos, todosByDomain };
  }

  private async listEvents(params: AnyParams): Promise<TodoEventListResult> {
    const afterEventId = Math.max(0, getOptionalInteger(params, 'afterEventId', 0));
    const limit = Math.max(1, Math.min(100, getOptionalInteger(params, 'limit', 50)));
    return eventEmitter.listAfter({ afterEventId, limit });
  }

  private async waitEvents(params: AnyParams): Promise<TodoEventListResult & { timedOut: boolean }> {
    const timeoutMs = Math.max(1000, Math.min(30000, getOptionalInteger(params, 'timeoutMs', 25000)));
    const startedAt = Date.now();
    let result = await this.listEvents(params);
    while (result.events.length === 0 && Date.now() - startedAt < timeoutMs) {
      const elapsed = Date.now() - startedAt;
      await delay(Math.min(1000, Math.max(100, timeoutMs - elapsed)));
      result = await this.listEvents(params);
    }
    return {
      ...result,
      timedOut: result.events.length === 0,
    };
  }

  private async createTodo(params: AnyParams): Promise<{ todo: TodoRow | undefined }> {
    const domainId = getRequiredNumber(params, 'domainId');
    if (typeof params.title !== 'string' || params.title.trim().length === 0) {
      throw new Error('title must be a non-empty string');
    }

    let todo = await todoEmitter.create({ domainId, title: params.title.trim(), source: 'ai', actor: 'ai' });
    if (todo) {
      const updateParams = this.toTodoUpdateParams({
        id: todo.id,
        dueAt: params.dueAt,
        due_at: params.due_at,
        remindAt: params.remindAt,
        remind_at: params.remind_at,
        important: params.important,
        note: params.note,
      });
      updateParams.actor = 'ai';
      if (Object.keys(updateParams).length > 2) {
        todo = await todoEmitter.update(updateParams);
      }
    }
    this.broadcastTodoUpdated();
    return { todo };
  }

  private async updateTodo(params: AnyParams): Promise<{ todo: TodoRow | undefined }> {
    const updateParams = this.toTodoUpdateParams(params);
    updateParams.actor = 'ai';
    const todo = await todoEmitter.update(updateParams);
    this.broadcastTodoUpdated();
    return { todo };
  }

  private async completeTodo(params: AnyParams): Promise<{ todo: TodoRow | undefined }> {
    const todo = await todoEmitter.completeTodo({ id: getRequiredNumber(params, 'id'), actor: 'ai' });
    this.broadcastTodoUpdated();
    return { todo };
  }

  private async uncompleteTodo(params: AnyParams): Promise<{ todo: TodoRow | undefined }> {
    const todo = await todoEmitter.uncompleteTodo({ id: getRequiredNumber(params, 'id'), actor: 'ai' });
    this.broadcastTodoUpdated();
    return { todo };
  }

  private async deleteTodo(params: AnyParams): Promise<{ deleted: true; id: number }> {
    const id = getRequiredNumber(params, 'id');
    await todoEmitter.hardDelete({ id, actor: 'ai' });
    this.broadcastTodoUpdated();
    return { deleted: true, id };
  }

  private async moveTodo(params: AnyParams): Promise<{ moved: true; id: number; domainId: number }> {
    const id = getRequiredNumber(params, 'id');
    const domainId = getRequiredNumber(params, 'domainId');
    await todoEmitter.moveToDomain({ id, domainId, actor: 'ai' });
    this.broadcastTodoUpdated();
    return { moved: true, id, domainId };
  }

  private toTodoUpdateParams(params: AnyParams): AnyParams {
    const id = getRequiredNumber(params, 'id');
    const updateParams: AnyParams = { id };

    if (params.title !== undefined) {
      if (typeof params.title !== 'string') throw new Error('title must be a string');
      updateParams.title = params.title;
    }

    const dueAt = getOptionalTimestamp(params, 'dueAt', 'due_at');
    if (dueAt !== undefined) updateParams.due_at = dueAt;

    const remindAt = getOptionalTimestamp(params, 'remindAt', 'remind_at');
    if (remindAt !== undefined) updateParams.remind_at = remindAt;

    if (params.important !== undefined) {
      if (typeof params.important === 'boolean') {
        updateParams.important = params.important ? 1 : 0;
      } else if (params.important === 0 || params.important === 1) {
        updateParams.important = params.important;
      } else {
        throw new Error('important must be a boolean, 0, or 1');
      }
    }

    if (params.note !== undefined) {
      if (params.note !== null && typeof params.note !== 'string') {
        throw new Error('note must be a string or null');
      }
      updateParams.note = params.note;
    }

    return updateParams;
  }

  private broadcastTodoUpdated(): void {
    xpcMain.broadcast('todo/data_updated', { source: 'mcp' });
  }
}

export const mcpBridgeServer = new McpBridgeServer();
