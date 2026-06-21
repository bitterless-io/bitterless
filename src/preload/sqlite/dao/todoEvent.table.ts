import { BaseTable } from './base.table';

class TodoEventTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS todo_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      todo_id INTEGER,
      domain_id INTEGER,
      actor TEXT NOT NULL DEFAULT 'human',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_todo_events_id ON todo_events (id);
    CREATE INDEX IF NOT EXISTS idx_todo_events_todo_id ON todo_events (todo_id);
  `;
}

export const todoEventTable = new TodoEventTable();
