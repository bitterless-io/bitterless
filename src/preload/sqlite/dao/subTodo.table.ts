import { BaseTable } from './base.table';

class SubTodoTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS sub_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export const subTodoTable = new SubTodoTable();
