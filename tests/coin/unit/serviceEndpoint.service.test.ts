import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ServiceEndpointService } from '../../../src/main/coin/resources/serviceEndpoint.service';
import { ServiceEndpointStore } from '../../../src/main/coin/resources/serviceEndpoint.store';

test('persists validated overrides and returns only host readiness to the renderer contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-service-endpoint-test-'));
  try {
    const service = new ServiceEndpointService({
      store: new ServiceEndpointStore(() => root),
      runtimeEnv: () => ({}),
      allowLoopback: false,
    });
    const monitor = await service.save({
      service: 'monitor',
      httpUrl: 'https://monitor.example.com/api',
      wsUrl: 'wss://stream.example.com/live',
    });
    assert.equal(monitor.ok, true);
    assert.deepEqual(monitor.status, {
      service: 'monitor',
      state: 'configured',
      configured: true,
      httpHost: 'monitor.example.com',
      wsHost: 'stream.example.com',
      source: 'override',
    });
    assert.doesNotMatch(JSON.stringify(monitor.status), /\/api|\/live/);
    assert.deepEqual(service.resolve('monitor'), {
      service: 'monitor',
      httpUrl: 'https://monitor.example.com/api',
      wsUrl: 'wss://stream.example.com/live',
      source: 'override',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves complete runtime pairs, rejects partial/credential-bearing URLs, and prefers overrides', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-service-runtime-test-'));
  try {
    const env: NodeJS.ProcessEnv = {
      VITE_COIN_MONITOR_API_BASE: 'https://runtime-monitor.example.com',
      VITE_COIN_MONITOR_WS_BASE: 'wss://runtime-stream.example.com',
      VITE_COIN_SCREEN_API_BASE: 'https://runtime-screen.example.com',
      VITE_COIN_MEME_API_BASE: 'https://runtime-meme.example.com',
    };
    const service = new ServiceEndpointService({
      store: new ServiceEndpointStore(() => root),
      runtimeEnv: () => env,
      allowLoopback: false,
    });
    assert.equal(service.getStatuses().every((item) => item.configured), true);
    assert.equal(service.resolve('screener')?.source, 'runtime');

    const override = await service.save({
      service: 'screener',
      httpUrl: 'https://override-screen.example.com/v1',
    });
    assert.equal(override.ok, true);
    assert.equal(service.resolve('screener')?.httpUrl, 'https://override-screen.example.com/v1');

    const query = await service.save({
      service: 'meme',
      httpUrl: 'https://meme.example.com?token=secret',
    });
    assert.equal(query.ok, false);
    assert.equal(query.errorCode, 'invalid-input');

    env.VITE_COIN_MONITOR_WS_BASE = '';
    rmSync(join(root, 'coin', 'service-endpoints.json'), { force: true });
    assert.equal(service.getStatuses().find((item) => item.service === 'monitor')?.state, 'invalid');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not silently recover from a corrupt service endpoint file', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-service-corrupt-test-'));
  try {
    const store = new ServiceEndpointStore(() => root);
    mkdirSync(dirname(store.filePath), { recursive: true });
    writeFileSync(store.filePath, '{"version":2}', 'utf8');
    const service = new ServiceEndpointService({
      store,
      runtimeEnv: () => ({ VITE_COIN_MEME_API_BASE: 'https://runtime.example.com' }),
      allowLoopback: false,
    });
    assert.equal(service.getStatuses().every((item) => item.state === 'invalid'), true);
    assert.throws(() => service.resolve('meme'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
