// Preload for the hidden "sqlite" window. It owns the encrypted config DB (Node context,
// sandbox:false) and exposes it over electron-xpc via ConfigDao — reached from the control
// renderer with createXpcRendererEmitter<ConfigApi>('ConfigDao'). Mirrors bitterless's
// "sqlite lives in a preload" pattern, trimmed to one config table.
import { createXpcPreloadEmitter, XpcPreloadHandler } from 'electron-xpc/preload'
import { join } from 'path'
import { readFileSync, unlinkSync } from 'fs'
import { addColumnIfMissing, sqliteManager } from './sqlite/sqliteManager'
import type { SqliteBootApi, SqliteBootResult, SqliteKeyApi } from '@cowork-shared/sqliteKey.api'

// Current build versionCode, sourced from the bundled out/app-meta.json (written by
// genAppMeta at build time). This file compiles to out/preload/coworkSqlite.js, so app-meta.json
// is one level up. Fallback 0 in dev (electron-vite dev has no app-meta.json) — which makes
// runMigrations stamp a fresh DB at 0 and treat any pre-existing dev DB as needing all
// registered migrations, both harmless.
const getCurrentVersionCode = (): number => {
  try {
    const metaPath = join(__dirname, '../app-meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { versionCode?: number }
    return meta.versionCode ?? 0
  } catch {
    return 0
  }
}

const getArgValue = (prefix: string): string => {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

const readBootstrapToken = (): string => {
  const tokenPath = getArgValue('--coach-sqlite-bootstrap-file=')
  if (!tokenPath) throw new Error('[coach sqlite] missing sqlite bootstrap token file')
  const token = readFileSync(tokenPath, 'utf-8').trim()
  try {
    unlinkSync(tokenPath)
  } catch {
    // Non-fatal: the token value is already in memory and the file is mode 0600.
  }
  return token
}

// Register forward (up) migrations here, ascending by versionCode (use the build versionCode).
// Update the table's CREATE string above so fresh installs get the change directly, then add
// a line below. Prefer the callback + addColumnIfMissing form over a raw ALTER for idempotency:
//   import { addColumnIfMissing } from './sqlite/sqliteManager'
//   sqliteManager.addMigration(<versionCode>, (db) =>
//     addColumnIfMissing(db, 'config', 'newcol', "TEXT NOT NULL DEFAULT ''"))

// capture_filter went GLOBAL (no per-site scoping): drop the now-unused `domain` column on
// pre-existing DBs. Use the portable table-rebuild pattern (CREATE new → copy → drop → rename)
// instead of `ALTER TABLE … DROP COLUMN`, which needs SQLite ≥ 3.35 and — since this project's
// migration runner records a migration as applied even when it throws — would otherwise risk
// silently leaving the old `domain NOT NULL` column and breaking every save. Wrapped in a
// transaction so it is all-or-nothing. Existing per-site rows survive as global rules (exactly
// the new semantics). Guarded by PRAGMA so a fresh table (no `domain` column) is a clean no-op.
sqliteManager.addMigration(260625000000, (db) => {
  const cols = db.prepare('PRAGMA table_info(capture_filter)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'domain')) return
  db.transaction(() => {
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
    // Orphaned per-site whitelist toggles (key `whitelist-enabled:<site>`). The new global
    // toggle uses the colon-less key `whitelist-enabled`, so the LIKE never matches it.
    db.prepare("DELETE FROM config WHERE domain = 'capture' AND key LIKE 'whitelist-enabled:%'").run()
  })()
})

sqliteManager.addMigration(260627000001, (db) => {
  addColumnIfMissing(db, 'cowork_chat_message', 'prompt_excluded', 'INTEGER NOT NULL DEFAULT 0')
  db.prepare(
    "UPDATE cowork_chat_message SET prompt_excluded = 1, token_count = 0 WHERE role = 'ai' AND TRIM(content) = 'Stopped.'"
  ).run()
})

sqliteManager.addMigration(260627000002, (db) => {
  addColumnIfMissing(db, 'cowork_chat_message', 'compact_summary', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'cowork_chat_message', 'compact_until_message_id', "TEXT NOT NULL DEFAULT ''")
})

sqliteManager.addMigration(260629210704, (db) => {
  addColumnIfMissing(db, 'cowork_chat_message', 'skill_json', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'cowork_chat_message', 'skills_json', "TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'cowork_chat_message', 'replay_json', "TEXT NOT NULL DEFAULT ''")
})

sqliteManager.addMigration(260705083000, (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inject_btns (
      domain TEXT NOT NULL,
      skill_title TEXT NOT NULL,
      skill_description TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (domain, skill_title)
    );
  `)
})

const sqliteKeyService = createXpcPreloadEmitter<SqliteKeyApi>('SqliteKeyService')

let bootResult: SqliteBootResult = { ok: false, error: 'SQLite preload has not finished booting.' }

const bootSqlite = async (): Promise<void> => {
  try {
    const bootstrapToken = readBootstrapToken()
    if (!bootstrapToken) throw new Error('[coach sqlite] missing sqlite bootstrap token')

    const sqliteKey = await sqliteKeyService.getSqliteKey({ bootstrapToken })
    if (!sqliteKey) throw new Error('[coach sqlite] main process returned an empty SQLite key')

    sqliteManager.init(getCurrentVersionCode(), sqliteKey)

    // Importing each DAO instantiates its XpcPreloadHandler and registers its channels.
    await import('./sqlite/config.dao')
    await import('./sqlite/capture_filter.dao')
    await import('./sqlite/tabs.dao')
    await import('./sqlite/session.dao')
    await import('./sqlite/cowork_chat.dao')
    await import('./sqlite/inject_btn.dao')

    bootResult = { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    bootResult = { ok: false, error: message }
    console.error('[coach sqlite] init failed:', err)
  }
}

// Electron can evaluate a BrowserWindow preload for its initial about:blank document before the
// requested file navigation. Only the actual hidden SQLite renderer may consume the one-time
// bootstrap token; otherwise the target document's second preload evaluation finds it missing.
const isSqliteRendererDocument = location.pathname.endsWith('/coworkSqlite/index.html')
const bootPromise = isSqliteRendererDocument ? bootSqlite() : Promise.resolve()

export class SqliteBootDao extends XpcPreloadHandler implements SqliteBootApi {
  async ready(): Promise<SqliteBootResult> {
    await bootPromise.catch(() => undefined)
    return bootResult
  }
}

export const sqliteBootDao = new SqliteBootDao()
