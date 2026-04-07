import { BaseTable } from './base.table';

class MigrationTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_code INTEGER NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `;
}

export const migrationTable = new MigrationTable();
