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
const THREAD_D = '66666666-6666-4666-8666-666666666666';
const THREAD_E = '77777777-7777-4777-8777-777777777777';
const THREAD_F = '88888888-8888-4888-8888-888888888888';
const THREAD_G = '99999999-9999-4999-8999-999999999999';
const THREAD_H = 'abababab-abab-4bab-8bab-abababababab';
const DELIVERY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DELIVERY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DELIVERY_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DELIVERY_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INVALID_VERSION_THREAD = '33333333-3333-0333-8333-333333333333';
const INVALID_VARIANT_THREAD = '44444444-4444-4444-7444-444444444444';
const EXTRA_HYPHEN_THREAD = '55555555-5555-4555-8555-55555555555-';
const refreshThreadId = (index) => (
  `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
);

class TestDatabase {
  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
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
    ensureEyesOnAgentsHookDeliverySchema,
    ensureEyesOnAgentsLastUserPromptSchema,
    ensureEyesOnAgentsLegacyImport,
    ensureEyesOnAgentsProjectMetadataSchema,
    ensureEyesOnAgentsSyncPersistenceSchema
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
  ensureEyesOnAgentsSyncPersistenceSchema(repairDb);
  ensureEyesOnAgentsSyncPersistenceSchema(repairDb);
  ensureEyesOnAgentsHookDeliverySchema(repairDb);
  ensureEyesOnAgentsLastUserPromptSchema(repairDb);
  ensureEyesOnAgentsLastUserPromptSchema(repairDb);
  repairDb.prepare(
    `INSERT INTO eyes_on_agents_hook_delivery_receipt (
      delivery_id, thread_id, observed_at, committed_at
    ) VALUES (?, ?, 1, 2)`
  ).run(DELIVERY_A, THREAD_A);
  ensureEyesOnAgentsHookDeliverySchema(repairDb);
  ensureEyesOnAgentsLegacyImport(repairDb);
  ensureEyesOnAgentsLegacyImport(repairDb);
  assert.equal(
    repairDb.prepare(
      "SELECT COUNT(*) AS count FROM eyes_on_agents_domain WHERE domain_key = 'uncategorized' AND is_deleted = 0"
    ).get().count,
    1
  );
  assert.equal(
    repairDb.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_hook_delivery_receipt WHERE delivery_id = ?'
    ).get(DELIVERY_A).count,
    1,
    'an idempotent receipt migration must preserve committed delivery IDs'
  );
  repairDb.close();

  const oldDb = new TestDatabase();
  oldDb.exec(`
    CREATE TABLE eyes_on_agents_thread (
      thread_id TEXT PRIMARY KEY,
      domain_id INTEGER NOT NULL,
      runtime_state TEXT NOT NULL DEFAULT 'unknown',
      last_completed_turn_id TEXT,
      last_completed_at INTEGER,
      last_opened_turn_id TEXT,
      last_opened_at INTEGER,
      last_activity_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO eyes_on_agents_thread (
      thread_id, domain_id, last_completed_turn_id, last_completed_at,
      last_opened_turn_id, last_opened_at
    ) VALUES
      ('${THREAD_A}', 1, 'turn-a', 200, NULL, NULL),
      ('${THREAD_B}', 1, 'turn-b', 200, 'turn-b', 100);
  `);
  ensureEyesOnAgentsProjectMetadataSchema(oldDb);
  ensureEyesOnAgentsProjectMetadataSchema(oldDb);
  ensureEyesOnAgentsArchiveSchema(oldDb);
  ensureEyesOnAgentsArchiveSchema(oldDb);
  ensureEyesOnAgentsSyncPersistenceSchema(oldDb);
  ensureEyesOnAgentsSyncPersistenceSchema(oldDb);
  ensureEyesOnAgentsHookDeliverySchema(oldDb);
  ensureEyesOnAgentsHookDeliverySchema(oldDb);
  ensureEyesOnAgentsLastUserPromptSchema(oldDb);
  ensureEyesOnAgentsLastUserPromptSchema(oldDb);
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
  assert.equal(
    migratedColumns.some((column) => column.name === 'is_unread'),
    true,
    'old databases must receive the persistent unread migration'
  );
  assert.deepEqual(
    migratedColumns
      .map((column) => column.name)
      .filter((name) => name.startsWith('last_user_prompt_')),
    [
      'last_user_prompt_preview',
      'last_user_prompt_turn_id',
      'last_user_prompt_at',
      'last_user_prompt_truncated',
      'last_user_prompt_source',
      'last_user_prompt_checked_at'
    ],
    'old databases must receive the idempotent latest-user-prompt columns migration'
  );
  assert.equal(
    oldDb.prepare('SELECT is_unread FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_A).is_unread,
    1,
    'legacy unseen completion must backfill as unread'
  );
  assert.equal(
    oldDb.prepare('SELECT is_unread FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_B).is_unread,
    0,
    'legacy opened completion must stay read'
  );
  assert.ok(
    oldDb.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'eyes_on_agents_thread_snapshot'"
    ).get(),
    'old databases must receive the raw thread snapshot table'
  );
  assert.deepEqual(
    oldDb.prepare('PRAGMA table_info(eyes_on_agents_hook_delivery_receipt)').all()
      .map((column) => column.name),
    ['delivery_id', 'thread_id', 'observed_at', 'committed_at'],
    'old databases must receive the idempotent hook delivery receipt table'
  );
  oldDb.close();

  const dbPath = join(buildRoot, 'repository.sqlite');
  let db = new TestDatabase(dbPath);
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
  let repository = new EyesOnAgentsRepositoryDao();
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
  await repository.upsertThreadSnapshots({
    snapshots: [
      {
        threadId: THREAD_A,
        payloadJson: JSON.stringify({
          id: THREAD_A,
          name: 'Raw A',
          preview: 'private preview A',
          status: { type: 'notLoaded' },
          turns: []
        }),
        archived: false,
        syncedAt: 101
      },
      {
        threadId: THREAD_C,
        payloadJson: JSON.stringify({
          id: THREAD_C,
          name: 'Stored Hook title',
          preview: `private\n${'preview'.repeat(60)}`,
          turns: []
        }),
        archived: true,
        syncedAt: 101
      }
    ]
  });
  await assert.rejects(
    () => repository.upsertThreadSnapshots({
      snapshots: [{
        threadId: THREAD_A,
        payloadJson: JSON.stringify({ id: THREAD_B }),
        archived: false,
        syncedAt: 101
      }]
    }),
    /must match threadId/
  );
  db.close();
  db = new TestDatabase(dbPath);
  globalThis.__eyesTestSqliteManager.db = db;
  repository = new EyesOnAgentsRepositoryDao();
  const persistedRawA = db.prepare(
    'SELECT payload_json, is_archived, synced_at FROM eyes_on_agents_thread_snapshot WHERE thread_id = ?'
  ).get(THREAD_A);
  assert.deepEqual(JSON.parse(persistedRawA.payload_json), {
    id: THREAD_A,
    name: 'Raw A',
    preview: 'private preview A',
    status: { type: 'notLoaded' },
    turns: []
  }, 'the complete thread/list object must survive a SQLite restart');
  assert.equal(persistedRawA.is_archived, 0);
  assert.equal(persistedRawA.synced_at, 101);
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).domainId,
    custom.id,
    'raw source persistence must not overwrite the Bitterless Domain annotation'
  );
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

  const hookCreateResult = await repository.applyRuntimeEvent({
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
  assert.deepEqual(hookCreateResult, { created: true, titleMissing: false });
  assert.equal(
    hookCreated.title,
    'Stored Hook title',
    'a Hook-first row must restore its name-first title from the raw snapshot transaction'
  );
  assert.equal(hookCreated.projectKey, '/repo/hook', 'hook-created rows must persist Project metadata');
  assert.equal(
    hookCreated.domainId,
    snapshot.domains.find((domain) => domain.domainKey === 'uncategorized').id
  );
  db.prepare(
    `INSERT INTO eyes_on_agents_thread_snapshot (
      thread_id, payload_json, is_archived, synced_at, created_at, updated_at
    ) VALUES (?, ?, 0, 180, 180, 180)`
  ).run(THREAD_H, '{malformed-json');
  const corruptSnapshotResult = await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_H,
      turnId: 'corrupt-snapshot-runtime',
      observedAt: 190,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    corruptSnapshotResult,
    { created: true, titleMissing: true },
    'a corrupt optional raw snapshot must not roll back lifecycle persistence'
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT title, runtime_state FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(THREAD_H) },
    { title: null, runtime_state: 'working' }
  );
  await repository.setThreadArchived({
    threadId: THREAD_H,
    archived: true,
    observedAt: 191
  });
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
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).isUnread,
    true,
    'a running event must set unread'
  );
  await repository.markOpened({ threadId: THREAD_A, openedAt: 210 });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).isUnread,
    false,
    'a successful Open must clear unread'
  );
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: THREAD_A,
      title: 'Still running',
      cwd: '/repo/new-a',
      runtimeState: 'working',
      activeFlags: [],
      statusSource: 'app_server',
      statusObservedAt: 215,
      lastActivityAt: 215
    }]
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_A).isUnread,
    true,
    'a later thread/list running observation must set unread again'
  );
  await repository.markOpened({ threadId: THREAD_A, openedAt: 216 });
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
  assert.equal(completedA.isUnread, true, 'completion must become unread after an active Open');
  assert.equal(completedA.isFocused, true);

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
      last_opened_turn_id, last_opened_at, is_unread
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
  assert.equal(archivedA.last_opened_at, 216);
  assert.equal(archivedA.is_unread, 1, 'archive must preserve persistent unread state');
  assert.equal(
    db.prepare('SELECT is_archived FROM eyes_on_agents_thread_snapshot WHERE thread_id = ?')
      .get(THREAD_A).is_archived,
    1,
    'archive notification persistence must update the raw snapshot inventory marker'
  );

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
  assert.equal(
    db.prepare('SELECT is_archived FROM eyes_on_agents_thread_snapshot WHERE thread_id = ?')
      .get(THREAD_A).is_archived,
    0,
    'unarchive notification persistence must update the raw snapshot inventory marker'
  );

  await repository.markThreadsArchived({ threadIds: [THREAD_A, THREAD_A], observedAt: 270 });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.some((thread) => thread.threadId === THREAD_A),
    false,
    'archived inventory reconciliation must hide every explicit archived id'
  );
  assert.equal(
    db.prepare('SELECT is_archived FROM eyes_on_agents_thread_snapshot WHERE thread_id = ?')
      .get(THREAD_A).is_archived,
    1,
    'archived inventory reconciliation must update the raw snapshot marker'
  );
  await repository.upsertThreadSnapshots({
    snapshots: [{
      threadId: THREAD_A,
      payloadJson: JSON.stringify({ id: THREAD_A, name: 'Active after unarchive', turns: [] }),
      archived: false,
      syncedAt: 280
    }]
  });
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
  assert.equal(
    db.prepare('SELECT is_archived FROM eyes_on_agents_thread_snapshot WHERE thread_id = ?')
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
    true,
    'runtime invalidation must preserve the unread attention raised by observed work'
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
  assert.equal(notLoadedB.runtimeState, 'unknown', 'server B notLoaded must clear server A working state');
  assert.equal(notLoadedB.isUnread, true, 'unknown discovery must preserve persistent unread');

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

  await assert.rejects(
    () => repository.applyRuntimeEvent({
      event: {
        type: 'thread_status',
        threadId: THREAD_G,
        runtimeState: 'working',
        activeFlags: [],
        observedAt: 1_099,
        source: 'codex_hook'
      },
      hookLastUserPrompt: { preview: 'invalid event pairing', truncated: false }
    }),
    /requires a codex_hook turn_started event/
  );
  await assert.rejects(
    () => repository.applyRuntimeEvent({
      event: {
        type: 'turn_started',
        threadId: THREAD_G,
        turnId: 'invalid-unicode-turn',
        observedAt: 1_099,
        source: 'codex_hook'
      },
      hookLastUserPrompt: { preview: '\ud800', truncated: false }
    }),
    /forbidden character/
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_G,
      turnId: 'prompt-turn-a',
      observedAt: 1_100,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Newest Hook question', truncated: false }
  });
  snapshot = await repository.getSnapshot();
  assert.deepEqual(
    snapshot.threads.find((thread) => thread.threadId === THREAD_G).lastUserPrompt,
    {
      state: 'available',
      preview: 'Newest Hook question',
      turnId: 'prompt-turn-a',
      observedAt: new Date(1_100).toISOString(),
      checkedAt: null,
      truncated: false
    }
  );
  db.prepare(
    'UPDATE eyes_on_agents_thread SET last_user_prompt_checked_at = ? WHERE thread_id = ?'
  ).run(1_150, THREAD_G);
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_G,
      turnId: 'equal-time-turn',
      observedAt: 1_100,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Equal time must lose', truncated: false }
  });
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_G,
      turnId: 'older-turn',
      observedAt: 1_050,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Older must lose', truncated: false }
  });
  let promptRow = db.prepare(
    `SELECT last_user_prompt_preview, last_user_prompt_turn_id,
      last_user_prompt_at, last_user_prompt_checked_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_G);
  assert.deepEqual({ ...promptRow }, {
    last_user_prompt_preview: 'Newest Hook question',
    last_user_prompt_turn_id: 'prompt-turn-a',
    last_user_prompt_at: 1_100,
    last_user_prompt_checked_at: 1_150
  }, 'equal and older Hook candidates must preserve every newer prompt field');

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_G,
      turnId: 'prompt-turn-b',
      observedAt: 1_200,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: null, truncated: false }
  });
  snapshot = await repository.getSnapshot();
  assert.deepEqual(
    snapshot.threads.find((thread) => thread.threadId === THREAD_G).lastUserPrompt,
    {
      state: 'pending',
      preview: null,
      turnId: 'prompt-turn-b',
      observedAt: new Date(1_200).toISOString(),
      checkedAt: null,
      truncated: false
    },
    'a newer metadata-only Hook event must clear an older preview and trigger recovery'
  );
  await repository.refreshThreadPage({
    threads: [{
      threadId: THREAD_G,
      lastUserPrompt: {
        preview: 'Recovered question',
        turnId: 'prompt-turn-b',
        observedAt: 1_200,
        checkedAt: 1_250,
        truncated: false,
        source: 'app_server'
      }
    }]
  });
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === THREAD_G).lastUserPrompt.preview,
    'Recovered question',
    'App Server may fill the same non-null Hook-owned pending turn'
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_G,
      turnId: 'prompt-turn-c',
      observedAt: 1_300,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Later Hook question', truncated: true }
  });
  promptRow = db.prepare(
    `SELECT last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_truncated, last_user_prompt_source, last_user_prompt_checked_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_G);
  assert.deepEqual({ ...promptRow }, {
    last_user_prompt_preview: 'Later Hook question',
    last_user_prompt_turn_id: 'prompt-turn-c',
    last_user_prompt_at: 1_300,
    last_user_prompt_truncated: 1,
    last_user_prompt_source: 'codex_hook',
    last_user_prompt_checked_at: null
  }, 'an accepted newer Hook candidate must replace atomically and clear the recovery watermark');
  await repository.refreshThreadPage({
    threads: [{
      threadId: THREAD_G,
      lastUserPrompt: {
        preview: 'Same-turn App Server must not replace Hook',
        turnId: 'prompt-turn-c',
        observedAt: 1_400,
        checkedAt: 1_450,
        truncated: false,
        source: 'app_server'
      }
    }]
  });
  promptRow = db.prepare(
    `SELECT last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_source, last_user_prompt_checked_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_G);
  assert.deepEqual({ ...promptRow }, {
    last_user_prompt_preview: 'Later Hook question',
    last_user_prompt_turn_id: 'prompt-turn-c',
    last_user_prompt_at: 1_300,
    last_user_prompt_source: 'codex_hook',
    last_user_prompt_checked_at: 1_450
  }, 'same-turn App Server recovery must preserve an available Hook prompt and only advance its watermark');
  await repository.setThreadArchived({
    threadId: THREAD_G,
    archived: true,
    observedAt: 1_310
  });
  assert.equal(
    db.prepare(
      'SELECT last_user_prompt_preview FROM eyes_on_agents_thread WHERE thread_id = ?'
    ).get(THREAD_G).last_user_prompt_preview,
    'Later Hook question',
    'archive transitions must preserve the retained prompt'
  );
  assert.deepEqual(
    await repository.enrichMissingThreadTitle({
      threadId: THREAD_G,
      title: 'Must not revive archived title'
    }),
    { changed: false },
    'targeted title repair must never mutate an archived row'
  );

  await assert.rejects(
    () => repository.applyRuntimeEventDelivery({
      deliveryId: DELIVERY_C,
      event: {
        type: 'turn_started',
        threadId: THREAD_D,
        turnId: 'wrong-source',
        observedAt: 799,
        source: 'app_server'
      }
    }),
    /source must be codex_hook/
  );

  const firstDelivery = await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_A,
    event: {
      type: 'turn_started',
      threadId: THREAD_D,
      turnId: 'delivery-turn',
      observedAt: 800,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Delivered question', truncated: false }
  });
  assert.deepEqual(firstDelivery, {
    duplicate: false,
    created: true,
    titleMissing: true
  });
  const receipt = db.prepare(
    `SELECT delivery_id, thread_id, observed_at, committed_at,
      typeof(observed_at) AS observed_at_type,
      typeof(committed_at) AS committed_at_type
     FROM eyes_on_agents_hook_delivery_receipt WHERE delivery_id = ?`
  ).get(DELIVERY_A);
  assert.equal(receipt.thread_id, THREAD_D);
  assert.equal(receipt.observed_at, 800);
  assert.equal(receipt.observed_at_type, 'integer');
  assert.equal(receipt.committed_at_type, 'integer');
  assert.equal(
    db.prepare('SELECT runtime_state FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_D).runtime_state,
    'working',
    'a fresh delivery must apply its event in the receipt transaction'
  );
  assert.equal(
    db.prepare(
      'SELECT last_user_prompt_preview FROM eyes_on_agents_thread WHERE thread_id = ?'
    ).get(THREAD_D).last_user_prompt_preview,
    'Delivered question',
    'a fresh delivery must apply its prompt candidate in the receipt transaction'
  );
  assert.deepEqual(
    await repository.enrichMissingThreadTitle({
      threadId: THREAD_D,
      title: 'Targeted delivery title'
    }),
    { changed: true }
  );
  assert.deepEqual(
    await repository.enrichMissingThreadTitle({
      threadId: THREAD_D,
      title: 'Stale replacement title'
    }),
    { changed: false },
    'title enrichment must compare-and-set NULL and never overwrite a newer title'
  );
  assert.equal(
    db.prepare('SELECT title FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_D).title,
    'Targeted delivery title'
  );

  db.close();
  db = new TestDatabase(dbPath);
  globalThis.__eyesTestSqliteManager.db = db;
  repository = new EyesOnAgentsRepositoryDao();
  const replayedDelivery = await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_A,
    event: {
      type: 'turn_completed',
      threadId: THREAD_D,
      turnId: 'delivery-turn',
      outcome: 'completed',
      observedAt: 900,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(replayedDelivery, {
    duplicate: true,
    created: false,
    titleMissing: false
  });
  const replayedThread = db.prepare(
    `SELECT runtime_state, last_completed_at, last_user_prompt_preview
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_D);
  assert.equal(replayedThread.runtime_state, 'working');
  assert.equal(
    replayedThread.last_completed_at,
    null,
    'a persisted receipt must dedupe replay after a repository and SQLite restart'
  );
  assert.equal(
    replayedThread.last_user_prompt_preview,
    'Delivered question',
    'a duplicate receipt must not reapply or clear prompt state'
  );

  db.exec(`
    CREATE TRIGGER abort_eyes_hook_delivery_event
    BEFORE INSERT ON eyes_on_agents_thread
    WHEN NEW.thread_id = '${THREAD_E}'
    BEGIN
      SELECT RAISE(ABORT, 'injected hook delivery failure');
    END;
  `);
  const failedDeliveryEvent = {
    type: 'turn_started',
    threadId: THREAD_E,
    turnId: 'failed-delivery-turn',
    observedAt: 1000,
    source: 'codex_hook'
  };
  await assert.rejects(
    () => repository.applyRuntimeEventDelivery({
      deliveryId: DELIVERY_B,
      event: failedDeliveryEvent
    }),
    /injected hook delivery failure/
  );
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_hook_delivery_receipt WHERE delivery_id = ?'
    ).get(DELIVERY_B).count,
    0,
    'an event failure must roll back the delivery receipt'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_E).count,
    0,
    'an event failure must roll back the event application'
  );
  db.exec('DROP TRIGGER abort_eyes_hook_delivery_event;');
  assert.deepEqual(
    await repository.applyRuntimeEventDelivery({
      deliveryId: DELIVERY_B,
      event: failedDeliveryEvent
    }),
    { duplicate: false, created: true, titleMissing: true },
    'a rolled-back delivery ID must remain retryable'
  );
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_hook_delivery_receipt WHERE delivery_id = ?'
    ).get(DELIVERY_B).count,
    1
  );
  assert.equal(
    db.prepare('SELECT runtime_state FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_E).runtime_state,
    'working'
  );

  db.exec(`
    CREATE TRIGGER abort_eyes_hook_prompt_update
    BEFORE UPDATE OF last_user_prompt_preview ON eyes_on_agents_thread
    WHEN NEW.thread_id = '${THREAD_F}'
    BEGIN
      SELECT RAISE(ABORT, 'injected hook prompt failure');
    END;
  `);
  const failedPromptDelivery = {
    deliveryId: DELIVERY_D,
    event: {
      type: 'turn_started',
      threadId: THREAD_F,
      turnId: 'failed-prompt-turn',
      observedAt: 1_100,
      source: 'codex_hook'
    },
    hookLastUserPrompt: { preview: 'Must roll back', truncated: false }
  };
  await assert.rejects(
    () => repository.applyRuntimeEventDelivery(failedPromptDelivery),
    /injected hook prompt failure/
  );
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_hook_delivery_receipt WHERE delivery_id = ?'
    ).get(DELIVERY_D).count,
    0,
    'a prompt mutation failure must roll back the delivery receipt'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(THREAD_F).count,
    0,
    'a prompt mutation failure must roll back the lifecycle insert'
  );
  db.exec('DROP TRIGGER abort_eyes_hook_prompt_update;');
  assert.deepEqual(
    await repository.applyRuntimeEventDelivery(failedPromptDelivery),
    { duplicate: false, created: true, titleMissing: true },
    'a prompt-rolled-back delivery must remain retryable'
  );
  assert.equal(
    db.prepare(
      'SELECT last_user_prompt_preview FROM eyes_on_agents_thread WHERE thread_id = ?'
    ).get(THREAD_F).last_user_prompt_preview,
    'Must roll back'
  );

  db.close();
  db = new TestDatabase();
  db.exec(eyesOnAgentsTable.createSql);
  globalThis.__eyesTestSqliteManager.db = db;
  repository = new EyesOnAgentsRepositoryDao();
  const refreshDomainId = db.prepare(
    "SELECT id FROM eyes_on_agents_domain WHERE domain_key = 'uncategorized'"
  ).get().id;
  const insertRefreshThread = db.prepare(
    `INSERT INTO eyes_on_agents_thread (
      thread_id, domain_id, title, is_archived, last_activity_at,
      last_user_prompt_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 1; index <= 86; index += 1) {
    const tiedHotActivity = index === 84 || index === 85;
    insertRefreshThread.run(
      refreshThreadId(index),
      refreshDomainId,
      `Refresh ${index}`,
      index === 86 ? 1 : 0,
      tiedHotActivity ? 10_000 : index,
      index,
      index,
      tiedHotActivity ? 10_000 : index
    );
  }
  const selectedThirdPage = await repository.getThreadRefreshPages({
    coldPage: 3,
    previousPageCount: null
  });
  await assert.rejects(
    () => repository.getThreadRefreshPages({ coldPage: 2, previousPageCount: -1 }),
    /pagination is invalid/
  );
  assert.equal(selectedThirdPage.pageCount, 3);
  assert.equal(selectedThirdPage.hot.length, 40);
  assert.equal(selectedThirdPage.cold.length, 5);
  assert.equal(selectedThirdPage.coldPage, 3);
  assert.deepEqual(
    selectedThirdPage.hot.slice(0, 2).map((thread) => thread.threadId),
    [refreshThreadId(84), refreshThreadId(85)],
    'equal recency must use thread_id ASC as the deterministic final key'
  );
  assert.equal(
    [...selectedThirdPage.hot, ...selectedThirdPage.cold]
      .some((thread) => thread.threadId === refreshThreadId(86)),
    false,
    'archived rows must never enter tiered refresh pages'
  );
  assert.equal(
    new Set(selectedThirdPage.hot.map((thread) => thread.threadId)).size,
    selectedThirdPage.hot.length,
    'one refresh batch must contain unique rows'
  );
  assert.equal(
    selectedThirdPage.hot.some(
      (hot) => selectedThirdPage.cold.some((cold) => cold.threadId === hot.threadId)
    ),
    false,
    'the atomically selected hot and cold pages must not overlap'
  );
  assert.equal(
    selectedThirdPage.hot[0].lastUserPromptCheckedAt,
    84,
    'refresh candidates must carry their persisted prompt recovery watermark'
  );
  const shrinkResetWithinRange = await repository.getThreadRefreshPages({
    coldPage: 3,
    previousPageCount: 4
  });
  assert.equal(shrinkResetWithinRange.pageCount, 3);
  assert.equal(
    shrinkResetWithinRange.coldPage,
    2,
    'any page-count shrink must reset to page 2 even when the old cursor remains in range'
  );
  for (const candidate of selectedThirdPage.cold) {
    db.prepare(
      'UPDATE eyes_on_agents_thread SET is_archived = 1 WHERE thread_id = ?'
    ).run(candidate.threadId);
  }
  const resetColdPage = await repository.getThreadRefreshPages({
    coldPage: 3,
    previousPageCount: selectedThirdPage.pageCount
  });
  assert.equal(resetColdPage.pageCount, 2);
  assert.equal(resetColdPage.coldPage, 2, 'a cold cursor beyond a shrunken page count must reset');
  assert.equal(resetColdPage.cold.length, 40);

  const refreshTargetId = selectedThirdPage.hot[0].threadId;
  const refreshTargetBefore = db.prepare(
    `SELECT title, runtime_state, is_unread, last_activity_at, updated_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        title: refreshTargetBefore.title,
        lastActivityAt: refreshTargetBefore.last_activity_at - 1
      }]
    }),
    { changed: false },
    'equal fields and an older activity watermark must perform no write'
  );
  assert.equal(
    db.prepare('SELECT updated_at FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(refreshTargetId).updated_at,
    refreshTargetBefore.updated_at
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        title: 'Refresh title changed',
        lastActivityAt: 20_000,
        status: {
          runtimeState: 'working',
          activeFlags: [],
          source: 'app_server',
          observedAt: 20_000
        },
        lastUserPrompt: {
          preview: 'Refresh-page latest question',
          turnId: 'refresh-turn',
          observedAt: 19_500,
          checkedAt: 20_000,
          truncated: false,
          source: 'app_server'
        }
      }]
    }),
    { changed: true }
  );
  let refreshTarget = db.prepare(
    `SELECT title, runtime_state, is_unread, last_activity_at,
      last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_checked_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual({ ...refreshTarget }, {
    title: 'Refresh title changed',
    runtime_state: 'working',
    is_unread: 1,
    last_activity_at: 20_000,
    last_user_prompt_preview: 'Refresh-page latest question',
    last_user_prompt_turn_id: 'refresh-turn',
    last_user_prompt_at: 19_500,
    last_user_prompt_checked_at: 20_000
  });
  await repository.refreshThreadPage({
    threads: [{
      threadId: refreshTargetId,
      lastActivityAt: 19_999,
      status: {
        runtimeState: 'idle',
        activeFlags: [],
        activeTurnId: null,
        source: 'app_server',
        observedAt: 20_001
      }
    }]
  });
  refreshTarget = db.prepare(
    `SELECT runtime_state, is_unread, last_activity_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual({ ...refreshTarget }, {
    runtime_state: 'idle',
    is_unread: 1,
    last_activity_at: 20_000
  }, 'idle must preserve unread and activity must advance monotonically');
  const beforeUnknownStatus = db.prepare(
    `SELECT runtime_state, status_observed_at, updated_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        status: {
          runtimeState: 'unknown',
          activeFlags: [],
          source: 'app_server',
          observedAt: 30_000
        },
        lastUserPrompt: {
          preview: 'Refresh-page latest question',
          turnId: 'refresh-turn',
          observedAt: 19_500,
          checkedAt: 20_000,
          truncated: false,
          source: 'app_server'
        }
      }]
    }),
    { changed: false },
    'unknown status and identical prompt fields must be a semantic no-op'
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_observed_at, updated_at
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(refreshTargetId) },
    { ...beforeUnknownStatus },
    'unknown provider evidence must not overwrite stronger idle state or touch updated_at'
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'thread_status',
      threadId: refreshTargetId,
      runtimeState: 'working',
      activeFlags: [],
      observedAt: 40_000,
      source: 'app_server'
    }
  });
  const equalWatermarkLifecycleRow = db.prepare(
    `SELECT runtime_state, status_observed_at, is_unread, updated_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual(
    { ...equalWatermarkLifecycleRow },
    {
      runtime_state: 'working',
      status_observed_at: 40_000,
      is_unread: 1,
      updated_at: equalWatermarkLifecycleRow.updated_at
    }
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        status: {
          runtimeState: 'idle',
          activeFlags: [],
          activeTurnId: null,
          source: 'app_server',
          observedAt: 40_000
        }
      }]
    }),
    { changed: false },
    'an old read with the same millisecond watermark as lifecycle evidence must be rejected'
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_observed_at, is_unread, updated_at
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(refreshTargetId) },
    { ...equalWatermarkLifecycleRow },
    'equal-ms rejection must preserve working state, watermark, unread, and updated_at'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        status: {
          runtimeState: 'idle',
          activeFlags: [],
          activeTurnId: null,
          source: 'app_server',
          observedAt: 30_000
        }
      }]
    }),
    { changed: false },
    'a thread/read patch with an older request watermark must be rejected'
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_observed_at, is_unread
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(refreshTargetId) },
    { runtime_state: 'working', status_observed_at: 40_000, is_unread: 1 },
    'a newer lifecycle notification must remain authoritative over an older read response'
  );
  const promotedHotPage = await repository.getThreadRefreshPages({
    coldPage: 2,
    previousPageCount: resetColdPage.pageCount
  });
  assert.equal(
    promotedHotPage.hot[0].threadId,
    refreshTargetId,
    'a monotonically newer provider activity watermark must promote the row into page 1'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{ threadId: refreshThreadId(999), title: 'Missing' }]
    }),
    { changed: false },
    'a missing row must be skipped'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: selectedThirdPage.cold[0].threadId,
        title: 'Archived after selection must skip'
      }]
    }),
    { changed: false },
    'a row archived after frozen selection must be skipped'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [
        { threadId: refreshThreadId(999), title: 'Missing in mixed batch' },
        {
          threadId: selectedThirdPage.cold[0].threadId,
          title: 'Archived in mixed batch'
        },
        { threadId: refreshTargetId, title: 'Valid row survives skipped siblings' }
      ]
    }),
    { changed: true },
    'missing and archived rows must not roll back a valid sibling patch'
  );
  assert.equal(
    db.prepare('SELECT title FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(refreshTargetId).title,
    'Valid row survives skipped siblings'
  );
  await assert.rejects(
    () => repository.refreshThreadPage({
      threads: Array.from({ length: 41 }, (_, index) => ({
        threadId: refreshThreadId(index + 200),
        title: `Oversized ${index}`
      }))
    }),
    /must not exceed 40/
  );
  await assert.rejects(
    () => repository.refreshThreadPage({
      threads: [
        { threadId: refreshTargetId, title: 'Duplicate A' },
        { threadId: refreshTargetId, title: 'Duplicate B' }
      ]
    }),
    /unique threadIds/
  );

  const readAllIdleId = resetColdPage.hot[3].threadId;
  const readAllWorkingId = refreshTargetId;
  const readAllWaitingApprovalId = resetColdPage.hot[1].threadId;
  const readAllWaitingInputId = resetColdPage.hot[2].threadId;
  const readAllArchivedId = selectedThirdPage.cold[0].threadId;
  assert.equal(
    new Set([
      readAllIdleId,
      readAllWorkingId,
      readAllWaitingApprovalId,
      readAllWaitingInputId,
      readAllArchivedId
    ]).size,
    5,
    'Read all fixture threads must be distinct'
  );
  const seedReadAllRow = db.prepare(
    `UPDATE eyes_on_agents_thread SET
      is_archived = ?, runtime_state = ?, is_unread = 1,
      last_opened_turn_id = ?, last_opened_at = ?, updated_at = ?
     WHERE thread_id = ?`
  );
  const readAllFixtures = [
    [0, 'idle', 'opened-idle', 50_001, 51_001, readAllIdleId],
    [0, 'working', 'opened-working', 50_002, 51_002, readAllWorkingId],
    [0, 'waiting_approval', 'opened-approval', 50_003, 51_003, readAllWaitingApprovalId],
    [0, 'waiting_input', 'opened-input', 50_004, 51_004, readAllWaitingInputId],
    [1, 'idle', 'opened-archived', 50_005, 51_005, readAllArchivedId]
  ];
  for (const fixture of readAllFixtures) {
    assert.equal(seedReadAllRow.run(...fixture).changes, 1);
  }
  assert.deepEqual(
    await repository.markAllRead(),
    { changed: true },
    'Read all must report when it clears an eligible unread row'
  );
  const readAllRows = new Map(
    db.prepare(
      `SELECT thread_id, is_archived, runtime_state, is_unread,
        last_opened_turn_id, last_opened_at, updated_at
       FROM eyes_on_agents_thread
       WHERE thread_id IN (?, ?, ?, ?, ?)`
    ).all(
      readAllIdleId,
      readAllWorkingId,
      readAllWaitingApprovalId,
      readAllWaitingInputId,
      readAllArchivedId
    ).map((row) => [row.thread_id, row])
  );
  assert.deepEqual(
    { ...readAllRows.get(readAllIdleId) },
    {
      thread_id: readAllIdleId,
      is_archived: 0,
      runtime_state: 'idle',
      is_unread: 0,
      last_opened_turn_id: 'opened-idle',
      last_opened_at: 50_001,
      updated_at: 51_001
    },
    'Read all must clear only unread state without changing Open evidence or activity ordering'
  );
  for (const threadId of [
    readAllWorkingId,
    readAllWaitingApprovalId,
    readAllWaitingInputId
  ]) {
    assert.equal(
      readAllRows.get(threadId).is_unread,
      1,
      'Read all must preserve unread state while a thread still requires active attention'
    );
  }
  assert.equal(readAllRows.get(readAllArchivedId).is_archived, 1);
  assert.equal(
    readAllRows.get(readAllArchivedId).is_unread,
    1,
    'Read all must not mutate archived unread rows'
  );
  assert.deepEqual(
    await repository.markAllRead(),
    { changed: false },
    'repeating Read all without another eligible unread row must be a no-op'
  );

  db.close();
  console.log('EyesOnAgents repository tests passed');
} finally {
  delete globalThis.__eyesTestSqliteManager;
  rmSync(buildRoot, { recursive: true, force: true });
}
