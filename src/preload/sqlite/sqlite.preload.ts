// Disable LangChain from fetching tiktoken vocabulary from external CDN
process.env['LANGCHAIN_CALLBACKS_BACKGROUND'] = 'false';
process.env['TIKTOKEN_CACHE_DIR'] = '';

// Importing xpc/preload auto-exposes xpcRenderer to window
import { XpcPreloadHandler } from 'electron-xpc/preload';
import { sqliteManager } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
import { coreSqliteMigrations, coreSqliteTables } from './coreSqlite.release';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/session.dao';
import './dao/env.dao';
import './dao/domain.dao';
import './dao/todo.dao';
import './dao/subTodo.dao';
import './dao/todoEvent.dao';
import './dao/eyesOnAgents.dao';
import './handler/language.handler';
import './handler/searchEngine.handler';
import { initQdrant } from './qdrantHelper/qdrant.helper';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import * as path from 'path';
import * as fs from 'fs';
import type {
  CoreSqliteBootApi,
  CoreSqliteBootResult,
} from '@shared/mcp/mcpBridge.shared';

for (const table of coreSqliteTables) sqliteManager.addTable(table);
for (const migration of coreSqliteMigrations) {
  sqliteManager.addMigration(migration.versionCode, migration.runner);
}

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
