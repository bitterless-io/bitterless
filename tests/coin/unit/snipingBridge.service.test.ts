import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SnipingBridgeService } from '../../../src/main/sniping/snipingBridge.service';
import type { SnipingRelayClient } from '../../../src/main/sniping/snipingRelay.client';
import {
  SNIPING_CORE_ROUTES,
} from '../../../src/main/sniping/snipingRelay.client';
import { SNIPING_IPC_CHANNELS } from '../../../src/shared/sniping/snipingBridge.type';
import { SNIPING_SESSION_IPC_CHANNELS } from '../../../src/shared/sniping/snipingSession.type';

test('bridge exposes exactly fourteen Coin methods and Main owns every fixed route', () => {
  assert.deepEqual(Object.keys(SNIPING_IPC_CHANNELS), [
    'listComponents',
    'listConfigs',
    'getConfig',
    'validateConfig',
    'saveConfig',
    'startMonitoring',
    'stopMonitoring',
    'listRuntimes',
    'listSimulationEvents',
    'requestExactSimulation',
    'listExactSimulations',
    'requestShadowSimulation',
    'listShadowSimulations',
    'listActivity',
  ]);
  assert.equal(Object.keys(SNIPING_CORE_ROUTES).length, 13);
  assert.deepEqual(Object.keys(SNIPING_SESSION_IPC_CHANNELS), ['activate', 'clear']);

  const preload = readFileSync(join(process.cwd(), 'src/preload/trench/trench.preload.ts'), 'utf8');
  assert.doesNotMatch(preload, /coreToken|sessionId|-x-bl-token|sniping\/config/);
  assert.doesNotMatch(preload, /execute|broadcast|signer|canary/i);
  for (const method of Object.keys(SNIPING_IPC_CHANNELS)) {
    assert.match(preload, new RegExp(`SNIPING_IPC_CHANNELS\\.${method}`));
  }
});

test('Start and Stop alone inject the two legal desired states', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const relay = {
    request: async (options: { method: string; path: string; body: unknown }) => {
      calls.push({ method: options.method, path: options.path, body: options.body });
      return { ok: false as const, error: {
        code: 'FIXTURE', message: 'fixture', status: null, retryable: false,
      } };
    },
  } as unknown as SnipingRelayClient;
  const bridge = new SnipingBridgeService(relay);

  await bridge.startMonitoring({ config_id: '12', expected_revision: 3 });
  await bridge.stopMonitoring({ config_id: '12', expected_revision: 4 });
  assert.deepEqual(calls, [
    {
      method: 'POST',
      path: '/sniping/config/set-desired-state',
      body: { config_id: '12', expected_revision: 3, desired_state: 'armed' },
    },
    {
      method: 'POST',
      path: '/sniping/config/set-desired-state',
      body: { config_id: '12', expected_revision: 4, desired_state: 'disabled' },
    },
  ]);
});

test('invalid renderer envelopes return a sanitized bridge error without reaching Core', async () => {
  let requests = 0;
  const relay = {
    request: async () => {
      requests += 1;
      throw new Error('must not reach relay');
    },
  } as unknown as SnipingRelayClient;
  const bridge = new SnipingBridgeService(relay);
  const result = await bridge.saveConfig({
    component_id: 'flap-quote-token-snipe',
    component_version: '1.0.0',
    schema_hash: 'a'.repeat(64),
    chain: 'bsc',
    name: 'unsafe',
    config: { providerApiKey: 'redacted' },
    primary_region: 'sg',
    standby_region: 'jp',
    expected_revision: 0,
  });
  assert.equal(requests, 0);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'SNIPING_BRIDGE_INPUT_INVALID',
      message: 'The Sniping request is invalid.',
      status: null,
      retryable: false,
    },
  });
});
