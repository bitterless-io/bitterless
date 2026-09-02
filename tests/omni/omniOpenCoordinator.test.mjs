import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OmniGenerationReadyCollector,
  OmniOpenCoordinator,
  OmniOpenStaleGenerationError,
  OmniOpenTimeoutError,
} from '../../src/main/windows/omniOpenCoordinator.service.ts';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

class FakeTimer {
  nextId = 1;
  now = 0;
  tasks = new Map();

  setTimeout(callback, timeoutMs) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, dueAt: this.now + timeoutMs });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  advanceBy(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.now = task.dueAt;
      task.callback();
    }
    this.now = target;
  }
}

const createHarness = (overrides = {}) => {
  const timer = overrides.timer ?? new FakeTimer();
  const events = [];
  const cleanup = [];
  const invalidated = [];
  let ready = overrides.ready ?? null;
  let createCalls = 0;
  const create = overrides.create ?? (() => Promise.resolve({ id: 'created' }));
  const coordinator = new OmniOpenCoordinator({
    getReady: () => ready,
    create: (generation) => {
      createCalls += 1;
      events.push(`create:${generation}`);
      return create(generation);
    },
    present: (value, generation) => {
      events.push(`present:${generation}:${value.id}`);
      overrides.present?.(value, generation);
    },
    cleanupIncomplete: (generation, error) => {
      cleanup.push({ generation, error });
      events.push(`cleanup:${generation}`);
      overrides.cleanupIncomplete?.(generation, error);
    },
    onInvalidate: (generation) => {
      invalidated.push(generation);
      overrides.onInvalidate?.(generation);
    },
  }, {
    timeoutMs: overrides.timeoutMs ?? 30_000,
    timer,
  });

  return {
    cleanup,
    coordinator,
    events,
    invalidated,
    get createCalls() { return createCalls; },
    setReady(value) { ready = value; },
    timer,
  };
};

test('concurrent cold opens return the exact same flight and do not resolve before ready', async () => {
  const creation = deferred();
  const harness = createHarness({ create: () => creation.promise });

  const first = harness.coordinator.open();
  const second = harness.coordinator.open();
  assert.strictEqual(first, second);
  assert.equal(harness.createCalls, 1);

  let settled = false;
  first.finally(() => { settled = true; });
  await flushMicrotasks();
  assert.equal(settled, false);
  assert.deepEqual(harness.events, ['create:1']);

  creation.resolve({ id: 'omni' });
  assert.deepEqual(await first, { id: 'omni' });
  assert.deepEqual(harness.events, ['create:1', 'present:1:omni']);
});

test('top and every initial browser cell must be ready before present and resolve', async () => {
  const top = deferred();
  const firstCell = deferred();
  const secondCell = deferred();
  const harness = createHarness({
    create: async () => {
      await Promise.all([top.promise, firstCell.promise, secondCell.promise]);
      return { id: 'full-graph' };
    },
  });

  const opening = harness.coordinator.open();
  let resolved = false;
  opening.then(() => { resolved = true; });
  top.resolve();
  firstCell.resolve();
  await flushMicrotasks();
  assert.equal(resolved, false);
  assert.deepEqual(harness.events, ['create:1']);

  secondCell.resolve();
  const result = await opening;
  assert.equal(result.id, 'full-graph');
  assert.deepEqual(harness.events, ['create:1', 'present:1:full-graph']);
  assert.equal(resolved, true);
});

test('timeout rejects and cleans the current incomplete generation exactly once', async () => {
  const creation = deferred();
  const harness = createHarness({ create: () => creation.promise });

  const opening = harness.coordinator.open();
  harness.timer.advanceBy(29_999);
  await flushMicrotasks();
  assert.equal(harness.cleanup.length, 0);
  harness.timer.advanceBy(1);

  await assert.rejects(opening, (error) => {
    assert.ok(error instanceof OmniOpenTimeoutError);
    assert.equal(error.timeoutMs, 30_000);
    return true;
  });
  assert.equal(harness.cleanup.length, 1);
  assert.equal(harness.cleanup[0].generation, 1);

  creation.resolve({ id: 'too-late' });
  await flushMicrotasks();
  assert.equal(harness.cleanup.length, 1);
  assert.equal(harness.events.includes('present:1:too-late'), false);
});

test('create and present failures each clean their current generation once', async () => {
  const createError = new Error('create failed');
  const createHarnessResult = createHarness({
    create: () => Promise.reject(createError),
  });
  await assert.rejects(createHarnessResult.coordinator.open(), createError);
  assert.equal(createHarnessResult.cleanup.length, 1);
  assert.strictEqual(createHarnessResult.cleanup[0].error, createError);

  const presentError = new Error('present failed');
  const presentHarnessResult = createHarness({
    present: () => { throw presentError; },
  });
  await assert.rejects(presentHarnessResult.coordinator.open(), presentError);
  assert.equal(presentHarnessResult.cleanup.length, 1);
  assert.strictEqual(presentHarnessResult.cleanup[0].error, presentError);
});

test('an invalidated old generation cannot clean or clear the new flight', async () => {
  const oldCreation = deferred();
  const newCreation = deferred();
  let createIndex = 0;
  const harness = createHarness({
    create: () => {
      createIndex += 1;
      return createIndex === 1 ? oldCreation.promise : newCreation.promise;
    },
  });

  const oldOpening = harness.coordinator.open();
  assert.equal(harness.coordinator.isCurrent(1), true);
  harness.coordinator.invalidate();
  assert.deepEqual(harness.invalidated, [1]);
  assert.equal(harness.coordinator.isCurrent(1), false);
  const newOpening = harness.coordinator.open();
  assert.notStrictEqual(newOpening, oldOpening);
  assert.equal(harness.coordinator.isCurrent(3), true);

  oldCreation.resolve({ id: 'old' });
  await assert.rejects(oldOpening, (error) => {
    assert.ok(error instanceof OmniOpenStaleGenerationError);
    assert.equal(error.generation, 1);
    return true;
  });
  assert.equal(harness.cleanup.length, 0);
  assert.strictEqual(harness.coordinator.open(), newOpening);

  newCreation.resolve({ id: 'new' });
  assert.equal((await newOpening).id, 'new');
  assert.deepEqual(harness.events, [
    'create:1',
    'create:3',
    'present:3:new',
  ]);
});

test('a delayed old restore cannot clear the new generation browser-cell readiness batch', async () => {
  const timer = new FakeTimer();
  const collector = new OmniGenerationReadyCollector();
  const oldRestore = deferred();
  const newTop = deferred();
  const newCell = deferred();
  const openTimings = new Set();
  const presented = [];
  let createCount = 0;

  const coordinator = new OmniOpenCoordinator({
    getReady: () => null,
    create: async (generation) => {
      createCount += 1;
      openTimings.add(generation);
      const batch = collector.begin(generation);
      try {
        if (createCount === 1) {
          await oldRestore.promise;
        } else {
          batch.promises.push(newTop.promise, newCell.promise);
          await Promise.all(batch.promises);
        }
        return { id: `generation-${generation}` };
      } finally {
        collector.finish(batch);
      }
    },
    present: (_value, generation) => {
      presented.push(generation);
      openTimings.delete(generation);
    },
    cleanupIncomplete: (generation) => {
      openTimings.delete(generation);
      collector.invalidate();
    },
    onInvalidate: (generation) => {
      openTimings.delete(generation);
    },
  }, { timeoutMs: 30_000, timer });

  const oldOpening = coordinator.open();
  timer.advanceBy(30_000);
  await assert.rejects(oldOpening, OmniOpenTimeoutError);
  assert.equal(openTimings.has(1), false);

  const newOpening = coordinator.open();
  const newBatch = collector.active;
  assert.equal(newBatch?.generation, 3);
  assert.equal(openTimings.has(3), true);

  oldRestore.resolve();
  await flushMicrotasks();
  assert.strictEqual(collector.active, newBatch);
  assert.equal(openTimings.has(3), true);

  let newResolved = false;
  newOpening.then(() => { newResolved = true; });
  newTop.resolve();
  await flushMicrotasks();
  assert.equal(newResolved, false);
  assert.deepEqual(presented, []);

  newCell.resolve();
  assert.equal((await newOpening).id, 'generation-3');
  assert.deepEqual(presented, [3]);
  assert.equal(openTimings.size, 0);
});

test('an already-ready window is focused without creating another graph', async () => {
  const existing = { id: 'existing' };
  const harness = createHarness({ ready: existing });

  const first = harness.coordinator.open();
  const second = harness.coordinator.open();
  assert.strictEqual(first, second);
  assert.strictEqual(await first, existing);
  assert.equal(harness.createCalls, 0);
  assert.deepEqual(harness.events, ['present:0:existing']);
  assert.equal(harness.cleanup.length, 0);
});
