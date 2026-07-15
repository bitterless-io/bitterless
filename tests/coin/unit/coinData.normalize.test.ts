import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSourceReceipt,
  normalizeMonitorPayload,
  normalizeScreenerPayload,
} from '../../../src/main/coin/data/coinData.normalize';

const receipt = createSourceReceipt({
  source: 'monitor-http',
  mode: 'http',
  status: 'ready',
  observedAt: 1_000,
  receivedAt: 1_000,
  evidenceIds: ['fixture:monitor'],
});

test('monitor normalization retains stale rows and explicit missing-symbol errors', () => {
  const now = Date.parse('2026-07-15T08:10:00.000Z');
  const result = normalizeMonitorPayload({
    states: [{
      symbol: 'BTCUSDT',
      currentPrice: { price: 120, time: '2026-07-15T08:00:00.000Z' },
      historicalLow: { price: 20 },
      historicalHigh: { price: 140 },
      listingAgeDays: 100,
      updatedAt: '2026-07-15T08:00:00.000Z',
    }],
    readAt: '2026-07-15T08:10:00.000Z',
  }, ['BTCUSDT', 'ETHUSDT'], now, receipt, 'connecting');
  assert.equal(result.rows[0]?.state, 'stale');
  assert.equal(result.rows[0]?.lowMultiple, 6);
  assert.equal(result.rows[1]?.state, 'error');
  assert.match(result.rows[1]?.reason || '', /did not return/i);
  assert.deepEqual(result.missingSymbols, ['ETHUSDT']);
});

test('screener normalization rejects a source mode that differs from the explicit request', () => {
  const screenReceipt = createSourceReceipt({
    source: 'screener',
    mode: 'http',
    status: 'ready',
    observedAt: 2_000,
    receivedAt: 2_000,
  });
  assert.throws(() => normalizeScreenerPayload({
    mode: 'sample',
    results: [],
    scanned: 0,
  }, 'live_public', screenReceipt, 2_000), /screener-mode-mismatch/);
  const sample = normalizeScreenerPayload({
    mode: 'sample',
    results: [],
    scanned: 0,
    matched: 0,
    rejected: 0,
  }, 'sample', { ...screenReceipt, mode: 'sample' }, 2_000);
  assert.equal(sample.mode, 'sample');
  assert.equal(sample.rows.length, 0);
});
