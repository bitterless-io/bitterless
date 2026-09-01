/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs';

const createStorage = (initialValue = null) => {
  const values = new Map();
  if (initialValue !== null) {
    values.set(runtime.ONLY_PREVIEW_PROJECT_WIDTH_STORAGE_KEY, initialValue);
  }
  const writes = [];
  return {
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      writes.push({ key, value });
    }
  };
};

class FakeClock {
  nowValue = 0;
  nextTimer = 1;
  timers = new Map();

  now = () => this.nowValue;

  setTimer = (callback, delayMs) => {
    const timer = this.nextTimer++;
    this.timers.set(timer, { callback, dueAt: this.nowValue + delayMs });
    return timer;
  };

  clearTimer = (timer) => {
    this.timers.delete(timer);
  };

  advance(durationMs) {
    const target = this.nowValue + durationMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.nowValue = timer.dueAt;
      timer.callback();
    }
    this.nowValue = target;
  }
}

const createService = (storage, clock = new FakeClock()) => ({
  clock,
  service: new runtime.OnlyPreviewProjectWidthPersistenceService(storage, clock, 200)
});

test('Project width restoration accepts only product-range integers and clamps to the viewport', () => {
  const fallbackValues = [null, '', '264.5', 'NaN', 'Infinity', ' 264 ', '179', '481'];
  for (const value of fallbackValues) {
    const storage = createStorage(value);
    assert.equal(createService(storage).service.restore(1200), 264, String(value));
  }

  assert.equal(createService(createStorage('420')).service.restore(1200), 420);
  assert.equal(createService(createStorage('420')).service.restore(600), 280);
  assert.equal(createService(createStorage('420')).service.restore(400), 180);
  assert.equal(runtime.clampOnlyPreviewProjectWidth(Number.NaN, 1200), 264);
  assert.equal(runtime.clampOnlyPreviewProjectWidth(170, 1200), 180);
  assert.equal(runtime.clampOnlyPreviewProjectWidth(490, 1200), 480);
});

test('Project width persistence writes leading and authoritative trailing values at a bounded rate', () => {
  const storage = createStorage();
  const { clock, service } = createService(storage);

  assert.equal(service.update(250, 1200), 250);
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250']
  );

  clock.advance(50);
  service.update(300, 1200);
  clock.advance(50);
  service.update(340, 1200);
  clock.advance(99);
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250']
  );

  clock.advance(1);
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250', '340']
  );

  clock.advance(20);
  service.update(360, 1200);
  clock.advance(40);
  service.update(410, 1200);
  clock.advance(140);
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250', '340', '410']
  );
});

test('Project width flush synchronously commits the final pending value and cancels its timer', () => {
  const storage = createStorage();
  const { clock, service } = createService(storage);

  service.update(250, 1200);
  clock.advance(50);
  service.update(333, 1200);
  service.flush();
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250', '333']
  );

  clock.advance(500);
  assert.deepEqual(
    storage.writes.map(({ value }) => value),
    ['250', '333']
  );
});

test('Project width storage read and write failures stay non-fatal', () => {
  const readFailure = {
    getItem: () => {
      throw new Error('read denied');
    },
    setItem: () => undefined
  };
  assert.equal(createService(readFailure).service.restore(1200), 264);

  const writeFailure = {
    getItem: () => null,
    setItem: () => {
      throw new Error('write denied');
    }
  };
  const { clock, service } = createService(writeFailure);
  assert.doesNotThrow(() => service.update(300, 1200));
  clock.advance(50);
  assert.doesNotThrow(() => service.update(320, 1200));
  assert.doesNotThrow(() => service.flush());
});

test('Shell routes pointer, keyboard, restore, and teardown through Project width persistence', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const store = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const mainTypes = source('src/shared/onlypreview/onlyPreview.types.ts');

  assert.match(store, /projectWidth = projectWidthPersistence\.restore\(window\.innerWidth\)/);
  assert.match(
    store,
    /setProjectWidth\(value: number\)[\s\S]*projectWidthPersistence\.update\(value, window\.innerWidth\)/
  );
  assert.doesNotMatch(store, /flushProjectWidth/);

  const resizeBody = app.slice(
    app.indexOf('const startProjectResize'),
    app.indexOf('const focusTreePath')
  );
  assert.match(resizeBody, /setProjectWidth\(moveEvent\.clientX\)/);
  assert.match(resizeBody, /addEventListener\('pointermove', move\)/);
  assert.match(resizeBody, /pointerup[\s\S]*pointercancel[\s\S]*flushProjectWidth\(\)/);
  assert.match(
    app,
    /@keydown\.left\.prevent=[\s\S]*setProjectWidth[\s\S]*@keydown\.right\.prevent=[\s\S]*setProjectWidth/
  );
  assert.match(
    app,
    /const flushProjectWidth = \(\): void => onlyPreviewProjectWidthPersistence\.flush\(\)/
  );
  assert.match(app, /window\.addEventListener\('pagehide', flushProjectWidth\)/);
  assert.match(app, /window\.removeEventListener\('pagehide', flushProjectWidth\)/);
  assert.match(app, /onBeforeUnmount\(\(\) => \{[\s\S]*flushProjectWidth\(\)/);
  assert.doesNotMatch(mainTypes, /projectWidth|projectPaneWidth/);
});
