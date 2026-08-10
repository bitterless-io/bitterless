import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPlainTextSnippet,
  normalizeSearchText,
} from '../../src/preload/onlypreview/search/core/normalization.mjs';
import {
  createOnlyPreviewSearchResult,
  isOnlyPreviewSearchResult,
} from '../../src/preload/onlypreview/search/core/search-contract.mjs';
import { createSearchResultBatcher } from '../../src/preload/onlypreview/search/core/result-batcher.mjs';
import { createLatestSingleFlight } from '../../src/preload/onlypreview/search/core/single-flight.mjs';
import { createBackgroundWorkSlicer } from '../../src/preload/onlypreview/search/core/work-slicer.mjs';
import {
  parseOnlyPreviewWorkspaceConfig,
} from '../../src/preload/onlypreview/search/core/workspace-config.mjs';
import {
  canOrderedGlobReincludeDescendant,
  isExcludedByOrderedGlobs,
} from '../../src/preload/onlypreview/search/core/glob-config.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
};

const nextTurn = async () => await new Promise((resolve) => setImmediate(resolve));

test('normalization and snippets keep the exact grapheme-safe 16/48 contract', () => {
  assert.equal(normalizeSearchText('ＡＢＣ Café'), 'abc café');
  assert.deepEqual(
    createPlainTextSnippet('0123456789abcdefMATCHabcdefghijklmnop', 'match'),
    {
      snippetText: '0123456789abcdefMATCHabcdefghijklmnop',
      highlightStart: 16,
      highlightLength: 5,
    },
  );
  const longMatch = '界'.repeat(49);
  assert.deepEqual(createPlainTextSnippet(`before${longMatch}after`, longMatch), {
    snippetText: longMatch,
    highlightStart: 0,
    highlightLength: 49,
  });
  const result = createOnlyPreviewSearchResult({
    fileName: 'a.txt',
    relativePath: 'folder/a.txt',
    mediaType: 'text',
    contentMatch: { snippetText: 'x界y', highlightStart: 1, highlightLength: 1 },
  });
  assert.equal(isOnlyPreviewSearchResult(result), true);
  assert.deepEqual(Object.keys(result).sort(), [
    'contentMatch', 'fileName', 'mediaType', 'relativePath',
  ]);
});

test('exact YAML config preserves ordered exclude and later include rules', () => {
  const config = parseOnlyPreviewWorkspaceConfig(`
version: 1
exclude:
  - generated/**
  - '!generated/keep/**'
`);
  assert.equal(isExcludedByOrderedGlobs('generated/drop/a.txt', config.rules), true);
  assert.equal(isExcludedByOrderedGlobs('generated/keep/a.txt', config.rules), false);
  assert.equal(canOrderedGlobReincludeDescendant('generated', config.rules), true);
  assert.throws(() => parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\nextra: true'));
  assert.throws(() => parseOnlyPreviewWorkspaceConfig('version: 2\nexclude: []'));
});

test('result batching flushes at 50 and by the 16ms deadline without duplicating final rows', () => {
  const callbacks = [];
  const batches = [];
  const batcher = createSearchResultBatcher({
    onBatch: (batch) => batches.push(batch),
    setTimer: (callback, delayMs) => {
      callbacks.push({ callback, delayMs });
      return callbacks.length;
    },
    clearTimer: () => undefined,
  });
  for (let index = 0; index < 50; index += 1) batcher.push({ relativePath: `${index}` });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 50);
  batcher.push({ relativePath: 'tail' });
  assert.equal(callbacks.at(-1).delayMs, 16);
  callbacks.at(-1).callback();
  assert.deepEqual(batches.at(-1), [{ relativePath: 'tail' }]);
  assert.equal(batches.flat().length, 51);
});

test('elapsed work slicing pauses after one slow item instead of waiting for file 50', async () => {
  let now = 0;
  const pauses = [];
  const slicer = createBackgroundWorkSlicer({
    sliceMs: 8,
    pauseMs: 4,
    timers: {
      now: () => now,
      pause: async (delayMs) => {
        pauses.push(delayMs);
        now += delayMs;
      },
    },
  });
  assert.equal(await slicer.checkpoint(), false);
  now = 12;
  assert.equal(await slicer.checkpoint(), true);
  assert.deepEqual(pauses, [4]);
  assert.equal(slicer.statistics().yieldCount, 1);
});

test('single-flight keeps one active and only the latest trailing request', async () => {
  const executions = [];
  const controls = new Map();
  const scheduler = createLatestSingleFlight({
    createControl: (value) => {
      const control = {
        state: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
        deferred: deferred(),
      };
      controls.set(value, control);
      return control;
    },
    execute: (value, control) => {
      executions.push(value);
      return control.deferred.promise;
    },
    cancelExecution: (_value, control) => Atomics.store(control.state, 0, 1),
  });

  const first = scheduler.submit('first');
  const firstOutcome = first.catch((error) => error.code);
  await nextTurn();
  const middle = scheduler.submit('middle');
  const middleOutcome = middle.catch((error) => error.code);
  const final = scheduler.submit('final');
  assert.equal(Atomics.load(controls.get('first').state, 0), 1);
  assert.deepEqual(executions, ['first']);
  controls.get('first').deferred.resolve('old');
  assert.equal(await firstOutcome, 'CANCELLED');
  assert.equal(await middleOutcome, 'CANCELLED');
  await nextTurn();
  assert.deepEqual(executions, ['first', 'final']);
  controls.get('final').deferred.resolve('latest');
  assert.equal(await final, 'latest');
  await scheduler.close();
});

test('control block observes active Atomics cancellation before terminal and fences pending work', async () => {
  const active = deferred();
  let activeControl;
  const executions = [];
  const scheduler = createLatestSingleFlight({
    createControl: () => ({
      state: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    }),
    execute: (value, control) => {
      executions.push(value);
      activeControl = control;
      return active.promise;
    },
    cancelExecution: (_value, control) => Atomics.store(control.state, 0, 1),
  });
  const first = scheduler.submit('old');
  const firstOutcome = first.catch((error) => error.code);
  await nextTurn();
  const block = scheduler.beginBlock();
  assert.equal(Atomics.load(activeControl.state, 0), 1);
  const trailing = scheduler.submit('new');
  active.resolve('ignored');
  await block.drained;
  assert.equal(await firstOutcome, 'CANCELLED');
  assert.deepEqual(executions, ['old']);
  block.release();
  await nextTurn();
  assert.deepEqual(executions, ['old', 'new']);
  active.resolve('new-result');
  await scheduler.cancelWhere(() => true);
  await trailing.catch(() => undefined);
  await scheduler.close();
});
