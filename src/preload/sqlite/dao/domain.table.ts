import { BaseTable } from './base.table';

class DomainTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS domain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      description TEXT NOT NULL DEFAULT '',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export const domainTable = new DomainTable();
