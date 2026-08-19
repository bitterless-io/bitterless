import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-provider-isolation-'));
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
const { EyesOnAgentsService } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  assert.fail(`Timed out waiting for ${label}`);
};
const bridgeStatus = () => ({
  state: 'installed', setupAction: 'retry', configured: true, enabled: true, listening: false,
  listeningSince: null, firstReceiptAt: null, lastReceiptAt: null,
  lastInspectedAt: null, observationProof: 'none', restartRequired: false, error: null
});
const codexBridgeStatus = () => ({
  state: 'not_installed', reviewReason: null, listening: false, listeningSince: null,
  lastEventAt: null, lastInspectedAt: null, error: null
});

const createHarness = (options = {}) => {
  const calls = [];
  const notifications = [];
  const runtimeDeliveries = [];
  const committedDeliveryIds = new Set();
  let connected = false;
  let preference = options.preference ?? {
    schemaVersion: 1, enabled: false, hookAdmissionAfter: null
  };
  let preferenceWriteCount = 0;
  const repository = {
    getSnapshot: async () => ({ domains: [], threads: [] }),
    getThreadRefreshPages: async () => {
      calls.push('codex-refresh-pages');
      return { hot: [], cold: [], pageCount: 0, coldPage: null };
    },
    refreshThreadPage: async () => ({ changed: false }),
    clearLastUserPrompts: async () => ({ changed: false }),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined,
    upsertDiscoveredThreads: async () => calls.push('codex-upsert-inventory'),
    upsertThreadSnapshots: async () => undefined,
    markThreadsArchived: async () => undefined,
    expireClaudeAgentStates: async ({ force }) => {
      calls.push(`claude-expire:${Boolean(force)}`);
      if (!force && options.expireGate) await options.expireGate;
      return { changed: options.expireChanged === true };
    },
    clearClaudeTranscriptCapabilities: async () => ({ changed: false }),
    getRuntimeReceiptSummary: async () => ({ firstReceivedAt: null, lastReceivedAt: null }),
    upsertClaudeInventory: async () => {
      calls.push('claude-inventory-write');
      return { changed: true };
    },
    applyRuntimeEventDelivery: async ({ deliveryId, event }) => {
      calls.push('claude-runtime-enter');
      if (options.runtimeDeliveryGate) await options.runtimeDeliveryGate;
      calls.push('claude-runtime-write');
      runtimeDeliveries.push({ deliveryId, event });
      if (committedDeliveryIds.has(deliveryId)) {
        return {
          duplicate: true,
          created: false,
          titleMissing: false,
          completionAlert: null
        };
      }
      committedDeliveryIds.add(deliveryId);
      return {
        duplicate: false,
        created: false,
        titleMissing: false,
        completionAlert: event.type === 'turn_completed' && event.outcome === 'completed'
          && event.turnId !== null
          ? {
              sessionKey: `claude:${CLAUDE_ID}`,
              provider: 'claude',
              threadId: CLAUDE_ID,
              turnId: event.turnId,
              title: 'Claude task'
            }
          : null
      };
    }
  };
  const preferenceService = {
    hydrate: async () => {
      calls.push(`hydrate:${preference.enabled}:${preference.hookAdmissionAfter}`);
      return { state: 'valid', preference: { ...preference } };
    },
    getStatus: () => ({ ...preference, error: null }),
    setEnabled: async (enabled, hookAdmissionAfter) => {
      preferenceWriteCount += 1;
      calls.push(`persist-enter:${enabled}:${hookAdmissionAfter}`);
      if (preferenceWriteCount === 1 && options.firstPreferenceWriteGate) {
        await options.firstPreferenceWriteGate;
      }
      preference = { schemaVersion: 1, enabled, hookAdmissionAfter };
      calls.push(`persist-exit:${enabled}:${hookAdmissionAfter}`);
      return { ...preference };
    }
  };
  const appServer = {
    getStatus: (autoConnectEnabled) => ({
      state: connected ? 'connected' : 'disconnected', lastSyncedAt: null,
      error: null, autoConnectEnabled
    }),
    isConnected: () => connected,
    connect: async () => { connected = true; calls.push('codex-connect'); },
    disconnect: async () => { connected = false; calls.push('codex-disconnect'); },
    listThreads: async () => { calls.push('codex-list'); return []; },
    listArchivedThreads: async () => []
  };
  const desktopBridge = {
    getStatus: codexBridgeStatus,
    hasInstallationIntent: () => false,
    hasExactInstallation: () => false,
    refreshInstalledArtifacts: codexBridgeStatus,
    getDisabledExactHookKeys: () => [],
    install: codexBridgeStatus,
    remove: codexBridgeStatus,
    updateHookInspection: () => undefined,
    setHookInspectionError: () => undefined,
    setOperationalError: () => undefined
  };
  const service = new EyesOnAgentsService({
    repository,
    settings: { get: async () => options.autoConnect === true, upsert: async () => undefined },
    appServer,
    desktopBridge,
    bridgeListener: {
      start: async () => undefined, stop: async () => undefined,
      recoverOutboxCoverageGap: async () => undefined,
      replayOutbox: async () => undefined
    },
    lastUserPromptPreference: { isEnabled: () => false, enable: () => false, disable: () => false },
    claudeProviderPreference: preferenceService,
    claudeObservation: {
      start: async () => calls.push('observation-start'),
      stop: async () => calls.push('observation-stop'),
      refresh: async (mode) => { calls.push(`observation-refresh:${mode}`); return { changed: false }; }
    },
    claudeBridge: {
      getStatus: bridgeStatus,
      hasInstallationIntent: () => options.pluginInstalled === true,
      acceptsInstallation: (value) => value === INSTALLATION_ID,
      revokeObservationProof: () => calls.push('revoke-proof'),
      refresh: async () => bridgeStatus()
    },
    claudeHookListener: {
      start: async () => calls.push('listener-start'),
      stop: async () => {
        calls.push('listener-stop');
        if (options.listenerStopGate) await options.listenerStopGate;
      },
      replayOutbox: async () => calls.push('outbox-replay'),
      clearOutbox: async () => calls.push('outbox-clear')
    },
    validateClaudeTranscript: (value) => value,
    notifyThreadCompleted: (intent) => notifications.push(intent),
    broadcastChanged: () => calls.push('broadcast'),
    openExternal: async () => undefined,
    now: () => 1_000
  });
  return {
    service, calls, notifications, runtimeDeliveries,
    getPreference: () => preference
  };
};

const createDelivery = ({
  deliveryId = '33333333-3333-4333-8333-333333333333',
  hookEventName = 'Stop',
  occurredAt = 1_001
} = {}) => ({
  schemaVersion: 1,
  deliveryId,
  installationId: INSTALLATION_ID,
  event: {
    schemaVersion: 1,
    eventId: deliveryId,
    occurredAt,
    payload: {
      hookEventName, sessionId: CLAUDE_ID,
      transcriptPath: `/tmp/${CLAUDE_ID}.jsonl`, cwd: '/tmp/project'
    }
  }
});

const delivery = createDelivery();

test('each admitted Claude Stop alerts once from its delivery identity without a prior prompt', async () => {
  const harness = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    pluginInstalled: true
  });
  await harness.service.initialize();
  await waitFor(() => harness.calls.includes('listener-start'), 'enabled Hook listener');

  assert.deepEqual(await harness.service.commitClaudeHookDelivery(delivery), { duplicate: false });
  assert.equal(harness.runtimeDeliveries[0].event.turnId, delivery.deliveryId);
  assert.deepEqual(harness.notifications.map(({ turnId }) => turnId), [delivery.deliveryId]);

  assert.deepEqual(await harness.service.commitClaudeHookDelivery(delivery), { duplicate: true });
  assert.deepEqual(harness.notifications.map(({ turnId }) => turnId), [delivery.deliveryId]);

  const distinctStop = createDelivery({
    deliveryId: '44444444-4444-4444-8444-444444444444',
    occurredAt: 1_002
  });
  assert.deepEqual(
    await harness.service.commitClaudeHookDelivery(distinctStop),
    { duplicate: false }
  );
  assert.deepEqual(
    harness.notifications.map(({ turnId }) => turnId),
    [delivery.deliveryId, distinctStop.deliveryId]
  );

  const stopFailure = createDelivery({
    deliveryId: '55555555-5555-4555-8555-555555555555',
    hookEventName: 'StopFailure',
    occurredAt: 1_003
  });
  assert.deepEqual(
    await harness.service.commitClaudeHookDelivery(stopFailure),
    { duplicate: false }
  );
  assert.equal(harness.runtimeDeliveries.at(-1).event.turnId, null);
  assert.equal(harness.runtimeDeliveries.at(-1).event.outcome, 'failed');
  assert.deepEqual(
    harness.notifications.map(({ turnId }) => turnId),
    [delivery.deliveryId, distinctStop.deliveryId]
  );
  await harness.service.shutdown();
});

test('stored Off survives auth suspend and resume while Codex startup and polling stay complete', async () => {
  const harness = createHarness({ autoConnect: true });
  await harness.service.initialize();
  await waitFor(() => harness.calls.filter((value) => value === 'outbox-clear').length === 1,
    'first stored-Off hydration');
  await harness.service.shutdown();
  await harness.service.initialize();
  await waitFor(() => harness.calls.filter((value) => value === 'outbox-clear').length === 2,
    'resumed stored-Off hydration');
  await harness.service.refreshThreadPages();
  assert.equal(harness.calls.filter((value) => value === 'codex-connect').length, 2);
  assert.equal(harness.calls.filter((value) => value === 'codex-list').length, 2);
  assert.equal(harness.calls.includes('codex-refresh-pages'), true);
  assert.equal(harness.calls.includes('observation-start'), false);
  assert.equal(harness.calls.includes('listener-start'), false);
  assert.equal(harness.calls.includes('observation-refresh:poll'), false);
  await harness.service.shutdown();
});

test('a toggle write crossing auth resume cannot resurrect its stale runtime generation', async () => {
  let releaseWrite;
  const writeGate = new Promise((resolvePromise) => { releaseWrite = resolvePromise; });
  const harness = createHarness({ firstPreferenceWriteGate: writeGate });
  await harness.service.initialize();
  await waitFor(() => harness.calls.includes('outbox-clear'), 'initial stored-Off hydration');
  harness.calls.length = 0;
  const staleToggle = harness.service.setClaudeProviderEnabled({ enabled: true });
  await waitFor(() => harness.calls.some((value) => value.startsWith('persist-enter:true:')),
    'deferred enable write');
  await harness.service.shutdown();
  const resumed = harness.service.initialize();
  releaseWrite();
  await Promise.all([staleToggle, resumed]);
  await waitFor(() => harness.calls.includes('observation-start'), 'resumed enabled hydration');
  assert.equal(harness.calls.filter((value) => value === 'observation-start').length, 1);
  assert.ok(harness.calls.findIndex((value) => value.startsWith('hydrate:true:')) <
    harness.calls.indexOf('observation-start'));
  assert.equal(harness.getPreference().enabled, true);
  assert.notEqual(harness.getPreference().hookAdmissionAfter, Number.MAX_SAFE_INTEGER);
  await harness.service.shutdown();
});

test('disable joins an admitted Hook commit and suppresses its late Claude side effects', async () => {
  let releaseDelivery;
  const deliveryGate = new Promise((resolvePromise) => { releaseDelivery = resolvePromise; });
  const harness = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    pluginInstalled: true,
    runtimeDeliveryGate: deliveryGate,
    listenerStopGate: deliveryGate
  });
  await harness.service.initialize();
  await waitFor(() => harness.calls.includes('listener-start'), 'enabled Hook listener');
  harness.calls.length = 0;
  const commit = harness.service.commitClaudeHookDelivery(delivery);
  await waitFor(() => harness.calls.includes('claude-runtime-enter'), 'in-flight Hook commit');
  const disable = harness.service.setClaudeProviderEnabled({ enabled: false });
  await waitFor(() => harness.calls.some((value) => value.startsWith('persist-exit:false:')),
    'persisted Off intent');
  releaseDelivery();
  await Promise.all([commit, disable]);
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.calls.filter((value) => value === 'broadcast').length, 1,
    'only the completed provider teardown may publish a snapshot change');
  assert.ok(harness.calls.indexOf('claude-runtime-write') < harness.calls.lastIndexOf('outbox-clear'));
  const settledWrites = harness.calls.filter((value) => value.includes('-write')).length;
  await tick();
  assert.equal(harness.calls.filter((value) => value.includes('-write')).length, settledWrites);
  await harness.service.shutdown();
});

test('a deferred Claude poll cannot broadcast after the Off generation is published', async () => {
  let releaseExpiry;
  const expiryGate = new Promise((resolvePromise) => { releaseExpiry = resolvePromise; });
  const harness = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    expireGate: expiryGate,
    expireChanged: true
  });
  await harness.service.initialize();
  await waitFor(() => harness.calls.includes('observation-start'), 'enabled observation');
  harness.calls.length = 0;
  await harness.service.refreshThreadPages();
  await waitFor(() => harness.calls.includes('claude-expire:false'), 'deferred poll expiry');
  const disable = harness.service.setClaudeProviderEnabled({ enabled: false });
  await waitFor(() => harness.calls.some((value) => value.startsWith('persist-exit:false:')),
    'poll-race Off intent');
  releaseExpiry();
  await disable;
  assert.equal(harness.calls.filter((value) => value === 'broadcast').length, 1,
    'only provider teardown may broadcast after the Off intent');
  await harness.service.shutdown();
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
