import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CoinGmgnProbeReceipt,
  CoinGmgnStatus,
} from '../../../src/shared/coin/coinResource.type';
import {
  TrenchGmgnSettingsStore,
  type TrenchGmgnSettingsClient,
} from '../../../src/renderer/coin/src/components/TrenchGmgnSettings/trenchGmgnSettings.store';

const statusFixture = (overrides: Partial<CoinGmgnStatus> = {}): CoinGmgnStatus => ({
  installed: true,
  version: '1.5.2',
  displayPath: '~/.yarn/bin/gmgn-cli',
  apiKeyConfigured: true,
  privateKeyDetected: false,
  checkedAt: 1_000,
  lastProbe: null,
  ...overrides,
});

const probeFixture = (
  code: CoinGmgnProbeReceipt['code'] = 'verified',
): CoinGmgnProbeReceipt => ({
  ok: code === 'verified',
  code,
  startedAt: 1_001,
  completedAt: 1_002,
  summary: code === 'verified' ? 'read-only-response' : 'unavailable',
  recordCount: code === 'verified' ? 3 : null,
});

const clientFixture = (
  overrides: Partial<TrenchGmgnSettingsClient> = {},
): TrenchGmgnSettingsClient => ({
  detectGmgn: async () => statusFixture(),
  saveGmgnApiKey: async () => ({ ok: true, configured: true, savedAt: 1_000 }),
  verifyGmgn: async () => probeFixture(),
  openGmgnOfficialLink: async () => true,
  ...overrides,
});

test('opens with blank non-readback input and accepts only sanitized status', async () => {
  const store = new TrenchGmgnSettingsStore(clientFixture());
  store.apiKey = 'must-be-cleared-before-open';
  store.open();
  assert.equal(store.visible, true);
  assert.equal(store.apiKey, '');
  while (store.pending) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(store.status, statusFixture());
  assert.doesNotMatch(JSON.stringify(store.status), /must-be-cleared/);
});

test('save and verify writes first, refreshes sanitized status, then probes without INDEX work', async () => {
  const calls: string[] = [];
  const typedRequests: Array<{ apiKey: string }> = [];
  const client = clientFixture({
    saveGmgnApiKey: async (request) => {
      calls.push('save');
      typedRequests.push(request);
      return { ok: true, configured: true, savedAt: 1_000 };
    },
    detectGmgn: async () => {
      calls.push('detect');
      return statusFixture();
    },
    verifyGmgn: async () => {
      calls.push('verify');
      return probeFixture();
    },
  });
  const store = new TrenchGmgnSettingsStore(client);
  store.apiKey = 'gmgn_test_replacement_12345';
  assert.equal(await store.saveAndVerify(), true);
  assert.deepEqual(calls, ['save', 'detect', 'verify']);
  assert.deepEqual(typedRequests, [{ apiKey: 'gmgn_test_replacement_12345' }]);
  assert.equal(store.apiKey, '');
  assert.deepEqual(store.feedback, { code: 'verified', tone: 'success' });
  assert.equal(store.status?.lastProbe?.code, 'verified');
});

test('typed save and probe failures keep the modal open and clear replacement input', async () => {
  let verifyCalls = 0;
  const saveFailureStore = new TrenchGmgnSettingsStore(clientFixture({
    saveGmgnApiKey: async () => ({
      ok: false,
      configured: false,
      savedAt: 1_000,
      errorCode: 'write-failed',
    }),
    verifyGmgn: async () => {
      verifyCalls += 1;
      return probeFixture();
    },
  }));
  saveFailureStore.visible = true;
  saveFailureStore.apiKey = 'gmgn_write_failure_12345';
  assert.equal(await saveFailureStore.saveAndVerify(), false);
  assert.equal(saveFailureStore.visible, true);
  assert.equal(saveFailureStore.apiKey, '');
  assert.deepEqual(saveFailureStore.feedback, { code: 'write-failed', tone: 'error' });
  assert.equal(verifyCalls, 0);

  const probeFailureStore = new TrenchGmgnSettingsStore(clientFixture({
    verifyGmgn: async () => probeFixture('unauthorized'),
  }));
  probeFailureStore.visible = true;
  probeFailureStore.apiKey = 'gmgn_probe_failure_12345';
  assert.equal(await probeFailureStore.saveAndVerify(), false);
  assert.equal(probeFailureStore.visible, true);
  assert.equal(probeFailureStore.apiKey, '');
  assert.deepEqual(probeFailureStore.feedback, { code: 'unauthorized', tone: 'error' });
});

test('deduplicates pending verification and does not close while an operation owns the modal', async () => {
  let releaseProbe: ((receipt: CoinGmgnProbeReceipt) => void) | null = null;
  let verifyCalls = 0;
  const store = new TrenchGmgnSettingsStore(clientFixture({
    verifyGmgn: async () => {
      verifyCalls += 1;
      return await new Promise<CoinGmgnProbeReceipt>((resolve) => {
        releaseProbe = resolve;
      });
    },
  }));
  store.visible = true;
  store.status = statusFixture();
  const first = store.verifyExisting();
  assert.equal(await store.verifyExisting(), false);
  store.close();
  assert.equal(store.visible, true);
  assert.equal(verifyCalls, 1);
  assert.ok(releaseProbe);
  releaseProbe(probeFixture());
  assert.equal(await first, true);
  store.close();
  assert.equal(store.visible, false);
});
