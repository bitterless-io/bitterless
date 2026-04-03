import { BaseTable } from './base.table';

class SessionTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'bitterless',
      title TEXT NOT NULL DEFAULT 'New Session',
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, platform)
    );
  `;
}

export const sessionTable = new SessionTable();
