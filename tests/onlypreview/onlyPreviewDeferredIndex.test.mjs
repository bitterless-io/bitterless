import assert from 'node:assert/strict';
import test from 'node:test';
import { OnlyPreviewDeferredIndexService } from '../../src/renderer/onlypreview/shell/src/onlyPreviewDeferredIndex.service.ts';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const createHarness = (scheduleMicrotask) => {
  const scheduled = [];
  const events = [];
  let now = 0;
  let sequence = 0;
  const diagnostics = {
    nextTag: (prefix) => `${prefix}${++sequence}`,
    now: () => now,
    elapsed: (startedAt) => now - startedAt,
    emit: (event, fields) => {
      events.push({ event, ...fields });
      return true;
    }
  };
  const service = new OnlyPreviewDeferredIndexService(
    diagnostics,
    scheduleMicrotask ?? ((run) => scheduled.push(run))
  );
  return {
    events,
    scheduled,
    service,
    setNow: (value) => { now = value; }
  };
};

test('restored Project index dispatch is queued without a renderer timer', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });

  assert.equal(runs, 0);
  assert.equal(harness.scheduled.length, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled']);

  harness.setNow(1);
  harness.scheduled.shift()();
  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'start']);
});

test('default scheduler wrapper does not forward the service receiver to queueMicrotask', async () => {
  const originalQueueMicrotask = globalThis.queueMicrotask;
  const events = [];
  let receiver;
  let runs = 0;
  globalThis.queueMicrotask = function (run) {
    receiver = this;
    if (this !== globalThis) throw new TypeError('invalid queueMicrotask receiver');
    Reflect.apply(originalQueueMicrotask, globalThis, [run]);
  };
  try {
    const diagnostics = {
      nextTag: () => 'g1',
      now: () => 0,
      elapsed: () => 0,
      emit: (event, fields) => (events.push({ event, ...fields }), true)
    };
    const service = new OnlyPreviewDeferredIndexService(diagnostics);

    await service.run(
      true,
      () => true,
      () => {
        runs += 1;
      }
    );
    await new Promise((resolve) => Reflect.apply(originalQueueMicrotask, globalThis, [resolve]));

    assert.equal(receiver, globalThis);
    assert.equal(runs, 1);
    assert.deepEqual(
      events.map(({ phase }) => phase),
      ['scheduled', 'start']
    );
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }
});

test('workspace replacement cancels the queued generation and keeps a single current kickoff', async () => {
  const harness = createHarness();
  let staleRuns = 0;
  let currentRuns = 0;

  await harness.service.run(true, () => true, () => { staleRuns += 1; });
  assert.equal(harness.service.cancel(), true);
  await harness.service.run(false, () => true, () => { currentRuns += 1; });
  harness.scheduled.shift()();

  assert.equal(staleRuns, 0);
  assert.equal(currentRuns, 1);
  // The superseded microtask still drains; it must say so. A silent return here is indistinguishable
  // in the log from an index that actually ran.
  assert.deepEqual(harness.events.map(({ phase }) => phase), [
    'scheduled',
    'cancel',
    'superseded'
  ]);
  const superseded = harness.events.at(-1);
  assert.equal(superseded.generation, 1);
});

test('a queued generation that never becomes current is reported, not dropped silently', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });
  // A second schedule supersedes the first before the first microtask drains.
  await harness.service.run(true, () => true, () => { runs += 1; });

  const [first, second] = harness.scheduled.splice(0, 2);
  first();
  second();

  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), [
    'scheduled',
    'cancel',
    'scheduled',
    'superseded',
    'start'
  ]);
});

test('an index whose microtask never drains is recovered by resume', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });
  // The shell froze right after `interactive`: the queued callback is still sitting there.
  assert.equal(runs, 0);
  assert.equal(harness.scheduled.length, 1);

  harness.setNow(5);
  harness.service.resume();

  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'resumed']);
  assert.equal(harness.events.at(-1).elapsedMs, 5);
});

test('resume is idempotent and a late microtask cannot double-index', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });
  harness.service.resume();
  harness.service.resume();
  // The frozen microtask finally drains after the resume already ran the index.
  harness.scheduled.shift()();

  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'resumed']);
});

test('the microtask still wins when it drains first and resume then does nothing', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });
  harness.scheduled.shift()();
  harness.service.resume();

  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'start']);
});

test('resume does nothing after a cancel and never revives a dropped index', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });
  assert.equal(harness.service.cancel(), true);
  harness.service.resume();
  harness.scheduled.shift()();

  assert.equal(runs, 0);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'cancel', 'superseded']);
});

test('resume respects the workspace generation instead of indexing a stale Project', async () => {
  const harness = createHarness();
  let runs = 0;
  let current = true;

  await harness.service.run(true, () => current, () => { runs += 1; });
  current = false;
  harness.service.resume();

  assert.equal(runs, 0);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'cancel']);
});

test('resume without a pending index is a no-op', () => {
  const harness = createHarness();
  harness.service.resume();
  assert.deepEqual(harness.events, []);
});

test('synchronous scheduler failure is diagnosed, clears pending state, and is rethrown', async () => {
  const failure = new Error('scheduler failed');
  const harness = createHarness(() => {
    throw failure;
  });

  await assert.rejects(
    harness.service.run(
      true,
      () => true,
      () => {}
    ),
    (error) => error === failure
  );

  assert.equal(harness.service.cancel(), false);
  assert.deepEqual(
    harness.events.map(({ phase }) => phase),
    ['scheduled', 'schedule-failure']
  );
});

test('rejected deferred action is diagnosed without an unhandled rejection', async () => {
  const harness = createHarness();

  await harness.service.run(
    true,
    () => true,
    async () => {
      throw new Error('action failed');
    }
  );
  harness.setNow(7);
  harness.scheduled.shift()();
  await Promise.resolve();

  assert.deepEqual(
    harness.events.map(({ phase }) => phase),
    ['scheduled', 'start', 'action-failure']
  );
  assert.equal(harness.events.at(-1).elapsedMs, 7);
});

test('restore index failure diagnostics expose only fixed privacy-safe fields', () => {
  const lines = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    clock: () => 5,
    write: (line) => lines.push(line)
  });

  for (const phase of ['schedule-failure', 'action-failure']) {
    diagnostics.emit('restore-index-grace', {
      tag: 'g1',
      phase,
      generation: 3,
      elapsedMs: 5,
      error: new Error('private failure'),
      rootPath: '/private/root'
    });
  }

  assert.deepEqual(lines, [
    '[onlypreview-search] event=restore-index-grace tag=g1 phase=schedule-failure generation=3 elapsedMs=5',
    '[onlypreview-search] event=restore-index-grace tag=g1 phase=action-failure generation=3 elapsedMs=5'
  ]);
  assert.doesNotMatch(lines.join('\n'), /private|error|root/i);
});
