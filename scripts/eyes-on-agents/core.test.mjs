import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-core-'));
const THREAD_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';
const ARCHIVED_THREAD_ID = '11111111-1111-4111-8111-111111111111';

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
    upsertThreadSnapshots: async () => undefined,
    setThreadArchived: async () => undefined,
    markThreadsArchived: async () => undefined,
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
    listThreads: async () => [],
    listArchivedThreads: async () => []
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
  let synchronizedSnapshots = null;
  let synchronizedArchivedThreadIds = null;
  let connected = false;
  let setReconnectListening = () => undefined;
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
      },
      upsertThreadSnapshots: async ({ snapshots }) => {
        reconnectOrder.push('snapshots');
        synchronizedSnapshots = snapshots;
      },
      markThreadsArchived: async ({ threadIds }) => {
        reconnectOrder.push('archive');
        synchronizedArchivedThreadIds = threadIds;
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
      listArchivedThreads: async () => {
        reconnectOrder.push('list-archived');
        return [{ id: ARCHIVED_THREAD_ID }, { id: 'malformed-archive-id' }];
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
      setReconnectListening = (listening) => {
        status = {
          ...status,
          listening,
          listeningSince: listening ? new Date(700).toISOString() : null
        };
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
        }
      };
    })(),
    bridgeListener: {
      start: async () => {
        reconnectOrder.push('bridge-start');
        setReconnectListening(true);
      },
      stop: async () => {
        reconnectOrder.push('bridge-stop');
        setReconnectListening(false);
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
      'invalidate:789',
      'connect',
      'hooks',
      'bridge-inspect',
      'list',
      'list-archived',
      'snapshots',
      'upsert',
      'archive'
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
  assert.equal(synchronizedSnapshots.length, 2);
  assert.deepEqual(
    synchronizedSnapshots.map((snapshot) => ({
      threadId: snapshot.threadId,
      archived: snapshot.archived,
      syncedAt: snapshot.syncedAt,
      payload: JSON.parse(snapshot.payloadJson)
    })),
    [
      {
        threadId: THREAD_ID,
        archived: false,
        syncedAt: 789,
        payload: {
          id: THREAD_ID,
          name: 'Not loaded task',
          cwd: '/repo',
          status: { type: 'notLoaded' }
        }
      },
      {
        threadId: ARCHIVED_THREAD_ID,
        archived: true,
        syncedAt: 789,
        payload: { id: ARCHIVED_THREAD_ID }
      }
    ],
    'sync must persist complete valid objects from active and archived inventories'
  );
  assert.deepEqual(
    synchronizedArchivedThreadIds,
    [ARCHIVED_THREAD_ID],
    'archive reconciliation must skip malformed entries without discarding valid ids'
  );

  const createLifecycleHarness = (autoOnStart) => {
    const calls = [];
    const runtimeEvents = [];
    const archiveTransitions = [];
    const archivedBatches = [];
    const discoveredBatches = [];
    const snapshotBatches = [];
    let lifecycleNow = 1_000;
    let appServerConnected = false;
    let activeInventory = [];
    let archivedInventory = [];
    let settingValue = autoOnStart;
    let duringAppServerInvalidation = async () => undefined;
    let duringArchiveTransition = async () => undefined;
    let duringAppServerConnect = async () => undefined;
    let duringAppServerDisconnect = async () => undefined;
    let duringHookInvalidation = async () => undefined;
    let duringHooksList = async () => undefined;
    let duringListenerStart = async () => undefined;
    let duringListenerStop = async () => undefined;
    let duringRuntimeEvent = async () => undefined;
    let duringSettingGet = async () => undefined;
    let duringSettingUpsert = async () => undefined;
    let duringThreadList = async () => undefined;
    let inspectionError = null;
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
      invalidateAppServerStatuses: async () => {
        calls.push('invalidate-app-server');
        await duringAppServerInvalidation();
      },
      invalidateCodexHookStatuses: async () => {
        calls.push('invalidate-hook');
        await duringHookInvalidation();
      },
      upsertDiscoveredThreads: async ({ threads }) => {
        discoveredBatches.push(threads);
        calls.push('upsert');
      },
      upsertThreadSnapshots: async ({ snapshots }) => {
        snapshotBatches.push(snapshots);
        calls.push('snapshots');
      },
      setThreadArchived: async (params) => {
        archiveTransitions.push(params);
        await duringArchiveTransition(params);
      },
      markThreadsArchived: async (params) => archivedBatches.push(params),
      applyRuntimeEvent: async ({ event }) => {
        runtimeEvents.push({ event, callIndex: calls.length });
        calls.push(`event:${event.type}`);
        await duringRuntimeEvent(event);
        calls.push(`event-finished:${event.type}`);
      }
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
        get: async () => {
          await duringSettingGet();
          return settingValue;
        },
        upsert: async ({ value }) => {
          await duringSettingUpsert(value);
          settingValue = value;
          calls.push(`auto:${value}`);
        }
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
          await duringAppServerConnect();
          appServerConnected = true;
        },
        disconnect: async () => {
          calls.push('app-server-disconnect');
          await duringAppServerDisconnect();
          appServerConnected = false;
        },
        listThreads: async () => {
          calls.push('thread-list');
          await duringThreadList();
          return activeInventory;
        },
        listArchivedThreads: async () => archivedInventory,
        listHooks: async () => {
          calls.push('hooks-list');
          await duringHooksList();
          if (inspectionError) throw inspectionError;
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
          await duringListenerStart();
        },
        stop: async () => {
          calls.push('listener-stop');
          await duringListenerStop();
          bridgeStatus = { ...bridgeStatus, listening: false, listeningSince: null };
        }
      },
      openExternal: async () => undefined,
      broadcastChanged: () => calls.push('notify'),
      now: () => lifecycleNow
    });
    return {
      calls,
      archiveTransitions,
      archivedBatches,
      discoveredBatches,
      snapshotBatches,
      lifecycleBridge,
      runtimeEvents,
      service,
      advance: () => { lifecycleNow += 1_000; },
      drift: () => { bridgeStatus = { ...bridgeStatus, state: 'drifted' }; },
      duringAppServerConnect: (callback) => { duringAppServerConnect = callback; },
      duringAppServerDisconnect: (callback) => { duringAppServerDisconnect = callback; },
      duringAppServerInvalidation: (callback) => { duringAppServerInvalidation = callback; },
      duringArchiveTransition: (callback) => { duringArchiveTransition = callback; },
      duringHookInvalidation: (callback) => { duringHookInvalidation = callback; },
      duringHooksList: (callback) => { duringHooksList = callback; },
      duringListenerStart: (callback) => { duringListenerStart = callback; },
      duringListenerStop: (callback) => { duringListenerStop = callback; },
      duringRuntimeEvent: (callback) => { duringRuntimeEvent = callback; },
      duringSettingGet: (callback) => { duringSettingGet = callback; },
      duringSettingUpsert: (callback) => { duringSettingUpsert = callback; },
      duringThreadList: (callback) => { duringThreadList = callback; },
      restartListenerLifetime: () => {
        lifecycleNow += 1_000;
        bridgeStatus = {
          ...bridgeStatus,
          listening: true,
          listeningSince: new Date(lifecycleNow).toISOString()
        };
      },
      setInspectionError: (error) => { inspectionError = error; },
      setInspectionReady: (ready) => { inspectionReady = ready; },
      setThreadInventories: ({ active, archived }) => {
        activeInventory = active;
        archivedInventory = archived;
      },
      isAppServerConnected: () => appServerConnected,
      settingValue: () => settingValue,
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

  const archiveHarness = createLifecycleHarness(false);
  await archiveHarness.service.connectAppServer();
  archiveHarness.advance();
  const archiveNotifyCount = archiveHarness.calls.filter((call) => call === 'notify').length;
  await archiveHarness.service.handleAppServerNotification('thread/archived', {
    threadId: THREAD_ID
  });
  assert.deepEqual(archiveHarness.archiveTransitions.at(-1), {
    threadId: THREAD_ID,
    archived: true,
    observedAt: 2_000
  });
  assert.equal(
    archiveHarness.calls.filter((call) => call === 'notify').length,
    archiveNotifyCount + 1,
    'a managed archive notification must refresh EyesOnAgents immediately'
  );
  await archiveHarness.service.handleAppServerNotification('thread/archived', {
    threadId: 'malformed-thread-id'
  });
  assert.equal(
    archiveHarness.archiveTransitions.length,
    1,
    'malformed archive notifications must not reach persistence'
  );
  archiveHarness.duringArchiveTransition(async () => {
    throw new Error('simulated archive persistence failure');
  });
  const failedArchiveNotifyCount = archiveHarness.calls.filter(
    (call) => call === 'notify'
  ).length;
  await assert.rejects(
    () => archiveHarness.service.handleAppServerNotification('thread/archived', {
      threadId: ARCHIVED_THREAD_ID
    }),
    /simulated archive persistence failure/
  );
  assert.equal(
    archiveHarness.calls.filter((call) => call === 'notify').length,
    failedArchiveNotifyCount,
    'a failed archive write must propagate without broadcasting stale state'
  );
  archiveHarness.duringArchiveTransition(async () => undefined);

  archiveHarness.setThreadInventories({
    active: [{
      id: THREAD_ID,
      name: 'Restored task',
      cwd: '/repo',
      status: { type: 'notLoaded' }
    }],
    archived: [{ id: 'malformed-archive-id' }]
  });
  const unarchiveNotifyCount = archiveHarness.calls.filter((call) => call === 'notify').length;
  await archiveHarness.service.handleAppServerNotification('thread/unarchived', {
    threadId: THREAD_ID
  });
  assert.deepEqual(archiveHarness.archiveTransitions.at(-1), {
    threadId: THREAD_ID,
    archived: false,
    observedAt: 2_000
  });
  assert.equal(archiveHarness.discoveredBatches.at(-1)[0].threadId, THREAD_ID);
  assert.deepEqual(
    archiveHarness.archivedBatches.at(-1),
    { threadIds: [], observedAt: 2_000 },
    'unarchive reconciliation must ignore malformed archived inventory rows individually'
  );
  assert.equal(
    archiveHarness.calls.filter((call) => call === 'notify').length,
    unarchiveNotifyCount + 2,
    'unarchive must refresh immediately and again after its full reconciliation'
  );
  await archiveHarness.service.disconnectAppServer();

  const startBoundaryEvent = {
    schemaVersion: 1,
    installationId: '11111111-1111-4111-8111-111111111111',
    eventId: '55555555-5555-4555-8555-555555555555',
    occurredAt: 1_000,
    payload: {
      sessionId: THREAD_ID,
      cwd: '/repo',
      hookEventName: 'UserPromptSubmit',
      turnId: 'turn-start-boundary'
    }
  };
  const boundaryHarness = createLifecycleHarness(false);
  let releaseBoundaryInspection;
  const boundaryInspectionGate = new Promise((resolve) => {
    releaseBoundaryInspection = resolve;
  });
  boundaryHarness.duringListenerStart(async () => {
    await boundaryHarness.service.applyCodexHookEvent(startBoundaryEvent);
  });
  boundaryHarness.duringHooksList(async () => await boundaryInspectionGate);
  const boundaryConnect = boundaryHarness.service.connectAppServer();
  const boundarySync = boundaryHarness.service.syncThreads();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    boundaryHarness.calls.filter((call) => call === 'listener-start').length,
    1,
    'concurrent Connect and Sync must share one listener-start transition'
  );
  assert.equal(
    boundaryHarness.calls.filter((call) => call === 'hooks-list').length,
    1,
    'concurrent sync inspections must share one pending hooks/list request'
  );
  assert.equal(
    boundaryHarness.runtimeEvents.length,
    0,
    'a start-boundary event must remain buffered while hooks/list is pending'
  );
  releaseBoundaryInspection();
  await Promise.all([boundaryConnect, boundarySync]);
  const boundaryRuntimeEvent = boundaryHarness.runtimeEvents.find(
    ({ event }) => event.turnId === 'turn-start-boundary'
  );
  assert.equal(boundaryRuntimeEvent?.event.type, 'turn_started');
  assert.ok(
    boundaryHarness.calls.lastIndexOf('invalidate-hook') < boundaryRuntimeEvent.callIndex,
    'no old-lifetime invalidation may run after the start-boundary event is consumed'
  );
  await boundaryHarness.service.disconnectAppServer();

  const pendingStartEvent = {
    schemaVersion: 1,
    installationId: '11111111-1111-4111-8111-111111111111',
    eventId: '66666666-6666-4666-8666-666666666666',
    occurredAt: 1_001,
    payload: {
      sessionId: THREAD_ID,
      cwd: '/repo',
      hookEventName: 'UserPromptSubmit',
      turnId: 'turn-inspection-pending'
    }
  };
  const pendingStopEvent = {
    schemaVersion: 1,
    installationId: '11111111-1111-4111-8111-111111111111',
    eventId: '77777777-7777-4777-8777-777777777777',
    occurredAt: 1_002,
    payload: {
      sessionId: THREAD_ID,
      cwd: '/repo',
      hookEventName: 'Stop',
      turnId: 'turn-inspection-pending'
    }
  };

  const trustedInspectionHarness = createLifecycleHarness(false);
  let injectedDuringFlush = false;
  trustedInspectionHarness.duringRuntimeEvent(async (event) => {
    if (event.type !== 'turn_started' || injectedDuringFlush) return;
    injectedDuringFlush = true;
    await trustedInspectionHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '99999999-9999-4999-8999-999999999999',
      occurredAt: 1_003,
      payload: {
        ...pendingStartEvent.payload,
        hookEventName: 'PermissionRequest'
      }
    });
  });
  trustedInspectionHarness.duringHooksList(async () => {
    await trustedInspectionHarness.service.applyCodexHookEvent(pendingStartEvent);
    await trustedInspectionHarness.service.applyCodexHookEvent(pendingStopEvent);
    assert.equal(
      trustedInspectionHarness.runtimeEvents.length,
      0,
      'hook events must not be consumed before hooks/list resolves'
    );
  });
  await trustedInspectionHarness.service.connectAppServer();
  assert.deepEqual(
    trustedInspectionHarness.runtimeEvents.map(({ event }) => event.type),
    ['turn_started', 'turn_completed', 'thread_status'],
    'a trusted inspection must preserve receive order, including events received while draining'
  );
  await trustedInspectionHarness.service.disconnectAppServer();

  const untrustedHarness = createLifecycleHarness(false);
  untrustedHarness.setInspectionReady(false);
  untrustedHarness.duringHooksList(async () => {
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
    await untrustedHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: '88888888-8888-4888-8888-888888888888',
      payload: { ...pendingStopEvent.payload, turnId: 'turn-untrusted' }
    });
  });
  await untrustedHarness.service.connectAppServer();
  assert.equal(untrustedHarness.status().state, 'needs_trust');
  assert.equal(
    untrustedHarness.runtimeEvents.length,
    0,
    'a non-installed inspection must discard active and terminal pending events'
  );
  await untrustedHarness.service.disconnectAppServer();

  const inspectionErrorHarness = createLifecycleHarness(false);
  inspectionErrorHarness.setInspectionError(new Error('private hooks/list detail'));
  inspectionErrorHarness.duringHooksList(async () => {
    await inspectionErrorHarness.service.applyCodexHookEvent(pendingStartEvent);
    await inspectionErrorHarness.service.applyCodexHookEvent(pendingStopEvent);
  });
  await inspectionErrorHarness.service.connectAppServer();
  assert.equal(inspectionErrorHarness.status().state, 'error');
  assert.equal(
    inspectionErrorHarness.runtimeEvents.length,
    0,
    'a hooks/list error must discard all pending events without durable writes'
  );
  await inspectionErrorHarness.service.disconnectAppServer();

  const failedFlushHarness = createLifecycleHarness(false);
  const failedFlushTailAdmissions = [];
  let failedFlushInspectionCount = 0;
  const failedFlushTurnId = 'turn-failed-flush';
  const failedFlushTailTurnId = 'turn-after-failed-flush';
  failedFlushHarness.duringHooksList(async () => {
    failedFlushInspectionCount += 1;
    if (failedFlushInspectionCount !== 1) return;
    await failedFlushHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: 'abababab-abab-4bab-8bab-abababababab',
      payload: { ...pendingStopEvent.payload, turnId: failedFlushTurnId }
    });
  });
  failedFlushHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId !== failedFlushTurnId) return;
    failedFlushTailAdmissions.push(failedFlushHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
      occurredAt: 1_003,
      payload: { ...pendingStopEvent.payload, turnId: failedFlushTailTurnId }
    }));
    throw new Error('simulated repository failure');
  });
  await assert.rejects(
    () => failedFlushHarness.service.connectAppServer(),
    /simulated repository failure/
  );
  await Promise.all(failedFlushTailAdmissions);
  assert.equal(failedFlushHarness.status().state, 'error');
  assert.deepEqual(
    failedFlushHarness.runtimeEvents.map(({ event }) => event.turnId),
    [failedFlushTurnId],
    'a failed buffered write must reject its lifetime before a queued tail event can persist'
  );
  await failedFlushHarness.service.applyCodexHookEvent({
    ...pendingStartEvent,
    eventId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    payload: { ...pendingStartEvent.payload, turnId: 'turn-after-rejected-flush' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    failedFlushHarness.runtimeEvents.length,
    1,
    'a repository failure must fail closed until a fresh inspection succeeds'
  );
  failedFlushHarness.duringRuntimeEvent(async () => undefined);
  failedFlushHarness.setInspectionReady(false);
  failedFlushHarness.duringHooksList(async () => {
    await failedFlushHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: 'dededede-dede-4ede-8ede-dededededede',
      occurredAt: 1_004,
      payload: { ...pendingStopEvent.payload, turnId: 'turn-untrusted-after-failed-flush' }
    });
  });
  await failedFlushHarness.service.syncThreads();
  assert.equal(failedFlushHarness.status().state, 'needs_trust');
  assert.equal(
    failedFlushHarness.runtimeEvents.length,
    1,
    'a failed old tail must not cross a later non-installed hooks/list boundary'
  );
  failedFlushHarness.setInspectionReady(true);
  failedFlushHarness.duringHooksList(async () => undefined);
  await failedFlushHarness.service.syncThreads();
  assert.equal(failedFlushHarness.status().state, 'installed');
  await failedFlushHarness.service.applyCodexHookEvent({
    ...pendingStartEvent,
    eventId: 'efefefef-efef-4fef-8fef-efefefefefef',
    occurredAt: 1_005,
    payload: { ...pendingStartEvent.payload, turnId: 'turn-after-failed-flush-recovery' }
  });
  for (let attempt = 0; attempt < 10 && failedFlushHarness.runtimeEvents.length < 2; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(
    failedFlushHarness.runtimeEvents.at(-1)?.event.turnId,
    'turn-after-failed-flush-recovery',
    'a later trusted Sync must establish a fresh admission boundary after a write failure'
  );
  await failedFlushHarness.service.disconnectAppServer();

  const directFailureHarness = createLifecycleHarness(false);
  await directFailureHarness.service.connectAppServer();
  const directFailureNotifyCount = directFailureHarness.calls.filter(
    (call) => call === 'notify'
  ).length;
  directFailureHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId === 'turn-direct-write-failure') {
      throw new Error('simulated direct repository failure');
    }
  });
  await directFailureHarness.service.applyCodexHookEvent({
    ...pendingStartEvent,
    eventId: 'fafafafa-fafa-4afa-8afa-fafafafafafa',
    occurredAt: 1_006,
    payload: { ...pendingStartEvent.payload, turnId: 'turn-direct-write-failure' }
  });
  for (let attempt = 0; attempt < 10 && directFailureHarness.status().state !== 'error'; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const directFailureEventIndex = directFailureHarness.calls.indexOf('event:turn_started');
  const directFailureInvalidationIndex = directFailureHarness.calls.lastIndexOf('invalidate-hook');
  const directFailureNotifyIndex = directFailureHarness.calls.lastIndexOf('notify');
  assert.equal(directFailureHarness.status().state, 'error');
  assert.ok(
    directFailureEventIndex < directFailureInvalidationIndex &&
      directFailureInvalidationIndex < directFailureNotifyIndex,
    'a direct hook write failure must invalidate evidence before broadcasting its error state'
  );
  assert.equal(
    directFailureHarness.calls.filter((call) => call === 'notify').length,
    directFailureNotifyCount + 1,
    'a fire-and-forget hook write failure must refresh the renderer exactly once'
  );
  await directFailureHarness.service.applyCodexHookEvent({
    ...pendingStopEvent,
    eventId: 'acacacac-acac-4cac-8cac-acacacacacac',
    occurredAt: 1_007,
    payload: { ...pendingStopEvent.payload, turnId: 'turn-after-direct-write-failure' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    directFailureHarness.runtimeEvents.length,
    1,
    'the renderer refresh must not reopen hook admission after a direct write failure'
  );
  await directFailureHarness.service.disconnectAppServer();

  for (const retryInstalled of [true, false]) {
    const failureRaceHarness = createLifecycleHarness(false);
    await failureRaceHarness.service.connectAppServer();
    const retryLabel = retryInstalled ? 'installed' : 'needs-trust';
    const failedTurnId = `turn-live-failure-${retryLabel}`;
    const oldSuffixTurnId = `turn-old-suffix-${retryLabel}`;
    let releaseFailureInvalidation;
    let markFailureInvalidationStarted;
    const failureInvalidationStarted = new Promise((resolve) => {
      markFailureInvalidationStarted = resolve;
    });
    const failureInvalidationGate = new Promise((resolve) => {
      releaseFailureInvalidation = resolve;
    });
    const oldSuffixAdmissions = [];
    failureRaceHarness.duringHookInvalidation(async () => {
      markFailureInvalidationStarted();
      await failureInvalidationGate;
    });
    failureRaceHarness.duringRuntimeEvent(async (event) => {
      if (event.turnId !== failedTurnId) return;
      oldSuffixAdmissions.push(failureRaceHarness.service.applyCodexHookEvent({
        ...pendingStopEvent,
        eventId: `old-suffix-${retryLabel}`,
        occurredAt: 1_009,
        payload: { ...pendingStopEvent.payload, turnId: oldSuffixTurnId }
      }));
      throw new Error(`simulated live failure before ${retryLabel} retry`);
    });
    await failureRaceHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: `live-failure-${retryLabel}`,
      occurredAt: 1_008,
      payload: { ...pendingStartEvent.payload, turnId: failedTurnId }
    });
    await failureInvalidationStarted;
    failureRaceHarness.setInspectionReady(retryInstalled);
    const hooksListsBeforeRetry = failureRaceHarness.calls.filter(
      (call) => call === 'hooks-list'
    ).length;
    const concurrentRetry = failureRaceHarness.service.syncThreads();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      failureRaceHarness.calls.filter((call) => call === 'hooks-list').length,
      hooksListsBeforeRetry,
      `a fresh ${retryLabel} inspection must wait for the failed old admission tail`
    );
    releaseFailureInvalidation();
    await Promise.all([concurrentRetry, ...oldSuffixAdmissions]);
    assert.deepEqual(
      failureRaceHarness.runtimeEvents.map(({ event }) => event.turnId),
      [failedTurnId],
      `a fresh ${retryLabel} inspection must never revive an old queued suffix`
    );
    assert.equal(
      failureRaceHarness.status().state,
      retryInstalled ? 'installed' : 'needs_trust'
    );
    failureRaceHarness.duringHookInvalidation(async () => undefined);
    failureRaceHarness.duringRuntimeEvent(async () => undefined);
    await failureRaceHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: `new-admission-${retryLabel}`,
      occurredAt: 1_010,
      payload: {
        ...pendingStartEvent.payload,
        turnId: `turn-new-admission-${retryLabel}`
      }
    });
    for (let attempt = 0; attempt < 10 && failureRaceHarness.runtimeEvents.length < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(
      failureRaceHarness.runtimeEvents.length,
      retryInstalled ? 2 : 1,
      `only a fresh installed inspection may reopen hook admission after failure`
    );
    await failureRaceHarness.service.disconnectAppServer();
  }

  const overflowHarness = createLifecycleHarness(false);
  overflowHarness.duringHooksList(async () => {
    for (let index = 0; index <= 256; index += 1) {
      await overflowHarness.service.applyCodexHookEvent({
        ...pendingStartEvent,
        eventId: `overflow-${index}`,
        occurredAt: 1_001 + index,
        payload: {
          ...pendingStartEvent.payload,
          turnId: `turn-overflow-${index}`
        }
      });
    }
  });
  await overflowHarness.service.connectAppServer();
  assert.equal(overflowHarness.status().state, 'error');
  assert.equal(
    overflowHarness.runtimeEvents.length,
    0,
    'overflowing the bounded inspection buffer must discard the whole batch'
  );
  await overflowHarness.service.applyCodexHookEvent({
    ...pendingStopEvent,
    eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    payload: { ...pendingStopEvent.payload, turnId: 'turn-after-overflow-before-retry' }
  });
  assert.equal(
    overflowHarness.runtimeEvents.length,
    0,
    'an overflowed listener lifetime must reject future events until Sync retries inspection'
  );
  overflowHarness.duringHooksList(async () => undefined);
  await overflowHarness.service.syncThreads();
  assert.equal(overflowHarness.status().state, 'installed');
  await overflowHarness.service.applyCodexHookEvent({
    ...pendingStartEvent,
    eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    payload: { ...pendingStartEvent.payload, turnId: 'turn-after-overflow-retry' }
  });
  assert.deepEqual(
    overflowHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-after-overflow-retry'],
    'a later successful Sync must establish a fresh admission boundary'
  );
  await overflowHarness.service.disconnectAppServer();

  const trustedTailHarness = createLifecycleHarness(false);
  const tailAdmissions = [];
  trustedTailHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId !== 'turn-trigger-trusted-tail') return;
    for (let index = 0; index <= 256; index += 1) {
      tailAdmissions.push(trustedTailHarness.service.applyCodexHookEvent({
        ...pendingStartEvent,
        eventId: `trusted-tail-${index}`,
        occurredAt: 1_010 + index,
        payload: {
          ...pendingStartEvent.payload,
          turnId: `turn-trusted-tail-${index}`
        }
      }));
    }
  });
  trustedTailHarness.duringHooksList(async () => {
    await trustedTailHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payload: { ...pendingStopEvent.payload, turnId: 'turn-trigger-trusted-tail' }
    });
  });
  await trustedTailHarness.service.connectAppServer();
  await Promise.all(tailAdmissions);
  for (let attempt = 0; attempt < 300 && trustedTailHarness.runtimeEvents.length < 258; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(trustedTailHarness.status().state, 'installed');
  assert.equal(trustedTailHarness.runtimeEvents.length, 258);
  assert.equal(
    trustedTailHarness.runtimeEvents[0].event.type,
    'turn_completed',
    'the trusted terminal prefix must persist before events admitted during its drain'
  );
  assert.deepEqual(
    trustedTailHarness.runtimeEvents.slice(1).map(({ event }) => event.turnId),
    Array.from({ length: 257 }, (_, index) => `turn-trusted-tail-${index}`),
    'events arriving during a trusted drain must use the independent FIFO write tail'
  );
  await trustedTailHarness.service.disconnectAppServer();

  const slowWriteSyncHarness = createLifecycleHarness(false);
  await slowWriteSyncHarness.service.connectAppServer();
  let releaseSlowWrite;
  let markSlowWriteStarted;
  const slowWriteStarted = new Promise((resolve) => {
    markSlowWriteStarted = resolve;
  });
  const slowWriteGate = new Promise((resolve) => {
    releaseSlowWrite = resolve;
  });
  slowWriteSyncHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId !== 'turn-slow-write-sync') return;
    markSlowWriteStarted();
    await slowWriteGate;
  });
  await slowWriteSyncHarness.service.applyCodexHookEvent({
    ...pendingStartEvent,
    eventId: 'adadadad-adad-4dad-8dad-adadadadadad',
    occurredAt: 1_011,
    payload: { ...pendingStartEvent.payload, turnId: 'turn-slow-write-sync' }
  });
  await slowWriteStarted;
  const slowWriteHooksBefore = slowWriteSyncHarness.calls.filter(
    (call) => call === 'hooks-list'
  ).length;
  const syncDuringSlowWrite = slowWriteSyncHarness.service.syncThreads();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    slowWriteSyncHarness.calls.filter((call) => call === 'hooks-list').length,
    slowWriteHooksBefore,
    'Sync must establish a pending admission boundary before draining a trusted slow write'
  );
  await slowWriteSyncHarness.service.applyCodexHookEvent({
    ...pendingStopEvent,
    eventId: 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae',
    occurredAt: 1_012,
    payload: { ...pendingStopEvent.payload, turnId: 'turn-slow-write-sync' }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    slowWriteSyncHarness.runtimeEvents.map(({ event }) => event.type),
    ['turn_started'],
    'a terminal event received during drain must wait in the fresh inspection buffer'
  );
  releaseSlowWrite();
  await syncDuringSlowWrite;
  assert.deepEqual(
    slowWriteSyncHarness.runtimeEvents.map(({ event }) => event.type),
    ['turn_started', 'turn_completed'],
    'fresh trusted inspection must preserve a terminal event received during slow-write drain'
  );
  await slowWriteSyncHarness.service.disconnectAppServer();

  const lifetimeSwitchHarness = createLifecycleHarness(false);
  let lifetimeInspectionCount = 0;
  lifetimeSwitchHarness.duringHooksList(async () => {
    lifetimeInspectionCount += 1;
    if (lifetimeInspectionCount !== 1) return;
    await lifetimeSwitchHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      payload: { ...pendingStopEvent.payload, turnId: 'turn-old-lifetime' }
    });
    lifetimeSwitchHarness.restartListenerLifetime();
    await lifetimeSwitchHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      occurredAt: 2_001,
      payload: { ...pendingStartEvent.payload, turnId: 'turn-new-lifetime' }
    });
  });
  await lifetimeSwitchHarness.service.connectAppServer();
  assert.equal(lifetimeInspectionCount, 2, 'a listener change must trigger a fresh inspection');
  assert.deepEqual(
    lifetimeSwitchHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-new-lifetime'],
    'pending events from an old listener lifetime must never cross into the replacement lifetime'
  );
  await lifetimeSwitchHarness.service.disconnectAppServer();

  const drainLifetimeSwitchHarness = createLifecycleHarness(false);
  let drainLifetimeInspectionCount = 0;
  let releaseDrainLifetimeWrite;
  const drainLifetimeWriteGate = new Promise((resolve) => {
    releaseDrainLifetimeWrite = resolve;
  });
  drainLifetimeSwitchHarness.duringHooksList(async () => {
    drainLifetimeInspectionCount += 1;
    if (drainLifetimeInspectionCount !== 1) return;
    await drainLifetimeSwitchHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '12121212-1212-4212-8212-121212121212',
      payload: { ...pendingStartEvent.payload, turnId: 'turn-drain-old-lifetime' }
    });
  });
  drainLifetimeSwitchHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId !== 'turn-drain-old-lifetime') return;
    drainLifetimeSwitchHarness.restartListenerLifetime();
    await drainLifetimeSwitchHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '13131313-1313-4313-8313-131313131313',
      occurredAt: 2_001,
      payload: { ...pendingStartEvent.payload, turnId: 'turn-drain-new-lifetime' }
    });
    await drainLifetimeWriteGate;
  });
  const drainLifetimeConnect = drainLifetimeSwitchHarness.service.connectAppServer();
  const drainLifetimeSync = drainLifetimeSwitchHarness.service.syncThreads();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drainLifetimeInspectionCount, 1);
  assert.equal(
    drainLifetimeSwitchHarness.calls.includes('thread-list'),
    false,
    'shared refresh callers must remain behind the inspection gate during an old-lifetime drain'
  );
  releaseDrainLifetimeWrite();
  await Promise.all([drainLifetimeConnect, drainLifetimeSync]);
  assert.equal(
    drainLifetimeInspectionCount,
    2,
    'a lifetime replacement during repository drain must run a fresh hooks/list inspection'
  );
  const drainHookIndexes = drainLifetimeSwitchHarness.calls.flatMap((call, index) =>
    call === 'hooks-list' ? [index] : []
  );
  const replacementRuntimeEvent = drainLifetimeSwitchHarness.runtimeEvents.find(
    ({ event }) => event.turnId === 'turn-drain-new-lifetime'
  );
  assert.ok(
    drainHookIndexes[1] < replacementRuntimeEvent.callIndex &&
      replacementRuntimeEvent.callIndex <
        drainLifetimeSwitchHarness.calls.indexOf('thread-list'),
    'replacement events must wait for their fresh inspection before any thread enumeration'
  );
  await drainLifetimeSwitchHarness.service.disconnectAppServer();

  const rejectedDrainReplacementHarness = createLifecycleHarness(false);
  let rejectedDrainInspectionCount = 0;
  rejectedDrainReplacementHarness.duringHooksList(async () => {
    rejectedDrainInspectionCount += 1;
    if (rejectedDrainInspectionCount !== 1) return;
    await rejectedDrainReplacementHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '19191919-1919-4919-8919-191919191919',
      payload: { ...pendingStartEvent.payload, turnId: 'turn-rejected-drain-old' }
    });
  });
  rejectedDrainReplacementHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId !== 'turn-rejected-drain-old') return;
    rejectedDrainReplacementHarness.restartListenerLifetime();
    rejectedDrainReplacementHarness.setInspectionReady(false);
    await rejectedDrainReplacementHarness.service.applyCodexHookEvent({
      ...pendingStopEvent,
      eventId: '20202020-2020-4020-8020-202020202020',
      occurredAt: 2_001,
      payload: { ...pendingStopEvent.payload, turnId: 'turn-rejected-drain-new' }
    });
  });
  await rejectedDrainReplacementHarness.service.connectAppServer();
  assert.equal(rejectedDrainInspectionCount, 2);
  assert.equal(rejectedDrainReplacementHarness.status().state, 'needs_trust');
  assert.deepEqual(
    rejectedDrainReplacementHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-rejected-drain-old'],
    'a non-installed replacement inspection must discard its buffered terminal event'
  );
  await rejectedDrainReplacementHarness.service.disconnectAppServer();

  const pendingShutdownHarness = createLifecycleHarness(false);
  let pendingShutdownInspectionCount = 0;
  let releasePendingShutdownInspection;
  const pendingShutdownInspectionGate = new Promise((resolve) => {
    releasePendingShutdownInspection = resolve;
  });
  pendingShutdownHarness.duringHooksList(async () => {
    pendingShutdownInspectionCount += 1;
    if (pendingShutdownInspectionCount === 1) {
      await pendingShutdownInspectionGate;
      return;
    }
    await pendingShutdownHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '14141414-1414-4414-8414-141414141414',
      payload: { ...pendingStartEvent.payload, turnId: 'turn-after-pending-shutdown' }
    });
  });
  const pendingShutdownConnect = pendingShutdownHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingShutdownInspectionCount, 1);
  await pendingShutdownHarness.service.shutdown();
  await pendingShutdownConnect;
  const pendingShutdownFinalInvalidation = pendingShutdownHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    pendingShutdownHarness.calls.indexOf('app-server-disconnect') <
      pendingShutdownHarness.calls.indexOf('listener-stop') &&
      pendingShutdownHarness.calls.lastIndexOf('app-server-disconnect') <
        pendingShutdownFinalInvalidation,
    'shutdown must cancel App Server RPC, stop intake, then perform final invalidation'
  );
  assert.equal(
    pendingShutdownHarness.calls.includes('thread-list'),
    false,
    'cancelling a pending hooks/list must not allow the old sync into thread/list'
  );
  assert.equal(
    pendingShutdownHarness.calls.slice(pendingShutdownFinalInvalidation + 1).includes('notify'),
    false,
    'no old observation notification may cross shutdown finalization'
  );
  assert.equal(
    pendingShutdownHarness.calls.includes('bridge-remove'),
    false,
    'auth shutdown must preserve the installed bridge for resume'
  );
  await pendingShutdownHarness.service.connectAppServer();
  assert.equal(
    pendingShutdownInspectionCount,
    2,
    'resume must start a fresh inspection without reusing the cancelled pending request'
  );
  assert.deepEqual(
    pendingShutdownHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-after-pending-shutdown']
  );
  releasePendingShutdownInspection();
  await new Promise((resolve) => setImmediate(resolve));
  await pendingShutdownHarness.service.disconnectAppServer();

  const shutdownDrainHarness = createLifecycleHarness(false);
  let releaseShutdownDrain;
  const shutdownDrainGate = new Promise((resolve) => {
    releaseShutdownDrain = resolve;
  });
  shutdownDrainHarness.duringHooksList(async () => {
    await shutdownDrainHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '15151515-1515-4515-8515-151515151515',
      payload: { ...pendingStartEvent.payload, turnId: 'turn-shutdown-drain' }
    });
  });
  shutdownDrainHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId === 'turn-shutdown-drain') await shutdownDrainGate;
  });
  const shutdownDrainConnect = shutdownDrainHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    shutdownDrainHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-shutdown-drain']
  );
  const shutdownDrainInvalidationsBefore = shutdownDrainHarness.calls.filter(
    (call) => call === 'invalidate-hook'
  ).length;
  let shutdownDrainResolved = false;
  const shutdownDrainRequest = shutdownDrainHarness.service.shutdown().then(() => {
    shutdownDrainResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    shutdownDrainResolved,
    false,
    'shutdown must join a repository write already shifted from the inspection buffer'
  );
  assert.equal(
    shutdownDrainHarness.calls.filter((call) => call === 'invalidate-hook').length,
    shutdownDrainInvalidationsBefore,
    'shutdown final invalidation must wait until the in-flight drain write settles'
  );
  await shutdownDrainHarness.service.applyCodexHookEvent({
    ...pendingStopEvent,
    eventId: '16161616-1616-4616-8616-161616161616',
    payload: { ...pendingStopEvent.payload, turnId: 'turn-during-shutdown-fence' }
  });
  assert.equal(shutdownDrainHarness.runtimeEvents.length, 1);
  releaseShutdownDrain();
  await Promise.all([shutdownDrainRequest, shutdownDrainConnect]);
  const shutdownDrainFinalInvalidation = shutdownDrainHarness.calls.lastIndexOf('invalidate-hook');
  assert.ok(
    shutdownDrainHarness.calls.lastIndexOf('notify') < shutdownDrainFinalInvalidation,
    'the joined drain write and its notification must finish before shutdown invalidation'
  );
  assert.equal(shutdownDrainHarness.calls.includes('bridge-remove'), false);
  await shutdownDrainHarness.service.disconnectAppServer();

  const disconnectDrainHarness = createLifecycleHarness(false);
  let releaseDisconnectDrain;
  const disconnectDrainGate = new Promise((resolve) => {
    releaseDisconnectDrain = resolve;
  });
  disconnectDrainHarness.duringHooksList(async () => {
    await disconnectDrainHarness.service.applyCodexHookEvent({
      ...pendingStartEvent,
      eventId: '17171717-1717-4717-8717-171717171717',
      payload: { ...pendingStartEvent.payload, turnId: 'turn-disconnect-drain' }
    });
  });
  disconnectDrainHarness.duringRuntimeEvent(async (event) => {
    if (event.turnId === 'turn-disconnect-drain') await disconnectDrainGate;
  });
  const disconnectDrainConnect = disconnectDrainHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  let disconnectDrainResolved = false;
  const disconnectDrainRequest = disconnectDrainHarness.service.disconnectAppServer().then(() => {
    disconnectDrainResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    disconnectDrainResolved,
    false,
    'disconnect must not return while an accepted buffered event is still persisting'
  );
  await disconnectDrainHarness.service.applyCodexHookEvent({
    ...pendingStopEvent,
    eventId: '18181818-1818-4818-8818-181818181818',
    payload: { ...pendingStopEvent.payload, turnId: 'turn-during-disconnect-fence' }
  });
  assert.deepEqual(
    disconnectDrainHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-disconnect-drain'],
    'disconnect must fence new hook intake before stopping the listener'
  );
  releaseDisconnectDrain();
  await Promise.all([disconnectDrainRequest, disconnectDrainConnect]);
  const disconnectDrainFinalInvalidation = disconnectDrainHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    disconnectDrainHarness.calls.indexOf('bridge-remove') < disconnectDrainFinalInvalidation,
    'explicit disconnect must remove the bridge before its final invalidation'
  );
  assert.equal(
    disconnectDrainHarness.calls.slice(disconnectDrainFinalInvalidation + 1)
      .filter((call) => call === 'notify').length,
    1,
    'only the explicit disconnected-state notification may follow final invalidation'
  );

  const shutdownNotificationHarness = createLifecycleHarness(false);
  await shutdownNotificationHarness.service.connectAppServer();
  let releaseShutdownNotification;
  const shutdownNotificationGate = new Promise((resolve) => {
    releaseShutdownNotification = resolve;
  });
  shutdownNotificationHarness.duringRuntimeEvent(async (event) => {
    if (event.source === 'app_server' && event.turnId === 'turn-app-shutdown') {
      await shutdownNotificationGate;
    }
  });
  const shutdownNotificationCountBefore = shutdownNotificationHarness.calls.filter(
    (call) => call === 'notify'
  ).length;
  const shutdownNotificationWrite = shutdownNotificationHarness.service
    .handleAppServerNotification('turn/started', {
      threadId: THREAD_ID,
      turn: { id: 'turn-app-shutdown' }
    });
  await new Promise((resolve) => setImmediate(resolve));
  const shutdownNotificationInvalidationsBefore = shutdownNotificationHarness.calls.filter(
    (call) => call === 'invalidate-hook'
  ).length;
  let shutdownNotificationResolved = false;
  const shutdownForNotification = shutdownNotificationHarness.service.shutdown().then(() => {
    shutdownNotificationResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    shutdownNotificationResolved,
    false,
    'shutdown must join an in-flight App Server notification repository write'
  );
  assert.equal(
    shutdownNotificationHarness.calls.filter((call) => call === 'invalidate-hook').length,
    shutdownNotificationInvalidationsBefore,
    'shutdown final invalidation must wait for the App Server notification write'
  );
  await shutdownNotificationHarness.service.handleAppServerNotification('turn/completed', {
    threadId: THREAD_ID,
    turn: { id: 'turn-app-after-shutdown-abort', status: 'completed' }
  });
  assert.deepEqual(
    shutdownNotificationHarness.runtimeEvents.map(({ event }) => event.turnId),
    ['turn-app-shutdown'],
    'notifications received after shutdown fencing must perform no repository write'
  );
  releaseShutdownNotification();
  await Promise.all([shutdownNotificationWrite, shutdownForNotification]);
  const shutdownNotificationFinalInvalidation = shutdownNotificationHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.equal(
    shutdownNotificationHarness.calls.filter((call) => call === 'notify').length,
    shutdownNotificationCountBefore,
    'an old App Server notification must not notify after its observation was aborted'
  );
  assert.ok(
    shutdownNotificationHarness.runtimeEvents[0].callIndex <
      shutdownNotificationFinalInvalidation,
    'shutdown final invalidation must happen after the joined notification write'
  );
  shutdownNotificationHarness.duringRuntimeEvent(async () => undefined);
  await shutdownNotificationHarness.service.connectAppServer();
  const resumedNotificationCountBefore = shutdownNotificationHarness.calls.filter(
    (call) => call === 'notify'
  ).length;
  await shutdownNotificationHarness.service.handleAppServerNotification('turn/started', {
    threadId: THREAD_ID,
    turn: { id: 'turn-app-after-resume' }
  });
  assert.equal(
    shutdownNotificationHarness.runtimeEvents.at(-1)?.event.turnId,
    'turn-app-after-resume',
    'a fresh observation controller must accept new App Server notifications'
  );
  assert.equal(
    shutdownNotificationHarness.calls.filter((call) => call === 'notify').length,
    resumedNotificationCountBefore + 1
  );
  await shutdownNotificationHarness.service.disconnectAppServer();

  const disconnectNotificationHarness = createLifecycleHarness(false);
  await disconnectNotificationHarness.service.connectAppServer();
  let releaseDisconnectNotification;
  const disconnectNotificationGate = new Promise((resolve) => {
    releaseDisconnectNotification = resolve;
  });
  disconnectNotificationHarness.duringRuntimeEvent(async (event) => {
    if (event.source === 'app_server' && event.turnId === 'turn-app-disconnect') {
      await disconnectNotificationGate;
    }
  });
  const disconnectNotificationCountBefore = disconnectNotificationHarness.calls.filter(
    (call) => call === 'notify'
  ).length;
  const disconnectNotificationWrite = disconnectNotificationHarness.service
    .handleAppServerNotification('turn/started', {
      threadId: THREAD_ID,
      turn: { id: 'turn-app-disconnect' }
    });
  await new Promise((resolve) => setImmediate(resolve));
  const disconnectNotificationInvalidationsBefore = disconnectNotificationHarness.calls.filter(
    (call) => call === 'invalidate-hook'
  ).length;
  let disconnectNotificationResolved = false;
  const disconnectForNotification = disconnectNotificationHarness.service
    .disconnectAppServer()
    .then(() => {
      disconnectNotificationResolved = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    disconnectNotificationResolved,
    false,
    'explicit disconnect must join an in-flight App Server notification write'
  );
  assert.equal(
    disconnectNotificationHarness.calls.filter((call) => call === 'invalidate-hook').length,
    disconnectNotificationInvalidationsBefore
  );
  await disconnectNotificationHarness.service.handleAppServerNotification('turn/completed', {
    threadId: THREAD_ID,
    turn: { id: 'turn-app-after-disconnect-abort', status: 'completed' }
  });
  assert.equal(disconnectNotificationHarness.runtimeEvents.length, 1);
  releaseDisconnectNotification();
  await Promise.all([disconnectNotificationWrite, disconnectForNotification]);
  const disconnectNotificationFinalInvalidation = disconnectNotificationHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    disconnectNotificationHarness.runtimeEvents[0].callIndex <
      disconnectNotificationFinalInvalidation
  );
  assert.equal(
    disconnectNotificationHarness.calls.filter((call) => call === 'notify').length,
    disconnectNotificationCountBefore + 1,
    'only the explicit disconnected-state notification may follow the joined old write'
  );

  const shutdownPreflightHarness = createLifecycleHarness(false);
  let releaseShutdownPreflight;
  const shutdownPreflightGate = new Promise((resolve) => {
    releaseShutdownPreflight = resolve;
  });
  shutdownPreflightHarness.duringAppServerInvalidation(
    async () => await shutdownPreflightGate
  );
  const shutdownPreflightConnect = shutdownPreflightHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    shutdownPreflightHarness.calls.filter((call) => call === 'invalidate-app-server').length,
    1
  );
  const shutdownPreflightInvalidationsBefore = shutdownPreflightHarness.calls.filter(
    (call) => call === 'invalidate-hook'
  ).length;
  let shutdownPreflightResolved = false;
  const shutdownDuringPreflight = shutdownPreflightHarness.service.shutdown().then(() => {
    shutdownPreflightResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    shutdownPreflightResolved,
    false,
    'shutdown must join the pre-connect App Server invalidation write'
  );
  assert.equal(
    shutdownPreflightHarness.calls.filter((call) => call === 'invalidate-hook').length,
    shutdownPreflightInvalidationsBefore,
    'shutdown final invalidation must wait for the pre-connect invalidation write'
  );
  releaseShutdownPreflight();
  await Promise.all([shutdownPreflightConnect, shutdownDuringPreflight]);
  const shutdownPreflightFinalInvalidation = shutdownPreflightHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    shutdownPreflightHarness.calls.indexOf('invalidate-app-server') <
      shutdownPreflightFinalInvalidation
  );
  assert.equal(
    shutdownPreflightHarness.calls.includes('app-server-connect'),
    false,
    'an aborted preflight must not connect the old observation'
  );

  const disconnectPreflightHarness = createLifecycleHarness(false);
  let releaseDisconnectPreflight;
  const disconnectPreflightGate = new Promise((resolve) => {
    releaseDisconnectPreflight = resolve;
  });
  disconnectPreflightHarness.duringAppServerInvalidation(
    async () => await disconnectPreflightGate
  );
  const disconnectPreflightConnect = disconnectPreflightHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  let disconnectPreflightResolved = false;
  const disconnectDuringPreflight = disconnectPreflightHarness.service
    .disconnectAppServer()
    .then(() => {
      disconnectPreflightResolved = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    disconnectPreflightResolved,
    false,
    'explicit disconnect must join the pre-connect App Server invalidation write'
  );
  assert.equal(
    disconnectPreflightHarness.calls.includes('bridge-remove'),
    false,
    'explicit disconnect must not remove the bridge before the preflight write settles'
  );
  releaseDisconnectPreflight();
  await Promise.all([disconnectPreflightConnect, disconnectDuringPreflight]);
  const disconnectPreflightFinalInvalidation = disconnectPreflightHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    disconnectPreflightHarness.calls.indexOf('bridge-remove') <
      disconnectPreflightFinalInvalidation
  );
  assert.equal(disconnectPreflightHarness.calls.includes('app-server-connect'), false);
  assert.equal(
    disconnectPreflightHarness.calls.slice(disconnectPreflightFinalInvalidation + 1)
      .filter((call) => call === 'notify').length,
    1,
    'only the explicit disconnected-state notification may follow preflight teardown'
  );

  const cleanupPreflightHarness = createLifecycleHarness(false);
  let releaseCleanupPreflight;
  const cleanupPreflightGate = new Promise((resolve) => {
    releaseCleanupPreflight = resolve;
  });
  cleanupPreflightHarness.duringAppServerInvalidation(
    async () => await cleanupPreflightGate
  );
  const cleanupPreflightConnect = cleanupPreflightHarness.service.connectAppServer();
  await new Promise((resolve) => setImmediate(resolve));
  let cleanupPreflightResolved = false;
  const cleanupDuringPreflight = cleanupPreflightHarness.service.removeCodexBridge().then(() => {
    cleanupPreflightResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    cleanupPreflightResolved,
    false,
    'bridge cleanup must share the teardown join for pre-connect invalidation'
  );
  assert.equal(cleanupPreflightHarness.calls.includes('bridge-remove'), false);
  releaseCleanupPreflight();
  await Promise.all([cleanupPreflightConnect, cleanupDuringPreflight]);
  const cleanupPreflightFinalInvalidation = cleanupPreflightHarness.calls.lastIndexOf(
    'invalidate-hook'
  );
  assert.ok(
    cleanupPreflightHarness.calls.indexOf('bridge-remove') < cleanupPreflightFinalInvalidation
  );
  assert.equal(cleanupPreflightHarness.calls.includes('app-server-connect'), false);
  assert.equal(
    cleanupPreflightHarness.calls.slice(cleanupPreflightFinalInvalidation + 1)
      .filter((call) => call === 'notify').length,
    1,
    'only the cleanup snapshot notification may follow final invalidation'
  );

  const initializeFenceHarness = createLifecycleHarness(true);
  let releaseInitializeSetting;
  let markInitializeSettingStarted;
  const initializeSettingStarted = new Promise((resolve) => {
    markInitializeSettingStarted = resolve;
  });
  const initializeSettingGate = new Promise((resolve) => {
    releaseInitializeSetting = resolve;
  });
  initializeFenceHarness.duringSettingGet(async () => {
    markInitializeSettingStarted();
    await initializeSettingGate;
  });
  const fencedInitialize = initializeFenceHarness.service.initialize();
  await initializeSettingStarted;
  await initializeFenceHarness.service.shutdown();
  assert.equal(
    initializeFenceHarness.calls.includes('listener-start'),
    false,
    'shutdown must finish without starting an initialize request held before its intent check'
  );
  releaseInitializeSetting();
  await fencedInitialize;
  assert.equal(
    initializeFenceHarness.calls.includes('listener-start'),
    false,
    'a stale initialize result must not resurrect observation after shutdown'
  );
  assert.equal(initializeFenceHarness.isAppServerConnected(), false);
  assert.equal(initializeFenceHarness.status().listening, false);

  const preferenceRaceHarness = createLifecycleHarness(false);
  let releaseTruePreference;
  let markTruePreferenceStarted;
  const truePreferenceStarted = new Promise((resolve) => {
    markTruePreferenceStarted = resolve;
  });
  const truePreferenceGate = new Promise((resolve) => {
    releaseTruePreference = resolve;
  });
  preferenceRaceHarness.duringSettingUpsert(async (value) => {
    if (value !== true) return;
    markTruePreferenceStarted();
    await truePreferenceGate;
  });
  const staleConnect = preferenceRaceHarness.service.connectAppServer();
  await truePreferenceStarted;
  let preferenceDisconnectResolved = false;
  const preferenceDisconnect = preferenceRaceHarness.service.disconnectAppServer().then(() => {
    preferenceDisconnectResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    preferenceDisconnectResolved,
    false,
    'Disconnect must join an older Connect preference write before committing false'
  );
  releaseTruePreference();
  await Promise.all([staleConnect, preferenceDisconnect]);
  assert.equal(preferenceRaceHarness.settingValue(), false);
  assert.equal(preferenceRaceHarness.isAppServerConnected(), false);
  assert.equal(preferenceRaceHarness.status().state, 'not_installed');
  assert.equal(preferenceRaceHarness.status().listening, false);
  assert.equal(
    preferenceRaceHarness.calls.includes('thread-list'),
    false,
    'an older Connect must not continue into Sync after Disconnect begins'
  );
  assert.ok(
    preferenceRaceHarness.calls.indexOf('auto:true') <
      preferenceRaceHarness.calls.lastIndexOf('auto:false'),
    'Disconnect must own the final persisted auto-connect preference'
  );
  preferenceRaceHarness.duringSettingUpsert(async () => undefined);
  preferenceRaceHarness.advance();
  await preferenceRaceHarness.service.connectAppServer();
  assert.equal(
    preferenceRaceHarness.calls.filter((call) => call === 'listener-start').length,
    2,
    'a later Connect must create a fresh listener after teardown completes'
  );
  assert.equal(preferenceRaceHarness.settingValue(), true);
  assert.equal(preferenceRaceHarness.isAppServerConnected(), true);
  assert.equal(preferenceRaceHarness.status().state, 'installed');
  await preferenceRaceHarness.service.disconnectAppServer();

  const heldConnectHarness = createLifecycleHarness(false);
  let releaseHeldConnect;
  let markHeldConnectStarted;
  const heldConnectStarted = new Promise((resolve) => {
    markHeldConnectStarted = resolve;
  });
  const heldConnectGate = new Promise((resolve) => {
    releaseHeldConnect = resolve;
  });
  heldConnectHarness.duringAppServerConnect(async () => {
    markHeldConnectStarted();
    await heldConnectGate;
  });
  const heldConnectRequest = heldConnectHarness.service.connectAppServer();
  await heldConnectStarted;
  let heldConnectDisconnectResolved = false;
  const heldConnectDisconnect = heldConnectHarness.service.disconnectAppServer().then(() => {
    heldConnectDisconnectResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    heldConnectDisconnectResolved,
    false,
    'Disconnect must join an App Server connect that can still settle connected'
  );
  releaseHeldConnect();
  await Promise.all([heldConnectRequest, heldConnectDisconnect]);
  assert.equal(heldConnectHarness.isAppServerConnected(), false);
  assert.equal(heldConnectHarness.status().state, 'not_installed');
  assert.equal(heldConnectHarness.calls.includes('hooks-list'), false);
  assert.equal(heldConnectHarness.calls.includes('thread-list'), false);
  assert.equal(heldConnectHarness.settingValue(), false);

  const lateSyncHarness = createLifecycleHarness(false);
  await lateSyncHarness.service.connectAppServer();
  let releaseLateThreadList;
  let markLateThreadListStarted;
  const lateThreadListStarted = new Promise((resolve) => {
    markLateThreadListStarted = resolve;
  });
  const lateThreadListGate = new Promise((resolve) => {
    releaseLateThreadList = resolve;
  });
  lateSyncHarness.duringThreadList(async () => {
    markLateThreadListStarted();
    await lateThreadListGate;
  });
  const staleSync = lateSyncHarness.service.syncThreads();
  await lateThreadListStarted;
  await lateSyncHarness.service.disconnectAppServer();
  const lateSyncUpserts = lateSyncHarness.calls.filter((call) => call === 'upsert').length;
  const lateSyncNotifies = lateSyncHarness.calls.filter((call) => call === 'notify').length;
  releaseLateThreadList();
  await staleSync;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateSyncHarness.calls.filter((call) => call === 'upsert').length, lateSyncUpserts);
  assert.equal(lateSyncHarness.calls.filter((call) => call === 'notify').length, lateSyncNotifies);
  assert.equal(lateSyncHarness.isAppServerConnected(), false);
  assert.equal(lateSyncHarness.status().state, 'not_installed');

  const teardownUpgradeHarness = createLifecycleHarness(false);
  await teardownUpgradeHarness.service.connectAppServer();
  let releaseUpgradeStop;
  let markUpgradeStopStarted;
  const upgradeStopStarted = new Promise((resolve) => {
    markUpgradeStopStarted = resolve;
  });
  const upgradeStopGate = new Promise((resolve) => {
    releaseUpgradeStop = resolve;
  });
  teardownUpgradeHarness.duringListenerStop(async () => {
    markUpgradeStopStarted();
    await upgradeStopGate;
  });
  const authShutdown = teardownUpgradeHarness.service.shutdown();
  await upgradeStopStarted;
  const upgradedDisconnect = teardownUpgradeHarness.service.disconnectAppServer();
  const fencedOverlappingSync = teardownUpgradeHarness.service.syncThreads();
  releaseUpgradeStop();
  await Promise.all([authShutdown, upgradedDisconnect, fencedOverlappingSync]);
  assert.equal(
    teardownUpgradeHarness.calls.filter((call) => call === 'listener-stop').length,
    1,
    'overlapping shutdown and Disconnect must share one teardown transition'
  );
  assert.equal(
    teardownUpgradeHarness.calls.filter((call) => call === 'bridge-remove').length,
    1,
    'the shared teardown must upgrade to explicit bridge removal exactly once'
  );
  assert.equal(teardownUpgradeHarness.settingValue(), false);
  assert.equal(teardownUpgradeHarness.isAppServerConnected(), false);
  assert.equal(teardownUpgradeHarness.status().state, 'not_installed');
  assert.equal(
    teardownUpgradeHarness.calls.filter((call) => call === 'listener-start').length,
    1,
    'a Sync requested during teardown must not create a replacement observation'
  );

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
