#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSqliteFirstGuiStartup } from '../../src/main/startup/guiStartup.service.ts';
import { onceAsync } from '../../src/preload/sqlite/sqliteHelper/onceAsync.ts';
import { probeCoreSqliteReadable } from '../../src/preload/sqlite/sqliteHelper/coreSqliteReadProbe.ts';
import {
  StartupDiagnosticsState,
  selectNewerStartupDiagnosticsSnapshot,
} from '../../src/shared/startup/startupDiagnostics.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

const flushBackground = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

const createDependencies = (overrides = {}) => {
  const events = [];
  let shouldStop = false;
  const dependencies = {
    initializeCorePrerequisites: async () => {
      events.push('prerequisites');
    },
    startCoreSqlite: () => {
      events.push('core:start');
      return Promise.resolve({ ok: true });
    },
    initializeLanguageFallback: () => {
      events.push('language:fallback');
    },
    initializeForegroundRuntime: async () => {
      events.push('foreground');
    },
    createHome: async () => {
      events.push('home');
    },
    refreshMcpShim: async () => {
      events.push('mcp-shim');
    },
    initializeTray: async () => {
      events.push('tray');
    },
    handleCoreSqliteReady: async () => {
      events.push('core:ready');
    },
    handleCoreSqliteFailure: async (error) => {
      events.push(`core:failed:${error instanceof Error ? error.message : String(error)}`);
    },
    shouldStop: () => shouldStop,
    ...overrides,
  };
  return {
    dependencies,
    events,
    stop: () => {
      shouldStop = true;
    },
  };
};

{
  const core = createDeferred();
  const { dependencies, events } = createDependencies({
    startCoreSqlite: () => {
      events.push('core:start');
      return core.promise;
    },
  });
  await runSqliteFirstGuiStartup(dependencies);
  assert.deepEqual(events, [
    'prerequisites',
    'core:start',
    'language:fallback',
    'foreground',
    'home',
    'mcp-shim',
    'tray',
  ]);
}

{
  const { dependencies, events } = createDependencies({
    startCoreSqlite: () => {
      events.push('core:start');
      return Promise.reject(new Error('file is not a database'));
    },
  });
  await runSqliteFirstGuiStartup(dependencies);
  await flushBackground();
  assert.ok(events.includes('core:failed:file is not a database'));
  assert.ok(events.includes('home'));
  assert.ok(events.includes('mcp-shim'));
  assert.ok(events.includes('tray'));
}

{
  const home = createDeferred();
  const { dependencies, events } = createDependencies({
    createHome: async () => {
      events.push('home:start');
      await home.promise;
      events.push('home:end');
    },
  });
  const startup = runSqliteFirstGuiStartup(dependencies);
  await flushBackground();
  assert.equal(events.includes('core:ready'), false);
  home.resolve();
  await startup;
  await flushBackground();
  assert.ok(events.indexOf('home:end') < events.indexOf('core:ready'));
}

{
  const diagnostics = new StartupDiagnosticsState();
  assert.deepEqual(diagnostics.getSnapshot(), { revision: 0, issues: [] });

  const first = diagnostics.report('core-sqlite', 'file is not a database');
  assert.equal(first.revision, 1);
  assert.deepEqual(first.issues, [
    { stage: 'core-sqlite', message: 'file is not a database' },
  ]);

  const duplicate = diagnostics.report('core-sqlite', 'file is not a database');
  assert.equal(duplicate.revision, 1);

  const replacement = diagnostics.report('core-sqlite', 'database disk image is malformed');
  assert.equal(replacement.revision, 2);
  assert.deepEqual(replacement.issues, [
    { stage: 'core-sqlite', message: 'database disk image is malformed' },
  ]);

  assert.equal(diagnostics.clear('tray').revision, 2);
  const cleared = diagnostics.clear('core-sqlite');
  assert.deepEqual(cleared, { revision: 3, issues: [] });
}

{
  const older = { revision: 1, issues: [] };
  const equal = { revision: 2, issues: [] };
  const newer = {
    revision: 3,
    issues: [{ stage: 'tray', message: 'icon unavailable' }],
  };
  assert.equal(selectNewerStartupDiagnosticsSnapshot(2, older), null);
  assert.equal(selectNewerStartupDiagnosticsSnapshot(2, equal), null);
  assert.deepEqual(selectNewerStartupDiagnosticsSnapshot(2, newer), newer);
}

const sqliteManagerSource = readFileSync(
  join(projectRoot, 'src/preload/sqlite/sqliteHelper/sqlite.manager.ts'),
  'utf8',
);
const messageServerSource = readFileSync(
  join(projectRoot, 'src/preload/sqlite/messageServer/messageServer.ts'),
  'utf8',
);
const sqlitePreloadSource = readFileSync(
  join(projectRoot, 'src/preload/sqlite/sqlite.preload.ts'),
  'utf8',
);
const appMainSource = readFileSync(join(projectRoot, 'src/main/app.main.ts'), 'utf8');
const guiStartupSource = readFileSync(
  join(projectRoot, 'src/main/startup/guiStartup.service.ts'),
  'utf8',
);
const menuBarStoreSource = readFileSync(
  join(projectRoot, 'src/renderer/home/src/components/MenuBar/menuBar.store.ts'),
  'utf8',
);

assert.doesNotMatch(sqliteManagerSource, /packageHelper|getPackageInfo/);
assert.match(sqliteManagerSource, /private readonly initializeOnce = onceAsync/);
assert.ok(
  sqliteManagerSource.indexOf('probeCoreSqliteReadable(this._db)') <
    sqliteManagerSource.indexOf('this.runTables()'),
);
assert.doesNotMatch(messageServerSource, /sqliteManager\.init/);
assert.match(messageServerSource, /if \(isMessageServerInitialized\) return/);
assert.match(sqlitePreloadSource, /sqliteManager\.init\(__BITTERLESS_VERSION_CODE__\)/);
assert.match(sqlitePreloadSource, /location\.protocol === 'about:'/);
assert.match(sqlitePreloadSource, /\/sqlite\(\?:\\\/index\\\.html\)\?\$/);
assert.doesNotMatch(sqlitePreloadSource, /location\.pathname\.endsWith/);
assert.match(sqlitePreloadSource, /ready\(params: CoreSqliteReadyParams\)/);
assert.match(sqlitePreloadSource, /params\?\.targetId !== targetId/);
assert.match(
  sqlitePreloadSource,
  /broadcast\(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT, \{ targetId \}\)/,
);
assert.ok(
  appMainSource.indexOf('xpcMain.subscribe(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT') <
    appMainSource.indexOf('sqliteWindowHelper.create('),
);
assert.match(appMainSource, /coreSqliteBoot\.ready\(\{ targetId \}\)/);
assert.doesNotMatch(appMainSource, /withStartupTimeout|SQLITE_STARTUP_TIMEOUT_MS/);
assert.doesNotMatch(appMainSource, /app\.exit\(1\)/);
assert.doesNotMatch(
  appMainSource,
  /waitForTargetPreloadRegistration|waitForCoreSqlite/,
);
assert.ok(
  guiStartupSource.indexOf('dependencies.startCoreSqlite()') <
    guiStartupSource.indexOf('dependencies.initializeLanguageFallback()'),
);
assert.match(guiStartupSource, /void coreSqliteResult/);
assert.ok(
  guiStartupSource.indexOf('dependencies.initializeLanguageFallback()') <
    guiStartupSource.indexOf('dependencies.createHome()'),
);
assert.match(appMainSource, /startupDiagnosticsService\.report\('core-sqlite', err\)/);
assert.ok(
  menuBarStoreSource.indexOf('xpcRenderer.subscribe(STARTUP_DIAGNOSTICS_CHANGED_EVENT') <
    menuBarStoreSource.indexOf('mainWindowEmitter.getStartupDiagnostics()'),
);
assert.match(menuBarStoreSource, /selectNewerStartupDiagnosticsSnapshot/);

{
  const result = (objectCount) => ({
    prepare: () => ({ get: () => ({ object_count: objectCount }) }),
  });
  assert.equal(probeCoreSqliteReadable(result(0)), 0);
  assert.equal(probeCoreSqliteReadable(result(4)), 4);
  assert.throws(() => probeCoreSqliteReadable(result(-1)), /invalid object_count/);
  assert.throws(() => probeCoreSqliteReadable({
    prepare: () => {
      throw new Error('file is not a database');
    },
  }), /file is not a database/);
}

{
  const gate = createDeferred();
  let initializationCount = 0;
  const initializeOnce = onceAsync(async (versionCode) => {
    initializationCount += 1;
    await gate.promise;
    return versionCode;
  });
  const first = initializeOnce('260717000001');
  const concurrent = initializeOnce('260717000002');
  assert.strictEqual(concurrent, first);
  assert.equal(initializationCount, 1);
  gate.resolve();
  assert.equal(await first, '260717000001');
  assert.strictEqual(initializeOnce('260717000003'), first);
  assert.equal(initializationCount, 1);
}

{
  let initializationCount = 0;
  const initializeOnce = onceAsync(async () => {
    initializationCount += 1;
    throw new Error('init failed');
  });
  const first = initializeOnce();
  assert.strictEqual(initializeOnce(), first);
  await assert.rejects(first, /init failed/);
  await assert.rejects(initializeOnce(), /init failed/);
  assert.equal(initializationCount, 1);
}

console.log('[core-gated-startup-test] ok');
