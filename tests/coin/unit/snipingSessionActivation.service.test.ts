import assert from 'node:assert/strict';
import test from 'node:test';
import { SnipingSessionActivationService } from '../../../src/renderer/home/src/stores/auth/snipingSessionActivation.service';
import type { SnipingSessionBridge } from '../../../src/shared/sniping/snipingSession.type';

const bridge = (overrides: Partial<SnipingSessionBridge> = {}): SnipingSessionBridge => ({
  activate: async () => ({ active: true }),
  clear: async () => ({ cleared: true }),
  ...overrides,
});

test('optional session relay failures never reject validated Home auth lifecycle', async () => {
  const unavailable: string[] = [];
  const lifecycle = new SnipingSessionActivationService(bridge({
    activate: async () => { throw new Error('fixture secret must not be logged'); },
    clear: async () => { throw new Error('fixture secret must not be logged'); },
  }), 20, (operation) => unavailable.push(operation));

  await assert.doesNotReject(lifecycle.clear({ sessionId: 'old-session' }));
  await assert.doesNotReject(lifecycle.activate({ coreToken: 'new-token', sessionId: 'new-session' }));
  assert.deepEqual(unavailable, ['clear', 'activate']);
});

test('hung optional relay calls are bounded and do not block Home auth', async () => {
  const never = new Promise<never>(() => undefined);
  const unavailable: string[] = [];
  const activated: string[] = [];
  const lifecycle = new SnipingSessionActivationService(bridge({
    activate: async ({ sessionId }) => {
      activated.push(sessionId);
      return { active: true };
    },
    clear: async () => await never,
  }), 5, (operation) => unavailable.push(operation));

  const startedAt = Date.now();
  await lifecycle.clear({ sessionId: 'old-session' });
  await lifecycle.activate({ coreToken: 'new-token', sessionId: 'new-session' });
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(unavailable, ['clear']);
  assert.deepEqual(activated, ['new-session']);
});

test('serialized replacements fence stale A to B activation before latest C', async () => {
  let enteredClearA: (() => void) | undefined;
  const clearAEntered = new Promise<void>((resolve) => { enteredClearA = resolve; });
  let releaseClearA: (() => void) | undefined;
  const clearA = new Promise<void>((resolve) => { releaseClearA = resolve; });
  const calls: string[] = [];
  const lifecycle = new SnipingSessionActivationService(bridge({
    clear: async ({ sessionId }) => {
      calls.push(`clear:${sessionId}`);
      if (sessionId === 'session-a') {
        enteredClearA?.();
        await clearA;
      }
      return { cleared: true };
    },
    activate: async ({ sessionId }) => {
      calls.push(`activate:${sessionId}`);
      return { active: true };
    },
  }), 100);

  const replaceB = lifecycle.replace(
    { sessionId: 'session-a' },
    { coreToken: 'token-b', sessionId: 'session-b' },
  );
  await clearAEntered;
  const replaceC = lifecycle.replace(
    { sessionId: 'session-b' },
    { coreToken: 'token-c', sessionId: 'session-c' },
  );
  releaseClearA?.();
  await Promise.all([replaceB, replaceC]);

  assert.deepEqual(calls, [
    'clear:session-a',
    'clear:session-b',
    'activate:session-c',
  ]);
});

test('a late stale activation compensates back to the latest Main session', async () => {
  let releaseA: (() => void) | undefined;
  let enteredA: (() => void) | undefined;
  const aEntered = new Promise<void>((resolve) => { enteredA = resolve; });
  const aPending = new Promise<void>((resolve) => { releaseA = resolve; });
  const calls: string[] = [];
  let active = '';
  const lifecycle = new SnipingSessionActivationService(bridge({
    activate: async ({ sessionId }) => {
      calls.push(`activate:${sessionId}`);
      if (sessionId === 'session-a') {
        enteredA?.();
        await aPending;
      }
      active = sessionId;
      return { active: true };
    },
  }), 5);

  const activateA = lifecycle.activate({ coreToken: 'token-a', sessionId: 'session-a' });
  await aEntered;
  await activateA;
  await lifecycle.activate({ coreToken: 'token-c', sessionId: 'session-c' });
  assert.equal(active, 'session-c');
  releaseA?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(active, 'session-c');
  assert.deepEqual(calls, ['activate:session-a', 'activate:session-c', 'activate:session-c']);
});

test('a late stale activation clears its own Main session when the latest intent is cleared', async () => {
  let releaseA: (() => void) | undefined;
  let enteredA: (() => void) | undefined;
  let clearedA: (() => void) | undefined;
  let reconciledClear: (() => void) | undefined;
  const aEntered = new Promise<void>((resolve) => { enteredA = resolve; });
  const aPending = new Promise<void>((resolve) => { releaseA = resolve; });
  const aCleared = new Promise<void>((resolve) => { clearedA = resolve; });
  const latestClearReconciled = new Promise<void>((resolve) => { reconciledClear = resolve; });
  const calls: string[] = [];
  let active = '';
  const lifecycle = new SnipingSessionActivationService(bridge({
    activate: async ({ sessionId }) => {
      calls.push(`activate:${sessionId}`);
      if (sessionId === 'session-a') {
        enteredA?.();
        await aPending;
      }
      active = sessionId;
      return { active: true };
    },
    clear: async ({ sessionId }) => {
      calls.push(`clear:${sessionId}`);
      if (active === sessionId) active = '';
      if (sessionId === 'session-a') clearedA?.();
      if (sessionId === 'session-c' && calls.filter((call) => call === 'clear:session-c').length === 2) {
        reconciledClear?.();
      }
      return { cleared: true };
    },
  }), 5);

  const activateA = lifecycle.activate({ coreToken: 'token-a', sessionId: 'session-a' });
  await aEntered;
  await activateA;
  await lifecycle.clear({ sessionId: 'session-c' });
  releaseA?.();
  await aCleared;
  await latestClearReconciled;

  assert.equal(active, '');
  assert.deepEqual(calls, [
    'activate:session-a',
    'clear:session-c',
    'clear:session-a',
    'clear:session-c',
  ]);
});
