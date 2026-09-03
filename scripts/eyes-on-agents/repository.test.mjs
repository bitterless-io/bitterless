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
const DELIVERY_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DELIVERY_F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const DELIVERY_G = '12121212-1212-4212-8212-121212121212';
const DELIVERY_H = '13131313-1313-4313-8313-131313131313';
const DELIVERY_I = '14141414-1414-4414-8414-141414141414';
const DELIVERY_CLAUDE = '15151515-1515-4515-8515-151515151515';
const THREAD_CLAUDE_PROMPT = '17171717-1717-4717-8717-171717171717';
const codexKey = (threadId) => `codex:${threadId}`;
const claudeKey = (threadId) => `claude:${threadId}`;
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
    ensureEyesOnAgentsClaudeConfigDirSchema,
    ensureEyesOnAgentsClaudeDeletionSchema,
    ensureEyesOnAgentsCompletionAlertSchema,
    ensureEyesOnAgentsHookDeliverySchema,
    ensureEyesOnAgentsIterm2SessionSchema,
    ensureEyesOnAgentsLastUserPromptSchema,
    ensureEyesOnAgentsLegacyImport,
    ensureEyesOnAgentsProjectMetadataSchema,
    ensureEyesOnAgentsSyncPersistenceSchema,
    migrateEyesOnAgentsCompletionAlertSchema,
    migrateEyesOnAgentsProviderIdentitySchema
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
  ensureEyesOnAgentsCompletionAlertSchema(repairDb);
  ensureEyesOnAgentsCompletionAlertSchema(repairDb);
  ensureEyesOnAgentsLastUserPromptSchema(repairDb);
  ensureEyesOnAgentsLastUserPromptSchema(repairDb);
  ensureEyesOnAgentsClaudeDeletionSchema(repairDb);
  ensureEyesOnAgentsClaudeDeletionSchema(repairDb);
  ensureEyesOnAgentsIterm2SessionSchema(repairDb);
  ensureEyesOnAgentsIterm2SessionSchema(repairDb);
  ensureEyesOnAgentsClaudeConfigDirSchema(repairDb);
  ensureEyesOnAgentsClaudeConfigDirSchema(repairDb);
  repairDb.prepare(
    `INSERT INTO eyes_on_agents_hook_delivery_receipt (
      delivery_id, session_key, provider, thread_id, observed_at, committed_at
    ) VALUES (?, ?, 'codex', ?, 1, 2)`
  ).run(DELIVERY_A, codexKey(THREAD_A), THREAD_A);
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
    CREATE TABLE eyes_on_agents_domain (
      id INTEGER PRIMARY KEY,
      domain_key TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      delete_flag TEXT NOT NULL DEFAULT '0',
      deleted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO eyes_on_agents_domain (id, domain_key, title)
      VALUES (1, 'uncategorized', 'Uncategorized');
    CREATE TABLE eyes_on_agents_thread (
      thread_id TEXT PRIMARY KEY,
      domain_id INTEGER NOT NULL,
      title TEXT,
      cwd TEXT,
      runtime_state TEXT NOT NULL DEFAULT 'unknown',
      active_flags_json TEXT NOT NULL DEFAULT '[]',
      active_turn_id TEXT,
      last_completed_turn_id TEXT,
      last_completed_at INTEGER,
      last_opened_turn_id TEXT,
      last_opened_at INTEGER,
      status_source TEXT NOT NULL DEFAULT 'discovery',
      status_observed_at INTEGER,
      last_activity_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0,
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
  migrateEyesOnAgentsCompletionAlertSchema(oldDb);
  migrateEyesOnAgentsCompletionAlertSchema(oldDb);
  ensureEyesOnAgentsLastUserPromptSchema(oldDb);
  ensureEyesOnAgentsLastUserPromptSchema(oldDb);
  migrateEyesOnAgentsProviderIdentitySchema(oldDb);
  migrateEyesOnAgentsProviderIdentitySchema(oldDb);
  ensureEyesOnAgentsClaudeDeletionSchema(oldDb);
  ensureEyesOnAgentsClaudeDeletionSchema(oldDb);
  ensureEyesOnAgentsIterm2SessionSchema(oldDb);
  ensureEyesOnAgentsIterm2SessionSchema(oldDb);
  ensureEyesOnAgentsClaudeConfigDirSchema(oldDb);
  ensureEyesOnAgentsClaudeConfigDirSchema(oldDb);
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
  assert.equal(
    migratedColumns.some((column) => column.name === 'is_deleted'),
    true,
    'old databases must receive the idempotent Claude deletion projection column'
  );
  assert.equal(
    migratedColumns.some((column) => column.name === 'iterm2_session_id'),
    true,
    'old databases must receive the idempotent iterm2_session_id column'
  );
  assert.equal(
    migratedColumns.some((column) => column.name === 'claude_config_dir'),
    true,
    'old databases must receive the idempotent claude_config_dir column'
  );
  assert.ok(
    oldDb.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'eyes_on_agents_claude_deletion_tombstone'"
    ).get(),
    'old databases must receive the Main-private Claude tombstone table'
  );
  assert.deepEqual(
    migratedColumns.slice(0, 3).map((column) => column.name),
    ['session_key', 'provider', 'thread_id'],
    'retained provider-blind databases must rebuild around provider-qualified identity'
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
      .map((column) => column.name)
      .sort(),
    [
      'committed_at',
      'delivery_id',
      'is_observation_eligible',
      'observed_at',
      'provider',
      'session_key',
      'thread_id'
    ],
    'old databases must receive the idempotent hook delivery receipt table'
  );
  assert.deepEqual(
    oldDb.prepare(
      `SELECT session_key, provider, thread_id, turn_id
       FROM eyes_on_agents_completion_alert_receipt ORDER BY thread_id`
    ).all().map((row) => ({ ...row })),
    [
      { session_key: codexKey(THREAD_A), provider: 'codex', thread_id: THREAD_A, turn_id: 'turn-a' },
      { session_key: codexKey(THREAD_B), provider: 'codex', thread_id: THREAD_B, turn_id: 'turn-b' }
    ],
    'the versioned completion-alert migration must seed every current historical completion'
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
  migrateEyesOnAgentsProviderIdentitySchema(db);
  migrateEyesOnAgentsProviderIdentitySchema(db);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM eyes_on_agents_thread').get().count,
    2,
    'provider migration must preserve Codex and import active legacy Claude idempotently'
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
  snapshot = await repository.getSnapshot();
  assert.deepEqual(
    snapshot.threads
      .filter((thread) => thread.threadId === THREAD_B)
      .map((thread) => ({ sessionKey: thread.sessionKey, provider: thread.provider }))
      .sort((left, right) => left.provider.localeCompare(right.provider)),
    [
      { sessionKey: claudeKey(THREAD_B), provider: 'claude' },
      { sessionKey: codexKey(THREAD_B), provider: 'codex' }
    ],
    'provider-qualified identity must allow the same UUID without row collision'
  );
  db.prepare("DELETE FROM eyes_on_agents_thread WHERE provider = 'claude'").run();
  await repository.createDomain({ title: 'Bitterless' });
  snapshot = await repository.getSnapshot();
  const custom = snapshot.domains.find((domain) => domain.title === 'Bitterless');
  assert.ok(custom);
  await repository.moveThread({ sessionKey: codexKey(THREAD_A), domainId: custom.id });
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
  assert.deepEqual(hookCreateResult, {
    created: true,
    titleMissing: false,
    completionAlert: null
  });
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
      session_key, provider, thread_id, payload_json, is_archived,
      synced_at, created_at, updated_at
    ) VALUES (?, 'codex', ?, ?, 0, 180, 180, 180)`
  ).run(codexKey(THREAD_H), THREAD_H, '{malformed-json');
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
    { created: true, titleMissing: true, completionAlert: null },
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
  await repository.markOpened({ sessionKey: codexKey(THREAD_A), openedAt: 210 });
  snapshot = await repository.getSnapshot();
  const openedRunningA = snapshot.threads.find((thread) => thread.threadId === THREAD_A);
  assert.equal(
    openedRunningA.isUnread,
    true,
    'Open must not acknowledge a task that is still running'
  );
  assert.equal(
    openedRunningA.isFocused,
    true,
    'a running task must stay in Focus after Open'
  );
  assert.equal(
    openedRunningA.lastOpenedTurnId,
    'hook-200',
    'Open must still record deep-link evidence for a running task'
  );
  assert.equal(openedRunningA.lastOpenedAt, new Date(210).toISOString());
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
    'a later thread/list running observation must keep unread attention'
  );
  await repository.markOpened({ sessionKey: codexKey(THREAD_A), openedAt: 216 });
  const syntheticCompletion = await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: null,
      outcome: 'completed',
      observedAt: 220,
      source: 'codex_hook'
    }
  });
  assert.equal(
    syntheticCompletion.completionAlert,
    null,
    'a synthetic Hook fallback identity must fail closed for completion alerts'
  );
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
  const completedTurnB = await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: 'turn-b',
      outcome: 'completed',
      observedAt: 240,
      source: 'app_server'
    }
  });
  assert.deepEqual(completedTurnB.completionAlert, {
    sessionKey: codexKey(THREAD_A),
    provider: 'codex',
    threadId: THREAD_A,
    turnId: 'turn-b',
    title: 'Still running'
  });
  const duplicateTurnB = await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: 'turn-b',
      outcome: 'completed',
      observedAt: 240,
      source: 'app_server'
    }
  });
  assert.equal(
    duplicateTurnB.completionAlert,
    null,
    'the durable thread/turn receipt must suppress repeated completion evidence'
  );
  const hookRaceTurnB = await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_I,
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: 'turn-b',
      outcome: 'completed',
      observedAt: 240,
      source: 'codex_hook'
    }
  });
  assert.equal(hookRaceTurnB.duplicate, false);
  assert.equal(
    hookRaceTurnB.completionAlert,
    null,
    'a later Hook delivery for the App Server-claimed turn must not emit a second intent'
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count FROM eyes_on_agents_completion_alert_receipt
       WHERE thread_id = ? AND turn_id = ?`
    ).get(THREAD_A, 'turn-b').count,
    1
  );
  db.close();
  db = new TestDatabase(dbPath);
  globalThis.__eyesTestSqliteManager.db = db;
  repository = new EyesOnAgentsRepositoryDao();
  const restartedTurnB = await repository.applyRuntimeEvent({
    event: {
      type: 'turn_completed',
      threadId: THREAD_A,
      turnId: 'turn-b',
      outcome: 'completed',
      observedAt: 240,
      source: 'app_server'
    }
  });
  assert.equal(
    restartedTurnB.completionAlert,
    null,
    'the completion receipt must remain effective after a repository and SQLite restart'
  );
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
  await repository.markOpened({ sessionKey: codexKey(THREAD_B), openedAt: 705 });
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
    hookAfterDisconnectB.isUnread,
    true,
    'Open must not acknowledge a hook-owned running task, so the authority gap stays visible'
  );
  assert.equal(
    hookAfterDisconnectB.isFocused,
    true,
    'an unknown row keeps its latent unread marker instead of silently leaving Focus'
  );

  await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_E,
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: 'unadmitted-old-hook',
      observedAt: 650,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_source, status_observed_at
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(THREAD_B) },
    { runtime_state: 'unknown', status_source: 'discovery', status_observed_at: 710 },
    'an old delivery without current-listener authority must remain behind the invalidation fence'
  );
  await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_F,
    replayAuthority: 'current_listener',
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: 'admitted-replayed-hook',
      observedAt: 650,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_source, status_observed_at, active_turn_id
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(THREAD_B) },
    {
      runtime_state: 'working',
      status_source: 'codex_hook',
      status_observed_at: 650,
      active_turn_id: 'admitted-replayed-hook'
    },
    'an admitted current-listener replay must restore concrete Hook state over discovery unknown'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'thread_status',
      threadId: THREAD_B,
      runtimeState: 'waiting_input',
      activeFlags: ['waitingOnUserInput'],
      turnId: 'newer-app-server-turn',
      observedAt: 800,
      source: 'app_server'
    }
  });
  await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_G,
    replayAuthority: 'current_listener',
    event: {
      type: 'turn_completed',
      threadId: THREAD_B,
      turnId: 'admitted-replayed-hook',
      outcome: 'completed',
      observedAt: 750,
      source: 'codex_hook'
    }
  });
  const concreteAppServerRow = db.prepare(
    `SELECT runtime_state, status_source, status_observed_at, active_turn_id
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_B);
  assert.deepEqual({ ...concreteAppServerRow }, {
    runtime_state: 'waiting_input',
    status_source: 'app_server',
    status_observed_at: 800,
    active_turn_id: 'newer-app-server-turn'
  }, 'replay authority must not bypass a newer concrete App Server watermark');
  assert.deepEqual(
    await repository.applyRuntimeEventDelivery({
      deliveryId: DELIVERY_G,
      replayAuthority: 'current_listener',
      event: {
        type: 'turn_started',
        threadId: THREAD_B,
        turnId: 'duplicate-must-not-reapply',
        observedAt: 850,
        source: 'codex_hook'
      }
    }),
    {
      duplicate: true,
      created: false,
      titleMissing: false,
      completionAlert: null
    },
    'a stale delivery receipt must still dedupe even if a retry carries newer content'
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_source, status_observed_at, active_turn_id
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(THREAD_B) },
    { ...concreteAppServerRow },
    'receipt dedupe must preserve the concrete state that rejected the stale delivery'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_B,
      turnId: 'newer-hook-turn',
      observedAt: 900,
      source: 'codex_hook'
    }
  });
  await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_CLAUDE,
    replayAuthority: 'current_listener',
    event: {
      type: 'turn_completed',
      threadId: THREAD_B,
      turnId: 'newer-hook-turn',
      outcome: 'completed',
      observedAt: 850,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    { ...db.prepare(
      `SELECT runtime_state, status_source, status_observed_at, active_turn_id
       FROM eyes_on_agents_thread WHERE thread_id = ?`
    ).get(THREAD_B) },
    {
      runtime_state: 'working',
      status_source: 'codex_hook',
      status_observed_at: 900,
      active_turn_id: 'newer-hook-turn'
    },
    'replay authority must not overwrite newer concrete Hook evidence'
  );

  await repository.createDomain({ title: 'Rollback check' });
  snapshot = await repository.getSnapshot();
  const rollbackDomain = snapshot.domains.find((domain) => domain.title === 'Rollback check');
  await repository.moveThread({ sessionKey: codexKey(THREAD_B), domainId: rollbackDomain.id });
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
    /source must be a supported hook source/
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
    titleMissing: true,
    completionAlert: null
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
  const codexReceiptSummary = await repository.getRuntimeReceiptSummary({ provider: 'codex' });
  assert.equal(typeof codexReceiptSummary.firstReceivedAt, 'number');
  assert(codexReceiptSummary.firstReceivedAt <= codexReceiptSummary.lastReceivedAt);
  assert.deepEqual(
    await repository.getRuntimeReceiptSummary({ provider: 'claude' }),
    { firstReceivedAt: null, lastReceivedAt: null }
  );
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
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: THREAD_CLAUDE_PROMPT,
      turnId: null,
      observedAt: 810,
      source: 'claude_hook'
    },
    hookLastUserPrompt: { preview: 'Claude latest question', truncated: false }
  });
  assert.deepEqual({ ...db.prepare(
    `SELECT provider, last_user_prompt_preview, last_user_prompt_source
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(THREAD_CLAUDE_PROMPT) }, {
    provider: 'claude',
    last_user_prompt_preview: 'Claude latest question',
    last_user_prompt_source: 'claude_hook'
  }, 'Claude Hook prompt writes must stay provider-qualified');
  assert.deepEqual(
    await repository.clearLastUserPrompts({ providers: ['claude'] }),
    { changed: true }
  );
  assert.equal(
    db.prepare(
      'SELECT last_user_prompt_preview FROM eyes_on_agents_thread WHERE thread_id = ?'
    ).get(THREAD_CLAUDE_PROMPT).last_user_prompt_preview,
    null,
    'Claude disable must clear only Claude prompt fields'
  );
  assert.equal(
    db.prepare(
      'SELECT last_user_prompt_preview FROM eyes_on_agents_thread WHERE thread_id = ?'
    ).get(THREAD_D).last_user_prompt_preview,
    'Delivered question',
    'Claude disable must preserve Codex prompt fields'
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

  const claudeHookThreadId = refreshThreadId(9300);
  const claudeStarted = await repository.applyRuntimeEventDelivery({
    deliveryId: DELIVERY_H,
    event: {
      type: 'turn_started', threadId: claudeHookThreadId, turnId: null,
      observedAt: 850, source: 'claude_hook'
    },
    replayAuthority: 'current_listener'
  });
  assert.equal(claudeStarted.duplicate, false);
  assert.equal(
    db.prepare('SELECT provider FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(claudeHookThreadId).provider,
    'claude'
  );
  const claudeSummary = await repository.getRuntimeReceiptSummary({ provider: 'claude' });
  assert.equal(typeof claudeSummary.firstReceivedAt, 'number');
  assert.equal(claudeSummary.firstReceivedAt, claudeSummary.lastReceivedAt);
  const initialClaudeRuntime = db.prepare(
    `SELECT status_observed_at, status_fresh_until, active_turn_id, runtime_state, is_unread
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(claudeHookThreadId));
  assert.deepEqual(await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeHookThreadId,
    desktopSessionId: null,
    transcriptPath: `/tmp/${claudeHookThreadId}.jsonl`,
    transcriptActivityAt: 900,
    title: null,
    cwd: null,
    archiveState: 'unknown',
    lastActivityAt: 900,
    observedAt: 900
  }] }), { changed: true });
  const heartbeatRuntime = db.prepare(
    `SELECT status_observed_at, status_fresh_until, active_turn_id, transcript_activity_at,
      runtime_state, is_unread
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(claudeHookThreadId));
  assert.equal(heartbeatRuntime.status_observed_at, initialClaudeRuntime.status_observed_at);
  assert.equal(heartbeatRuntime.active_turn_id, initialClaudeRuntime.active_turn_id);
  assert.equal(heartbeatRuntime.transcript_activity_at, 900);
  assert.equal(heartbeatRuntime.status_fresh_until, null);
  assert.equal(heartbeatRuntime.runtime_state, 'working');
  assert.equal(
    heartbeatRuntime.is_unread,
    1,
    'ordinary transcript inventory must preserve unread while Claude is working'
  );
  assert.deepEqual(await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeHookThreadId,
    desktopSessionId: null,
    transcriptPath: `/tmp/${claudeHookThreadId}.jsonl`,
    transcriptActivityAt: 900,
    title: null,
    cwd: null,
    archiveState: 'unknown',
    lastActivityAt: 900,
    observedAt: 910
  }] }), { changed: false }, 'an unchanged JSONL mtime must not rewrite the Hook epoch');
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeHookThreadId,
    desktopSessionId: `local_${claudeHookThreadId}`,
    transcriptPath: null,
    transcriptActivityAt: null,
    title: 'Desktop activity',
    cwd: null,
    archiveState: 'active',
    lastActivityAt: 20_000,
    observedAt: 20_000
  }] });
  assert.equal(
    db.prepare('SELECT status_fresh_until FROM eyes_on_agents_thread WHERE session_key = ?')
      .get(claudeKey(claudeHookThreadId)).status_fresh_until,
    null,
    'Desktop activity must not create a timeout for a Claude Hook epoch'
  );
  await repository.applyRuntimeEventDelivery({
    deliveryId: '18181818-1818-4818-8818-181818181818',
    event: {
      type: 'turn_completed', threadId: claudeHookThreadId, turnId: null,
      observedAt: 21_000, source: 'claude_hook', outcome: 'completed'
    },
    replayAuthority: 'current_listener'
  });
  assert.deepEqual({ ...db.prepare(
    `SELECT runtime_state, is_unread FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(claudeHookThreadId)) }, {
    runtime_state: 'idle',
    is_unread: 1
  }, 'an accepted Claude Stop must leave terminal unread attention');
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeHookThreadId,
    desktopSessionId: `local_${claudeHookThreadId}`,
    transcriptPath: `/tmp/${claudeHookThreadId}.jsonl`,
    transcriptActivityAt: 22_000,
    title: 'Desktop activity after Stop',
    cwd: null,
    archiveState: 'active',
    lastActivityAt: 22_000,
    observedAt: 22_000
  }] });
  assert.deepEqual({ ...db.prepare(
    `SELECT runtime_state, is_unread FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(claudeHookThreadId)) }, {
    runtime_state: 'idle',
    is_unread: 1
  }, 'ordinary Desktop/transcript inventory must preserve Stop completion attention');
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
    titleMissing: false,
    completionAlert: null
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
    {
      duplicate: false,
      created: true,
      titleMissing: true,
      completionAlert: null
    },
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
    {
      duplicate: false,
      created: true,
      titleMissing: true,
      completionAlert: null
    },
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
      session_key, provider, thread_id, domain_id, title, is_archived, archive_state,
      last_activity_at,
      last_user_prompt_checked_at, created_at, updated_at
    ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 1; index <= 86; index += 1) {
    const tiedHotActivity = index === 84 || index === 85;
    insertRefreshThread.run(
      codexKey(refreshThreadId(index)),
      refreshThreadId(index),
      refreshDomainId,
      `Refresh ${index}`,
      index === 86 ? 1 : 0,
      index === 86 ? 'archived' : 'active',
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
      `UPDATE eyes_on_agents_thread
       SET is_archived = 1, archive_state = 'archived'
       WHERE provider = 'codex' AND thread_id = ?`
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
    `SELECT title, last_activity_at, updated_at
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

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-1',
      observedAt: 40_000,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  let refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.runtimeState, 'working');
  assert.equal(refreshTargetSnapshot.statusSource, 'codex_hook');
  assert.equal(refreshTargetSnapshot.isUnread, true);
  assert.equal(refreshTargetSnapshot.isFocused, true);

  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        title: 'Refresh title changed',
        lastActivityAt: 20_000,
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
    `SELECT title, runtime_state, status_source, status_observed_at, is_unread, last_activity_at,
      last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_checked_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(refreshTargetId);
  assert.deepEqual({ ...refreshTarget }, {
    title: 'Refresh title changed',
    runtime_state: 'working',
    status_source: 'codex_hook',
    status_observed_at: 40_000,
    is_unread: 1,
    last_activity_at: 40_000,
    last_user_prompt_preview: 'Refresh-page latest question',
    last_user_prompt_turn_id: 'refresh-turn',
    last_user_prompt_at: 19_500,
    last_user_prompt_checked_at: 20_000
  }, 'metadata refresh must preserve Hook-owned working attention');

  await assert.rejects(
    () => repository.refreshThreadPage({
      threads: [{
        threadId: refreshTargetId,
        status: {
          runtimeState: 'idle',
          activeFlags: [],
          activeTurnId: null,
          source: 'app_server',
          observedAt: 40_001
        }
      }]
    }),
    /unsupported field\(s\): status/,
    'the repository contract must reject runtime patches from metadata refresh'
  );

  await repository.markOpened({ sessionKey: codexKey(refreshTargetId), openedAt: 40_001 });
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.runtimeState, 'working');
  assert.equal(refreshTargetSnapshot.isUnread, true);
  assert.equal(
    refreshTargetSnapshot.isFocused,
    true,
    'Open records deep-link evidence without removing a running task from Focus'
  );
  assert.equal(refreshTargetSnapshot.lastOpenedTurnId, 'focus-turn-1');

  await repository.refreshThreadPage({
    threads: [{
      threadId: refreshTargetId,
      title: 'Metadata after Open',
      lastActivityAt: 40_001
    }]
  });
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.title, 'Metadata after Open');
  assert.equal(refreshTargetSnapshot.runtimeState, 'working');
  assert.equal(refreshTargetSnapshot.statusSource, 'codex_hook');
  assert.equal(refreshTargetSnapshot.isUnread, true);
  assert.equal(
    refreshTargetSnapshot.isFocused,
    true,
    'metadata-only refresh must not disturb running Focus membership'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-2',
      observedAt: 40_002,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.runtimeState, 'working');
  assert.equal(refreshTargetSnapshot.activeTurnId, 'focus-turn-2');
  assert.equal(refreshTargetSnapshot.isUnread, true);
  assert.equal(refreshTargetSnapshot.isFocused, true);
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
    promotedHotPage.hot[0].activeTurn,
    {
      turnId: 'focus-turn-2',
      statusObservedAt: 40_002,
      statusSource: 'codex_hook',
      runtimeState: 'working'
    },
    'refresh selection must expose exact active evidence for guarded terminal polling'
  );
  assert.equal(
    promotedHotPage.hot[0].recoveryCandidate,
    null,
    'an already-active row must never also be offered for working recovery'
  );

  const terminalPatch = ({
    turnId,
    outcome,
    completedAt,
    expectedStatusObservedAt,
    expectedStatusSource = 'codex_hook'
  }) => ({
    threadId: refreshTargetId,
    terminalTurn: {
      turnId,
      outcome,
      completedAt,
      expectedActiveTurnId: turnId,
      expectedStatusObservedAt,
      expectedStatusSource,
      source: 'app_server'
    }
  });
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [terminalPatch({
        turnId: 'focus-turn-2',
        outcome: 'interrupted',
        completedAt: 40_000,
        expectedStatusObservedAt: 40_002
      })]
    }),
    { changed: true }
  );
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.runtimeState, 'ended');
  assert.equal(refreshTargetSnapshot.statusSource, 'app_server');
  assert.equal(refreshTargetSnapshot.activeTurnId, null);
  assert.equal(refreshTargetSnapshot.lastCompletedTurnId, 'focus-turn-2');
  assert.equal(refreshTargetSnapshot.lastCompletedAt, new Date(40_000).toISOString());
  assert.equal(refreshTargetSnapshot.isUnread, true);
  assert.equal(
    refreshTargetSnapshot.isFocused,
    true,
    'a reconciled Stop must cease working while remaining a newly finished unread task'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-2',
      observedAt: 40_500,
      source: 'codex_hook'
    }
  });
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(
    refreshTargetSnapshot.runtimeState,
    'ended',
    'a delayed active Hook for the completed turn must not revive terminal state'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-3',
      observedAt: 40_600,
      source: 'codex_hook'
    }
  });
  const completedPoll = await repository.refreshThreadPage({
    threads: [terminalPatch({
      turnId: 'focus-turn-3',
      outcome: 'completed',
      completedAt: 40_000,
      expectedStatusObservedAt: 40_600
    })]
  });
  assert.equal(completedPoll.changed, true);
  assert.deepEqual(
    completedPoll.completionAlerts?.map(({ threadId, turnId }) => ({ threadId, turnId })),
    [{ threadId: refreshTargetId, turnId: 'focus-turn-3' }],
    'one successful terminal CAS must return one bounded completion intent'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [terminalPatch({
        turnId: 'focus-turn-3',
        outcome: 'completed',
        completedAt: 40_000,
        expectedStatusObservedAt: 40_600
      })]
    }),
    { changed: false },
    'a repeated terminal patch must neither mutate nor return a second alert'
  );
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === refreshTargetId).runtimeState,
    'idle',
    'completed terminal proof must reconcile to idle'
  );

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-4',
      observedAt: 44_000,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [terminalPatch({
        turnId: 'focus-turn-4',
        outcome: 'failed',
        completedAt: 45_000,
        expectedStatusObservedAt: 44_000
      })]
    }),
    { changed: true }
  );
  snapshot = await repository.getSnapshot();
  assert.equal(
    snapshot.threads.find((thread) => thread.threadId === refreshTargetId).runtimeState,
    'failed',
    'failed terminal proof must reconcile to failed'
  );

  await repository.markOpened({ sessionKey: codexKey(refreshTargetId), openedAt: 45_500 });
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(
    refreshTargetSnapshot.isUnread,
    false,
    'Open must acknowledge a confirmed terminal task'
  );
  assert.equal(
    refreshTargetSnapshot.isFocused,
    false,
    'an acknowledged terminal task must leave Focus'
  );
  assert.equal(refreshTargetSnapshot.lastOpenedTurnId, 'focus-turn-4');

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-5',
      observedAt: 46_000,
      source: 'codex_hook'
    }
  });
  const staleTerminalPatch = terminalPatch({
    turnId: 'focus-turn-5',
    outcome: 'interrupted',
    completedAt: 47_000,
    expectedStatusObservedAt: 46_000
  });
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-6',
      observedAt: 48_000,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [staleTerminalPatch] }),
    { changed: false },
    'one atomic CAS must reject terminal proof after a newer turn replaces the candidate'
  );
  snapshot = await repository.getSnapshot();
  refreshTargetSnapshot = snapshot.threads.find(
    (thread) => thread.threadId === refreshTargetId
  );
  assert.equal(refreshTargetSnapshot.runtimeState, 'working');
  assert.equal(refreshTargetSnapshot.activeTurnId, 'focus-turn-6');
  assert.equal(refreshTargetSnapshot.statusSource, 'codex_hook');

  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: null,
      observedAt: 49_000,
      source: 'codex_hook'
    }
  });
  const syntheticTurnPage = await repository.getThreadRefreshPages({
    coldPage: 2,
    previousPageCount: promotedHotPage.pageCount
  });
  assert.equal(syntheticTurnPage.hot[0].threadId, refreshTargetId);
  assert.equal(
    syntheticTurnPage.hot[0].activeTurn,
    null,
    'a synthetic fallback turn identity must never authorize terminal reconciliation'
  );
  assert.equal(
    syntheticTurnPage.hot[0].recoveryCandidate,
    null,
    'a Hook-owned working row is not a missed-working recovery candidate'
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: refreshTargetId,
      turnId: 'focus-turn-7',
      observedAt: 50_000,
      source: 'codex_hook'
    }
  });
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

  const recoveryThreadId = refreshThreadId(300);
  db.prepare(
    `INSERT INTO eyes_on_agents_thread (
      session_key, provider, thread_id, domain_id, title, is_archived, archive_state,
      runtime_state, status_source,
      status_observed_at, is_unread, last_activity_at, created_at, updated_at
    ) VALUES (?, 'codex', ?, ?, 'Missed working', 0, 'active',
      'unknown', 'discovery', ?, 1, ?, ?, ?)`
  ).run(
    codexKey(recoveryThreadId),
    recoveryThreadId,
    refreshDomainId,
    60_000,
    60_000,
    60_000,
    60_000
  );
  const recoveryRow = () => db.prepare(
    `SELECT runtime_state, status_source, status_observed_at, active_turn_id, is_unread,
      last_activity_at, last_completed_turn_id
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(recoveryThreadId);
  const recoveredPatch = (overrides = {}) => ({
    threadId: recoveryThreadId,
    recoveredTurn: {
      turnId: 'missed-turn',
      startedAt: 59_000,
      expectedStatusObservedAt: 60_000,
      source: 'app_server_turn',
      ...overrides
    }
  });
  const resetRecoveryRow = (columns) => {
    const values = {
      runtime_state: 'unknown',
      status_source: 'discovery',
      status_observed_at: 60_000,
      active_turn_id: null,
      active_flags_json: '[]',
      is_unread: 1,
      is_archived: 0,
      archive_state: 'active',
      last_completed_turn_id: null,
      last_completed_at: null,
      last_activity_at: 60_000,
      ...columns
    };
    if ('is_archived' in columns && !('archive_state' in columns)) {
      values.archive_state = columns.is_archived === 1 ? 'archived' : 'active';
    }
    const entries = Object.entries(values);
    db.prepare(
      `UPDATE eyes_on_agents_thread
       SET ${entries.map(([column]) => `${column} = ?`).join(', ')}
       WHERE thread_id = ?`
    ).run(...entries.map(([, value]) => value), recoveryThreadId);
  };

  const recoveryPage = await repository.getThreadRefreshPages({
    coldPage: 2,
    previousPageCount: null
  });
  const recoverySelection = recoveryPage.hot.find(
    (candidate) => candidate.threadId === recoveryThreadId
  );
  assert.ok(recoverySelection, 'a missed-working row must be selectable for refresh');
  assert.deepEqual(
    recoverySelection.recoveryCandidate,
    { statusObservedAt: 60_000 },
    'an unread discovery+unknown row with no active turn is a missed-working candidate'
  );
  assert.equal(
    recoverySelection.activeTurn,
    null,
    'a recovery candidate carries no active turn identity'
  );

  const settledPatch = (overrides = {}) => ({
    threadId: recoveryThreadId,
    settledTurn: {
      turnId: 'settled-turn',
      outcome: 'completed',
      completedAt: 59_000,
      expectedStatusObservedAt: 60_000,
      source: 'app_server',
      ...overrides
    }
  });
  const settlementRow = () => db.prepare(
    `SELECT runtime_state, active_flags_json, active_turn_id,
      last_completed_turn_id, last_completed_at, is_unread,
      status_source, status_observed_at, last_activity_at
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(recoveryThreadId);
  for (const rejection of [
    {
      columns: {},
      patch: { expectedStatusObservedAt: 59_999 },
      reason: 'a concurrent observation watermark'
    },
    { columns: { is_unread: 0 }, patch: {}, reason: 'an acknowledged row' },
    { columns: { is_archived: 1 }, patch: {}, reason: 'an archived row' },
    { columns: { active_turn_id: 'replacement-turn' }, patch: {}, reason: 'an active turn' },
    { columns: { runtime_state: 'idle' }, patch: {}, reason: 'an already terminal row' },
    { columns: { status_source: 'codex_hook' }, patch: {}, reason: 'another authority' }
  ]) {
    resetRecoveryRow(rejection.columns);
    assert.deepEqual(
      await repository.refreshThreadPage({
        threads: [settledPatch(rejection.patch)]
      }),
      { changed: false },
      `${rejection.reason} must reject delayed terminal settlement`
    );
    if (rejection.columns.is_archived === 1) {
      assert.equal(
        settlementRow().is_unread,
        1,
        'an archived settlement rejection must preserve durable unread history'
      );
    }
  }

  resetRecoveryRow({
    active_flags_json: '["waitingOnApproval"]'
  });
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [settledPatch({
        turnId: 'settled-interrupted',
        outcome: 'interrupted'
      })]
    }),
    { changed: true },
    'an interrupted recovery candidate must settle without a success alert'
  );
  assert.deepEqual(
    { ...settlementRow() },
    {
      runtime_state: 'ended',
      active_flags_json: '[]',
      active_turn_id: null,
      last_completed_turn_id: 'settled-interrupted',
      last_completed_at: 59_000,
      is_unread: 1,
      status_source: 'app_server',
      status_observed_at: 60_000,
      last_activity_at: 60_000
    },
    'interrupted settlement must clear active evidence, preserve unread, and never regress activity'
  );

  resetRecoveryRow({});
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [settledPatch({
        turnId: 'settled-failed',
        outcome: 'failed',
        completedAt: 61_000
      })]
    }),
    { changed: true }
  );
  assert.equal(
    settlementRow().runtime_state,
    'failed',
    'failed terminal evidence must map an unknown candidate to failed'
  );
  assert.equal(
    settlementRow().last_activity_at,
    61_000,
    'terminal settlement must advance activity when completion is newer'
  );

  resetRecoveryRow({});
  const newCompletedSettlement = await repository.refreshThreadPage({
    threads: [settledPatch({
      turnId: 'settled-completed',
      completedAt: 62_000
    })]
  });
  assert.deepEqual(
    newCompletedSettlement,
    {
      changed: true,
      completionAlerts: [{
        sessionKey: codexKey(recoveryThreadId),
        provider: 'codex',
        threadId: recoveryThreadId,
        turnId: 'settled-completed',
        title: 'Missed working'
      }]
    },
    'a newly claimed successful settlement must return one completion alert'
  );
  assert.equal(settlementRow().runtime_state, 'idle');
  assert.equal(settlementRow().is_unread, 1);
  await repository.markOpened({ sessionKey: codexKey(recoveryThreadId), openedAt: 63_000 });
  assert.equal(
    settlementRow().is_unread,
    0,
    'final Open acknowledgement must clear a newly settled terminal row'
  );

  db.prepare(
    `INSERT OR IGNORE INTO eyes_on_agents_completion_alert_receipt (
      session_key, provider, thread_id, turn_id, completed_at, claimed_at
    ) VALUES (?, 'codex', ?, ?, ?, ?)`
  ).run(codexKey(recoveryThreadId), recoveryThreadId, 'settled-existing', 58_000, 58_000);
  resetRecoveryRow({
    active_flags_json: '["waitingOnApproval"]',
    last_completed_turn_id: 'settled-existing',
    last_completed_at: 58_000
  });
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [settledPatch({
        turnId: 'settled-existing',
        completedAt: 59_000
      })]
    }),
    { changed: true },
    'an existing completion identity must not block runtime settlement or replay its alert'
  );
  assert.deepEqual(
    {
      runtime_state: settlementRow().runtime_state,
      active_flags_json: settlementRow().active_flags_json,
      last_completed_turn_id: settlementRow().last_completed_turn_id,
      last_completed_at: settlementRow().last_completed_at,
      is_unread: settlementRow().is_unread,
      status_source: settlementRow().status_source
    },
    {
      runtime_state: 'idle',
      active_flags_json: '[]',
      last_completed_turn_id: 'settled-existing',
      last_completed_at: 59_000,
      is_unread: 1,
      status_source: 'app_server'
    },
    'status convergence and durable completion-alert dedupe must remain independent'
  );

  for (const rejection of [
    { columns: {}, patch: { expectedStatusObservedAt: 59_999 }, reason: 'a changed observation watermark' },
    { columns: { is_unread: 0 }, patch: {}, reason: 'an already acknowledged row' },
    { columns: { is_archived: 1 }, patch: {}, reason: 'an archived row' },
    { columns: { active_turn_id: 'other-turn' }, patch: {}, reason: 'a replacement active turn' },
    { columns: { runtime_state: 'idle' }, patch: {}, reason: 'a confirmed terminal row' },
    { columns: { status_source: 'codex_hook' }, patch: {}, reason: 'live Hook ownership' },
    { columns: { last_completed_turn_id: 'missed-turn' }, patch: {}, reason: 'an already completed turn' }
  ]) {
    resetRecoveryRow(rejection.columns);
    assert.deepEqual(
      await repository.refreshThreadPage({ threads: [recoveredPatch(rejection.patch)] }),
      { changed: false },
      `${rejection.reason} must make delayed working recovery a no-op`
    );
    assert.equal(
      recoveryRow().runtime_state,
      rejection.columns.runtime_state ?? 'unknown',
      'a rejected recovery must not mutate runtime state'
    );
  }

  resetRecoveryRow({});
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [recoveredPatch()] }),
    { changed: true },
    'valid latest inProgress turn metadata must recover working'
  );
  assert.deepEqual(
    { ...recoveryRow() },
    {
      runtime_state: 'working',
      status_source: 'app_server_turn',
      status_observed_at: 59_000,
      active_turn_id: 'missed-turn',
      is_unread: 1,
      last_activity_at: 60_000,
      last_completed_turn_id: null
    },
    'recovery records the real turn identity and persisted start time and keeps unread'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [recoveredPatch()] }),
    { changed: false },
    'a recovered row is no longer a recovery target'
  );

  const recoveredPage = await repository.getThreadRefreshPages({
    coldPage: 2,
    previousPageCount: recoveryPage.pageCount
  });
  const recoveredSelection = recoveredPage.hot.find(
    (candidate) => candidate.threadId === recoveryThreadId
  );
  assert.deepEqual(
    recoveredSelection.activeTurn,
    {
      turnId: 'missed-turn',
      statusObservedAt: 59_000,
      statusSource: 'app_server_turn',
      runtimeState: 'working'
    },
    'a recovered row becomes an exact-identity terminal reconciliation candidate'
  );
  assert.equal(recoveredSelection.recoveryCandidate, null);

  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: recoveryThreadId,
      title: 'Inventory notLoaded',
      cwd: null,
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: 70_000,
      lastActivityAt: 70_000
    }]
  });
  assert.deepEqual(
    {
      runtime_state: recoveryRow().runtime_state,
      status_source: recoveryRow().status_source,
      active_turn_id: recoveryRow().active_turn_id,
      status_observed_at: recoveryRow().status_observed_at
    },
    {
      runtime_state: 'working',
      status_source: 'app_server_turn',
      active_turn_id: 'missed-turn',
      status_observed_at: 59_000
    },
    'a full notLoaded inventory sync must preserve recovered active identity'
  );
  await repository.invalidateAppServerStatuses({ observedAt: 71_000 });
  assert.equal(
    recoveryRow().runtime_state,
    'working',
    'App Server reconnect invalidation must not clear turn-metadata evidence'
  );

  const recoveredTerminalPatch = (expectedStatusSource) => ({
    threadId: recoveryThreadId,
    terminalTurn: {
      turnId: 'missed-turn',
      outcome: 'completed',
      completedAt: 72_000,
      expectedActiveTurnId: 'missed-turn',
      expectedStatusObservedAt: 59_000,
      expectedStatusSource,
      source: 'app_server'
    }
  });
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [recoveredTerminalPatch('codex_hook')] }),
    { changed: false },
    'a Hook expectation must not end a row recovered from turn metadata'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [recoveredTerminalPatch('app_server_turn')] }),
    {
      changed: true,
      completionAlerts: [{
        sessionKey: codexKey(recoveryThreadId),
        provider: 'codex',
        threadId: recoveryThreadId,
        turnId: 'missed-turn',
        title: 'Inventory notLoaded'
      }]
    },
    'exact-identity terminal proof must end a recovered row'
  );
  assert.deepEqual(
    {
      runtime_state: recoveryRow().runtime_state,
      active_turn_id: recoveryRow().active_turn_id,
      last_completed_turn_id: recoveryRow().last_completed_turn_id,
      is_unread: recoveryRow().is_unread
    },
    {
      runtime_state: 'idle',
      active_turn_id: null,
      last_completed_turn_id: 'missed-turn',
      is_unread: 1
    },
    'a reconciled recovery becomes a newly finished unread task'
  );

  resetRecoveryRow({});
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [recoveredPatch()] }),
    { changed: true }
  );
  await repository.applyRuntimeEvent({
    event: {
      type: 'turn_started',
      threadId: recoveryThreadId,
      turnId: 'live-hook-turn',
      observedAt: 80_000,
      source: 'codex_hook'
    }
  });
  assert.deepEqual(
    {
      status_source: recoveryRow().status_source,
      active_turn_id: recoveryRow().active_turn_id
    },
    { status_source: 'codex_hook', active_turn_id: 'live-hook-turn' },
    'real Hook evidence must supersede recovered App Server turn evidence'
  );
  const reclaimPatch = (overrides = {}) => ({
    threadId: recoveryThreadId,
    reclaimedTurn: {
      turnId: 'live-hook-turn',
      startedAt: 79_000,
      expectedActiveTurnId: 'live-hook-turn',
      expectedStatusObservedAt: 80_000,
      expectedStatusSource: 'codex_hook',
      source: 'app_server_turn',
      ...overrides
    }
  });
  db.prepare(
    `UPDATE eyes_on_agents_thread
     SET runtime_state = 'waiting_approval', active_flags_json = '["waitingOnApproval"]',
       last_activity_at = 80_500
     WHERE thread_id = ?`
  ).run(recoveryThreadId);
  for (const rejection of [
    { patch: { expectedStatusObservedAt: 79_999 }, reason: 'a changed observation watermark' },
    { patch: { turnId: 'other-turn', expectedActiveTurnId: 'other-turn' }, reason: 'a replacement active turn' }
  ]) {
    assert.deepEqual(
      await repository.refreshThreadPage({ threads: [reclaimPatch(rejection.patch)] }),
      { changed: false },
      `${rejection.reason} must make a delayed reclaim a no-op`
    );
    assert.equal(recoveryRow().status_source, 'codex_hook');
  }
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [reclaimPatch()] }),
    { changed: true },
    'App Server may reclaim an active row whose Hook authority is absent'
  );
  assert.deepEqual(
    { ...recoveryRow() },
    {
      runtime_state: 'waiting_approval',
      status_source: 'app_server_turn',
      status_observed_at: 79_000,
      active_turn_id: 'live-hook-turn',
      is_unread: 1,
      last_activity_at: 80_500,
      last_completed_turn_id: null
    },
    'a reclaim changes only source and watermark; the observed wait and unread survive'
  );
  assert.equal(
    db.prepare('SELECT active_flags_json FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(recoveryThreadId).active_flags_json,
    '["waitingOnApproval"]',
    'a reclaim must not downgrade an approval wait to generic working'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({ threads: [reclaimPatch()] }),
    { changed: false },
    'a reclaimed row is no longer codex_hook-sourced and cannot be reclaimed twice'
  );
  await repository.invalidateCodexHookStatuses({ observedAt: 81_000 });
  assert.equal(
    recoveryRow().runtime_state,
    'waiting_approval',
    'a Hook listener boundary must not clear evidence App Server has since confirmed'
  );
  assert.deepEqual(
    await repository.refreshThreadPage({
      threads: [{
        threadId: recoveryThreadId,
        terminalTurn: {
          turnId: 'live-hook-turn',
          outcome: 'completed',
          completedAt: 82_000,
          expectedActiveTurnId: 'live-hook-turn',
          expectedStatusObservedAt: 79_000,
          expectedStatusSource: 'app_server_turn',
          source: 'app_server'
        }
      }]
    }),
    {
      changed: true,
      completionAlerts: [{
        sessionKey: codexKey(recoveryThreadId),
        provider: 'codex',
        threadId: recoveryThreadId,
        turnId: 'live-hook-turn',
        title: 'Inventory notLoaded'
      }]
    },
    'a reclaimed row stays terminally reconcilable under its own source'
  );
  assert.equal(recoveryRow().runtime_state, 'idle');

  db.prepare('DELETE FROM eyes_on_agents_thread WHERE thread_id = ?').run(recoveryThreadId);

  const readAllIdleId = resetColdPage.hot[3].threadId;
  const readAllWorkingId = refreshTargetId;
  const readAllWaitingApprovalId = resetColdPage.hot[1].threadId;
  const readAllWaitingInputId = resetColdPage.hot[2].threadId;
  const readAllUnknownId = resetColdPage.hot[4].threadId;
  const readAllArchivedId = selectedThirdPage.cold[0].threadId;
  assert.equal(
    new Set([
      readAllIdleId,
      readAllWorkingId,
      readAllWaitingApprovalId,
      readAllWaitingInputId,
      readAllUnknownId,
      readAllArchivedId
    ]).size,
    6,
    'Read all fixture threads must be distinct'
  );
  const seedReadAllRow = db.prepare(
    `UPDATE eyes_on_agents_thread SET
      is_archived = ?, archive_state = ?, runtime_state = ?, is_unread = 1,
      last_opened_turn_id = ?, last_opened_at = ?, updated_at = ?
     WHERE thread_id = ?`
  );
  const readAllFixtures = [
    [0, 'active', 'idle', 'opened-idle', 50_001, 51_001, readAllIdleId],
    [0, 'active', 'working', 'opened-working', 50_002, 51_002, readAllWorkingId],
    [0, 'active', 'waiting_approval', 'opened-approval', 50_003, 51_003, readAllWaitingApprovalId],
    [0, 'active', 'waiting_input', 'opened-input', 50_004, 51_004, readAllWaitingInputId],
    [0, 'active', 'unknown', 'opened-unknown', 50_006, 51_006, readAllUnknownId],
    [1, 'archived', 'idle', 'opened-archived', 50_005, 51_005, readAllArchivedId]
  ];
  for (const fixture of readAllFixtures) {
    assert.equal(seedReadAllRow.run(...fixture).changes, 1);
  }
  assert.deepEqual(
    await repository.markAllRead({ providers: ['codex', 'claude'] }),
    { changed: true },
    'Read all must report when it clears an eligible unread row'
  );
  const readAllRows = new Map(
    db.prepare(
      `SELECT thread_id, is_archived, runtime_state, is_unread,
        last_opened_turn_id, last_opened_at, updated_at
       FROM eyes_on_agents_thread
       WHERE thread_id IN (?, ?, ?, ?, ?, ?)`
    ).all(
      readAllIdleId,
      readAllWorkingId,
      readAllWaitingApprovalId,
      readAllWaitingInputId,
      readAllUnknownId,
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
    readAllWaitingInputId,
    readAllUnknownId
  ]) {
    assert.equal(
      readAllRows.get(threadId).is_unread,
      1,
      'Read all must clear only confirmed terminal rows, never active or unknown attention'
    );
  }
  assert.equal(readAllRows.get(readAllArchivedId).is_archived, 1);
  assert.equal(
    readAllRows.get(readAllArchivedId).is_unread,
    1,
    'Read all must not mutate archived unread rows'
  );
  assert.deepEqual(
    await repository.markAllRead({ providers: ['codex', 'claude'] }),
    { changed: false },
    'repeating Read all without another eligible unread row must be a no-op'
  );

  const claudeThreadId = '45454545-4545-4545-8545-454545454545';
  const claudeSessionKey = claudeKey(claudeThreadId);
  await repository.createDomain({ title: 'Claude Domain Audit' });
  const claudeDomain = (await repository.getSnapshot()).domains.find(
    (domain) => domain.title === 'Claude Domain Audit'
  );
  assert.ok(claudeDomain);
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [{
      threadId: claudeThreadId,
      desktopSessionId: `local_${claudeThreadId}`,
      transcriptPath: `/tmp/project/${claudeThreadId}.jsonl`,
      title: 'Claude audit',
      cwd: '/tmp/project',
      archiveState: 'active',
      lastActivityAt: 90_000,
      observedAt: 90_000
    }]
  }), { changed: true });
  await repository.moveThread({ sessionKey: claudeSessionKey, domainId: claudeDomain.id });
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [{
      threadId: claudeThreadId,
      desktopSessionId: `local_${claudeThreadId}`,
      transcriptPath: `/tmp/project/${claudeThreadId}.jsonl`,
      title: 'Claude audit renamed',
      cwd: '/tmp/project',
      archiveState: 'archived',
      lastActivityAt: 91_000,
      observedAt: 91_000
    }]
  }), { changed: true });
  assert.equal(
    db.prepare('SELECT domain_id FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeSessionKey).domain_id,
    claudeDomain.id,
    'Claude archive/title reconciliation must preserve Domain assignment'
  );
  assert.deepEqual(await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'working',
      title: null,
      cwd: null,
      startedAt: 92_000,
      observedAt: 93_000
    }],
    completeSnapshot: true,
    observedAt: 93_000
  }), { changed: true });
  const workingClaude = db.prepare(
    'SELECT runtime_state, status_observed_at, status_fresh_until FROM eyes_on_agents_thread WHERE session_key = ?'
  ).get(claudeSessionKey);
  assert.deepEqual({ ...workingClaude }, {
    runtime_state: 'working',
    status_observed_at: 92_000,
    status_fresh_until: 123_000
  });
  await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'working',
      title: null,
      cwd: null,
      startedAt: 92_000,
      observedAt: 100_000
    }],
    completeSnapshot: true,
    observedAt: 100_000
  });
  assert.equal(
    db.prepare('SELECT status_observed_at FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeSessionKey).status_observed_at,
    92_000,
    'same-state Agent View polling must retain the working-start sort timestamp'
  );
  await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'working',
      title: null,
      cwd: null,
      startedAt: 105_000,
      observedAt: 106_000
    }],
    completeSnapshot: true,
    observedAt: 106_000
  });
  assert.deepEqual({ ...db.prepare(
    `SELECT status_observed_at, active_turn_id FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) }, {
    status_observed_at: 105_000,
    active_turn_id: 'claude-agent-105000'
  }, 'a changed explicit Agent View start time must establish a new working run');
  assert.deepEqual(await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'idle',
      title: null,
      cwd: null,
      startedAt: 92_000,
      observedAt: 110_000
    }],
    completeSnapshot: true,
    observedAt: 110_000
  }), { changed: true });
  assert.deepEqual({ ...db.prepare(
    `SELECT runtime_state, status_observed_at, status_fresh_until, last_activity_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) }, {
    runtime_state: 'idle',
    status_observed_at: 110_000,
    status_fresh_until: null,
    last_activity_at: 110_000
  });
  assert.deepEqual(await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'idle',
      title: null,
      cwd: null,
      startedAt: 92_000,
      observedAt: 120_000
    }],
    completeSnapshot: true,
    observedAt: 120_000
  }), { changed: false }, 'repeated terminal Agent View rows must not advance ordering or write');
  assert.deepEqual({ ...db.prepare(
    `SELECT status_observed_at, status_fresh_until, last_activity_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) }, {
    status_observed_at: 110_000,
    status_fresh_until: null,
    last_activity_at: 110_000
  });
  db.prepare(
    `UPDATE eyes_on_agents_thread SET runtime_state = 'idle', archive_state = 'active',
      is_archived = 0, is_unread = 1 WHERE thread_id IN (?, ?)`
  ).run(readAllIdleId, claudeThreadId);
  assert.deepEqual(await repository.markAllRead({ providers: ['codex'] }), { changed: true });
  assert.deepEqual({ ...db.prepare(
    `SELECT
      (SELECT is_unread FROM eyes_on_agents_thread WHERE thread_id = ?) AS codex_unread,
      (SELECT is_unread FROM eyes_on_agents_thread WHERE thread_id = ?) AS claude_unread`
  ).get(readAllIdleId, claudeThreadId) }, {
    codex_unread: 0,
    claude_unread: 1
  }, 'provider-scoped Read all must leave hidden Claude unread evidence unchanged');
  assert.deepEqual(
    await repository.markAllRead({ providers: ['codex', 'claude'] }),
    { changed: true }
  );
  assert.equal(
    db.prepare('SELECT is_unread FROM eyes_on_agents_thread WHERE thread_id = ?')
      .get(claudeThreadId).is_unread,
    0,
    'visible-provider Read all may acknowledge Claude terminal unread evidence'
  );

  // Manual per-thread read state: writes only is_unread, on any runtime state, both providers.
  const manualReadSessionKey = `codex:${readAllIdleId}`;
  const manualBefore = { ...db.prepare(
    `SELECT is_unread, last_opened_turn_id, last_opened_at, runtime_state, updated_at,
       last_activity_at, status_observed_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(manualReadSessionKey) };
  assert.equal(manualBefore.is_unread, 0, 'the manual case starts from an acknowledged row');
  assert.deepEqual(
    await repository.setThreadUnread({ sessionKey: manualReadSessionKey, isUnread: true }),
    { changed: true },
    'a manual unread flag is written'
  );
  assert.deepEqual({ ...db.prepare(
    `SELECT is_unread, last_opened_turn_id, last_opened_at, runtime_state, updated_at,
       last_activity_at, status_observed_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(manualReadSessionKey) }, {
    ...manualBefore,
    is_unread: 1
  }, 'manual unread must touch nothing but is_unread');
  assert.deepEqual(
    await repository.setThreadUnread({ sessionKey: manualReadSessionKey, isUnread: true }),
    { changed: false },
    'setting the flag it already has reports no change'
  );
  assert.deepEqual(
    await repository.setThreadUnread({ sessionKey: manualReadSessionKey, isUnread: false }),
    { changed: true }
  );
  assert.deepEqual({ ...db.prepare(
    `SELECT is_unread, last_opened_turn_id, last_opened_at, updated_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(manualReadSessionKey) }, {
    is_unread: 0,
    last_opened_turn_id: manualBefore.last_opened_turn_id,
    last_opened_at: manualBefore.last_opened_at,
    updated_at: manualBefore.updated_at
  }, 'manual read is an acknowledgement, never a deep-link receipt');
  db.prepare(
    `UPDATE eyes_on_agents_thread SET runtime_state = 'working' WHERE session_key = ?`
  ).run(manualReadSessionKey);
  assert.deepEqual(
    await repository.setThreadUnread({ sessionKey: manualReadSessionKey, isUnread: true }),
    { changed: true },
    'an active row may still carry a latent manual unread marker'
  );
  db.prepare(
    `UPDATE eyes_on_agents_thread SET runtime_state = 'idle', is_unread = 0, archive_state = 'archived'
     WHERE session_key = ?`
  ).run(manualReadSessionKey);
  assert.deepEqual(
    await repository.setThreadUnread({ sessionKey: manualReadSessionKey, isUnread: true }),
    { changed: false },
    'an archived row refuses a manual read-state write'
  );
  db.prepare(
    `UPDATE eyes_on_agents_thread SET archive_state = 'active' WHERE session_key = ?`
  ).run(manualReadSessionKey);
  await assert.rejects(
    () => repository.setThreadUnread({ sessionKey: manualReadSessionKey }),
    /Thread read state params are invalid/
  );
  await assert.rejects(
    () => repository.setThreadUnread({
      sessionKey: manualReadSessionKey,
      isUnread: true,
      extra: 1
    }),
    /Thread read state params are invalid/
  );
  await assert.rejects(
    () => repository.setThreadUnread({ sessionKey: 'codex:not-a-uuid', isUnread: true }),
    /threadId must be a UUID/
  );
  await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId,
      runtimeState: 'working',
      title: null,
      cwd: null,
      startedAt: 121_000,
      observedAt: 121_000
    }],
    completeSnapshot: true,
    observedAt: 121_000
  });
  assert.deepEqual(await repository.expireClaudeAgentStates({ observedAt: 152_000 }), {
    changed: true
  });
  assert.deepEqual(await repository.expireClaudeAgentStates({ observedAt: 153_000 }), {
    changed: false
  }, 'expired Claude leases must be a changed-only provider-safe reconciliation');
  assert.equal(
    db.prepare('SELECT runtime_state FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeSessionKey).runtime_state,
    'unknown',
    'a complete Agent View snapshot must expire an omitted active row only after its lease'
  );
  assert.deepEqual(await repository.getClaudeOpenTarget({ sessionKey: claudeSessionKey }), {
    sessionKey: claudeSessionKey,
    desktopSessionId: `local_${claudeThreadId}`,
    iterm2SessionId: null,
    transcriptPath: `/tmp/project/${claudeThreadId}.jsonl`,
    runtimeState: 'unknown'
  });
  db.prepare(
    `UPDATE eyes_on_agents_thread
     SET transcript_identity_ambiguous = 1, transcript_activity_at = 153500
     WHERE session_key = ?`
  ).run(claudeSessionKey);
  const preservedBeforeDirectoryChange = { ...db.prepare(
    `SELECT desktop_session_id, domain_id, title, cwd, project_key, project_root, project_name,
      archive_state, runtime_state, active_flags_json, active_turn_id, last_completed_turn_id,
      last_completed_at, last_opened_turn_id, last_opened_at, is_unread, status_source,
      status_observed_at, status_fresh_until, last_activity_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) };
  assert.deepEqual(await repository.clearClaudeTranscriptCapabilities(), { changed: true });
  assert.deepEqual({ ...db.prepare(
    `SELECT transcript_path, transcript_identity_ambiguous, transcript_activity_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) }, {
    transcript_path: null,
    transcript_identity_ambiguous: 0,
    transcript_activity_at: null
  }, 'a directory replacement must revoke only stale transcript capability fields');
  assert.deepEqual({ ...db.prepare(
    `SELECT desktop_session_id, domain_id, title, cwd, project_key, project_root, project_name,
      archive_state, runtime_state, active_flags_json, active_turn_id, last_completed_turn_id,
      last_completed_at, last_opened_turn_id, last_opened_at, is_unread, status_source,
      status_observed_at, status_fresh_until, last_activity_at
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeSessionKey) }, preservedBeforeDirectoryChange,
  'directory replacement must preserve task, Domain, unread, archive, Desktop ID, title, and runtime state');
  assert.deepEqual(await repository.clearClaudeTranscriptCapabilities(), { changed: false });
  await repository.upsertClaudeInventory({
    threads: [{
      threadId: claudeThreadId,
      desktopSessionId: null,
      transcriptPath: `/tmp/project/${claudeThreadId}.jsonl`,
      transcriptEvidenceComplete: true,
      title: null,
      cwd: null,
      archiveState: 'unknown',
      transcriptActivityAt: 153_500,
      lastActivityAt: null,
      observedAt: 153_500
    }]
  });
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [{
      threadId: claudeThreadId,
      desktopSessionId: null,
      transcriptPath: null,
      clearDesktopSessionId: true,
      clearTranscriptPath: true,
      title: null,
      cwd: null,
      archiveState: 'unknown',
      lastActivityAt: null,
      observedAt: 153_000
    }]
  }), { changed: true });
  assert.deepEqual(await repository.getClaudeOpenTarget({ sessionKey: claudeSessionKey }), {
    sessionKey: claudeSessionKey,
    desktopSessionId: null,
    iterm2SessionId: null,
    transcriptPath: null,
    runtimeState: 'unknown'
  }, 'ambiguous provider identities must revoke Open/Preview capability without deleting the task');
  assert.equal(
    db.prepare('SELECT domain_id FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeSessionKey).domain_id,
    claudeDomain.id
  );

  const collisionA = '56565656-5656-4565-8565-565656565656';
  const collisionB = '67676767-6767-4676-8767-676767676767';
  const sharedDesktopId = `local_${collisionA}`;
  await repository.upsertClaudeInventory({ threads: [
    {
      threadId: collisionA, desktopSessionId: sharedDesktopId, transcriptPath: null,
      title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 160_000
    },
    {
      threadId: collisionB, desktopSessionId: sharedDesktopId, transcriptPath: null,
      title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 160_000
    }
  ] });
  assert.equal((await repository.getClaudeOpenTarget({ sessionKey: claudeKey(collisionA) })).desktopSessionId, null);
  assert.equal((await repository.getClaudeOpenTarget({ sessionKey: claudeKey(collisionB) })).desktopSessionId, null);
  await repository.upsertClaudeInventory({ threads: [{
    threadId: collisionA, desktopSessionId: sharedDesktopId, transcriptPath: null,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 161_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(collisionA) })).desktopSessionId,
    null,
    'a partial poll must not pick a winner after a reverse Desktop identity collision'
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: collisionA, desktopSessionId: sharedDesktopId, transcriptPath: null,
    desktopEvidenceComplete: true,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 162_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(collisionA) })).desktopSessionId,
    sharedDesktopId,
    'only complete Desktop evidence may resolve a persisted identity ambiguity'
  );

  const remapThread = '78787878-7878-4787-8787-787878787878';
  const remapOriginal = `local_${remapThread}`;
  const remapReplacement = `local_${collisionB}`;
  await repository.upsertClaudeInventory({ threads: [{
    threadId: remapThread, desktopSessionId: remapOriginal, transcriptPath: null,
    desktopEvidenceComplete: true,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 170_000
  }] });
  await repository.upsertClaudeInventory({ threads: [{
    threadId: remapThread, desktopSessionId: remapReplacement, transcriptPath: null,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 171_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(remapThread) })).desktopSessionId,
    null,
    'a partial Desktop ID remap must immediately revoke the stale Open capability'
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: remapThread, desktopSessionId: remapReplacement, transcriptPath: null,
    desktopEvidenceComplete: true,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 172_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(remapThread) })).desktopSessionId,
    remapReplacement,
    'complete unique Desktop evidence must resolve an ID remap'
  );

  const transcriptRemapThread = '89898989-8989-4898-8989-898989898989';
  const transcriptOld = `/tmp/old/${transcriptRemapThread}.jsonl`;
  const transcriptNew = `/tmp/new/${transcriptRemapThread}.jsonl`;
  await repository.upsertClaudeInventory({ threads: [{
    threadId: transcriptRemapThread, desktopSessionId: null, transcriptPath: transcriptOld,
    transcriptEvidenceComplete: true,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 180_000
  }] });
  await repository.upsertClaudeInventory({ threads: [{
    threadId: transcriptRemapThread, desktopSessionId: null, transcriptPath: transcriptNew,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 181_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(transcriptRemapThread) })).transcriptPath,
    null,
    'a partial transcript remap must immediately revoke the stale Preview capability'
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: transcriptRemapThread, desktopSessionId: null, transcriptPath: transcriptNew,
    transcriptEvidenceComplete: true,
    title: null, cwd: null, archiveState: 'unknown', lastActivityAt: null, observedAt: 182_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(transcriptRemapThread) })).transcriptPath,
    transcriptNew,
    'complete unique transcript evidence must resolve a path remap'
  );

  const iterm2Thread = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
  const iterm2SessionIdA = 'w0t0p0:99999999-9999-4999-8999-999999999999';
  const iterm2SessionIdB = 'w1t2p3:88888888-8888-4888-8888-888888888888';
  await repository.upsertClaudeInventory({ threads: [{
    threadId: iterm2Thread, desktopSessionId: null, iterm2SessionId: iterm2SessionIdA,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 190_000, observedAt: 190_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).iterm2SessionId,
    iterm2SessionIdA
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: iterm2Thread, desktopSessionId: null, iterm2SessionId: null,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 191_000, observedAt: 191_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).iterm2SessionId,
    iterm2SessionIdA,
    'a later event with no terminal identity must not clear an already-stored iterm2SessionId'
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: iterm2Thread, desktopSessionId: null, iterm2SessionId: iterm2SessionIdB,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 192_000, observedAt: 192_000
  }] });
  assert.equal(
    (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).iterm2SessionId,
    iterm2SessionIdB,
    'a later event with a new terminal identity must replace the stored iterm2SessionId'
  );
  const iterm2DesktopId = `local_${iterm2Thread}`;
  await repository.upsertClaudeInventory({ threads: [{
    threadId: iterm2Thread, desktopSessionId: iterm2DesktopId, iterm2SessionId: null,
    desktopEvidenceComplete: true,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 193_000, observedAt: 193_000
  }] });
  assert.deepEqual({
    desktopSessionId:
      (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).desktopSessionId,
    iterm2SessionId:
      (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).iterm2SessionId
  }, {
    desktopSessionId: iterm2DesktopId,
    iterm2SessionId: iterm2SessionIdB
  }, 'setting desktop_session_id must not disturb the independently preserved iterm2SessionId');
  await repository.upsertClaudeInventory({ threads: [{
    threadId: iterm2Thread, desktopSessionId: null, iterm2SessionId: iterm2SessionIdA,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 194_000, observedAt: 194_000
  }] });
  assert.deepEqual({
    desktopSessionId:
      (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).desktopSessionId,
    iterm2SessionId:
      (await repository.getClaudeOpenTarget({ sessionKey: claudeKey(iterm2Thread) })).iterm2SessionId
  }, {
    desktopSessionId: iterm2DesktopId,
    iterm2SessionId: iterm2SessionIdA
  }, 'replacing iterm2SessionId must not disturb the independently preserved desktop_session_id');

  const claudeConfigDirThread = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';
  const claudeConfigDirA = '/tmp/claude-environments/claude2';
  const claudeConfigDirB = '/tmp/claude-environments/claude3';
  const readClaudeConfigDirThread = async () => (
    (await repository.getSnapshot()).threads.find(
      (thread) => thread.threadId === claudeConfigDirThread
    )
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeConfigDirThread, desktopSessionId: null, claudeConfigDir: claudeConfigDirA,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 195_000, observedAt: 195_000
  }] });
  assert.equal((await readClaudeConfigDirThread()).claudeConfigDir, claudeConfigDirA);
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeConfigDirThread, desktopSessionId: null, claudeConfigDir: null,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 196_000, observedAt: 196_000
  }] });
  assert.equal(
    (await readClaudeConfigDirThread()).claudeConfigDir,
    claudeConfigDirA,
    'a later event with no claudeConfigDir must not clear an already-stored value'
  );
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeConfigDirThread, desktopSessionId: null, claudeConfigDir: claudeConfigDirB,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 197_000, observedAt: 197_000
  }] });
  assert.equal(
    (await readClaudeConfigDirThread()).claudeConfigDir,
    claudeConfigDirB,
    'a later event with a new claudeConfigDir must replace the stored value'
  );
  const claudeConfigDirDesktopId = `local_${claudeConfigDirThread}`;
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeConfigDirThread, desktopSessionId: claudeConfigDirDesktopId,
    claudeConfigDir: null, desktopEvidenceComplete: true,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 198_000, observedAt: 198_000
  }] });
  assert.deepEqual({
    desktopSessionId: (await readClaudeConfigDirThread()).desktopSessionId,
    claudeConfigDir: (await readClaudeConfigDirThread()).claudeConfigDir
  }, {
    desktopSessionId: claudeConfigDirDesktopId,
    claudeConfigDir: claudeConfigDirB
  }, 'setting desktop_session_id must not disturb the independently preserved claudeConfigDir');
  const iterm2SessionIdForClaudeConfigDirThread = 'w2t0p0:77777777-7777-4777-8777-777777777777';
  await repository.upsertClaudeInventory({ threads: [{
    threadId: claudeConfigDirThread, desktopSessionId: null,
    iterm2SessionId: iterm2SessionIdForClaudeConfigDirThread, claudeConfigDir: null,
    transcriptPath: null, title: null, cwd: null, archiveState: 'unknown',
    lastActivityAt: 199_000, observedAt: 199_000
  }] });
  assert.deepEqual({
    desktopSessionId: (await readClaudeConfigDirThread()).desktopSessionId,
    iterm2SessionId: (await readClaudeConfigDirThread()).iterm2SessionId,
    claudeConfigDir: (await readClaudeConfigDirThread()).claudeConfigDir
  }, {
    desktopSessionId: claudeConfigDirDesktopId,
    iterm2SessionId: iterm2SessionIdForClaudeConfigDirThread,
    claudeConfigDir: claudeConfigDirB
  }, 'setting iterm2SessionId must not disturb the independently preserved desktop_session_id or claudeConfigDir');

  await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: claudeThreadId, runtimeState: 'idle', title: 'Agent View overwrite', cwd: null,
      startedAt: null, observedAt: 190_000
    }, {
      threadId: collisionB, runtimeState: 'idle', title: 'Agent View fallback', cwd: null,
      startedAt: null, observedAt: 190_000
    }],
    completeSnapshot: true,
    observedAt: 190_000
  });
  assert.equal(
    db.prepare('SELECT title FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeSessionKey).title,
    'Claude audit renamed',
    'Agent View names must not overwrite a Desktop conversation title'
  );
  assert.equal(
    db.prepare('SELECT title FROM eyes_on_agents_thread WHERE session_key = ?').get(claudeKey(collisionB)).title,
    'Agent View fallback',
    'Agent View names may fill a missing title'
  );

  const deletionSource = '/tmp/claude-code-sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const deletedCliThread = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
  const deletedDesktopIdentity = 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1';
  const deletedDesktopSession = `local_${deletedDesktopIdentity}`;
  await repository.upsertDiscoveredThreads({
    threads: [{
      threadId: deletedCliThread,
      title: 'Codex identity twin',
      cwd: '/tmp/codex-twin',
      project: null,
      runtimeState: 'unknown',
      activeFlags: [],
      statusSource: 'discovery',
      statusObservedAt: null,
      lastActivityAt: 199_000
    }]
  });
  await repository.upsertClaudeInventory({ threads: [{
    threadId: deletedCliThread,
    desktopSessionId: deletedDesktopSession,
    desktopMetadataMtime: 199_000,
    transcriptPath: `/tmp/project/${deletedCliThread}.jsonl`,
    title: 'Claude deletion audit',
    cwd: '/tmp/project',
    archiveState: 'active',
    lastActivityAt: 199_000,
    observedAt: 199_000
  }] });
  await repository.moveThread({
    sessionKey: claudeKey(deletedCliThread),
    domainId: claudeDomain.id
  });
  const preDeletePromptDelivery = '91919191-9191-4191-8191-919191919191';
  const preDeleteStopDelivery = '92929292-9292-4292-8292-929292929292';
  await repository.applyRuntimeEventDelivery({
    deliveryId: preDeletePromptDelivery,
    event: {
      type: 'turn_started',
      threadId: deletedCliThread,
      turnId: null,
      observedAt: 200_000,
      source: 'claude_hook'
    },
    hookLastUserPrompt: { preview: 'Question that deletion must clear', truncated: false }
  });
  await repository.applyRuntimeEventDelivery({
    deliveryId: preDeleteStopDelivery,
    event: {
      type: 'turn_completed',
      threadId: deletedCliThread,
      turnId: preDeleteStopDelivery,
      observedAt: 201_000,
      source: 'claude_hook',
      outcome: 'completed'
    }
  });
  const preservedReceiptCounts = { ...db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM eyes_on_agents_hook_delivery_receipt
       WHERE delivery_id IN (?, ?)) AS hook_count,
      (SELECT COUNT(*) FROM eyes_on_agents_completion_alert_receipt
       WHERE session_key = ?) AS completion_count`
  ).get(preDeletePromptDelivery, preDeleteStopDelivery, claudeKey(deletedCliThread)) };
  const cliDeletion = {
    tombstones: [{
      sourceKey: deletionSource,
      identityId: deletedCliThread,
      deletedAt: 202_000,
      observedAt: 203_000
    }],
    healthyScopeKeys: [deletionSource],
    completeSnapshot: false,
    observedAt: 203_000
  };
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [],
    deletion: cliDeletion
  }), { changed: true }, 'a CLI-ID tombstone must hide an existing Claude row');
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [],
    deletion: cliDeletion
  }), { changed: false }, 'a duplicate tombstone must be projection-idempotent');
  const deletedRow = { ...db.prepare(
    `SELECT domain_id, archive_state, is_deleted, deleted_at, desktop_session_id,
      transcript_path, title, cwd, project_key, project_root, project_name,
      runtime_state, active_turn_id, last_completed_turn_id, last_completed_at,
      last_opened_turn_id, last_opened_at, is_unread, status_source,
      status_observed_at, status_fresh_until, last_activity_at,
      last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_source
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(deletedCliThread)) };
  assert.deepEqual(deletedRow, {
    domain_id: claudeDomain.id,
    archive_state: 'active',
    is_deleted: 1,
    deleted_at: 202_000,
    desktop_session_id: deletedDesktopSession,
    transcript_path: null,
    title: null,
    cwd: null,
    project_key: null,
    project_root: null,
    project_name: null,
    runtime_state: 'unknown',
    active_turn_id: null,
    last_completed_turn_id: null,
    last_completed_at: null,
    last_opened_turn_id: null,
    last_opened_at: null,
    is_unread: 0,
    status_source: 'discovery',
    status_observed_at: null,
    status_fresh_until: null,
    last_activity_at: null,
    last_user_prompt_preview: null,
    last_user_prompt_turn_id: null,
    last_user_prompt_at: null,
    last_user_prompt_source: null
  }, 'deletion must preserve identity/Domain/archive while revoking transient capabilities');
  assert.equal(
    (await repository.getSnapshot()).threads.some((thread) =>
      thread.sessionKey === claudeKey(deletedCliThread)),
    false,
    'deleted Claude rows must be absent from every renderer snapshot'
  );
  assert.equal(
    (await repository.getSnapshot()).threads.some((thread) =>
      thread.sessionKey === codexKey(deletedCliThread)),
    true,
    'the same tombstone identity must not affect Codex persistence'
  );
  assert.equal(await repository.getClaudeOpenTarget({
    sessionKey: claudeKey(deletedCliThread)
  }), null, 'deleted rows must expose neither Open nor Preview capability');
  await assert.rejects(
    repository.markOpened({ sessionKey: claudeKey(deletedCliThread), openedAt: 203_100 }),
    /not found/
  );
  await assert.rejects(
    repository.moveThread({ sessionKey: claudeKey(deletedCliThread), domainId: claudeDomain.id }),
    /not found/
  );
  assert.deepEqual({ ...db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM eyes_on_agents_hook_delivery_receipt
       WHERE delivery_id IN (?, ?)) AS hook_count,
      (SELECT COUNT(*) FROM eyes_on_agents_completion_alert_receipt
       WHERE session_key = ?) AS completion_count`
  ).get(preDeletePromptDelivery, preDeleteStopDelivery, claudeKey(deletedCliThread)) },
  preservedReceiptCounts, 'soft deletion must preserve content-free deduplication receipts');

  const desktopDeletedThread = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1';
  const desktopDeletedIdentity = 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1';
  await repository.upsertClaudeInventory({ threads: [{
    threadId: desktopDeletedThread,
    desktopSessionId: `local_${desktopDeletedIdentity}`,
    desktopMetadataMtime: 204_000,
    transcriptPath: null,
    title: 'Desktop identity deletion',
    cwd: null,
    archiveState: 'archived',
    lastActivityAt: 204_000,
    observedAt: 204_000
  }] });
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [],
    deletion: {
      tombstones: [{
        sourceKey: deletionSource,
        identityId: desktopDeletedIdentity,
        deletedAt: 205_000,
        observedAt: 205_500
      }],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: false,
      observedAt: 205_500
    }
  }), { changed: true }, 'a unique Desktop-ID tombstone must hide its mapped Claude row');
  assert.equal(await repository.getClaudeOpenTarget({
    sessionKey: claudeKey(desktopDeletedThread)
  }), null);
  assert.equal(
    db.prepare(
      'SELECT archive_state FROM eyes_on_agents_thread WHERE session_key = ?'
    ).get(claudeKey(desktopDeletedThread)).archive_state,
    'archived',
    'deletion must remain independent from Claude archive state'
  );

  const simultaneousThread = 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2';
  const simultaneousDesktopIdentity = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [{
      threadId: simultaneousThread,
      desktopSessionId: `local_${simultaneousDesktopIdentity}`,
      desktopMetadataMtime: 205_000,
      desktopEvidenceComplete: true,
      transcriptPath: `/tmp/stale/${simultaneousThread}.jsonl`,
      title: 'Simultaneous stale metadata',
      cwd: '/tmp/stale',
      archiveState: 'active',
      lastActivityAt: 205_000,
      observedAt: 205_500
    }],
    deletion: {
      tombstones: [{
        sourceKey: deletionSource,
        identityId: simultaneousThread,
        deletedAt: 205_250,
        observedAt: 205_500
      }],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: false,
      observedAt: 205_500
    }
  }), { changed: false }, 'a simultaneous valid tombstone must win over stale live metadata');
  assert.deepEqual({ ...db.prepare(
    `SELECT is_deleted, desktop_session_id, title, cwd, transcript_path
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(simultaneousThread)) }, {
    is_deleted: 1,
    desktop_session_id: `local_${simultaneousDesktopIdentity}`,
    title: null,
    cwd: null,
    transcript_path: null
  }, 'the hidden identity stub must bind the pair without restoring display content');

  const ambiguousDesktopA = 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2';
  const ambiguousDesktopB = 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2';
  const ambiguousDesktopIdentity = 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2';
  await repository.upsertClaudeInventory({ threads: [
    {
      threadId: ambiguousDesktopA,
      desktopSessionId: `local_${ambiguousDesktopA}`,
      transcriptPath: null,
      title: null,
      cwd: null,
      archiveState: 'active',
      lastActivityAt: 205_600,
      observedAt: 205_600
    },
    {
      threadId: ambiguousDesktopB,
      desktopSessionId: `local_${ambiguousDesktopB}`,
      transcriptPath: null,
      title: null,
      cwd: null,
      archiveState: 'active',
      lastActivityAt: 205_600,
      observedAt: 205_600
    }
  ] });
  db.prepare(
    `UPDATE eyes_on_agents_thread SET desktop_session_id = ?, desktop_identity_ambiguous = 0
     WHERE provider = 'claude' AND thread_id IN (?, ?)`
  ).run(`local_${ambiguousDesktopIdentity}`, ambiguousDesktopA, ambiguousDesktopB);
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [],
    deletion: {
      tombstones: [{
        sourceKey: deletionSource,
        identityId: ambiguousDesktopIdentity,
        deletedAt: 205_700,
        observedAt: 205_700
      }],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: false,
      observedAt: 205_700
    }
  }), { changed: false }, 'an ambiguous Desktop identity must never batch-delete multiple rows');
  assert.deepEqual(
    db.prepare(
      `SELECT thread_id, is_deleted FROM eyes_on_agents_thread
       WHERE provider = 'claude' AND thread_id IN (?, ?) ORDER BY thread_id`
    ).all(ambiguousDesktopA, ambiguousDesktopB).map((row) => ({ ...row })),
    [
      { thread_id: ambiguousDesktopA, is_deleted: 0 },
      { thread_id: ambiguousDesktopB, is_deleted: 0 }
    ]
  );

  const beforeRowThread = 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1';
  const beforeRowDeletion = {
    tombstones: [{
      sourceKey: deletionSource,
      identityId: beforeRowThread,
      deletedAt: 206_000,
      observedAt: 206_500
    }],
    healthyScopeKeys: [deletionSource],
    completeSnapshot: false,
    observedAt: 206_500
  };
  await repository.upsertClaudeInventory({ threads: [], deletion: beforeRowDeletion });
  await repository.upsertClaudeInventory({ threads: [{
    threadId: beforeRowThread,
    desktopSessionId: null,
    transcriptPath: `/tmp/residual/${beforeRowThread}.jsonl`,
    title: null,
    cwd: '/tmp/residual',
    archiveState: 'unknown',
    transcriptActivityAt: 207_000,
    lastActivityAt: 207_000,
    observedAt: 207_000
  }] });
  assert.deepEqual(await repository.reconcileClaudeAgentStates({
    agents: [{
      threadId: beforeRowThread,
      runtimeState: 'working',
      title: 'Residual Agent View',
      cwd: '/tmp/residual',
      startedAt: 207_000,
      observedAt: 207_100
    }],
    completeSnapshot: true,
    observedAt: 207_100
  }), { changed: false });
  const claudeProofBeforeLateDrop = await repository.getRuntimeReceiptSummary({
    provider: 'claude'
  });
  const latePromptDelivery = '93939393-9393-4393-8393-939393939393';
  const lateStopDelivery = '94949494-9494-4494-8494-949494949494';
  const latePrompt = await repository.applyRuntimeEventDelivery({
    deliveryId: latePromptDelivery,
    event: {
      type: 'turn_started', threadId: beforeRowThread, turnId: null,
      observedAt: 207_200, source: 'claude_hook'
    },
    hookLastUserPrompt: { preview: 'Late question must be dropped', truncated: false }
  });
  const lateStop = await repository.applyRuntimeEventDelivery({
    deliveryId: lateStopDelivery,
    event: {
      type: 'turn_completed', threadId: beforeRowThread, turnId: lateStopDelivery,
      observedAt: 207_300, source: 'claude_hook', outcome: 'completed'
    }
  });
  assert.deepEqual(latePrompt, {
    duplicate: true, created: false, titleMissing: false, completionAlert: null
  });
  assert.deepEqual(lateStop, {
    duplicate: true, created: false, titleMissing: false, completionAlert: null
  }, 'late Stop must be ACK-dropped without notification/sound intent');
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count FROM eyes_on_agents_hook_delivery_receipt
       WHERE delivery_id IN (?, ?)`
    ).get(latePromptDelivery, lateStopDelivery).count,
    2,
    'late deliveries must each persist one receipt so the outbox can drain'
  );
  assert.deepEqual(
    db.prepare(
      `SELECT delivery_id, is_observation_eligible
       FROM eyes_on_agents_hook_delivery_receipt
       WHERE delivery_id IN (?, ?) ORDER BY delivery_id`
    ).all(latePromptDelivery, lateStopDelivery).map((row) => ({ ...row })),
    [latePromptDelivery, lateStopDelivery].sort().map((deliveryId) => ({
      delivery_id: deliveryId,
      is_observation_eligible: 0
    })),
    'ACK-dropped Hook receipts must be durable without becoming observation proof'
  );
  assert.deepEqual(
    await repository.getRuntimeReceiptSummary({ provider: 'claude' }),
    claudeProofBeforeLateDrop,
    'ACK-dropped Hook deliveries must not advance first/last received status'
  );
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM eyes_on_agents_completion_alert_receipt WHERE session_key = ?'
    ).get(claudeKey(beforeRowThread)).count,
    0
  );
  assert.equal(
    (await repository.getSnapshot()).threads.some((thread) =>
      thread.sessionKey === claudeKey(beforeRowThread)),
    false,
    'residual JSONL, Agent View, and late Hooks must not recreate a deleted card'
  );

  const historyOnlySource = '/tmp/claude-code-sessions/cccccccc-cccc-4ccc-8ccc-cccccccccccc/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const historyOnlyThread = 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1';
  await repository.upsertClaudeInventory({
    threads: [],
    deletion: {
      tombstones: [{
        sourceKey: historyOnlySource,
        identityId: historyOnlyThread,
        deletedAt: 207_400,
        observedAt: 207_400
      }],
      healthyScopeKeys: [historyOnlySource],
      completeSnapshot: false,
      observedAt: 207_400
    }
  });
  await repository.upsertClaudeInventory({
    threads: [],
    deletion: {
      tombstones: [],
      healthyScopeKeys: [historyOnlySource],
      completeSnapshot: true,
      observedAt: 207_500
    }
  });
  const historyOnlyDelivery = '95959595-9595-4595-8595-959595959595';
  assert.deepEqual(await repository.applyRuntimeEventDelivery({
    deliveryId: historyOnlyDelivery,
    event: {
      type: 'turn_completed', threadId: historyOnlyThread, turnId: historyOnlyDelivery,
      observedAt: 207_600, source: 'claude_hook', outcome: 'completed'
    }
  }), {
    duplicate: true, created: false, titleMissing: false, completionAlert: null
  }, 'tombstone absence without newer live metadata must keep a never-created identity suppressed');
  assert.deepEqual(
    await repository.getRuntimeReceiptSummary({ provider: 'claude' }),
    claudeProofBeforeLateDrop,
    'history-only deletion barriers must also ACK-drop without observation proof'
  );
  assert.equal(
    db.prepare(
      "SELECT COUNT(*) AS count FROM eyes_on_agents_thread WHERE provider = 'claude' AND thread_id = ?"
    ).get(historyOnlyThread).count,
    0
  );

  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [],
    deletion: {
      tombstones: [],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: false,
      observedAt: 208_000
    }
  }), { changed: false });
  assert.equal(
    db.prepare(
      `SELECT is_active FROM eyes_on_agents_claude_deletion_tombstone
       WHERE source_key = ? AND identity_id = ?`
    ).get(deletionSource, deletedCliThread).is_active,
    1,
    'partial tombstone omission must preserve the active deletion'
  );
  const restoreThread = (metadataMtime, desktopEvidenceComplete, observedAt) => ({
    threadId: deletedCliThread,
    desktopSessionId: deletedDesktopSession,
    desktopMetadataMtime: metadataMtime,
    transcriptPath: `/tmp/project/${deletedCliThread}.jsonl`,
    transcriptEvidenceComplete: true,
    desktopEvidenceComplete,
    title: 'Claude restored',
    cwd: '/tmp/project',
    archiveState: 'active',
    transcriptActivityAt: observedAt,
    lastActivityAt: observedAt,
    observedAt
  });
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [restoreThread(201_999, true, 209_000)],
    deletion: {
      tombstones: [],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: true,
      observedAt: 209_000
    }
  }), { changed: false }, 'older live metadata cannot restore a deleted row');
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [restoreThread(210_000, false, 210_000)]
  }), { changed: false }, 'partial newer metadata cannot restore a deleted row');
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [restoreThread(211_000, true, 211_000)],
    deletion: {
      tombstones: [],
      healthyScopeKeys: [deletionSource],
      completeSnapshot: true,
      observedAt: 211_000
    }
  }), { changed: true }, 'newer unique metadata from a healthy full scan may restore the pair');
  const restoredRow = { ...db.prepare(
    `SELECT domain_id, is_deleted, deleted_at, is_unread, transcript_path,
      last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
      last_user_prompt_source
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(deletedCliThread)) };
  assert.deepEqual(restoredRow, {
    domain_id: claudeDomain.id,
    is_deleted: 0,
    deleted_at: null,
    is_unread: 0,
    transcript_path: `/tmp/project/${deletedCliThread}.jsonl`,
    last_user_prompt_preview: null,
    last_user_prompt_turn_id: null,
    last_user_prompt_at: null,
    last_user_prompt_source: null
  }, 'restore must retain Domain and must not revive an old question/unread state');
  const restoredPromptDelivery = '96969696-9696-4696-8696-969696969696';
  const restoredStopDelivery = '97979797-9797-4797-8797-979797979797';
  await repository.applyRuntimeEventDelivery({
    deliveryId: restoredPromptDelivery,
    event: {
      type: 'turn_started', threadId: deletedCliThread, turnId: null,
      observedAt: 212_000, source: 'claude_hook'
    },
    hookLastUserPrompt: { preview: 'Question after verified restore', truncated: false },
    replayAuthority: 'current_listener'
  });
  await repository.applyRuntimeEventDelivery({
    deliveryId: restoredStopDelivery,
    event: {
      type: 'turn_completed', threadId: deletedCliThread, turnId: null,
      observedAt: 213_000, source: 'claude_hook', outcome: 'completed'
    },
    replayAuthority: 'current_listener'
  });
  assert.deepEqual({ ...db.prepare(
    `SELECT runtime_state, is_unread, last_user_prompt_preview
     FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(deletedCliThread)) }, {
    runtime_state: 'idle',
    is_unread: 1,
    last_user_prompt_preview: 'Question after verified restore'
  }, 'a new Stop after verified restore must establish fresh terminal attention');
  assert.deepEqual(await repository.upsertClaudeInventory({
    threads: [restoreThread(214_000, true, 214_000)]
  }), { changed: true });
  assert.deepEqual({ ...db.prepare(
    `SELECT runtime_state, is_unread FROM eyes_on_agents_thread WHERE session_key = ?`
  ).get(claudeKey(deletedCliThread)) }, {
    runtime_state: 'idle',
    is_unread: 1
  }, 'historical inactive tombstones must not make ordinary inventory clear new attention');
  assert.ok(await repository.getClaudeOpenTarget({
    sessionKey: claudeKey(deletedCliThread)
  }));

  db.close();
  console.log('EyesOnAgents repository tests passed');
} finally {
  delete globalThis.__eyesTestSqliteManager;
  rmSync(buildRoot, { recursive: true, force: true });
}
