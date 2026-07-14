import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { InjectBtnApi, InjectBtnEntry, InjectBtnInput } from '@cowork-shared/injectBtn.api'
import { sqliteManager } from './sqliteManager'

interface InjectBtnRow {
  domain: string
  skill_title: string
  skill_description: string
  updated_at: number
}

const normalizeDomain = (domain: string): string => domain.trim().toLowerCase()

const normalizeItem = (item: InjectBtnInput): InjectBtnInput | null => {
  const skillTitle = String(item.skillTitle || '').trim()
  if (!skillTitle) return null
  return {
    skillTitle,
    skillDescription: String(item.skillDescription || '').trim()
  }
}

const toEntry = (row: InjectBtnRow): InjectBtnEntry => ({
  domain: row.domain,
  skillTitle: row.skill_title,
  skillDescription: row.skill_description,
  updatedAt: row.updated_at
})

export class InjectBtnDao extends XpcPreloadHandler implements InjectBtnApi {
  async list(params?: { domain?: string }): Promise<InjectBtnEntry[]> {
    const domain = normalizeDomain(params?.domain || '')
    const rows = domain
      ? (sqliteManager.db
          .prepare('SELECT domain, skill_title, skill_description, updated_at FROM inject_btns WHERE domain = ? ORDER BY skill_title')
          .all(domain) as InjectBtnRow[])
      : (sqliteManager.db
          .prepare('SELECT domain, skill_title, skill_description, updated_at FROM inject_btns ORDER BY domain, skill_title')
          .all() as InjectBtnRow[])
    return rows.map(toEntry)
  }

  async upsertMany(params: { domain: string; items: InjectBtnInput[] }): Promise<{ ok: boolean; domain: string; count: number }> {
    const domain = normalizeDomain(params.domain || '')
    if (!domain) return { ok: false, domain, count: 0 }
    const items = (params.items || []).map(normalizeItem).filter((item): item is InjectBtnInput => Boolean(item))
    const stmt = sqliteManager.db.prepare(
      `INSERT INTO inject_btns (domain, skill_title, skill_description, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(domain, skill_title)
       DO UPDATE SET skill_description = excluded.skill_description, updated_at = excluded.updated_at`
    )
    const now = Date.now()
    sqliteManager.db.transaction(() => {
      for (const item of items) stmt.run(domain, item.skillTitle, item.skillDescription, now)
    })()
    return { ok: true, domain, count: items.length }
  }

  async removeDomain(params: { domain: string }): Promise<{ ok: boolean; domain: string; count: number }> {
    const domain = normalizeDomain(params.domain || '')
    if (!domain) return { ok: false, domain, count: 0 }
    const result = sqliteManager.db.prepare('DELETE FROM inject_btns WHERE domain = ?').run(domain)
    return { ok: true, domain, count: Number(result.changes || 0) }
  }
}

export const injectBtnDao = new InjectBtnDao()
