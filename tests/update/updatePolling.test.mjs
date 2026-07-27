/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { UpdatePollingService } from '../../src/main/updateHelper/updatePolling.service.ts';

const projectRoot = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const createDeferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const createLogger = () => {
  const errors = [];
  return {
    errors,
    logger: {
      log: () => {},
      warn: () => {},
      error: (...args) => errors.push(args)
    }
  };
};

const loadTypeScriptModule = (path, dependencies, options = {}) => {
  let source = read(path);
  if (options.replaceImportMetaEnv) {
    source = source.replaceAll('import.meta.env', '({})');
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: path,
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    [],
    `Failed to transpile ${path}`
  );

  const loadedModule = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('.')) {
      throw new Error(`Missing test dependency ${specifier} while loading ${path}`);
    }
    return nodeRequire(specifier);
  };
  const execute = new Function(
    'require',
    'module',
    'exports',
    'console',
    `${transpiled.outputText}\n//# sourceURL=${resolve(projectRoot, path)}`
  );
  execute(localRequire, loadedModule, loadedModule.exports, options.logger ?? console);
  return loadedModule.exports;
};

const createRendererXpc = (snapshotRequest) => {
  const calls = [];
  const subscribers = new Map();
  return {
    calls,
    subscribers,
    xpcRenderer: {
      subscribe: (channel, callback) => {
        calls.push(`subscribe:${channel}`);
        subscribers.set(channel, callback);
      },
      send: (channel) => {
        calls.push(`send:${channel}`);
        return snapshotRequest.promise;
      }
    }
  };
};

const loadHomeUpdateRuntime = () => {
  const snapshotRequest = createDeferred();
  const xpc = createRendererXpc(snapshotRequest);
  const log = createLogger();
  const updateStoreModule = loadTypeScriptModule(
    'src/renderer/home/src/store/update.store.ts',
    {
      vue: { reactive: (value) => value },
      'electron-xpc/renderer': { xpcRenderer: xpc.xpcRenderer }
    },
    { logger: log.logger }
  );
  const subscriberModule = loadTypeScriptModule(
    'src/renderer/home/src/xpc/update.subscriber.ts',
    {
      'electron-xpc/renderer': { xpcRenderer: xpc.xpcRenderer },
      '../store/update.store': updateStoreModule
    },
    { logger: log.logger }
  );

  subscriberModule.initUpdateSubscriber();
  return {
    ...xpc,
    errors: log.errors,
    snapshotRequest,
    updateStore: updateStoreModule.updateStore
  };
};

const loadMaestroUpdateRuntime = () => {
  const snapshotRequest = createDeferred();
  const xpc = createRendererXpc(snapshotRequest);
  const log = createLogger();
  const coach = {
    getReadyUpdate: () => {
      xpc.calls.push('send:CoachXpcHandler/getReadyUpdate');
      return snapshotRequest.promise;
    },
    quitAndInstall: async () => {}
  };
  const updateStoreModule = loadTypeScriptModule(
    'src/renderer/maestro/home/src/store/update.store.ts',
    {
      vue: { reactive: (value) => value },
      'electron-xpc/renderer': {
        createXpcRendererEmitter: () => coach,
        xpcRenderer: xpc.xpcRenderer
      }
    },
    { logger: log.logger }
  );

  updateStoreModule.updateStore.init();
  return {
    ...xpc,
    errors: log.errors,
    snapshotRequest,
    updateStore: updateStoreModule.updateStore
  };
};

const settle = async (promise) => {
  await promise;
  await Promise.resolve();
};

const homeUpdate = (version) => ({
  version,
  versionCode: `${version}-code`,
  releaseNotes: `${version} notes`,
  downloadUrl: `https://example.test/${version}`
});

const maestroUpdate = (version) => ({
  version,
  versionCode: `${version}-code`
});

class ControlledScheduler {
  nextTimer = 0;
  intervals = new Map();
  clearedTimers = [];

  setInterval(callback, intervalMs) {
    const timer = this.nextTimer;
    this.nextTimer += 1;
    this.intervals.set(timer, { callback, intervalMs });
    return timer;
  }

  clearInterval(timer) {
    assert.equal(this.intervals.delete(timer), true, `Timer ${timer} was not active`);
    this.clearedTimers.push(timer);
  }

  tick(timer) {
    const interval = this.intervals.get(timer);
    assert.ok(interval, `Timer ${timer} was not active`);
    interval.callback();
  }
}

test('polling starts immediately, owns one 60-second timer, and restarts after stop', async () => {
  const scheduler = new ControlledScheduler();
  let checkCount = 0;
  const polling = new UpdatePollingService({
    checkForUpdates: async () => {
      checkCount += 1;
      return checkCount;
    },
    scheduler
  });

  assert.equal(polling.startPolling(), true);
  assert.equal(checkCount, 1);
  assert.equal(scheduler.intervals.size, 1);
  assert.equal(scheduler.intervals.get(0).intervalMs, 60_000);

  assert.equal(polling.startPolling(), false);
  assert.equal(checkCount, 1);
  assert.equal(scheduler.intervals.size, 1);
  assert.equal(await polling.checkForUpdates(), 1);

  assert.equal(polling.stopPolling(), true);
  assert.deepEqual(scheduler.clearedTimers, [0]);
  assert.equal(polling.stopPolling(), false);

  assert.equal(polling.startPolling(), true);
  assert.equal(checkCount, 2);
  assert.equal(scheduler.intervals.get(1).intervalMs, 60_000);
  assert.equal(await polling.checkForUpdates(), 2);
  assert.equal(polling.stopPolling(), true);
});

test('timer and manual checks share one in-flight operation and retry after resolution', async () => {
  const scheduler = new ControlledScheduler();
  const checks = [];
  const polling = new UpdatePollingService({
    checkForUpdates: () => {
      const check = createDeferred();
      checks.push(check);
      return check.promise;
    },
    scheduler
  });

  polling.startPolling();
  const firstManualCheck = polling.checkForUpdates();
  scheduler.tick(0);
  const secondManualCheck = polling.checkForUpdates();

  assert.equal(checks.length, 1);
  assert.strictEqual(firstManualCheck, secondManualCheck);

  checks[0].resolve('first');
  assert.equal(await firstManualCheck, 'first');

  scheduler.tick(0);
  assert.equal(checks.length, 2);
  const retry = polling.checkForUpdates();
  checks[1].resolve('second');
  assert.equal(await retry, 'second');
  polling.stopPolling();
});

test('a rejected scheduled check is observed, releases the slot, and permits retry', async () => {
  const scheduler = new ControlledScheduler();
  const checks = [];
  const observedErrors = [];
  const polling = new UpdatePollingService({
    checkForUpdates: () => {
      const check = createDeferred();
      checks.push(check);
      return check.promise;
    },
    scheduler,
    onCheckError: (error) => {
      observedErrors.push(error);
    }
  });

  polling.startPolling();
  const sharedCheck = polling.checkForUpdates();
  const transientError = new Error('transient update failure');
  checks[0].reject(transientError);

  await assert.rejects(sharedCheck, /transient update failure/);
  assert.deepEqual(observedErrors, [transientError]);

  scheduler.tick(0);
  assert.equal(checks.length, 2);
  const retry = polling.checkForUpdates();
  checks[1].resolve('recovered');
  assert.equal(await retry, 'recovered');
  polling.stopPolling();
});

test('Main normalizes downloaded notes and keeps a cloned snapshot before broadcasting', () => {
  const previousE2E = process.env.BITTERLESS_E2E;
  const broadcastChannels = [];
  const snapshotsDuringBroadcast = [];
  const updaterHandlers = new Map();
  let service;
  const xpcMain = {
    broadcast: (channel, payload) => {
      broadcastChannels.push(channel);
      snapshotsDuringBroadcast.push(service.getReadyUpdate());
      if (channel === 'app/updated') payload.version = 'mutated-by-broadcast';
    }
  };
  class TestUpdatePollingService {
    startPolling() {
      return true;
    }

    stopPolling() {
      return true;
    }

    async checkForUpdates() {
      return { status: 'disabled', currentVersionCode: '0' };
    }
  }
  const autoUpdater = {
    on: (event, callback) => updaterHandlers.set(event, callback)
  };

  try {
    process.env.BITTERLESS_E2E = '1';
    const updateModule = loadTypeScriptModule(
      'src/main/updateHelper/update.service.ts',
      {
        'electron-updater': { autoUpdater },
        electron: { app: {} },
        'electron-xpc/main': { xpcMain },
        './updatePolling.service': { UpdatePollingService: TestUpdatePollingService }
      },
      { replaceImportMetaEnv: true, logger: createLogger().logger }
    );
    service = updateModule.updateService;
    service.setupAutoUpdater();
  } finally {
    if (previousE2E === undefined) delete process.env.BITTERLESS_E2E;
    else process.env.BITTERLESS_E2E = previousE2E;
  }

  assert.equal(service.getReadyUpdate(), null);
  const notifyDownloaded = updaterHandlers.get('update-downloaded');
  assert.equal(typeof notifyDownloaded, 'function');

  notifyDownloaded({
    version: '1.2.3',
    releaseNotes: [
      { version: '1.2.3', note: 'current changes' },
      { version: '1.2.2', note: null }
    ]
  });
  const arrayNotes = {
    version: '1.2.3',
    versionCode: '0',
    releaseNotes: '1.2.3: current changes\n\n1.2.2',
    downloadUrl: ''
  };
  assert.deepEqual(service.getReadyUpdate(), arrayNotes);

  notifyDownloaded({ version: '1.2.4', releaseNotes: 'single note' });
  const stringNotes = {
    version: '1.2.4',
    versionCode: '0',
    releaseNotes: 'single note',
    downloadUrl: ''
  };
  assert.deepEqual(service.getReadyUpdate(), stringNotes);

  notifyDownloaded({ version: '1.2.5', releaseNotes: null });
  const emptyNotes = {
    version: '1.2.5',
    versionCode: '0',
    releaseNotes: '',
    downloadUrl: ''
  };
  assert.deepEqual(service.getReadyUpdate(), emptyNotes);

  assert.deepEqual(broadcastChannels, [
    'app/updated',
    'coach/update-downloaded',
    'app/updated',
    'coach/update-downloaded',
    'app/updated',
    'coach/update-downloaded'
  ]);
  assert.deepEqual(snapshotsDuringBroadcast, [
    arrayNotes,
    arrayNotes,
    stringNotes,
    stringNotes,
    emptyNotes,
    emptyNotes
  ]);

  const firstRead = service.getReadyUpdate();
  firstRead.downloadUrl = 'mutated reader data';
  assert.deepEqual(service.getReadyUpdate(), emptyNotes);
});

test('Home replays an optional ready snapshot after subscribing', async () => {
  const absent = loadHomeUpdateRuntime();
  assert.deepEqual(absent.calls, ['subscribe:app/updated', 'send:UpdateHandler/getReadyUpdate']);
  absent.snapshotRequest.resolve(null);
  await settle(absent.snapshotRequest.promise);
  assert.equal(absent.updateStore.updateAvailable, false);
  assert.equal(absent.updateStore.updateInfo, null);
  assert.equal(absent.errors.length, 0);

  const replay = loadHomeUpdateRuntime();
  const snapshot = homeUpdate('snapshot');
  replay.snapshotRequest.resolve(snapshot);
  await settle(replay.snapshotRequest.promise);
  assert.equal(replay.updateStore.updateAvailable, true);
  assert.deepEqual(replay.updateStore.updateInfo, snapshot);
});

test('Home live ready state wins on either side of snapshot resolution', async () => {
  const liveFirst = loadHomeUpdateRuntime();
  const staleSnapshot = homeUpdate('stale-snapshot');
  const live = homeUpdate('live');
  liveFirst.subscribers.get('app/updated')({ params: live });
  liveFirst.snapshotRequest.resolve(staleSnapshot);
  await settle(liveFirst.snapshotRequest.promise);
  assert.deepEqual(liveFirst.updateStore.updateInfo, live);

  const snapshotFirst = loadHomeUpdateRuntime();
  const snapshot = homeUpdate('snapshot');
  const laterLive = homeUpdate('later-live');
  snapshotFirst.snapshotRequest.resolve(snapshot);
  await settle(snapshotFirst.snapshotRequest.promise);
  assert.deepEqual(snapshotFirst.updateStore.updateInfo, snapshot);
  snapshotFirst.subscribers.get('app/updated')({ params: laterLive });
  assert.deepEqual(snapshotFirst.updateStore.updateInfo, laterLive);
});

test('Home ignores malformed input without closing replay and logs request failures', async () => {
  const malformedLive = loadHomeUpdateRuntime();
  malformedLive.subscribers.get('app/updated')({
    params: { ...homeUpdate('invalid-live'), releaseNotes: 42 }
  });
  const validSnapshot = homeUpdate('valid-snapshot');
  malformedLive.snapshotRequest.resolve(validSnapshot);
  await settle(malformedLive.snapshotRequest.promise);
  assert.deepEqual(malformedLive.updateStore.updateInfo, validSnapshot);
  assert.match(malformedLive.errors[0][0], /malformed live update-ready payload/);

  const malformedSnapshot = loadHomeUpdateRuntime();
  malformedSnapshot.snapshotRequest.resolve({
    ...homeUpdate('invalid-snapshot'),
    downloadUrl: null
  });
  await settle(malformedSnapshot.snapshotRequest.promise);
  assert.equal(malformedSnapshot.updateStore.updateInfo, null);
  assert.match(malformedSnapshot.errors[0][0], /malformed update-ready snapshot/);

  const malformedStaleSnapshot = loadHomeUpdateRuntime();
  const live = homeUpdate('live-before-malformed-snapshot');
  malformedStaleSnapshot.subscribers.get('app/updated')({ params: live });
  malformedStaleSnapshot.snapshotRequest.resolve({ ...homeUpdate('invalid-stale'), version: 3 });
  await settle(malformedStaleSnapshot.snapshotRequest.promise);
  assert.deepEqual(malformedStaleSnapshot.updateStore.updateInfo, live);
  assert.match(malformedStaleSnapshot.errors[0][0], /malformed update-ready snapshot/);

  const failedRequest = loadHomeUpdateRuntime();
  const requestError = new Error('snapshot unavailable');
  failedRequest.snapshotRequest.reject(requestError);
  await assert.rejects(failedRequest.snapshotRequest.promise, /snapshot unavailable/);
  await Promise.resolve();
  assert.equal(failedRequest.updateStore.updateInfo, null);
  assert.match(failedRequest.errors[0][0], /Failed to replay update-ready snapshot/);
});

test('Maestro replays an optional ready snapshot after both live subscriptions', async () => {
  const absent = loadMaestroUpdateRuntime();
  assert.deepEqual(absent.calls, [
    'subscribe:coach/update-available',
    'subscribe:coach/update-downloaded',
    'send:CoachXpcHandler/getReadyUpdate'
  ]);
  absent.snapshotRequest.resolve(null);
  await settle(absent.snapshotRequest.promise);
  assert.equal(absent.updateStore.ready, false);
  assert.equal(absent.updateStore.downloading, false);
  assert.equal(absent.updateStore.info, null);

  const replay = loadMaestroUpdateRuntime();
  const snapshot = maestroUpdate('snapshot');
  replay.snapshotRequest.resolve(snapshot);
  await settle(replay.snapshotRequest.promise);
  assert.equal(replay.updateStore.ready, true);
  assert.equal(replay.updateStore.downloading, false);
  assert.deepEqual(replay.updateStore.info, snapshot);
});

test('Maestro live availability or readiness wins over an in-flight stale snapshot', async () => {
  const downloadingWins = loadMaestroUpdateRuntime();
  const liveAvailable = maestroUpdate('live-available');
  downloadingWins.subscribers.get('coach/update-available')({ params: liveAvailable });
  downloadingWins.snapshotRequest.resolve(maestroUpdate('stale-ready'));
  await settle(downloadingWins.snapshotRequest.promise);
  assert.equal(downloadingWins.updateStore.ready, true);
  assert.equal(downloadingWins.updateStore.downloading, true);
  assert.deepEqual(downloadingWins.updateStore.info, liveAvailable);

  const readyWins = loadMaestroUpdateRuntime();
  const liveReady = maestroUpdate('live-ready');
  readyWins.subscribers.get('coach/update-downloaded')({ params: liveReady });
  readyWins.snapshotRequest.resolve(maestroUpdate('stale-ready'));
  await settle(readyWins.snapshotRequest.promise);
  assert.equal(readyWins.updateStore.downloading, false);
  assert.deepEqual(readyWins.updateStore.info, liveReady);
});

test('Maestro live state also wins after snapshot replay', async () => {
  const runtime = loadMaestroUpdateRuntime();
  runtime.snapshotRequest.resolve(maestroUpdate('snapshot'));
  await settle(runtime.snapshotRequest.promise);

  const laterAvailable = maestroUpdate('later-available');
  runtime.subscribers.get('coach/update-available')({ params: laterAvailable });
  assert.equal(runtime.updateStore.downloading, true);
  assert.deepEqual(runtime.updateStore.info, laterAvailable);

  const laterReady = maestroUpdate('later-ready');
  runtime.subscribers.get('coach/update-downloaded')({ params: laterReady });
  assert.equal(runtime.updateStore.downloading, false);
  assert.deepEqual(runtime.updateStore.info, laterReady);
});

test('Maestro ignores malformed input without closing replay and logs request failures', async () => {
  const malformedLive = loadMaestroUpdateRuntime();
  malformedLive.subscribers.get('coach/update-available')({
    params: { version: 'invalid-available', versionCode: 7 }
  });
  malformedLive.subscribers.get('coach/update-downloaded')({
    params: { version: null, versionCode: 'invalid-downloaded' }
  });
  const validSnapshot = maestroUpdate('valid-snapshot');
  malformedLive.snapshotRequest.resolve(validSnapshot);
  await settle(malformedLive.snapshotRequest.promise);
  assert.deepEqual(malformedLive.updateStore.info, validSnapshot);
  assert.equal(malformedLive.errors.length, 2);

  const malformedSnapshot = loadMaestroUpdateRuntime();
  malformedSnapshot.snapshotRequest.resolve({ version: 'invalid-snapshot', versionCode: false });
  await settle(malformedSnapshot.snapshotRequest.promise);
  assert.equal(malformedSnapshot.updateStore.info, null);
  assert.match(malformedSnapshot.errors[0][0], /malformed update-ready snapshot/);

  const malformedStaleSnapshot = loadMaestroUpdateRuntime();
  const liveAvailable = maestroUpdate('live-before-malformed-snapshot');
  malformedStaleSnapshot.subscribers.get('coach/update-available')({ params: liveAvailable });
  malformedStaleSnapshot.snapshotRequest.resolve({ version: false, versionCode: 'invalid-stale' });
  await settle(malformedStaleSnapshot.snapshotRequest.promise);
  assert.deepEqual(malformedStaleSnapshot.updateStore.info, liveAvailable);
  assert.equal(malformedStaleSnapshot.updateStore.downloading, true);
  assert.match(malformedStaleSnapshot.errors[0][0], /malformed update-ready snapshot/);

  const failedRequest = loadMaestroUpdateRuntime();
  failedRequest.snapshotRequest.reject(new Error('snapshot unavailable'));
  await assert.rejects(failedRequest.snapshotRequest.promise, /snapshot unavailable/);
  await Promise.resolve();
  assert.equal(failedRequest.updateStore.info, null);
  assert.match(failedRequest.errors[0][0], /Failed to replay update-ready snapshot/);
});

test('Main update integration keeps both version gates, download-only state, and shared polling', () => {
  const service = read('src/main/updateHelper/update.service.ts');
  const handler = read('src/main/xpc/update.handler.ts');
  const maestroAdapter = read('src/main/maestro/update/update.service.ts');
  const maestroHandler = read('src/main/maestro/xpc/coach.handler.ts');
  const maestroApi = read('src/shared/maestro/coach.api.ts');

  assert.match(service, /import \{ UpdatePollingService \} from '\.\/updatePolling\.service';/);
  assert.match(
    service,
    /new UpdatePollingService\(\{[\s\S]*checkForUpdates: \(\) => this\.checkAndDownloadUpdate\(\)/
  );
  assert.match(service, /if \(!this\.updatePollingService\.startPolling\(\)\) return;/);
  assert.match(service, /this\.updatePollingService\.stopPolling\(\)/);
  assert.match(service, /return await this\.updatePollingService\.checkForUpdates\(\);/);
  assert.match(handler, /return await updateService\.manualCheck\(\);/);

  const updateTry = service.indexOf('try {', service.indexOf('const updateInfo: UpdateInfo'));
  const feedSetup = service.indexOf('autoUpdater.setFeedURL({', updateTry);
  const updaterCheck = service.indexOf('const updateCheck = await autoUpdater.checkForUpdates();');
  const disagreement = service.indexOf('updateCheck?.isUpdateAvailable !== true');
  const availabilityBroadcast = service.indexOf("xpcMain.broadcast('coach/update-available'");
  const download = service.indexOf('await autoUpdater.downloadUpdate();');
  const updateCatch = service.indexOf('} catch (error) {', download);
  assert.ok(updateTry >= 0, 'Missing retryable updater operation boundary');
  assert.ok(feedSetup > updateTry, 'Feed setup must be inside the retryable updater boundary');
  assert.ok(updaterCheck >= 0, 'Missing platform updater check result');
  assert.ok(updaterCheck > feedSetup, 'Platform updater check must follow feed setup');
  assert.ok(disagreement > updaterCheck, 'Missing platform updater availability gate');
  assert.ok(availabilityBroadcast > disagreement, 'Availability broadcast must follow both gates');
  assert.ok(
    download > availabilityBroadcast,
    'Download must follow the confirmed availability broadcast'
  );
  assert.ok(
    updateCatch > download,
    'Feed setup, updater check, and download must share one error boundary'
  );
  assert.match(service, /throw new UpdateMetadataDisagreementError\(/);
  assert.doesNotMatch(service, /this\.updateAvailable/);

  assert.equal((service.match(/this\.isDownloading = true;/g) ?? []).length, 1);
  assert.equal((service.match(/this\.isDownloading = false;/g) ?? []).length, 1);
  assert.match(
    service,
    /this\.isDownloading = true;\s*try \{\s*await autoUpdater\.downloadUpdate\(\);\s*\} finally \{\s*this\.isDownloading = false;/
  );
  assert.match(
    service,
    /autoUpdater\.setFeedURL\(\{\s*provider: 'generic',\s*url: manifest\.downloadUrl/
  );
  assert.match(service, /xpcMain\.broadcast\('app\/updated', updateInfo\)/);
  assert.match(service, /releaseNotes: normalizeUpdateReleaseNotes\(info\.releaseNotes\)/);
  assert.match(service, /private readyUpdate: UpdateInfo \| null = null;/);
  assert.match(service, /return this\.readyUpdate \? \{ \.\.\.this\.readyUpdate \} : null;/);
  assert.match(handler, /xpcMain\.handle\('UpdateHandler\/getReadyUpdate'/);
  assert.match(handler, /return updateService\.getReadyUpdate\(\);/);

  const snapshotWrite = service.indexOf('this.readyUpdate = { ...updateInfo };');
  const homeReadyBroadcast = service.indexOf("xpcMain.broadcast('app/updated'", snapshotWrite);
  const maestroReadyBroadcast = service.indexOf(
    "xpcMain.broadcast('coach/update-downloaded'",
    snapshotWrite
  );
  assert.ok(snapshotWrite >= 0, 'Main must retain a defensive ready snapshot');
  assert.ok(
    homeReadyBroadcast > snapshotWrite,
    'Main must retain ready state before Home broadcast'
  );
  assert.ok(
    maestroReadyBroadcast > snapshotWrite,
    'Main must retain ready state before Maestro broadcast'
  );

  assert.match(maestroAdapter, /getReadyUpdate\(\): UpdateInfo \| null/);
  assert.match(maestroAdapter, /bitterlessUpdateService\.getReadyUpdate\(\)/);
  assert.match(maestroHandler, /async getReadyUpdate\(\): Promise<UpdateInfo \| null>/);
  assert.match(maestroHandler, /return updateService\.getReadyUpdate\(\)/);
  assert.match(maestroApi, /getReadyUpdate\(\): Promise<UpdateInfo \| null>/);
});

test('Home subscribes before mount, then requests race-safe ready replay', () => {
  const main = read('src/renderer/home/src/main.ts');
  const subscriber = read('src/renderer/home/src/xpc/update.subscriber.ts');
  const store = read('src/renderer/home/src/store/update.store.ts');

  const subscribe = main.indexOf('initUpdateSubscriber();');
  const mount = main.indexOf("createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');");
  assert.ok(subscribe >= 0, 'Missing Home update subscriber initialization');
  assert.ok(mount > subscribe, 'Home must subscribe before App mount starts the immediate poll');
  assert.match(subscriber, /type XpcPayload/);
  assert.match(subscriber, /\(payload: XpcPayload\)/);
  assert.match(subscriber, /const updateInfo = parseUpdateInfo\(payload\.params\);/);
  assert.match(subscriber, /updateStore\.setUpdateInfo\(updateInfo\)/);
  assert.match(subscriber, /if \(snapshot === null\) return;/);
  assert.match(subscriber, /if \(liveReadyReceived\) return;/);
  assert.match(store, /typeof candidate\.releaseNotes !== 'string'/);
  assert.match(store, /typeof candidate\.downloadUrl !== 'string'/);

  const liveSubscribe = subscriber.indexOf("xpcRenderer.subscribe('app/updated'");
  const snapshotRequest = subscriber.indexOf(
    "xpcRenderer.send('UpdateHandler/getReadyUpdate')",
    liveSubscribe
  );
  assert.ok(liveSubscribe >= 0, 'Missing Home live ready subscription');
  assert.ok(snapshotRequest > liveSubscribe, 'Home must subscribe before requesting its snapshot');
  assert.doesNotMatch(subscriber, /await xpcRenderer\.send\('UpdateHandler\/getReadyUpdate'/);
});

test('Maestro subscribes to both live states before typed race-safe replay', () => {
  const store = read('src/renderer/maestro/home/src/store/update.store.ts');

  const availableSubscribe = store.indexOf("xpcRenderer.subscribe('coach/update-available'");
  const downloadedSubscribe = store.indexOf("xpcRenderer.subscribe('coach/update-downloaded'");
  const snapshotRequest = store.indexOf('const readyUpdateRequest = coach.getReadyUpdate()');
  assert.ok(availableSubscribe >= 0, 'Missing Maestro availability subscription');
  assert.ok(
    downloadedSubscribe > availableSubscribe,
    'Maestro must register both live subscriptions'
  );
  assert.ok(
    snapshotRequest > downloadedSubscribe,
    'Maestro must subscribe before requesting replay'
  );
  assert.match(store, /if \(snapshot === null\) return/);
  assert.match(store, /if \(this\.liveStateReceived\) return/);
  assert.equal(
    (store.match(/this\.liveStateReceived = true/g) ?? []).length,
    2,
    'Both valid Maestro live states must suppress a stale snapshot'
  );
  assert.match(store, /typeof candidate\.version !== 'string'/);
  assert.match(store, /typeof candidate\.versionCode !== 'string'/);
  assert.doesNotMatch(store, /await coach\.getReadyUpdate\(\)/);
});
