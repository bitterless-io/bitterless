import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import { generateSearchText } from './messageHelper/searchText.helper';
import { Snowflake } from '@sapphire/snowflake';

const snowflake = new Snowflake(new Date('2026-02-24T00:00:00.000Z'));

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  search_text: string;
  platform: string;
  created_at: number;
}

export interface MessageInsertParams {
  sessionId: string;
  role: string;
  content: string;
  platform?: string;
}

export class MessageDao extends BaseDao {
  /** Insert a new message, returns the inserted message data */
  async insert(params: MessageInsertParams): Promise<MessageRow> {
    const id = snowflake.generate().toString().padStart(19, '0');
    const searchText = generateSearchText(params.content);
    const createdAt = Date.now();
    await sqliteHelper.safeRun(
      'INSERT INTO message (id, session_id, role, content, search_text, platform, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, params.sessionId, params.role, params.content, searchText, params.platform ?? 'bitterless', createdAt],
    );
    return {
      id,
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
      search_text: searchText,
      platform: params.platform ?? 'bitterless',
      created_at: createdAt,
    };
  }

  /** Get message history for a conversation, ordered by id ASC */
  async getHistoryBySessionId(params: { sessionId: string }): Promise<Pick<MessageRow, 'role' | 'content'>[]> {
    return sqliteHelper.safeAll<Pick<MessageRow, 'role' | 'content'>>(
      'SELECT role, content FROM message WHERE session_id = ? ORDER BY id ASC',
      [params.sessionId],
    );
  }

  /** Delete messages from a given index (0-based) onwards for a session */
  async deleteFromIndex(params: { sessionId: string; fromIndex: number }): Promise<void> {
    const rows = await sqliteHelper.safeAll<Pick<MessageRow, 'id'>>(
      'SELECT id FROM message WHERE session_id = ? ORDER BY id ASC',
      [params.sessionId],
    );
    if (params.fromIndex >= rows.length) return;
    const fromId = rows[params.fromIndex].id;
    await sqliteHelper.safeRun(
      'DELETE FROM message WHERE session_id = ? AND id >= ?',
      [params.sessionId, fromId],
    );
  }

  /** Search messages by keyword with pagination */
  async search(params: { keyword: string; page: number; pageSize: number }): Promise<MessageRow[]> {
    const searchText = generateSearchText(params.keyword);
    const offset = (params.page - 1) * params.pageSize;
    return sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE search_text LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [`%${searchText}%`, params.pageSize, offset],
    );
  }

  /** Get messages before a given message id for a session (for scrolling up) */
  async getMessagesBefore(params: { sessionId: string; beforeId: string; limit: number }): Promise<MessageRow[]> {
    return sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
      [params.sessionId, params.beforeId, params.limit],
    );
  }

  /** Get messages after a given message id for a session (for scrolling down) */
  async getMessagesAfter(params: { sessionId: string; afterId: string; limit: number }): Promise<MessageRow[]> {
    return sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
      [params.sessionId, params.afterId, params.limit],
    );
  }

  /** Get initial messages for a session with pagination */
  async getMessagesPaginated(params: { sessionId: string; limit: number }): Promise<MessageRow[]> {
    return sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? ORDER BY id DESC LIMIT ?',
      [params.sessionId, params.limit],
    );
  }

  /** Get messages around a given message id: [limit] before + the target + [limit] after */
  async getMessagesAroundId(params: { sessionId: string; messageId: string; limit: number }): Promise<MessageRow[]> {
    const before = await sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
      [params.sessionId, params.messageId, params.limit],
    );
    const target = await sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? AND id = ?',
      [params.sessionId, params.messageId],
    );
    const after = await sqliteHelper.safeAll<MessageRow>(
      'SELECT * FROM message WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
      [params.sessionId, params.messageId, params.limit],
    );
    return [...before.reverse(), ...target, ...after];
  }
}

export const messageDao = new MessageDao();
