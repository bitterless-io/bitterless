import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import CipherDatabase from 'better-sqlite3-multiple-ciphers';
import type {
  TodoistSyncCommand,
  TodoistSyncCommandStatus,
  TodoistSyncDomainResource,
  TodoistSyncResponse,
  TodoistSyncSubTodoResource,
  TodoistSyncTodoResource,
} from '../../src/shared/todoistSync/todoistSync.type';
import {
  parseTodoistSyncRequest,
  parseTodoistSyncRequestError,
  parseTodoistSyncResponse,
  TODOIST_SYNC_MAX_FUTURE_MS,
} from '../../src/shared/todoistSync/todoistSync.contract';
import {
  assertTodoistSyncDatabaseIsolation,
  resolveTodoistSyncDatabasePaths,
  TodoistSyncDatabase,
  type TodoistSyncExecuteResult,
  type TodoistSyncRepositoryDatabase,
  type TodoistSyncSqlExecutor,
} from '../../src/main/todoistSync/todoistSync.database';
import {
  applyTodoistSyncMigrations,
  todoistSyncMigrations,
} from '../../src/main/todoistSync/todoistSync.migration';
import {
  getOrCreateTodoistSyncRuntimePassword,
  type TodoistSyncPasswordProtection,
} from '../../src/main/todoistSync/todoistSyncPassword.service';
import {
  TODOIST_SYNC_CORE_CLOCK_DISAGREEMENT,
  TodoistSyncRepository,
  type TodoistSyncOutboxBatch,
} from '../../src/main/todoistSync/todoistSync.repository';
import { TodoistSyncSnowflakeService } from '../../src/main/todoistSync/todoistSyncSnowflake.service';
import {
  TodoistSyncClient,
  TodoistSyncHttpError,
} from '../../src/main/todoistSync/todoistSync.client';
import {
  TodoistSyncCoordinator,
  type TodoistSyncCoordinatorClient,
  type TodoistSyncScheduler,
} from '../../src/main/todoistSync/todoistSync.coordinator';
import {
  TodoistSyncClockService,
  TodoistSyncClockStateStore,
  type TodoistSyncTimeSample,
} from '../../src/main/todoistSync/todoistSyncClock.service';
import {
  TodoistSyncSessionService,
  type TodoistSyncSessionCoordinator,
} from '../../src/main/todoistSync/todoistSync.session';
import {
  isRecord,
  requireArray,
  requireOptionalItem,
  requireRecordMap,
  requireVoidResult,
} from '../../src/renderer/todo/src/store/todoResult.guard';
import { observeTodoMutation } from '../../src/renderer/todo/src/store/todoMutation.service';
import {
  TODOIST_SYNC_HTTP_ERROR_FIXTURES,
  TODOIST_SYNC_HTTP_OK_FIXTURE,
  TODOIST_SYNC_WIRE_IDS,
  TODOIST_SYNC_WIRE_REQUEST_FIXTURE,
  TODOIST_SYNC_WIRE_UUIDS,
} from './wire.fixtures';

declare global {
  var __todoistSyncSafeStorageTripwireHits: number | undefined;
  var __todoistSyncBroadcasts: Array<{ event: string; payload: unknown }> | undefined;
  var __todoMutationErrorMessages: unknown[] | undefined;
}

const TEST_PASSWORD = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const WRONG_PASSWORD = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const REMOTE_UUID = '11111111-1111-4111-8111-111111111111';
const REMOTE_DOMAIN_ID = '00000000000000000001';
const TEST_DEVICE_ID = 'todoist-sync-test-device';

const originalFs = {
  mkdirSync: fs.mkdirSync.bind(fs),
  mkdtempSync: fs.mkdtempSync.bind(fs),
  readFileSync: fs.readFileSync.bind(fs),
  rmSync: fs.rmSync.bind(fs),
  statSync: fs.statSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
};

let protectedLegacyPath: string | null = null;
let legacyFilesystemTripwireHits = 0;
let operatingSystemCredentialTripwireHits = 0;

const pathFromArgument = (value: unknown): string | null => {
  if (typeof value === 'string') return resolve(value);
  if (Buffer.isBuffer(value)) return resolve(value.toString());
  if (value instanceof URL && value.protocol === 'file:') return resolve(value.pathname);
  return null;
};

const installLegacyFilesystemTripwire = (): void => {
  const mutableFs = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const methods = [
    'accessSync',
    'appendFileSync',
    'chmodSync',
    'copyFileSync',
    'existsSync',
    'lstatSync',
    'openSync',
    'readFileSync',
    'renameSync',
    'rmSync',
    'statSync',
    'truncateSync',
    'unlinkSync',
    'writeFileSync',
  ] as const;
  for (const method of methods) {
    const original = mutableFs[method];
    Object.defineProperty(mutableFs, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const candidate = pathFromArgument(args[0]);
        if (protectedLegacyPath && candidate === protectedLegacyPath) {
          legacyFilesystemTripwireHits += 1;
          throw new Error(`[legacy database tripwire] ${method} accessed ${protectedLegacyPath}`);
        }
        return Reflect.apply(original, fs, args);
      },
    });
  }
};

const installOperatingSystemCredentialTripwire = (): void => {
  const mutableChildProcess = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  const methods = ['exec', 'execFile', 'execFileSync', 'execSync', 'spawn', 'spawnSync'] as const;
  const credentialCommand = /(^|[\\/\s])(security|cmdkey|vaultcmd)(\.exe)?([\s]|$)|credentialmanager|get-storedcredential/i;
  for (const method of methods) {
    const original = mutableChildProcess[method];
    Object.defineProperty(mutableChildProcess, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const command = args.map((value) => (
          Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : ''
        )).join(' ');
        if (credentialCommand.test(command)) {
          operatingSystemCredentialTripwireHits += 1;
          throw new Error(`[credential tripwire] ${method} attempted ${command}`);
        }
        return Reflect.apply(original, childProcess, args);
      },
    });
  }
};

installLegacyFilesystemTripwire();
installOperatingSystemCredentialTripwire();

after(() => {
  assert.equal(globalThis.__todoistSyncSafeStorageTripwireHits ?? 0, 0);
  assert.equal(operatingSystemCredentialTripwireHits, 0);
  assert.equal(legacyFilesystemTripwireHits, 0);
});

interface TestRuntime {
  root: string;
  userDataPath: string;
  database: TodoistSyncDatabase;
  repository: TodoistSyncRepository;
}

interface OutboxStateRow {
  command_order: number;
  command_uuid: string;
  command_type: string;
  state: string;
  batch_id: string | null;
  args_json: string;
}

const createRoot = (label: string): string => originalFs.mkdtempSync(join(tmpdir(), `${label}-`));

const cleanupRoot = (root: string): void => {
  protectedLegacyPath = null;
  originalFs.rmSync(root, { recursive: true, force: true });
};

const inspectProtectedLegacyFile = <T>(runner: () => T): T => {
  const path = protectedLegacyPath;
  protectedLegacyPath = null;
  try {
    return runner();
  } finally {
    protectedLegacyPath = path;
  }
};

const createRuntime = async (label: string, customerId = '1'): Promise<TestRuntime> => {
  const root = createRoot(label);
  const userDataPath = join(root, 'userData');
  const paths = resolveTodoistSyncDatabasePaths(userDataPath, customerId);
  assertTodoistSyncDatabaseIsolation(paths, userDataPath);
  const database = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
  const ids = new TodoistSyncSnowflakeService(7);
  const repository = new TodoistSyncRepository(database, customerId, TEST_DEVICE_ID, ids);
  await repository.initialize();
  await repository.setSnowflakeNodeId(7);
  return { root, userDataPath, database, repository };
};

const closeRuntime = (runtime: TestRuntime): void => {
  runtime.database.close();
  cleanupRoot(runtime.root);
};

const domainResource = (
  revision: string,
  title: string,
  options: { id?: string; description?: string; archived?: 0 | 1; deletedFlag?: string } = {},
): TodoistSyncDomainResource => ({
  id: options.id ?? REMOTE_DOMAIN_ID,
  title,
  description: options.description ?? '',
  archived: options.archived ?? 0,
  position: 0,
  created_at: 1_700_000_000_000,
  client_updated_at: 1_700_000_000_100 + Number(revision),
  version_device_id: 'remote-device',
  version_client_sequence: 1,
  version_command_uuid: REMOTE_UUID,
  sync_revision: revision,
  deleted_flag: options.deletedFlag ?? '',
  deleted_at: options.deletedFlag ? 1_700_000_000_200 : null,
});

const todoResource = (
  revision: string,
  options: {
    id?: string;
    domainId?: string;
    title?: string;
    status?: 0 | 1;
    important?: 0 | 1;
    deletedFlag?: string;
  } = {},
): TodoistSyncTodoResource => ({
  id: options.id ?? TODOIST_SYNC_WIRE_IDS.todo,
  domain_id: options.domainId ?? REMOTE_DOMAIN_ID,
  title: options.title ?? 'Remote Todo',
  status: options.status ?? 0,
  important: options.important ?? 0,
  due_at: null,
  repeat_type: null,
  repeat_interval: 1,
  remind_at: null,
  last_remind_at: null,
  last_complete_at: options.status === 1 ? 1_700_000_000_300 : null,
  week_day: null,
  monthly_day: null,
  yearly_day: null,
  note: '',
  source: 'human',
  position: 0,
  created_at: 1_700_000_000_000,
  client_updated_at: 1_700_000_000_100 + Number(revision),
  version_device_id: 'remote-device',
  version_client_sequence: 1,
  version_command_uuid: REMOTE_UUID,
  sync_revision: revision,
  deleted_flag: options.deletedFlag ?? '',
  deleted_at: options.deletedFlag ? 1_700_000_000_400 : null,
});

const subTodoResource = (
  revision: string,
  options: { id: string; todoId: string; title?: string; status?: 0 | 1 },
): TodoistSyncSubTodoResource => ({
  id: options.id,
  todo_id: options.todoId,
  title: options.title ?? 'Remote SubTodo',
  status: options.status ?? 0,
  position: 0,
  created_at: 1_700_000_000_000,
  client_updated_at: 1_700_000_000_100 + Number(revision),
  version_device_id: 'remote-device',
  version_client_sequence: 1,
  version_command_uuid: REMOTE_UUID,
  sync_revision: revision,
  deleted_flag: '',
  deleted_at: null,
});

const syncResponse = (options: {
  token: string;
  domains?: TodoistSyncDomainResource[];
  todos?: TodoistSyncTodoResource[];
  subTodos?: TodoistSyncSubTodoResource[];
  statuses?: Record<string, TodoistSyncCommandStatus>;
  hasMore?: boolean;
  fullSync?: boolean;
  phase?: TodoistSyncResponse['sync_phase'];
}): TodoistSyncResponse => ({
  sync_token: options.token,
  full_sync: options.fullSync ?? false,
  sync_phase: options.phase ?? 'incremental',
  has_more: options.hasMore ?? false,
  server_time_ms: 1_700_000_000_500,
  snowflake_node_id: 7,
  sync_status: options.statuses ?? {},
  todo_domains: options.domains ?? [],
  todos: options.todos ?? [],
  sub_todos: options.subTodos ?? [],
});

const outboxRows = async (database: TodoistSyncDatabase): Promise<OutboxStateRow[]> => {
  return await database.getAll<OutboxStateRow>(
    'SELECT command_order, command_uuid, command_type, state, batch_id, args_json FROM todo_sync_outbox ORDER BY command_order',
  );
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const cloneFixture = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class ManualScheduler implements TodoistSyncScheduler {
  readonly delays: number[] = [];
  private readonly callbacks = new Map<object, () => void>();

  setTimeout(callback: () => void, delayMs: number): object {
    const handle = {};
    this.delays.push(delayMs);
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimeout(timer: unknown): void {
    if (typeof timer === 'object' && timer !== null) this.callbacks.delete(timer);
  }

  fireNext(): void {
    const entry = this.callbacks.entries().next().value as [object, () => void] | undefined;
    if (!entry) throw new Error('No Todoist sync timer is scheduled');
    this.callbacks.delete(entry[0]);
    entry[1]();
  }

  get size(): number {
    return this.callbacks.size;
  }
}

class DeferredSyncClient implements TodoistSyncCoordinatorClient {
  readonly calls: Array<{ syncToken: string; commands: TodoistSyncCommand[] }> = [];
  readonly responses: Array<Deferred<TodoistSyncResponse>> = [];
  maxActive = 0;
  private active = 0;

  async sync(syncToken: string, commands: TodoistSyncCommand[]): Promise<TodoistSyncResponse> {
    this.calls.push({ syncToken, commands });
    const response = deferred<TodoistSyncResponse>();
    this.responses.push(response);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      return await response.promise;
    } finally {
      this.active -= 1;
    }
  }

  dispose(): void {}
}

const timeSample = (source: string, offsetMs: number, localTimeMs = 1_800_000_000_000): TodoistSyncTimeSample => ({
  source,
  local_time_ms: localTimeMs,
  trusted_time_ms: localTimeMs + offsetMs,
  offset_ms: offsetMs,
  round_trip_ms: 10,
});

class FailingOutboxDatabase implements TodoistSyncRepositoryDatabase {
  private shouldFail = true;

  constructor(private readonly database: TodoistSyncDatabase) {}

  async execute(sql: string, values?: unknown[]): Promise<TodoistSyncExecuteResult> {
    return await this.database.execute(sql, values);
  }

  async getAll<T>(sql: string, values?: unknown[]): Promise<T[]> {
    return await this.database.getAll<T>(sql, values);
  }

  async getOptional<T>(sql: string, values?: unknown[]): Promise<T | undefined> {
    return await this.database.getOptional<T>(sql, values);
  }

  async get<T>(sql: string, values?: unknown[]): Promise<T> {
    return await this.database.get<T>(sql, values);
  }

  async writeTransaction<T>(
    runner: (tx: TodoistSyncSqlExecutor) => Promise<T>,
    beforeCommit?: () => void,
  ): Promise<T> {
    return await this.database.writeTransaction(async (tx) => await runner({
      execute: async (sql, values) => {
        if (this.shouldFail && /INSERT INTO todo_sync_outbox/.test(sql)) {
          this.shouldFail = false;
          throw new Error('injected outbox write failure');
        }
        return await tx.execute(sql, values);
      },
      getAll: async <Row>(sql: string, values?: unknown[]) => await tx.getAll<Row>(sql, values),
      getOptional: async <Row>(sql: string, values?: unknown[]) => await tx.getOptional<Row>(sql, values),
      get: async <Row>(sql: string, values?: unknown[]) => await tx.get<Row>(sql, values),
    }), beforeCommit);
  }
}

class CommitFenceDatabase implements TodoistSyncRepositoryDatabase {
  private armed = false;

  constructor(
    private readonly database: TodoistSyncDatabase,
    private readonly changeGeneration: () => void,
  ) {}

  arm(): void {
    this.armed = true;
  }

  async execute(sql: string, values?: unknown[]): Promise<TodoistSyncExecuteResult> {
    return await this.database.execute(sql, values);
  }

  async getAll<T>(sql: string, values?: unknown[]): Promise<T[]> {
    return await this.database.getAll<T>(sql, values);
  }

  async getOptional<T>(sql: string, values?: unknown[]): Promise<T | undefined> {
    return await this.database.getOptional<T>(sql, values);
  }

  async get<T>(sql: string, values?: unknown[]): Promise<T> {
    return await this.database.get<T>(sql, values);
  }

  async writeTransaction<T>(
    runner: (tx: TodoistSyncSqlExecutor) => Promise<T>,
    beforeCommit?: () => void,
  ): Promise<T> {
    return await this.database.writeTransaction(runner, () => {
      if (this.armed) {
        this.armed = false;
        this.changeGeneration();
      }
      beforeCommit?.();
    });
  }
}

test('shared wire fixtures enforce exact request, HTTP 200, permanent status, and 400/409/503 shapes', { concurrency: false }, async () => {
  const parsedRequest = parseTodoistSyncRequest(cloneFixture(TODOIST_SYNC_WIRE_REQUEST_FIXTURE));
  assert.equal(parsedRequest.commands.length, 9);
  for (const command of parsedRequest.commands) {
    assert.equal(typeof command.args.client_updated_at, 'number');
    assert.equal(typeof command.args.client_sequence, 'number');
    assert.equal(typeof command.args.base_revision, 'string');
  }
  const invalidRequest = cloneFixture(TODOIST_SYNC_WIRE_REQUEST_FIXTURE) as unknown as {
    commands: Array<{ args: Record<string, unknown> }>;
  };
  invalidRequest.commands[0].args.unknown = true;
  assert.throws(() => parseTodoistSyncRequest(invalidRequest), /unknown is not allowed/);

  const submitted = parsedRequest.commands.slice(0, 2);
  const parsedResponse = parseTodoistSyncResponse(
    cloneFixture(TODOIST_SYNC_HTTP_OK_FIXTURE),
    submitted.map((command) => command.uuid),
  );
  assert.equal(parsedResponse.server_time_ms, TODOIST_SYNC_HTTP_OK_FIXTURE.server_time_ms);
  assert.equal(parsedResponse.sync_status[submitted[0].uuid].status, 'ok');
  assert.equal(parsedResponse.sync_status[submitted[1].uuid].status, 'error');
  assert.deepEqual(Object.keys(parsedResponse.todo_domains[0]).sort(), Object.keys(TODOIST_SYNC_HTTP_OK_FIXTURE.todo_domains[0]).sort());

  assert.equal(parseTodoistSyncRequestError(cloneFixture(TODOIST_SYNC_HTTP_ERROR_FIXTURES.requestInvalid), 400).code, 'REQUEST_INVALID');
  assert.equal(parseTodoistSyncRequestError(cloneFixture(TODOIST_SYNC_HTTP_ERROR_FIXTURES.clockSkew), 409).max_future_ms, TODOIST_SYNC_MAX_FUTURE_MS);
  assert.equal(parseTodoistSyncRequestError(cloneFixture(TODOIST_SYNC_HTTP_ERROR_FIXTURES.unavailable), 503).code, 'TODO_SYNC_UNAVAILABLE');
  assert.throws(
    () => parseTodoistSyncRequestError(cloneFixture(TODOIST_SYNC_HTTP_ERROR_FIXTURES.clockSkew), 400),
    /status|HTTP/,
  );
  const invalidPhase = cloneFixture(TODOIST_SYNC_HTTP_OK_FIXTURE) as { full_sync: boolean };
  invalidPhase.full_sync = true;
  assert.throws(
    () => parseTodoistSyncResponse(invalidPhase, submitted.map((command) => command.uuid)),
    /incremental phase fields/,
  );

  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(TODOIST_SYNC_HTTP_OK_FIXTURE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new TodoistSyncClient({
    coreToken: 'fixture-core-token',
    baseUrl: 'https://core.example.invalid/',
    fetchImpl,
  });
  const response = await client.sync('*', submitted);
  assert.equal(requestUrl, 'https://core.example.invalid/todo/sync');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { sync_token: '*', commands: submitted });
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get('-x-bl-token'), 'fixture-core-token');
  assert.equal(response.sync_token, 'fixture-token-v1');
  client.dispose();
});

test('Todo renderer result guards reject null/malformed data and reserve undefined for capacity', { concurrency: false }, () => {
  const isIdRow = (value: unknown): value is { id: string } => (
    isRecord(value) && typeof value.id === 'string'
  );
  const isCount = (value: unknown): value is { total: number; done: number } => (
    isRecord(value) && Number.isSafeInteger(value.total) && Number.isSafeInteger(value.done)
  );
  assert.deepEqual(requireArray([{ id: '1' }], 'rows', isIdRow), [{ id: '1' }]);
  assert.throws(() => requireArray(null, 'rows', isIdRow), /invalid required result/);
  assert.throws(() => requireArray([{}], 'rows', isIdRow), /invalid required result/);
  assert.deepEqual(
    requireRecordMap({ '1': { total: 1, done: 0 } }, ['1'], 'counts', isCount),
    { '1': { total: 1, done: 0 } },
  );
  assert.throws(() => requireRecordMap(null, ['1'], 'counts', isCount), /invalid required result/);
  assert.throws(() => requireRecordMap({}, ['1'], 'counts', isCount), /omitted required key 1/);
  assert.equal(requireOptionalItem(undefined, 'Domain create', isIdRow), undefined);
  assert.throws(() => requireOptionalItem(null, 'Domain create', isIdRow), /invalid optional result/);
  assert.equal(requireVoidResult(undefined, 'Domain update'), undefined);
  assert.throws(() => requireVoidResult(null, 'Domain update'), /invalid void result/);
  assert.throws(() => requireVoidResult(false, 'Domain update'), /invalid void result/);

  const storeSource = originalFs.readFileSync(
    resolve('src/renderer/todo/src/store/todo.store.ts'),
    'utf8',
  );
  const createDomainSource = storeSource.match(
    /  async createDomain\([\s\S]*?\n  \}(?=\n\n  async updateDomainTitle)/,
  );
  assert(createDomainSource);
  assert.match(createDomainSource[0], /if \(domain === undefined\)/);
  assert.match(createDomainSource[0], /Message\.warning\(i18nHelper\.todo\.domainLimitReached\)/);
  assert.doesNotMatch(createDomainSource[0], /if \(!domain\)|if \(domain\)/);
});

test('Todo UI mutation observation contains null XPC guard failures without unhandled rejection', { concurrency: false }, async () => {
  const fakeTodoEmitter = {
    update: async (): Promise<null> => null,
    setSortOrder: async (): Promise<null> => null,
  };
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  const originalConsoleError = console.error;
  globalThis.__todoMutationErrorMessages = [];
  console.error = () => undefined;
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    void observeTodoMutation(async () => {
      requireOptionalItem(await fakeTodoEmitter.update(), 'Todo update', isRecord);
    });
    void observeTodoMutation(async () => {
      requireVoidResult(await fakeTodoEmitter.setSortOrder(), 'Todo sort order update');
    });
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    assert.deepEqual(unhandledRejections, []);
    assert.equal(globalThis.__todoMutationErrorMessages.length, 2);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    console.error = originalConsoleError;
    globalThis.__todoMutationErrorMessages = undefined;
  }

  const guardedComponentSources = [
    'src/renderer/todo/src/App.vue',
    'src/renderer/todo/src/components/DomainColumn/DomainColumn.vue',
    'src/renderer/todo/src/components/FocusedColumn/FocusedColumn.vue',
    'src/renderer/todo/src/components/MenuBar/MenuBar.vue',
    'src/renderer/todo/src/components/TodoDetail/TodoDetail.vue',
    'src/renderer/todo/src/components/TodoRow/TodoRow.vue',
  ];
  for (const sourcePath of guardedComponentSources) {
    const source = originalFs.readFileSync(resolve(sourcePath), 'utf8');
    assert.match(source, /observeTodoMutation/);
  }
});

test('Todo menubar exposes one hover Refresh control with truthful sync status', { concurrency: false }, () => {
  const menuSource = originalFs.readFileSync(
    resolve('src/renderer/todo/src/components/MenuBar/MenuBar.vue'),
    'utf8',
  );
  const styleSource = originalFs.readFileSync(
    resolve('src/renderer/todo/src/components/MenuBar/MenuBar.less'),
    'utf8',
  );
  const englishSource = originalFs.readFileSync(
    resolve('src/renderer/common/i18n/en.ts'),
    'utf8',
  );
  const chineseSource = originalFs.readFileSync(
    resolve('src/renderer/common/i18n/zh.ts'),
    'utf8',
  );
  const refreshPopover = menuSource.match(
    /<a-popover trigger="hover" position="br">[\s\S]*?<\/a-popover>/,
  );
  const refreshHandler = menuSource.match(
    /const handleRefresh = \(\) => \{[\s\S]*?\n\};/,
  );
  const statusLabel = menuSource.match(
    /const syncStatusLabel = computed\(\(\) => \{[\s\S]*?\n\}\);/,
  );

  assert.ok(refreshPopover, 'Refresh must own the hover sync-status popover');
  assert.ok(refreshHandler, 'Missing Refresh handler');
  assert.ok(statusLabel, 'Missing localized current-result projection');
  assert.equal((menuSource.match(/<IconRefresh\b/g) ?? []).length, 1);
  assert.equal((menuSource.match(/@click="handleRefresh"/g) ?? []).length, 1);
  assert.doesNotMatch(menuSource, /IconCloud/);
  assert.match(refreshPopover[0], /<a-badge :count="todoistSyncStore\.failures\.length"/);
  assert.match(
    refreshPopover[0],
    /<IconRefresh :class="\{ 'menubar__refresh-icon--active': todoistSyncStore\.status\?\.syncing \}"/,
  );
  assert.match(refreshPopover[0], /i18nHelper\.todo\.syncCurrentResult/);
  assert.match(refreshPopover[0], /i18nHelper\.todo\.syncLastSuccessful/);
  assert.match(refreshPopover[0], /i18nHelper\.todo\.syncErrorReason/);
  assert.match(refreshPopover[0], /i18nHelper\.todo\.syncPermanentFailures/);
  assert.match(refreshPopover[0], /handleRetrySync\(failure\.uuid\)/);
  assert.match(refreshPopover[0], /handleDiscardSync\(failure\.uuid\)/);

  assert.match(refreshHandler[0], /todoistSyncStore\.requestSync\(\)/);
  assert.match(refreshHandler[0], /todoStore\.loadAll\(\)/);
  assert.match(refreshHandler[0], /Promise\.all/);
  assert.match(statusLabel[0], /i18nHelper\.todo\.syncStatusSyncing/);
  assert.match(statusLabel[0], /i18nHelper\.todo\.syncStatusPullOnly/);
  assert.match(statusLabel[0], /i18nHelper\.todo\.syncStatusFailed/);
  assert.match(statusLabel[0], /i18nHelper\.todo\.syncStatusSucceeded/);
  assert.doesNotMatch(statusLabel[0], /return todoistSyncStore\.status\.last_error/);
  assert.match(menuSource, /dayjs\(value\)\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.match(menuSource, /i18nHelper\.todo\.syncNeverSynchronized/);
  assert.match(
    menuSource,
    /SNOWFLAKE_NODE_MISMATCH_ERROR = '\[todoist sync\] server changed this device Snowflake node'/,
  );
  assert.match(menuSource, /i18nHelper\.todo\.syncErrorDeviceIdentityMismatch/);
  assert.match(styleSource, /\.menubar__refresh-icon--active \{\n  animation: todo-sync-spin/);

  for (const key of [
    'syncStatusSucceeded',
    'syncStatusFailed',
    'syncCurrentResult',
    'syncLastSuccessful',
    'syncNeverSynchronized',
    'syncErrorReason',
    'syncErrorDeviceIdentityMismatch',
    'syncPermanentFailures',
  ]) {
    assert.match(englishSource, new RegExp(`${key}:`));
    assert.match(chineseSource, new RegExp(`${key}:`));
  }
});

test('fixed-password SQLCipher create, protected-key first run, reopen, and wrong password', { concurrency: false }, () => {
  const root = createRoot('bitterless-todoist-cipher');
  const userDataPath = join(root, 'userData');
  const legacyPath = resolve(userDataPath, 'db', 'main.db');
  originalFs.mkdirSync(join(userDataPath, 'db'), { recursive: true });
  originalFs.writeFileSync(legacyPath, Buffer.from('legacy-main-db-sentinel'));
  const legacyBefore = originalFs.statSync(legacyPath);
  protectedLegacyPath = legacyPath;

  try {
    const paths = resolveTodoistSyncDatabasePaths(userDataPath, '1');
    assert.equal(basename(paths.databasePath), 'customer-1.db');
    assertTodoistSyncDatabaseIsolation(paths, userDataPath);
    const protection: TodoistSyncPasswordProtection = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`wrapped:${value}`),
      decryptString: (value) => value.toString().slice('wrapped:'.length),
    };
    const password = getOrCreateTodoistSyncRuntimePassword(paths, {
      protection,
      generatePassword: () => TEST_PASSWORD,
    });
    assert.equal(password, TEST_PASSWORD);
    assert.equal(getOrCreateTodoistSyncRuntimePassword(paths, { protection }), TEST_PASSWORD);
    if (process.platform !== 'win32') {
      assert.equal(originalFs.statSync(paths.directory).mode & 0o777, 0o700);
      assert.equal(originalFs.statSync(paths.keyPath).mode & 0o777, 0o600);
    }

    const database = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    assert.equal(database.raw.pragma('cipher', { simple: true }), 'sqlcipher');
    database.raw.prepare(
      `INSERT INTO todo_sync_state (
        customer_id, device_id, sync_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('1', TEST_DEVICE_ID, 'persisted-token', 1, 1);
    database.assertHealthy();
    database.close();

    const header = originalFs.readFileSync(paths.databasePath).subarray(0, 16).toString('utf8');
    assert.notEqual(header, 'SQLite format 3\u0000');
    const reopened = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    const state = reopened.raw.prepare(
      'SELECT sync_token FROM todo_sync_state WHERE customer_id = ?',
    ).get('1') as { sync_token: string };
    assert.equal(state.sync_token, 'persisted-token');
    reopened.assertHealthy();
    reopened.close();
    assert.throws(
      () => new TodoistSyncDatabase(paths.databasePath, WRONG_PASSWORD),
      /file is not a database|encrypted|malformed/i,
    );
    assert.throws(
      () => new TodoistSyncDatabase(legacyPath, TEST_PASSWORD),
      /refusing to open legacy main\.db/,
    );
    const legacyAfter = inspectProtectedLegacyFile(() => {
      assert.equal(originalFs.readFileSync(legacyPath).toString(), 'legacy-main-db-sentinel');
      return originalFs.statSync(legacyPath);
    });
    assert.equal(legacyAfter.size, legacyBefore.size);
    assert.equal(legacyAfter.mtimeMs, legacyBefore.mtimeMs);
  } finally {
    cleanupRoot(root);
  }
});

test('encrypted pre-parent v1 upgrades to the exact v2 ledger without losing state or baseline rows', { concurrency: false }, () => {
  const root = createRoot('bitterless-todoist-encrypted-v1-upgrade');
  const paths = resolveTodoistSyncDatabasePaths(join(root, 'userData'), '1');
  originalFs.mkdirSync(paths.directory, { recursive: true });
  const v1 = new CipherDatabase(paths.databasePath);
  try {
    v1.pragma("cipher = 'sqlcipher'");
    v1.pragma('legacy = 4');
    v1.pragma(`key = '${TEST_PASSWORD}'`);
    v1.pragma('cipher_page_size = 8192');
    v1.pragma('foreign_keys = ON');
    applyTodoistSyncMigrations(v1, [todoistSyncMigrations[0]]);
    v1.prepare(
      `INSERT INTO todo_sync_state (
        customer_id, device_id, sync_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('1', TEST_DEVICE_ID, 'encrypted-v1-sentinel', 1, 1);
    v1.prepare(
      `INSERT INTO todo_sync_baselines (
        resource_type, resource_id, sync_revision, payload_json, reconcile_pending, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('todo_domain', REMOTE_DOMAIN_ID, '9', '{"title":"encrypted-v1"}', 0, 1);
  } finally {
    v1.close();
  }

  const upgraded = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
  try {
    const ledger = upgraded.raw.prepare(
      'SELECT version, name FROM todoist_sync_schema ORDER BY version',
    ).all();
    assert.deepEqual(ledger, todoistSyncMigrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
    })));
    const state = upgraded.raw.prepare(
      'SELECT sync_token FROM todo_sync_state WHERE customer_id = ?',
    ).get('1') as { sync_token: string };
    assert.equal(state.sync_token, 'encrypted-v1-sentinel');
    const baseline = upgraded.raw.prepare(
      `SELECT payload_json, parent_resource_id FROM todo_sync_baselines
       WHERE resource_type = 'todo_domain' AND resource_id = ?`,
    ).get(REMOTE_DOMAIN_ID) as { payload_json: string; parent_resource_id: string | null };
    assert.equal(baseline.payload_json, '{"title":"encrypted-v1"}');
    assert.equal(baseline.parent_resource_id, null);
    assert.equal(upgraded.raw.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(upgraded.raw.pragma('foreign_key_check'), []);
  } finally {
    upgraded.close();
    cleanupRoot(root);
  }
});

test('real repository CRUD is atomic with outbox, events, and soft-delete cascades', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-crud');
  try {
    const faultingRepository = new TodoistSyncRepository(
      new FailingOutboxDatabase(runtime.database),
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await assert.rejects(
      () => faultingRepository.createDomain({ title: 'must roll back' }),
      /injected outbox write failure/,
    );
    assert.equal((await runtime.database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM todo_domains',
    )).count, 0);
    assert.equal((await runtime.database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM todo_sync_outbox',
    )).count, 0);
    assert.equal((await runtime.database.get<{ device_sequence: number }>(
      'SELECT device_sequence FROM todo_sync_state WHERE customer_id = ?', ['1'],
    )).device_sequence, 0);

    const domain = await runtime.repository.createDomain({ title: 'Inbox', description: 'Local' });
    assert(domain);
    const todo = await runtime.repository.createTodo({ domainId: domain.id, title: 'First Todo' });
    assert(todo);
    const subTodo = await runtime.repository.createSubTodo({ todoId: todo.id, title: 'Step one' });
    assert(subTodo);
    assert.equal((await runtime.repository.getCountByTodoId({ todoId: todo.id })).total, 1);
    assert.equal((await runtime.repository.updateTodo({ id: todo.id, title: 'Updated Todo' }))?.title, 'Updated Todo');
    assert.equal((await runtime.repository.updateRepeatType({ id: todo.id, repeatType: 'daily' }))?.repeat_type, 'daily');
    assert.equal((await runtime.repository.updateRepeatInterval({ id: todo.id, interval: 2 }))?.repeat_interval, 2);
    await runtime.repository.completeTodo({ id: todo.id });
    await runtime.repository.uncompleteTodo({ id: todo.id });
    assert.equal((await runtime.repository.toggleImportant({ id: todo.id }))?.important, 1);
    await runtime.repository.toggleSubTodoStatus({ id: subTodo.id });
    assert.equal((await runtime.repository.getSubTodoById({ id: subTodo.id }))?.status, 1);
    assert.deepEqual(await runtime.repository.getSortOrder({ key: 'domain' }), [domain.id]);
    await runtime.repository.setSortOrder({ key: 'domain', order: [domain.id] });
    await runtime.repository.setDomainArchived({ id: domain.id, archived: 1 });
    assert.equal(await runtime.repository.restoreDomain({ id: domain.id }), 'restored');

    const eventsBeforeDelete = await runtime.repository.listAfter({ limit: 100 });
    const eventTypes = eventsBeforeDelete.events.map((event) => event.type);
    assert(eventTypes.includes('todo.created'));
    assert(eventTypes.includes('todo.updated'));
    assert(eventTypes.includes('todo.completed'));
    assert(eventTypes.includes('todo.uncompleted'));
    assert(eventTypes.includes('todo.starred'));
    assert(eventsBeforeDelete.events.every((event) => event.actor === 'human'));

    await runtime.repository.deleteDomain({ id: domain.id });
    assert.equal(await runtime.repository.getDomainById({ id: domain.id }), undefined);
    assert.equal(await runtime.repository.getTodoById({ id: todo.id }), undefined);
    assert.equal(await runtime.repository.getSubTodoById({ id: subTodo.id }), undefined);
    const tombstones = await runtime.database.get<{
      domains: number;
      todos: number;
      sub_todos: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM todo_domains WHERE deleted_flag <> '') AS domains,
        (SELECT COUNT(*) FROM todos WHERE deleted_flag <> '') AS todos,
        (SELECT COUNT(*) FROM sub_todos WHERE deleted_flag <> '') AS sub_todos`,
    );
    assert.deepEqual(tombstones, { domains: 1, todos: 1, sub_todos: 1 });
    const eventsAfterDelete = await runtime.repository.listAfter({ limit: 100 });
    assert(eventsAfterDelete.events.some((event) => event.type === 'todo.deleted'));
    assert((await outboxRows(runtime.database)).length >= 10);
    runtime.database.assertHealthy();
  } finally {
    closeRuntime(runtime);
  }
});

test('real repository returns dense SubTodo counts for every unique requested Todo', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-dense-subtodo-counts');
  try {
    const domain = await runtime.repository.createDomain({ title: 'Count domain' });
    assert(domain);
    const emptyTodo = await runtime.repository.createTodo({ domainId: domain.id, title: 'No steps' });
    const populatedTodo = await runtime.repository.createTodo({ domainId: domain.id, title: 'Two steps' });
    assert(emptyTodo);
    assert(populatedTodo);
    const incompleteSubTodo = await runtime.repository.createSubTodo({ todoId: populatedTodo.id, title: 'Incomplete' });
    const completedSubTodo = await runtime.repository.createSubTodo({ todoId: populatedTodo.id, title: 'Complete' });
    assert(incompleteSubTodo);
    assert(completedSubTodo);
    await runtime.repository.toggleSubTodoStatus({ id: completedSubTodo.id });

    assert.deepEqual(
      await runtime.repository.getCountsByTodoIds({
        todoIds: [emptyTodo.id, populatedTodo.id, emptyTodo.id],
      }),
      {
        [emptyTodo.id]: { total: 0, done: 0 },
        [populatedTodo.id]: { total: 2, done: 1 },
      },
    );
    assert.deepEqual(await runtime.repository.getCountsByTodoIds({ todoIds: [] }), {});
  } finally {
    closeRuntime(runtime);
  }
});

test('remote Todo projections emit exact system events without feedback outbox commands', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-remote-events');
  const secondDomainId = '00000000000000000002';
  try {
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-1',
      domains: [domainResource('1', 'Remote domain')],
      todos: [todoResource('1')],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-2',
      todos: [todoResource('2', { title: 'Renamed remotely' })],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-3',
      todos: [todoResource('3', { title: 'Renamed remotely', status: 1 })],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-4',
      domains: [domainResource('1', 'Second domain', { id: secondDomainId })],
      todos: [todoResource('4', { title: 'Renamed remotely', status: 1, domainId: secondDomainId })],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-5',
      todos: [todoResource('5', { title: 'Renamed remotely', status: 1, domainId: secondDomainId, important: 1 })],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'events-6',
      todos: [todoResource('6', {
        title: 'Renamed remotely',
        status: 1,
        domainId: secondDomainId,
        important: 1,
        deletedFlag: 'remote-delete',
      })],
    }), null);

    const events = (await runtime.repository.listAfter({ limit: 100 })).events;
    assert.deepEqual(events.map((event) => event.type), [
      'todo.created',
      'todo.updated',
      'todo.completed',
      'todo.moved',
      'todo.starred',
      'todo.deleted',
    ]);
    assert(events.every((event) => event.actor === 'system'));
    assert.deepEqual(events[0].payload, { title: 'Remote Todo', source: 'human' });
    assert.deepEqual(events[1].payload, { title: 'Remote Todo', changedFields: ['title'] });
    assert((events[3].payload.changedFields as string[]).includes('domain_id'));
    assert.equal((await outboxRows(runtime.database)).length, 0);
    assert.equal(await runtime.repository.getTodoById({ id: TODOIST_SYNC_WIRE_IDS.todo }), undefined);
  } finally {
    closeRuntime(runtime);
  }
});

test('reconcile commits 500 Todo baselines before an archived Domain and materializes them after restart', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-reconcile-domain-after-todos');
  const domainId = '00000000000001000000';
  const todos = Array.from({ length: 500 }, (_, index) => todoResource('1', {
    id: (2_000_000n + BigInt(index)).toString().padStart(20, '0'),
    domainId,
    title: `Deferred Todo ${index}`,
  }));
  let activeDatabase: TodoistSyncDatabase | null = runtime.database;
  try {
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'reconcile-domain-page-1',
      todos,
      fullSync: true,
      phase: 'reconcile',
      hasMore: true,
    }), null);
    assert.equal((await runtime.repository.getSyncState()).sync_token, 'reconcile-domain-page-1');
    assert.equal((await runtime.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_sync_baselines WHERE resource_type='todo' AND parent_resource_id=?",
      [domainId],
    )).count, 500);
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM todos')).count, 0);
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM todo_events')).count, 0);
    runtime.database.assertHealthy();

    activeDatabase.close();
    activeDatabase = null;
    const paths = resolveTodoistSyncDatabasePaths(runtime.userDataPath, '1');
    const reopenedDatabase = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    activeDatabase = reopenedDatabase;
    const reopenedRepository = new TodoistSyncRepository(
      reopenedDatabase,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await reopenedRepository.initialize();
    assert.equal((await reopenedRepository.getSyncState()).sync_token, 'reconcile-domain-page-1');
    const parent = domainResource('2', 'Archived parent', { id: domainId, archived: 1 });
    await reopenedRepository.applySyncResponse(syncResponse({
      token: 'reconcile-domain-page-2',
      domains: [parent],
      fullSync: true,
      phase: 'reconcile',
    }), null);
    assert.equal((await reopenedDatabase.get<{ count: number }>('SELECT COUNT(*) AS count FROM todos')).count, 500);
    assert.equal((await reopenedDatabase.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM todos WHERE domain_id=?', [domainId],
    )).count, 500);
    assert.equal((await reopenedDatabase.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_events WHERE type='todo.created' AND actor='system'",
    )).count, 500);
    assert.deepEqual(await outboxRows(reopenedDatabase), []);
    await reopenedRepository.applySyncResponse(syncResponse({
      token: 'reconcile-domain-repeat',
      domains: [parent],
      fullSync: true,
      phase: 'reconcile',
    }), null);
    assert.equal((await reopenedDatabase.get<{ count: number }>('SELECT COUNT(*) AS count FROM todos')).count, 500);
    assert.equal((await reopenedDatabase.get<{ count: number }>('SELECT COUNT(*) AS count FROM todo_events')).count, 500);
    reopenedDatabase.assertHealthy();
  } finally {
    activeDatabase?.close();
    cleanupRoot(runtime.root);
  }
});

test('reconcile commits 500 SubTodo baselines before a completed Todo and materializes them once', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-reconcile-todo-after-subtodos');
  const domainId = '00000000000002000000';
  const todoId = '00000000000003000000';
  const subTodos = Array.from({ length: 500 }, (_, index) => subTodoResource('2', {
    id: (4_000_000n + BigInt(index)).toString().padStart(20, '0'),
    todoId,
    title: `Deferred SubTodo ${index}`,
  }));
  try {
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'completed-parent-domain',
      domains: [domainResource('1', 'Live parent Domain', { id: domainId })],
    }), null);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'reconcile-subtodo-page-1',
      subTodos,
      fullSync: true,
      phase: 'reconcile',
      hasMore: true,
    }), null);
    assert.equal((await runtime.repository.getSyncState()).sync_token, 'reconcile-subtodo-page-1');
    assert.equal((await runtime.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_sync_baselines WHERE resource_type='sub_todo' AND parent_resource_id=?",
      [todoId],
    )).count, 500);
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM sub_todos')).count, 0);

    const completedParent = todoResource('3', { id: todoId, domainId, status: 1, title: 'Completed parent' });
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'reconcile-subtodo-page-2',
      todos: [completedParent],
      fullSync: true,
      phase: 'reconcile',
    }), null);
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM sub_todos')).count, 500);
    assert.equal((await runtime.database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sub_todos WHERE todo_id=?', [todoId],
    )).count, 500);
    assert.equal((await runtime.repository.getTodoById({ id: todoId }))?.status, 1);
    assert.deepEqual(await outboxRows(runtime.database), []);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'reconcile-subtodo-repeat',
      todos: [completedParent],
      fullSync: true,
      phase: 'reconcile',
    }), null);
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM sub_todos')).count, 500);
    assert.equal((await runtime.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_events WHERE type='todo.created' AND actor='system'",
    )).count, 1);
    runtime.database.assertHealthy();
  } finally {
    closeRuntime(runtime);
  }
});

test('an acknowledged Todo baseline waits for its missing Domain projection without retaining outbox state', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-ack-before-parent');
  const sourceDomainId = '00000000000005000000';
  const targetDomainId = '00000000000006000000';
  try {
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'ack-source-domain',
      domains: [domainResource('1', 'Source Domain', { id: sourceDomainId })],
    }), null);
    const todo = await runtime.repository.createTodo({ domainId: sourceDomainId, title: 'Pending canonical parent' });
    assert(todo);
    const batch = await runtime.repository.takePendingBatch();
    assert(batch);
    assert.equal(batch.commands.length, 1);
    const commandUuid = batch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'ack-before-parent',
      todos: [todoResource('2', { id: todo.id, domainId: targetDomainId, title: todo.title })],
      statuses: {
        [commandUuid]: {
          status: 'ok',
          applied: true,
          sync_revision: '2',
          canonical_resource: { resource_type: 'todo', id: todo.id },
        },
      },
    }), batch);
    assert.equal((await runtime.repository.getSyncState()).sync_token, 'ack-before-parent');
    assert.deepEqual(await outboxRows(runtime.database), []);
    assert.equal((await runtime.repository.getTodoById({ id: todo.id }))?.domain_id, sourceDomainId);
    assert.equal((await runtime.database.get<{ parent_resource_id: string }>(
      "SELECT parent_resource_id FROM todo_sync_baselines WHERE resource_type='todo' AND resource_id=?",
      [todo.id],
    )).parent_resource_id, targetDomainId);

    const targetDomain = domainResource('3', 'Target Domain', { id: targetDomainId, archived: 1 });
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'ack-parent-arrived',
      domains: [targetDomain],
    }), null);
    assert.equal((await runtime.repository.getTodoById({ id: todo.id }))?.domain_id, targetDomainId);
    assert.equal((await runtime.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_events WHERE type='todo.moved' AND actor='system' AND todo_id=?",
      [todo.id],
    )).count, 1);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'ack-parent-repeat',
      domains: [targetDomain],
    }), null);
    assert.equal((await runtime.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_events WHERE type='todo.moved' AND actor='system' AND todo_id=?",
      [todo.id],
    )).count, 1);
    runtime.database.assertHealthy();
  } finally {
    closeRuntime(runtime);
  }
});

test('first bootstrap installs the assigned node before emitting a remote Todo event', { concurrency: false }, async () => {
  const root = createRoot('bitterless-todoist-first-bootstrap-event');
  const userDataPath = join(root, 'userData');
  const paths = resolveTodoistSyncDatabasePaths(userDataPath, '1');
  const database = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
  try {
    const repository = new TodoistSyncRepository(
      database,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(null),
    );
    await repository.initialize();
    await repository.applySyncResponse(syncResponse({
      token: 'first-bootstrap-token',
      domains: [domainResource('1', 'Remote bootstrap domain')],
      todos: [todoResource('2', { domainId: REMOTE_DOMAIN_ID, title: 'Remote bootstrap Todo' })],
    }), null);
    const events = (await repository.listAfter({ limit: 100 })).events;
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'todo.created');
    assert.equal(events[0].actor, 'system');
    assert.equal((await repository.getSyncState()).snowflake_node_id, 7);
    assert.deepEqual(await outboxRows(database), []);
  } finally {
    database.close();
    cleanupRoot(root);
  }
});

test('a conflicting server Snowflake node leaves the cached node and sync state unchanged', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-conflicting-node');
  try {
    const before = await runtime.repository.getSyncState();
    const conflictingResponse = syncResponse({ token: 'must-not-commit-conflicting-node' });
    conflictingResponse.snowflake_node_id = 8;

    await assert.rejects(
      () => runtime.repository.applySyncResponse(conflictingResponse, null),
      /server changed this device Snowflake node/,
    );
    assert.deepEqual(await runtime.repository.getSyncState(), before);

    await runtime.repository.applySyncResponse(syncResponse({ token: 'cached-node-remains-valid' }), null);
    const recovered = await runtime.repository.getSyncState();
    assert.equal(recovered.snowflake_node_id, 7);
    assert.equal(recovered.sync_token, 'cached-node-remains-valid');
  } finally {
    closeRuntime(runtime);
  }
});

test('a fenced first bootstrap restores the unassigned in-memory and persisted node state', { concurrency: false }, async () => {
  const root = createRoot('bitterless-todoist-first-bootstrap-fence');
  const userDataPath = join(root, 'userData');
  const paths = resolveTodoistSyncDatabasePaths(userDataPath, '1');
  const database = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
  const ids = new TodoistSyncSnowflakeService(null);
  try {
    const repository = new TodoistSyncRepository(database, '1', TEST_DEVICE_ID, ids);
    await repository.initialize();
    await assert.rejects(
      () => repository.applySyncResponse(syncResponse({
        token: 'must-not-commit-first-bootstrap',
        domains: [domainResource('1', 'Fenced bootstrap domain')],
        todos: [todoResource('2', { domainId: REMOTE_DOMAIN_ID, title: 'Fenced bootstrap Todo' })],
      }), null, () => false),
      /response generation is stale/,
    );
    const state = await repository.getSyncState();
    assert.equal(state.sync_token, '*');
    assert.equal(state.snowflake_node_id, null);
    assert.equal(ids.getNodeId(), null);
    assert.equal((await database.get<{ count: number }>('SELECT COUNT(*) AS count FROM todo_sync_baselines')).count, 0);
    assert.equal((await repository.listAfter({ limit: 100 })).events.length, 0);
  } finally {
    database.close();
    cleanupRoot(root);
  }
});

test('in-flight commands and local projections recover across a SQLCipher restart', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-restart');
  const paths = resolveTodoistSyncDatabasePaths(runtime.userDataPath, '1');
  try {
    const domain = await runtime.repository.createDomain({ title: 'Restart domain' });
    assert(domain);
    const todo = await runtime.repository.createTodo({ domainId: domain.id, title: 'Restart todo' });
    assert(todo);
    const firstBatch = await runtime.repository.takePendingBatch();
    assert(firstBatch);
    const submittedUuids = firstBatch.commands.map((command) => command.uuid);
    assert.equal((await outboxRows(runtime.database)).every((row) => row.state === 'in_flight'), true);
    runtime.database.close();

    const reopenedDatabase = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    const reopenedRepository = new TodoistSyncRepository(
      reopenedDatabase,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await reopenedRepository.initialize();
    assert.equal((await reopenedRepository.getDomainById({ id: domain.id }))?.title, 'Restart domain');
    assert.equal((await reopenedRepository.getTodoById({ id: todo.id }))?.title, 'Restart todo');
    const recoveredRows = await outboxRows(reopenedDatabase);
    assert.equal(recoveredRows.every((row) => row.state === 'pending' && row.batch_id === null), true);
    const retryBatch = await reopenedRepository.takePendingBatch();
    assert(retryBatch);
    assert.deepEqual(retryBatch.commands.map((command) => command.uuid), submittedUuids);
    assert((await reopenedRepository.listAfter({ limit: 100 })).events.length > 0);
    await reopenedRepository.releaseTransientBatch(retryBatch.id);
    reopenedDatabase.assertHealthy();
    reopenedDatabase.close();
  } finally {
    cleanupRoot(runtime.root);
  }
});

test('remote baselines are monotonic and ACK proof waits for canonical presence', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-baseline');
  try {
    const revision10 = domainResource('10', 'server-10');
    await runtime.repository.applySyncResponse(syncResponse({ token: 't10', domains: [revision10] }), null);
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-10');
    await runtime.database.execute(
      'UPDATE todo_sync_baselines SET reconcile_pending=1 WHERE resource_type=? AND resource_id=?',
      ['todo_domain', REMOTE_DOMAIN_ID],
    );
    await runtime.database.execute(
      'UPDATE todo_domains SET reconcile_pending=1 WHERE id=?', [REMOTE_DOMAIN_ID],
    );
    await runtime.repository.applySyncResponse(syncResponse({
      token: 't-lower',
      domains: [domainResource('9', 'must-not-replace')],
    }), null);
    assert.equal((await runtime.database.get<{ reconcile_pending: number }>(
      'SELECT reconcile_pending FROM todo_sync_baselines WHERE resource_id=?', [REMOTE_DOMAIN_ID],
    )).reconcile_pending, 1);
    assert.equal((await runtime.database.get<{ title: string }>(
      'SELECT title FROM todo_domains WHERE id=?', [REMOTE_DOMAIN_ID],
    )).title, 'server-10');

    await runtime.repository.applySyncResponse(syncResponse({ token: 't-equal', domains: [revision10] }), null);
    assert.equal((await runtime.database.get<{ reconcile_pending: number }>(
      'SELECT reconcile_pending FROM todo_sync_baselines WHERE resource_id=?', [REMOTE_DOMAIN_ID],
    )).reconcile_pending, 0);
    const revision11 = domainResource('11', 'server-11');
    await runtime.repository.applySyncResponse(syncResponse({ token: 't11', domains: [revision11] }), null);
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-11');
    await assert.rejects(
      () => runtime.repository.applySyncResponse(syncResponse({
        token: 'must-roll-back',
        domains: [domainResource('11', 'same-revision-disagreement')],
      }), null),
      /equal-revision payload mismatch/,
    );
    assert.equal((await runtime.repository.getSyncState()).sync_token, 't11');

    await runtime.repository.updateDomainTitle({ id: REMOTE_DOMAIN_ID, title: 'local-awaiting-proof' });
    const lowerProofBatch = await runtime.repository.takePendingBatch();
    assert(lowerProofBatch);
    const lowerProofUuid = lowerProofBatch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'ack-lower',
      domains: [revision10],
      statuses: {
        [lowerProofUuid]: {
          status: 'ok',
          applied: true,
          sync_revision: '12',
          canonical_resource: { resource_type: 'todo_domain', id: REMOTE_DOMAIN_ID },
        },
      },
    }), lowerProofBatch);
    assert.equal((await outboxRows(runtime.database))[0].state, 'acknowledged_waiting_resource');
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'local-awaiting-proof');
    const revision12 = domainResource('12', 'server-12');
    await runtime.repository.applySyncResponse(syncResponse({ token: 'proof-12', domains: [revision12] }), null);
    assert.equal((await outboxRows(runtime.database)).length, 0);
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-12');

    await runtime.repository.updateDomainTitle({ id: REMOTE_DOMAIN_ID, title: 'equal-proof-local' });
    const equalProofBatch = await runtime.repository.takePendingBatch();
    assert(equalProofBatch);
    const equalProofUuid = equalProofBatch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'equal-proof',
      domains: [revision12],
      statuses: {
        [equalProofUuid]: {
          status: 'ok',
          applied: false,
          sync_revision: '12',
          canonical_resource: { resource_type: 'todo_domain', id: REMOTE_DOMAIN_ID },
        },
      },
    }), equalProofBatch);
    assert.equal((await outboxRows(runtime.database)).length, 0);
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-12');

    await runtime.repository.updateDomainTitle({ id: REMOTE_DOMAIN_ID, title: 'first-overlay' });
    const firstOverlayBatch = await runtime.repository.takePendingBatch();
    assert(firstOverlayBatch);
    await runtime.repository.updateDomainTitle({ id: REMOTE_DOMAIN_ID, title: 'newer-overlay' });
    const firstOverlayUuid = firstOverlayBatch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'proof-13',
      domains: [domainResource('13', 'server-13')],
      statuses: {
        [firstOverlayUuid]: {
          status: 'ok',
          applied: true,
          sync_revision: '13',
          canonical_resource: { resource_type: 'todo_domain', id: REMOTE_DOMAIN_ID },
        },
      },
    }), firstOverlayBatch);
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'newer-overlay');
    const remaining = await outboxRows(runtime.database);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].state, 'pending');
  } finally {
    closeRuntime(runtime);
  }
});

test('permanent errors wait for canonical proof, then retry with a new UUID or discard', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-errors');
  try {
    const revision20 = domainResource('20', 'server-20');
    await runtime.repository.applySyncResponse(syncResponse({ token: 't20', domains: [revision20] }), null);
    await runtime.repository.updateDomainTitle({ id: REMOTE_DOMAIN_ID, title: 'rejected-local' });
    const rejectedBatch = await runtime.repository.takePendingBatch();
    assert(rejectedBatch);
    const rejectedUuid = rejectedBatch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'error-waiting',
      statuses: {
        [rejectedUuid]: {
          status: 'error',
          error_code: 'RESOURCE_NOT_FOUND',
          error: 'title rejected',
          sync_revision: '21',
          canonical_resource: { resource_type: 'todo_domain', id: REMOTE_DOMAIN_ID },
        },
      },
    }), rejectedBatch);
    assert.equal((await outboxRows(runtime.database))[0].state, 'error_waiting_resource');
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'rejected-local');

    await runtime.repository.applySyncResponse(syncResponse({ token: 'still-waiting', domains: [revision20] }), null);
    assert.equal((await outboxRows(runtime.database))[0].state, 'error_waiting_resource');
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'canonical-21',
      domains: [domainResource('21', 'server-21')],
    }), null);
    assert.equal((await outboxRows(runtime.database))[0].state, 'permanent_failed');
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-21');

    await runtime.repository.retryFailed(rejectedUuid);
    let rows = await outboxRows(runtime.database);
    const retried = rows.find((row) => row.state === 'pending');
    assert(retried);
    assert.notEqual(retried.command_uuid, rejectedUuid);
    assert.equal(rows.find((row) => row.command_uuid === rejectedUuid)?.state, 'superseded');
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'rejected-local');
    const retriedArgs = JSON.parse(retried.args_json) as { base_revision: string };
    assert.equal(retriedArgs.base_revision, '21');

    const retryBatch = await runtime.repository.takePendingBatch();
    assert(retryBatch);
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'retry-null-error',
      statuses: {
        [retryBatch.commands[0].uuid]: {
          status: 'error',
          error_code: 'RESOURCE_NOT_FOUND',
          error: 'still rejected',
          sync_revision: null,
          canonical_resource: null,
        },
      },
    }), retryBatch);
    rows = await outboxRows(runtime.database);
    assert.equal(rows.find((row) => row.command_uuid === retryBatch.commands[0].uuid)?.state, 'permanent_failed');
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-21');
    await runtime.repository.discardFailed(retryBatch.commands[0].uuid);
    assert.equal(
      (await outboxRows(runtime.database)).find((row) => row.command_uuid === retryBatch.commands[0].uuid)?.state,
      'discarded',
    );
    assert.equal((await runtime.repository.getDomainById({ id: REMOTE_DOMAIN_ID }))?.title, 'server-21');
    runtime.database.assertHealthy();
  } finally {
    closeRuntime(runtime);
  }
});

test('a null-canonical Todo add failure removes blocked SubTodo projections before their parent', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-terminal-parent-child');
  const domainId = '00000000000007000000';
  try {
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'terminal-parent-domain',
      domains: [domainResource('1', 'Remote parent Domain', { id: domainId })],
    }), null);
    const todo = await runtime.repository.createTodo({ domainId, title: 'Rejected local Todo' });
    assert(todo);
    const subTodo = await runtime.repository.createSubTodo({ todoId: todo.id, title: 'Blocked local SubTodo' });
    assert(subTodo);
    const parentBatch = await runtime.repository.takePendingBatch(1);
    assert(parentBatch);
    assert.equal(parentBatch.commands.length, 1);
    assert.equal(parentBatch.commands[0].type, 'todo_add');
    const parentUuid = parentBatch.commands[0].uuid;
    await runtime.repository.applySyncResponse(syncResponse({
      token: 'terminal-parent-child-committed',
      statuses: {
        [parentUuid]: {
          status: 'error',
          error_code: 'RESOURCE_NOT_FOUND',
          error: 'parent no longer exists',
          sync_revision: null,
          canonical_resource: null,
        },
      },
    }), parentBatch);

    assert.equal((await runtime.repository.getSyncState()).sync_token, 'terminal-parent-child-committed');
    assert.equal(await runtime.repository.getTodoById({ id: todo.id }), undefined);
    assert.equal(await runtime.repository.getSubTodoById({ id: subTodo.id }), undefined);
    assert.equal((await runtime.database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM todos WHERE id=?', [todo.id],
    )).count, 0);
    assert.equal((await runtime.database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sub_todos WHERE id=?', [subTodo.id],
    )).count, 0);
    const rows = await outboxRows(runtime.database);
    assert.equal(rows.find((row) => row.command_type === 'todo_add')?.state, 'permanent_failed');
    assert.equal(rows.find((row) => row.command_type === 'sub_todo_add')?.state, 'blocked_by_failed_dependency');
    runtime.database.assertHealthy();
  } finally {
    closeRuntime(runtime);
  }
});

test('CLOCK_SKEW recovery rewrites only future members and preserves exact pending order', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-clock-recovery');
  const trustedTime = 1_800_000_000_000;
  const correctedNow = trustedTime + 1_000;
  try {
    const domain = await runtime.repository.createDomain({ title: 'Clock batch' });
    assert(domain);
    await runtime.repository.updateDomainTitle({ id: domain.id, title: 'Clock batch update' });
    const rejectedBatch = await runtime.repository.takePendingBatch();
    assert(rejectedBatch);
    assert.equal(rejectedBatch.commands.length, 2);
    const [futureUuid, validUuid] = rejectedBatch.commands.map((command) => command.uuid);
    const timestamps = [trustedTime + TODOIST_SYNC_MAX_FUTURE_MS + 1, trustedTime - 10_000];
    for (let index = 0; index < rejectedBatch.commands.length; index += 1) {
      const row = (await outboxRows(runtime.database)).find((item) => item.command_uuid === rejectedBatch.commands[index].uuid);
      assert(row);
      const args = JSON.parse(row.args_json) as Record<string, unknown>;
      args.client_updated_at = timestamps[index];
      await runtime.database.execute('UPDATE todo_sync_outbox SET args_json=? WHERE command_uuid=?', [JSON.stringify(args), row.command_uuid]);
    }
    const outside = await runtime.repository.createDomain({ title: 'Outside exact batch' });
    assert(outside);
    const outsideBefore = (await outboxRows(runtime.database)).find((row) => row.state === 'pending');
    assert(outsideBefore);

    await runtime.repository.markClockRejected(rejectedBatch);
    assert.equal(await runtime.repository.hasClockRejectedBatch(), true);
    const quarantined = await outboxRows(runtime.database);
    assert.deepEqual(
      quarantined.filter((row) => row.batch_id === rejectedBatch.id).map((row) => row.command_uuid),
      [futureUuid, validUuid],
    );
    assert(quarantined.filter((row) => row.batch_id === rejectedBatch.id).every((row) => row.state === 'clock_rejected'));
    assert.equal(quarantined.find((row) => row.command_uuid === outsideBefore.command_uuid)?.state, 'pending');

    assert.equal(await runtime.repository.recoverClockRejected(trustedTime, correctedNow), true);
    assert.equal(await runtime.repository.hasClockRejectedBatch(), false);
    const recovered = await outboxRows(runtime.database);
    const oldFuture = recovered.find((row) => row.command_uuid === futureUuid);
    assert.equal(oldFuture?.state, 'superseded');
    const replacement = recovered.find((row) => (
      row.command_type === rejectedBatch.commands[0].type &&
      row.command_uuid !== futureUuid &&
      row.state === 'pending' &&
      JSON.parse(row.args_json).id === rejectedBatch.commands[0].args.id
    ));
    assert(replacement);
    assert.equal((JSON.parse(replacement.args_json) as { client_updated_at: number }).client_updated_at, correctedNow);
    assert.equal(recovered.find((row) => row.command_uuid === validUuid)?.state, 'pending');
    assert.equal(recovered.find((row) => row.command_uuid === outsideBefore.command_uuid)?.args_json, outsideBefore.args_json);

    const pending = await runtime.repository.takePendingBatch();
    assert(pending);
    assert.deepEqual(pending.commands.map((command) => command.uuid), [
      replacement.command_uuid,
      validUuid,
      outsideBefore.command_uuid,
    ]);
    await runtime.repository.releaseTransientBatch(pending.id);
  } finally {
    closeRuntime(runtime);
  }
});

test('healthy NTP disagreement keeps the exact Core-rejected batch quarantined across restart', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-clock-disagreement');
  const paths = resolveTodoistSyncDatabasePaths(runtime.userDataPath, '1');
  let reopened: TodoistSyncDatabase | null = null;
  try {
    const domain = await runtime.repository.createDomain({ title: 'Disagreement' });
    assert(domain);
    const batch = await runtime.repository.takePendingBatch();
    assert(batch);
    const row = (await outboxRows(runtime.database))[0];
    const args = JSON.parse(row.args_json) as Record<string, unknown>;
    args.client_updated_at = 1_800_000_000_000;
    await runtime.database.execute('UPDATE todo_sync_outbox SET args_json=? WHERE command_uuid=?', [JSON.stringify(args), row.command_uuid]);
    await runtime.repository.markClockRejected(batch);
    assert.equal(await runtime.repository.recoverClockRejected(1_800_000_000_000, 1_800_000_000_100), false);
    assert.equal((await runtime.repository.getDiagnostics()).last_error, TODOIST_SYNC_CORE_CLOCK_DISAGREEMENT);
    assert.equal((await outboxRows(runtime.database))[0].state, 'clock_rejected');
    runtime.database.close();

    reopened = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    const repository = new TodoistSyncRepository(
      reopened,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await repository.initialize();
    assert.equal(await repository.hasClockRejectedBatch(), true);
    assert.equal((await repository.getDiagnostics()).last_error, TODOIST_SYNC_CORE_CLOCK_DISAGREEMENT);
    assert.equal((await outboxRows(reopened))[0].state, 'clock_rejected');
  } finally {
    reopened?.close();
    cleanupRoot(runtime.root);
  }
});

test('NTP checks honor the 180-second boundary, preserve wrong evidence when unreachable, and fence late results', { concurrency: false }, async () => {
  const root = createRoot('bitterless-todoist-ntp');
  try {
    const store = new TodoistSyncClockStateStore(root);
    const boundaryClock = new TodoistSyncClockService(
      store,
      async (source) => timeSample(source, TODOIST_SYNC_MAX_FUTURE_MS),
    );
    const boundary = await boundaryClock.check(() => true);
    assert.equal(boundary.status, 'healthy');
    assert.equal(boundary.clock_state?.offset_ms, TODOIST_SYNC_MAX_FUTURE_MS);

    const wrongClock = new TodoistSyncClockService(
      store,
      async (source) => timeSample(source, TODOIST_SYNC_MAX_FUTURE_MS + 1),
    );
    const wrong = await wrongClock.check(() => true);
    assert.equal(wrong.status, 'clock_wrong');
    const wrongState = wrongClock.getState();
    assert(wrongState);

    const unreachableClock = new TodoistSyncClockService(
      store,
      async () => await Promise.reject(new Error('offline fixture')),
    );
    const unreachable = await unreachableClock.check(() => true);
    assert.equal(unreachable.status, 'unreachable');
    assert.deepEqual(unreachable.clock_state, wrongState);
    assert.deepEqual(new TodoistSyncClockStateStore(root).read(), wrongState);

    const rounds = [deferred<number>(), deferred<number>()];
    let queryCount = 0;
    const overlappingClock = new TodoistSyncClockService(
      new TodoistSyncClockStateStore(join(root, 'overlap')),
      async (source) => {
        const round = Math.floor(queryCount / 2);
        queryCount += 1;
        return timeSample(source, await rounds[round].promise);
      },
    );
    const first = overlappingClock.check(() => true);
    await waitFor(() => queryCount === 2, 'first NTP round');
    const second = overlappingClock.check(() => true);
    await waitFor(() => queryCount === 4, 'second NTP round');
    rounds[1].resolve(0);
    assert.equal((await second).status, 'healthy');
    rounds[0].resolve(TODOIST_SYNC_MAX_FUTURE_MS + 50_000);
    assert.equal((await first).status, 'stale');
    assert.equal(overlappingClock.getState()?.status, 'healthy');
    assert.equal(overlappingClock.getState()?.check_generation, 2);
  } finally {
    cleanupRoot(root);
  }
});

test('session generation prevents a late NTP result from persisting after deactivation', { concurrency: false }, async () => {
  const root = createRoot('bitterless-todoist-session-clock');
  const sample = deferred<number>();
  let queryCount = 0;
  try {
    const clock = new TodoistSyncClockService(
      new TodoistSyncClockStateStore(root),
      async (source) => {
        queryCount += 1;
        return timeSample(source, await sample.promise);
      },
    );
    const session = new TodoistSyncSessionService({ clock });
    const late = session.checkClock({ session_generation: 0, request_generation: 1 });
    await waitFor(() => queryCount === 2, 'session NTP query');
    await session.deactivate();
    sample.resolve(TODOIST_SYNC_MAX_FUTURE_MS + 1);
    assert.equal((await late).status, 'stale');
    assert.equal(clock.getState(), null);
    assert.equal(new TodoistSyncClockStateStore(root).read(), null);
  } finally {
    cleanupRoot(root);
  }
});

test('coordinator is single-flight, coalesces reruns, schedules from completion, and reuses a persisted token after restart', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-coordinator');
  const paths = resolveTodoistSyncDatabasePaths(runtime.userDataPath, '1');
  const scheduler = new ManualScheduler();
  const client = new DeferredSyncClient();
  const generation = { session_generation: 1, clock_generation: 0 };
  let reopened: TodoistSyncDatabase | null = null;
  try {
    await runtime.repository.setSyncInterval(10);
    const coordinator = new TodoistSyncCoordinator({
      repository: runtime.repository,
      client,
      sessionGeneration: 1,
      captureGeneration: () => ({ ...generation }),
      isGenerationCurrent: (value) => (
        value.session_generation === generation.session_generation &&
        value.clock_generation === generation.clock_generation
      ),
      isClockWrong: () => false,
      onStatusUpdated: () => undefined,
      scheduler,
    });
    coordinator.start();
    await waitFor(() => client.calls.length === 1, 'first coordinator request');
    coordinator.trigger();
    coordinator.trigger();
    assert.equal(client.calls.length, 1);
    client.responses[0].resolve(syncResponse({ token: 'persisted-token-1' }));
    await waitFor(() => client.calls.length === 2, 'coalesced coordinator rerun');
    assert.equal(client.calls[0].syncToken, '*');
    assert.equal(client.calls[1].syncToken, 'persisted-token-1');
    assert.equal(client.maxActive, 1);
    client.responses[1].resolve(syncResponse({ token: 'persisted-token-2' }));
    await waitFor(() => scheduler.size === 1, 'completion-relative regular schedule');
    assert.deepEqual(scheduler.delays, [10_000]);
    assert.equal((await runtime.repository.getSyncState()).sync_token, 'persisted-token-2');
    await coordinator.dispose();
    runtime.database.close();

    reopened = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
    const repository = new TodoistSyncRepository(
      reopened,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await repository.initialize();
    assert.equal((await repository.getSyncState()).sync_token, 'persisted-token-2');
    const restartedClient = new DeferredSyncClient();
    const restartedScheduler = new ManualScheduler();
    const restartedCoordinator = new TodoistSyncCoordinator({
      repository,
      client: restartedClient,
      sessionGeneration: 1,
      captureGeneration: () => ({ ...generation }),
      isGenerationCurrent: () => true,
      isClockWrong: () => false,
      onStatusUpdated: () => undefined,
      scheduler: restartedScheduler,
    });
    restartedCoordinator.start();
    await waitFor(() => restartedClient.calls.length === 1, 'restart request');
    assert.equal(restartedClient.calls[0].syncToken, 'persisted-token-2');
    restartedClient.responses[0].resolve(syncResponse({ token: 'persisted-token-3' }));
    await waitFor(() => restartedScheduler.size === 1, 'restart regular schedule');
    await restartedCoordinator.dispose();
  } finally {
    reopened?.close();
    cleanupRoot(runtime.root);
  }
});

test('a late HTTP response after clock generation changes commits no response state and schedules no follow-up', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-http-fence');
  const scheduler = new ManualScheduler();
  const client = new DeferredSyncClient();
  const generation = { session_generation: 1, clock_generation: 0 };
  try {
    const database = new CommitFenceDatabase(runtime.database, () => {
      generation.clock_generation += 1;
    });
    const repository = new TodoistSyncRepository(
      database,
      '1',
      TEST_DEVICE_ID,
      new TodoistSyncSnowflakeService(7),
    );
    await repository.initialize();
    const domain = await repository.createDomain({ title: 'Local survives stale HTTP' });
    assert(domain);
    const coordinator = new TodoistSyncCoordinator({
      repository,
      client,
      sessionGeneration: 1,
      captureGeneration: () => ({ ...generation }),
      isGenerationCurrent: (value) => (
        value.session_generation === generation.session_generation &&
        value.clock_generation === generation.clock_generation
      ),
      isClockWrong: () => false,
      onStatusUpdated: () => undefined,
      scheduler,
    });
    coordinator.start();
    await waitFor(() => client.calls.length === 1, 'fenced HTTP request');
    const command = client.calls[0].commands[0];
    assert(command);
    database.arm();
    client.responses[0].resolve(syncResponse({
      token: 'must-not-commit',
      domains: [domainResource('1', 'Must not replace local', { id: domain.id })],
      statuses: {
        [command.uuid]: {
          status: 'ok',
          applied: true,
          sync_revision: '1',
          canonical_resource: { resource_type: 'todo_domain', id: domain.id },
        },
      },
    }));
    await waitFor(async () => (await outboxRows(runtime.database))[0]?.state === 'pending', 'stale batch release');
    assert.equal((await repository.getSyncState()).sync_token, '*');
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM todo_sync_baselines')).count, 0);
    assert.equal((await repository.getDomainById({ id: domain.id }))?.title, 'Local survives stale HTTP');
    assert.equal(scheduler.size, 0);
    assert.equal(client.calls.length, 1);
    await coordinator.dispose();
  } finally {
    closeRuntime(runtime);
  }
});

test('a newly confirmed wrong clock fences an HTTP request that was already running', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-http-clock-wrong');
  const scheduler = new ManualScheduler();
  const client = new DeferredSyncClient();
  const clock = new TodoistSyncClockService(
    new TodoistSyncClockStateStore(join(runtime.root, 'clock')),
    async (source) => timeSample(source, TODOIST_SYNC_MAX_FUTURE_MS + 1),
  );
  try {
    const domain = await runtime.repository.createDomain({ title: 'Local while clock changes' });
    assert(domain);
    const coordinator = new TodoistSyncCoordinator({
      repository: runtime.repository,
      client,
      sessionGeneration: 1,
      captureGeneration: () => ({ session_generation: 1, clock_generation: clock.getGeneration() }),
      isGenerationCurrent: (value) => (
        value.session_generation === 1 && value.clock_generation === clock.getGeneration()
      ),
      isClockWrong: () => clock.isWrong(),
      onStatusUpdated: () => undefined,
      scheduler,
    });
    coordinator.start();
    await waitFor(() => client.calls.length === 1, 'HTTP request before wrong clock confirmation');
    const command = client.calls[0].commands[0];
    assert(command);
    assert.equal((await clock.check(() => true)).status, 'clock_wrong');
    client.responses[0].resolve(syncResponse({
      token: 'wrong-clock-must-not-commit',
      domains: [domainResource('1', 'Remote while wrong', { id: domain.id })],
      statuses: {
        [command.uuid]: {
          status: 'ok',
          applied: true,
          sync_revision: '1',
          canonical_resource: { resource_type: 'todo_domain', id: domain.id },
        },
      },
    }));
    await waitFor(async () => (await outboxRows(runtime.database))[0]?.state === 'pending', 'wrong-clock batch release');
    assert.equal((await runtime.repository.getSyncState()).sync_token, '*');
    assert.equal((await runtime.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM todo_sync_baselines')).count, 0);
    assert.equal(scheduler.size, 0);
    await coordinator.dispose();
  } finally {
    closeRuntime(runtime);
  }
});

test('Core CLOCK_SKEW quarantines the exact batch, emits a typed request, and continues pull-only', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-core-clock-skew');
  const scheduler = new ManualScheduler();
  const clockRequests: Array<{ session_generation: number; request_generation: number }> = [];
  const calls: Array<{ syncToken: string; commands: TodoistSyncCommand[] }> = [];
  let callCount = 0;
  const client: TodoistSyncCoordinatorClient = {
    sync: async (syncToken, commands) => {
      calls.push({ syncToken, commands });
      callCount += 1;
      if (callCount === 1) {
        throw new TodoistSyncHttpError(
          409,
          parseTodoistSyncRequestError(cloneFixture(TODOIST_SYNC_HTTP_ERROR_FIXTURES.clockSkew), 409),
        );
      }
      return syncResponse({ token: 'pull-only-token' });
    },
    dispose: () => undefined,
  };
  try {
    const domain = await runtime.repository.createDomain({ title: 'Core rejected' });
    assert(domain);
    const coordinator = new TodoistSyncCoordinator({
      repository: runtime.repository,
      client,
      sessionGeneration: 7,
      captureGeneration: () => ({ session_generation: 7, clock_generation: 0 }),
      isGenerationCurrent: () => true,
      isClockWrong: () => false,
      onClockCheckRequested: (payload) => clockRequests.push(payload),
      onStatusUpdated: () => undefined,
      scheduler,
    });
    coordinator.start();
    await waitFor(() => calls.length === 2, 'pull-only continuation');
    await waitFor(() => scheduler.size === 1, 'pull-only regular schedule');
    assert.equal(calls[0].commands.length, 1);
    assert.deepEqual(calls[1].commands, []);
    assert.deepEqual(clockRequests, [{ session_generation: 7, request_generation: 1 }]);
    const rows = await outboxRows(runtime.database);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command_uuid, calls[0].commands[0].uuid);
    assert.equal(rows[0].state, 'clock_rejected');
    assert.equal(await runtime.repository.hasClockRejectedBatch(), true);
    assert.equal((await runtime.repository.getSyncState()).sync_token, 'pull-only-token');
    await coordinator.dispose();
  } finally {
    closeRuntime(runtime);
  }
});

test('transient scheduler backoff is bounded and interval configuration enforces 10..180 seconds', { concurrency: false }, async () => {
  const runtime = await createRuntime('bitterless-todoist-backoff');
  const scheduler = new ManualScheduler();
  let calls = 0;
  const client: TodoistSyncCoordinatorClient = {
    sync: async () => {
      calls += 1;
      throw new Error(`transient-${calls}`);
    },
    dispose: () => undefined,
  };
  try {
    await assert.rejects(() => runtime.repository.setSyncInterval(9), /10 to 180/);
    await assert.rejects(() => runtime.repository.setSyncInterval(181), /10 to 180/);
    await runtime.repository.setSyncInterval(10);
    const coordinator = new TodoistSyncCoordinator({
      repository: runtime.repository,
      client,
      sessionGeneration: 1,
      captureGeneration: () => ({ session_generation: 1, clock_generation: 0 }),
      isGenerationCurrent: () => true,
      isClockWrong: () => false,
      onStatusUpdated: () => undefined,
      scheduler,
    });
    coordinator.start();
    await waitFor(() => scheduler.size === 1, 'first transient backoff');
    assert.deepEqual(scheduler.delays, [20_000]);
    scheduler.fireNext();
    await waitFor(() => scheduler.delays.length === 2, 'second transient backoff');
    assert.deepEqual(scheduler.delays, [20_000, 40_000]);
    await coordinator.dispose();
  } finally {
    closeRuntime(runtime);
  }
});

test('session transitions are serialized, latest-generation wins, and customer repositories stay isolated', { concurrency: false }, async () => {
  const root = createRoot('bitterless-todoist-session');
  const userDataPath = join(root, 'userData');
  const createdCustomers: number[] = [];
  let activeCoordinators = 0;
  let maxActiveCoordinators = 0;
  try {
    const clock = new TodoistSyncClockService(
      new TodoistSyncClockStateStore(userDataPath),
      async () => await Promise.reject(new Error('NTP is unused in this fixture')),
    );
    const session = new TodoistSyncSessionService({
      clock,
      createRuntime: async (params, context) => {
        createdCustomers.push(params.customerId);
        assert(Number.isSafeInteger(context.sessionGeneration));
        const paths = resolveTodoistSyncDatabasePaths(userDataPath, params.customerId);
        const database = new TodoistSyncDatabase(paths.databasePath, TEST_PASSWORD);
        const repository = new TodoistSyncRepository(
          database,
          String(params.customerId),
          params.deviceId,
          new TodoistSyncSnowflakeService(7),
        );
        await repository.initialize();
        await repository.setSnowflakeNodeId(7);
        let started = false;
        const coordinator: TodoistSyncSessionCoordinator = {
          start: () => {
            assert.equal(started, false);
            started = true;
            activeCoordinators += 1;
            maxActiveCoordinators = Math.max(maxActiveCoordinators, activeCoordinators);
          },
          trigger: () => undefined,
          getStatus: async (clockState) => ({
            active: started,
            syncing: false,
            pull_only: false,
            pending_count: 0,
            failed_count: 0,
            last_success_at: null,
            last_error: null,
            clock_state: clockState,
          }),
          dispose: async () => {
            if (!started) return;
            started = false;
            activeCoordinators -= 1;
          },
        };
        return { database, repository, coordinator };
      },
    });

    const skipped = session.activate({ coreToken: 'token-a', customerId: 1, deviceId: 'session-device-0001' });
    const latest = session.activate({ coreToken: 'token-b', customerId: 2, deviceId: 'session-device-0002' });
    const [skippedResult, latestResult] = await Promise.all([skipped, latest]);
    assert.equal(skippedResult.status, 'failed');
    assert.deepEqual(latestResult, {
      status: 'active',
      customerId: 2,
      deviceId: 'session-device-0002',
      sessionGeneration: 2,
    });
    assert.deepEqual(createdCustomers, [2]);
    const customerTwoDomain = await (await session.getRepositoryAsync()).createDomain({ title: 'Customer two' });
    assert(customerTwoDomain);

    await session.activate({ coreToken: 'token-a', customerId: 1, deviceId: 'session-device-0001' });
    assert.deepEqual(await (await session.getRepositoryAsync()).getDomains(), []);
    const customerOneDomain = await (await session.getRepositoryAsync()).createDomain({ title: 'Customer one' });
    assert(customerOneDomain);

    await session.activate({ coreToken: 'token-b', customerId: 2, deviceId: 'session-device-0002' });
    assert.deepEqual(
      (await (await session.getRepositoryAsync()).getDomains()).map((domain) => domain.title),
      ['Customer two'],
    );
    assert.equal(maxActiveCoordinators, 1);
    assert.equal(activeCoordinators, 1);
    await session.deactivate();
    assert.equal(activeCoordinators, 0);
  } finally {
    cleanupRoot(root);
  }
});
