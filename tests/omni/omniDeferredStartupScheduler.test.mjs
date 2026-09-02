import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOmniDeferredStartupRegistry,
  scheduleOmniDeferredStartup,
} from '../../src/shared/omni/omniDeferredStartup.scheduler.mjs';

test('deferred startup yields past microtasks and runs once on its timer turn', async () => {
  let scheduled;
  let calls = 0;
  scheduleOmniDeferredStartup(() => { calls += 1; }, {
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => {},
  });

  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 0);
  scheduled();
  scheduled();
  assert.equal(calls, 1);
});

test('same-generation reopen preserves the first deferred batch and runs it once', () => {
  let scheduled;
  let contentCalls = 0;
  let controlCalls = 0;
  const registry = createOmniDeferredStartupRegistry((callback) => {
    scheduled = callback;
    return () => true;
  });
  const first = registry.schedule(9, () => {
    contentCalls += 1;
    controlCalls += 1;
  });
  const reopen = registry.schedule(9, () => {
    contentCalls += 100;
    controlCalls += 100;
  });

  assert.equal(first, true);
  assert.equal(reopen, false);
  scheduled();
  scheduled();
  assert.equal(contentCalls, 1);
  assert.equal(controlCalls, 1);
});

test('deferred startup cancellation clears ownership and makes stale callbacks inert', () => {
  let scheduled;
  let cleared;
  let calls = 0;
  const cancel = scheduleOmniDeferredStartup(() => { calls += 1; }, {
    setTimer: (callback) => { scheduled = callback; return 7; },
    clearTimer: (handle) => { cleared = handle; },
  });

  assert.equal(cancel(), true);
  assert.equal(cancel(), false);
  assert.equal(cleared, 7);
  scheduled();
  assert.equal(calls, 0);
});
