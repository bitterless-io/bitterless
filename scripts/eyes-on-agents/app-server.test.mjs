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
      const result = cursor === null
        ? { data: [{ id: 'one' }], nextCursor: 'page-2' }
        : { data: [{ id: 'two' }], nextCursor: null };
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
    const result = { data: [{ hooks: [{ enabled: 'yes' }] }] };
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
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
  assert.deepEqual(await supervisor.listHooks(), [{
    command: '/fixed/bitterless-hook',
    enabled: true,
    eventName: 'stop',
    handlerType: 'command',
    matcher: null,
    trustStatus: 'trusted'
  }], 'hooks/list must return only the bounded fields needed for owned-hook inspection');

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
    upsertDiscoveredThreads: async () => undefined
  };
  let delayedBridgeStatus = {
    state: 'not_installed',
    listening: false,
    listeningSince: null,
    lastEventAt: null,
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
  assert.ok(
    delayedChild.messages.findIndex((message) => message.method === 'hooks/list') <
      delayedChild.messages.findIndex((message) => message.method === 'thread/list'),
    'hook trust inspection must begin before any thread/list page request'
  );
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
    4,
    'both service requests must sync successfully after readiness'
  );
  assert.equal(
    delayedChild.messages.filter((message) => message.method === 'hooks/list').length,
    2,
    'both service requests must refresh hook trust after sync'
  );
  await delayedSupervisor.disconnect();

  console.log('EyesOnAgents App Server tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
