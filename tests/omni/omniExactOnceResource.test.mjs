import assert from 'node:assert/strict';
import test from 'node:test';
import { createOmniExactOnceResource } from '../../src/shared/omni/omniExactOnceResource.mjs';

test('navigation resources clear sibling listeners, timer, and semaphore exactly once', () => {
  const resource = createOmniExactOnceResource();
  const calls = [];
  resource.add(() => calls.push('timer'));
  resource.add(() => calls.push('listeners'));
  resource.add(() => calls.push('semaphore'));

  assert.equal(resource.close(), true);
  assert.equal(resource.close(), false);
  assert.deepEqual(calls, ['timer', 'listeners', 'semaphore']);
});

test('a cleanup registered after terminal is disposed immediately', () => {
  const resource = createOmniExactOnceResource();
  resource.close();
  let calls = 0;
  assert.equal(resource.add(() => { calls += 1; }), false);
  assert.equal(calls, 1);
});
