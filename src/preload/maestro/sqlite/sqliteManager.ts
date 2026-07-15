import Database from 'better-sqlite3-multiple-ciphers'
import { join, dirname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { totalmem } from 'os'

const CREATE_CONFIG = `
  CREATE TABLE IF NOT EXISTS config (
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, key)
  );
`

// Global capture filter rules, applied to EVERY captured site (no per-site scoping). One row =
// one rule (see captureFilter.api.ts).
const CREATE_CAPTURE_FILTER = `
  CREATE TABLE IF NOT EXISTS capture_filter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    rule TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

// Persisted browser tabs (the home tab strip). One row = one saved (non-pinned) tab; the pinned
// AI-CRMS home tab is synthesized at boot and never stored. See tabs.api.ts.
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

// Schema-version ledger (NOT PRAGMA user_version). Current applied version is
// MAX(version_code); the runner records every applied/skipped migration here.
const CREATE_MIGRATION = `
  CREATE TABLE IF NOT EXISTS migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_code INTEGER NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

type MigrationRunner = string | ((db: Database.Database) => void)

interface MigrationEntry {
  versionCode: number
  runner: MigrationRunner
}

interface TableColumnInfo {
  name: string
}

// Idempotent `ALTER TABLE … ADD COLUMN`, guarded by PRAGMA table_info. Prefer this inside
// migration callbacks over a raw ALTER string so re-running an already-applied migration
// (or a migration whose column a fresh CREATE TABLE already shipped) is a safe no-op.
export const addColumnIfMissing = (
  db: Database.Database,
  table: string,
  column: string,
  def: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnInfo[]
  const exists = columns.some((c) => c.name === column)
  if (exists) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def};`)
}

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

// The encrypted config DB, opened in the sqlite window's preload (Node context, sandbox:false).
class SqliteManager {
  private _db: Database.Database | null = null
  private migrations: MigrationEntry[] = []

  get db(): Database.Database {
    if (!this._db) throw new Error('[coach sqlite] database not initialized')
    return this._db
  }

  // Register a forward (up) migration. Call before init() runs migrations; versionCode must
  // be greater than every prior one (use the build versionCode). See sqlite.preload.ts.
  addMigration(versionCode: number, runner: MigrationRunner): void {
    this.migrations.push({ versionCode, runner })
  }

  // Apply pending migrations on open. Failure policy matches bitterless: catch + skip + still
  // record, so a bad migration never wedges boot. Prefer callback + addColumnIfMissing for
  // idempotency.
  private runMigrations(currentVersionCode: number, dbExistedBeforeOpen: boolean): void {
    const lastRow = this.db
      .prepare('SELECT MAX(version_code) as last FROM migration')
      .get() as { last: number | null }
    let lastVersionCode = lastRow?.last ?? null

    const insertMigration = this.db.prepare('INSERT OR IGNORE INTO migration (version_code) VALUES (?)')

    if (lastVersionCode === null) {
      if (dbExistedBeforeOpen) {
        // Pre-migration install: no ledger yet → run every registered migration.
        lastVersionCode = 0
      } else {
        // Fresh DB: tables were just created with the latest schema, so old ALTER
        // migrations are unnecessary. Stamp the current version and run nothing.
        insertMigration.run(currentVersionCode)
        lastVersionCode = currentVersionCode
      }
    }

    const pending = this.migrations
      .filter((m) => m.versionCode > (lastVersionCode as number))
      .sort((a, b) => a.versionCode - b.versionCode)

    for (const m of pending) {
      console.log('[coach sqlite] running migration:', m.versionCode)
      try {
        if (typeof m.runner === 'string') {
          this.db.exec(m.runner)
        } else {
          m.runner(this.db)
        }
      } catch (err) {
        console.warn(`[coach sqlite] migration ${m.versionCode} failed (skipped):`, err)
      }
      // INSERT OR IGNORE: UNIQUE(version_code) makes re-recording a no-op.
      insertMigration.run(m.versionCode)
    }

    if (pending.length > 0) {
      console.log(`[coach sqlite] executed ${pending.length} migration(s)`)
    }
  }

  // Synchronous: runs during preload module evaluation, so the DB is ready before any
  // xpc handler invocation (handlers register in the same eval, no async gap).
  // `currentVersionCode` comes from out/app-meta.json (read by sqlite.preload.ts).
  init(currentVersionCode: number, sqliteKey: string): void {
    // `app` is main-only; the userData path is passed in via additionalArguments (see
    // sqliteWindow.helper.ts). Fall back to cwd only if absent (shouldn't happen).
    const arg = process.argv.find((a) => a.startsWith('--coach-userdata='))
    const userData = arg ? arg.slice('--coach-userdata='.length) : process.cwd()
    const dbPath = join(userData, 'config', 'config.db')
    mkdirSync(dirname(dbPath), { recursive: true })

    // Must be read BEFORE `new Database` — opening the handle creates the file. Distinguishes
    // a fresh install (stamp-only) from a pre-migration install (run all).
    const dbExistedBeforeOpen = existsSync(dbPath)

    const db = new Database(dbPath)
    // Pragmas follow the host app's Electron + SQLite performance guidance:
    //   - cipher_page_size before the schema is created;
    //   - WAL + memory-tiered mmap/cache + synchronous=NORMAL on every connect;
    //   - a startup `optimize(0x10002)` AFTER the schema exists, so it can analyze it.
    db.pragma(`key=${sqlString(sqliteKey)}`)
    db.pragma('cipher_page_size=8192')
    db.pragma('journal_mode=WAL')
    const mem = totalmem()
    if (mem > 20 * 1024 ** 3) {
      db.pragma('mmap_size=268435456') // 256MB
      db.pragma('cache_size=32768')
    } else if (mem > 10 * 1024 ** 3) {
      db.pragma('mmap_size=134217728') // 128MB
      db.pragma('cache_size=16384')
    } else {
      db.pragma('mmap_size=67108864') // 64MB
      db.pragma('cache_size=8192')
    }
    db.pragma('synchronous=normal')
    // Ensure tables (config + capture_filter + tabs + migration) BEFORE running migrations.
    db.exec(CREATE_CONFIG)
    db.exec(CREATE_CAPTURE_FILTER)
    db.exec(CREATE_TABS)
    db.exec(CREATE_MAESTRO_CHAT_SESSION)
    db.exec(CREATE_MAESTRO_CHAT_MESSAGE)
    db.exec(CREATE_INJECT_BTNS)
    db.exec(CREATE_MIGRATION)
    this._db = db
    this.runMigrations(currentVersionCode, dbExistedBeforeOpen)
    // Startup optimize is a non-critical hint — never let it fail the DB.
    try {
      db.pragma('optimize(0x10002)')
    } catch (err) {
      console.warn('[coach sqlite] optimize skipped:', err)
    }
    console.log('[coach sqlite] config db ready at', dbPath)
  }
}

export const sqliteManager = new SqliteManager()
