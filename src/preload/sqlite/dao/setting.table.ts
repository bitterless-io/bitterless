import { BaseTable } from './base.table';

class SettingTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS setting (
      key TEXT NOT NULL,
      sub_key TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key, sub_key)
    );
  `;
}

export const settingTable = new SettingTable();
