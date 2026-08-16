import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMonitoringChart,
  monitoringAnomalyDisplay,
  monitoringCollectionDisplayState,
  monitoringCurrentSample,
  monitoringUtcRange,
  monitoringWatchDisplay
} from '../../../src/renderer/coin/src/views/monitoring/monitoringPresentation.service';
import { MonitoringStore } from '../../../src/renderer/coin/src/views/monitoring/monitoring.store';
import {
  MONITORING_BUCKET_SEQUENCE,
  monitoringBridgeStub,
  monitoringDetail,
  monitoringSample
} from './monitoringFixtures';

const sequence = (offset: number): string =>
  String(BigInt(MONITORING_BUCKET_SEQUENCE) - BigInt(offset));

const setZ = (offset: number, value: string | null) => {
  const sample = monitoringSample({ sequence: sequence(offset) });
  sample.z_score = value;
  for (const region of sample.regions) region.z_score = value;
  return sample;
};

test('chart threshold lines use the same Y scale as Z-score evidence', () => {
  const atUpperThreshold = setZ(0, '3');
  const chart = buildMonitoringChart([atUpperThreshold]);
  const [, y] = chart.zSegments[0].points.split(',').map(Number);
  assert.equal(y, Number(chart.upperThresholdY.toFixed(2)));

  const atLowerThreshold = setZ(0, '-3');
  const lowerChart = buildMonitoringChart([atLowerThreshold]);
  const [, lowerY] = lowerChart.zSegments[0].points.split(',').map(Number);
  assert.equal(lowerY, Number(lowerChart.lowerThresholdY.toFixed(2)));
});

test('null Z-score creates a Z segment gap without erasing valid count evidence', () => {
  const newest = setZ(0, '1');
  const middle = setZ(1, null);
  const oldest = setZ(2, '-1');
  const chart = buildMonitoringChart([newest, middle, oldest]);
  assert.equal(chart.countSegments.length, 1);
  assert.equal(chart.zSegments.length, 2);
  assert.equal(chart.empty, false);
  assert.equal(chart.countSegments[0].points.split(' ').length, 3);
  assert.deepEqual(
    chart.zSegments.map((segment) => segment.points.split(' ').length),
    [1, 1]
  );
});

test('a missing bucket breaks both count and Z lines instead of bridging absent evidence', () => {
  const newest = setZ(0, '2');
  const oldest = setZ(2, '-2');
  const chart = buildMonitoringChart([newest, oldest]);
  assert.equal(chart.hasGap, true);
  assert.deepEqual(
    chart.countSegments.map((segment) => segment.points.split(' ').length),
    [1, 1]
  );
  assert.deepEqual(
    chart.zSegments.map((segment) => segment.points.split(' ').length),
    [1, 1]
  );
});

test('watch display chooses loaded history before current detail and never leaks latest across revisions', () => {
  const latest = monitoringSample({ revision: 3, state: 'HIGH' });
  const detail = monitoringDetail({
    config_revision: 3,
    latest,
    readiness: { state: 'HIGH', baseline_count: 72, minimum_baseline_count: 72 },
    available_revisions: [
      {
        revision: 3,
        desired_state: 'disabled',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: true
      },
      {
        revision: 2,
        desired_state: 'disabled',
        created_at: '2026-08-13T00:00:00.000Z',
        has_samples: true
      }
    ]
  });
  assert.equal(monitoringCurrentSample([], 3, detail), latest);
  assert.equal(monitoringCurrentSample([], 2, detail), null);

  const historical = monitoringSample({ revision: 2, state: 'LOW', sequence: sequence(1) });
  assert.equal(monitoringCurrentSample([historical], 2, detail), historical);
  const display = monitoringWatchDisplay([historical], 2, detail);
  assert.equal(display.currentSample, historical);
  assert.equal(display.evidence.state, 'LOW');
  assert.equal(display.baselineCount, 72);
});

test('historical evidence owns its asset and threshold instead of inheriting the current revision', () => {
  const currentAddress = `0x${'b'.repeat(40)}`;
  const detail = monitoringDetail({
    config_revision: 2,
    token_address: currentAddress,
    asset_key: `eip155:56:${currentAddress}`,
    zscore_threshold: 4,
    schema_hash: 'b'.repeat(64),
    available_revisions: [
      {
        revision: 2,
        desired_state: 'disabled',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: false
      },
      {
        revision: 1,
        desired_state: 'disabled',
        created_at: '2026-08-13T00:00:00.000Z',
        has_samples: true
      }
    ]
  });
  const historical = monitoringSample({ revision: 1 });
  const historicalDisplay = monitoringWatchDisplay([historical], 1, detail);
  assert.equal(historicalDisplay.evidenceIdentity?.assetKey, historical.asset_key);
  assert.equal(historicalDisplay.evidenceIdentity?.zscoreThreshold, 3);
  assert.equal(historicalDisplay.evidenceIdentity?.schemaHash, historical.schema_hash);
  assert.notEqual(historicalDisplay.evidenceIdentity?.assetKey, detail.asset_key);
  assert.notEqual(historicalDisplay.evidenceIdentity?.zscoreThreshold, detail.zscore_threshold);

  const emptyHistorical = monitoringWatchDisplay([], 1, detail);
  assert.equal(emptyHistorical.evidenceIdentity, null);
  assert.equal(emptyHistorical.baselineCount, null);
  const current = monitoringWatchDisplay([], 2, detail);
  assert.equal(current.evidenceIdentity?.assetKey, detail.asset_key);
  assert.equal(current.evidenceIdentity?.zscoreThreshold, 4);
});

test('historical region evidence stays on the selected revision while runtime stays current', () => {
  const current = monitoringSample({ revision: 2, state: 'HIGH' });
  const historical = monitoringSample({ revision: 1, state: 'LOW' });
  historical.regions[0].sample_fingerprint = '1'.repeat(64);
  historical.regions[1].sample_fingerprint = '2'.repeat(64);
  const runtime = monitoringDetail().runtime;
  const detail = monitoringDetail({
    config_revision: 2,
    latest: current,
    runtime: [
      { ...runtime[0], observed_state: 'active', lag_blocks: '7' },
      { ...runtime[1], observed_state: 'degraded', lag_blocks: '19' }
    ]
  });

  const display = monitoringWatchDisplay([historical], 1, detail);
  assert.equal(display.currentSample, historical);
  assert.deepEqual(display.regions, [
    {
      region: 'sg',
      runtimeObservedState: 'active',
      runtimeLastErrorCode: null,
      runtimeLagBlocks: '7',
      runtimeBlockNumber: '110',
      runtimeSlot: MONITORING_BUCKET_SEQUENCE,
      runtimeHeartbeat: '2026-08-14T00:00:00.000Z',
      evidenceState: 'LOW',
      evidenceFingerprint: historical.regions[0].sample_fingerprint
    },
    {
      region: 'jp',
      runtimeObservedState: 'degraded',
      runtimeLastErrorCode: null,
      runtimeLagBlocks: '19',
      runtimeBlockNumber: null,
      runtimeSlot: null,
      runtimeHeartbeat: null,
      evidenceState: 'LOW',
      evidenceFingerprint: historical.regions[1].sample_fingerprint
    }
  ]);
  assert.notEqual(display.regions[0].evidenceFingerprint, current.regions[0].sample_fingerprint);
});

test('watch display carries current runtime failures and marks evidence stale for unhealthy observers', () => {
  for (const observedState of ['offline', 'degraded', 'error', 'expired'] as const) {
    const runtime = monitoringDetail().runtime;
    const detail = monitoringDetail({
      latest: monitoringSample(),
      runtime: [
        {
          ...runtime[0],
          observed_state: observedState,
          last_error_code: 'OBSERVER_CURSOR_STALE'
        },
        runtime[1]
      ]
    });
    const display = monitoringWatchDisplay([], 1, detail);
    assert.equal(display.staleRuntime, true, observedState);
    assert.equal(display.regions[0].runtimeLastErrorCode, 'OBSERVER_CURSOR_STALE');
  }

  const healthy = monitoringDetail({ latest: monitoringSample() });
  assert.equal(monitoringWatchDisplay([], 1, healthy).staleRuntime, false);
  assert.equal(monitoringWatchDisplay([], 2, healthy).staleRuntime, false);
});

test('watch mismatch display keeps aggregate baseline unknown while preserving both region facts', () => {
  const mismatch = monitoringSample({ state: 'REGION_MISMATCH' });
  const display = monitoringWatchDisplay([mismatch], 1, monitoringDetail());
  assert.equal(display.currentSample, mismatch);
  assert.equal(display.evidence.unconfirmed, true);
  assert.equal(display.evidence.count, null);
  assert.equal(display.evidence.zScore, null);
  assert.equal(display.baselineCount, null);
  assert.deepEqual(
    display.regions.map((region) => region.region),
    ['sg', 'jp']
  );
  assert.deepEqual(
    display.regions.map((region) => region.evidenceFingerprint),
    mismatch.regions.map((region) => region.sample_fingerprint)
  );
  assert.deepEqual(
    display.regions.map((region) => region.evidenceState),
    mismatch.regions.map((region) => region.state)
  );
  assert.deepEqual(
    display.regions.map((region) => region.runtimeObservedState),
    ['standby', 'standby']
  );
  assert.deepEqual(
    display.regions.map((region) => region.runtimeLagBlocks),
    ['2', null]
  );
});

test('watch without a current sample uses readiness only for the selected current revision', () => {
  const detail = monitoringDetail({
    config_revision: 3,
    readiness: { state: 'WARMING', baseline_count: 17, minimum_baseline_count: 72 }
  });
  const empty = monitoringWatchDisplay([], 3, detail);
  assert.equal(empty.baselineCount, 17);
  assert.equal(empty.baselineState, 'WARMING');
  assert.equal(empty.baselineMinimumCount, 72);
  assert.equal(empty.evidence.confirmation, 'unknown');
  assert.equal(empty.evidence.confirmed, false);
  assert.equal(empty.evidence.unconfirmed, false);
  const historicalEmpty = monitoringWatchDisplay([], 2, detail);
  assert.equal(historicalEmpty.baselineCount, null);
  assert.equal(historicalEmpty.baselineState, null);
  assert.equal(historicalEmpty.baselineMinimumCount, null);
});

test('collection state never presents zero-row loading or failure as a true empty ledger', () => {
  assert.deepEqual(monitoringCollectionDisplayState(0, true, undefined), {
    mode: 'loading',
    showRows: false,
    showEmpty: false,
    showRetry: false,
    showFooter: false
  });
  assert.deepEqual(monitoringCollectionDisplayState(0, false, 'FAILED'), {
    mode: 'error',
    showRows: false,
    showEmpty: false,
    showRetry: true,
    showFooter: false
  });
  assert.equal(
    monitoringUtcRange('2026-08-14T23:55:00.000Z', '2026-08-15T00:00:00.000Z'),
    '2026-08-14 23:55–2026-08-15 00:00 UTC'
  );
});

test('anomaly display distinguishes verified zero, absent aggregate and unconfirmed regional evidence', () => {
  const zero = monitoringSample({ name: 'Zero', state: 'READY' });
  zero.transfer_event_count = 0;
  for (const region of zero.regions) region.transfer_event_count = 0;
  const zeroDisplay = monitoringAnomalyDisplay(zero);
  assert.equal(zeroDisplay.evidence.verifiedZero, true);
  assert.equal(zeroDisplay.evidence.count, '0');
  assert.equal(zeroDisplay.evidence.unconfirmed, false);
  assert.equal(zeroDisplay.evidence.confirmation, 'paired');
  assert.equal(zeroDisplay.baselineCount, 72);
  assert.equal(zeroDisplay.blockRange, '100–110');
  assert.equal(zeroDisplay.aggregateZ, '+1.00');

  const incomplete = monitoringAnomalyDisplay(
    monitoringSample({ name: 'Incomplete', state: 'INCOMPLETE_RANGE' })
  );
  assert.equal(incomplete.evidence.verifiedZero, false);
  assert.equal(incomplete.evidence.count, null);
  assert.equal(incomplete.blockRange, '100–110');
  assert.equal(incomplete.aggregateZ, null);

  const mismatchSample = monitoringSample({ name: 'Mismatch', state: 'REGION_MISMATCH' });
  const mismatch = monitoringAnomalyDisplay(mismatchSample);
  assert.equal(mismatch.evidence.confirmation, 'unconfirmed');
  assert.equal(mismatch.evidence.unconfirmed, true);
  assert.equal(mismatch.evidence.count, null);
  assert.equal(mismatch.evidence.zScore, null);
  assert.equal(mismatch.baselineCount, null);
  assert.equal(mismatch.blockRange, null);
  assert.equal(mismatch.aggregateZ, null);
  assert.equal(mismatch.sample.detector_version, 'zscore-population-v1');
  assert.equal(mismatch.sample.component_version, '1.0.0');
  assert.equal(mismatch.sample.config_revision, 1);
  assert.equal(mismatch.sample.regions.length, 2);
});

test('anomaly display closes aggregate, release and regional diagnostic evidence', () => {
  const sample = monitoringSample({ name: 'Closed evidence', state: 'HIGH' });
  const display = monitoringAnomalyDisplay(sample);
  assert.equal(display.evidence.confirmation, 'confirmed');
  assert.equal(display.baselineCount, 72);
  assert.equal(display.baselineMean, '10');
  assert.equal(display.baselineStddev, '2');
  assert.deepEqual(display.releaseIdentity, {
    componentId: 'erc20-transfer-activity-monitor',
    componentVersion: '1.0.0',
    schemaHash: sample.schema_hash,
    metricKind: 'erc20-transfer-event-count',
    detectorVersion: 'zscore-population-v1'
  });
  assert.deepEqual(display.regionDiagnostics[0], {
    region: 'sg',
    state: 'HIGH',
    count: '28',
    baselineCount: 72,
    baselineMean: '10',
    baselineStddev: '2',
    zScore: '+4.00',
    blockRange: '100–110',
    endHash: sample.regions[0].end_block_hash,
    completeness: 'COMPLETE',
    reason: 'MONITOR_HIGH',
    fingerprint: sample.regions[0].sample_fingerprint
  });

  const mismatch = monitoringAnomalyDisplay(
    monitoringSample({ name: 'Regional evidence only', state: 'REGION_MISMATCH' })
  );
  assert.equal(mismatch.baselineCount, null);
  assert.equal(mismatch.baselineMean, null);
  assert.equal(mismatch.baselineStddev, null);
  assert.equal(mismatch.regionDiagnostics.length, 2);
  assert.equal(mismatch.regionDiagnostics[1].count, '13');
  assert.equal(mismatch.regionDiagnostics[1].fingerprint, 'e'.repeat(64));
});

test('store exposes pure watch and anomaly display models without component recomputation', () => {
  const store = new MonitoringStore(monitoringBridgeStub());
  const mismatch = monitoringSample({ name: 'Mismatch', state: 'REGION_MISMATCH' });
  store.detail = monitoringDetail();
  store.samplesRevision = 1;
  store.samples = [mismatch];
  store.anomalies = [mismatch];
  store.selectAnomaly(mismatch);

  assert.equal(store.watchDisplay.currentSample, mismatch);
  assert.equal(store.watchDisplay.baselineCount, null);
  assert.equal(store.anomalyDisplays[0].evidence.unconfirmed, true);
  assert.equal(store.selectedAnomalyDisplay?.sample, mismatch);
  store.selectAnomaly(null);
  assert.equal(store.selectedAnomalyDisplay, null);
});
