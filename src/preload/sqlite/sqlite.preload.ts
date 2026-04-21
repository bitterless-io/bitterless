// Disable LangChain from fetching tiktoken vocabulary from external CDN
process.env['LANGCHAIN_CALLBACKS_BACKGROUND'] = 'false';
process.env['TIKTOKEN_CACHE_DIR'] = '';

// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-xpc/preload';
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
import { sortTable } from './dao/sort.table';
import { migrationTable } from './dao/migration.table';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/session.dao';
import './dao/env.dao';
import './dao/domain.dao';
import './dao/todo.dao';
import './dao/subTodo.dao';
import './handler/language.handler';
import './handler/searchEngine.handler';
import { initQdrant } from './qdrantHelper/qdrant.helper';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import * as path from 'path';
import * as fs from 'fs';

sqliteManager.addTable(sessionTable);
sqliteManager.addTable(messageTable);
sqliteManager.addTable(settingTable);
sqliteManager.addTable(envTable);
sqliteManager.addTable(domainTable);
sqliteManager.addTable(todoTable);
sqliteManager.addTable(subTodoTable);
sqliteManager.addTable(sortTable);
sqliteManager.addTable(migrationTable);

// Migrations versioncode 来源于当前的 package.json versioncode
sqliteManager.addMigration(26040705, `ALTER TABLE todos ADD COLUMN note TEXT NOT NULL DEFAULT '';`);
sqliteManager.addMigration(26042101, `ALTER TABLE todos ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 1;`);

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

const bootstrap = async (): Promise<void> => {
  await loadTiktokenLocal();
  await sqliteManager.init();
  initMessageServer();
  await initQdrant();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
