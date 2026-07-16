import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-repository-'));
const THREAD_A = '11111111-1111-4111-8111-111111111111';
const THREAD_B = '22222222-2222-4222-8222-222222222222';
const INVALID_VERSION_THREAD = '33333333-3333-0333-8333-333333333333';
const INVALID_VARIANT_THREAD = '44444444-4444-4444-7444-444444444444';
const EXTRA_HYPHEN_THREAD = '55555555-5555-4555-8555-55555555555-';

class TestDatabase {
  raw = new DatabaseSync(':memory:');

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

const repositoryStubs = {
  name: 'eyes-on-agents-repository-stubs',
  setup(buildApi) {
    buildApi.onResolve({ filter: /base\.dao$/ }, () => ({ path: 'base-dao', namespace: 'eyes-test' }));
    buildApi.onResolve({ filter: /sqlite\.manager$/ }, () => ({ path: 'sqlite-manager', namespace: 'eyes-test' }));
    buildApi.onResolve({ filter: /sqlite\.helper$/ }, () => ({ path: 'sqlite-helper', namespace: 'eyes-test' }));
    buildApi.onLoad({ filter: /.*/, namespace: 'eyes-test' }, (args) => {
      if (args.path === 'base-dao') return { contents: 'export class BaseDao {}' };
      if (args.path === 'sqlite-manager') {
        return { contents: 'export const sqliteManager = globalThis.__eyesTestSqliteManager;' };
      }
      return {
        contents: `
          const db = () => globalThis.__eyesTestSqliteManager.db;
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
  const { eyesOnAgentsTable } = await loadTypeScriptModule(
    'table',
    'src/preload/sqlite/dao/eyesOnAgents.table.ts'
  );
  const { ensureEyesOnAgentsLegacyImport } = await loadTypeScriptModule(
    'migration',
    'src/preload/sqlite/dao/eyesOnAgents.migration.ts'
  );
  const repairDb = new TestDatabase();
  assert.throws(
    () => ensureEyesOnAgentsLegacyImport(repairDb),
    /eyes_on_agents_domain/,
    'a failed migration attempt must remain safe to retry outside version bookkeeping'
  );
  repairDb.exec(eyesOnAgentsTable.createSql);
  ensureEyesOnAgentsLegacyImport(repairDb);
  ensureEyesOnAgentsLegacyImport(repairDb);
  assert.equal(
    repairDb.prepare(
      "SELECT COUNT(*) AS count FROM eyes_on_agents_domain WHERE domain_key = 'uncategorized' AND is_deleted = 0"
    ).get().count,
    1
  );
  repairDb.close();

  const db = new TestDatabase();
  db.exec(eyesOnAgentsTable.createSql);
  db.exec(`
    CREATE TABLE coding_agent_session (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      title TEXT,
      cwd TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO coding_agent_session (
      id, provider, external_session_id, title, cwd, is_deleted, created_at, updated_at
    ) VALUES (?, 'codex', ?, 'Legacy Codex', '/legacy', 0, 10, 20)`
  ).run('legacy-row', THREAD_A);
  db.prepare(
    `INSERT INTO coding_agent_session (
      id, provider, external_session_id, title, cwd, is_deleted, created_at, updated_at
    ) VALUES (?, 'claude', ?, 'Legacy Claude', '/legacy', 0, 10, 20)`
  ).run('claude-row', THREAD_B);
  db.prepare(
    `INSERT INTO coding_agent_session (
      id, provider, external_session_id, title, cwd, is_deleted, created_at, updated_at
    ) VALUES (?, 'codex', ?, 'Invalid version', '/legacy', 0, 10, 20)`
  ).run('invalid-version-row', INVALID_VERSION_THREAD);
  db.prepare(
    `INSERT INTO coding_agent_session (
      id, provider, external_session_id, title, cwd, is_deleted, created_at, updated_at
    ) VALUES (?, 'codex', ?, 'Invalid variant', '/legacy', 0, 10, 20)`
  ).run('invalid-variant-row', INVALID_VARIANT_THREAD);
  db.prepare(
    `INSERT INTO coding_agent_session (
      id, provider, external_session_id, title, cwd, is_deleted, created_at, updated_at
    ) VALUES (?, 'codex', ?, 'Extra hyphen', '/legacy', 0, 10, 20)`
  ).run('extra-hyphen-row', EXTRA_HYPHEN_THREAD);

  ensureEyesOnAgentsLegacyImport(db);
  ensureEyesOnAgentsLegacyImport(db);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM eyes_on_agents_thread').get().count,
    1,
    'legacy import must be Codex-only and idempotent even without provider_title'
  );
  const imported = db.prepare(
    'SELECT last_completed_at, status_source FROM eyes_on_agents_thread WHERE thread_id = ?'
  ).get(THREAD_A);
  assert.equal(imported.last_completed_at, null);
  assert.equal(imported.status_source, 'discovery');
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_thread WHERE thread_id IN (?, ?, ?)'
    ).get(INVALID_VERSION_THREAD, INVALID_VARIANT_THREAD, EXTRA_HYPHEN_THREAD).count,
    0,
    'legacy import must enforce UUID structure, version, and variant like runtime input'
  );

  globalThis.__eyesTestSqliteManager = { db };
  const { EyesOnAgentsRepositoryDao } = await loadTypeScriptModule(
    'dao',
    'src/preload/sqlite/dao/eyesOnAgents.dao.ts',
    [repositoryStubs]
  );
  const repository = new EyesOnAgentsRepositoryDao();
  let snapshot = await repository.getSnapshot();
  assert.equal(snapshot.domains.length, 1);
  assert.equal(snapshot.domains[0].domainKey, 'uncategorized');
  assert.equal(snapshot.domains[0].isSystem, true);
  assert.equal(snapshot.threads[0].isUnread, false, 'historical import must not flood Focus');

  await repository.upsertDiscoveredThreads({
    threads: [
      {
        threadId: THREAD_A,
        title: 'Synced A',
        cwd: '/repo/a',
        runtimeState: 'unknown',
        activeFlags: [],
        statusSource: 'discovery',
        statusObservedAt: null,
        lastActivityAt: 100
      },
      {
        threadId: THREAD_B,
        title: 'Synced B',
        cwd: '/repo/b',
        runtimeState: 'unknown',
        activeFlags: [],
        statusSource: 'discovery',
        statusObservedAt: null,
        lastActivityAt: 101
      }
    ]
  });
  await repository.createDomain({ title: 'Bitterless' });
  snapshot = await repository.getSnapshot();
  const custom = snapshot.domains.find((domain) => domain.title === 'Bitterless');
  assert.ok(custom);
  await repository.moveThread({ threadId: THREAD_A, domainId: custom.id });
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_A,
      title: 'Synced A again',
      cwd: '/repo/a',
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: null,
      lastActivityAt: 102
    }]
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).domainId,
    custom.id,
    'sync must preserve Domain assignment'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_A,
      turnId: null,
      observedAt: 200,
      source: 'codex_hook'
    }
  });
  await repository.markOpened({ threadId: THREAD_A, openedAt: 210 });
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: null,
      outcome: 'completed',
      observedAt: 220,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  const completedA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(completedA.lastCompletedTurnId, 'hook-200');
  assert.equal(completedA.lastOpenedTurnId, 'hook-200');
  assert.equal(completedA.isUnread, false, 'opened active turn A must stay read when A completes');
  assert.equal(completedA.isFocused, false);

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_A,
      turnId: 'turn-b',
      observedAt: 230,
      source: 'app_server'
    }
  });
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: 'turn-b',
      outcome: 'completed',
      observedAt: 240,
      source: 'app_server'
    }
  });
  snapshot = await repository.getSnapshot();
  const completedB = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(completedB.isUnread, true, 'later unseen turn B must become unread');
  assert.equal(completedB.isFocused, true);

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: 'server-a-turn',
      observedAt: 300,
      source: 'app_server'
    }
  });
  await repository.invalidateAppServerStatuses({ observedAt: 350 });
  snapshot = await repository.getSnapshot();
  const disconnectedB = snapshot.threads.find((thread) => thread.threadId === THREAD_B);
  assert.equal(disconnectedB.runtimeState, 'unknown');
  assert.equal(disconnectedB.statusSource, 'discovery');
  assert.equal(disconnectedB.activeTurnId, null);
  assert.equal(
    disconnectedB.isFocused,
    false,
    'reconnect preparation must invalidate status owned by the previous managed server'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: 'server-a-turn-replayed',
      observedAt: 375,
      source: 'app_server'
    }
  });
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_B,
      title: 'Server B not loaded',
      cwd: '/repo/b',
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: 400,
      lastActivityAt: 101
    }]
  });
  snapshot = await repository.getSnapshot();
  const notLoadedB = snapshot.threads.find((thread) => thread.threadId === THREAD_B);
  assert.equal(notLoadedB.runtimeState, 'unknown');
  assert.equal(notLoadedB.statusSource, 'discovery');
  assert.equal(notLoadedB.activeTurnId, null);
  assert.equal(notLoadedB.isFocused, false, 'server B notLoaded must clear server A working state');

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: null,
      observedAt: 500,
      source: 'codex_hook'
    }
  });
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_B,
      title: 'Server B still not loaded',
      cwd: '/repo/b',
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: 600,
      lastActivityAt: 101
    }]
  });
  snapshot = await repository.getSnapshot();
  const hookOwnedB = snapshot.threads.find((thread) => thread.threadId === THREAD_B);
  assert.equal(hookOwnedB.runtimeState, 'working');
  assert.equal(hookOwnedB.statusSource, 'codex_hook');
  assert.equal(hookOwnedB.activeTurnId, 'hook-500');
  assert.equal(hookOwnedB.isFocused, true, 'managed notLoaded must preserve Desktop hook evidence');
  await repository.invalidateAppServerStatuses({ observedAt: 700 });
  snapshot = await repository.getSnapshot();
  const hookAfterReconnectB = snapshot.threads.find((thread) => thread.threadId === THREAD_B);
  assert.equal(hookAfterReconnectB.statusSource, 'codex_hook');
  assert.equal(
    hookAfterReconnectB.activeTurnId,
    'hook-500',
    'reconnect preparation must not erase Desktop hook ownership'
  );

  await repository.createDomain({ title: 'Rollback check' });
  snapshot = await repository.getSnapshot();
  const rollbackDomain = snapshot.domains.find((domain) => domain.title === 'Rollback check');
  await repository.moveThread({ threadId: THREAD_B, domainId: rollbackDomain.id });
  db.exec(`
    CREATE TRIGGER abort_eyes_domain_delete
    BEFORE UPDATE OF is_deleted ON eyes_on_agents_domain
    WHEN OLD.id = ${rollbackDomain.id}
    BEGIN
      SELECT RAISE(ABORT, 'injected delete failure');
    END;
  `);
  await assert.rejects(
    () => repository.deleteDomain({ domainId: rollbackDomain.id }),
    /injected delete failure/
  );
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_B).domainId,
    rollbackDomain.id,
    'failed Domain delete must roll back the preceding thread reassignment'
  );
  assert.equal(snapshot.domains.some((domain) => domain.id === rollbackDomain.id), true);
  db.exec('DROP TRIGGER abort_eyes_domain_delete;');

  await repository.deleteDomain({ domainId: custom.id });
  snapshot = await repository.getSnapshot();
  const uncategorized = snapshot.domains.find((domain) => domain.domainKey === 'uncategorized');
  assert.equal(snapshot.domains.some((domain) => domain.id === custom.id), false);
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).domainId,
    uncategorized.id,
    'Domain deletion must transactionally reassign threads'
  );
  await assert.rejects(
    () => repository.deleteDomain({ domainId: uncategorized.id }),
    /System Domains cannot be deleted/
  );
  await assert.rejects(
    () => repository.renameDomain({ domainId: uncategorized.id, title: 'Renamed' }),
    /System Domains cannot be renamed/
  );

  db.close();
  console.log('EyesOnAgents repository tests passed');
} finally {
  delete globalThis.__eyesTestSqliteManager;
  rmSync(buildRoot, { recursive: true, force: true });
}
