import { XpcPreloadHandler } from 'electron-xpc/preload'
import type {
  CoworkChatApi,
  CoworkChatDetail,
  CoworkChatMessage,
  CoworkChatSession,
  CoworkChatSessionSummary
} from '@cowork-shared/coworkChat.api'
import { sqliteManager } from './sqliteManager'

interface SessionRow {
  id: string
  operation_tab_id: string
  title: string
  created_at: number
  updated_at: number
  archived_at: number | null
  detail_json: string
}

interface MessageRow {
  id: string
  session_id: string
  source: string
  role: string
  type: string
  content: string
  files_json: string
  skill_json: string
  skills_json: string
  replay_json: string
  activity_json: string
  streaming: number
  error: number
  compressed: number
  prompt_excluded: number
  compact_summary: string
  compact_until_message_id: string
  token_count: number
  ts: number
  sort_order: number
}

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value || '') as T
  } catch {
    return fallback
  }
}

const normalizeDetail = (detail: CoworkChatDetail | undefined): CoworkChatDetail => ({
  compressedContext: detail?.compressedContext || '',
  compressedUntilMessageId: detail?.compressedUntilMessageId || undefined,
  compressedAt: detail?.compressedAt || undefined,
  workspace: detail?.workspace?.path
    ? {
        path: detail.workspace.path,
        name: detail.workspace.name || detail.workspace.path,
        exists: detail.workspace.exists !== false,
        updatedAt: detail.workspace.updatedAt || 0
      }
    : undefined
})

const toMessage = (row: MessageRow): CoworkChatMessage => ({
  id: row.id,
  source: 'cowork',
  role: row.role === 'human' ? 'human' : 'ai',
  type: row.type === 'files' || row.type === 'compact' ? row.type : 'text',
  content: row.content,
  files: parseJson(row.files_json, []),
  skill: row.skill_json ? parseJson(row.skill_json, undefined as CoworkChatMessage['skill']) : undefined,
  skills: parseJson(row.skills_json, []),
  replay: row.replay_json ? parseJson(row.replay_json, undefined as CoworkChatMessage['replay']) : undefined,
  activity: parseJson(row.activity_json, []),
  streaming: Boolean(row.streaming),
  error: Boolean(row.error),
  compressed: Boolean(row.compressed),
  promptExcluded: Boolean(row.prompt_excluded),
  compactSummary: row.compact_summary || undefined,
  compactUntilMessageId: row.compact_until_message_id || undefined,
  tokenCount: row.token_count || 0,
  ts: row.ts
})

const toSessionBase = (row: SessionRow): Omit<CoworkChatSession, 'messages'> => ({
  id: row.id,
  operationTabId: row.operation_tab_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at || undefined,
  detail: normalizeDetail(parseJson(row.detail_json, { compressedContext: '' }))
})

export class CoworkChatDao extends XpcPreloadHandler implements CoworkChatApi {
  async listSessions(params?: { operationTabId?: string }): Promise<CoworkChatSessionSummary[]> {
    const args: unknown[] = []
    let where = ''
    if (params?.operationTabId) {
      where = 'WHERE s.operation_tab_id = ?'
      args.push(params.operationTabId)
    }
    const rows = sqliteManager.db
      .prepare(
        `SELECT
          s.id,
          s.operation_tab_id,
          s.title,
          s.created_at,
          s.updated_at,
          s.archived_at,
          s.detail_json,
          COUNT(m.id) AS message_count,
          COALESCE((
            SELECT content FROM cowork_chat_message
            WHERE session_id = s.id AND content != '' AND prompt_excluded = 0 AND type != 'compact'
            ORDER BY sort_order DESC
            LIMIT 1
          ), '') AS preview
        FROM cowork_chat_session s
        LEFT JOIN cowork_chat_message m ON m.session_id = s.id
        ${where}
        GROUP BY s.id
        ORDER BY s.updated_at DESC`
      )
      .all(...args) as Array<SessionRow & { message_count: number; preview: string }>

    return rows.map((row) => ({
      id: row.id,
      operationTabId: row.operation_tab_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at || undefined,
      messageCount: row.message_count || 0,
      preview: row.preview || ''
    }))
  }

  async getSession(params: { id: string }): Promise<CoworkChatSession | null> {
    const row = sqliteManager.db
      .prepare('SELECT id, operation_tab_id, title, created_at, updated_at, archived_at, detail_json FROM cowork_chat_session WHERE id = ?')
      .get(params.id) as SessionRow | undefined
    if (!row) return null
    const messages = sqliteManager.db
      .prepare(
        `SELECT id, session_id, source, role, type, content, files_json, skill_json, skills_json, replay_json, activity_json, streaming, error, compressed, prompt_excluded, compact_summary, compact_until_message_id, token_count, ts, sort_order
         FROM cowork_chat_message
         WHERE session_id = ?
         ORDER BY sort_order ASC, ts ASC`
      )
      .all(params.id) as MessageRow[]
    return { ...toSessionBase(row), messages: messages.map(toMessage) }
  }

  async saveSession(params: { session: CoworkChatSession }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const session = params.session
    const upsertSession = db.prepare(
      `INSERT INTO cowork_chat_session (id, operation_tab_id, title, created_at, updated_at, archived_at, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        operation_tab_id = excluded.operation_tab_id,
        title = excluded.title,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        detail_json = excluded.detail_json`
    )
    const deleteMessages = db.prepare('DELETE FROM cowork_chat_message WHERE session_id = ?')
    const insertMessage = db.prepare(
      `INSERT INTO cowork_chat_message
       (id, session_id, source, role, type, content, files_json, skill_json, skills_json, replay_json, activity_json, streaming, error, compressed, prompt_excluded, compact_summary, compact_until_message_id, token_count, ts, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const run = db.transaction(() => {
      upsertSession.run(
        session.id,
        session.operationTabId,
        session.title,
        session.createdAt,
        session.updatedAt,
        session.archivedAt || null,
        JSON.stringify(normalizeDetail(session.detail))
      )
      deleteMessages.run(session.id)
      session.messages.forEach((message, index) => {
        insertMessage.run(
          message.id,
          session.id,
          message.source,
          message.role,
          message.type || 'text',
          message.content,
          JSON.stringify(message.files || []),
          message.skill ? JSON.stringify(message.skill) : '',
          JSON.stringify(message.skills || []),
          message.replay ? JSON.stringify(message.replay) : '',
          JSON.stringify(message.activity || []),
          message.streaming ? 1 : 0,
          message.error ? 1 : 0,
          message.compressed ? 1 : 0,
          message.promptExcluded ? 1 : 0,
          message.compactSummary || '',
          message.compactUntilMessageId || '',
          message.tokenCount || 0,
          message.ts,
          index
        )
      })
    })
    run()
    return { ok: true }
  }

  async deleteSession(params: { id: string }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    db.transaction(() => {
      db.prepare('DELETE FROM cowork_chat_message WHERE session_id = ?').run(params.id)
      db.prepare('DELETE FROM cowork_chat_session WHERE id = ?').run(params.id)
    })()
    return { ok: true }
  }
}

export const coworkChatDao = new CoworkChatDao()
