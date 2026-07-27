/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { UpdatePollingService } from '../../src/main/updateHelper/updatePolling.service.ts';

const projectRoot = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

const createDeferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

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

test('Main update integration keeps both version gates, download-only state, and shared polling', () => {
  const service = read('src/main/updateHelper/update.service.ts');
  const handler = read('src/main/xpc/update.handler.ts');

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
});

test('Home subscribes before mount and consumes the XPC payload params', () => {
  const main = read('src/renderer/home/src/main.ts');
  const subscriber = read('src/renderer/home/src/xpc/update.subscriber.ts');

  const subscribe = main.indexOf('initUpdateSubscriber();');
  const mount = main.indexOf("createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');");
  assert.ok(subscribe >= 0, 'Missing Home update subscriber initialization');
  assert.ok(mount > subscribe, 'Home must subscribe before App mount starts the immediate poll');
  assert.match(subscriber, /type XpcPayload/);
  assert.match(subscriber, /\(payload: XpcPayload\)/);
  assert.match(subscriber, /const updateInfo = payload\.params as UpdateInfo;/);
  assert.match(subscriber, /updateStore\.setUpdateInfo\(updateInfo\)/);
});
