import type Database from 'better-sqlite3-multiple-ciphers';
import type { SqliteMigration } from '../common/sqliteMigration.service';
import type { BaseTable } from './dao/base.table';
import { domainTable } from './dao/domain.table';
import { envTable } from './dao/env.table';
import {
  ensureEyesOnAgentsArchiveSchema,
  ensureEyesOnAgentsHookDeliverySchema,
  ensureEyesOnAgentsLastUserPromptSchema,
  ensureEyesOnAgentsLegacyImport,
  ensureEyesOnAgentsProjectMetadataSchema,
  ensureEyesOnAgentsSyncPersistenceSchema,
} from './dao/eyesOnAgents.migration';
import { eyesOnAgentsTable } from './dao/eyesOnAgents.table';
import { messageTable } from './dao/message.table';
import { migrationTable } from './dao/migration.table';
import { sessionTable } from './dao/session.table';
import { settingTable } from './dao/setting.table';
import { sortTable } from './dao/sort.table';
import { subTodoTable } from './dao/subTodo.table';
import { todoEventTable } from './dao/todoEvent.table';
import { todoTable } from './dao/todo.table';

interface TableColumnInfo {
  name: string;
}

const tableExists = (db: Database.Database, tableName: string): boolean => {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
};

const getTableColumns = (
  db: Database.Database,
  tableName: string,
): TableColumnInfo[] => {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
};

const addColumnIfMissing = (
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void => {
  const columns = getTableColumns(db, tableName);
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
};

const copySettingRows = (
  db: Database.Database,
  sourceTable: string,
  targetTable: string,
  conflictPolicy: 'IGNORE' | 'REPLACE',
): void => {
  if (!tableExists(db, sourceTable)) return;
  const sourceColumns = getTableColumns(db, sourceTable);
  const subKey = sourceColumns.some((column) => column.name === 'sub_key')
    ? 'sub_key'
    : "''";
  db.exec(`
    INSERT OR ${conflictPolicy} INTO ${targetTable} (key, sub_key, value, category, updated_at)
    SELECT key, ${subKey}, value, category, updated_at FROM ${sourceTable};
  `);
};

export const ensureSettingSubKeySchema = (db: Database.Database): void => {
  if (!tableExists(db, 'setting')) return;

  const columns = getTableColumns(db, 'setting');
  const hasSubKey = columns.some((column) => column.name === 'sub_key');
  const hasLegacyTempTable = tableExists(db, 'setting_new');

  if (hasSubKey) {
    if (hasLegacyTempTable) {
      copySettingRows(db, 'setting_new', 'setting', 'IGNORE');
      db.exec('DROP TABLE setting_new;');
    }
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS setting__release_new;
    CREATE TABLE setting__release_new (
      key TEXT NOT NULL,
      sub_key TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key, sub_key)
    );
  `);
  copySettingRows(db, 'setting', 'setting__release_new', 'REPLACE');
  copySettingRows(db, 'setting_new', 'setting__release_new', 'IGNORE');
  db.exec(`
    DROP TABLE setting;
    ALTER TABLE setting__release_new RENAME TO setting;
    DROP TABLE IF EXISTS setting_new;
  `);
};

export const coreSqliteTables: readonly BaseTable[] = [
  sessionTable,
  messageTable,
  settingTable,
  envTable,
  domainTable,
  todoTable,
  subTodoTable,
  todoEventTable,
  sortTable,
  migrationTable,
  eyesOnAgentsTable,
];

export const finalizeCoreSqliteSchema = (db: Database.Database): void => {
  ensureEyesOnAgentsProjectMetadataSchema(db);
  ensureEyesOnAgentsArchiveSchema(db);
  ensureEyesOnAgentsSyncPersistenceSchema(db);
  ensureEyesOnAgentsHookDeliverySchema(db);
  ensureEyesOnAgentsLastUserPromptSchema(db);
};

export const coreSqliteMigrations: readonly SqliteMigration[] = [
  {
    versionCode: '260402000001',
    runner: ensureSettingSubKeySchema,
  },
  {
    versionCode: '260407000005',
    runner: (db) => {
      addColumnIfMissing(db, 'todos', 'note', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    versionCode: '260421000001',
    runner: (db) => {
      addColumnIfMissing(db, 'todos', 'repeat_interval', 'INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    versionCode: '260619000001',
    runner: (db) => {
      addColumnIfMissing(db, 'todos', 'source', "TEXT NOT NULL DEFAULT 'human'");
    },
  },
  {
    versionCode: '260619000002',
    runner: (db) => {
      addColumnIfMissing(db, 'domain', 'description', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    versionCode: '260620000002',
    runner: (db) => {
      addColumnIfMissing(db, 'todos', 'source', "TEXT NOT NULL DEFAULT 'human'");
      addColumnIfMissing(db, 'domain', 'description', "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, 'domain', 'archived', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    versionCode: '260716000001',
    runner: ensureEyesOnAgentsLegacyImport,
  },
  {
    versionCode: '260716000002',
    runner: ensureEyesOnAgentsProjectMetadataSchema,
  },
  {
    versionCode: '260716000003',
    runner: ensureEyesOnAgentsArchiveSchema,
  },
  {
    versionCode: '260716000004',
    runner: ensureEyesOnAgentsSyncPersistenceSchema,
  },
  {
    versionCode: '260716000005',
    runner: ensureEyesOnAgentsHookDeliverySchema,
  },
  {
    versionCode: '260721112925',
    runner: ensureEyesOnAgentsLastUserPromptSchema,
  },
];
