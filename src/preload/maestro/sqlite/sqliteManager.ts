import Database from 'better-sqlite3-multiple-ciphers'
import { join, dirname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { totalmem } from 'os'
import { runSqliteMigrations } from '../../common/sqliteMigration.service'
import {
  createMaestroSqliteSchema,
  maestroSqliteMigrations,
} from './maestroSqlite.release'

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

// The encrypted config DB, opened in the sqlite window's preload (Node context, sandbox:false).
class SqliteManager {
  private _db: Database.Database | null = null

  get db(): Database.Database {
    if (!this._db) throw new Error('[coach sqlite] database not initialized')
    return this._db
  }

  // Synchronous: runs during preload module evaluation, so the DB is ready before any
  // xpc handler invocation (handlers register in the same eval, no async gap).
  init(currentVersionCode: string, sqliteKey: string): void {
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
    createMaestroSqliteSchema(db)
    this._db = db
    runSqliteMigrations({
      db,
      migrations: maestroSqliteMigrations,
      currentVersionCode,
      dbExistedBeforeOpen,
      logPrefix: '[coach sqlite]',
    })
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
