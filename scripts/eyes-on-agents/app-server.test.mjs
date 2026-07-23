import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-server-'));

const loadSupervisor = async () => {
  const outfile = join(buildRoot, 'supervisor.mjs');
  await build({
    entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/codexAppServer.supervisor.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
};

const loadService = async () => {
  const outfile = join(buildRoot, 'service.mjs');
  await build({
    entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/eyesOnAgents.service.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
};

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode = null;
  signalCode = null;
  messages = [];
  killSignals = [];
  latestTurnItems = [];
  input = '';

  constructor() {
    super();
    this.stdin.on('data', (chunk) => {
      this.input += chunk.toString('utf8');
      let newline = this.input.indexOf('\n');
      while (newline >= 0) {
        const line = this.input.slice(0, newline).trim();
        this.input = this.input.slice(newline + 1);
        if (line) this.handle(JSON.parse(line));
        newline = this.input.indexOf('\n');
      }
    });
  }

  handle(message) {
    this.messages.push(message);
    if (message.method === 'initialize') {
      const response = `${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`;
      this.stdout.write(response.slice(0, 7));
      queueMicrotask(() => this.stdout.write(response.slice(7)));
      return;
    }
    if (message.method === 'thread/list') {
      const cursor = message.params.cursor;
      const prefix = message.params.archived ? 'archived-' : '';
      const result = cursor === null
        ? { data: [{ id: `${prefix}one` }], nextCursor: 'page-2' }
        : { data: [{ id: `${prefix}two` }], nextCursor: null };
      queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
      return;
    }
    if (message.method === 'thread/turns/list') {
      const result = {
        data: [{
          id: 'latest-turn',
          status: 'interrupted',
          completedAt: 2,
          itemsView: message.params.itemsView,
          items: this.latestTurnItems,
          error: { message: 'must not escape the supervisor projection' }
        }],
        nextCursor: null,
        backwardsCursor: null
      };
      queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
      return;
    }
    if (message.method === 'hooks/list') {
      const result = {
        data: [{
          cwd: '/repo',
          errors: [],
          warnings: [],
          hooks: [{
            command: '/fixed/bitterless-hook',
            currentHash: 'hash',
            displayOrder: 1,
            enabled: true,
            eventName: 'stop',
            handlerType: 'command',
            isManaged: false,
            key: 'private-key-not-for-renderer',
            matcher: null,
            source: 'user',
            sourcePath: '/private/hooks.json',
            statusMessage: 'private-detail-not-for-renderer',
            timeoutSec: 2,
            trustStatus: 'trusted'
          }]
        }]
      };
      queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
      return;
    }
    if (message.method === 'config/batchWrite') {
      const result = {
        status: 'ok',
        version: 'test-version',
        filePath: '/tmp/codex-config.toml'
      };
      queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
    }
  }

  kill(signal) {
    this.killSignals.push(signal);
    this.signalCode = signal;
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }
}

class DelayedCloseChild extends FakeChild {
  kill(signal) {
    this.killSignals.push(signal);
    this.signalCode = signal;
    return true;
  }

  emitDelayedClose() {
    this.emit('close', null, this.signalCode);
  }
}

class DelayedInitializeChild extends FakeChild {
  initializeRequest = null;

  handle(message) {
    if (message.method === 'initialize') {
      this.messages.push(message);
      this.initializeRequest = message;
      return;
    }
    super.handle(message);
  }

  releaseInitialize() {
    assert.ok(this.initializeRequest, 'initialize request must arrive before it is released');
    this.stdout.write(`${JSON.stringify({
      id: this.initializeRequest.id,
      result: { userAgent: 'delayed-fake' }
    })}\n`);
  }
}

class MalformedHooksChild extends FakeChild {
  handle(message) {
    if (message.method !== 'hooks/list') {
      super.handle(message);
      return;
    }
    this.messages.push(message);
    const result = {
      data: [{ hooks: [{ enabled: 'yes' }], errors: [], warnings: [] }]
    };
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
  }
}

class RelativeSourcePathChild extends FakeChild {
  handle(message) {
    if (message.method !== 'hooks/list') {
      super.handle(message);
      return;
    }
    this.messages.push(message);
    const result = {
      data: [{
        hooks: [{
          command: '/fixed/bitterless-hook',
          currentHash: 'hash',
          enabled: true,
          eventName: 'stop',
          handlerType: 'command',
          isManaged: false,
          key: 'private-key-not-for-renderer',
          matcher: null,
          source: 'user',
          sourcePath: 'relative/hooks.json',
          trustStatus: 'trusted'
        }],
        errors: [],
        warnings: []
      }]
    };
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
  }
}

class WarningHooksChild extends FakeChild {
  handle(message) {
    if (message.method !== 'hooks/list') {
      super.handle(message);
      return;
    }
    this.messages.push(message);
    const result = { data: [{ hooks: [], errors: [], warnings: ['private warning'] }] };
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
  }
}

class UnsupportedBatchWriteChild extends FakeChild {
  handle(message) {
    if (message.method !== 'config/batchWrite') {
      super.handle(message);
      return;
    }
    this.messages.push(message);
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({
      id: message.id,
      error: { message: 'method not found' }
    })}\n`));
  }
}

try {
  const { CodexAppServerSupervisor } = await loadSupervisor();
  const { EyesOnAgentsService } = await loadService();
  const notifications = [];
  const child = new FakeChild();
  let spawnCount = 0;
  let now = 100;
  const supervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: (executable, args) => {
      spawnCount += 1;
      assert.equal(executable, '/fixed/codex');
      assert.deepEqual(args, ['app-server', '--stdio']);
      return child;
    },
    now: () => now,
    onNotification: (method, params) => notifications.push({ method, params })
  });

  await Promise.all([supervisor.connect(), supervisor.connect()]);
  assert.equal(spawnCount, 1, 'concurrent connect calls must share one child process');
  assert.equal(supervisor.getStatus(false).state, 'connected');
  assert.equal(child.messages[0].method, 'initialize');
  assert.deepEqual(
    child.messages[0].params.capabilities,
    { experimentalApi: true },
    'initialize must opt into the experimental bounded turn-list API'
  );
  assert.equal(child.messages[1].method, 'initialized');
  assert.equal('id' in child.messages[1], false, 'initialized must be a JSON-RPC notification');

  now = 200;
  const threads = await supervisor.listThreads();
  assert.deepEqual(threads, [{ id: 'one' }, { id: 'two' }]);
  assert.equal(supervisor.getStatus(true).lastSyncedAt, new Date(200).toISOString());
  assert.equal(
    child.messages.filter((message) => message.method === 'thread/list').length,
    2,
    'thread/list must page until nextCursor is null'
  );
  assert.ok(
    child.messages
      .filter((message) => message.method === 'thread/list')
      .every((message) => message.params.archived === false),
    'active inventory requests must explicitly exclude archived threads'
  );
  const archivedThreads = await supervisor.listArchivedThreads();
  assert.deepEqual(archivedThreads, [{ id: 'archived-one' }, { id: 'archived-two' }]);
  assert.ok(
    child.messages
      .filter((message) => message.method === 'thread/list')
      .slice(2)
      .every((message) => message.params.archived === true),
    'archived inventory requests must explicitly request archived threads'
  );
  assert.deepEqual(await supervisor.readLatestThreadTurn('thread-one'), {
    id: 'latest-turn',
    status: 'interrupted',
    completedAt: 2
  });
  const latestTurnRequest = child.messages.find(
    (message) => message.method === 'thread/turns/list'
  );
  assert.deepEqual(latestTurnRequest.params, {
    threadId: 'thread-one',
    cursor: null,
    itemsView: 'notLoaded',
    sortDirection: 'desc',
    limit: 1
  });
  child.latestTurnItems = [{ type: 'agentMessage', text: 'must not cross the boundary' }];
  await assert.rejects(
    () => supervisor.readLatestThreadTurn('thread-one'),
    /contains unexpected items/,
    'terminal polling must reject a response that carries turn content'
  );
  child.latestTurnItems = [];
  assert.deepEqual(await supervisor.listHooks(), [{
    command: '/fixed/bitterless-hook',
    currentHash: 'hash',
    enabled: true,
    eventName: 'stop',
    handlerType: 'command',
    isManaged: false,
    key: 'private-key-not-for-renderer',
    matcher: null,
    source: 'user',
    sourcePath: '/private/hooks.json',
    trustStatus: 'trusted'
  }], 'hooks/list must retain only the bounded main-process fields needed for inspection');
  await supervisor.enableHooks(['private-key-not-for-renderer']);
  const batchWrite = child.messages.find((message) => message.method === 'config/batchWrite');
  assert.deepEqual(batchWrite, {
    method: 'config/batchWrite',
    id: batchWrite.id,
    params: {
      edits: [{
        keyPath: 'hooks.state',
        value: {
          'private-key-not-for-renderer': { enabled: true }
        },
        mergeStrategy: 'upsert'
      }],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true
    }
  }, 'hook re-enable must use the fixed hooks.state batch-write shape');
  assert.equal(
    JSON.stringify(batchWrite).includes('trusted_hash'),
    false,
    'Bitterless must never write Codex hook trust hashes'
  );

  child.stdout.write(`${JSON.stringify({
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn' } }
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, [{
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn' } }
  }]);

  child.exitCode = 3;
  child.signalCode = null;
  child.emit('close', 3, null);
  assert.equal(supervisor.getStatus(false).state, 'error');
  assert.match(supervisor.getStatus(false).error, /exited \(3\)/);

  const broken = new FakeChild();
  broken.handle = (message) => {
    broken.messages.push(message);
    if (message.method === 'initialize') queueMicrotask(() => broken.stdout.write('{bad json}\n'));
  };
  const brokenSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => broken,
    requestTimeoutMs: 100
  });
  await assert.rejects(() => brokenSupervisor.connect(), /invalid JSON|failed/i);
  assert.equal(brokenSupervisor.getStatus(false).state, 'error');

  const malformedHooksChild = new MalformedHooksChild();
  const malformedHooksSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => malformedHooksChild
  });
  await malformedHooksSupervisor.connect();
  await assert.rejects(
    () => malformedHooksSupervisor.listHooks(),
    /hooks\/list hook 0 enabled flag is invalid/
  );
  assert.equal(
    malformedHooksSupervisor.getStatus(false).state,
    'connected',
    'malformed hook metadata must not corrupt the App Server connection'
  );
  await malformedHooksSupervisor.disconnect();

  const relativeSourcePathSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => new RelativeSourcePathChild()
  });
  await relativeSourcePathSupervisor.connect();
  await assert.rejects(
    () => relativeSourcePathSupervisor.listHooks(),
    /hooks\/list hook 0 sourcePath must be absolute/
  );
  assert.equal(
    relativeSourcePathSupervisor.getStatus(false).state,
    'connected',
    'relative source paths must fail inspection without corrupting the App Server connection'
  );
  await relativeSourcePathSupervisor.disconnect();

  const warningHooksSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => new WarningHooksChild()
  });
  await warningHooksSupervisor.connect();
  await assert.rejects(
    () => warningHooksSupervisor.listHooks(),
    /hooks\/list reported warnings/
  );
  assert.equal(
    warningHooksSupervisor.getStatus(false).state,
    'connected',
    'hook warnings must fail inspection without exposing details or killing inventory'
  );
  await warningHooksSupervisor.disconnect();

  const unsupportedBatchWriteSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => new UnsupportedBatchWriteChild()
  });
  await unsupportedBatchWriteSupervisor.connect();
  await assert.rejects(
    () => unsupportedBatchWriteSupervisor.enableHooks(['fresh-owned-key']),
    /method not found/
  );
  assert.equal(
    unsupportedBatchWriteSupervisor.getStatus(false).state,
    'connected',
    'a missing re-enable capability must leave manual review transport available'
  );
  await unsupportedBatchWriteSupervisor.disconnect();

  const disconnectChild = new FakeChild();
  const disconnectSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => disconnectChild
  });
  await disconnectSupervisor.connect();
  await disconnectSupervisor.disconnect();
  assert.deepEqual(disconnectChild.killSignals, ['SIGTERM']);
  assert.equal(disconnectSupervisor.getStatus(false).state, 'disconnected');

  const childA = new DelayedCloseChild();
  const childB = new FakeChild();
  const generationNotifications = [];
  let generationSpawnCount = 0;
  const generationSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => {
      generationSpawnCount += 1;
      return generationSpawnCount === 1 ? childA : childB;
    },
    onNotification: (method, params) => generationNotifications.push({ method, params })
  });
  await generationSupervisor.connect();
  childA.emit('error', new Error('server A failed'));
  assert.equal(generationSupervisor.getStatus(false).state, 'error');
  await generationSupervisor.connect();
  assert.equal(generationSupervisor.getStatus(false).state, 'connected');

  childA.stdout.write(`${JSON.stringify({
    method: 'turn/completed',
    params: { origin: 'server-a' }
  })}\n`);
  childB.stdout.write(`${JSON.stringify({
    method: 'turn/completed',
    params: { origin: 'server-b' }
  })}\n`);
  childA.emitDelayedClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    generationSupervisor.getStatus(false).state,
    'connected',
    'a late close from server A must not tear down server B'
  );
  assert.deepEqual(generationNotifications, [{
    method: 'turn/completed',
    params: { origin: 'server-b' }
  }], 'only the current child may emit notifications');

  assert.deepEqual(await generationSupervisor.listThreads(), [{ id: 'one' }, { id: 'two' }]);
  assert.equal(
    childA.messages.filter((message) => message.method === 'thread/list').length,
    0,
    'replacement requests must never be written to server A'
  );
  assert.equal(
    childB.messages.filter((message) => message.method === 'thread/list').length,
    2,
    'server B must own all replacement requests'
  );
  await generationSupervisor.disconnect();

  const delayedChild = new DelayedInitializeChild();
  let delayedSpawnCount = 0;
  const delayedSupervisor = new CodexAppServerSupervisor({
    executable: '/fixed/codex',
    spawnAppServer: () => {
      delayedSpawnCount += 1;
      return delayedChild;
    }
  });
  const delayedRepository = {
    getSnapshot: async () => ({
      domains: [{
        id: 1,
        domainKey: 'uncategorized',
        title: 'Uncategorized',
        sortIndex: 0,
        isSystem: true
      }],
      threads: []
    }),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined,
    upsertDiscoveredThreads: async () => undefined,
    upsertThreadSnapshots: async () => undefined,
    setThreadArchived: async () => undefined,
    markThreadsArchived: async () => undefined,
    getThreadRefreshPages: async () => ({
      hot: [],
      cold: [],
      pageCount: 0,
      coldPage: null
    }),
    refreshThreadPage: async () => ({ changed: false })
  };
  let delayedBridgeStatus = {
    state: 'not_installed',
    reviewReason: null,
    listening: false,
    listeningSince: null,
    lastEventAt: null,
    lastInspectedAt: null,
    error: null
  };
  const delayedService = new EyesOnAgentsService({
    repository: delayedRepository,
    settings: {
      get: async () => false,
      upsert: async () => undefined
    },
    appServer: delayedSupervisor,
    desktopBridge: {
      getStatus: () => delayedBridgeStatus,
      hasInstallationIntent: () => false,
      hasExactInstallation: () => false,
      getDisabledExactHookKeys: () => [],
      install: () => {
        delayedBridgeStatus = { ...delayedBridgeStatus, state: 'needs_trust' };
        return delayedBridgeStatus;
      },
      remove: () => {
        delayedBridgeStatus = { ...delayedBridgeStatus, state: 'not_installed' };
        return delayedBridgeStatus;
      },
      updateHookInspection: () => {
        delayedBridgeStatus = { ...delayedBridgeStatus, state: 'installed' };
      },
      setHookInspectionError: () => {
        delayedBridgeStatus = { ...delayedBridgeStatus, state: 'error' };
      },
      setOperationalError: () => {
        delayedBridgeStatus = { ...delayedBridgeStatus, state: 'error' };
      }
    },
    bridgeListener: {
      start: async () => {
        delayedBridgeStatus = {
          ...delayedBridgeStatus,
          listening: true,
          listeningSince: new Date(250).toISOString()
        };
      },
      stop: async () => {
        delayedBridgeStatus = {
          ...delayedBridgeStatus,
          listening: false,
          listeningSince: null
        };
      }
    },
    openExternal: async () => undefined,
    now: () => 300
  });

  const delayedConnectRequest = delayedService.connectAppServer();
  const delayedSyncRequest = delayedService.syncThreads();
  let delayedSyncOutcome = 'pending';
  void delayedSyncRequest.then(
    () => { delayedSyncOutcome = 'resolved'; },
    () => { delayedSyncOutcome = 'rejected'; }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delayedSpawnCount, 1, 'concurrent service requests must share one spawn');
  assert.equal(delayedSupervisor.getStatus(false).state, 'connecting');
  assert.equal(
    delayedSupervisor.isConnected(),
    false,
    'a spawned child is not ready until initialize completes'
  );
  assert.equal(
    delayedSyncOutcome,
    'pending',
    'syncThreads must wait for the shared initialize handshake'
  );

  delayedChild.releaseInitialize();
  await Promise.all([delayedConnectRequest, delayedSyncRequest]);
  assert.equal(delayedSyncOutcome, 'resolved');
  assert.equal(delayedSupervisor.getStatus(false).state, 'connected');
  assert.equal(
    delayedChild.messages.filter((message) => message.method === 'initialize').length,
    1,
    'concurrent service requests must share one initialize request'
  );
  assert.equal(
    delayedChild.messages.filter((message) => message.method === 'initialized').length,
    1,
    'concurrent service requests must share one initialized notification'
  );
  assert.equal(
    delayedChild.messages.filter((message) => message.method === 'thread/list').length,
    8,
    'both service requests must sync active and archived inventories after readiness'
  );
  assert.equal(
    delayedChild.messages.filter((message) => message.method === 'hooks/list').length,
    0,
    'App Server Connect and Sync must not install or inspect disabled observation hooks'
  );
  assert.equal(delayedBridgeStatus.state, 'not_installed');
  assert.equal(delayedBridgeStatus.listening, false);
  await delayedSupervisor.disconnect();

  console.log('EyesOnAgents App Server tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
