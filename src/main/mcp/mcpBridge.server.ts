import { app } from 'electron';
import { dirname, isAbsolute } from 'path';
import { randomUUID } from 'crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import type { Stats } from 'fs';
import net, { Server, Socket } from 'net';
import type {
  LocalRpcFailure,
  LocalRpcRequest,
  LocalRpcResponse,
  McpBridgeEndpoint,
} from '@shared/mcp/mcpBridge.shared';
import { MCP_LOCAL_RPC_MAX_BYTES, getMcpBridgeEndpoint } from '@shared/mcp/mcpBridge.shared';
import type {
  McpDomainRow,
  McpSubTodoRow,
  McpTodoEventItem,
  McpTodoEventListResult,
  McpTodoRow,
  McpTodoStatusByIdsResult,
  McpTodoStatusItem,
  TodoEntityId,
  TodoMcpDaoApi,
} from '@shared/mcp/todoMcpDao.type';
import { ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH } from '@shared/onlypreview/onlyPreview.types';
import { assertTodoistSyncEntityId } from '@shared/todoistSync/todoistSync.contract';
import { todoSqliteClient } from './todoSqlite.client';

type RpcParams = Record<string, unknown>;
type DomainRow = McpDomainRow;
type StepRow = McpSubTodoRow;
type TodoEventItem = McpTodoEventItem;
type TodoEventListResult = McpTodoEventListResult;
type TodoRow = McpTodoRow;
type TodoStatusByIdsResult = McpTodoStatusByIdsResult;
type TodoStatusItem = McpTodoStatusItem;
type TodoUpdateCallParams = Parameters<TodoMcpDaoApi['update']>[0];
type PreviewOpener = (path: string) => Promise<void>;
type UnixSocketIdentity = Pick<
  Stats,
  'birthtimeMs' | 'ctimeMs' | 'dev' | 'ino' | 'mode' | 'size'
>;
type UnixStartLockIdentity = Pick<
  Stats,
  'birthtimeMs' | 'ctimeMs' | 'dev' | 'ino' | 'mode' | 'mtimeMs' | 'size'
>;

interface UnixStartLockOwner {
  token: string;
  pid: number;
  createdAt: number;
}

interface UnixStartLockSnapshot {
  identity: UnixStartLockIdentity;
  isDirectory: boolean;
  owner: UnixStartLockOwner | null;
  ownerIdentity: UnixStartLockIdentity | null;
  ownerRaw: string | null;
}

const todoDataClient = todoSqliteClient;

const MCP_FOCUS_DESCRIPTION = 'Focus 是未完成且被打星标/important 的 todo 视图，不是 Domain。明确的“星标/重点/important/优先/放进 Focus”意图使用 important=true；取消星标或移出 Focus 使用 important=false。';
const MCP_STAR_RULE = 'Interpret explicit priority intent instead of requiring one exact keyword. Set important=true for a clear star/important/priority/Focus-placement request or when an immediate human action blocks the current agent session. Set important=false for clear unstar/remove-from-Focus intent. A due date, reminder, ordinary backlog item, or unrelated edit alone does not imply a star. On todo.update, omit important to preserve the current state.';
const MCP_MAX_ACTIVE_DOMAINS = 17;
const MCP_START_LOCK_WAIT_MS = 3000;
const MCP_MALFORMED_LOCK_RECOVERY_AGE_MS = 500;

const isRecord = (value: unknown): value is RpcParams => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const assertOnlyKeys = (params: RpcParams, allowed: readonly string[], method: string): void => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!allowedKeys.has(key)) throw new Error(`${method} contains unknown argument: ${key}`);
  }
};

const isIntegerAtLeast = (value: unknown, minimum = 0): value is number => {
  return Number.isInteger(value) && (value as number) >= minimum;
};

const isNullableIntegerAtLeast = (value: unknown, minimum = 0): value is number | null => {
  return value === null || isIntegerAtLeast(value, minimum);
};

const getRequiredId = (params: RpcParams, key: string): TodoEntityId => {
  const value = params[key];
  return assertTodoistSyncEntityId(value, key);
};

const getOptionalInteger = (
  params: RpcParams,
  key: string,
  defaultValue: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  const value = params[key];
  if (value === undefined) return defaultValue;
  if (!isIntegerAtLeast(value, min) || value > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return value;
};

const getRequiredIdList = (params: RpcParams, key: string): TodoEntityId[] => {
  const value = params[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }
  if (value.length > 100) {
    throw new Error(`${key} can contain at most 100 ids`);
  }
  const ids: TodoEntityId[] = [];
  const seen = new Set<TodoEntityId>();
  for (const id of value) {
    const normalized = assertTodoistSyncEntityId(id, key);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      ids.push(normalized);
    }
  }
  return ids;
};

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const getUnixStartLockIdentity = (path: string): UnixStartLockIdentity => {
  const stats = lstatSync(path);
  return {
    birthtimeMs: stats.birthtimeMs,
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
};

const isSameUnixStartLockIdentity = (
  left: UnixStartLockIdentity | null,
  right: UnixStartLockIdentity | null,
): boolean => {
  if (left === null || right === null) return left === right;
  return left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size;
};

const parseUnixStartLockOwner = (raw: string): UnixStartLockOwner | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.token !== 'string' ||
      !isIntegerAtLeast(parsed.pid, 1) ||
      typeof parsed.createdAt !== 'number' ||
      !Number.isFinite(parsed.createdAt)
    ) {
      return null;
    }
    return parsed as unknown as UnixStartLockOwner;
  } catch {
    return null;
  }
};

const readUnixStartLockSnapshot = (lockPath: string): UnixStartLockSnapshot | null => {
  try {
    const stats = lstatSync(lockPath);
    const identity = getUnixStartLockIdentity(lockPath);
    const isDirectory = stats.isDirectory();
    const ownerPath = isDirectory ? `${lockPath}/owner.json` : lockPath;
    let ownerIdentity: UnixStartLockIdentity | null = null;
    let ownerRaw: string | null = null;
    try {
      ownerIdentity = getUnixStartLockIdentity(ownerPath);
      ownerRaw = readFileSync(ownerPath, 'utf8');
    } catch {
      // A legacy directory lock can be observed between mkdir and owner publication.
    }
    return {
      identity,
      isDirectory,
      owner: ownerRaw === null ? null : parseUnixStartLockOwner(ownerRaw),
      ownerIdentity,
      ownerRaw,
    };
  } catch {
    return null;
  }
};

const getUnixStartLockAge = (snapshot: UnixStartLockSnapshot): number => {
  const times = [
    snapshot.identity.birthtimeMs,
    snapshot.identity.ctimeMs,
    snapshot.identity.mtimeMs,
    snapshot.ownerIdentity?.birthtimeMs ?? 0,
    snapshot.ownerIdentity?.ctimeMs ?? 0,
    snapshot.ownerIdentity?.mtimeMs ?? 0,
  ];
  return Math.max(0, Date.now() - Math.max(...times));
};

const removeUnixStartLockIfUnchanged = (
  lockPath: string,
  snapshot: UnixStartLockSnapshot,
): boolean => {
  const current = readUnixStartLockSnapshot(lockPath);
  if (
    !current ||
    !isSameUnixStartLockIdentity(current.identity, snapshot.identity) ||
    !isSameUnixStartLockIdentity(current.ownerIdentity, snapshot.ownerIdentity) ||
    current.ownerRaw !== snapshot.ownerRaw
  ) {
    return false;
  }
  try {
    if (current.isDirectory) {
      rmSync(lockPath, { recursive: true });
    } else {
      unlinkSync(lockPath);
    }
    return true;
  } catch {
    return false;
  }
};

const removeUnixStartLockIfOwned = (lockPath: string, token: string): boolean => {
  const snapshot = readUnixStartLockSnapshot(lockPath);
  if (snapshot?.owner?.token !== token) return false;
  return removeUnixStartLockIfUnchanged(lockPath, snapshot);
};

const acquireUnixStartLock = async (socketPath: string): Promise<() => void> => {
  const lockPath = `${socketPath}.start-lock`;
  const owner: UnixStartLockOwner = {
    token: `${process.pid}-${randomUUID()}`,
    pid: process.pid,
    createdAt: Date.now(),
  };
  const candidatePath = `${lockPath}.candidate-${owner.token}`;
  const deadline = Date.now() + MCP_START_LOCK_WAIT_MS;
  writeFileSync(candidatePath, JSON.stringify(owner), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  try {
    while (true) {
      try {
        linkSync(candidatePath, lockPath);
        return () => {
          if (!removeUnixStartLockIfOwned(lockPath, owner.token)) {
            console.warn('[mcpBridge] start lock ownership changed before release:', lockPath);
          }
        };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'EEXIST') throw err;

        const snapshot = readUnixStartLockSnapshot(lockPath);
        if (!snapshot) continue;
        const ownerIsDead = snapshot.owner && !isProcessAlive(snapshot.owner.pid);
        const malformedIsStale = snapshot.owner === null &&
          getUnixStartLockAge(snapshot) >= MCP_MALFORMED_LOCK_RECOVERY_AGE_MS;
        if (
          (ownerIsDead || malformedIsStale) &&
          removeUnixStartLockIfUnchanged(lockPath, snapshot)
        ) {
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for MCP bridge startup ownership: ${socketPath}`);
        }
        await delay(25);
      }
    }
  } finally {
    try {
      unlinkSync(candidatePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[mcpBridge] failed to remove start lock candidate:', candidatePath, err);
      }
    }
  }
};

const throwInvalidDaoResult = (value: unknown, source: string, expected: string): never => {
  if (value === null || value === undefined) {
    throw new Error(`${source} is unavailable because the core SQLite store is not ready`);
  }
  throw new Error(`${source} returned an invalid ${expected}`);
};

const requireArray = <T>(value: unknown, source: string): T[] => {
  if (!Array.isArray(value)) {
    return throwInvalidDaoResult(value, source, 'array result');
  }
  return value as T[];
};

const requireDomainRow = (value: unknown, source: string): DomainRow => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^\d{20}$/.test(value.id) ||
    typeof value.customer_id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    (value.archived !== 0 && value.archived !== 1) ||
    (value.is_deleted !== 0 && value.is_deleted !== 1) ||
    !isIntegerAtLeast(value.position) ||
    !isIntegerAtLeast(value.created_at) ||
    !isIntegerAtLeast(value.updated_at)
  ) {
    return throwInvalidDaoResult(value, source, 'domain row');
  }
  return value as unknown as DomainRow;
};

const requireDomainRows = (value: unknown, source: string): DomainRow[] => {
  const rows = requireArray<unknown>(value, source).map((row, index) => {
    return requireDomainRow(row, `${source}[${index}]`);
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    return throwInvalidDaoResult(value, source, 'domain array result');
  }
  return rows;
};

const requireTodoRow = (
  value: unknown,
  source: string,
  expectedId?: TodoEntityId,
  expectedDomainId?: TodoEntityId,
): TodoRow => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^\d{20}$/.test(value.id) ||
    typeof value.customer_id !== 'string' ||
    typeof value.domain_id !== 'string' ||
    !/^\d{20}$/.test(value.domain_id) ||
    typeof value.title !== 'string' ||
    (value.status !== 0 && value.status !== 1) ||
    (value.important !== 0 && value.important !== 1) ||
    !isNullableIntegerAtLeast(value.due_at) ||
    (value.repeat_type !== null && typeof value.repeat_type !== 'string') ||
    !isIntegerAtLeast(value.repeat_interval, 1) ||
    !isNullableIntegerAtLeast(value.remind_at) ||
    !isNullableIntegerAtLeast(value.last_remind_at) ||
    !isNullableIntegerAtLeast(value.last_complete_at) ||
    !isNullableIntegerAtLeast(value.week_day) ||
    !isNullableIntegerAtLeast(value.monthly_day) ||
    !isNullableIntegerAtLeast(value.yearly_day) ||
    typeof value.note !== 'string' ||
    (value.source !== 'human' && value.source !== 'ai') ||
    (value.is_deleted !== 0 && value.is_deleted !== 1) ||
    !isIntegerAtLeast(value.position) ||
    !isIntegerAtLeast(value.created_at) ||
    !isIntegerAtLeast(value.updated_at) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    (expectedDomainId !== undefined && value.domain_id !== expectedDomainId)
  ) {
    return throwInvalidDaoResult(value, source, 'todo row');
  }
  return value as unknown as TodoRow;
};

const requireTodoRows = (
  value: unknown,
  source: string,
  expectedDomainId?: TodoEntityId,
): TodoRow[] => {
  return requireArray<unknown>(value, source).map((row, index) => {
    return requireTodoRow(row, `${source}[${index}]`, undefined, expectedDomainId);
  });
};

const requireStepRow = (
  value: unknown,
  source: string,
  expectedId?: TodoEntityId,
  expectedTodoId?: TodoEntityId,
  expectedCustomerId?: string,
): StepRow => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^\d{20}$/.test(value.id) ||
    typeof value.customer_id !== 'string' ||
    value.customer_id.length === 0 ||
    typeof value.todo_id !== 'string' ||
    !/^\d{20}$/.test(value.todo_id) ||
    typeof value.title !== 'string' ||
    value.title.length > 512 ||
    (value.status !== 0 && value.status !== 1) ||
    value.is_deleted !== 0 ||
    !Number.isSafeInteger(value.position) ||
    !Number.isSafeInteger(value.created_at) ||
    (value.created_at as number) < 0 ||
    !Number.isSafeInteger(value.updated_at) ||
    (value.updated_at as number) < 0 ||
    (expectedId !== undefined && value.id !== expectedId) ||
    (expectedTodoId !== undefined && value.todo_id !== expectedTodoId) ||
    (expectedCustomerId !== undefined && value.customer_id !== expectedCustomerId)
  ) {
    return throwInvalidDaoResult(value, source, 'Step row');
  }
  return value as unknown as StepRow;
};

const requireStepRows = (
  value: unknown,
  source: string,
  expectedTodoId: TodoEntityId,
  expectedCustomerId: string,
): StepRow[] => {
  const rows = requireArray<unknown>(value, source).map((row, index) => {
    return requireStepRow(
      row,
      `${source}[${index}]`,
      undefined,
      expectedTodoId,
      expectedCustomerId,
    );
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    return throwInvalidDaoResult(value, source, 'Step array result');
  }
  return rows;
};

const MCP_TODO_EVENT_TYPES = [
  'todo.created',
  'todo.updated',
  'todo.completed',
  'todo.uncompleted',
  'todo.deleted',
  'todo.moved',
  'todo.starred',
  'todo.unstarred',
] as const;

const isTodoEventType = (value: unknown): value is TodoEventItem['type'] => {
  return typeof value === 'string' && MCP_TODO_EVENT_TYPES.includes(
    value as TodoEventItem['type'],
  );
};

const isTodoEventActor = (value: unknown): value is TodoEventItem['actor'] => {
  return value === 'human' || value === 'ai' || value === 'system';
};

const requireEventItem = (value: unknown, source: string): TodoEventItem => {
  if (
    !isRecord(value) ||
    !isIntegerAtLeast(value.id, 1) ||
    !isTodoEventType(value.type) ||
    (value.todo_id !== null && (typeof value.todo_id !== 'string' || !/^\d{20}$/.test(value.todo_id))) ||
    (value.domain_id !== null && (typeof value.domain_id !== 'string' || !/^\d{20}$/.test(value.domain_id))) ||
    !isTodoEventActor(value.actor) ||
    !isRecord(value.payload) ||
    !isIntegerAtLeast(value.created_at)
  ) {
    return throwInvalidDaoResult(value, source, 'todo event');
  }
  return value as unknown as TodoEventItem;
};

const requireEventListResult = (
  value: unknown,
  source: string,
  afterEventId: number,
  limit: number,
): TodoEventListResult => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.events) ||
    !isIntegerAtLeast(value.latestEventId, afterEventId) ||
    typeof value.hasMore !== 'boolean'
  ) {
    return throwInvalidDaoResult(value, source, 'event list result');
  }
  const events = value.events.map((event, index) => {
    return requireEventItem(event, `${source}.events[${index}]`);
  });
  if (
    events.length > limit ||
    (events.length < limit && value.hasMore) ||
    events.some((event, index) => (
      event.id <= afterEventId ||
      (index > 0 && event.id <= events[index - 1].id)
    ))
  ) {
    return throwInvalidDaoResult(value, source, 'event list result');
  }
  if (
    (events.length > 0 && value.latestEventId !== events[events.length - 1].id) ||
    (events.length === 0 && value.latestEventId !== afterEventId)
  ) {
    return throwInvalidDaoResult(value, source, 'event list result');
  }
  return {
    events,
    latestEventId: value.latestEventId,
    hasMore: value.hasMore,
  };
};

const TODO_LOOKUP_STATES = ['active', 'completed', 'deleted', 'missing'] as const;

const isTodoLookupState = (value: unknown): value is TodoStatusItem['state'] => {
  return typeof value === 'string' && TODO_LOOKUP_STATES.includes(
    value as TodoStatusItem['state'],
  );
};

const requireStatusItem = (
  value: unknown,
  source: string,
  expectedId: TodoEntityId,
): TodoStatusItem => {
  if (
    !isRecord(value) ||
    value.id !== expectedId ||
    !isTodoLookupState(value.state) ||
    typeof value.exists !== 'boolean' ||
    typeof value.completed !== 'boolean' ||
    typeof value.deleted !== 'boolean' ||
    (value.title !== null && typeof value.title !== 'string') ||
    (value.domain_id !== null && (typeof value.domain_id !== 'string' || !/^\d{20}$/.test(value.domain_id))) ||
    !isNullableIntegerAtLeast(value.updated_at) ||
    !isNullableIntegerAtLeast(value.completed_at) ||
    !isNullableIntegerAtLeast(value.deleted_at) ||
    !isNullableIntegerAtLeast(value.deleted_event_id, 1)
  ) {
    return throwInvalidDaoResult(value, source, 'todo status item');
  }
  const flagsMatch = (
    (value.state === 'active' && value.exists && !value.completed && !value.deleted) ||
    (value.state === 'completed' && value.exists && value.completed && !value.deleted) ||
    (value.state === 'deleted' && !value.exists && !value.completed && value.deleted) ||
    (value.state === 'missing' && !value.exists && !value.completed && !value.deleted)
  );
  const domainMatches = value.state === 'active' || value.state === 'completed'
    ? typeof value.domain_id === 'string' && /^\d{20}$/.test(value.domain_id)
    : value.domain_id === null;
  const titleMatches = value.state === 'active' || value.state === 'completed'
    ? typeof value.title === 'string'
    : value.state === 'missing'
      ? value.title === null
      : true;
  const deletedMetadataMatches = value.state === 'deleted'
    ? value.deleted_at !== null && value.deleted_event_id !== null
    : value.deleted_at === null && value.deleted_event_id === null;
  if (!flagsMatch || !domainMatches || !titleMatches || !deletedMetadataMatches) {
    return throwInvalidDaoResult(value, source, 'todo status item');
  }
  return value as unknown as TodoStatusItem;
};

const requireStatusResult = (
  value: unknown,
  source: string,
  expectedIds: TodoEntityId[],
): TodoStatusByIdsResult => {
  if (!isRecord(value)) {
    return throwInvalidDaoResult(value, source, 'todo status result');
  }
  const rawItems = value.items;
  const rawSummary = value.summary;
  if (!Array.isArray(rawItems) || !isRecord(rawSummary)) {
    return throwInvalidDaoResult(value, source, 'todo status result');
  }
  if (rawItems.length !== expectedIds.length) {
    return throwInvalidDaoResult(value, source, 'todo status result');
  }
  const items = expectedIds.map((id, index) => {
    return requireStatusItem(rawItems[index], `${source}.items[${index}]`, id);
  });
  const summary = {} as TodoStatusByIdsResult['summary'];
  for (const state of TODO_LOOKUP_STATES) {
    const count = rawSummary[state];
    if (!isIntegerAtLeast(count)) {
      return throwInvalidDaoResult(value, source, 'todo status result');
    }
    summary[state] = count;
  }
  for (const state of TODO_LOOKUP_STATES) {
    if (summary[state] !== items.filter((item) => item.state === state).length) {
      return throwInvalidDaoResult(value, source, 'todo status result');
    }
  }
  return { items, summary };
};

const getUnixSocketIdentity = (socketPath: string): UnixSocketIdentity => {
  const stats = lstatSync(socketPath);
  return {
    birthtimeMs: stats.birthtimeMs,
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    size: stats.size,
  };
};

const isSameUnixSocket = (socketPath: string, identity: UnixSocketIdentity): boolean => {
  try {
    const current = getUnixSocketIdentity(socketPath);
    return current.dev === identity.dev &&
      current.ino === identity.ino &&
      current.mode === identity.mode &&
      current.size === identity.size &&
      current.ctimeMs === identity.ctimeMs &&
      current.birthtimeMs === identity.birthtimeMs;
  } catch {
    return false;
  }
};

const probeUnixSocket = (socketPath: string): Promise<'live' | 'stale'> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const finish = (result: 'live' | 'stale', error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.once('connect', () => finish('live'));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
        finish('stale');
        return;
      }
      finish('live', error);
    });
    socket.setTimeout(500, () => {
      finish('live', new Error(`Timed out while probing existing MCP bridge socket: ${socketPath}`));
    });
  });
};

const getOptionalTimestamp = (
  params: RpcParams,
  camelKey: string,
  snakeKey: string,
): number | null | undefined => {
  const hasCamelValue = Object.hasOwn(params, camelKey);
  const hasSnakeValue = Object.hasOwn(params, snakeKey);
  if (
    hasCamelValue &&
    hasSnakeValue &&
    params[camelKey] !== params[snakeKey]
  ) {
    throw new Error(`${camelKey} and ${snakeKey} must match when both are provided`);
  }
  const value = hasCamelValue ? params[camelKey] : params[snakeKey];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${camelKey} must be a non-negative safe integer timestamp or null`);
  }
  return value as number;
};

const isActiveDomain = (domain: DomainRow): boolean => {
  return domain.archived === 0 && domain.is_deleted === 0;
};

const isArchivedDomain = (domain: DomainRow): boolean => {
  return domain.archived === 1 && domain.is_deleted === 0;
};

const assertTodoListActiveStatus = (status: unknown): void => {
  if (status === undefined || status === null || status === 'active' || status === 0) return;
  throw new Error('todo.list only returns incomplete todos from unarchived domains');
};

const assertTodoMatchesUpdate = (
  todo: TodoRow,
  updateParams: TodoUpdateCallParams,
  source: string,
): void => {
  const fields = ['title', 'due_at', 'remind_at', 'important', 'note'] as const;
  for (const field of fields) {
    if (field in updateParams && todo[field] !== updateParams[field]) {
      throw new Error(`${source} did not persist ${field}`);
    }
  }
};

const writeResponse = (socket: Socket, response: LocalRpcResponse): void => {
  socket.write(`${JSON.stringify(response)}\n`);
};

export class McpBridgeServer {
  private server: Server | null = null;
  private endpoint: McpBridgeEndpoint | null = null;
  private unixSocketIdentity: UnixSocketIdentity | null = null;
  private domainCreateQueue: Promise<void> = Promise.resolve();
  private previewOpener: PreviewOpener | null = null;

  configurePreviewOpener(opener: PreviewOpener): void {
    this.previewOpener = opener;
  }

  getEndpoint(): McpBridgeEndpoint {
    return getMcpBridgeEndpoint(app.getPath('userData'));
  }

  async start(endpoint = this.getEndpoint()): Promise<McpBridgeEndpoint> {
    if (this.server && this.endpoint) return this.endpoint;

    const server = net.createServer((socket) => this.handleConnection(socket));
    let releaseStartLock: (() => void) | null = null;
    try {
      if (endpoint.transport === 'unix') {
        mkdirSync(dirname(endpoint.path), { recursive: true });
        releaseStartLock = await acquireUnixStartLock(endpoint.path);
        if (existsSync(endpoint.path)) {
          const existing = lstatSync(endpoint.path);
          if (!existing.isSocket()) {
            throw new Error(
              `Refusing to replace non-socket path at MCP bridge endpoint: ${endpoint.path}`,
            );
          }
          const existingIdentity = getUnixSocketIdentity(endpoint.path);
          const state = await probeUnixSocket(endpoint.path);
          if (state === 'live') {
            throw new Error(`MCP bridge endpoint is already owned by a running process: ${endpoint.path}`);
          }
          if (!isSameUnixSocket(endpoint.path, existingIdentity)) {
            throw new Error(`MCP bridge endpoint changed while probing stale socket: ${endpoint.path}`);
          }
          unlinkSync(endpoint.path);
        }
      }

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint.path, () => {
          server.off('error', reject);
          resolve();
        });
      });

      this.server = server;
      this.endpoint = endpoint;
      this.unixSocketIdentity = endpoint.transport === 'unix'
        ? getUnixSocketIdentity(endpoint.path)
        : null;
    } catch (err) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      throw err;
    } finally {
      releaseStartLock?.();
    }

    console.log('[mcpBridge] listening:', endpoint.path);
    return endpoint;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    const endpoint = this.endpoint;
    const unixSocketIdentity = this.unixSocketIdentity;
    this.server = null;
    this.endpoint = null;
    this.unixSocketIdentity = null;
    let preservedReplacementPath: string | null = null;
    if (
      endpoint?.transport === 'unix' &&
      unixSocketIdentity &&
      existsSync(endpoint.path) &&
      !isSameUnixSocket(endpoint.path, unixSocketIdentity)
    ) {
      preservedReplacementPath = `${endpoint.path}.preserved-${process.pid}-${Date.now()}`;
      try {
        renameSync(endpoint.path, preservedReplacementPath);
      } catch (err) {
        console.warn('[mcpBridge] failed to preserve replacement socket before close:', err);
        preservedReplacementPath = null;
      }
    }

    const closePromise = new Promise<void>((resolve, reject) => {
      try {
        server.close(() => resolve());
      } catch (err) {
        reject(err);
      }
    });

    if (preservedReplacementPath && endpoint?.transport === 'unix') {
      try {
        if (existsSync(endpoint.path)) {
          console.warn('[mcpBridge] socket path was claimed while restoring its replacement:', endpoint.path);
        } else {
          renameSync(preservedReplacementPath, endpoint.path);
        }
      } catch (err) {
        console.warn('[mcpBridge] failed to restore replacement socket while closing prior owner:', err);
      }
    }

    await closePromise;

    if (endpoint?.transport !== 'unix') return;
    if (preservedReplacementPath) {
      return;
    }
    if (
      unixSocketIdentity &&
      existsSync(endpoint.path) &&
      isSameUnixSocket(endpoint.path, unixSocketIdentity)
    ) {
      try {
        unlinkSync(endpoint.path);
      } catch (err) {
        console.warn('[mcpBridge] failed to remove owned socket:', err);
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
      const validId = typeof request.id === 'string' || (
        typeof request.id === 'number' && Number.isFinite(request.id)
      );
      if (request.jsonrpc !== '2.0' || !validId || typeof request.method !== 'string') {
        throw new Error('Invalid JSON-RPC request');
      }
      const result = await this.dispatch(request.method, request.params);
      writeResponse(socket, {
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (err) {
      const failure: LocalRpcFailure = {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: {
          code: -32000,
          message: err instanceof Error && err.message
            ? err.message
            : 'Unknown MCP bridge error',
        },
      };
      writeResponse(socket, failure);
    }
  }

  private async dispatch(method: string, rawParams: unknown): Promise<unknown> {
    if (method === 'preview.open' && !isRecord(rawParams)) {
      throw new Error(`${method} params must be an object`);
    }
    const params = isRecord(rawParams) ? rawParams : {};
    switch (method) {
      case 'domain.list':
        return this.listDomains();
      case 'domain.archived.list':
        return this.listArchivedDomains();
      case 'domain.description.update':
        return this.updateDomainDescription(params);
      case 'domain.create':
        return this.createDomain(params);
      case 'event.list':
        return this.listEvents(params);
      case 'event.wait':
        return this.waitEvents(params);
      case 'todo.list':
        return this.listTodos(params);
      case 'todo.get':
        return this.getTodo(params);
      case 'todo.status':
        return this.getTodoStatus(params);
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
      case 'step.list':
        return this.listSteps(params);
      case 'step.create':
        return this.createStep(params);
      case 'step.update':
        return this.updateStep(params);
      case 'step.complete':
        return this.setStepCompleted(params, 1);
      case 'step.uncomplete':
        return this.setStepCompleted(params, 0);
      case 'step.delete':
        return this.deleteStep(params);
      case 'preview.open':
        return this.openPreview(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async openPreview(params: RpcParams): Promise<{ opened: true }> {
    assertOnlyKeys(params, ['path'], 'preview.open');
    const target = params.path;
    if (typeof target !== 'string') throw new Error('path must be a string');
    if (
      target.trim().length === 0 ||
      target.length > ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH ||
      /[\r\n\0]/.test(target) ||
      !isAbsolute(target)
    ) {
      throw new Error('path must be one non-empty absolute local path');
    }
    if (!this.previewOpener) throw new Error('Bitterless Preview opener is unavailable');
    await this.previewOpener(target);
    return { opened: true };
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
        unstarWhen: string;
        doNotStarWhen: string;
        preserveWhenOmitted: string;
      };
    };
  }> {
    const domains = requireDomainRows(
      await todoDataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    ).filter(isActiveDomain);
    return {
      domains,
      focus: {
        id: 'focus',
        title: 'Focus',
        description: MCP_FOCUS_DESCRIPTION,
        rule: MCP_STAR_RULE,
        starPolicy: {
          field: 'important',
          starWhen: 'Set important=true when the user clearly asks to star/星标, mark important/重点 or priority/优先, add/place in Focus, or when the agent cannot continue current work until Ral performs an immediate human action.',
          unstarWhen: 'Set important=false when the user clearly asks to unstar/取消星标, mark no longer important/不再重点, or remove the Todo from Focus.',
          doNotStarWhen: 'A due date, reminder, ordinary backlog item, deferrable follow-up, or unrelated edit alone does not imply important=true.',
          preserveWhenOmitted: 'On todo.update, omit important when star intent is absent so the current star/Focus state is preserved.',
        },
      },
    };
  }

  private async listArchivedDomains(): Promise<{ domains: DomainRow[] }> {
    const domains = requireDomainRows(
      await todoDataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    ).filter(isArchivedDomain);
    return { domains };
  }

  private async updateDomainDescription(params: RpcParams): Promise<{ domain: DomainRow }> {
    const id = getRequiredId(params, 'id');
    if (typeof params.description !== 'string') {
      throw new Error('description must be a string');
    }
    const description = params.description.trim();
    if (description.length > 500) {
      throw new Error('description can contain at most 500 characters');
    }

    const dataClient = todoDataClient;
    const domains = requireDomainRows(
      await dataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    );
    const matches = domains.filter((domain) => domain.id === id && isActiveDomain(domain));
    if (matches.length !== 1) {
      throw new Error(`Active domain not found: ${id}`);
    }

    await dataClient.updateDomainDescription({ id, description });
    const reread = await dataClient.getDomainById({ id });
    if (reread === undefined) {
      throw new Error(`Domain not found after description update: ${id}`);
    }
    const domain = requireDomainRow(
      reread,
      'TodoistSyncRepository.getDomainById after description update',
    );
    if (
      domain.id !== id ||
      domain.description !== description ||
      !isActiveDomain(domain)
    ) {
      throw new Error('TodoistSyncRepository.updateDomainDescription did not persist the requested active domain description');
    }
    return { domain };
  }

  private createDomain(params: RpcParams): Promise<{ domain: DomainRow }> {
    const request = this.domainCreateQueue.then(() => this.createDomainSerial(params));
    this.domainCreateQueue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  private async createDomainSerial(params: RpcParams): Promise<{ domain: DomainRow }> {
    if (typeof params.title !== 'string') {
      throw new Error('title must be a string');
    }
    const title = params.title.trim();
    if (title.length === 0) {
      throw new Error('title must be a non-empty string');
    }
    if (title.length > 200) {
      throw new Error('title can contain at most 200 characters');
    }

    let description = '';
    if (params.description !== undefined) {
      if (typeof params.description !== 'string') {
        throw new Error('description must be a string');
      }
      description = params.description.trim();
      if (description.length > 500) {
        throw new Error('description can contain at most 500 characters');
      }
    }

    const activeDomains = requireDomainRows(
      await todoDataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    ).filter(isActiveDomain);
    if (activeDomains.length >= MCP_MAX_ACTIVE_DOMAINS) {
      throw new Error(`Cannot create domain: the active domain limit is ${MCP_MAX_ACTIVE_DOMAINS}`);
    }

    const domain = requireDomainRow(
      await todoDataClient.createDomain({ title, description }),
      'TodoistSyncRepository.createDomain',
    );
    if (
      domain.title !== title ||
      domain.description !== description ||
      !isActiveDomain(domain)
    ) {
      throw new Error('TodoistSyncRepository.createDomain returned a domain that does not match the request');
    }
    return { domain };
  }

  private async listTodos(params: RpcParams): Promise<{
    domains: DomainRow[];
    todos: TodoRow[];
    todosByDomain: Record<string, TodoRow[]>;
  }> {
    assertTodoListActiveStatus(params.status);
    const domains = requireDomainRows(
      await todoDataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    ).filter(isActiveDomain);
    const requestedDomainId = params.domainId === undefined
      ? undefined
      : getRequiredId(params, 'domainId');
    const targetDomains = requestedDomainId
      ? domains.filter((domain) => domain.id === requestedDomainId)
      : domains;
    if (requestedDomainId !== undefined && targetDomains.length !== 1) {
      throw new Error(`Active domain not found: ${requestedDomainId}`);
    }

    const todosByDomain: Record<string, TodoRow[]> = {};
    const todos: TodoRow[] = [];
    for (const domain of targetDomains) {
      const domainTodos = requireTodoRows(
        await todoDataClient.getTodosByDomain({ domainId: domain.id, status: 0 }),
        'TodoistSyncRepository.getTodosByDomain',
        domain.id,
      );
      if (domainTodos.some((todo) => todo.status !== 0 || todo.is_deleted !== 0)) {
        throw new Error('TodoistSyncRepository.getTodosByDomain returned a non-active todo');
      }
      todosByDomain[domain.id] = domainTodos;
      todos.push(...domainTodos);
    }
    if (new Set(todos.map((todo) => todo.id)).size !== todos.length) {
      throw new Error('TodoistSyncRepository.getTodosByDomain returned duplicate todo ids');
    }
    return { domains: targetDomains, todos, todosByDomain };
  }

  private async listEvents(params: RpcParams): Promise<TodoEventListResult> {
    const afterEventId = getOptionalInteger(params, 'afterEventId', 0, 0);
    const limit = getOptionalInteger(params, 'limit', 50, 1, 100);
    return requireEventListResult(
      await todoDataClient.listAfter({ afterEventId, limit }),
      'TodoistSyncRepository.listAfter',
      afterEventId,
      limit,
    );
  }

  private async waitEvents(params: RpcParams): Promise<TodoEventListResult & { timedOut: boolean }> {
    const timeoutMs = getOptionalInteger(params, 'timeoutMs', 25000, 1000, 30000);
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

  private async getTodo(params: RpcParams): Promise<TodoRow> {
    const id = getRequiredId(params, 'id');
    const value = await todoDataClient.getTodoById({ id });
    if (value === undefined) throw new Error(`Todo not found: ${id}`);
    return requireTodoRow(value, 'TodoistSyncRepository.getTodoById', id);
  }

  private async getTodoStatus(params: RpcParams): Promise<TodoStatusByIdsResult> {
    const ids = getRequiredIdList(params, 'ids');
    return requireStatusResult(
      await todoDataClient.getStatusByIds({ ids }),
      'TodoistSyncRepository.getStatusByIds',
      ids,
    );
  }

  private async createTodo(params: RpcParams): Promise<{ todo: TodoRow }> {
    const domainId = getRequiredId(params, 'domainId');
    if (typeof params.title !== 'string' || params.title.trim().length === 0) {
      throw new Error('title must be a non-empty string');
    }
    const title = params.title.trim();
    if (title.length > 200) throw new Error('title can contain at most 200 characters');
    const createUpdateInput: RpcParams = { id: '00000000000000000000' };
    for (const key of ['dueAt', 'due_at', 'remindAt', 'remind_at', 'important', 'note']) {
      if (Object.hasOwn(params, key)) createUpdateInput[key] = params[key];
    }
    const requestedUpdate = this.toTodoUpdateParams(createUpdateInput, false);
    if (requestedUpdate.due_at === null) delete requestedUpdate.due_at;
    if (requestedUpdate.remind_at === null) delete requestedUpdate.remind_at;
    await this.requireActiveDomain(domainId);

    let todo = requireTodoRow(
      await todoDataClient.createTodo({
        domainId,
        title,
        source: 'ai',
        actor: 'ai',
      }),
      'TodoistSyncRepository.createTodo',
      undefined,
      domainId,
    );
    if (
      todo.title !== title ||
      todo.source !== 'ai' ||
      todo.status !== 0 ||
      todo.is_deleted !== 0
    ) {
      throw new Error('TodoistSyncRepository.createTodo returned a todo that does not match the request');
    }
    const updateParams: TodoUpdateCallParams = { ...requestedUpdate, id: todo.id };
    updateParams.actor = 'ai';
    if (Object.keys(updateParams).length > 2) {
      todo = requireTodoRow(
        await todoDataClient.updateTodo(updateParams),
        'TodoistSyncRepository.updateTodo after create',
        todo.id,
        domainId,
      );
      assertTodoMatchesUpdate(todo, updateParams, 'TodoistSyncRepository.updateTodo after create');
    }
    return { todo };
  }

  private async updateTodo(params: RpcParams): Promise<{ todo: TodoRow }> {
    const updateParams = this.toTodoUpdateParams(params);
    updateParams.actor = 'ai';
    const value = await todoDataClient.updateTodo(updateParams);
    if (value === undefined) throw new Error(`Todo not found: ${updateParams.id}`);
    const todo = requireTodoRow(
      value,
      'TodoistSyncRepository.updateTodo',
      updateParams.id,
    );
    assertTodoMatchesUpdate(todo, updateParams, 'TodoistSyncRepository.updateTodo');
    return { todo };
  }

  private async completeTodo(params: RpcParams): Promise<{ todo: TodoRow }> {
    const id = getRequiredId(params, 'id');
    const value = await todoDataClient.completeTodo({ id, actor: 'ai' });
    if (value === undefined) throw new Error(`Todo not found: ${id}`);
    const todo = requireTodoRow(
      value,
      'TodoistSyncRepository.completeTodo',
      id,
    );
    return { todo };
  }

  private async uncompleteTodo(params: RpcParams): Promise<{ todo: TodoRow }> {
    const id = getRequiredId(params, 'id');
    const value = await todoDataClient.uncompleteTodo({ id, actor: 'ai' });
    if (value === undefined) throw new Error(`Todo not found: ${id}`);
    const todo = requireTodoRow(
      value,
      'TodoistSyncRepository.uncompleteTodo',
      id,
    );
    if (todo.status !== 0) {
      throw new Error('TodoistSyncRepository.uncompleteTodo returned a todo that is not active');
    }
    return { todo };
  }

  private async deleteTodo(params: RpcParams): Promise<{ deleted: true; id: TodoEntityId }> {
    const id = getRequiredId(params, 'id');
    const deleted = await todoDataClient.deleteTodo(id, 'ai');
    if (deleted !== true) {
      if (deleted === null || deleted === undefined) {
        throwInvalidDaoResult(deleted, 'TodoistSyncRepository.deleteTodo', 'delete confirmation');
      }
      throw new Error(deleted === false
        ? `Todo not found or not deleted: ${id}`
        : 'TodoistSyncRepository.deleteTodo did not confirm deletion');
    }
    return { deleted: true, id };
  }

  private async moveTodo(params: RpcParams): Promise<{ moved: true; id: TodoEntityId; domainId: TodoEntityId }> {
    const id = getRequiredId(params, 'id');
    const domainId = getRequiredId(params, 'domainId');
    await this.requireActiveDomain(domainId);
    const value = await todoDataClient.moveToDomain({ id, domainId, actor: 'ai' });
    if (value === undefined) throw new Error(`Todo not found: ${id}`);
    const todo = requireTodoRow(
      value,
      'TodoistSyncRepository.moveToDomain',
      id,
      domainId,
    );
    if (todo.domain_id !== domainId) {
      throw new Error('TodoistSyncRepository.moveToDomain returned a todo in the wrong domain');
    }
    return { moved: true, id, domainId };
  }

  private async listSteps(params: RpcParams): Promise<{ todo: TodoRow; steps: StepRow[] }> {
    const todoId = getRequiredId(params, 'todoId');
    const todo = await this.requireTodo(todoId, 'TodoistSyncRepository.getTodoById for step.list');
    const steps = requireStepRows(
      await todoDataClient.getSubTodosByTodoId({ todoId }),
      'TodoistSyncRepository.getSubTodosByTodoId',
      todoId,
      todo.customer_id,
    );
    return { todo, steps };
  }

  private async createStep(params: RpcParams): Promise<{ step: StepRow }> {
    const todoId = getRequiredId(params, 'todoId');
    const title = this.getRequiredStepTitle(params);
    const todo = await this.requireTodo(todoId, 'TodoistSyncRepository.getTodoById for step.create');
    const created = requireStepRow(
      await todoDataClient.createSubTodo({ todoId, title }),
      'TodoistSyncRepository.createSubTodo',
      undefined,
      todoId,
      todo.customer_id,
    );
    if (created.title !== title || created.status !== 0) {
      throw new Error('TodoistSyncRepository.createSubTodo returned a Step that does not match the request');
    }
    const step = await this.requireStep(
      created.id,
      'TodoistSyncRepository.getSubTodoById after create',
      todo,
    );
    if (step.title !== title || step.status !== 0) {
      throw new Error('TodoistSyncRepository.createSubTodo did not persist the requested Step');
    }
    return { step };
  }

  private async updateStep(params: RpcParams): Promise<{ step: StepRow }> {
    const id = getRequiredId(params, 'id');
    const title = this.getRequiredStepTitle(params);
    const { step: existing, todo } = await this.requireStepWithParent(
      id,
      'TodoistSyncRepository.getSubTodoById before update',
    );
    await todoDataClient.updateSubTodoTitle({ id, title });
    const step = await this.requireStep(
      id,
      'TodoistSyncRepository.getSubTodoById after update',
      todo,
    );
    if (step.todo_id !== existing.todo_id || step.title !== title) {
      throw new Error('TodoistSyncRepository.updateSubTodoTitle did not persist the requested Step title');
    }
    return { step };
  }

  private async setStepCompleted(
    params: RpcParams,
    status: 0 | 1,
  ): Promise<{ step: StepRow }> {
    const id = getRequiredId(params, 'id');
    const { todo } = await this.requireStepWithParent(
      id,
      `TodoistSyncRepository.getSubTodoById before step.${status === 1 ? 'complete' : 'uncomplete'}`,
    );
    await todoDataClient.setSubTodoStatus({ id, status });
    const step = await this.requireStep(
      id,
      `TodoistSyncRepository.getSubTodoById after step.${status === 1 ? 'complete' : 'uncomplete'}`,
      todo,
    );
    if (step.status !== status) {
      throw new Error(`TodoistSyncRepository.setSubTodoStatus did not persist Step status ${status}`);
    }
    return { step };
  }

  private async deleteStep(
    params: RpcParams,
  ): Promise<{ deleted: true; id: TodoEntityId; todoId: TodoEntityId }> {
    const id = getRequiredId(params, 'id');
    const { step } = await this.requireStepWithParent(
      id,
      'TodoistSyncRepository.getSubTodoById before delete',
    );
    await todoDataClient.deleteSubTodo({ id });
    const remaining = await todoDataClient.getSubTodoById({ id });
    if (remaining !== undefined) {
      requireStepRow(
        remaining,
        'TodoistSyncRepository.getSubTodoById after delete',
        id,
        step.todo_id,
        step.customer_id,
      );
      throw new Error('TodoistSyncRepository.deleteSubTodo did not delete the requested Step');
    }
    return { deleted: true, id, todoId: step.todo_id };
  }

  private async requireTodo(id: TodoEntityId, source: string): Promise<TodoRow> {
    const value = await todoDataClient.getTodoById({ id });
    if (value === undefined) throw new Error(`Todo not found: ${id}`);
    return requireTodoRow(value, source, id);
  }

  private async requireStep(
    id: TodoEntityId,
    source: string,
    todo?: TodoRow,
  ): Promise<StepRow> {
    const value = await todoDataClient.getSubTodoById({ id });
    if (value === undefined) throw new Error(`Step not found: ${id}`);
    return requireStepRow(
      value,
      source,
      id,
      todo?.id,
      todo?.customer_id,
    );
  }

  private async requireStepWithParent(
    id: TodoEntityId,
    source: string,
  ): Promise<{ step: StepRow; todo: TodoRow }> {
    const step = await this.requireStep(id, source);
    const todo = await this.requireTodo(
      step.todo_id,
      'TodoistSyncRepository.getTodoById for Step parent',
    );
    if (step.customer_id !== todo.customer_id) {
      throw new Error(`${source} returned a Step whose customer does not match its parent Todo`);
    }
    return { step, todo };
  }

  private getRequiredStepTitle(params: RpcParams): string {
    if (typeof params.title !== 'string') throw new Error('title must be a string');
    const title = params.title.trim();
    if (title.length === 0) throw new Error('title must be a non-empty string');
    if (title.length > 200) throw new Error('title can contain at most 200 characters');
    return title;
  }

  private async requireActiveDomain(domainId: TodoEntityId): Promise<DomainRow> {
    const domains = requireDomainRows(
      await todoDataClient.getDomains(),
      'TodoistSyncRepository.getDomains',
    );
    const matches = domains.filter((domain) => domain.id === domainId && isActiveDomain(domain));
    if (matches.length !== 1) throw new Error(`Active domain not found: ${domainId}`);
    return matches[0];
  }

  private toTodoUpdateParams(
    params: RpcParams,
    requireChange = true,
  ): TodoUpdateCallParams {
    const id = getRequiredId(params, 'id');
    const updateParams: TodoUpdateCallParams = { id };

    if (params.title !== undefined) {
      if (typeof params.title !== 'string') throw new Error('title must be a string');
      const title = params.title.trim();
      if (!title) throw new Error('title must be a non-empty string');
      if (title.length > 200) throw new Error('title can contain at most 200 characters');
      updateParams.title = title;
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
      if (typeof params.note !== 'string') {
        throw new Error('note must be a string');
      }
      if (params.note.length > 10000) {
        throw new Error('note can contain at most 10000 characters');
      }
      updateParams.note = params.note;
    }

    if (requireChange && Object.keys(updateParams).length === 1) {
      throw new Error('todo.update requires at least one field to update');
    }

    return updateParams;
  }

}

export const mcpBridgeServer = new McpBridgeServer();
