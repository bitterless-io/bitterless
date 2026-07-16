import type Database from 'better-sqlite3-multiple-ciphers'
import type { SqliteMigration } from '../../common/sqliteMigration.service'

interface TableColumnInfo {
  name: string
}

const CREATE_CONFIG = `
  CREATE TABLE IF NOT EXISTS config (
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, key)
  );
`

const CREATE_CAPTURE_FILTER = `
  CREATE TABLE IF NOT EXISTS capture_filter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    rule TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

const CREATE_TABS = `
  CREATE TABLE IF NOT EXISTS tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    favicon TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`

const CREATE_MAESTRO_CHAT_SESSION = `
  CREATE TABLE IF NOT EXISTS cowork_chat_session (
    id TEXT PRIMARY KEY,
    operation_tab_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    detail_json TEXT NOT NULL DEFAULT '{}'
  );
`

const CREATE_MAESTRO_CHAT_MESSAGE = `
  CREATE TABLE IF NOT EXISTS cowork_chat_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'cowork',
    role TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    files_json TEXT NOT NULL DEFAULT '[]',
    skill_json TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]',
    replay_json TEXT NOT NULL DEFAULT '',
    activity_json TEXT NOT NULL DEFAULT '[]',
    streaming INTEGER NOT NULL DEFAULT 0,
    error INTEGER NOT NULL DEFAULT 0,
    compressed INTEGER NOT NULL DEFAULT 0,
    prompt_excluded INTEGER NOT NULL DEFAULT 0,
    compact_summary TEXT NOT NULL DEFAULT '',
    compact_until_message_id TEXT NOT NULL DEFAULT '',
    token_count INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES cowork_chat_session(id) ON DELETE CASCADE
  );
`

const CREATE_INJECT_BTNS = `
  CREATE TABLE IF NOT EXISTS inject_btns (
    domain TEXT NOT NULL,
    skill_title TEXT NOT NULL,
    skill_description TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, skill_title)
  );
`

const CREATE_MIGRATION = `
  CREATE TABLE IF NOT EXISTS migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_code INTEGER NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

export const addMaestroColumnIfMissing = (
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnInfo[]
  if (columns.some((item) => item.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}

export const createMaestroSqliteSchema = (db: Database.Database): void => {
  db.exec(CREATE_CONFIG)
  db.exec(CREATE_CAPTURE_FILTER)
  db.exec(CREATE_TABS)
  db.exec(CREATE_MAESTRO_CHAT_SESSION)
  db.exec(CREATE_MAESTRO_CHAT_MESSAGE)
  db.exec(CREATE_INJECT_BTNS)
  db.exec(CREATE_MIGRATION)
}

export const maestroSqliteMigrations: readonly SqliteMigration[] = [
  {
    versionCode: '260625000000',
    runner: (db) => {
      const columns = db.prepare('PRAGMA table_info(capture_filter)').all() as TableColumnInfo[]
      if (!columns.some((column) => column.name === 'domain')) return
      db.exec(`
        DROP INDEX IF EXISTS idx_capture_filter_domain;
        CREATE TABLE capture_filter__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          rule TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO capture_filter__new (type, rule, value, updated_at)
          SELECT type, rule, value, updated_at FROM capture_filter;
        DROP TABLE capture_filter;
        ALTER TABLE capture_filter__new RENAME TO capture_filter;
      `)
      db.prepare(
        "DELETE FROM config WHERE domain = 'capture' AND key LIKE 'whitelist-enabled:%'",
      ).run()
    },
  },
  {
    versionCode: '260627000001',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'prompt_excluded',
        'INTEGER NOT NULL DEFAULT 0',
      )
      db.prepare(
        "UPDATE cowork_chat_message SET prompt_excluded = 1, token_count = 0 WHERE role = 'ai' AND TRIM(content) = 'Stopped.'",
      ).run()
    },
  },
  {
    versionCode: '260627000002',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'compact_summary',
        "TEXT NOT NULL DEFAULT ''",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'compact_until_message_id',
        "TEXT NOT NULL DEFAULT ''",
      )
    },
  },
  {
    versionCode: '260629210704',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'skill_json',
        "TEXT NOT NULL DEFAULT ''",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'skills_json',
        "TEXT NOT NULL DEFAULT '[]'",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'replay_json',
        "TEXT NOT NULL DEFAULT ''",
      )
    },
  },
  {
    versionCode: '260705083000',
    runner: (db) => {
      db.exec(CREATE_INJECT_BTNS)
    },
  },
]
