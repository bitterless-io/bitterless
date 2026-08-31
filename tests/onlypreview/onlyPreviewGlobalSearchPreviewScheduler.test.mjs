/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-global-search-preview-scheduler-'));
const outfile = join(buildRoot, 'scheduler.mjs');

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchPreviewScheduler.service.ts'
    )
  ],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const { createOnlyPreviewGlobalSearchPreviewScheduler } = await import(pathToFileURL(outfile).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const createClock = () => {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    clock: {
      setTimeout(callback, delayMs) {
        const id = ++sequence;
        timers.set(id, { callback, at: now + delayMs });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    },
    advance(delayMs) {
      const target = now + delayMs;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
    get pendingTimers() {
      return timers.size;
    }
  };
};

test('single selection dispatches immediately and releases its fixed window', () => {
  const fake = createClock();
  const dispatched = [];
  const scheduler = createOnlyPreviewGlobalSearchPreviewScheduler(
    (value) => dispatched.push(value),
    120,
    fake.clock
  );

  scheduler.schedule('A');
  assert.deepEqual(dispatched, ['A']);
  assert.equal(fake.pendingTimers, 1);
  fake.advance(120);
  assert.deepEqual(dispatched, ['A']);
  assert.equal(fake.pendingTimers, 0);
});

test('rapid B and C selections keep only the latest trailing value', () => {
  const fake = createClock();
  const dispatched = [];
  const scheduler = createOnlyPreviewGlobalSearchPreviewScheduler(
    (value) => dispatched.push(value),
    120,
    fake.clock
  );

  scheduler.schedule('A');
  fake.advance(25);
  scheduler.schedule('B');
  fake.advance(25);
  scheduler.schedule('C');
  assert.deepEqual(dispatched, ['A']);
  fake.advance(70);
  assert.deepEqual(dispatched, ['A', 'C']);
  assert.equal(dispatched.includes('B'), false);

  fake.advance(10);
  scheduler.schedule('D');
  fake.advance(109);
  assert.deepEqual(dispatched, ['A', 'C']);
  fake.advance(1);
  assert.deepEqual(dispatched, ['A', 'C', 'D']);
});

test('cancel drops the trailing value and resets the next selection to leading', () => {
  const fake = createClock();
  const dispatched = [];
  const scheduler = createOnlyPreviewGlobalSearchPreviewScheduler(
    (value) => dispatched.push(value),
    120,
    fake.clock
  );

  scheduler.schedule('A');
  scheduler.schedule('B');
  scheduler.cancel();
  assert.equal(fake.pendingTimers, 0);
  fake.advance(120);
  assert.deepEqual(dispatched, ['A']);

  scheduler.schedule('C');
  assert.deepEqual(dispatched, ['A', 'C']);
});
