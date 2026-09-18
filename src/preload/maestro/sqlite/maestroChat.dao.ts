import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
const coach = createXpcPreloadEmitter<CoachXpcContract>('CoachXpcHandler')
import type { WorkflowApi } from '@shared/agentWorkflow.api'
const workflows = createXpcPreloadEmitter<WorkflowApi>('WorkflowHandler')
import type {
  MaestroChatApi,
  MaestroChatDetail,
  MaestroChatMessage,
  MaestroChatSession,
  MaestroChatSessionSummary
} from '@maestro-shared/maestroChat.api'
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
  tasks_json: string
  confirm_json: string
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

const STORED_MESSAGE_TYPES = new Set(['files', 'compact', 'task', 'confirm'])

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value || '') as T
  } catch {
    return fallback
  }
}

const normalizeDetail = (detail: MaestroChatDetail | undefined): MaestroChatDetail => ({
  compressedContext: detail?.compressedContext || '',
  titleCustomized: detail?.titleCustomized === true || undefined,
  autoTitlePending: detail?.autoTitlePending === true || undefined,
  titleRevision: typeof detail?.titleRevision === 'number' && Number.isSafeInteger(detail.titleRevision) && detail.titleRevision >= 0 ? detail.titleRevision : undefined,
  titleGeneration: typeof detail?.titleGeneration?.requestId === 'string' && detail.titleGeneration.requestId
    && typeof detail.titleGeneration.firstMessageId === 'string' && detail.titleGeneration.firstMessageId
    && Number.isSafeInteger(detail.titleGeneration.expectedRevision) && detail.titleGeneration.expectedRevision >= 0
    ? { requestId: detail.titleGeneration.requestId, firstMessageId: detail.titleGeneration.firstMessageId, expectedRevision: detail.titleGeneration.expectedRevision }
    : undefined,
  draft: detail?.draft
    ? {
        text: typeof detail.draft.text === 'string' ? detail.draft.text : '',
        files: Array.isArray(detail.draft.files)
          ? detail.draft.files
              .filter((file) => typeof file.path === 'string' && typeof file.name === 'string')
              .map((file) => ({ name: file.name, path: file.path, isDirectory: file.isDirectory === true || undefined }))
          : []
      }
    : undefined,
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

const toMessage = (row: MessageRow): MaestroChatMessage => ({
  id: row.id,
  source: 'cowork',
  role: row.role === 'human' ? 'human' : 'ai',
  type: STORED_MESSAGE_TYPES.has(row.type) ? (row.type as MaestroChatMessage['type']) : 'text',
  content: row.content,
  files: parseJson(row.files_json, []),
  skill: row.skill_json ? parseJson(row.skill_json, undefined as MaestroChatMessage['skill']) : undefined,
  skills: parseJson(row.skills_json, []),
  replay: row.replay_json ? parseJson(row.replay_json, undefined as MaestroChatMessage['replay']) : undefined,
  activity: parseJson(row.activity_json, []),
  tasks: parseJson(row.tasks_json, []),
  confirm: row.confirm_json ? parseJson(row.confirm_json, undefined as MaestroChatMessage['confirm']) : undefined,
  streaming: Boolean(row.streaming),
  error: Boolean(row.error),
  compressed: Boolean(row.compressed),
  promptExcluded: Boolean(row.prompt_excluded),
  compactSummary: row.compact_summary || undefined,
  compactUntilMessageId: row.compact_until_message_id || undefined,
  tokenCount: row.token_count || 0,
  ts: row.ts
})

const toSessionBase = (row: SessionRow): Omit<MaestroChatSession, 'messages'> => ({
  id: row.id,
  operationTabId: row.operation_tab_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at || undefined,
  detail: normalizeDetail(parseJson(row.detail_json, { compressedContext: '' }))
})

/**
 * The history-list projection, written once and shared by the whole-list and single-session reads
 * so the two can never disagree about what a summary is
 * (docs/issues/every-save-recounts-the-whole-history.md).
 *
 * `message_count` is a correlated `COUNT(*)` rather than the previous `LEFT JOIN … GROUP BY`:
 * identical results (a session with no messages counts 0 either way), but each session's count and
 * preview are answered from the `(session_id, sort_order)` index for that one session, which is
 * what makes the single-session form read only its own rows.
 */
const SESSION_SUMMARY_COLUMNS = `
          s.id,
          s.operation_tab_id,
          s.title,
          s.created_at,
          s.updated_at,
          s.archived_at,
          s.detail_json,
          (SELECT COUNT(*) FROM cowork_chat_message WHERE session_id = s.id) AS message_count,
          COALESCE((
            SELECT content FROM cowork_chat_message
            WHERE session_id = s.id AND content != '' AND prompt_excluded = 0 AND type != 'compact'
            ORDER BY sort_order DESC
            LIMIT 1
          ), '') AS preview`

type SessionSummaryRow = SessionRow & { message_count: number; preview: string }

const toSessionSummary = (row: SessionSummaryRow): MaestroChatSessionSummary => ({
  id: row.id,
  operationTabId: row.operation_tab_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at || undefined,
  messageCount: row.message_count || 0,
  preview: row.preview || ''
})

const MESSAGE_COLUMNS = '(id, session_id, source, role, type, content, files_json, skill_json, skills_json, replay_json, activity_json, streaming, error, compressed, prompt_excluded, compact_summary, compact_until_message_id, token_count, ts, sort_order, tasks_json, confirm_json)'

const MESSAGE_INSERT_SQL = `INSERT INTO cowork_chat_message ${MESSAGE_COLUMNS} VALUES (${new Array(22).fill('?').join(', ')})`

// `sort_order` is intentionally absent from the update list: history is append-only, so a row that
// already exists keeps the position it was inserted with.
const MESSAGE_UPSERT_SQL = `${MESSAGE_INSERT_SQL}
  ON CONFLICT(id) DO UPDATE SET
   source = excluded.source, role = excluded.role, type = excluded.type, content = excluded.content,
   files_json = excluded.files_json, skill_json = excluded.skill_json, skills_json = excluded.skills_json,
   replay_json = excluded.replay_json, activity_json = excluded.activity_json, streaming = excluded.streaming,
   error = excluded.error, compressed = excluded.compressed, prompt_excluded = excluded.prompt_excluded,
   compact_summary = excluded.compact_summary, compact_until_message_id = excluded.compact_until_message_id,
   token_count = excluded.token_count, ts = excluded.ts, tasks_json = excluded.tasks_json,
   confirm_json = excluded.confirm_json`

// One binding for both write paths, so an incremental write and a full rewrite can never disagree
// about what a row contains.
const messageRowValues = (message: MaestroChatMessage, sessionId: string, sortOrder: number): unknown[] => [
  message.id,
  sessionId,
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
  sortOrder,
  JSON.stringify(message.tasks || []),
  message.confirm ? JSON.stringify(message.confirm) : ''
]

export class MaestroChatDao extends XpcPreloadHandler implements MaestroChatApi {
  async listSessions(params?: { operationTabId?: string }): Promise<MaestroChatSessionSummary[]> {
    const args: unknown[] = []
    let where = ''
    if (params?.operationTabId) {
      where = 'WHERE s.operation_tab_id = ?'
      args.push(params.operationTabId)
    }
    const rows = sqliteManager.db
      .prepare(
        `SELECT ${SESSION_SUMMARY_COLUMNS}
        FROM cowork_chat_session s
        ${where}
        ORDER BY s.updated_at DESC`
      )
      .all(...args) as SessionSummaryRow[]

    return rows.map(toSessionSummary)
  }

  /**
   * One session's summary, through the SAME projection the list uses.
   *
   * A save changes one session, so re-deriving the counts and previews of every OTHER conversation
   * is work whose result is known in advance to be unchanged. Before the incremental write lanes
   * that recount was hidden — the save already cost the whole session, so the list query was a
   * rounding error. It is not any more
   * (docs/issues/every-save-recounts-the-whole-history.md).
   *
   * Sharing `SESSION_SUMMARY_COLUMNS` is what makes "narrow" safe: `messageCount` and `preview`
   * stay DERIVED, so there is no stored counter that can drift, and the row this returns is
   * byte-identical to the one the list would have produced for the same session.
   *
   * Returns `null` when the session row is gone, so the caller can drop it from the list instead of
   * leaving a stale entry behind.
   */
  async getSessionSummary(params: { id: string }): Promise<MaestroChatSessionSummary | null> {
    const row = sqliteManager.db
      .prepare(`SELECT ${SESSION_SUMMARY_COLUMNS} FROM cowork_chat_session s WHERE s.id = ?`)
      .get(params.id) as SessionSummaryRow | undefined
    return row ? toSessionSummary(row) : null
  }

  async getSession(params: { id: string }): Promise<MaestroChatSession | null> {
    const row = sqliteManager.db
      .prepare('SELECT id, operation_tab_id, title, created_at, updated_at, archived_at, detail_json FROM cowork_chat_session WHERE id = ?')
      .get(params.id) as SessionRow | undefined
    if (!row) return null
    const messages = sqliteManager.db
      .prepare(
        `SELECT id, session_id, source, role, type, content, files_json, skill_json, skills_json, replay_json, activity_json, streaming, error, compressed, prompt_excluded, compact_summary, compact_until_message_id, token_count, ts, sort_order, tasks_json, confirm_json
         FROM cowork_chat_message
         WHERE session_id = ?
         ORDER BY sort_order ASC, ts ASC`
      )
      .all(params.id) as MessageRow[]
    return { ...toSessionBase(row), messages: messages.map(toMessage) }
  }

  // Synchronous on purpose: better-sqlite3 transactions run sync, so this has to be callable from
  // inside one without an await.
  private writeSessionRow(session: MaestroChatSessionMeta): void {
    sqliteManager.db.prepare(
      `INSERT INTO cowork_chat_session (id, operation_tab_id, title, created_at, updated_at, archived_at, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        operation_tab_id = excluded.operation_tab_id,
        title = excluded.title,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        detail_json = excluded.detail_json`
    ).run(
      session.id,
      session.operationTabId,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.archivedAt || null,
      JSON.stringify(normalizeDetail(session.detail))
    )
  }

  /**
   * The session row alone. Used by every save whose change was metadata — title, archive flag,
   * workspace binding, plan — so those never touch message rows at all
   * (docs/issues/session-save-rewrites-the-whole-session.md).
   */
  async saveSessionMeta(params: { session: MaestroChatSessionMeta }): Promise<{ ok: boolean }> {
    this.writeSessionRow(params.session)
    return { ok: true }
  }

  /**
   * Upsert exactly the messages handed over, by primary key, plus the session row. `sortOrder` is
   * written on insert and deliberately left alone on conflict: chat history is append-only, so an
   * existing message's position never changes, and re-stamping it would be the rewrite this exists
   * to avoid.
   */
  async saveMessages(params: {
    session: MaestroChatSessionMeta
    messages: Array<MaestroChatMessage & { sortOrder: number }>
  }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const upsertMessage = db.prepare(MESSAGE_UPSERT_SQL)
    const run = db.transaction(() => {
      this.writeSessionRow(params.session)
      for (const message of params.messages) upsertMessage.run(...messageRowValues(message, params.session.id, message.sortOrder))
    })
    run()
    return { ok: true }
  }

  /**
   * Full rewrite. Retained for creation, import and explicit repair only — an ordinary save goes
   * through `saveSessionMeta` / `saveMessages`, whose cost is proportional to what changed.
   */
  async saveSession(params: { session: MaestroChatSession }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const session = params.session
    const deleteMessages = db.prepare('DELETE FROM cowork_chat_message WHERE session_id = ?')
    const insertMessage = db.prepare(MESSAGE_INSERT_SQL)
    const run = db.transaction(() => {
      this.writeSessionRow(session)
      deleteMessages.run(session.id)
      session.messages.forEach((message, index) => {
        insertMessage.run(...messageRowValues(message, session.id, index))
      })
    })
    run()
    return { ok: true }
  }

  async deleteSession(params: { id: string; onlyIfEmpty?: boolean }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    if (params.onlyIfEmpty && db.prepare('SELECT 1 FROM cowork_chat_message WHERE session_id = ? LIMIT 1').get(params.id)) return { ok: false }
    // Stop owned workers and host calls before removing their chat; recheck emptiness in the transaction.
    const stopped = await workflows.stopSession({ sessionId: params.id })
    if (!stopped?.ok) throw new Error('Workflow cleanup was not acknowledged; the chat was kept.')
    const snapshot = await workflows.listRuns({ sessionId: params.id })
    if (!snapshot || snapshot.runs.some((run) => run.status === 'running' || run.status === 'stopping')) {
      throw new Error('Workflow cleanup did not finish; the chat was kept.')
    }
    const result = db.transaction(() => {
      if (params.onlyIfEmpty && db.prepare('SELECT 1 FROM cowork_chat_message WHERE session_id = ? LIMIT 1').get(params.id)) {
        return { ok: false }
      }
      db.prepare('DELETE FROM cowork_chat_message WHERE session_id = ?').run(params.id)
      db.prepare('DELETE FROM cowork_chat_session WHERE id = ?').run(params.id)
      return { ok: true }
    })()
    if (result.ok) {
      const cleaned = await coach.deleteNativeSession({ sessionId: params.id })
      if (!cleaned?.ok) throw new Error('The chat was deleted, but its native context could not be removed.')
    }
    return result
  }
}

export const maestroChatDao = new MaestroChatDao()
