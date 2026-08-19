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
        getStatus: () => ({
          state: 'installed', setupAction: 'none', configured: true, enabled: true,
          listening: true, listeningSince: null, firstReceiptAt: null, lastReceiptAt: null,
          lastInspectedAt: null, observationProof: 'current', restartRequired: false, error: null
        }),
        hasInstallationIntent: () => true,
        acceptsInstallation: (id) => id === INSTALLATION_ID,
        revokeObservationProof: () => undefined,
        install: async () => undefined,
        refresh: async () => {
          calls.push('plugin-refresh');
          return {
            state: 'installed', setupAction: 'none', configured: true, enabled: true,
            listening: true, listeningSince: null, firstReceiptAt: null, lastReceiptAt: null,
            lastInspectedAt: null, observationProof: 'current', restartRequired: false, error: null
          };
        },
        remove: async () => undefined
      },
      claudeHookListener: {
        start: async () => calls.push('listener-start'),
        stop: async () => calls.push('listener-stop'),
        replayOutbox: async () => calls.push('outbox-replay')
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

    calls.length = 0;
    await service.refreshClaudeBridgeStatus();
    const resumedInvalidation = calls.indexOf('expire:claude_hook:true');
    assert.ok(resumedInvalidation >= 0);
    assert.ok(resumedInvalidation < calls.indexOf('listener-start'));
    assert.ok(resumedInvalidation < calls.indexOf('outbox-replay'));
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
