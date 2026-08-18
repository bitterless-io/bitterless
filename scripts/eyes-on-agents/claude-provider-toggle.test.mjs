import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-provider-toggle-'));
const CODEX_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';
const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';

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

const [preferenceModule, contractModule, serviceModule] = await Promise.all([
  loadTypeScriptModule('preference', 'src/main/eyesOnAgents/claudeProviderPreference.service.ts'),
  loadTypeScriptModule('contract', 'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'),
  loadTypeScriptModule('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts')
]);

const {
  CLAUDE_PROVIDER_PENDING_ADMISSION,
  ClaudeProviderPreferenceService
} = preferenceModule;
const { EyesOnAgentsService } = serviceModule;

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const providerState = ({ enabled, error }) => ({ enabled, error });

const thread = (provider) => ({
  sessionKey: `${provider}:${provider === 'codex' ? CODEX_ID : CLAUDE_ID}`,
  provider,
  threadId: provider === 'codex' ? CODEX_ID : CLAUDE_ID,
  desktopSessionId: provider === 'claude' ? `local_${CLAUDE_ID}` : null,
  transcriptPath: provider === 'claude' ? `/tmp/${CLAUDE_ID}.jsonl` : null,
  domainId: null,
  title: `${provider} task`,
  cwd: '/tmp/project',
  projectRootPath: '/tmp/project',
  projectName: 'project',
  runtimeState: 'idle',
  activeFlags: [],
  activeTurnId: null,
  lastCompletedTurnId: null,
  lastCompletedAt: null,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: 'discovery',
  statusObservedAt: null,
  statusFreshUntil: null,
  lastActivityAt: null,
  isUnread: true,
  isFocused: true,
  archiveState: 'active',
  lastUserPrompt: {
    state: 'unavailable', preview: null, turnId: null, observedAt: null,
    checkedAt: null, truncated: false
  }
});

const bridgeStatus = () => ({
  state: 'installed', setupAction: 'retry',
  configured: true,
  enabled: true,
  listening: false,
  listeningSince: null,
  firstReceiptAt: null,
  lastReceiptAt: null,
  lastInspectedAt: null,
  observationProof: 'none',
  restartRequired: false,
  error: null
});

const createHarness = (options = {}) => {
  const calls = [];
  const notifications = [];
  const writes = [];
  const readAllProviders = [];
  const repositoryWrites = { inventory: 0, runtime: 0 };
  let preference = options.preference ?? {
    schemaVersion: 1,
    enabled: false,
    hookAdmissionAfter: null
  };
  let connected = false;
  let clearFails = options.clearFails === true;
  let observationStartFailures = options.observationStartFailures ?? 0;
  const preferenceGate = options.preferenceGate ?? null;
  const observationStartGate = options.observationStartGate ?? null;
  const persisted = {
    domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
    threads: [thread('codex'), thread('claude')]
  };
  const repository = {
    getSnapshot: async () => persisted,
    getThreadRefreshPages: async () => ({ hot: [], cold: [], pageCount: 0, coldPage: null }),
    getThreadRefreshCandidate: async () => null,
    refreshThreadPage: async () => ({ changed: false }),
    clearLastUserPrompts: async () => ({ changed: false }),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined,
    upsertDiscoveredThreads: async () => undefined,
    upsertThreadSnapshots: async () => undefined,
    setThreadArchived: async () => undefined,
    markThreadsArchived: async () => undefined,
    applyRuntimeEvent: async () => ({
      created: false, titleMissing: false, completionAlert: null
    }),
    applyRuntimeEventDelivery: async ({ event }) => {
      repositoryWrites.runtime += 1;
      calls.push(`runtime:${event.source}`);
      return {
        duplicate: false,
        created: false,
        titleMissing: false,
        completionAlert: event.type === 'turn_completed'
          ? {
              sessionKey: `claude:${event.threadId}`,
              provider: 'claude',
              threadId: event.threadId,
              turnId: event.turnId ?? 'completed',
              title: 'claude task'
            }
          : null
      };
    },
    enrichMissingThreadTitle: async () => ({ changed: false }),
    markOpened: async ({ sessionKey }) => calls.push(`opened:${sessionKey}`),
    markAllRead: async ({ providers }) => {
      readAllProviders.push(providers);
      calls.push(`read-all:${providers.join('+')}`);
      if (options.readAllGate) await options.readAllGate;
      return { changed: false };
    },
    createDomain: async () => undefined,
    renameDomain: async () => undefined,
    deleteDomain: async () => undefined,
    reorderDomains: async () => undefined,
    moveThread: async ({ sessionKey }) => calls.push(`moved:${sessionKey}`),
    upsertClaudeInventory: async () => {
      repositoryWrites.inventory += 1;
      return { changed: true };
    },
    reconcileClaudeAgentStates: async () => ({ changed: false }),
    expireClaudeAgentStates: async ({ statusSources, force }) => {
      calls.push(`expire:${statusSources?.join('+') ?? 'lease'}:${Boolean(force)}`);
      return { changed: false };
    },
    clearClaudeTranscriptCapabilities: async () => ({ changed: false }),
    getRuntimeReceiptSummary: async () => {
      calls.push('receipt-status');
      return { firstReceivedAt: null, lastReceivedAt: null };
    },
    getClaudeOpenTarget: async () => ({
      sessionKey: `claude:${CLAUDE_ID}`,
      desktopSessionId: `local_${CLAUDE_ID}`,
      transcriptPath: `/tmp/${CLAUDE_ID}.jsonl`,
      runtimeState: 'idle'
    })
  };
  const preferenceService = {
    hydrate: async () => {
      if (preferenceGate) await preferenceGate;
      if (options.invalidPreference) {
        return { state: 'invalid', error: 'Saved Claude provider preference is invalid' };
      }
      return { state: 'valid', preference: { ...preference } };
    },
    getStatus: () => ({
      enabled: preference.enabled,
      hookAdmissionAfter: preference.hookAdmissionAfter,
      error: null
    }),
    setEnabled: async (enabled, hookAdmissionAfter) => {
      calls.push(`persist:${enabled}:${hookAdmissionAfter}`);
      writes.push({ schemaVersion: 1, enabled, hookAdmissionAfter });
      if (options.writeFails) throw new Error('setting write failed');
      if (enabled && hookAdmissionAfter !== Number.MAX_SAFE_INTEGER && options.finalWriteGate) {
        await options.finalWriteGate;
      }
      preference = { schemaVersion: 1, enabled, hookAdmissionAfter };
      return { ...preference };
    }
  };
  const appServer = {
    getStatus: (autoConnectEnabled) => ({
      state: connected ? 'connected' : 'disconnected',
      lastSyncedAt: null,
      error: null,
      autoConnectEnabled
    }),
    isConnected: () => connected,
    connect: async () => { calls.push('codex-connect'); connected = true; },
    disconnect: async () => { connected = false; },
    listThreads: async () => { calls.push('codex-list'); return []; },
    listArchivedThreads: async () => [],
    readThread: async (threadId) => ({ id: threadId }),
    readLatestThreadTurn: async () => null
  };
  const desktopBridge = {
    getStatus: () => ({
      state: 'not_installed', reviewReason: null, listening: false, listeningSince: null,
      lastEventAt: null, lastInspectedAt: null, error: null
    }),
    hasInstallationIntent: () => false,
    hasExactInstallation: () => false,
    refreshInstalledArtifacts: () => undefined,
    getDisabledExactHookKeys: () => [],
    install: () => undefined,
    remove: () => undefined,
    updateHookInspection: () => undefined,
    setHookInspectionError: () => undefined,
    setOperationalError: () => undefined
  };
  const claudeBridge = {
    getStatus: () => { calls.push('claude-status'); return bridgeStatus(); },
    hasInstallationIntent: () => options.pluginInstalled !== false,
    acceptsInstallation: (id) => id === INSTALLATION_ID,
    revokeObservationProof: () => calls.push('revoke-proof'),
    install: async () => {
      calls.push('plugin-install');
      if (options.pluginInstallGate) await options.pluginInstallGate;
      return bridgeStatus();
    },
    refresh: async () => { calls.push('plugin-refresh'); return bridgeStatus(); },
    remove: async () => { calls.push('plugin-remove'); return bridgeStatus(); }
  };
  const claudeObservation = {
    start: async () => {
      calls.push('observation-start');
      if (observationStartGate) await observationStartGate;
      if (observationStartFailures > 0) {
        observationStartFailures -= 1;
        throw new Error('Claude observation start failed');
      }
    },
    stop: async () => {
      calls.push('observation-stop');
      if (options.stopWaitsForRefresh && options.observationRefreshGate) {
        await options.observationRefreshGate;
      }
    },
    refresh: async (mode) => {
      calls.push(`observation-refresh:${mode}`);
      if (options.observationRefreshGate) await options.observationRefreshGate;
      return { changed: false };
    },
    getDirectoryStatus: () => {
      calls.push('directory-status');
      return {
        mode: 'automatic', configuredDirectory: null, effectiveDirectory: '/tmp/.claude',
        projectsDirectory: '/tmp/.claude/projects', desktopDirectoryCount: 1,
        state: 'watching', watching: true, lastScanAt: null, lastSuccessfulScanAt: null,
        nextRetryAt: null, error: null
      };
    },
    changeDirectory: async () => calls.push('directory-change'),
    useAutomaticDirectory: async () => calls.push('directory-automatic'),
    retryDirectory: async () => calls.push('directory-retry')
  };
  const hookListener = {
    start: async () => calls.push('listener-start'),
    stop: async () => calls.push('listener-stop'),
    replayOutbox: async () => calls.push('outbox-replay'),
    clearOutbox: async () => {
      calls.push('outbox-clear');
      if (clearFails) throw new Error('outbox cleanup failed');
    }
  };
  const service = new EyesOnAgentsService({
    repository,
    settings: { get: async () => false, upsert: async () => undefined },
    appServer,
    lastUserPromptPreference: { isEnabled: () => false, enable: () => false, disable: () => false },
    claudeProviderPreference: preferenceService,
    desktopBridge,
    bridgeListener: {
      start: async () => undefined,
      stop: async () => undefined,
      recoverOutboxCoverageGap: async () => undefined,
      replayOutbox: async () => undefined
    },
    openExternal: async (url) => calls.push(`open:${url}`),
    previewAbsoluteTarget: async (path) => calls.push(`preview:${path}`),
    validateClaudeTranscript: (path) => path,
    claudeObservation,
    claudeBridge,
    claudeHookListener: hookListener,
    notifyThreadCompleted: (intent) => notifications.push(intent),
    broadcastChanged: () => calls.push('broadcast'),
    now: () => options.now ?? 1_000
  });
  return {
    service, calls, notifications, writes, readAllProviders, repositoryWrites,
    setClearFails: (value) => { clearFails = value; },
    getPreference: () => preference
  };
};

const initializeAndWait = async (harness, enabled) => {
  await harness.service.initialize();
  await waitFor(async () => {
    const snapshot = await harness.service.getSnapshot();
    return snapshot.claudeProvider.enabled === enabled &&
      (enabled ? harness.calls.includes('observation-start') : harness.calls.includes('outbox-clear'));
  }, `Claude provider ${enabled ? 'enable' : 'disable'} hydration`);
};

const delivery = (occurredAt, hookEventName = 'Stop') => ({
  schemaVersion: 1,
  deliveryId: '33333333-3333-4333-8333-333333333333',
  installationId: INSTALLATION_ID,
  event: {
    schemaVersion: 1,
    eventId: '33333333-3333-4333-8333-333333333333',
    occurredAt,
    payload: {
      hookEventName,
      sessionId: CLAUDE_ID,
      transcriptPath: `/tmp/${CLAUDE_ID}.jsonl`,
      cwd: '/tmp/project'
    }
  }
});

test('preference schema defaults on, persists exact values, and fails closed', async () => {
  const missing = new ClaudeProviderPreferenceService({
    getStored: async () => ({ exists: false, valid: true, value: null, serializedValue: null }),
    upsert: async () => undefined
  });
  assert.deepEqual(await missing.hydrate(), {
    state: 'valid',
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: null }
  });
  assert.deepEqual(Object.keys(missing.getStatus()).sort(), [
    'enabled', 'error', 'hookAdmissionAfter'
  ]);

  for (const value of [
    null,
    { schemaVersion: 2, enabled: true, hookAdmissionAfter: null },
    { schemaVersion: 1, enabled: true, hookAdmissionAfter: null, extra: true },
    { schemaVersion: 1, enabled: 'yes', hookAdmissionAfter: null },
    { schemaVersion: 1, enabled: true, hookAdmissionAfter: -1 }
  ]) {
    const malformed = new ClaudeProviderPreferenceService({
      getStored: async () => ({
        exists: true, valid: true, value, serializedValue: JSON.stringify(value)
      }),
      upsert: async () => undefined
    });
    assert.equal((await malformed.hydrate()).state, 'invalid');
    assert.equal(malformed.getStatus().enabled, false);
    assert.ok((malformed.getStatus().error ?? '').length <= 300);
  }

  let stored = { schemaVersion: 1, enabled: false, hookAdmissionAfter: 12 };
  const writes = [];
  const valid = new ClaudeProviderPreferenceService({
    getStored: async () => ({
      exists: true, valid: true, value: stored, serializedValue: JSON.stringify(stored)
    }),
    upsert: async ({ value }) => { writes.push(value); stored = value; }
  });
  assert.equal((await valid.hydrate()).state, 'valid');
  await valid.setEnabled(true, CLAUDE_PROVIDER_PENDING_ADMISSION);
  assert.deepEqual(writes[0], {
    schemaVersion: 1, enabled: true, hookAdmissionAfter: Number.MAX_SAFE_INTEGER
  });

  const failed = new ClaudeProviderPreferenceService({
    getStored: async () => ({
      exists: true, valid: true, value: stored, serializedValue: JSON.stringify(stored)
    }),
    upsert: async () => { throw new Error('write failed'); }
  });
  await failed.hydrate();
  const before = failed.getStatus();
  await assert.rejects(() => failed.setEnabled(false, 12), /write failed/);
  assert.deepEqual(failed.getStatus(), before);
});

test('pathless toggle contract rejects unknown and non-boolean values', () => {
  assert.deepEqual(contractModule.parseEyesOnAgentsSetClaudeProviderEnabledParams({ enabled: false }), {
    enabled: false
  });
  assert.throws(
    () => contractModule.parseEyesOnAgentsSetClaudeProviderEnabledParams({
      enabled: true, path: '/tmp/.claude'
    }),
    /unsupported field/
  );
  assert.throws(
    () => contractModule.parseEyesOnAgentsSetClaudeProviderEnabledParams({ enabled: 1 }),
    /boolean/
  );
});

test('pre-initialize and stored-off states hide Claude without touching Claude status dependencies', async () => {
  const preInit = createHarness({ preference: {
    schemaVersion: 1, enabled: true, hookAdmissionAfter: null
  } });
  const initial = await preInit.service.getSnapshot();
  assert.deepEqual(initial.threads.map(({ provider }) => provider), ['codex']);
  assert.deepEqual(providerState(initial.claudeProvider), { enabled: false, error: null });
  assert.equal(preInit.calls.includes('claude-status'), false);
  assert.equal(preInit.calls.includes('directory-status'), false);
  await assert.rejects(
    () => preInit.service.openThread({ sessionKey: `claude:${CLAUDE_ID}` }),
    /paused/
  );

  const off = createHarness();
  await initializeAndWait(off, false);
  off.calls.length = 0;
  const snapshot = await off.service.getSnapshot();
  assert.deepEqual(snapshot.threads.map(({ provider }) => provider), ['codex']);
  assert.deepEqual(providerState(snapshot.claudeProvider), { enabled: false, error: null });
  assert.equal(off.calls.includes('claude-status'), false);
  assert.equal(off.calls.includes('directory-status'), false);
  await off.service.markAllRead();
  assert.deepEqual(off.readAllProviders.at(-1), ['codex']);
  await off.service.syncThreads();
  assert.ok(off.calls.includes('codex-connect'));
  assert.ok(off.calls.includes('codex-list'));
  assert.equal(off.calls.some((value) => value.startsWith('observation-refresh:')), false);
  await off.service.openThread({ sessionKey: `codex:${CODEX_ID}` });
  assert.ok(off.calls.some((value) => value.startsWith('open:codex://threads/')));
});

test('explicit enable is two-phase, filters stale Hook delivery, and disable preserves data', async () => {
  const harness = createHarness();
  await initializeAndWait(harness, false);
  harness.calls.length = 0;
  harness.writes.length = 0;
  await harness.service.setClaudeProviderEnabled({ enabled: true });
  assert.deepEqual(harness.writes, [
    { schemaVersion: 1, enabled: true, hookAdmissionAfter: Number.MAX_SAFE_INTEGER },
    { schemaVersion: 1, enabled: true, hookAdmissionAfter: 1_000 }
  ]);
  const order = harness.calls.filter((value) =>
    value.startsWith('persist:') || [
      'outbox-clear', 'observation-start', 'plugin-refresh', 'listener-start', 'outbox-replay'
    ].includes(value));
  assert.deepEqual(order, [
    `persist:true:${Number.MAX_SAFE_INTEGER}`,
    'outbox-clear',
    'persist:true:1000',
    'observation-start',
    'plugin-refresh',
    'listener-start',
    'outbox-replay'
  ]);
  assert.deepEqual((await harness.service.getSnapshot()).threads.map(({ provider }) => provider), [
    'codex', 'claude'
  ]);
  await harness.service.markAllRead();
  assert.deepEqual(harness.readAllProviders.at(-1), ['codex', 'claude']);

  harness.calls.length = 0;
  const stale = await harness.service.commitClaudeHookDelivery(delivery(1_000));
  assert.deepEqual(stale, { duplicate: true });
  assert.deepEqual(harness.repositoryWrites, { inventory: 0, runtime: 0 });
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.calls.includes('broadcast'), false);
  assert.equal(harness.calls.includes('revoke-proof'), false);
  await harness.service.reportClaudeHookCoverageGap({
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 900,
    lastDetectedAt: 1_000,
    occurrences: 1
  });
  assert.equal(harness.calls.includes('revoke-proof'), false);
  await harness.service.commitClaudeHookDelivery(delivery(1_001));
  assert.deepEqual(harness.repositoryWrites, { inventory: 1, runtime: 1 });
  assert.equal(harness.notifications.length, 1);

  harness.calls.length = 0;
  await harness.service.setClaudeProviderEnabled({ enabled: false });
  const disabled = await harness.service.getSnapshot();
  assert.equal(disabled.claudeProvider.enabled, false);
  assert.deepEqual(disabled.threads.map(({ provider }) => provider), ['codex']);
  assert.equal(harness.calls.includes('plugin-remove'), false);
  assert.ok(harness.calls.indexOf('listener-stop') < harness.calls.indexOf('outbox-clear'));
  assert.ok(harness.calls.indexOf('observation-stop') < harness.calls.indexOf('outbox-clear'));
  await harness.service.markAllRead();
  assert.deepEqual(harness.readAllProviders.at(-1), ['codex']);
  await assert.rejects(
    () => harness.service.commitClaudeHookDelivery(delivery(2_000)),
    /not accepting/
  );
});

test('enabled restart preserves cutoff/offline replay and healthy set(true) is idempotent', async () => {
  const harness = createHarness({ preference: {
    schemaVersion: 1, enabled: true, hookAdmissionAfter: 500
  } });
  await initializeAndWait(harness, true);
  assert.equal(harness.calls.includes('outbox-clear'), false);
  assert.equal(harness.writes.length, 0);
  assert.ok(harness.calls.includes('outbox-replay'));
  await harness.service.commitClaudeHookDelivery(delivery(501));
  assert.equal(harness.repositoryWrites.runtime, 1);
  harness.calls.length = 0;
  await harness.service.setClaudeProviderEnabled({ enabled: true });
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.calls.includes('outbox-clear'), false);
  await harness.service.shutdown();
  await harness.service.markAllRead();
  assert.deepEqual(harness.readAllProviders.at(-1), ['codex']);
});

test('pending restart finishes cleanup while clear/write failures remain fail-closed and recoverable', async () => {
  const pending = createHarness({ preference: {
    schemaVersion: 1,
    enabled: true,
    hookAdmissionAfter: Number.MAX_SAFE_INTEGER
  }, now: 2_000 });
  await initializeAndWait(pending, true);
  assert.ok(pending.calls.includes('outbox-clear'));
  assert.deepEqual(pending.writes, [
    { schemaVersion: 1, enabled: true, hookAdmissionAfter: 2_000 }
  ]);

  const cleanupFailure = createHarness({ clearFails: true });
  await initializeAndWait(cleanupFailure, false);
  cleanupFailure.calls.length = 0;
  cleanupFailure.writes.length = 0;
  await cleanupFailure.service.setClaudeProviderEnabled({ enabled: true });
  let snapshot = await cleanupFailure.service.getSnapshot();
  assert.equal(snapshot.claudeProvider.enabled, true);
  assert.match(snapshot.claudeProvider.error ?? '', /cleanup failed/);
  assert.deepEqual(snapshot.threads.map(({ provider }) => provider), ['codex']);
  assert.equal(cleanupFailure.calls.includes('observation-start'), false);
  cleanupFailure.setClearFails(false);
  await cleanupFailure.service.setClaudeProviderEnabled({ enabled: true });
  snapshot = await cleanupFailure.service.getSnapshot();
  assert.equal(snapshot.claudeProvider.enabled, true);
  assert.equal(snapshot.claudeProvider.error, null);
  assert.ok(cleanupFailure.calls.includes('listener-start'));

  const writeFailure = createHarness({ writeFails: true });
  await initializeAndWait(writeFailure, false);
  await assert.rejects(
    () => writeFailure.service.setClaudeProviderEnabled({ enabled: true }),
    /setting write failed/
  );
  assert.deepEqual(providerState((await writeFailure.service.getSnapshot()).claudeProvider),
    { enabled: false, error: null });
  assert.equal(writeFailure.calls.includes('observation-start'), false);
});

test('malformed and slow hydration stay fenced while a valid switch can recover', async () => {
  const malformed = createHarness({ invalidPreference: true });
  await initializeAndWait(malformed, false);
  const invalid = await malformed.service.getSnapshot();
  assert.equal(invalid.claudeProvider.enabled, false);
  assert.match(invalid.claudeProvider.error ?? '', /invalid/);
  await malformed.service.setClaudeProviderEnabled({ enabled: true });
  assert.equal((await malformed.service.getSnapshot()).claudeProvider.enabled, true);

  let releaseHydration;
  const gate = new Promise((resolvePromise) => { releaseHydration = resolvePromise; });
  const slow = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: null },
    preferenceGate: gate
  });
  await slow.service.initialize();
  await slow.service.shutdown();
  releaseHydration();
  await tick();
  assert.equal(slow.calls.includes('observation-start'), false);
  assert.equal(slow.calls.includes('listener-start'), false);
  await assert.rejects(() => slow.service.setClaudeProviderEnabled({ enabled: false }), /not active/);
  assert.equal(slow.writes.length, 0);
});

test('disable publishes intent before joining a deferred scan and fences queued plugin work', async () => {
  let releaseRefresh;
  const refreshGate = new Promise((resolvePromise) => { releaseRefresh = resolvePromise; });
  const scan = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    observationRefreshGate: refreshGate,
    stopWaitsForRefresh: true
  });
  await initializeAndWait(scan, true);
  scan.calls.length = 0;
  const refresh = scan.service.refreshClaudeInventory();
  await waitFor(() => scan.calls.includes('observation-refresh:full'), 'deferred full scan');
  const disable = scan.service.setClaudeProviderEnabled({ enabled: false });
  await waitFor(() => scan.calls.some((value) => value.startsWith('persist:false:')),
    'persisted disable intent');
  const duringStop = await scan.service.getSnapshot();
  assert.equal(duringStop.claudeProvider.enabled, false);
  assert.deepEqual(duringStop.threads.map(({ provider }) => provider), ['codex']);
  assert.equal(scan.notifications.length, 0);
  releaseRefresh();
  await Promise.all([refresh, disable]);
  assert.ok(scan.calls.indexOf('observation-stop') < scan.calls.indexOf('outbox-clear'));

  let releaseInstall;
  const installGate = new Promise((resolvePromise) => { releaseInstall = resolvePromise; });
  const plugin = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    pluginInstallGate: installGate
  });
  await initializeAndWait(plugin, true);
  plugin.calls.length = 0;
  const install = plugin.service.installClaudeBridge();
  await waitFor(() => plugin.calls.includes('plugin-install'), 'deferred plugin install');
  const pluginDisable = plugin.service.setClaudeProviderEnabled({ enabled: false });
  await waitFor(() => plugin.calls.some((value) => value.startsWith('persist:false:')),
    'plugin-race disable intent');
  releaseInstall();
  await assert.rejects(install, /changed/);
  await pluginDisable;
  assert.equal(plugin.calls.includes('listener-start'), false);
});

test('completion notifications require a published Claude projection but never gate Codex', async () => {
  let releaseObservationStart;
  const observationStartGate = new Promise((resolvePromise) => {
    releaseObservationStart = resolvePromise;
  });
  const harness = createHarness({ observationStartGate });
  await initializeAndWait(harness, false);
  const claudeIntent = {
    sessionKey: `claude:${CLAUDE_ID}`,
    provider: 'claude',
    threadId: CLAUDE_ID,
    turnId: 'claude-turn',
    title: 'claude task'
  };
  const codexIntent = {
    sessionKey: `codex:${CODEX_ID}`,
    provider: 'codex',
    threadId: CODEX_ID,
    turnId: 'codex-turn',
    title: 'codex task'
  };
  harness.service.notifyThreadCompleted(claudeIntent);
  harness.service.notifyThreadCompleted(codexIntent);
  assert.deepEqual(harness.notifications, [codexIntent]);

  const enable = harness.service.setClaudeProviderEnabled({ enabled: true });
  await waitFor(() => harness.calls.includes('observation-start'), 'deferred provider activation');
  harness.service.notifyThreadCompleted(claudeIntent);
  assert.deepEqual(harness.notifications, [codexIntent],
    'saved enable intent must not admit notifications before projection is ready');
  releaseObservationStart();
  await enable;
  harness.service.notifyThreadCompleted(claudeIntent);
  assert.deepEqual(harness.notifications, [codexIntent, claudeIntent]);
});

test('Read all and provider intent share one ordering boundary', async () => {
  let releaseReadAll;
  const readAllGate = new Promise((resolvePromise) => { releaseReadAll = resolvePromise; });
  const harness = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    readAllGate
  });
  await initializeAndWait(harness, true);
  harness.calls.length = 0;
  const readAll = harness.service.markAllRead();
  await waitFor(() => harness.calls.includes('read-all:codex+claude'), 'Read all admission');
  const disable = harness.service.setClaudeProviderEnabled({ enabled: false });
  await tick();
  assert.equal(harness.calls.some((value) => value.startsWith('persist:false:')), false,
    'disable must linearize after an admitted visible-provider Read all mutation');
  releaseReadAll();
  await Promise.all([readAll, disable]);
  assert.equal((await harness.service.getSnapshot()).claudeProvider.enabled, false);
});

test('final cutoff persistence is serialized with disable and source recovery stays available', async () => {
  let releaseFinalWrite;
  const finalWriteGate = new Promise((resolvePromise) => { releaseFinalWrite = resolvePromise; });
  const racing = createHarness({ finalWriteGate });
  await initializeAndWait(racing, false);
  racing.calls.length = 0;
  const enable = racing.service.setClaudeProviderEnabled({ enabled: true });
  await waitFor(() => racing.calls.includes('persist:true:1000'), 'finite cutoff write');
  const disable = racing.service.setClaudeProviderEnabled({ enabled: false });
  releaseFinalWrite();
  await Promise.all([enable, disable]);
  assert.equal(racing.getPreference().enabled, false,
    'a stale finite-cutoff write must not win over the serialized disable');
  assert.equal((await racing.service.getSnapshot()).claudeProvider.enabled, false);

  const recovery = createHarness({
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 },
    observationStartFailures: 1
  });
  await initializeAndWait(recovery, true);
  assert.deepEqual((await recovery.service.getSnapshot()).threads.map(({ provider }) => provider), [
    'codex'
  ]);
  assert.ok(recovery.calls.includes('claude-status') && recovery.calls.includes('directory-status'));
  recovery.calls.length = 0;
  await recovery.service.retryClaudeDirectory();
  assert.ok(recovery.calls.indexOf('directory-retry') < recovery.calls.indexOf('observation-start'));
  assert.deepEqual((await recovery.service.getSnapshot()).threads.map(({ provider }) => provider), [
    'codex', 'claude'
  ]);
  assert.equal(recovery.writes.length, 0,
    'runtime recovery must preserve the finite cutoff and enabled-period offline backlog');
});

test('all Claude Main actions are guarded while disabled', async () => {
  const harness = createHarness();
  await initializeAndWait(harness, false);
  const actions = [
    () => harness.service.refreshClaudeInventory(),
    () => harness.service.openThread({ sessionKey: `claude:${CLAUDE_ID}` }),
    () => harness.service.previewThread({ sessionKey: `claude:${CLAUDE_ID}` }),
    () => harness.service.moveThread({ sessionKey: `claude:${CLAUDE_ID}`, domainId: 1 }),
    () => harness.service.installClaudeBridge(),
    () => harness.service.refreshClaudeBridgeStatus(),
    () => harness.service.removeClaudeBridge(),
    () => harness.service.getClaudeBridgeStatus(),
    () => harness.service.changeClaudeDirectory(),
    () => harness.service.useAutomaticClaudeDirectory(),
    () => harness.service.retryClaudeDirectory()
  ];
  for (const action of actions) await assert.rejects(action, /paused/);
  assert.equal(harness.calls.includes('plugin-install'), false);
  assert.equal(harness.calls.includes('plugin-remove'), false);
  assert.equal(harness.calls.includes('directory-change'), false);
});

test('concurrent window toggles preserve the final serialized intent', async () => {
  const harness = createHarness({ preference: {
    schemaVersion: 1, enabled: true, hookAdmissionAfter: 500
  } });
  await initializeAndWait(harness, true);
  await Promise.all([
    harness.service.setClaudeProviderEnabled({ enabled: false }),
    harness.service.setClaudeProviderEnabled({ enabled: true })
  ]);
  assert.equal((await harness.service.getSnapshot()).claudeProvider.enabled, true);
  await Promise.all([
    harness.service.setClaudeProviderEnabled({ enabled: true }),
    harness.service.setClaudeProviderEnabled({ enabled: false })
  ]);
  assert.equal((await harness.service.getSnapshot()).claudeProvider.enabled, false);
});

test('handler and UI source preserve owned cleanup, deferred replay, and compact switch styling', () => {
  const handler = readFileSync(join(projectRoot, 'src/main/xpc/eyesOnAgents.handler.ts'), 'utf8');
  const card = readFileSync(join(projectRoot,
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue'), 'utf8');
  const styles = readFileSync(join(projectRoot,
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'), 'utf8');
  const en = readFileSync(join(projectRoot, 'src/renderer/common/i18n/en.ts'), 'utf8');
  const zh = readFileSync(join(projectRoot, 'src/renderer/common/i18n/zh.ts'), 'utf8');
  assert.match(handler, /deferReplay: true/);
  assert.match(handler, /canArm: \(\) => eyesOnAgentsService\.canArmClaudeHookListener\(\)/);
  assert.match(handler,
    /clearClaudeHookOutboxRoot\(getClaudeHookOutboxPath\(app\.getPath\('userData'\)\)\)/);
  assert.doesNotMatch(handler,
    /clearClaudeHookOutboxRoot\(getClaudeHookOutboxPath\([^\n]+installationId/);
  assert.match(card, /<a-switch[\s\S]*size="small"/);
  assert.match(card, /<a-switch[\s\S]*:aria-label="i18nHelper\.eyesOnAgents\.claudeBridge\.provider"/);
  assert.match(card, /if \(typeof enabled !== 'boolean'\) return;/);
  assert.match(card, /setClaudeProviderEnabled\(enabled\)/);
  assert.doesNotMatch(card, /setClaudeProviderEnabled\(Boolean\(enabled\)\)/);
  assert.match(card, /v-if="providerEnabled"/);
  assert.match(card, /class="eyes-connection-card__provider-paused"/);
  assert.match(card, /claudeBridge\.removePlugin/);
  const pausedRule = styles.match(/\.eyes-connection-card \.eyes-connection-card__provider-paused\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(pausedRule, /border|box-shadow|background/);
  assert.match(en, /removePlugin: 'Remove plugin'/);
  assert.match(zh, /removePlugin: '移除插件'/);
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
