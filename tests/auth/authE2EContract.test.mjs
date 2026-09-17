import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AUTH_E2E_PRODUCTION_ORIGIN as origin,
  isAllowedAuthE2ERequest,
  assertAuthE2EProfile
} from '../../src/shared/auth/authE2E.contract.ts';

test('real production E2E permits only login, validation and logout', () => {
  for (const [path, method] of [
    ['/auth/login', 'POST'],
    ['/auth/me', 'GET'],
    ['/auth/logout', 'POST']
  ]) {
    assert.equal(isAllowedAuthE2ERequest(origin + path, method), true);
    assert.equal(isAllowedAuthE2ERequest(origin + path, 'OPTIONS'), true);
  }
  for (const [url, method] of [
    [origin + '/todo/sync', 'POST'],
    [origin + '/auth/change-password', 'POST'],
    [origin + '/auth/send-otp', 'POST'],
    [origin + '/auth/me?token=redacted', 'GET'],
    ['https://bl-test-api.terncloud.com/auth/login', 'POST'],
    [origin + '/auth/me', 'POST'],
    [origin + '/auth/login', 'GET']
  ]) {
    assert.equal(isAllowedAuthE2ERequest(url, method), false);
  }
});

test('auth-only mode requires unpackaged isolated debug production; baseline guard stays intact', () => {
  const profile = {
    packaged: false,
    mode: 'debug',
    env: 'prod',
    coreOrigin: origin,
    userData: '/tmp/isolated'
  };
  assert.doesNotThrow(() => assertAuthE2EProfile(profile));
  for (const patch of [
    { packaged: true },
    { mode: 'release' },
    { env: 'dev' },
    { coreOrigin: 'https://example.invalid' },
    { userData: undefined }
  ])
    assert.throws(() => assertAuthE2EProfile({ ...profile, ...patch }));
  const baseline = readFileSync(new URL('../e2e/e2eRuntimeMode.ts', import.meta.url), 'utf8');
  assert.match(baseline, /marker\.profileName !== 'debug_dev'/);
  const launch = readFileSync(new URL('./authRuntime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(launch, /\.\.\.process\.env|HOME:|USERPROFILE:|AUTH_E2E_PASSWORD/);
  const config = readFileSync(new URL('./playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /trace: 'off', video: 'off', screenshot: 'off'/);
  assert.match(config, /preserveOutput: 'never'/);
});
