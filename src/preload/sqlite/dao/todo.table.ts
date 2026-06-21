import { BaseTable } from './base.table';

class TodoTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0,
      important INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER,
      repeat_type TEXT,
      repeat_interval INTEGER NOT NULL DEFAULT 1,
      remind_at INTEGER,
      last_remind_at INTEGER,
      last_complete_at INTEGER,
      week_day INTEGER,
      monthly_day INTEGER,
      yearly_day INTEGER,
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'human',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export const todoTable = new TodoTable();
