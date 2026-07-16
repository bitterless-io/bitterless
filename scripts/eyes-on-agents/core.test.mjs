import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-core-'));
const THREAD_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

try {
  const contract = await loadTypeScriptModule(
    'contract',
    'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'
  );
  assert.equal(contract.parseEyesOnAgentsUuid(THREAD_ID.toUpperCase()), THREAD_ID);
  assert.throws(() => contract.parseEyesOnAgentsUuid('not-a-thread'), /must be a UUID/);
  assert.equal(contract.buildEyesOnAgentsDeepLink(THREAD_ID), `codex://threads/${THREAD_ID}`);
  assert.throws(
    () => contract.parseEyesOnAgentsThreadIdParams({
      threadId: THREAD_ID,
      url: 'file:///tmp/not-allowed'
    }),
    /unsupported field/
  );
  assert.throws(
    () => contract.parseEyesOnAgentsMoveThreadParams({
      threadId: THREAD_ID,
      domainId: 1,
      executable: '/tmp/not-allowed'
    }),
    /unsupported field/
  );
  assert.equal(
    contract.normalizeEyesOnAgentsThreadStatus({ type: 'notLoaded' }).runtimeState,
    'unknown'
  );
  assert.deepEqual(
    contract.normalizeEyesOnAgentsThreadStatus({
      type: 'active',
      activeFlags: ['waitingOnApproval']
    }),
    {
      runtimeState: 'waiting_approval',
      activeFlags: ['waitingOnApproval'],
      statusSource: 'app_server'
    }
  );
  assert.equal(
    contract.normalizeEyesOnAgentsThreadStatus({
      type: 'active',
      activeFlags: ['waitingOnUserInput']
    }).runtimeState,
    'waiting_input'
  );
  assert.equal(
    contract.normalizeEyesOnAgentsThreadStatus({ type: 'active', activeFlags: [] }).runtimeState,
    'working'
  );
  assert.equal(
    contract.normalizeEyesOnAgentsThreadStatus({
      type: 'active',
      activeFlags: ['futureFlag']
    }).runtimeState,
    'unknown'
  );
  assert.equal(
    contract.isEyesOnAgentsUnread({
      lastCompletedTurnId: 'turn-a',
      lastCompletedAt: 200,
      lastOpenedTurnId: 'turn-a',
      lastOpenedAt: 100
    }),
    false
  );
  assert.equal(
    contract.isEyesOnAgentsUnread({
      lastCompletedTurnId: 'turn-b',
      lastCompletedAt: 200,
      lastOpenedTurnId: 'turn-a',
      lastOpenedAt: 100
    }),
    true
  );
  assert.equal(
    contract.isEyesOnAgentsUnread({
      lastCompletedTurnId: null,
      lastCompletedAt: 200,
      lastOpenedTurnId: null,
      lastOpenedAt: 100
    }),
    true
  );
  assert.equal(contract.isEyesOnAgentsFocused('working', false), true);
  assert.equal(contract.isEyesOnAgentsFocused('idle', true), true);
  assert.equal(contract.isEyesOnAgentsFocused('idle', false), false);
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState({
      runtimeState: 'working',
      statusSource: 'codex_hook',
      statusObservedAt: 120_001,
      managedServerConnected: false,
      hookBridgeState: 'installed',
      hookBridgeListening: true,
      hookBridgeListeningSince: 1
    }),
    'working',
    'hook-active evidence must not expire after 60 seconds in one listener lifetime'
  );
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState({
      runtimeState: 'working',
      statusSource: 'codex_hook',
      statusObservedAt: 120_001,
      managedServerConnected: false,
      hookBridgeState: 'installed',
      hookBridgeListening: true,
      hookBridgeListeningSince: 120_002
    }),
    'unknown'
  );
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState({
      runtimeState: 'working',
      statusSource: 'codex_hook',
      statusObservedAt: 100,
      managedServerConnected: false,
      hookBridgeState: 'needs_trust',
      hookBridgeListening: true,
      hookBridgeListeningSince: 50
    }),
    'unknown',
    'untrusted hook evidence must never be active'
  );
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState({
      runtimeState: 'working',
      statusSource: 'app_server',
      statusObservedAt: 100,
      managedServerConnected: false,
      hookBridgeState: 'installed',
      hookBridgeListening: true,
      hookBridgeListeningSince: 50
    }),
    'unknown'
  );

  const { EyesOnAgentsService } = await loadTypeScriptModule(
    'service',
    'src/main/eyesOnAgents/eyesOnAgents.service.ts'
  );
  const marked = [];
  const repository = {
    getSnapshot: async () => ({
      domains: [{ id: 1, domainKey: 'uncategorized', title: 'Uncategorized', sortIndex: 0, isSystem: true }],
      threads: []
    }),
    markOpened: async (params) => marked.push(params),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined,
    upsertDiscoveredThreads: async () => undefined,
    applyRuntimeEvent: async () => undefined,
    createDomain: async () => undefined,
    renameDomain: async () => undefined,
    deleteDomain: async () => undefined,
    reorderDomains: async () => undefined,
    moveThread: async () => undefined
  };
  const settings = { get: async () => false, upsert: async () => 'ok' };
  const appServer = {
    getStatus: (autoConnectEnabled) => ({
      state: 'disconnected',
      lastSyncedAt: null,
      error: null,
      autoConnectEnabled
    }),
    isConnected: () => false,
    connect: async () => undefined,
    disconnect: async () => undefined,
    listThreads: async () => []
  };
  const desktopBridge = {
    getStatus: () => ({
      state: 'not_installed',
      listening: false,
      listeningSince: null,
      lastEventAt: null,
      error: null
    }),
    install: () => ({
      state: 'needs_trust',
      listening: false,
      listeningSince: null,
      lastEventAt: null,
      error: null
    }),
    remove: () => ({
      state: 'not_installed',
      listening: false,
      listeningSince: null,
      lastEventAt: null,
      error: null
    }),
    updateHookInspection: () => undefined,
    setHookInspectionError: () => undefined
  };
  const bridgeListener = {
    start: async () => undefined,
    stop: async () => undefined
  };
  const failedService = new EyesOnAgentsService({
    repository,
    settings,
    appServer,
    desktopBridge,
    bridgeListener,
    openExternal: async () => {
      throw new Error('no handler');
    },
    now: () => 123
  });
  await assert.rejects(() => failedService.openThread({ threadId: THREAD_ID }), /no handler/);
  assert.equal(marked.length, 0, 'failed deep links must not mark a thread opened');

  const openedUrls = [];
  const successfulService = new EyesOnAgentsService({
    repository,
    settings,
    appServer,
    desktopBridge,
    bridgeListener,
    openExternal: async (url) => openedUrls.push(url),
    now: () => 456
  });
  await successfulService.openThread({ threadId: THREAD_ID });
  assert.deepEqual(openedUrls, [`codex://threads/${THREAD_ID}`]);
  assert.deepEqual(marked, [{ threadId: THREAD_ID, openedAt: 456 }]);

  const reconnectOrder = [];
  let synchronizedThreads = null;
  let connected = false;
  const reconnectService = new EyesOnAgentsService({
    repository: {
      ...repository,
      invalidateCodexHookStatuses: async ({ observedAt }) => {
        reconnectOrder.push(`invalidate-hook:${observedAt}`);
      },
      invalidateAppServerStatuses: async ({ observedAt }) => {
        reconnectOrder.push(`invalidate:${observedAt}`);
      },
      upsertDiscoveredThreads: async ({ threads }) => {
        reconnectOrder.push('upsert');
        synchronizedThreads = threads;
      }
    },
    settings,
    appServer: {
      ...appServer,
      getStatus: (autoConnectEnabled) => ({
        state: connected ? 'connected' : 'disconnected',
        lastSyncedAt: null,
        error: null,
        autoConnectEnabled
      }),
      isConnected: () => connected,
      connect: async () => {
        reconnectOrder.push('connect');
        connected = true;
      },
      listThreads: async () => {
        reconnectOrder.push('list');
        return [{
          id: THREAD_ID,
          name: 'Not loaded task',
          cwd: '/repo',
          status: { type: 'notLoaded' }
        }];
      },
      listHooks: async () => {
        reconnectOrder.push('hooks');
        return [];
      }
    },
    desktopBridge: (() => {
      let status = {
        state: 'not_installed',
        listening: false,
        listeningSince: null,
        lastEventAt: null,
        error: null
      };
      return {
        getStatus: () => status,
        install: () => {
          reconnectOrder.push('bridge-install');
          status = { ...status, state: 'needs_trust' };
          return status;
        },
        remove: () => {
          reconnectOrder.push('bridge-remove');
          status = { ...status, state: 'not_installed' };
          return status;
        },
        updateHookInspection: () => {
          reconnectOrder.push('bridge-inspect');
          status = { ...status, state: 'installed' };
        },
        setHookInspectionError: () => {
          status = { ...status, state: 'error' };
        },
        setListening: (listening) => {
          status = {
            ...status,
            listening,
            listeningSince: listening ? new Date(700).toISOString() : null
          };
        }
      };
    })(),
    bridgeListener: {
      start: async () => {
        reconnectOrder.push('bridge-start');
      },
      stop: async () => {
        reconnectOrder.push('bridge-stop');
      }
    },
    openExternal: async () => undefined,
    now: () => 789
  });
  await reconnectService.connectAppServer();
  assert.deepEqual(
    reconnectOrder,
    [
      'invalidate-hook:789',
      'bridge-start',
      'bridge-install',
      'invalidate-hook:789',
      'invalidate:789',
      'connect',
      'hooks',
      'bridge-inspect',
      'list',
      'upsert'
    ],
    'old managed-server evidence must be invalidated before a replacement server connects'
  );
  assert.deepEqual(synchronizedThreads, [{
    threadId: THREAD_ID,
    title: 'Not loaded task',
    cwd: '/repo',
    runtimeState: 'unknown',
    activeFlags: [],
    statusSource: 'discovery',
    statusObservedAt: 789,
    lastActivityAt: null
  }], 'notLoaded sync evidence must carry the current server observation time');

  const createLifecycleHarness = (autoOnStart) => {
    const calls = [];
    let lifecycleNow = 1_000;
    let appServerConnected = false;
    let duringThreadList = async () => undefined;
    let inspectionReady = true;
    let bridgeStatus = {
      state: 'not_installed',
      listening: false,
      listeningSince: null,
      lastEventAt: null,
      error: null
    };
    const lifecycleRepository = {
      ...repository,
      invalidateAppServerStatuses: async () => calls.push('invalidate-app-server'),
      invalidateCodexHookStatuses: async () => calls.push('invalidate-hook'),
      upsertDiscoveredThreads: async () => calls.push('upsert'),
      applyRuntimeEvent: async ({ event }) => calls.push(`event:${event.type}`)
    };
    const lifecycleBridge = {
      getStatus: () => bridgeStatus,
      install: () => {
        calls.push('bridge-install');
        bridgeStatus = { ...bridgeStatus, state: 'needs_trust', error: null };
        return bridgeStatus;
      },
      remove: () => {
        calls.push('bridge-remove');
        bridgeStatus = { ...bridgeStatus, state: 'not_installed', error: null };
        return bridgeStatus;
      },
      updateHookInspection: () => {
        calls.push('bridge-inspect');
        bridgeStatus = {
          ...bridgeStatus,
          state: inspectionReady ? 'installed' : 'needs_trust',
          error: null
        };
      },
      setHookInspectionError: (error) => {
        bridgeStatus = { ...bridgeStatus, state: 'error', error: String(error) };
      }
    };
    const service = new EyesOnAgentsService({
      repository: lifecycleRepository,
      settings: {
        get: async () => autoOnStart,
        upsert: async ({ value }) => calls.push(`auto:${value}`)
      },
      appServer: {
        getStatus: (autoConnectEnabled) => ({
          state: appServerConnected ? 'connected' : 'disconnected',
          lastSyncedAt: null,
          error: null,
          autoConnectEnabled
        }),
        isConnected: () => appServerConnected,
        connect: async () => {
          calls.push('app-server-connect');
          appServerConnected = true;
        },
        disconnect: async () => {
          calls.push('app-server-disconnect');
          appServerConnected = false;
        },
        listThreads: async () => {
          calls.push('thread-list');
          await duringThreadList();
          return [];
        },
        listHooks: async () => {
          calls.push('hooks-list');
          return [];
        }
      },
      desktopBridge: lifecycleBridge,
      bridgeListener: {
        start: async () => {
          calls.push('listener-start');
          bridgeStatus = {
            ...bridgeStatus,
            listening: true,
            listeningSince: new Date(lifecycleNow).toISOString()
          };
        },
        stop: async () => {
          calls.push('listener-stop');
          bridgeStatus = { ...bridgeStatus, listening: false, listeningSince: null };
        }
      },
      openExternal: async () => undefined,
      now: () => lifecycleNow
    });
    return {
      calls,
      lifecycleBridge,
      service,
      advance: () => { lifecycleNow += 1_000; },
      drift: () => { bridgeStatus = { ...bridgeStatus, state: 'drifted' }; },
      duringThreadList: (callback) => { duringThreadList = callback; },
      setInspectionReady: (ready) => { inspectionReady = ready; },
      status: () => bridgeStatus
    };
  };

  const autoHarness = createLifecycleHarness(true);
  await autoHarness.service.initialize();
  assert.equal(
    autoHarness.calls.filter((call) => call === 'bridge-install').length,
    1,
    'automatic connection must install the Desktop bridge'
  );
  assert.equal(autoHarness.status().state, 'installed');
  await autoHarness.service.shutdown();
  assert.equal(
    autoHarness.calls.includes('bridge-remove'),
    false,
    'normal app shutdown must leave the installation for the next auto-connect'
  );
  assert.equal(autoHarness.status().listening, false);

  const untrustedHarness = createLifecycleHarness(false);
  untrustedHarness.setInspectionReady(false);
  untrustedHarness.duringThreadList(async () => {
    await untrustedHarness.service.applyCodexHookEvent({
      schemaVersion: 1,
      installationId: '11111111-1111-4111-8111-111111111111',
      eventId: '44444444-4444-4444-8444-444444444444',
      occurredAt: 1_001,
      payload: {
        sessionId: THREAD_ID,
        cwd: '/repo',
        hookEventName: 'UserPromptSubmit',
        turnId: 'turn-untrusted'
      }
    });
  });
  await untrustedHarness.service.connectAppServer();
  assert.equal(untrustedHarness.status().state, 'needs_trust');
  assert.equal(
    untrustedHarness.calls.includes('event:turn_started'),
    false,
    'hook events must remain rejected during pagination when Codex has not trusted the bridge'
  );
  await untrustedHarness.service.disconnectAppServer();

  const hookEvent = {
    schemaVersion: 1,
    installationId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    occurredAt: 1_001,
    payload: {
      sessionId: THREAD_ID,
      cwd: '/repo',
      hookEventName: 'UserPromptSubmit',
      turnId: 'turn-focus'
    }
  };
  const explicitHarness = createLifecycleHarness(false);
  explicitHarness.duringThreadList(async () => {
    await explicitHarness.service.applyCodexHookEvent(hookEvent);
  });
  await explicitHarness.service.connectAppServer();
  assert.equal(
    explicitHarness.calls.filter((call) => call === 'bridge-install').length,
    1,
    'explicit connection must install the Desktop bridge'
  );
  assert.ok(
    explicitHarness.calls.indexOf('invalidate-hook') <
      explicitHarness.calls.indexOf('listener-start'),
    'old hook-active evidence must be invalidated before a new listener can receive events'
  );
  assert.ok(
    explicitHarness.calls.indexOf('bridge-inspect') <
      explicitHarness.calls.indexOf('thread-list'),
    'hook trust must be established before thread pagination begins'
  );
  assert.ok(
    explicitHarness.calls.indexOf('thread-list') <
      explicitHarness.calls.indexOf('event:turn_started') &&
      explicitHarness.calls.indexOf('event:turn_started') <
        explicitHarness.calls.indexOf('upsert'),
    'a trusted hook event received during thread pagination must be preserved'
  );
  explicitHarness.duringThreadList(async () => undefined);
  await assert.rejects(
    () => explicitHarness.service.removeCodexBridge(),
    /Disconnect EyesOnAgents/,
    'cleanup must not break a live connected observation path'
  );
  explicitHarness.drift();
  const acceptedEventCount = explicitHarness.calls.filter(
    (call) => call === 'event:turn_started'
  ).length;
  await explicitHarness.service.applyCodexHookEvent({
    ...hookEvent,
    eventId: '33333333-3333-4333-8333-333333333333',
    occurredAt: 1_002
  });
  assert.equal(
    explicitHarness.calls.filter((call) => call === 'event:turn_started').length,
    acceptedEventCount,
    'hook events must be ignored whenever trust inspection is not ready'
  );
  await explicitHarness.service.syncThreads();
  assert.equal(
    explicitHarness.calls.filter((call) => call === 'bridge-install').length,
    2,
    'Sync must repair a drifted Desktop bridge'
  );
  explicitHarness.advance();
  await explicitHarness.service.disconnectAppServer();
  assert.equal(explicitHarness.status().state, 'not_installed');
  assert.equal(explicitHarness.status().listening, false);
  assert.equal(
    explicitHarness.calls.filter((call) => call === 'bridge-remove').length,
    1,
    'explicit disconnect must remove the Desktop bridge'
  );

  console.log('EyesOnAgents core tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
