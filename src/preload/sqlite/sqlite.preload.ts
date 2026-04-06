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

// Migrations
sqliteManager.addMigration(2026032801, `ALTER TABLE todos ADD COLUMN note TEXT NOT NULL DEFAULT '';`);

sqliteManager.addMigration(2026040201, `
  -- Create new setting table with sub_key support
  CREATE TABLE IF NOT EXISTS setting_new (
    key TEXT NOT NULL,
    sub_key TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key, sub_key)
  );
  
  -- Copy existing data from old table (set sub_key to empty string)
  INSERT INTO setting_new (key, sub_key, value, category, updated_at)
  SELECT key, '', value, category, updated_at FROM setting;
  
  -- Drop old table
  DROP TABLE setting;
  
  -- Rename new table to original name
  ALTER TABLE setting_new RENAME TO setting;
`);

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
