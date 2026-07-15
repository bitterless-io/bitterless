import type Database from 'better-sqlite3-multiple-ciphers';

interface TableColumnInfo {
  name: string;
}

type MigrationDatabase = Pick<Database.Database, 'exec' | 'prepare'>;

const tableColumns = (db: MigrationDatabase): TableColumnInfo[] => {
  return db.prepare('PRAGMA table_info(coding_agent_session)').all() as TableColumnInfo[];
};

const addColumnIfMissing = (
  db: MigrationDatabase,
  columns: TableColumnInfo[],
  columnName: string,
  columnDefinition: string
): void => {
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE coding_agent_session ADD COLUMN ${columnName} ${columnDefinition};`);
};

export const migrateLegacyCodingAgentSessionTitleOwnership = (db: MigrationDatabase): void => {
  const columns = tableColumns(db);
  const hadCustomTitle = columns.some((column) => column.name === 'custom_title');
  addColumnIfMissing(db, columns, 'provider_title', 'TEXT');
  addColumnIfMissing(db, columns, 'custom_title', 'INTEGER NOT NULL DEFAULT 0');

  if (hadCustomTitle) return;
  db.exec('UPDATE coding_agent_session SET custom_title = 1;');
};
