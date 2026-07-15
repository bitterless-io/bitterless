// Disable LangChain from fetching tiktoken vocabulary from external CDN
process.env['LANGCHAIN_CALLBACKS_BACKGROUND'] = 'false';
process.env['TIKTOKEN_CACHE_DIR'] = '';

// Importing xpc/preload auto-exposes xpcRenderer to window
import { XpcPreloadHandler } from 'electron-xpc/preload';
import { sqliteManager } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
// Table imports — register table schemas before init
import { sessionTable } from './dao/session.table';
import { messageTable } from './dao/message.table';
import { settingTable } from './dao/setting.table';
import { envTable } from './dao/env.table';
import { domainTable } from './dao/domain.table';
import { todoTable } from './dao/todo.table';
import { subTodoTable } from './dao/subTodo.table';
import { todoEventTable } from './dao/todoEvent.table';
import { sortTable } from './dao/sort.table';
import { migrationTable } from './dao/migration.table';
import { codingAgentSessionTable } from './dao/codingAgentSession.table';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/session.dao';
import './dao/env.dao';
import './dao/domain.dao';
import './dao/todo.dao';
import './dao/subTodo.dao';
import './dao/todoEvent.dao';
import './dao/codingAgentSession.dao';
import './handler/language.handler';
import './handler/searchEngine.handler';
import { initQdrant } from './qdrantHelper/qdrant.helper';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import * as path from 'path';
import * as fs from 'fs';
import type Database from 'better-sqlite3-multiple-ciphers';
import type {
  CoreSqliteBootApi,
  CoreSqliteBootResult,
} from '@shared/mcp/mcpBridge.shared';

interface TableColumnInfo {
  name: string;
}

const addColumnIfMissing = (
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
  const exists = columns.some((column) => column.name === columnName);
  if (exists) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
};

sqliteManager.addTable(sessionTable);
sqliteManager.addTable(messageTable);
sqliteManager.addTable(settingTable);
sqliteManager.addTable(envTable);
sqliteManager.addTable(domainTable);
sqliteManager.addTable(todoTable);
sqliteManager.addTable(subTodoTable);
sqliteManager.addTable(todoEventTable);
sqliteManager.addTable(sortTable);
sqliteManager.addTable(migrationTable);
sqliteManager.addTable(codingAgentSessionTable);

// Migrations versioncode 来源于当前的 package.json versioncode
sqliteManager.addMigration(26040705, `ALTER TABLE todos ADD COLUMN note TEXT NOT NULL DEFAULT '';`);
sqliteManager.addMigration(26042101, `ALTER TABLE todos ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 1;`);
sqliteManager.addMigration(26061901, `ALTER TABLE todos ADD COLUMN source TEXT NOT NULL DEFAULT 'human';`);
sqliteManager.addMigration(26061902, `ALTER TABLE domain ADD COLUMN description TEXT NOT NULL DEFAULT '';`);
sqliteManager.addMigration(26062002, (db) => {
  addColumnIfMissing(db, 'todos', 'source', `TEXT NOT NULL DEFAULT 'human'`);
  addColumnIfMissing(db, 'domain', 'description', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'domain', 'archived', 'INTEGER NOT NULL DEFAULT 0');
});
sqliteManager.addMigration(26071501, (db) => {
  addColumnIfMissing(db, 'coding_agent_session', 'provider_title', 'TEXT');
  addColumnIfMissing(db, 'coding_agent_session', 'custom_title', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare(
    `UPDATE coding_agent_session
     SET provider_title = title
     WHERE provider_title IS NULL AND custom_title = 0`
  ).run();
});

const loadTiktokenLocal = async (): Promise<void> => {
  try {
    const appPath = await pathHelper.getAppPath();
    const tiktokenPath = path.join(appPath, 'external_resources', 'gpt2.json');
    console.log('[sqlite.preload] loading local tiktoken from:', tiktokenPath);

    if (fs.existsSync(tiktokenPath)) {
      const tiktokenData = fs.readFileSync(tiktokenPath, 'utf-8');
      const encoding = JSON.parse(tiktokenData);
      (globalThis as any).__tiktoken_gpt2__ = encoding;
      console.log('[sqlite.preload] tiktoken gpt2 loaded from local');
    } else {
      console.warn('[sqlite.preload] tiktoken gpt2.json not found at:', tiktokenPath);
    }
  } catch (err: any) {
    console.error('[sqlite.preload] failed to load local tiktoken:', err.message);
  }
};

let bootResult: CoreSqliteBootResult = {
  ok: false,
  error: 'Core SQLite preload has not finished booting.',
};

const bootSqlite = async (): Promise<void> => {
  try {
    await sqliteManager.init();
    bootResult = { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bootResult = { ok: false, error: message };
    console.error('[sqlite.preload] SQLite init failed:', err);
  }
};

// The preload may be evaluated for an initial about:blank document. Only the actual hidden SQLite
// renderer owns the database bootstrap and its readiness result.
const isSqliteRendererDocument = location.pathname.endsWith('/sqlite/index.html');
const bootPromise = isSqliteRendererDocument ? bootSqlite() : Promise.resolve();

export class CoreSqliteBootDao extends XpcPreloadHandler implements CoreSqliteBootApi {
  async ready(): Promise<CoreSqliteBootResult> {
    await bootPromise;
    return bootResult;
  }
}

export const coreSqliteBootDao = new CoreSqliteBootDao();

const bootstrapServices = async (): Promise<void> => {
  await bootPromise;
  if (!bootResult.ok) return;
  await loadTiktokenLocal();
  initMessageServer();
  await initQdrant();
};

bootstrapServices().catch((err) => console.error('[sqlite.preload] service bootstrap failed:', err));
