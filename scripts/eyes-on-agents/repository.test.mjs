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
const THREAD_C = '33333333-3333-4333-8333-333333333333';
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
  const {
    ensureEyesOnAgentsArchiveSchema,
    ensureEyesOnAgentsLegacyImport,
    ensureEyesOnAgentsProjectMetadataSchema
  } = await loadTypeScriptModule(
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
  ensureEyesOnAgentsArchiveSchema(repairDb);
  ensureEyesOnAgentsArchiveSchema(repairDb);
  ensureEyesOnAgentsProjectMetadataSchema(repairDb);
  ensureEyesOnAgentsProjectMetadataSchema(repairDb);
  ensureEyesOnAgentsLegacyImport(repairDb);
  ensureEyesOnAgentsLegacyImport(repairDb);
  assert.equal(
    repairDb.prepare(
      "SELECT COUNT(*) AS count FROM eyes_on_agents_domain WHERE domain_key = 'uncategorized' AND is_deleted = 0"
    ).get().count,
    1
  );
  repairDb.close();

  const oldDb = new TestDatabase();
  oldDb.exec(`
    CREATE TABLE eyes_on_agents_thread (
      thread_id TEXT PRIMARY KEY,
      domain_id INTEGER NOT NULL,
      last_activity_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureEyesOnAgentsProjectMetadataSchema(oldDb);
  ensureEyesOnAgentsProjectMetadataSchema(oldDb);
  ensureEyesOnAgentsArchiveSchema(oldDb);
  ensureEyesOnAgentsArchiveSchema(oldDb);
  const migratedColumns = oldDb.prepare('PRAGMA table_info(eyes_on_agents_thread)').all();
  assert.deepEqual(
    migratedColumns
      .map((column) => column.name)
      .filter((name) => name.startsWith('project_')),
    ['project_key', 'project_root', 'project_name'],
    'old databases must receive the idempotent Project columns migration'
  );
  assert.equal(
    migratedColumns.some((column) => column.name === 'is_archived'),
    true,
    'old databases must receive the idempotent archive state migration'
  );
  oldDb.close();

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
        project: {
          projectKey: '/repo/a',
          projectRoot: '/repo/a',
          projectName: 'a'
        },
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
        project: null,
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
  const preservedProjectA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(
    preservedProjectA.domainId,
    custom.id,
    'sync must preserve Domain assignment'
  );
  assert.equal(
    preservedProjectA.projectKey,
    '/repo/a',
    'unavailable Project evidence must preserve the last known Project'
  );

  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_A,
      title: null,
      cwd: '/plain',
      project: null,
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: null,
      lastActivityAt: 103
    }]
  });
  snapshot = await repository.getSnapshot();
  const clearedProjectA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(clearedProjectA.projectKey, null, 'confirmed no-Project evidence must clear all fields');
  assert.equal(clearedProjectA.projectRoot, null);
  assert.equal(clearedProjectA.projectName, null);
  assert.equal(clearedProjectA.domainId, custom.id, 'Project clearing must not change Domain');

  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_A,
      title: null,
      cwd: '/repo/new-a',
      project: {
        projectKey: '/repo/new-a',
        projectRoot: '/repo/new-a',
        projectName: 'new-a'
      },
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: null,
      lastActivityAt: 104
    }]
  });
  snapshot = await repository.getSnapshot();
  const updatedProjectA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(updatedProjectA.projectKey, '/repo/new-a');
  assert.equal(updatedProjectA.domainId, custom.id, 'Project updates must not change Domain');

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_C,
      turnId: 'hook-created',
      cwd: '/repo/hook',
      project: {
        projectKey: '/repo/hook',
        projectRoot: '/repo/hook',
        projectName: 'hook'
      },
      observedAt: 190,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  const hookCreated = snapshot.threads.find((thread) => thread.threadId === THREAD_C);
  assert.equal(hookCreated.projectKey, '/repo/hook', 'hook-created rows must persist Project metadata');
  assert.equal(
    hookCreated.domainId,
    snapshot.domains.find((domain) => domain.domainKey === 'uncategorized').id
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'thread_status',
      threadId: THREAD_C,
      runtimeState: 'waiting_input',
      activeFlags: ['waitingOnUserInput'],
      observedAt: 191,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_C).projectKey,
    '/repo/hook',
    'runtime events without cwd evidence must preserve Project metadata'
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'thread_status',
      threadId: THREAD_C,
      runtimeState: 'idle',
      activeFlags: [],
      project: null,
      observedAt: 192,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_C).projectKey,
    null,
    'runtime confirmed no-Project evidence must clear Project metadata'
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
      threadId: THREAD_A,
      turnId: 'turn-c',
      observedAt: 245,
      source: 'app_server'
    }
  });
  await repository.setThreadArchived({
    threadId: THREAD_A,
    archived: true,
    observedAt: 250
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.some((thread) => thread.threadId === THREAD_A),
    false,
    'archived threads must disappear from EyesOnAgents snapshots'
  );
  const archivedA = db.prepare(
    `SELECT is_archived, domain_id, project_key, runtime_state, active_flags_json,
      active_turn_id, last_completed_turn_id, last_completed_at,
      last_opened_turn_id, last_opened_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_A);
  assert.equal(archivedA.is_archived, 1);
  assert.equal(archivedA.domain_id, custom.id, 'archive must preserve Domain assignment');
  assert.equal(archivedA.project_key, '/repo/new-a', 'archive must preserve Project metadata');
  assert.equal(archivedA.runtime_state, 'unknown');
  assert.equal(archivedA.active_flags_json, '[]');
  assert.equal(archivedA.active_turn_id, null, 'archive must clear transient active-turn evidence');
  assert.equal(archivedA.last_completed_turn_id, 'turn-b');
  assert.equal(archivedA.last_completed_at, 240);
  assert.equal(archivedA.last_opened_turn_id, 'hook-200');
  assert.equal(archivedA.last_opened_at, 210);

  await repository.setThreadArchived({
    threadId: THREAD_A,
    archived: false,
    observedAt: 260
  });
  snapshot = await repository.getSnapshot();
  const unarchivedA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(unarchivedA.domainId, custom.id);
  assert.equal(unarchivedA.projectKey, '/repo/new-a');
  assert.equal(unarchivedA.lastCompletedTurnId, 'turn-b');
  assert.equal(unarchivedA.isUnread, true, 'unarchive must preserve durable read state');

  await repository.markThreadsArchived({ threadIds: [THREAD_A, THREAD_A], observedAt: 270 });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.some((thread) => thread.threadId === THREAD_A),
    false,
    'archived inventory reconciliation must hide every explicit archived id'
  );
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_A,
      title: 'Active after unarchive',
      cwd: '/repo/new-a',
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: 280,
      lastActivityAt: 280
    }]
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.some((thread) => thread.threadId === THREAD_A),
    true,
    'active discovery must clear a stale archived marker'
  );
  assert.equal(
    db.prepare('SELECT is_archived FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_A).is_archived,
    0
  );

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
  await repository.markOpened({ threadId: THREAD_B, openedAt: 705 });
  await repository.invalidateCodexHookStatuses({ observedAt: 710 });
  snapshot = await repository.getSnapshot();
  const hookAfterDisconnectB = snapshot.threads.find((thread) => thread.threadId === THREAD_B);
  assert.equal(hookAfterDisconnectB.runtimeState, 'unknown');
  assert.equal(hookAfterDisconnectB.statusSource, 'discovery');
  assert.equal(hookAfterDisconnectB.activeTurnId, null);
  assert.equal(
    hookAfterDisconnectB.lastOpenedTurnId,
    'hook-500',
    'hook invalidation must preserve durable opened markers'
  );
  assert.equal(
    hookAfterDisconnectB.isFocused,
    false,
    'disconnect then reconnect must not resurrect an old active hook turn'
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
