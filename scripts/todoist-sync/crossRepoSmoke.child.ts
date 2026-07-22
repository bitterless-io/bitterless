import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import type { TodoistSyncCommand } from '../../src/shared/todoistSync/todoistSync.type';
import {
  assertTodoistSyncDatabaseIsolation,
  resolveTodoistSyncDatabasePaths,
  TodoistSyncDatabase
} from '../../src/main/todoistSync/todoistSync.database';
import { TodoistSyncClient } from '../../src/main/todoistSync/todoistSync.client';
import {
  TodoistSyncCoordinator,
  type TodoistSyncScheduler
} from '../../src/main/todoistSync/todoistSync.coordinator';
import { TodoistSyncRepository } from '../../src/main/todoistSync/todoistSync.repository';
import {
  TodoistSyncSessionService,
  type TodoistSyncSessionRuntime
} from '../../src/main/todoistSync/todoistSync.session';
import {
  TodoistSyncClockService,
  TodoistSyncClockStateStore
} from '../../src/main/todoistSync/todoistSyncClock.service';
import { TodoistSyncSnowflakeService } from '../../src/main/todoistSync/todoistSyncSnowflake.service';

declare global {
  var __todoistSyncSafeStorageTripwireHits: number | undefined;
}

interface SmokeEnvironment {
  baseUrl: string;
  customerId: number;
  deviceAId: string;
  deviceAToken: string;
  deviceBId: string;
  deviceBToken: string;
  isolationCustomerId: number;
  isolationDeviceId: string;
  isolationToken: string;
  passwordA: string;
  passwordB: string;
}

interface RequestRecord {
  phase: 'offline' | 'online';
  syncToken: string;
  commandUuids: string[];
}

interface ActiveRuntime {
  database: TodoistSyncDatabase;
  repository: TodoistSyncRepository;
}

interface SmokeSession {
  session: TodoistSyncSessionService;
  requests: RequestRecord[];
  setOffline(value: boolean): void;
  getRuntime(): ActiveRuntime;
}

interface SyncStateRow {
  sync_token: string;
  snowflake_node_id: number | null;
  bootstrap_catchup_pending: number;
  last_success_at: number | null;
  last_error: string | null;
}

const originalFs = {
  existsSync: fs.existsSync.bind(fs),
  mkdtempSync: fs.mkdtempSync.bind(fs),
  readFileSync: fs.readFileSync.bind(fs),
  rmSync: fs.rmSync.bind(fs)
};

const protectedLegacyPaths = new Set<string>();
let legacyFilesystemTripwireHits = 0;
let operatingSystemCredentialTripwireHits = 0;

const environmentValue = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`[todoist sync cross-repo] missing ${name}`);
  return value;
};

const positiveInteger = (name: string): number => {
  const value = Number(environmentValue(name));
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`[todoist sync cross-repo] invalid ${name}`);
  return value;
};

const loadEnvironment = (): SmokeEnvironment => ({
  baseUrl: environmentValue('TODOIST_SYNC_SMOKE_BASE_URL'),
  customerId: positiveInteger('TODOIST_SYNC_SMOKE_CUSTOMER_ID'),
  deviceAId: environmentValue('TODOIST_SYNC_SMOKE_DEVICE_A_ID'),
  deviceAToken: environmentValue('TODOIST_SYNC_SMOKE_DEVICE_A_TOKEN'),
  deviceBId: environmentValue('TODOIST_SYNC_SMOKE_DEVICE_B_ID'),
  deviceBToken: environmentValue('TODOIST_SYNC_SMOKE_DEVICE_B_TOKEN'),
  isolationCustomerId: positiveInteger('TODOIST_SYNC_SMOKE_ISOLATION_CUSTOMER_ID'),
  isolationDeviceId: environmentValue('TODOIST_SYNC_SMOKE_ISOLATION_DEVICE_ID'),
  isolationToken: environmentValue('TODOIST_SYNC_SMOKE_ISOLATION_TOKEN'),
  passwordA: environmentValue('TODOIST_SYNC_SMOKE_PASSWORD_A'),
  passwordB: environmentValue('TODOIST_SYNC_SMOKE_PASSWORD_B')
});

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
    'writeFileSync'
  ] as const;
  for (const method of methods) {
    const original = mutableFs[method];
    Object.defineProperty(mutableFs, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const candidate = pathFromArgument(args[0]);
        if (candidate && protectedLegacyPaths.has(candidate)) {
          legacyFilesystemTripwireHits += 1;
          throw new Error(`[legacy database tripwire] ${method} accessed a protected main.db`);
        }
        return Reflect.apply(original, fs, args);
      }
    });
  }
};

const installOperatingSystemCredentialTripwire = (): void => {
  const mutableChildProcess = childProcess as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const methods = ['exec', 'execFile', 'execFileSync', 'execSync', 'spawn', 'spawnSync'] as const;
  const credentialCommand =
    /(^|[\\/\s])(security|cmdkey|vaultcmd)(\.exe)?([\s]|$)|credentialmanager|get-storedcredential/i;
  for (const method of methods) {
    const original = mutableChildProcess[method];
    Object.defineProperty(mutableChildProcess, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const command = args
          .map((value) =>
            Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : ''
          )
          .join(' ');
        if (credentialCommand.test(command)) {
          operatingSystemCredentialTripwireHits += 1;
          throw new Error(`[credential tripwire] ${method} attempted an OS credential command`);
        }
        return Reflect.apply(original, childProcess, args);
      }
    });
  }
};

installLegacyFilesystemTripwire();
installOperatingSystemCredentialTripwire();

class PassiveScheduler implements TodoistSyncScheduler {
  private readonly handles = new Set<object>();

  setTimeout(_callback: () => void, _delayMs: number): object {
    const handle = {};
    this.handles.add(handle);
    return handle;
  }

  clearTimeout(timer: unknown): void {
    if (typeof timer === 'object' && timer !== null) this.handles.delete(timer);
  }
}

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 30_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`[todoist sync cross-repo] timed out waiting for ${label}`);
};

const stateRow = async (database: TodoistSyncDatabase, customerId: number): Promise<SyncStateRow> =>
  await database.get<SyncStateRow>(
    `SELECT sync_token,snowflake_node_id,bootstrap_catchup_pending,last_success_at,last_error
     FROM todo_sync_state WHERE customer_id=?`,
    [String(customerId)]
  );

const waitForSuccessfulIdle = async (
  runtime: ActiveRuntime,
  session: TodoistSyncSessionService,
  customerId: number,
  label: string
): Promise<void> => {
  try {
    await waitFor(async () => {
      const state = await stateRow(runtime.database, customerId);
      const status = await session.getStatus();
      return (
        state.sync_token !== '*' &&
        state.snowflake_node_id !== null &&
        state.bootstrap_catchup_pending === 0 &&
        state.last_success_at !== null &&
        state.last_error === null &&
        !status.syncing &&
        status.pending_count === 0
      );
    }, label);
  } catch {
    const state = await stateRow(runtime.database, customerId);
    const status = await session.getStatus();
    throw new Error(
      `[todoist sync cross-repo] ${label} state=` +
        `token=${state.sync_token === '*' ? 'initial' : 'persisted'},node=${String(state.snowflake_node_id)},` +
        `catchup=${state.bootstrap_catchup_pending},success=${state.last_success_at === null ? 0 : 1},` +
        `error=${state.last_error?.slice(0, 160) ?? 'none'},syncing=${status.syncing ? 1 : 0},` +
        `pending=${status.pending_count},failed=${status.failed_count}`
    );
  }
};

const createSmokeSession = (options: {
  environment: SmokeEnvironment;
  userDataPath: string;
  password: string;
  token: string;
  customerId: number;
  deviceId: string;
}): SmokeSession => {
  let offline = false;
  let active: ActiveRuntime | null = null;
  const requests: RequestRecord[] = [];
  const clock = new TodoistSyncClockService(
    new TodoistSyncClockStateStore(options.userDataPath),
    async () => await Promise.reject(new Error('NTP is not used by the cross-repo smoke'))
  );
  const session = new TodoistSyncSessionService({
    clock,
    createRuntime: async (params, context): Promise<TodoistSyncSessionRuntime> => {
      const paths = resolveTodoistSyncDatabasePaths(options.userDataPath, params.customerId);
      assertTodoistSyncDatabaseIsolation(paths, options.userDataPath);
      protectedLegacyPaths.add(resolve(options.userDataPath, 'db', 'main.db'));
      const database = new TodoistSyncDatabase(paths.databasePath, options.password);
      try {
        const existing = await database.getOptional<{ snowflake_node_id: number | null }>(
          'SELECT snowflake_node_id FROM todo_sync_state WHERE customer_id=?',
          [String(params.customerId)]
        );
        const repository = new TodoistSyncRepository(
          database,
          String(params.customerId),
          params.deviceId,
          new TodoistSyncSnowflakeService(existing?.snowflake_node_id ?? null)
        );
        await repository.initialize();
        const fetchImpl: typeof fetch = async (input, init) => {
          const request = JSON.parse(String(init?.body ?? '{}')) as {
            sync_token?: unknown;
            commands?: Array<{ uuid?: unknown }>;
          };
          const commandUuids = (request.commands ?? []).map((command) => String(command.uuid));
          requests.push({
            phase: offline ? 'offline' : 'online',
            syncToken: String(request.sync_token),
            commandUuids
          });
          if (offline) throw new Error('[todoist sync cross-repo] simulated offline request');
          return await fetch(input, init);
        };
        const client = new TodoistSyncClient({
          coreToken: options.token,
          baseUrl: options.environment.baseUrl,
          fetchImpl,
          timeoutMs: 15_000
        });
        const coordinator = new TodoistSyncCoordinator({
          repository,
          client,
          sessionGeneration: context.sessionGeneration,
          captureGeneration: context.captureGeneration,
          isGenerationCurrent: context.isGenerationCurrent,
          isClockWrong: context.isClockWrong,
          onClockCheckRequested: () => undefined,
          onStatusUpdated: () => undefined,
          scheduler: new PassiveScheduler()
        });
        active = { database, repository };
        return { database, repository, coordinator };
      } catch (error) {
        database.close();
        throw error;
      }
    }
  });
  return {
    session,
    requests,
    setOffline: (value) => {
      offline = value;
    },
    getRuntime: () => {
      if (!active) throw new Error('[todoist sync cross-repo] session runtime is not active');
      return active;
    }
  };
};

const activate = async (
  smoke: SmokeSession,
  customerId: number,
  deviceId: string,
  token: string,
  label: string
): Promise<ActiveRuntime> => {
  await smoke.session.activate({ customerId, deviceId, coreToken: token });
  const runtime = smoke.getRuntime();
  await waitForSuccessfulIdle(runtime, smoke.session, customerId, label);
  return runtime;
};

const outboxRows = async (
  database: TodoistSyncDatabase
): Promise<
  Array<{
    command_uuid: string;
    state: string;
  }>
> =>
  await database.getAll('SELECT command_uuid,state FROM todo_sync_outbox ORDER BY command_order');

const baselineSummary = async (
  database: TodoistSyncDatabase
): Promise<{ count: number; revision: string }> => {
  const rows = await database.getAll<{ sync_revision: string }>(
    'SELECT sync_revision FROM todo_sync_baselines ORDER BY resource_type,resource_id'
  );
  const revision = rows.reduce(
    (maximum, row) => (BigInt(row.sync_revision) > BigInt(maximum) ? row.sync_revision : maximum),
    '0'
  );
  return { count: rows.length, revision };
};

const normalizedSnapshot = async (
  repository: TodoistSyncRepository
): Promise<Record<string, unknown>> => {
  const domains = await repository.getDomains();
  const todos = [];
  const subTodos = [];
  for (const domain of domains) {
    const domainTodos = await repository.getTodosByDomain({ domainId: domain.id });
    todos.push(...domainTodos);
    for (const todo of domainTodos) {
      subTodos.push(...(await repository.getSubTodosByTodoId({ todoId: todo.id })));
    }
  }
  const sortById = <T extends { id: string }>(rows: T[]): T[] =>
    [...rows].sort((left, right) => left.id.localeCompare(right.id));
  return {
    domains: sortById(domains),
    todos: sortById(todos),
    subTodos: sortById(subTodos)
  };
};

const seedIsolationCustomer = async (environment: SmokeEnvironment): Promise<string> => {
  const client = new TodoistSyncClient({
    coreToken: environment.isolationToken,
    baseUrl: environment.baseUrl
  });
  try {
    let response = await client.sync('*', []);
    for (let page = 0; (response.full_sync || response.has_more) && page < 100; page += 1) {
      response = await client.sync(response.sync_token, []);
    }
    assert.equal(response.full_sync, false);
    assert.equal(response.has_more, false);
    const ids = new TodoistSyncSnowflakeService(response.snowflake_node_id);
    const id = ids.generate();
    const now = Date.now();
    const command: TodoistSyncCommand = {
      uuid: randomUUID(),
      type: 'domain_add',
      args: {
        id,
        title: 'Invisible second customer',
        description: '',
        archived: 0,
        position: 0,
        client_updated_at: now,
        client_sequence: 1,
        base_revision: '0'
      }
    };
    const created = await client.sync(response.sync_token, [command]);
    assert.equal(created.sync_status[command.uuid]?.status, 'ok');
    return id;
  } finally {
    client.dispose();
  }
};

const assertEncrypted = (databasePath: string): void => {
  const header = originalFs.readFileSync(databasePath).subarray(0, 16).toString('utf8');
  assert.notEqual(header, 'SQLite format 3\u0000');
};

const assertTripwiresClean = (): void => {
  assert.equal(globalThis.__todoistSyncSafeStorageTripwireHits ?? 0, 0);
  assert.equal(operatingSystemCredentialTripwireHits, 0);
  assert.equal(legacyFilesystemTripwireHits, 0);
};

const runRestart = async (environment: SmokeEnvironment, root: string): Promise<void> => {
  const userDataPath = join(root, 'client-b', 'userData');
  protectedLegacyPaths.add(resolve(userDataPath, 'db', 'main.db'));
  const smoke = createSmokeSession({
    environment,
    userDataPath,
    password: environment.passwordB,
    token: environment.deviceBToken,
    customerId: environment.customerId,
    deviceId: environment.deviceBId
  });
  try {
    await smoke.session.activate({
      customerId: environment.customerId,
      deviceId: environment.deviceBId,
      coreToken: environment.deviceBToken
    });
    const runtime = smoke.getRuntime();
    const persisted = await stateRow(runtime.database, environment.customerId);
    assert.notEqual(persisted.sync_token, '*');
    await waitForSuccessfulIdle(
      runtime,
      smoke.session,
      environment.customerId,
      'client B restart idle sync'
    );
    assert.equal(smoke.requests[0]?.syncToken, persisted.sync_token);
    await smoke.session.deactivate();
    assertTripwiresClean();
    process.stdout.write('PASS desktop-client-b-process-restart persisted_token_reused=1\n');
  } finally {
    await smoke.session.deactivate().catch(() => undefined);
  }
};

const runPrimary = async (environment: SmokeEnvironment, root: string): Promise<void> => {
  const userDataA = join(root, 'client-a', 'userData');
  const userDataB = join(root, 'client-b', 'userData');
  const pathsA = resolveTodoistSyncDatabasePaths(userDataA, environment.customerId);
  const pathsB = resolveTodoistSyncDatabasePaths(userDataB, environment.customerId);
  protectedLegacyPaths.add(resolve(userDataA, 'db', 'main.db'));
  protectedLegacyPaths.add(resolve(userDataB, 'db', 'main.db'));
  const clientA = createSmokeSession({
    environment,
    userDataPath: userDataA,
    password: environment.passwordA,
    token: environment.deviceAToken,
    customerId: environment.customerId,
    deviceId: environment.deviceAId
  });
  let clientB = createSmokeSession({
    environment,
    userDataPath: userDataB,
    password: environment.passwordB,
    token: environment.deviceBToken,
    customerId: environment.customerId,
    deviceId: environment.deviceBId
  });
  try {
    const runtimeA = await activate(
      clientA,
      environment.customerId,
      environment.deviceAId,
      environment.deviceAToken,
      'client A bootstrap idle sync'
    );
    const isolationDomainId = await seedIsolationCustomer(environment);
    clientA.setOffline(true);
    const domain = await runtimeA.repository.createDomain({
      title: 'Cross-repo domain',
      description: 'Client A optimistic'
    });
    assert(domain, 'client A optimistic domain was not created');
    const todo = await runtimeA.repository.createTodo({
      domainId: domain.id,
      title: 'Client A Todo',
      source: 'human',
      actor: 'human'
    });
    assert(todo, 'client A optimistic Todo was not created');
    const subTodo = await runtimeA.repository.createSubTodo({
      todoId: todo.id,
      title: 'Client A SubTodo'
    });
    assert(subTodo, 'client A optimistic SubTodo was not created');
    await waitFor(async () => {
      const state = await stateRow(runtimeA.database, environment.customerId);
      const rows = await outboxRows(runtimeA.database);
      return (
        state.last_error?.includes('simulated offline request') === true &&
        rows.length === 3 &&
        rows.every((row) => row.state === 'pending')
      );
    }, 'offline queue retry release');
    const queued = await outboxRows(runtimeA.database);
    assert.equal(queued.length, 3);
    clientA.setOffline(false);
    clientA.session.requestSync();
    await waitForSuccessfulIdle(
      runtimeA,
      clientA.session,
      environment.customerId,
      'client A retry idle sync'
    );
    const baselineA = await baselineSummary(runtimeA.database);
    assert.equal(baselineA.count, 3);
    assert(BigInt(baselineA.revision) >= 3n, 'client A ACK baselines did not advance');
    assert.equal((await outboxRows(runtimeA.database)).length, 0);
    const retriedUuid = queued.find(
      (row) =>
        clientA.requests.some(
          (request) =>
            request.phase === 'offline' && request.commandUuids.includes(row.command_uuid)
        ) &&
        clientA.requests.some(
          (request) => request.phase === 'online' && request.commandUuids.includes(row.command_uuid)
        )
    );
    assert(retriedUuid, 'no offline command UUID was retried online');

    const runtimeB = await activate(
      clientB,
      environment.customerId,
      environment.deviceBId,
      environment.deviceBToken,
      'client B bootstrap idle sync'
    );
    assert.equal((await runtimeB.repository.getDomainById({ id: domain.id }))?.title, domain.title);
    assert.equal((await runtimeB.repository.getTodoById({ id: todo.id }))?.title, todo.title);
    assert.equal(
      (await runtimeB.repository.getSubTodoById({ id: subTodo.id }))?.title,
      subTodo.title
    );
    assert.equal(await runtimeB.repository.getDomainById({ id: isolationDomainId }), undefined);
    assert.equal(await runtimeA.repository.getDomainById({ id: isolationDomainId }), undefined);

    const eventBaselineA = (await runtimeA.repository.listAfter({ limit: 100 })).latestEventId;
    const outboxBeforePullA = await outboxRows(runtimeA.database);
    await runtimeB.repository.updateTodo({
      id: todo.id,
      title: 'Client B canonical',
      note: 'Completed by B',
      actor: 'human'
    });
    await runtimeB.repository.completeTodo({ id: todo.id, actor: 'human' });
    await runtimeB.repository.toggleSubTodoStatus({ id: subTodo.id });
    await waitForSuccessfulIdle(
      runtimeB,
      clientB.session,
      environment.customerId,
      'client B mutation idle sync'
    );
    const baselineB = await baselineSummary(runtimeB.database);
    assert.equal(baselineB.count, 3);
    assert(
      BigInt(baselineB.revision) > BigInt(baselineA.revision),
      'client B ACK baselines did not advance'
    );
    assert.equal((await outboxRows(runtimeB.database)).length, 0);

    const tokenBeforeIncrementalA = (await stateRow(runtimeA.database, environment.customerId))
      .sync_token;
    clientA.session.requestSync();
    await waitFor(async () => {
      const current = await runtimeA.repository.getTodoById({ id: todo.id });
      const child = await runtimeA.repository.getSubTodoById({ id: subTodo.id });
      const state = await stateRow(runtimeA.database, environment.customerId);
      const status = await clientA.session.getStatus();
      return (
        current?.title === 'Client B canonical' &&
        current.status === 1 &&
        child?.status === 1 &&
        state.sync_token !== tokenBeforeIncrementalA &&
        !status.syncing
      );
    }, 'client A incremental convergence');
    const remoteEvents = (
      await runtimeA.repository.listAfter({ afterEventId: eventBaselineA, limit: 100 })
    ).events;
    assert(remoteEvents.length > 0, 'client A incremental sync emitted no remote event');
    assert(
      remoteEvents.every((event) => event.actor === 'system'),
      'client A remote event actor was not system'
    );
    assert(
      remoteEvents.some((event) => event.type === 'todo.completed'),
      'client A did not receive a completed event'
    );
    assert.deepEqual(await outboxRows(runtimeA.database), outboxBeforePullA);

    assert.notEqual(resolve(pathsA.databasePath), resolve(pathsB.databasePath));
    assert(originalFs.existsSync(pathsA.databasePath), 'client A SQLCipher database is missing');
    assert(originalFs.existsSync(pathsB.databasePath), 'client B SQLCipher database is missing');
    assert.equal(originalFs.existsSync(pathsA.keyPath), false);
    assert.equal(originalFs.existsSync(pathsB.keyPath), false);
    assertEncrypted(pathsA.databasePath);
    assertEncrypted(pathsB.databasePath);
    runtimeA.database.assertHealthy();
    runtimeB.database.assertHealthy();
    assertTripwiresClean();
    process.stdout.write(
      `PASS desktop-two-client-http-primary resources=3 offline_retry=1 system_events=${remoteEvents.length} ` +
        'outbox_feedback=0 isolation_customers=2 sqlcipher_repositories=2\n'
    );
  } finally {
    await Promise.allSettled([clientA.session.deactivate(), clientB.session.deactivate()]);
    assertTripwiresClean();
  }
};

const runFinal = async (environment: SmokeEnvironment, root: string): Promise<void> => {
  const userDataA = join(root, 'client-a', 'userData');
  const userDataB = join(root, 'client-b', 'userData');
  const pathsA = resolveTodoistSyncDatabasePaths(userDataA, environment.customerId);
  const pathsB = resolveTodoistSyncDatabasePaths(userDataB, environment.customerId);
  const clientA = createSmokeSession({
    environment,
    userDataPath: userDataA,
    password: environment.passwordA,
    token: environment.deviceAToken,
    customerId: environment.customerId,
    deviceId: environment.deviceAId
  });
  const clientB = createSmokeSession({
    environment,
    userDataPath: userDataB,
    password: environment.passwordB,
    token: environment.deviceBToken,
    customerId: environment.customerId,
    deviceId: environment.deviceBId
  });
  try {
    const runtimeA = await activate(
      clientA,
      environment.customerId,
      environment.deviceAId,
      environment.deviceAToken,
      'final client A idle sync'
    );
    const runtimeB = await activate(
      clientB,
      environment.customerId,
      environment.deviceBId,
      environment.deviceBToken,
      'final client B idle sync'
    );
    const snapshotA = await normalizedSnapshot(runtimeA.repository);
    const snapshotB = await normalizedSnapshot(runtimeB.repository);
    assert.deepEqual(snapshotA, snapshotB);
    const domains = snapshotA.domains as Array<{ customer_id: string; title: string }>;
    assert.equal(domains.length, 1);
    assert.equal(domains[0].customer_id, String(environment.customerId));
    assert.equal(domains[0].title, 'Cross-repo domain');
    assert.equal(originalFs.existsSync(pathsA.keyPath), false);
    assert.equal(originalFs.existsSync(pathsB.keyPath), false);
    assertEncrypted(pathsA.databasePath);
    assertEncrypted(pathsB.databasePath);
    runtimeA.database.assertHealthy();
    runtimeB.database.assertHealthy();
    assertTripwiresClean();
    process.stdout.write(
      'PASS desktop-two-client-http persisted_restart=1 isolation_customers=2 ' +
        'convergence=exact sqlcipher_repositories=2 local_cleanup=runner-owned\n'
    );
  } finally {
    await Promise.allSettled([clientA.session.deactivate(), clientB.session.deactivate()]);
    assertTripwiresClean();
  }
};

const main = async (): Promise<void> => {
  const environment = loadEnvironment();
  const phase = environmentValue('TODOIST_SYNC_CROSS_REPO_PHASE');
  if (phase === 'restart-b') {
    await runRestart(environment, environmentValue('TODOIST_SYNC_CROSS_REPO_ROOT'));
    return;
  }
  if (phase === 'primary') {
    await runPrimary(environment, environmentValue('TODOIST_SYNC_CROSS_REPO_ROOT'));
    return;
  }
  if (phase === 'final') {
    await runFinal(environment, environmentValue('TODOIST_SYNC_CROSS_REPO_ROOT'));
    return;
  }
  throw new Error('[todoist sync cross-repo] invalid phase');
};

main().catch((error) => {
  const message =
    error instanceof Error ? error.message.split('\n')[0] : 'unknown cross-repo smoke failure';
  process.stderr.write(`FAIL desktop-two-client-http: ${message}\n`);
  process.exitCode = 1;
});
