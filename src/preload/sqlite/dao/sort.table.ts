import { BaseTable } from './base.table';

class SortTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS sort (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '[]'
    );
  `;
}

export const sortTable = new SortTable();
