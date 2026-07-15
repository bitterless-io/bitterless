import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { CaptureFilterApi, CaptureRule } from '@maestro-shared/captureFilter.api'
import { sqliteManager } from './sqliteManager'

interface FilterRow {
  type: string
  rule: string
  value: string
}

const toRule = (r: FilterRow): CaptureRule => ({
  type: r.type === 'whitelist' ? 'whitelist' : 'blacklist',
  rule: r.rule,
  value: r.value
})

// XpcPreloadHandler subclass: instantiating it (bottom of file) auto-registers
// `xpc:CaptureFilterDao/<method>`, callable via createXpcRendererEmitter<CaptureFilterApi>('CaptureFilterDao').
export class CaptureFilterDao extends XpcPreloadHandler implements CaptureFilterApi {
  async listAll(): Promise<CaptureRule[]> {
    const rows = sqliteManager.db
      .prepare('SELECT type, rule, value FROM capture_filter ORDER BY type')
      .all() as FilterRow[]
    return rows.map(toRule)
  }

  // Replace the entire global rule set atomically: drop all rows, then insert the new set.
  async replaceAll(params: { rules: CaptureRule[] }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const del = db.prepare('DELETE FROM capture_filter')
    const ins = db.prepare('INSERT INTO capture_filter (type, rule, value, updated_at) VALUES (?, ?, ?, ?)')
    const now = Date.now()
    const run = db.transaction((rules: CaptureRule[]) => {
      del.run()
      for (const r of rules) {
        const value = (r.value || '').trim()
        if (!value) continue
        ins.run(r.type, r.rule, value, now)
      }
    })
    run(params.rules || [])
    return { ok: true }
  }
}

export const captureFilterDao = new CaptureFilterDao()
