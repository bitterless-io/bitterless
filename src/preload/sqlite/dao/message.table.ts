import { BaseTable } from './base.table';

class MessageTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'bitterless',
      created_at INTEGER NOT NULL,
      outer_sender_id TEXT NOT NULL DEFAULT '',
      outer_to_id TEXT NOT NULL DEFAULT '',
      mention_list TEXT NOT NULL DEFAULT '',
      is_group INTEGER NOT NULL DEFAULT 0,
      outer_session_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id);
    CREATE INDEX IF NOT EXISTS idx_message_search ON message(search_text);
  `;
}

export const messageTable = new MessageTable();
