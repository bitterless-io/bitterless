// Disable LangChain from fetching tiktoken vocabulary from external CDN
process.env['LANGCHAIN_CALLBACKS_BACKGROUND'] = 'false';
process.env['TIKTOKEN_CACHE_DIR'] = '';

// Importing xpc/preload auto-exposes xpcRenderer to window
import {
  createXpcPreloadEmitter,
  XpcPreloadHandler,
  xpcRenderer,
} from 'electron-xpc/preload';
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
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type {
  CoreSqliteBootApi,
  CoreSqliteBootResult,
  CoreSqliteReadyParams,
} from '@shared/mcp/mcpBridge.shared';
import { CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT } from '@shared/sqlite/coreSqliteRuntime.shared';
import type {
  TodoistSyncPasswordCapabilityApi,
  TodoSystemApi,
} from '@shared/todoistSync/todoistSyncCapability.type';
import {
  registerTodoistSyncHandlers,
  type TodoistSyncHandlers,
} from './todoistSync/todoistSync.handler';
import {
  createTodoistSyncSessionGetter,
  TodoistSyncSessionService,
} from './todoistSync/todoistSync.session';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

const sqlitePathCapability = createBoundedTodoXpcClient(pathHelper, 'PathMainHelper');

for (const table of coreSqliteTables) sqliteManager.addTable(table);
for (const migration of coreSqliteMigrations) {
  sqliteManager.addMigration(migration.versionCode, migration.runner);
}

const loadTiktokenLocal = async (): Promise<void> => {
  try {
    const appPath = await sqlitePathCapability.getAppPath();
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
    await sqliteManager.init(__BITTERLESS_VERSION_CODE__);
    bootResult = { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bootResult = { ok: false, error: message };
    console.error('[sqlite.preload] SQLite init failed:', err);
  }
};

// The preload may be evaluated for an initial about:blank document. Development and packaged
// renderers can expose the SQLite entry as `/sqlite`, `/sqlite/`, or `/sqlite/index.html`, so the
// target check follows the renderer directory instead of one exact pathname.
const isSqliteRendererDocument = (() => {
  if (location.protocol === 'about:') return false;
  let pathname = location.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a SQLite renderer target.
    return false;
  }
  const normalizedPathname = pathname.replace(/\/+$/, '');
  return /\/sqlite(?:\/index\.html)?$/i.test(normalizedPathname);
})();
const bootPromise = isSqliteRendererDocument ? bootSqlite() : Promise.resolve();
const targetId = isSqliteRendererDocument ? randomUUID() : null;

const sqlitePasswordCapability = createBoundedTodoXpcClient(
  createXpcPreloadEmitter<TodoistSyncPasswordCapabilityApi>('SqlitePasswordHandler'),
  'SqlitePasswordHandler',
);
const todoSystemCapability = createBoundedTodoXpcClient(
  createXpcPreloadEmitter<TodoSystemApi>('TodoSystemHandler'),
  'TodoSystemHandler',
);

const createTodoistSyncSession = async (): Promise<TodoistSyncSessionService> => {
  await bootPromise;
  if (!bootResult.ok) {
    throw new Error(`[todoist sync] Core SQLite boot failed: ${bootResult.error}`);
  }
  const userDataPath = await sqlitePathCapability.getUserDataPath();
  return new TodoistSyncSessionService({
    userDataPath,
    passwordProtection: {
      encryptString: async (value) => {
        const encrypted = await sqlitePasswordCapability.encryptPassword({ password: value });
        return Buffer.from(encrypted, 'base64');
      },
      decryptString: async (value) => await sqlitePasswordCapability.decryptPassword({
        encrypted: value.toString('base64'),
      }),
    },
    onDataUpdated: (event) => xpcRenderer.broadcast('todo/data_updated', event),
    onClockCheckRequested: (event) => {
      xpcRenderer.broadcast('todoist-sync/clock-check-requested', event);
    },
    onStatusUpdated: () => xpcRenderer.broadcast('todoist-sync/status_updated', {}),
  });
};

const getTodoistSyncSession = createTodoistSyncSessionGetter(createTodoistSyncSession);

export const todoistSyncHandlers: TodoistSyncHandlers | null = isSqliteRendererDocument
  ? registerTodoistSyncHandlers({
      getSession: async () => await getTodoistSyncSession(),
      openDateTimeSettings: async () => await todoSystemCapability.openDateTimeSettings(),
    })
  : null;

export class CoreSqliteBootDao extends XpcPreloadHandler implements CoreSqliteBootApi {
  async ready(params: CoreSqliteReadyParams): Promise<CoreSqliteBootResult> {
    if (!targetId || params?.targetId !== targetId) {
      return { ok: false, error: 'Core SQLite target preload generation mismatch.' };
    }
    await bootPromise;
    return bootResult;
  }
}

export const coreSqliteBootDao = isSqliteRendererDocument
  ? new CoreSqliteBootDao()
  : null;
if (coreSqliteBootDao && targetId) {
  xpcRenderer.broadcast(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT, { targetId });
}

const bootstrapServices = async (): Promise<void> => {
  await bootPromise;
  if (!bootResult.ok) return;
  await loadTiktokenLocal();
  initMessageServer();
  await initQdrant();
};

bootstrapServices().catch((err) => console.error('[sqlite.preload] service bootstrap failed:', err));
