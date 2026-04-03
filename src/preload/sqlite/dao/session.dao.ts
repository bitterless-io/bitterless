import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

export interface SessionRow {
  id: number;
  session_id: string;
  platform: string;
  title: string;
  pinned: number;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SessionInsertParams {
  sessionId: string;
  title?: string;
  platform?: string;
}

class SessionDao extends BaseDao {
  /** Create a new session */
  async create(params: SessionInsertParams): Promise<SessionRow | undefined> {
    const now = Date.now();
    await sqliteHelper.safeRun(
      'INSERT INTO session (session_id, title, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [params.sessionId, params.title ?? 'New Session', params.platform ?? 'bitterless', now, now],
    );
    return sqliteHelper.safeGet<SessionRow>(
      'SELECT * FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }

  /** Get all sessions: pinned first (pinned_at DESC), then by created_at DESC */
  async getAll(): Promise<SessionRow[]> {
    return sqliteHelper.safeAll<SessionRow>(
      'SELECT * FROM session ORDER BY pinned DESC, pinned_at DESC, created_at DESC',
      [],
    );
  }

  /** Get a session by session_id */
  async getBySessionId(params: { sessionId: string }): Promise<SessionRow | undefined> {
    return sqliteHelper.safeGet<SessionRow>(
      'SELECT * FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }

  /** Update session title */
  async updateTitle(params: { sessionId: string; title: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE session SET title = ?, updated_at = ? WHERE session_id = ?',
      [params.title, Date.now(), params.sessionId],
    );
  }

  /** Touch updated_at timestamp */
  async touch(params: { sessionId: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE session SET updated_at = ? WHERE session_id = ?',
      [Date.now(), params.sessionId],
    );
  }

  /** Pin a session */
  async pin(params: { sessionId: string }): Promise<void> {
    const now = Date.now();
    await sqliteHelper.safeRun(
      'UPDATE session SET pinned = 1, pinned_at = ?, updated_at = ? WHERE session_id = ?',
      [now, now, params.sessionId],
    );
  }

  /** Unpin a session */
  async unpin(params: { sessionId: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE session SET pinned = 0, pinned_at = NULL, updated_at = ? WHERE session_id = ?',
      [Date.now(), params.sessionId],
    );
  }

  /** Delete a session by session_id */
  async delete(params: { sessionId: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'DELETE FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }
}

export const sessionDao = new SessionDao();
