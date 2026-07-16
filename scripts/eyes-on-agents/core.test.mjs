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
    contract.effectiveEyesOnAgentsRuntimeState('working', 'codex_hook', 100, 60_100, false),
    'working'
  );
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState('working', 'codex_hook', 100, 60_101, false),
    'unknown'
  );
  assert.equal(
    contract.effectiveEyesOnAgentsRuntimeState('working', 'app_server', 100, 101, false),
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
      listening: true,
      lastEventAt: null,
      error: null
    }),
    install: () => undefined,
    remove: () => undefined
  };
  const failedService = new EyesOnAgentsService({
    repository,
    settings,
    appServer,
    desktopBridge,
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
      }
    },
    desktopBridge,
    openExternal: async () => undefined,
    now: () => 789
  });
  await reconnectService.connectAppServer();
  assert.deepEqual(
    reconnectOrder,
    ['invalidate:789', 'connect', 'list', 'upsert'],
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

  console.log('EyesOnAgents core tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
