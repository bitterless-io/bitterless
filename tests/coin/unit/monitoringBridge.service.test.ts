import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  MonitoringBridgeService,
  MONITORING_CORE_ROUTES
} from '../../../src/main/monitoring/monitoringBridge.service';
import type { SnipingRelayClient } from '../../../src/main/sniping/snipingRelay.client';
import { SnipingResponseError } from '../../../src/main/sniping/snipingResponse.validation';
import { MONITORING_IPC_CHANNELS } from '../../../src/shared/monitoring/monitoringBridge.type';
import { SNIPING_IPC_CHANNELS } from '../../../src/shared/sniping/snipingBridge.type';
import {
  MONITORING_ADDRESS,
  monitoringFailure,
  monitoringListItem,
  monitoringOk
} from './monitoringFixtures';

const MONITORING_METHODS = ['list', 'get', 'save', 'start', 'stop', 'listSamples', 'listAnomalies'];
const SNIPING_METHODS = [
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
  'listActivity'
];

test('preload keeps Sniping exact fourteen and adds one separate frozen Monitoring exact seven', () => {
  assert.deepEqual(Object.keys(SNIPING_IPC_CHANNELS), SNIPING_METHODS);
  assert.deepEqual(Object.keys(MONITORING_IPC_CHANNELS), MONITORING_METHODS);
  const preload = readFileSync(join(process.cwd(), 'src/preload/trench/trench.preload.ts'), 'utf8');
  const monitoringStart = preload.indexOf(
    'const monitoringBridge = Object.freeze<MonitoringBridge>({'
  );
  const monitoringEnd = preload.indexOf('\n});', monitoringStart);
  assert.ok(monitoringStart >= 0 && monitoringEnd > monitoringStart);
  const monitoringBody = preload.slice(monitoringStart, monitoringEnd);
  for (const method of MONITORING_METHODS) {
    assert.equal(
      (monitoringBody.match(new RegExp(`MONITORING_IPC_CHANNELS\\.${method}\\b`, 'g')) ?? [])
        .length,
      1
    );
  }
  assert.match(preload, /contextBridge\.exposeInMainWorld\('monitoring', monitoringBridge\)/);
  assert.equal((preload.match(/exposeInMainWorld\('monitoring'/g) ?? []).length, 1);
  assert.equal((preload.match(/exposeInMainWorld\('sniping'/g) ?? []).length, 1);
  assert.doesNotMatch(
    monitoringBody,
    /chain|regions?|desired_state|provider|headers?|url|coreToken|customerJwt|api[_-]?key|credential|sql/i
  );
});

test('Main owns six fixed monitor routes and injects SG, JP and only legal desired states', async () => {
  assert.deepEqual(MONITORING_CORE_ROUTES, {
    list: { method: 'POST', path: '/sniping/monitor/list' },
    get: { method: 'POST', path: '/sniping/monitor/detail' },
    save: { method: 'POST', path: '/sniping/monitor/save' },
    state: { method: 'POST', path: '/sniping/monitor/set-desired-state' },
    samples: { method: 'POST', path: '/sniping/monitor/sample/list' },
    anomalies: { method: 'POST', path: '/sniping/monitor/anomaly/list' }
  });
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const relay = {
    request: async (options: { method: string; path: string; body: unknown }) => {
      calls.push({ method: options.method, path: options.path, body: options.body });
      return monitoringFailure('FIXTURE');
    }
  } as unknown as SnipingRelayClient;
  const bridge = new MonitoringBridgeService(relay);

  await bridge.list({ page: 1, page_size: 20 });
  await bridge.get({ config_id: '1' });
  await bridge.save({
    token_address: MONITORING_ADDRESS,
    zscore_threshold: 3,
    expected_revision: 0
  });
  await bridge.start({ config_id: '1', expected_revision: 1 });
  await bridge.stop({ config_id: '1', expected_revision: 2 });
  await bridge.listSamples({ config_id: '1', config_revision: 2, page_size: 250 });
  await bridge.listAnomalies({ states: ['HIGH'], page_size: 50 });

  assert.deepEqual(
    calls.map(({ method, path }) => ({ method, path })),
    [
      MONITORING_CORE_ROUTES.list,
      MONITORING_CORE_ROUTES.get,
      MONITORING_CORE_ROUTES.save,
      MONITORING_CORE_ROUTES.state,
      MONITORING_CORE_ROUTES.state,
      MONITORING_CORE_ROUTES.samples,
      MONITORING_CORE_ROUTES.anomalies
    ]
  );
  assert.deepEqual(calls[2].body, {
    token_address: MONITORING_ADDRESS,
    zscore_threshold: 3,
    expected_revision: 0,
    primary_region: 'sg',
    standby_region: 'jp'
  });
  assert.deepEqual(calls[3].body, { config_id: '1', expected_revision: 1, desired_state: 'armed' });
  assert.deepEqual(calls[4].body, {
    config_id: '1',
    expected_revision: 2,
    desired_state: 'disabled'
  });
});

test('forbidden renderer-owned routing and configuration fields fail before relay', async () => {
  let requestCount = 0;
  const relay = {
    request: async () => {
      requestCount += 1;
      return monitoringFailure('MUST_NOT_REACH');
    }
  } as unknown as SnipingRelayClient;
  const bridge = new MonitoringBridgeService(relay);
  const result = await bridge.save({
    token_address: MONITORING_ADDRESS,
    zscore_threshold: 3,
    expected_revision: 0,
    chain: 'bsc',
    primary_region: 'sg',
    desired_state: 'armed',
    provider_reference_id: 'bsc-read-sg'
  } as never);
  assert.equal(requestCount, 0);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'MONITORING_BRIDGE_INPUT_INVALID',
      message: 'The Monitoring request is invalid.',
      status: null,
      retryable: false
    }
  });
});

test('list response is bound to the exact reachable page and Private search semantics', async () => {
  const run = async (
    response: unknown,
    input: { page: number; page_size: number; search_text?: string }
  ) => {
    const relay = {
      request: async (options: { parse(value: unknown): unknown }) =>
        monitoringOk(options.parse(response))
    } as unknown as SnipingRelayClient;
    return await new MonitoringBridgeService(relay).list(input);
  };
  const match = monitoringListItem({ name: 'GmE Watch' });
  assert.equal(
    (
      await run(
        { list: [match], total: 1, page: 1, page_size: 20 },
        {
          page: 1,
          page_size: 20,
          search_text: 'GME'
        }
      )
    ).ok,
    true
  );
  assert.equal(
    (await run({ list: [], total: 0, page: 2, page_size: 20 }, { page: 2, page_size: 20 })).ok,
    true,
    'an empty out-of-range page can result from a concurrent shrink and is clamped by the store'
  );
  for (const response of [
    { list: [], total: 21, page: 2, page_size: 20 },
    { list: [match], total: 22, page: 2, page_size: 20 },
    { list: [monitoringListItem({ name: 'SPCX only' })], total: 1, page: 1, page_size: 20 }
  ]) {
    await assert.rejects(
      run(response, {
        page: response.page,
        page_size: response.page_size,
        ...(response.page === 1 ? { search_text: 'GME' } : {})
      }),
      SnipingResponseError
    );
  }
});
