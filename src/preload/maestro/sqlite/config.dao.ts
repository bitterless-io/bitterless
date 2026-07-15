import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { ConfigApi, ConfigEntry } from '@maestro-shared/config.api'
import { sqliteManager } from './sqliteManager'

interface ConfigRow {
  domain: string
  key: string
  options: string
}

function toEntry(row: ConfigRow): ConfigEntry {
  let options: unknown = null
  try {
    options = row.options ? JSON.parse(row.options) : null
  } catch {
    options = null
  }
  return { domain: row.domain, key: row.key, options }
}

// XpcPreloadHandler subclass: instantiating it (bottom of file) auto-registers
// `xpc:ConfigDao/<method>`, callable from any window via createXpcRendererEmitter<ConfigApi>('ConfigDao').
export class ConfigDao extends XpcPreloadHandler implements ConfigApi {
  async list(params: { domain: string }): Promise<ConfigEntry[]> {
    const rows = sqliteManager.db
      .prepare('SELECT domain, key, options FROM config WHERE domain = ? ORDER BY key')
      .all(params.domain) as ConfigRow[]
    return rows.map(toEntry)
  }

  async get(params: { domain: string; key: string }): Promise<ConfigEntry | null> {
    const row = sqliteManager.db
      .prepare('SELECT domain, key, options FROM config WHERE domain = ? AND key = ?')
      .get(params.domain, params.key) as ConfigRow | undefined
    return row ? toEntry(row) : null
  }

  async upsert(params: { domain: string; key: string; options: unknown }): Promise<{ ok: boolean }> {
    sqliteManager.db
      .prepare(
        `INSERT INTO config (domain, key, options, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(domain, key) DO UPDATE SET options = excluded.options, updated_at = excluded.updated_at`
      )
      .run(params.domain, params.key, JSON.stringify(params.options ?? null), Date.now())
    return { ok: true }
  }

  async remove(params: { domain: string; key: string }): Promise<{ ok: boolean }> {
    sqliteManager.db.prepare('DELETE FROM config WHERE domain = ? AND key = ?').run(params.domain, params.key)
    return { ok: true }
  }
}

export const configDao = new ConfigDao()
