#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  StartupTimeoutError,
  withStartupTimeout,
} from '../../src/main/mcp/optionalStartupLifecycle.service.ts';
import { runCoreGatedGuiStartup } from '../../src/main/startup/guiStartup.service.ts';
import { onceAsync } from '../../src/preload/sqlite/sqliteHelper/onceAsync.ts';
import { probeCoreSqliteReadable } from '../../src/preload/sqlite/sqliteHelper/coreSqliteReadProbe.ts';

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

const createManualTimeout = () => {
  let onTimeout = null;
  return {
    schedule: (handler) => {
      onTimeout = handler;
      return () => undefined;
    },
    fire: () => {
      assert.ok(onTimeout, 'startup timeout must be scheduled');
      onTimeout();
    },
  };
};

const createDependencies = (overrides = {}) => {
  const events = [];
  let shouldStop = false;
  const dependencies = {
    initializeCorePrerequisites: async () => {
      events.push('prerequisites');
    },
    waitForTargetPreloadRegistration: async () => {
      events.push('target-preload');
    },
    waitForCoreSqlite: async () => {
      events.push('core-sqlite');
      return { ok: true };
    },
    initializeLanguage: async () => {
      events.push('language');
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
    startOptionalIntegrations: async () => {
      events.push('optional-integrations');
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
  const { dependencies, events } = createDependencies();
  await runCoreGatedGuiStartup(dependencies);
  assert.deepEqual(events, [
    'prerequisites',
    'target-preload',
    'core-sqlite',
    'language',
    'home',
    'mcp-shim',
    'tray',
    'optional-integrations',
  ]);
}

{
  const targetPreloadGate = createDeferred();
  const { dependencies, events } = createDependencies({
    waitForTargetPreloadRegistration: async () => {
      events.push('target-preload:start');
      await targetPreloadGate.promise;
      events.push('target-preload:end');
    },
  });
  const startup = runCoreGatedGuiStartup(dependencies);
  await Promise.resolve();
  assert.deepEqual(events, ['prerequisites', 'target-preload:start']);
  targetPreloadGate.resolve();
  await startup;
  assert.equal(events.includes('core-sqlite'), true);
}

{
  const { dependencies, events } = createDependencies({
    waitForTargetPreloadRegistration: async () => {
      events.push('target-preload:failed');
      throw new Error('target preload failed');
    },
  });
  await assert.rejects(runCoreGatedGuiStartup(dependencies), /target preload failed/);
  assert.deepEqual(events, ['prerequisites', 'target-preload:failed']);
}

{
  const coreGate = createDeferred();
  const { dependencies, events } = createDependencies({
    waitForCoreSqlite: async () => {
      events.push('core-sqlite:start');
      return await coreGate.promise;
    },
  });
  const startup = runCoreGatedGuiStartup(dependencies);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, [
    'prerequisites',
    'target-preload',
    'core-sqlite:start',
  ]);
  coreGate.resolve({ ok: true });
  await startup;
  assert.equal(events.includes('language'), true);
}

for (const failure of [
  { result: { ok: false, error: 'core failed' }, expected: /core failed/ },
  { result: null, expected: /did not report a successful result/ },
  { rejection: new Error('core rejected'), expected: /core rejected/ },
]) {
  const { dependencies, events } = createDependencies({
    waitForCoreSqlite: async () => {
      events.push('core-sqlite:failed');
      if (failure.rejection) throw failure.rejection;
      return failure.result;
    },
  });
  await assert.rejects(runCoreGatedGuiStartup(dependencies), failure.expected);
  assert.deepEqual(events, [
    'prerequisites',
    'target-preload',
    'core-sqlite:failed',
  ]);
}

{
  const timeout = createManualTimeout();
  const { dependencies, events } = createDependencies({
    waitForTargetPreloadRegistration: async () => {
      events.push('target-preload:start');
      await withStartupTimeout(new Promise(() => undefined), {
        label: 'Core SQLite target preload registration',
        timeoutMs: 30000,
        schedule: timeout.schedule,
      });
    },
  });
  const startup = runCoreGatedGuiStartup(dependencies);
  await Promise.resolve();
  await Promise.resolve();
  timeout.fire();
  await assert.rejects(startup, (err) => err instanceof StartupTimeoutError);
  assert.deepEqual(events, ['prerequisites', 'target-preload:start']);
}

{
  const timeout = createManualTimeout();
  const { dependencies, events } = createDependencies({
    waitForCoreSqlite: async () => {
      events.push('core-sqlite:start');
      return await withStartupTimeout(new Promise(() => undefined), {
        label: 'Core SQLite readiness',
        timeoutMs: 30000,
        schedule: timeout.schedule,
      });
    },
  });
  const startup = runCoreGatedGuiStartup(dependencies);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  timeout.fire();
  await assert.rejects(startup, (err) => err instanceof StartupTimeoutError);
  assert.deepEqual(events, [
    'prerequisites',
    'target-preload',
    'core-sqlite:start',
  ]);
}

{
  let stopStartup;
  const { dependencies, events, stop } = createDependencies({
    waitForCoreSqlite: async () => {
      events.push('core-sqlite');
      stopStartup();
      return { ok: true };
    },
  });
  stopStartup = stop;
  await runCoreGatedGuiStartup(dependencies);
  assert.deepEqual(events, ['prerequisites', 'target-preload', 'core-sqlite']);
}

{
  const { dependencies, events } = createDependencies({
    initializeLanguage: async () => {
      events.push('language:failed');
      throw new Error('language failed');
    },
  });
  await assert.rejects(runCoreGatedGuiStartup(dependencies), /language failed/);
  assert.deepEqual(events, [
    'prerequisites',
    'target-preload',
    'core-sqlite',
    'language:failed',
  ]);
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

assert.doesNotMatch(sqliteManagerSource, /packageHelper|getPackageInfo/);
assert.match(sqliteManagerSource, /private readonly initializeOnce = onceAsync/);
assert.ok(
  sqliteManagerSource.indexOf('probeCoreSqliteReadable(this._db)') <
    sqliteManagerSource.indexOf('this.runTables()'),
);
assert.doesNotMatch(messageServerSource, /sqliteManager\.init/);
assert.match(messageServerSource, /if \(isMessageServerInitialized\) return/);
assert.match(sqlitePreloadSource, /sqliteManager\.init\(__BITTERLESS_VERSION_CODE__\)/);
const handlerRegistrationIndex = sqlitePreloadSource.indexOf(
  'export const coreSqliteBootDao = isSqliteRendererDocument',
);
const targetBroadcastIndex = sqlitePreloadSource.indexOf(
  'xpcRenderer.broadcast(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT',
);
assert.match(sqlitePreloadSource, /location\.pathname\.endsWith\('\/sqlite\/index\.html'\)/);
assert.ok(handlerRegistrationIndex >= 0 && handlerRegistrationIndex < targetBroadcastIndex);
assert.match(
  sqlitePreloadSource,
  /coreSqliteBootDao = isSqliteRendererDocument\s*\? new CoreSqliteBootDao\(\)\s*:\s*null/,
);
assert.match(sqlitePreloadSource, /ready\(params: CoreSqliteReadyParams\)/);
assert.match(sqlitePreloadSource, /params\?\.targetId !== targetId/);
assert.match(sqlitePreloadSource, /broadcast\(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT, \{ targetId \}\)/);
assert.ok(
  appMainSource.indexOf('xpcMain.subscribe(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT') <
    appMainSource.indexOf('sqliteWindowHelper.create()'),
);
assert.match(appMainSource, /coreSqliteBoot\.ready\(\{ targetId \}\)/);
assert.match(appMainSource, /Core SQLite target preload registered:/);
assert.match(appMainSource, /Core SQLite ready:/);
assert.match(appMainSource, /invalidationError = err/);
assert.match(appMainSource, /if \(invalidationError\) throw invalidationError/);
assert.doesNotMatch(appMainSource, /did-finish-load|waitForWindowLoad/);

{
  const result = (objectCount) => ({
    prepare: () => ({ get: () => ({ object_count: objectCount }) }),
  });
  assert.equal(probeCoreSqliteReadable(result(0)), 0);
  assert.equal(probeCoreSqliteReadable(result(4)), 4);
  assert.throws(
    () => probeCoreSqliteReadable(result(-1)),
    /invalid object_count/,
  );
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
  const sequential = initializeOnce('260717000003');
  assert.strictEqual(sequential, first);
  assert.equal(await sequential, '260717000001');
  assert.equal(initializationCount, 1);
}

{
  let initializationCount = 0;
  const initializeOnce = onceAsync(async () => {
    initializationCount += 1;
    throw new Error('init failed');
  });
  const first = initializeOnce();
  const second = initializeOnce();
  assert.strictEqual(second, first);
  await assert.rejects(first, /init failed/);
  await assert.rejects(initializeOnce(), /init failed/);
  assert.equal(initializationCount, 1);
}

console.log('[core-gated-startup-test] ok');
