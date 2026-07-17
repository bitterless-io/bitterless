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
  createMaestroSqliteSchema,
  maestroSqliteMigrations,
} from '../../src/preload/maestro/sqlite/maestroSqlite.release'

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
    'project_key',
    'project_root',
    'project_name',
    'is_archived',
    'is_unread',
  ])
  assertColumns(db, 'eyes_on_agents_thread_snapshot', [
    'thread_id',
    'payload_json',
    'is_archived',
    'synced_at',
    'created_at',
    'updated_at',
  ])
  assertColumns(db, 'eyes_on_agents_hook_delivery_receipt', [
    'delivery_id',
    'thread_id',
    'observed_at',
    'committed_at',
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
      "SELECT title, is_unread FROM eyes_on_agents_thread WHERE thread_id = '11111111-1111-4111-8111-111111111111'",
    ).get() as { title: string; is_unread: number }
    assert.equal(thread.title, 'audit-thread')
    if (baseline.fixture.eyesStage >= 3) {
      assert.equal(thread.is_unread, 1, 'unread state must survive/backfill across Eyes upgrades')
    }
    if (baseline.fixture.eyesStage >= 4) {
      const raw = db.prepare(
        "SELECT payload_json FROM eyes_on_agents_thread_snapshot WHERE thread_id = '11111111-1111-4111-8111-111111111111'",
      ).get() as { payload_json: string }
      assert.equal(
        JSON.parse(raw.payload_json).preview,
        'audit-private-preview',
        'raw inventory snapshots must survive an idempotent current-schema audit',
      )
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
  console.log('✓ Version-code and manifest validation')
}

try {
  auditManifestValidation()
  auditRunnerFailurePolicy()
  auditCoreBaselines()
  auditMaestroBaselines()
  console.log(
    `SQLite migration audit passed (${coreBaselines.length} Core + ${maestroBaselines.length} Maestro baselines).`,
  )
} finally {
  rmSync(auditDir, { recursive: true, force: true })
}
