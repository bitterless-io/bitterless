import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import type {
  TodoistSyncCommandStatus,
  TodoistSyncDomainResource,
  TodoistSyncResponse,
} from '../../src/shared/todoistSync/todoistSync.type';
import {
  assertTodoistSyncDatabaseIsolation,
  resolveTodoistSyncDatabasePaths,
  TodoistSyncDatabase,
  type TodoistSyncExecuteResult,
  type TodoistSyncRepositoryDatabase,
  type TodoistSyncSqlExecutor,
} from '../../src/main/todoistSync/todoistSync.database';
import {
  getOrCreateTodoistSyncRuntimePassword,
  type TodoistSyncPasswordProtection,
} from '../../src/main/todoistSync/todoistSyncPassword.service';
import {
  TodoistSyncRepository,
  type TodoistSyncOutboxBatch,
} from '../../src/main/todoistSync/todoistSync.repository';
import { TodoistSyncSnowflakeService } from '../../src/main/todoistSync/todoistSyncSnowflake.service';

declare global {
  var __todoistSyncSafeStorageTripwireHits: number | undefined;
  var __todoistSyncBroadcasts: Array<{ event: string; payload: unknown }> | undefined;
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
  command_uuid: string;
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

const syncResponse = (options: {
  token: string;
  domains?: TodoistSyncDomainResource[];
  statuses?: Record<string, TodoistSyncCommandStatus>;
}): TodoistSyncResponse => ({
  sync_token: options.token,
  full_sync: false,
  sync_phase: 'incremental',
  has_more: false,
  server_time_ms: 1_700_000_000_500,
  snowflake_node_id: 7,
  sync_status: options.statuses ?? {},
  todo_domains: options.domains ?? [],
  todos: [],
  sub_todos: [],
});

const outboxRows = async (database: TodoistSyncDatabase): Promise<OutboxStateRow[]> => {
  return await database.getAll<OutboxStateRow>(
    'SELECT command_uuid, state, batch_id, args_json FROM todo_sync_outbox ORDER BY command_order',
  );
};

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

  async writeTransaction<T>(runner: (tx: TodoistSyncSqlExecutor) => Promise<T>): Promise<T> {
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
    }));
  }
}

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
          error_code: 'TITLE_REJECTED',
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
          error_code: 'TITLE_REJECTED',
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
