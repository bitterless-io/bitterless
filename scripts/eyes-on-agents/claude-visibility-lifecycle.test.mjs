import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-visibility-lifecycle-'));
const CODEX_ID = '11111111-1111-4111-8111-111111111111';
const MAPPED_CLAUDE_ID = '22222222-2222-4222-8222-222222222222';
const UNMAPPED_CLAUDE_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';

const loadTypeScriptModule = async (name, entry, plugins = []) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    external: ['better-sqlite3-multiple-ciphers'],
    plugins
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const persistedThread = ({ provider, threadId, desktopSessionId, runtimeState = 'idle' }) => ({
  sessionKey: `${provider}:${threadId}`,
  provider,
  threadId,
  desktopSessionId,
  transcriptPath: provider === 'claude' ? `/tmp/${threadId}.jsonl` : null,
  domainId: 1,
  title: `${provider} task`,
  cwd: '/tmp/project',
  projectKey: '/tmp/project',
  projectRootPath: '/tmp/project',
  projectName: 'project',
  runtimeState,
  activeFlags: [],
  activeTurnId: runtimeState === 'working' ? `hook-claude-${threadId}` : null,
  lastCompletedTurnId: null,
  lastCompletedAt: null,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: runtimeState === 'working' ? 'claude_hook' : 'discovery',
  statusObservedAt: runtimeState === 'working' ? new Date(1_000).toISOString() : null,
  statusFreshUntil: runtimeState === 'working' ? new Date(31_000).toISOString() : null,
  lastActivityAt: null,
  isUnread: true,
  isFocused: true,
  archiveState: 'active',
  lastUserPrompt: {
    state: 'unavailable', preview: null, turnId: null, observedAt: null,
    checkedAt: null, truncated: false
  }
});

class TestDatabase {
  constructor() {
    this.raw = new DatabaseSync(':memory:');
  }

  exec(sql) {
    return this.raw.exec(sql);
  }

  prepare(sql) {
    return this.raw.prepare(sql);
  }

  transaction(callback) {
    return (...args) => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = callback(...args);
        this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close() {
    this.raw.close();
  }
}

const repositoryStubs = {
  name: 'claude-visibility-lifecycle-repository-stubs',
  setup(buildApi) {
    buildApi.onResolve({ filter: /base\.dao$/ }, () => ({
      path: 'base-dao', namespace: 'claude-lifecycle-test'
    }));
    buildApi.onResolve({ filter: /sqlite\.manager$/ }, () => ({
      path: 'sqlite-manager', namespace: 'claude-lifecycle-test'
    }));
    buildApi.onResolve({ filter: /sqlite\.helper$/ }, () => ({
      path: 'sqlite-helper', namespace: 'claude-lifecycle-test'
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'claude-lifecycle-test' }, (args) => {
      if (args.path === 'base-dao') return { contents: 'export class BaseDao {}' };
      if (args.path === 'sqlite-manager') {
        return { contents: 'export const sqliteManager = globalThis.__claudeLifecycleDb;' };
      }
      return {
        contents: `
          const db = () => globalThis.__claudeLifecycleDb.db;
          export const sqliteHelper = {
            safeGet: async (sql, params = []) => db().prepare(sql).get(...params),
            safeAll: async (sql, params = []) => db().prepare(sql).all(...params),
            safeRun: async (sql, params = []) => db().prepare(sql).run(...params)
          };
        `
      };
    });
  }
};

try {
  const { EyesOnAgentsService } = await loadTypeScriptModule(
    'service',
    'src/main/eyesOnAgents/eyesOnAgents.service.ts'
  );

  await test('Main publishes only Desktop-routable Claude and invalidates before admission', async () => {
    const calls = [];
    let listenerRunning = false;
    let installationId = INSTALLATION_ID;
    let refreshGate = null;
    let replayGate = null;
    let expireMappedRuntime = false;
    const claudeBridgeStatus = () => ({
      state: 'installed', setupAction: listenerRunning ? 'none' : 'retry',
      configured: true, enabled: true,
      listening: listenerRunning, listeningSince: listenerRunning ? new Date(1_000).toISOString() : null,
      firstReceiptAt: null, lastReceiptAt: null,
      lastInspectedAt: null, observationProof: 'current', restartRequired: false, error: null
    });
    const mapped = persistedThread({
      provider: 'claude',
      threadId: MAPPED_CLAUDE_ID,
      desktopSessionId: `local_${MAPPED_CLAUDE_ID}`
    });
    const persisted = {
      domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
      threads: [
        persistedThread({ provider: 'codex', threadId: CODEX_ID, desktopSessionId: null }),
        mapped,
        persistedThread({
          provider: 'claude', threadId: UNMAPPED_CLAUDE_ID, desktopSessionId: null
        })
      ]
    };
    const repository = {
      getSnapshot: async () => persisted,
      expireClaudeAgentStates: async ({ statusSources, force }) => {
        calls.push(`expire:${statusSources?.join('+')}:${Boolean(force)}`);
        if (expireMappedRuntime && force) {
          mapped.runtimeState = 'unknown';
          mapped.activeTurnId = null;
          mapped.statusSource = 'discovery';
        }
        return { changed: false };
      },
      getRuntimeReceiptSummary: async () => ({ firstReceivedAt: null, lastReceivedAt: null })
    };
    const service = new EyesOnAgentsService({
      repository,
      settings: { get: async () => false, upsert: async () => undefined },
      appServer: {
        getStatus: (autoConnectEnabled) => ({
          state: 'disconnected', lastSyncedAt: null, error: null, autoConnectEnabled
        }),
        isConnected: () => false
      },
      claudeProviderPreference: {
        hydrate: async () => ({
          state: 'valid',
          preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 }
        }),
        getStatus: () => ({ enabled: true, hookAdmissionAfter: 500, error: null }),
        setEnabled: async (enabled, hookAdmissionAfter) => ({
          schemaVersion: 1, enabled, hookAdmissionAfter
        })
      },
      desktopBridge: {
        getStatus: () => ({
          state: 'not_installed', reviewReason: null, listening: false,
          listeningSince: null, lastEventAt: null, lastInspectedAt: null, error: null
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
      },
      bridgeListener: {
        start: async () => undefined,
        stop: async () => undefined,
        recoverOutboxCoverageGap: async () => undefined,
        replayOutbox: async () => undefined
      },
      openExternal: async () => undefined,
      writeClipboardText: () => undefined,
      claudeObservation: {
        start: async () => calls.push('observation-start'),
        stop: async () => calls.push('observation-stop'),
        refresh: async () => ({ changed: false })
      },
      claudeBridge: {
        getStatus: claudeBridgeStatus,
        getInstallationId: () => installationId,
        hasInstallationIntent: () => true,
        acceptsInstallation: (id) => id === installationId,
        revokeObservationProof: () => undefined,
        install: async () => undefined,
        refresh: async () => {
          calls.push('plugin-refresh');
          if (refreshGate) await refreshGate;
          return claudeBridgeStatus();
        },
        remove: async () => undefined
      },
      claudeHookListener: {
        start: async () => {
          calls.push('listener-start');
          listenerRunning = true;
        },
        stop: async () => {
          calls.push('listener-stop');
          listenerRunning = false;
        },
        replayOutbox: async () => {
          calls.push('outbox-replay');
          if (replayGate) await replayGate;
        }
      },
      now: () => 100_000
    });

    await service.initialize();
    await waitFor(() => calls.includes('outbox-replay'), 'Claude listener activation');
    const invalidation = calls.indexOf('expire:claude_hook:true');
    assert.ok(invalidation >= 0);
    assert.ok(invalidation < calls.indexOf('listener-start'));
    assert.ok(invalidation < calls.indexOf('outbox-replay'));
    assert.deepEqual(
      (await service.getSnapshot()).threads.map(({ sessionKey }) => sessionKey),
      [`codex:${CODEX_ID}`, `claude:${MAPPED_CLAUDE_ID}`]
    );
    assert.equal(persisted.threads.length, 3, 'unmapped evidence must remain Main-private');

    mapped.runtimeState = 'working';
    mapped.statusSource = 'claude_hook';
    mapped.statusObservedAt = new Date(1_000).toISOString();
    mapped.statusFreshUntil = new Date(31_000).toISOString();
    assert.equal(
      (await service.getSnapshot()).threads.find(({ provider }) => provider === 'claude')
        .runtimeState,
      'working',
      'the former 30-second lease must not alter a Hook-owned snapshot'
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      calls.length = 0;
      await service.refreshClaudeBridgeStatus();
      assert.deepEqual(calls, ['plugin-refresh'],
        'a healthy status check must not restart or invalidate the listener generation');
      assert.equal(mapped.runtimeState, 'working');
      assert.equal(service.canArmClaudeHookListener(), true);
    }

    listenerRunning = false;
    calls.length = 0;
    await service.refreshClaudeBridgeStatus();
    assert.equal(calls.filter((call) => call === 'expire:claude_hook:true').length, 1);
    assert.equal(calls.filter((call) => call === 'listener-stop').length, 1);
    assert.equal(calls.filter((call) => call === 'listener-start').length, 1);
    assert.equal(calls.filter((call) => call === 'outbox-replay').length, 1);
    assert.ok(calls.indexOf('listener-stop') < calls.indexOf('expire:claude_hook:true'));
    assert.ok(calls.indexOf('expire:claude_hook:true') < calls.indexOf('listener-start'));

    installationId = '55555555-5555-4555-8555-555555555555';
    calls.length = 0;
    await service.refreshClaudeBridgeStatus();
    assert.equal(calls.filter((call) => call === 'listener-stop').length, 1);
    assert.equal(calls.filter((call) => call === 'expire:claude_hook:true').length, 1);
    assert.equal(calls.filter((call) => call === 'listener-start').length, 1);
    assert.equal(calls.filter((call) => call === 'outbox-replay').length, 1);
    assert.ok(calls.indexOf('listener-stop') < calls.indexOf('expire:claude_hook:true'));
    assert.ok(calls.indexOf('expire:claude_hook:true') < calls.indexOf('listener-start'));

    mapped.runtimeState = 'working';
    mapped.activeTurnId = `hook-claude-${MAPPED_CLAUDE_ID}`;
    mapped.statusSource = 'claude_hook';
    expireMappedRuntime = true;
    listenerRunning = false;
    const slowReplay = deferred();
    replayGate = slowReplay.promise;
    calls.length = 0;
    const retryDuringDisable = service.refreshClaudeBridgeStatus();
    await waitFor(() => calls.includes('outbox-replay'), 'deferred Claude outbox replay');
    const disableDuringReplay = service.setClaudeProviderEnabled({ enabled: false });
    await waitFor(
      () => calls.filter((call) => call === 'listener-stop').length >= 2,
      'provider disable fence during replay'
    );
    const replayDisableFence = calls.lastIndexOf('listener-stop');
    assert.equal(service.canArmClaudeHookListener(), false);
    slowReplay.resolve();
    replayGate = null;
    await Promise.all([retryDuringDisable, disableDuringReplay]);
    assert.equal(mapped.runtimeState, 'unknown');
    assert.deepEqual(
      calls.slice(replayDisableFence + 1).filter(
        (call) => call === 'listener-start' || call === 'outbox-replay'
      ),
      [],
      'a replay admitted before Off must not restore listener intake or a Hook epoch afterward'
    );
    const replayDisabledSnapshot = await service.getSnapshot();
    assert.equal(replayDisabledSnapshot.claudeProvider.enabled, false);
    assert.deepEqual(replayDisabledSnapshot.threads.map(({ sessionKey }) => sessionKey), [
      `codex:${CODEX_ID}`
    ]);

    expireMappedRuntime = false;
    calls.length = 0;
    await service.setClaudeProviderEnabled({ enabled: true });
    assert.equal(service.canArmClaudeHookListener(), true);
    mapped.runtimeState = 'working';
    mapped.activeTurnId = `hook-claude-${MAPPED_CLAUDE_ID}`;
    mapped.statusSource = 'claude_hook';
    expireMappedRuntime = true;

    const slowRefresh = deferred();
    refreshGate = slowRefresh.promise;
    calls.length = 0;
    const refreshDuringDisable = service.refreshClaudeBridgeStatus();
    await waitFor(() => calls.includes('plugin-refresh'), 'deferred Claude bridge refresh');
    const disableDuringRefresh = service.setClaudeProviderEnabled({ enabled: false });
    await waitFor(() => calls.includes('listener-stop'), 'provider disable fence during refresh');
    const refreshDisableFence = calls.lastIndexOf('listener-stop');
    assert.equal(service.canArmClaudeHookListener(), false);
    slowRefresh.resolve();
    refreshGate = null;
    await Promise.all([refreshDuringDisable, disableDuringRefresh]);
    assert.equal(mapped.runtimeState, 'unknown');
    assert.deepEqual(
      calls.slice(refreshDisableFence + 1).filter(
        (call) => call === 'listener-start' || call === 'outbox-replay'
      ),
      [],
      'a stale status result must not restart Claude after the provider intent changed'
    );
    assert.deepEqual(calls.filter((call) => call.startsWith('expire:')), [
      'expire:claude_agent_view+claude_hook:true'
    ]);
    const refreshDisabledSnapshot = await service.getSnapshot();
    assert.equal(refreshDisabledSnapshot.claudeProvider.enabled, false);
    assert.deepEqual(refreshDisabledSnapshot.threads.map(({ sessionKey }) => sessionKey), [
      `codex:${CODEX_ID}`
    ]);
  });

  const { eyesOnAgentsTable } = await loadTypeScriptModule(
    'table',
    'src/preload/sqlite/dao/eyesOnAgents.table.ts'
  );
  const db = new TestDatabase();
  db.exec(eyesOnAgentsTable.createSql);
  globalThis.__claudeLifecycleDb = { db };
  const { EyesOnAgentsRepositoryDao } = await loadTypeScriptModule(
    'repository',
    'src/preload/sqlite/dao/eyesOnAgents.dao.ts',
    [repositoryStubs]
  );

  await test('Hook epoch outranks timeout and Agent View until admitted terminal or invalidation', async () => {
    const repository = new EyesOnAgentsRepositoryDao();
    const key = `claude:${MAPPED_CLAUDE_ID}`;
    const state = () => ({ ...db.prepare(
      `SELECT runtime_state, status_source, status_observed_at, status_fresh_until,
        active_turn_id
       FROM eyes_on_agents_thread WHERE session_key = ?`
    ).get(key) });
    await repository.upsertClaudeInventory({
      threads: [{
        threadId: MAPPED_CLAUDE_ID,
        desktopSessionId: `local_${MAPPED_CLAUDE_ID}`,
        transcriptPath: `/tmp/${MAPPED_CLAUDE_ID}.jsonl`,
        title: 'Claude lifecycle',
        cwd: '/tmp/project',
        archiveState: 'active',
        lastActivityAt: 9_000,
        observedAt: 9_000
      }]
    });
    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000001',
      event: {
        type: 'turn_started', threadId: MAPPED_CLAUDE_ID, turnId: null,
        observedAt: 10_000, source: 'claude_hook'
      },
      replayAuthority: 'current_listener'
    });
    await repository.applyRuntimeEvent({
      event: {
        type: 'thread_status', threadId: MAPPED_CLAUDE_ID, turnId: null,
        runtimeState: 'waiting_approval', activeFlags: ['waitingOnApproval'],
        observedAt: 10_100, source: 'claude_hook'
      }
    });
    assert.deepEqual(state(), {
      runtime_state: 'waiting_approval',
      status_source: 'claude_hook',
      status_observed_at: 10_100,
      status_fresh_until: null,
      active_turn_id: 'hook-claude-10000'
    });
    assert.deepEqual(await repository.expireClaudeAgentStates({ observedAt: 100_000 }), {
      changed: false
    });
    assert.deepEqual(await repository.reconcileClaudeAgentStates({
      agents: [{
        threadId: MAPPED_CLAUDE_ID,
        runtimeState: 'idle',
        title: 'Agent View terminal',
        cwd: null,
        startedAt: null,
        observedAt: 100_000
      }],
      completeSnapshot: true,
      observedAt: 100_000
    }), { changed: false });
    assert.equal(state().runtime_state, 'waiting_approval');

    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000002',
      event: {
        type: 'turn_completed', threadId: MAPPED_CLAUDE_ID, turnId: null,
        observedAt: 100_100, source: 'claude_hook', outcome: 'failed'
      }
    });
    assert.equal(state().runtime_state, 'failed');
    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000003',
      event: {
        type: 'turn_started', threadId: MAPPED_CLAUDE_ID, turnId: null,
        observedAt: 100_200, source: 'claude_hook'
      }
    });
    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000004',
      event: {
        type: 'thread_status', threadId: MAPPED_CLAUDE_ID, turnId: null,
        runtimeState: 'ended', activeFlags: [],
        observedAt: 100_250, source: 'claude_hook'
      }
    });
    assert.equal(state().runtime_state, 'ended');
    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000005',
      event: {
        type: 'turn_started', threadId: MAPPED_CLAUDE_ID, turnId: null,
        observedAt: 100_300, source: 'claude_hook'
      }
    });
    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000006',
      event: {
        type: 'turn_completed', threadId: MAPPED_CLAUDE_ID,
        turnId: '50000000-0000-4000-8000-000000000006',
        observedAt: 100_275, source: 'claude_hook', outcome: 'completed'
      }
    });
    assert.equal(state().runtime_state, 'working', 'older Stop must lose to a newer epoch');
    const stop = {
      deliveryId: '50000000-0000-4000-8000-000000000007',
      event: {
        type: 'turn_completed', threadId: MAPPED_CLAUDE_ID,
        turnId: '50000000-0000-4000-8000-000000000007',
        observedAt: 100_400, source: 'claude_hook', outcome: 'completed'
      }
    };
    assert.equal((await repository.applyRuntimeEventDelivery(stop)).duplicate, false);
    assert.equal(state().runtime_state, 'idle');
    assert.equal((await repository.applyRuntimeEventDelivery(stop)).duplicate, true);

    await repository.applyRuntimeEventDelivery({
      deliveryId: '50000000-0000-4000-8000-000000000008',
      event: {
        type: 'turn_started', threadId: MAPPED_CLAUDE_ID, turnId: null,
        observedAt: 100_500, source: 'claude_hook'
      }
    });
    assert.deepEqual(await repository.expireClaudeAgentStates({
      observedAt: 100_600,
      statusSources: ['claude_hook'],
      force: true
    }), { changed: true });
    assert.deepEqual(state(), {
      runtime_state: 'unknown',
      status_source: 'discovery',
      status_observed_at: 100_600,
      status_fresh_until: null,
      active_turn_id: null
    });
  });

  db.close();
} finally {
  delete globalThis.__claudeLifecycleDb;
  rmSync(buildRoot, { recursive: true, force: true });
}
