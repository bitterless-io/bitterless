import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3-multiple-ciphers'
import { compareVersions } from 'compare-versions'
import {
  assertSqliteMigrationManifest,
  runSqliteMigrations,
  SqliteMigrationError,
  type SqliteMigration,
} from '../../src/preload/common/sqliteMigration.service'
import {
  coreSqliteMigrations,
  coreSqliteTables,
  finalizeCoreSqliteSchema,
} from '../../src/preload/sqlite/coreSqlite.release'
import {
  ensureEyesOnAgentsClaudeInventorySchema,
  migrateEyesOnAgentsProviderIdentitySchema,
} from '../../src/preload/sqlite/dao/eyesOnAgents.migration'
import {
  createMaestroSqliteSchema,
  maestroSqliteMigrations,
} from '../../src/preload/maestro/sqlite/maestroSqlite.release'
import {
  applyTodoistSyncMigrations,
  assertTodoistSyncSchemaV1,
  assertTodoistSyncSchemaV2,
  todoistSyncMigrations,
  TodoistSyncMigrationError,
  type TodoistSyncMigration,
  type TodoistSyncMigrationDatabase,
} from '../../src/preload/sqlite/todoistSync/todoistSync.migration'
import {
  applyTrenchIoMigrations,
  assertTrenchIoSchema,
  TRENCH_IO_CHAIN_SCHEMA,
  TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE,
  TRENCH_IO_INITIAL_SCHEMA,
  TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE,
  TRENCH_IO_PERSON_SCHEMA_VERSION_CODE,
  TRENCH_IO_SCHEMA_VERSION_CODE,
  type TrenchIoMigrationDatabase,
} from '../../src/renderer/trench-io/trenchIo.migration'

interface TableColumnInfo {
  name: string
}

interface LedgerRow {
  version_code: string | number
}

interface CoreFixtureOptions {
  settingSubKey: boolean
  note: boolean
  repeatInterval: boolean
  source: boolean
  domainDescription: boolean
  domainArchived: boolean
  eyesStage: 0 | 1 | 2 | 3 | 4
  historicalVersionCode?: string
  codingAgent?: boolean
  legacySettingTemp?: boolean
  providerBlindCurrent?: boolean
  providerAwareCurrent?: boolean
  claudeInventoryCurrent?: boolean
}

interface CoreBaseline {
  name: string
  dbExistedBeforeOpen: boolean
  fixture?: CoreFixtureOptions
}

interface MaestroBaseline {
  name: string
  dbExistedBeforeOpen: boolean
  stage?: 0 | 1 | 2 | 3 | 4 | 5
}

class AuditDatabase {
  private readonly database: DatabaseSync
  private transactionDepth = 0

  constructor(path: string) {
    this.database = new DatabaseSync(path)
  }

  exec(sql: string): void {
    this.database.exec(sql)
  }

  prepare(sql: string): ReturnType<DatabaseSync['prepare']> {
    return this.database.prepare(sql)
  }

  transaction<T>(runner: () => T): () => T {
    return () => {
      const depth = this.transactionDepth
      const savepoint = `audit_migration_${depth}`
      this.transactionDepth += 1
      this.database.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      try {
        const result = runner()
        this.database.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (error) {
        if (depth === 0) {
          this.database.exec('ROLLBACK')
        } else {
          this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          this.database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        }
        throw error
      } finally {
        this.transactionDepth -= 1
      }
    }
  }

  close(): void {
    this.database.close()
  }
}

const openAuditDatabase = (path: string): Database.Database => {
  return new AuditDatabase(path) as unknown as Database.Database
}

const rootDir = resolve(process.cwd())
const packageJson = JSON.parse(
  readFileSync(join(rootDir, 'package.json'), 'utf-8'),
) as { version_code?: unknown; versionCode?: unknown }
assert.equal(packageJson.versionCode, undefined, 'package.json must not contain legacy versionCode')
assert.equal(typeof packageJson.version_code, 'string', 'package.json version_code must be a string')
const currentVersionCode = String(packageJson.version_code)
assert.match(currentVersionCode, /^\d{12}$/, 'package.json version_code must match YYMMDDHHmmss')

const auditDir = mkdtempSync(join(tmpdir(), 'bitterless-sqlite-migration-audit-'))

const getColumns = (db: Database.Database, tableName: string): string[] => {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[])
    .map((column) => column.name)
}

const getScalar = (db: Database.Database, sql: string): unknown =>
  Object.values(db.prepare(sql).get() as Record<string, unknown>)[0]

const assertColumns = (
  db: Database.Database,
  tableName: string,
  expectedColumns: readonly string[],
): void => {
  const columns = getColumns(db, tableName)
  for (const column of expectedColumns) {
    assert(columns.includes(column), `${tableName}.${column} is missing`)
  }
}

const getLedger = (db: Database.Database): string[] => {
  return (db.prepare('SELECT version_code FROM migration ORDER BY id').all() as LedgerRow[])
    .map((row) => String(row.version_code))
}

const assertHealthy = (db: Database.Database): void => {
  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
  assert.equal(integrity.integrity_check, 'ok')
  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all()
  assert.deepEqual(foreignKeyErrors, [])
}

const assertLedgerContains = (
  db: Database.Database,
  expectedVersionCodes: readonly string[],
): void => {
  const ledger = getLedger(db)
  for (const versionCode of expectedVersionCodes) {
    assert(ledger.includes(versionCode), `migration ledger is missing ${versionCode}`)
  }
}

const createMigrationLedger = (db: Database.Database, versionCode?: string): void => {
  db.exec(`
    CREATE TABLE migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_code INTEGER NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  if (versionCode) {
    db.prepare('INSERT INTO migration (version_code) VALUES (?)').run(Number(versionCode))
  }
}

const createCoreFixture = (
  db: Database.Database,
  options: CoreFixtureOptions,
): void => {
  const settingSubKey = options.settingSubKey
    ? "sub_key TEXT NOT NULL DEFAULT '',"
    : ''
  const settingPrimaryKey = options.settingSubKey
    ? 'PRIMARY KEY (key, sub_key)'
    : 'PRIMARY KEY (key)'
  db.exec(`
    CREATE TABLE setting (
      key TEXT NOT NULL,
      ${settingSubKey}
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      ${settingPrimaryKey}
    );
  `)
  if (options.settingSubKey) {
    db.prepare(
      "INSERT INTO setting (key, sub_key, value, category, updated_at) VALUES ('audit-key', '', 'audit-value', 'audit', 1)",
    ).run()
  } else {
    db.prepare(
      "INSERT INTO setting (key, value, category, updated_at) VALUES ('audit-key', 'audit-value', 'audit', 1)",
    ).run()
  }
  if (options.legacySettingTemp) {
    db.exec(`
      CREATE TABLE setting_new (
        key TEXT NOT NULL,
        sub_key TEXT NOT NULL DEFAULT '',
        value TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, sub_key)
      );
      INSERT INTO setting_new (key, sub_key, value, category, updated_at)
      VALUES ('recovered-key', '', 'recovered-value', 'audit', 2);
      INSERT INTO setting_new (key, sub_key, value, category, updated_at)
      VALUES ('audit-key', '', 'stale-value', 'audit', 0);
    `)
  }

  const todoColumns = [
    'id INTEGER PRIMARY KEY AUTOINCREMENT',
    'domain_id INTEGER NOT NULL',
    "title TEXT NOT NULL DEFAULT ''",
    'status INTEGER NOT NULL DEFAULT 0',
    'important INTEGER NOT NULL DEFAULT 0',
    'due_at INTEGER',
    'repeat_type TEXT',
    ...(options.repeatInterval ? ['repeat_interval INTEGER NOT NULL DEFAULT 1'] : []),
    'remind_at INTEGER',
    'last_remind_at INTEGER',
    'last_complete_at INTEGER',
    'week_day INTEGER',
    'monthly_day INTEGER',
    'yearly_day INTEGER',
    ...(options.note ? ["note TEXT NOT NULL DEFAULT ''"] : []),
    ...(options.source ? ["source TEXT NOT NULL DEFAULT 'human'"] : []),
    'is_deleted INTEGER NOT NULL DEFAULT 0',
    'created_at INTEGER NOT NULL',
    'updated_at INTEGER NOT NULL',
  ]
  db.exec(`CREATE TABLE todos (${todoColumns.join(',')});`)
  db.prepare(
    "INSERT INTO todos (id, domain_id, title, created_at, updated_at) VALUES (1, 1, 'audit-todo', 1, 1)",
  ).run()

  const domainColumns = [
    'id INTEGER PRIMARY KEY AUTOINCREMENT',
    "title TEXT NOT NULL DEFAULT 'Untitled'",
    ...(options.domainDescription ? ["description TEXT NOT NULL DEFAULT ''"] : []),
    'is_deleted INTEGER NOT NULL DEFAULT 0',
    ...(options.domainArchived ? ['archived INTEGER NOT NULL DEFAULT 0'] : []),
    'created_at INTEGER NOT NULL',
    'updated_at INTEGER NOT NULL',
  ]
  db.exec(`CREATE TABLE domain (${domainColumns.join(',')});`)
  db.prepare(
    "INSERT INTO domain (id, title, created_at, updated_at) VALUES (1, 'audit-domain', 1, 1)",
  ).run()

  if (options.eyesStage > 0) {
    db.exec(`
      CREATE TABLE eyes_on_agents_domain (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_key TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_index INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        delete_flag TEXT NOT NULL DEFAULT '0',
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (domain_key, delete_flag)
      );
      INSERT INTO eyes_on_agents_domain (
        id, domain_key, title, is_system, created_at, updated_at
      ) VALUES (1, 'uncategorized', 'Uncategorized', 1, 1, 1);
    `)
    const projectColumns = options.eyesStage >= 2
      ? ['project_key TEXT', 'project_root TEXT', 'project_name TEXT']
      : []
    const archiveColumns = options.eyesStage >= 3
      ? ['is_archived INTEGER NOT NULL DEFAULT 0']
      : []
    const unreadColumns = options.eyesStage >= 4
      ? ['is_unread INTEGER NOT NULL DEFAULT 0']
      : []
    db.exec(`
      CREATE TABLE eyes_on_agents_thread (
        thread_id TEXT PRIMARY KEY,
        domain_id INTEGER NOT NULL,
        title TEXT,
        cwd TEXT,
        ${[...projectColumns, ...archiveColumns].join(',')}${projectColumns.length + archiveColumns.length > 0 ? ',' : ''}
        runtime_state TEXT NOT NULL DEFAULT 'unknown',
        active_flags_json TEXT NOT NULL DEFAULT '[]',
        active_turn_id TEXT,
        last_completed_turn_id TEXT,
        last_completed_at INTEGER,
        last_opened_turn_id TEXT,
        last_opened_at INTEGER,
        ${unreadColumns.join(',')}${unreadColumns.length > 0 ? ',' : ''}
        status_source TEXT NOT NULL DEFAULT 'discovery',
        status_observed_at INTEGER,
        last_activity_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (domain_id) REFERENCES eyes_on_agents_domain(id)
      );
      INSERT INTO eyes_on_agents_thread (
        thread_id, domain_id, title, cwd, created_at, updated_at
      ) VALUES (
        '11111111-1111-4111-8111-111111111111', 1, 'audit-thread', '/tmp/audit', 1, 1
      );
    `)
    if (options.eyesStage === 3) {
      db.exec(`
        UPDATE eyes_on_agents_thread
        SET last_completed_turn_id = 'audit-turn', last_completed_at = 2;
      `)
    }
    if (options.eyesStage >= 4) {
      db.exec(`
        UPDATE eyes_on_agents_thread SET is_unread = 1;
        CREATE TABLE eyes_on_agents_thread_snapshot (
          thread_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          is_archived INTEGER NOT NULL DEFAULT 0,
          synced_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO eyes_on_agents_thread_snapshot (
          thread_id, payload_json, is_archived, synced_at, created_at, updated_at
        ) VALUES (
          '11111111-1111-4111-8111-111111111111',
          '{"id":"11111111-1111-4111-8111-111111111111","preview":"audit-private-preview","turns":[]}',
          0, 2, 1, 2
        );
      `)
    }
    if (options.providerBlindCurrent) {
      db.exec(`
        ALTER TABLE eyes_on_agents_thread ADD COLUMN last_user_prompt_preview TEXT;
        ALTER TABLE eyes_on_agents_thread ADD COLUMN last_user_prompt_turn_id TEXT;
        ALTER TABLE eyes_on_agents_thread ADD COLUMN last_user_prompt_at INTEGER;
        ALTER TABLE eyes_on_agents_thread
          ADD COLUMN last_user_prompt_truncated INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE eyes_on_agents_thread ADD COLUMN last_user_prompt_source TEXT;
        ALTER TABLE eyes_on_agents_thread ADD COLUMN last_user_prompt_checked_at INTEGER;
        UPDATE eyes_on_agents_thread
        SET last_completed_turn_id = 'audit-turn',
          last_completed_at = 2,
          is_unread = 1,
          last_user_prompt_preview = 'audit-prompt',
          last_user_prompt_turn_id = 'audit-turn',
          last_user_prompt_at = 2,
          last_user_prompt_source = 'app_server',
          last_user_prompt_checked_at = 2;
        CREATE TABLE eyes_on_agents_hook_delivery_receipt (
          delivery_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          committed_at INTEGER NOT NULL
        );
        INSERT INTO eyes_on_agents_hook_delivery_receipt (
          delivery_id, thread_id, observed_at, committed_at
        ) VALUES (
          'audit-delivery', '11111111-1111-4111-8111-111111111111', 2, 3
        );
        CREATE TABLE eyes_on_agents_completion_alert_receipt (
          thread_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          completed_at INTEGER NOT NULL,
          claimed_at INTEGER NOT NULL,
          PRIMARY KEY (thread_id, turn_id)
        );
        INSERT INTO eyes_on_agents_completion_alert_receipt (
          thread_id, turn_id, completed_at, claimed_at
        ) VALUES (
          '11111111-1111-4111-8111-111111111111', 'audit-turn', 2, 3
        );
      `)
    }
    if (options.providerAwareCurrent) {
      migrateEyesOnAgentsProviderIdentitySchema(db)
    }
    if (options.claudeInventoryCurrent) {
      ensureEyesOnAgentsClaudeInventorySchema(db)
    }
  }

  if (options.codingAgent) {
    db.exec(`
      CREATE TABLE coding_agent_session (
        external_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        title TEXT,
        cwd TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO coding_agent_session (
        external_session_id, provider, title, cwd, created_at, updated_at
      ) VALUES (
        '22222222-2222-4222-8222-222222222222',
        'codex', 'legacy-agent', '/tmp/legacy', 1, 2
      );
    `)
  }

  if (options.historicalVersionCode) {
    createMigrationLedger(db, options.historicalVersionCode)
  }
}

const verifyCoreSchema = (
  db: Database.Database,
  baseline: CoreBaseline,
): void => {
  assertColumns(db, 'setting', ['key', 'sub_key', 'value', 'category', 'updated_at'])
  assertColumns(db, 'todos', ['note', 'repeat_interval', 'source'])
  assertColumns(db, 'domain', ['description', 'archived'])
  assertColumns(db, 'eyes_on_agents_thread', [
    'session_key',
    'provider',
    'thread_id',
    'desktop_session_id',
    'desktop_identity_ambiguous',
    'transcript_path',
    'transcript_identity_ambiguous',
    'status_fresh_until',
    'transcript_activity_at',
    'project_key',
    'project_root',
    'project_name',
    'is_archived',
    'archive_state',
    'is_unread',
  ])
  assertColumns(db, 'eyes_on_agents_thread_snapshot', [
    'session_key',
    'provider',
    'thread_id',
    'payload_json',
    'is_archived',
    'synced_at',
    'created_at',
    'updated_at',
  ])
  assertColumns(db, 'eyes_on_agents_hook_delivery_receipt', [
    'delivery_id',
    'session_key',
    'provider',
    'thread_id',
    'observed_at',
    'committed_at',
  ])
  assertColumns(db, 'eyes_on_agents_completion_alert_receipt', [
    'session_key',
    'provider',
    'thread_id',
    'turn_id',
    'completed_at',
    'claimed_at',
  ])
  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'eyes_on_agents_thread'",
  ).all() as { name: string }[]
  assert(
    indexes.some((index) => index.name === 'idx_eyes_on_agents_thread_domain_project'),
    'EyesOnAgents project index is missing',
  )
  assert(
    indexes.some((index) => index.name === 'idx_eyes_on_agents_thread_archive_activity'),
    'EyesOnAgents archive index is missing',
  )
  assert(
    indexes.some((index) => index.name === 'idx_eyes_on_agents_thread_provider_activity'),
    'EyesOnAgents provider activity index is missing',
  )
  if (baseline.fixture) {
    const setting = db.prepare(
      "SELECT value FROM setting WHERE key = 'audit-key' AND sub_key = ''",
    ).get() as { value: string }
    assert.equal(setting.value, 'audit-value')
    const todo = db.prepare('SELECT title FROM todos WHERE id = 1').get() as { title: string }
    assert.equal(todo.title, 'audit-todo')
    const domain = db.prepare('SELECT title FROM domain WHERE id = 1').get() as { title: string }
    assert.equal(domain.title, 'audit-domain')
    if (baseline.fixture.legacySettingTemp) {
      const recovered = db.prepare(
        "SELECT value FROM setting WHERE key = 'recovered-key' AND sub_key = ''",
      ).get() as { value: string }
      assert.equal(recovered.value, 'recovered-value')
      const leftover = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'setting_new'",
      ).get()
      assert.equal(leftover, undefined)
    }
  }
  if (baseline.fixture?.eyesStage) {
    const thread = db.prepare(
      `SELECT session_key, provider, title, archive_state, is_unread
       FROM eyes_on_agents_thread
       WHERE thread_id = '11111111-1111-4111-8111-111111111111'`,
    ).get() as {
      session_key: string
      provider: string
      title: string
      archive_state: string
      is_unread: number
    }
    assert.equal(thread.session_key, 'codex:11111111-1111-4111-8111-111111111111')
    assert.equal(thread.provider, 'codex')
    assert.equal(thread.archive_state, 'active')
    assert.equal(thread.title, 'audit-thread')
    if (baseline.fixture.eyesStage >= 3) {
      assert.equal(thread.is_unread, 1, 'unread state must survive/backfill across Eyes upgrades')
    }
    if (baseline.fixture.eyesStage >= 4) {
      const raw = db.prepare(
        `SELECT session_key, provider, payload_json
         FROM eyes_on_agents_thread_snapshot
         WHERE thread_id = '11111111-1111-4111-8111-111111111111'`,
      ).get() as { session_key: string; provider: string; payload_json: string }
      assert.equal(raw.session_key, 'codex:11111111-1111-4111-8111-111111111111')
      assert.equal(raw.provider, 'codex')
      assert.equal(
        JSON.parse(raw.payload_json).preview,
        'audit-private-preview',
        'raw inventory snapshots must survive an idempotent current-schema audit',
      )
    }
    if (baseline.fixture.providerBlindCurrent) {
      const prompt = db.prepare(
        `SELECT last_user_prompt_preview FROM eyes_on_agents_thread
         WHERE session_key = 'codex:11111111-1111-4111-8111-111111111111'`,
      ).get() as { last_user_prompt_preview: string }
      assert.equal(prompt.last_user_prompt_preview, 'audit-prompt')
      const hookReceipt = db.prepare(
        `SELECT session_key, provider FROM eyes_on_agents_hook_delivery_receipt
         WHERE delivery_id = 'audit-delivery'`,
      ).get() as { session_key: string; provider: string }
      assert.equal(hookReceipt.session_key, 'codex:11111111-1111-4111-8111-111111111111')
      assert.equal(hookReceipt.provider, 'codex')
      const completionReceipt = db.prepare(
        `SELECT session_key, provider FROM eyes_on_agents_completion_alert_receipt
         WHERE turn_id = 'audit-turn'`,
      ).get() as { session_key: string; provider: string }
      assert.equal(
        completionReceipt.session_key,
        'codex:11111111-1111-4111-8111-111111111111',
      )
      assert.equal(completionReceipt.provider, 'codex')
    }
  }
  if (baseline.fixture?.codingAgent) {
    const imported = db.prepare(
      "SELECT title FROM eyes_on_agents_thread WHERE thread_id = '22222222-2222-4222-8222-222222222222'",
    ).get() as { title: string }
    assert.equal(imported.title, 'legacy-agent')
  }
  assertHealthy(db)
}

const coreBaselines: readonly CoreBaseline[] = [
  { name: 'fresh', dbExistedBeforeOpen: false },
  {
    name: 'pre-ledger',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: false,
      note: false,
      repeatInterval: false,
      source: false,
      domainDescription: false,
      domainArchived: false,
      eyesStage: 0,
      codingAgent: true,
    },
  },
  {
    name: 'ledger-2026032801',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: false,
      note: true,
      repeatInterval: false,
      source: false,
      domainDescription: false,
      domainArchived: false,
      eyesStage: 0,
      historicalVersionCode: '2026032801',
    },
  },
  {
    name: 'ledger-2026040201',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: false,
      source: false,
      domainDescription: false,
      domainArchived: false,
      eyesStage: 0,
      historicalVersionCode: '2026040201',
    },
  },
  {
    name: 'partial-setting-recovery',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: false,
      source: false,
      domainDescription: false,
      domainArchived: false,
      eyesStage: 0,
      historicalVersionCode: '2026040201',
      legacySettingTemp: true,
    },
  },
  {
    name: 'ledger-26062002',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 0,
      historicalVersionCode: '26062002',
    },
  },
  {
    name: 'eyes-26071601',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 1,
      historicalVersionCode: '26071601',
    },
  },
  {
    name: 'eyes-26071602',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 2,
      historicalVersionCode: '26071602',
    },
  },
  {
    name: 'eyes-26071603',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 3,
      historicalVersionCode: '26071603',
    },
  },
  {
    name: 'eyes-260716000003',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 3,
      historicalVersionCode: '260716000003',
    },
  },
  {
    name: 'eyes-260716000004',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 4,
      historicalVersionCode: '260716000004',
    },
  },
  {
    name: 'eyes-current-stamped-provider-blind',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 4,
      historicalVersionCode: '260813155645',
      providerBlindCurrent: true,
    },
  },
  {
    name: 'eyes-provider-aware-before-claude-inventory',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 4,
      historicalVersionCode: '260817143129',
      providerBlindCurrent: true,
      providerAwareCurrent: true,
    },
  },
  {
    name: 'eyes-claude-inventory-before-transcript-heartbeat',
    dbExistedBeforeOpen: true,
    fixture: {
      settingSubKey: true,
      note: true,
      repeatInterval: true,
      source: true,
      domainDescription: true,
      domainArchived: true,
      eyesStage: 4,
      historicalVersionCode: '260817144544',
      providerBlindCurrent: true,
      providerAwareCurrent: true,
      claudeInventoryCurrent: true,
    },
  },
]

const auditCoreBaselines = (): void => {
  for (const baseline of coreBaselines) {
    const dbPath = join(auditDir, `core-${baseline.name}.db`)
    const db = openAuditDatabase(dbPath)
    try {
      db.exec('PRAGMA foreign_keys = ON;')
      if (baseline.fixture) createCoreFixture(db, baseline.fixture)
      for (const table of coreSqliteTables) db.exec(table.createSql)
      const result = runSqliteMigrations({
        db,
        migrations: coreSqliteMigrations,
        currentVersionCode,
        dbExistedBeforeOpen: baseline.dbExistedBeforeOpen,
        logPrefix: `[audit core:${baseline.name}]`,
      })
      finalizeCoreSqliteSchema(db)
      verifyCoreSchema(db, baseline)
      if (baseline.dbExistedBeforeOpen) {
        const checkpoint = baseline.fixture?.historicalVersionCode ?? null
        const expected = coreSqliteMigrations
          .filter((migration) => (
            checkpoint === null || compareVersions(migration.versionCode, checkpoint) > 0
          ))
          .map((migration) => migration.versionCode)
        assert.deepEqual(
          result.appliedVersionCodes,
          expected,
        )
        assertLedgerContains(db, expected)
      } else {
        assert.deepEqual(result.appliedVersionCodes, [])
        assert.equal(result.stampedVersionCode, currentVersionCode)
        assert.deepEqual(getLedger(db), [currentVersionCode])
      }
      console.log(`✓ Core ${baseline.name}`)
    } finally {
      db.close()
    }
  }
}

const maestroCheckpointByStage: Readonly<Record<number, string | null>> = {
  0: null,
  1: '260625000000',
  2: '260627000001',
  3: '260627000002',
  4: '260629210704',
  5: '260705083000',
}

const createMaestroFixture = (db: Database.Database, stage: number): void => {
  db.exec(`
    CREATE TABLE config (
      domain TEXT NOT NULL,
      key TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (domain, key)
    );
    INSERT INTO config (domain, key, options, updated_at)
    VALUES ('audit', 'sentinel', '{}', 1);
  `)
  if (stage === 0) {
    db.exec(`
      CREATE TABLE capture_filter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        type TEXT NOT NULL,
        rule TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_capture_filter_domain ON capture_filter(domain);
      INSERT INTO capture_filter (domain, type, rule, value, updated_at)
      VALUES ('example.com', 'selector', '.audit', 'hide', 1);
      INSERT INTO config (domain, key, options, updated_at)
      VALUES ('capture', 'whitelist-enabled:example.com', '{}', 1);
    `)
  } else {
    db.exec(`
      CREATE TABLE capture_filter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        rule TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO capture_filter (type, rule, value, updated_at)
      VALUES ('selector', '.audit', 'hide', 1);
    `)
  }

  const messageColumns = [
    'id TEXT PRIMARY KEY',
    'session_id TEXT NOT NULL',
    "source TEXT NOT NULL DEFAULT 'cowork'",
    'role TEXT NOT NULL',
    "type TEXT NOT NULL DEFAULT 'text'",
    "content TEXT NOT NULL DEFAULT ''",
    "files_json TEXT NOT NULL DEFAULT '[]'",
    ...(stage >= 4 ? [
      "skill_json TEXT NOT NULL DEFAULT ''",
      "skills_json TEXT NOT NULL DEFAULT '[]'",
      "replay_json TEXT NOT NULL DEFAULT ''",
    ] : []),
    "activity_json TEXT NOT NULL DEFAULT '[]'",
    'streaming INTEGER NOT NULL DEFAULT 0',
    'error INTEGER NOT NULL DEFAULT 0',
    'compressed INTEGER NOT NULL DEFAULT 0',
    ...(stage >= 2 ? ['prompt_excluded INTEGER NOT NULL DEFAULT 0'] : []),
    ...(stage >= 3 ? [
      "compact_summary TEXT NOT NULL DEFAULT ''",
      "compact_until_message_id TEXT NOT NULL DEFAULT ''",
    ] : []),
    'token_count INTEGER NOT NULL DEFAULT 0',
    'ts INTEGER NOT NULL',
    'sort_order INTEGER NOT NULL DEFAULT 0',
    'FOREIGN KEY (session_id) REFERENCES cowork_chat_session(id) ON DELETE CASCADE',
  ]
  db.exec(`
    CREATE TABLE tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cowork_chat_session (
      id TEXT PRIMARY KEY,
      operation_tab_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE cowork_chat_message (${messageColumns.join(',')});
    INSERT INTO cowork_chat_session (
      id, operation_tab_id, title, created_at, updated_at
    ) VALUES ('audit-session', 'audit-tab', 'audit-session', 1, 1);
  `)
  const messageInsertColumns = [
    'id',
    'session_id',
    'role',
    'content',
    'token_count',
    'ts',
    ...(stage >= 2 ? ['prompt_excluded'] : []),
  ]
  const messageInsertValues = [
    "'audit-message'",
    "'audit-session'",
    "'ai'",
    "'Stopped.'",
    stage >= 2 ? '0' : '42',
    '1',
    ...(stage >= 2 ? ['1'] : []),
  ]
  db.exec(`
    INSERT INTO cowork_chat_message (${messageInsertColumns.join(',')})
    VALUES (${messageInsertValues.join(',')});
  `)

  if (stage >= 5) {
    db.exec(`
      CREATE TABLE inject_btns (
        domain TEXT NOT NULL,
        skill_title TEXT NOT NULL,
        skill_description TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (domain, skill_title)
      );
      INSERT INTO inject_btns (domain, skill_title, skill_description, updated_at)
      VALUES ('audit', 'Audit Skill', 'sentinel', 1);
    `)
  }

  createMigrationLedger(db, maestroCheckpointByStage[stage] ?? undefined)
}

const verifyMaestroSchema = (
  db: Database.Database,
  baseline: MaestroBaseline,
): void => {
  assertColumns(db, 'capture_filter', ['id', 'type', 'rule', 'value', 'updated_at'])
  assert(!getColumns(db, 'capture_filter').includes('domain'))
  assertColumns(db, 'cowork_chat_message', [
    'prompt_excluded',
    'compact_summary',
    'compact_until_message_id',
    'skill_json',
    'skills_json',
    'replay_json',
    'tasks_json',
    'confirm_json',
  ])
  assertColumns(db, 'inject_btns', ['domain', 'skill_title', 'skill_description', 'updated_at'])
  if (baseline.dbExistedBeforeOpen) {
    const filter = db.prepare(
      "SELECT rule, value FROM capture_filter WHERE rule = '.audit'",
    ).get() as { rule: string; value: string }
    assert.equal(filter.value, 'hide')
    const message = db.prepare(
      "SELECT prompt_excluded, token_count FROM cowork_chat_message WHERE id = 'audit-message'",
    ).get() as { prompt_excluded: number; token_count: number }
    assert.equal(message.prompt_excluded, 1)
    assert.equal(message.token_count, 0)
    const orphan = db.prepare(
      "SELECT 1 FROM config WHERE domain = 'capture' AND key = 'whitelist-enabled:example.com'",
    ).get()
    assert.equal(orphan, undefined)
  }
  assertHealthy(db)
}

const maestroBaselines: readonly MaestroBaseline[] = [
  { name: 'fresh', dbExistedBeforeOpen: false },
  { name: 'pre-ledger', dbExistedBeforeOpen: true, stage: 0 },
  { name: 'capture-global', dbExistedBeforeOpen: true, stage: 1 },
  { name: 'prompt-excluded', dbExistedBeforeOpen: true, stage: 2 },
  { name: 'compaction', dbExistedBeforeOpen: true, stage: 3 },
  { name: 'skills', dbExistedBeforeOpen: true, stage: 4 },
  { name: 'inject-buttons', dbExistedBeforeOpen: true, stage: 5 },
]

const auditMaestroBaselines = (): void => {
  for (const baseline of maestroBaselines) {
    const dbPath = join(auditDir, `maestro-${baseline.name}.db`)
    const db = openAuditDatabase(dbPath)
    try {
      db.exec('PRAGMA foreign_keys = ON;')
      if (baseline.stage != null) createMaestroFixture(db, baseline.stage)
      createMaestroSqliteSchema(db)
      const result = runSqliteMigrations({
        db,
        migrations: maestroSqliteMigrations,
        currentVersionCode,
        dbExistedBeforeOpen: baseline.dbExistedBeforeOpen,
        logPrefix: `[audit maestro:${baseline.name}]`,
      })
      verifyMaestroSchema(db, baseline)
      if (baseline.dbExistedBeforeOpen) {
        const checkpoint = maestroCheckpointByStage[baseline.stage ?? 0]
        const expected = maestroSqliteMigrations
          .filter((migration) => (
            checkpoint === null || compareVersions(migration.versionCode, checkpoint) > 0
          ))
          .map((migration) => migration.versionCode)
        assert.deepEqual(result.appliedVersionCodes, expected)
        assertLedgerContains(db, expected)
      } else {
        assert.deepEqual(result.appliedVersionCodes, [])
        assert.deepEqual(getLedger(db), [currentVersionCode])
      }
      console.log(`✓ Maestro ${baseline.name}`)
    } finally {
      db.close()
    }
  }
}

interface TodoistLedgerRow {
  version: number
  name: string
}

const todoistV1BaselineColumns = [
  'resource_type',
  'resource_id',
  'sync_revision',
  'payload_json',
  'reconcile_pending',
  'updated_at',
] as const

const todoistV2AppendedBaselineColumns = [
  ...todoistV1BaselineColumns,
  'parent_resource_id',
] as const

const todoistV2EarlyBaselineColumns = [
  'resource_type',
  'resource_id',
  'parent_resource_id',
  'sync_revision',
  'payload_json',
  'reconcile_pending',
  'updated_at',
] as const

const asTodoistMigrationDatabase = (db: Database.Database): TodoistSyncMigrationDatabase => {
  return db as unknown as TodoistSyncMigrationDatabase
}

const getTodoistLedger = (db: Database.Database): TodoistLedgerRow[] => {
  const rows = db.prepare(
    'SELECT version, name FROM todoist_sync_schema ORDER BY version',
  ).all() as TodoistLedgerRow[]
  return rows.map((row) => ({ version: row.version, name: row.name }))
}

const verifyTodoistSchema = (db: Database.Database): void => {
  assertTodoistSyncSchemaV2(asTodoistMigrationDatabase(db))
  assert.deepEqual(
    getTodoistLedger(db),
    todoistSyncMigrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
    })),
  )
  assertHealthy(db)
}

const auditTodoistFresh = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-fresh.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(db))
    verifyTodoistSchema(db)
    assert.deepEqual(getColumns(db, 'todo_sync_baselines'), todoistV2AppendedBaselineColumns)
    console.log('✓ Todoist sync fresh schema-v2')
  } finally {
    db.close()
  }
}

const createTodoistV1Fixture = (
  db: Database.Database,
  alreadyShaped: boolean,
): void => {
  applyTodoistSyncMigrations(
    asTodoistMigrationDatabase(db),
    [todoistSyncMigrations[0]],
  )
  assert.deepEqual(getColumns(db, 'todo_sync_baselines'), todoistV1BaselineColumns)
  assert.equal(db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='todo_sync_baseline_parent'",
  ).get(), undefined)
  if (alreadyShaped) {
    db.exec(`
      ALTER TABLE todo_sync_baselines RENAME TO todo_sync_baselines_pre_parent;
      CREATE TABLE todo_sync_baselines (
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        parent_resource_id TEXT,
        sync_revision TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        reconcile_pending INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (resource_type, resource_id),
        CHECK (resource_type IN ('todo_domain', 'todo', 'sub_todo')),
        CHECK (reconcile_pending IN (0, 1))
      );
      INSERT INTO todo_sync_baselines (
        resource_type, resource_id, sync_revision, payload_json, reconcile_pending, updated_at
      )
      SELECT resource_type, resource_id, sync_revision, payload_json, reconcile_pending, updated_at
      FROM todo_sync_baselines_pre_parent;
      DROP TABLE todo_sync_baselines_pre_parent;
      CREATE INDEX todo_sync_baseline_parent
      ON todo_sync_baselines(resource_type, parent_resource_id, resource_id);
    `)
    assert.deepEqual(getColumns(db, 'todo_sync_baselines'), todoistV2EarlyBaselineColumns)
  }
  db.prepare(
    `INSERT INTO todo_sync_state (
      customer_id, device_id, sync_token, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run('1', 'audit-device', 'audit-token', 1, 1)
  if (alreadyShaped) {
    db.prepare(
      `INSERT INTO todo_sync_baselines (
        resource_type, resource_id, parent_resource_id, sync_revision,
        payload_json, reconcile_pending, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('todo', '00000000000000000002', '00000000000000000001', '7', '{"title":"sentinel"}', 0, 1)
  } else {
    db.prepare(
      `INSERT INTO todo_sync_baselines (
        resource_type, resource_id, sync_revision, payload_json, reconcile_pending, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('todo_domain', '00000000000000000001', '7', '{"title":"sentinel"}', 0, 1)
  }
}

const assertTodoistSentinels = (
  db: Database.Database,
  expectedResourceType: 'todo_domain' | 'todo',
): void => {
  const state = db.prepare(
    'SELECT device_id, sync_token FROM todo_sync_state WHERE customer_id = ?',
  ).get('1') as { device_id: string; sync_token: string }
  assert.equal(state.device_id, 'audit-device')
  assert.equal(state.sync_token, 'audit-token')
  const baseline = db.prepare(
    `SELECT resource_type, payload_json FROM todo_sync_baselines
     WHERE sync_revision = '7'`,
  ).get() as { resource_type: string; payload_json: string }
  assert.equal(baseline.resource_type, expectedResourceType)
  assert.equal(baseline.payload_json, '{"title":"sentinel"}')
}

const auditTodoistPreV2Upgrade = (): void => {
  const dbPath = join(auditDir, 'todoist-pre-v2.db')
  const initial = openAuditDatabase(dbPath)
  try {
    initial.exec('PRAGMA foreign_keys = ON;')
    createTodoistV1Fixture(initial, false)
  } finally {
    initial.close()
  }

  const reopened = openAuditDatabase(dbPath)
  try {
    reopened.exec('PRAGMA foreign_keys = ON;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(reopened))
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(reopened))
    verifyTodoistSchema(reopened)
    assert.deepEqual(getColumns(reopened, 'todo_sync_baselines'), todoistV2AppendedBaselineColumns)
    assertTodoistSentinels(reopened, 'todo_domain')
    console.log('✓ Todoist sync pre-v2 upgrade and sentinel preservation')
  } finally {
    reopened.close()
  }
}

const auditTodoistAlreadyShapedV1Upgrade = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-already-shaped-v1.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    createTodoistV1Fixture(db, true)
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(db))
    verifyTodoistSchema(db)
    assert.deepEqual(getColumns(db, 'todo_sync_baselines'), todoistV2EarlyBaselineColumns)
    assertTodoistSentinels(db, 'todo')
    const baseline = db.prepare(
      `SELECT parent_resource_id FROM todo_sync_baselines
       WHERE resource_type = 'todo'`,
    ).get() as { parent_resource_id: string }
    assert.equal(baseline.parent_resource_id, '00000000000000000001')
    console.log('✓ Todoist sync already-shaped v1-ledger upgrade')
  } finally {
    db.close()
  }
}

const auditTodoistColumnOnlyV1Upgrade = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-column-only-v1.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    createTodoistV1Fixture(db, true)
    db.exec('DROP INDEX todo_sync_baseline_parent;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(db))
    verifyTodoistSchema(db)
    assert.deepEqual(getColumns(db, 'todo_sync_baselines'), todoistV2EarlyBaselineColumns)
    assertTodoistSentinels(db, 'todo')
    console.log('✓ Todoist sync column-only v1-ledger upgrade')
  } finally {
    db.close()
  }
}

const auditTodoistCurrentReopen = (): void => {
  const dbPath = join(auditDir, 'todoist-current-v2.db')
  const initial = openAuditDatabase(dbPath)
  try {
    initial.exec('PRAGMA foreign_keys = ON;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(initial))
  } finally {
    initial.close()
  }
  const reopened = openAuditDatabase(dbPath)
  try {
    reopened.exec('PRAGMA foreign_keys = ON;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(reopened))
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(reopened))
    verifyTodoistSchema(reopened)
    assert.deepEqual(getColumns(reopened, 'todo_sync_baselines'), todoistV2AppendedBaselineColumns)
    console.log('✓ Todoist sync current-v2 reopen and idempotence')
  } finally {
    reopened.close()
  }
}

const auditTodoistIncompleteSchema = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-incomplete.db'))
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE todos (id TEXT PRIMARY KEY, sentinel TEXT NOT NULL);
      INSERT INTO todos (id, sentinel) VALUES ('00000000000000000001', 'preserve-me');
    `)
    assert.throws(
      () => applyTodoistSyncMigrations(asTodoistMigrationDatabase(db)),
      (error: unknown) => error instanceof TodoistSyncMigrationError && error.version === 1,
    )
    const columns = getColumns(db, 'todos')
    assert.deepEqual(columns, ['id', 'sentinel'])
    const sentinel = db.prepare(
      "SELECT sentinel FROM todos WHERE id = '00000000000000000001'",
    ).get() as { sentinel: string }
    assert.equal(sentinel.sentinel, 'preserve-me')
    const ledger = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='todoist_sync_schema'",
    ).get()
    assert.equal(ledger, undefined)
    assertHealthy(db)
    console.log('✓ Todoist sync incomplete schema rollback')
  } finally {
    db.close()
  }
}

const auditTodoistInvalidLedger = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-invalid-ledger.db'))
  try {
    db.exec(`
      CREATE TABLE todoist_sync_schema (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO todoist_sync_schema (version, name, applied_at)
      VALUES (1, 'not-the-runtime-manifest', 1);
    `)
    assert.throws(
      () => applyTodoistSyncMigrations(asTodoistMigrationDatabase(db)),
      /unknown entry 1/,
    )
    assert.deepEqual(getTodoistLedger(db), [
      { version: 1, name: 'not-the-runtime-manifest' },
    ])
    console.log('✓ Todoist sync invalid ledger fail-closed')
  } finally {
    db.close()
  }
}

const auditTodoistV2Rollback = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-v2-rollback.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    createTodoistV1Fixture(db, false)
    const failingV2: readonly TodoistSyncMigration[] = [
      todoistSyncMigrations[0],
      {
        ...todoistSyncMigrations[1],
        up: (migrationDb) => {
          todoistSyncMigrations[1].up(migrationDb)
          migrationDb.exec(`
            UPDATE todo_sync_state SET sync_token = 'must-roll-back' WHERE customer_id = '1';
          `)
          throw new Error('intentional Todoist sync v2 migration failure')
        },
      },
    ]
    assert.throws(
      () => applyTodoistSyncMigrations(asTodoistMigrationDatabase(db), failingV2),
      (error: unknown) => error instanceof TodoistSyncMigrationError && error.version === 2,
    )
    assertTodoistSyncSchemaV1(asTodoistMigrationDatabase(db))
    assert.deepEqual(getTodoistLedger(db), [
      { version: todoistSyncMigrations[0].version, name: todoistSyncMigrations[0].name },
    ])
    assertTodoistSentinels(db, 'todo_domain')
    assert(!getColumns(db, 'todo_sync_baselines').includes('parent_resource_id'))
    const index = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='todo_sync_baseline_parent'",
    ).get()
    assert.equal(index, undefined)
    assertHealthy(db)
    console.log('✓ Todoist sync failed-v2 rollback and sentinel preservation')
  } finally {
    db.close()
  }
}

const auditTodoistInvalidShapedV1 = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-invalid-shaped-v1.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    createTodoistV1Fixture(db, true)
    db.exec(`
      DROP INDEX todo_sync_baseline_parent;
      CREATE INDEX todo_sync_baseline_parent
      ON todo_sync_baselines(parent_resource_id, resource_type, resource_id);
    `)
    assert.throws(
      () => applyTodoistSyncMigrations(asTodoistMigrationDatabase(db)),
      (error: unknown) => error instanceof TodoistSyncMigrationError && error.version === 2,
    )
    assert.deepEqual(getTodoistLedger(db), [
      { version: todoistSyncMigrations[0].version, name: todoistSyncMigrations[0].name },
    ])
    assertTodoistSentinels(db, 'todo')
    assertHealthy(db)
    console.log('✓ Todoist sync invalid already-shaped v1 fails before v2 ledger commit')
  } finally {
    db.close()
  }
}

const auditTodoistFutureMigrationRollback = (): void => {
  const db = openAuditDatabase(join(auditDir, 'todoist-future-rollback.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    applyTodoistSyncMigrations(asTodoistMigrationDatabase(db))
    db.prepare(
      `INSERT INTO todo_sync_state (
        customer_id, device_id, sync_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('1', 'audit-device', 'before-failure', 1, 1)
    const injectedMigrations: readonly TodoistSyncMigration[] = [
      ...todoistSyncMigrations,
      {
        version: 3,
        name: 'audit-injected-failure',
        up: (migrationDb) => {
          migrationDb.exec(`
            UPDATE todo_sync_state SET sync_token = 'must-roll-back' WHERE customer_id = '1';
            CREATE TABLE todoist_rolled_back_probe (id INTEGER PRIMARY KEY);
          `)
          throw new Error('intentional Todoist sync migration failure')
        },
      },
      {
        version: 4,
        name: 'audit-must-not-run',
        up: (migrationDb) => migrationDb.exec(
          'CREATE TABLE todoist_must_not_run (id INTEGER PRIMARY KEY);',
        ),
      },
    ]
    assert.throws(
      () => applyTodoistSyncMigrations(asTodoistMigrationDatabase(db), injectedMigrations),
      (error: unknown) => error instanceof TodoistSyncMigrationError && error.version === 3,
    )
    const state = db.prepare(
      'SELECT sync_token FROM todo_sync_state WHERE customer_id = ?',
    ).get('1') as { sync_token: string }
    assert.equal(state.sync_token, 'before-failure')
    const rolledBackProbe = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='todoist_rolled_back_probe'",
    ).get()
    const mustNotRun = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='todoist_must_not_run'",
    ).get()
    assert.equal(rolledBackProbe, undefined)
    assert.equal(mustNotRun, undefined)
    verifyTodoistSchema(db)
    console.log('✓ Todoist sync future migration rollback and stop')
  } finally {
    db.close()
  }
}

const auditTodoistBaselines = (): void => {
  auditTodoistFresh()
  auditTodoistPreV2Upgrade()
  auditTodoistAlreadyShapedV1Upgrade()
  auditTodoistColumnOnlyV1Upgrade()
  auditTodoistCurrentReopen()
  auditTodoistIncompleteSchema()
  auditTodoistInvalidLedger()
  auditTodoistV2Rollback()
  auditTodoistInvalidShapedV1()
  auditTodoistFutureMigrationRollback()
}

const auditRunnerFailurePolicy = (): void => {
  const db = openAuditDatabase(join(auditDir, 'runner-rollback.db'))
  try {
    createMigrationLedger(db)
    db.exec('CREATE TABLE rollback_probe (value TEXT NOT NULL); INSERT INTO rollback_probe VALUES (\'before\');')
    const migrations: readonly SqliteMigration[] = [
      {
        versionCode: '260716000010',
        runner: "CREATE TABLE committed_probe (value TEXT NOT NULL);",
      },
      {
        versionCode: '260716000011',
        runner: (migrationDb) => {
          migrationDb.exec("UPDATE rollback_probe SET value = 'after'; CREATE TABLE rolled_back_probe (id INTEGER);")
          throw new Error('intentional audit failure')
        },
      },
      {
        versionCode: '260716000012',
        runner: 'CREATE TABLE must_not_run (id INTEGER);',
      },
    ]
    assert.throws(
      () => runSqliteMigrations({
        db,
        migrations,
        currentVersionCode,
        dbExistedBeforeOpen: true,
        logPrefix: '[audit rollback]',
      }),
      (error: unknown) => (
        error instanceof SqliteMigrationError && error.versionCode === '260716000011'
      ),
    )
    const probe = db.prepare('SELECT value FROM rollback_probe').get() as { value: string }
    assert.equal(probe.value, 'before')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    assert(tables.some((table) => table.name === 'committed_probe'))
    assert(!tables.some((table) => table.name === 'rolled_back_probe'))
    assert(!tables.some((table) => table.name === 'must_not_run'))
    assert.deepEqual(getLedger(db), ['260716000010'])
    console.log('✓ Runner rollback and fail-closed policy')
  } finally {
    db.close()
  }
}

const auditManifestValidation = (): void => {
  assert.equal(compareVersions('260402000001', '2026040201'), 1)
  assert.equal(compareVersions('260716000003', '26071603'), 1)
  assert.throws(() => assertSqliteMigrationManifest([
    { versionCode: '260716000001', runner: '' },
    { versionCode: '260716000001', runner: '' },
  ], currentVersionCode))
  assert.throws(() => assertSqliteMigrationManifest([
    { versionCode: '260716000002', runner: '' },
    { versionCode: '260716000001', runner: '' },
  ], currentVersionCode))
  assert.throws(() => assertSqliteMigrationManifest([
    { versionCode: '26071601', runner: '' },
  ], currentVersionCode))
  assert.throws(() => assertSqliteMigrationManifest([
    { versionCode: '261332250061', runner: '' },
  ], currentVersionCode))
  assert.throws(() => assertSqliteMigrationManifest([
    { versionCode: '260717000000', runner: '' },
  ], '260716000000'))
  assertSqliteMigrationManifest(coreSqliteMigrations, currentVersionCode)
  assertSqliteMigrationManifest(maestroSqliteMigrations, currentVersionCode)
  assert.equal(todoistSyncMigrations.length, 2)
  assert.equal(todoistSyncMigrations[0].version, 1)
  assert.equal(todoistSyncMigrations[1].version, 2)
  console.log('✓ Version-code and manifest validation')
}

const asTrenchMigrationDatabase = (db: Database.Database): TrenchIoMigrationDatabase =>
  db as unknown as TrenchIoMigrationDatabase

const auditTrenchIo = (): void => {
  const fresh = openAuditDatabase(join(auditDir, 'trench-fresh.db'))
  try {
    fresh.exec('PRAGMA foreign_keys = ON;')
    applyTrenchIoMigrations(asTrenchMigrationDatabase(fresh), currentVersionCode, 1)
    assertTrenchIoSchema(asTrenchMigrationDatabase(fresh))
    const ledger = fresh.prepare(
      'SELECT version_code FROM trench_schema_migrations ORDER BY version_code',
    ).all() as Array<{ version_code: string }>
    assert.deepEqual(ledger.map(({ version_code }) => version_code), [
      TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE,
      TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE,
      TRENCH_IO_PERSON_SCHEMA_VERSION_CODE,
      TRENCH_IO_SCHEMA_VERSION_CODE,
    ])
    applyTrenchIoMigrations(asTrenchMigrationDatabase(fresh), currentVersionCode, 2)
    assertHealthy(fresh)
    console.log('✓ trench-io fresh/current schema and idempotent reopen')
  } finally {
    fresh.close()
  }

  const upgraded = openAuditDatabase(join(auditDir, 'trench-upgrade-018.db'))
  try {
    upgraded.exec(TRENCH_IO_INITIAL_SCHEMA)
    upgraded.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', 1)
    upgraded.prepare('INSERT INTO trench_repository_state VALUES (1,0,NULL,1)').run()
    applyTrenchIoMigrations(asTrenchMigrationDatabase(upgraded), currentVersionCode, 2)
    assertTrenchIoSchema(asTrenchMigrationDatabase(upgraded))
    assert.deepEqual(getColumns(upgraded, 'trench_index_wallets'), [
      'run_id', 'wallet_account_id', 'chain', 'chain_rank', 'total_profit_usd', 'source_ca_count',
      'profitable_ca_count', 'best_source_rank', 'realized_profit_usd', 'unrealized_profit_usd',
    ])
    assertHealthy(upgraded)
    console.log('✓ trench-io 018 upgrade converges on current person-registry schema')
  } finally {
    upgraded.close()
  }

  const upgraded019 = openAuditDatabase(join(auditDir, 'trench-upgrade-019.db'))
  try {
    upgraded019.exec(TRENCH_IO_CHAIN_SCHEMA)
    upgraded019.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', 1)
    upgraded019.prepare('INSERT INTO trench_schema_migrations VALUES (?,?,?)')
      .run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, 'chain-partitioned-index', 2)
    const currentRun = '11111111-1111-4111-8111-111111111111'
    const historicalRun = '22222222-2222-4222-8222-222222222222'
    const currentUser = '33333333-3333-4333-8333-333333333333'
    const currentExchange = '44444444-4444-4444-8444-444444444444'
    const historicalUser = '55555555-5555-4555-8555-555555555555'
    const candidateOnlyUser = '88888888-8888-4888-8888-888888888888'
    const currentTarget = '99999999-9999-4999-8999-999999999999'
    const insertRun = upgraded019.prepare(`
      INSERT INTO trench_index_runs (
        run_id,request_id,request_fingerprint,trigger,status,started_at,completed_at,target_count,
        candidate_count,eligible_count,published_count,policy_version
      ) VALUES (?,?,?,'reanalyze','completed',1,2,1,0,0,?,'profit-sum-v1')
    `)
    insertRun.run(currentRun, '66666666-6666-4666-8666-666666666666', 'a'.repeat(64), 2)
    insertRun.run(historicalRun, '77777777-7777-4777-8777-777777777777', 'b'.repeat(64), 1)
    upgraded019.prepare(`
      UPDATE trench_index_runs SET candidate_count=1,eligible_count=1 WHERE run_id=?
    `).run(currentRun)
    upgraded019.prepare(`
      INSERT INTO trench_index_targets (
        target_id,chain,canonical_address,address,metadata_observed_at,created_at,updated_at
      ) VALUES (?,'bsc',?,?,1,1,1)
    `).run(currentTarget, '0x9999999999999999999999999999999999999999',
      '0x9999999999999999999999999999999999999999')
    upgraded019.prepare(`
      INSERT INTO trench_index_target_snapshots (
        run_id,target_id,highest_market_cap_kind,observed_at
      ) VALUES (?,?,'unavailable',1)
    `).run(currentRun, currentTarget)
    const insertWallet = upgraded019.prepare(`
      INSERT INTO trench_wallets (
        wallet_id,chain,canonical_address,address,metadata_json,metadata_source,wallet_kind,
        classification_source,classification_updated_at,first_seen_at,last_seen_at,metadata_updated_at
      ) VALUES (?,?,?,?,?,'gmgn',?,'gmgn-addr-type',1,1,1,1)
    `)
    insertWallet.run(currentUser, 'bsc', '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111', '{"walletScore":1}', 'user')
    insertWallet.run(currentExchange, 'bsc', '0x2222222222222222222222222222222222222222',
      '0x2222222222222222222222222222222222222222', '{}', 'exchange')
    insertWallet.run(historicalUser, 'bsc', '0x3333333333333333333333333333333333333333',
      '0x3333333333333333333333333333333333333333', '{}', 'user')
    insertWallet.run(candidateOnlyUser, 'bsc', '0x8888888888888888888888888888888888888888',
      '0x8888888888888888888888888888888888888888', '{}', 'user')
    upgraded019.prepare(`
      INSERT INTO trench_index_wallet_candidates (
        run_id,target_id,wallet_id,source_rank,profit_usd,eligible,evidence_json
      ) VALUES (?,?,?,1,5,1,'{}')
    `).run(currentRun, currentTarget, candidateOnlyUser)
    const insertResult = upgraded019.prepare(`
      INSERT INTO trench_index_wallets (
        run_id,wallet_id,chain,chain_rank,total_profit_usd,source_ca_count,profitable_ca_count,
        best_source_rank
      ) VALUES (?,?,'bsc',?,?,1,1,1)
    `)
    insertResult.run(currentRun, currentUser, 1, 10)
    insertResult.run(currentRun, currentExchange, 2, 20)
    insertResult.run(historicalRun, historicalUser, 1, 30)
    upgraded019.prepare('INSERT INTO trench_repository_state VALUES (1,7,?,2)').run(currentRun)
    applyTrenchIoMigrations(asTrenchMigrationDatabase(upgraded019), currentVersionCode, 3)
    assertTrenchIoSchema(asTrenchMigrationDatabase(upgraded019))
    assert.deepEqual(getColumns(upgraded019, 'trench_wallets'), [
      'wallet_id', 'address_namespace', 'canonical_address', 'address', 'name', 'avatar_url',
      'note', 'metadata_json', 'metadata_source', 'first_seen_at', 'last_seen_at',
      'metadata_updated_at',
    ])
    assert.equal(getScalar(upgraded019, 'SELECT COUNT(*) FROM trench_index_wallets'), 3)
    assert.equal(getScalar(upgraded019, 'SELECT COUNT(*) FROM trench_index_wallet_candidates'), 1)
    assert.equal(getScalar(upgraded019,
      'SELECT revision FROM trench_repository_state WHERE id=1'), 7)
    assert.equal(getScalar(upgraded019,
      'SELECT current_run_id FROM trench_repository_state WHERE id=1'), currentRun)
    const backfilledPeople = upgraded019.prepare(`
      SELECT memberships.wallet_id,persons.status,persons.display_name,
        persons.display_name_source,memberships.link_source
      FROM trench_person_wallets memberships
      JOIN trench_persons persons ON persons.person_id=memberships.person_id
    `).all().map((row) => ({ ...(row as Record<string, unknown>) }))
    assert.deepEqual(backfilledPeople, [{
      wallet_id: currentUser,
      status: 'active',
      display_name: null,
      display_name_source: 'system',
      link_source: 'index-auto',
    }])
    assertHealthy(upgraded019)
    console.log('✓ trench-io 019 upgrade converges on global wallet and person schema')
  } finally {
    upgraded019.close()
  }

  const partial = openAuditDatabase(join(auditDir, 'trench-partial.db'))
  try {
    partial.exec('CREATE TABLE trench_wallets (wallet_id TEXT PRIMARY KEY);')
    assert.throws(() => applyTrenchIoMigrations(
      asTrenchMigrationDatabase(partial),
      currentVersionCode,
      1,
    ), /partial pre-ledger schema/)
    console.log('✓ trench-io partial pre-ledger schema fails closed')
  } finally {
    partial.close()
  }

  const future = openAuditDatabase(join(auditDir, 'trench-future.db'))
  try {
    applyTrenchIoMigrations(asTrenchMigrationDatabase(future), currentVersionCode, 1)
    future.prepare(`
      INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)
    `).run('991231235959', 'future-fixture', 2)
    assert.throws(() => applyTrenchIoMigrations(
      asTrenchMigrationDatabase(future),
      currentVersionCode,
      3,
    ), /exact supported manifest prefix/)
    assertHealthy(future)
    console.log('✓ trench-io future migration fails closed')
  } finally {
    future.close()
  }

  const missingPredecessors = openAuditDatabase(join(auditDir, 'trench-missing-ledger.db'))
  try {
    applyTrenchIoMigrations(asTrenchMigrationDatabase(missingPredecessors), currentVersionCode, 1)
    missingPredecessors.prepare(`
      DELETE FROM trench_schema_migrations WHERE version_code IN (?,?)
    `).run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE)
    assert.throws(() => applyTrenchIoMigrations(
      asTrenchMigrationDatabase(missingPredecessors), currentVersionCode, 2,
    ), /identity or order is invalid/)
    const retainedLedger = missingPredecessors.prepare(`
      SELECT version_code,name FROM trench_schema_migrations ORDER BY version_code
    `).all().map((row) => ({ ...(row as Record<string, unknown>) }))
    assert.deepEqual(retainedLedger, [
      {
        version_code: TRENCH_IO_PERSON_SCHEMA_VERSION_CODE,
        name: 'global-wallet-person-registry',
      },
      {
        version_code: TRENCH_IO_SCHEMA_VERSION_CODE,
        name: 'person-import-ledger',
      },
    ])
    assert.equal(getScalar(missingPredecessors,
      'SELECT revision FROM trench_repository_state WHERE id=1'), 0)
    assertHealthy(missingPredecessors)
    console.log('✓ trench-io current shape with missing predecessor ledger fails closed')
  } finally {
    missingPredecessors.close()
  }

  const unknownLower = openAuditDatabase(join(auditDir, 'trench-unknown-ledger.db'))
  try {
    applyTrenchIoMigrations(asTrenchMigrationDatabase(unknownLower), currentVersionCode, 1)
    unknownLower.prepare(`
      INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)
    `).run('260101000000', 'unknown-lower-fixture', 0)
    assert.throws(() => applyTrenchIoMigrations(
      asTrenchMigrationDatabase(unknownLower), currentVersionCode, 2,
    ), /exact supported manifest prefix/)
    assert.equal(getScalar(unknownLower, 'SELECT COUNT(*) FROM trench_schema_migrations'), 5)
    assert.equal(getScalar(unknownLower,
      'SELECT revision FROM trench_repository_state WHERE id=1'), 0)
    assertHealthy(unknownLower)
    console.log('✓ trench-io unknown lower ledger entry fails closed without mutation')
  } finally {
    unknownLower.close()
  }

  const wrongIdentity = openAuditDatabase(join(auditDir, 'trench-wrong-ledger-name.db'))
  try {
    applyTrenchIoMigrations(asTrenchMigrationDatabase(wrongIdentity), currentVersionCode, 1)
    wrongIdentity.prepare(`
      UPDATE trench_schema_migrations SET name='wrong-name' WHERE version_code=?
    `).run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE)
    assert.throws(() => applyTrenchIoMigrations(
      asTrenchMigrationDatabase(wrongIdentity), currentVersionCode, 2,
    ), /identity or order is invalid/)
    assert.equal(getScalar(wrongIdentity,
      'SELECT revision FROM trench_repository_state WHERE id=1'), 0)
    assertHealthy(wrongIdentity)
    console.log('✓ trench-io known ledger version with wrong identity fails closed')
  } finally {
    wrongIdentity.close()
  }
}

try {
  auditManifestValidation()
  auditRunnerFailurePolicy()
  auditCoreBaselines()
  auditMaestroBaselines()
  auditTodoistBaselines()
  auditTrenchIo()
  console.log(
    `SQLite migration audit passed (${coreBaselines.length} Core + ${maestroBaselines.length} Maestro + 10 Todoist sync + 8 Trench baselines).`,
  )
} finally {
  rmSync(auditDir, { recursive: true, force: true })
}
