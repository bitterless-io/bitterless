import assert from 'node:assert/strict';
import test from 'node:test';
import { SnipingSessionError, SnipingSessionService } from '../../../src/main/sniping/snipingSession.service';

test('activation is idempotent only for the same session and token pair', () => {
  const service = new SnipingSessionService();
  service.activate({ coreToken: 'token-a', sessionId: 'session-a' });
  const first = service.capture();

  assert.deepEqual(service.activate({ coreToken: 'token-a', sessionId: 'session-a' }), { active: true });
  assert.equal(service.capture(), first);
  assert.equal(first.signal.aborted, false);

  assert.throws(
    () => service.activate({ coreToken: 'token-substitution', sessionId: 'session-a' }),
    (error) => error instanceof SnipingSessionError && error.code === 'SNIPING_SESSION_INVALID',
  );
  assert.equal(service.capture(), first);
  assert.equal(first.signal.aborted, false);
});

test('replacement aborts the old generation and stale clear cannot kill the replacement', () => {
  const service = new SnipingSessionService();
  service.activate({ coreToken: 'token-a', sessionId: 'session-a' });
  const first = service.capture();

  service.activate({ coreToken: 'token-b', sessionId: 'session-b' });
  const second = service.capture();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(service.isCurrent(first), false);
  assert.equal(service.isCurrent(second), true);

  assert.deepEqual(service.clear({ sessionId: 'session-a' }), { cleared: false });
  assert.equal(service.capture(), second);
  assert.equal(second.signal.aborted, false);

  assert.deepEqual(service.clear({ sessionId: 'session-b' }), { cleared: true });
  assert.equal(second.signal.aborted, true);
  assert.throws(() => service.capture(), /SNIPING_SESSION_REQUIRED/);
});

test('session inputs are closed and never accept extra token aliases', () => {
  const service = new SnipingSessionService();
  for (const invalid of [
    null,
    { coreToken: 'token', sessionId: 'session', token: 'alias' },
    { coreToken: ' token', sessionId: 'session' },
    { coreToken: 'token', sessionId: '../session' },
  ]) {
    assert.throws(() => service.activate(invalid), /SNIPING_SESSION_INVALID/);
  }
  assert.throws(() => service.clear({ sessionId: 'session', token: 'alias' }), /SNIPING_SESSION_INVALID/);
});
