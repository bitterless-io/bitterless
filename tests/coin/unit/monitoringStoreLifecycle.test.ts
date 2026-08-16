import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  MonitoringAnomalyListResponse,
  MonitoringBridge,
  MonitoringDetailProjection,
  MonitoringRevisionProjection,
  MonitoringSampleListResponse
} from '../../../src/shared/monitoring/monitoringBridge.type';
import type { SnipingBridgeResult } from '../../../src/shared/sniping/snipingBridge.type';
import { MonitoringStore } from '../../../src/renderer/coin/src/views/monitoring/monitoring.store';
import { retainsMonitoringRevisionHistory } from '../../../src/renderer/coin/src/views/monitoring/monitoringIntegrity.service';
import { monitoringSampleIdentity } from '../../../src/renderer/coin/src/views/monitoring/monitoringIntegrity.service';
import {
  MONITORING_DATE,
  monitoringBridgeStub,
  monitoringDeferred,
  monitoringDetail,
  monitoringFailure,
  monitoringOk,
  monitoringSample
} from './monitoringFixtures';

const revision = (
  value: number,
  desiredState: 'armed' | 'disabled',
  hasSamples = false,
  createdAt = MONITORING_DATE
): MonitoringRevisionProjection => ({
  revision: value,
  desired_state: desiredState,
  created_at: createdAt,
  has_samples: hasSamples
});

test('edit save rebases the selected stopped watch onto the returned revision', async () => {
  const calls: unknown[] = [];
  const edited = monitoringDetail({
    config_revision: 2,
    name: 'Updated watch',
    available_revisions: [revision(2, 'disabled'), revision(1, 'disabled')]
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      save: async (input) => {
        calls.push(input);
        return monitoringOk(edited);
      }
    })
  );
  await store.selectWatch('1');
  store.openEdit();
  store.setDraft('name', 'Updated watch');
  await store.saveDraft();
  assert.deepEqual(calls, [
    {
      config_id: '1',
      name: 'Updated watch',
      token_address: edited.token_address,
      zscore_threshold: 3,
      expected_revision: 1
    }
  ]);
  assert.equal(store.dialogOpen, false);
  assert.equal(store.selectedDetail?.config_revision, 2);
  assert.equal(store.selectedDetail?.name, 'Updated watch');
  assert.equal(store.canEdit, true);
});

test('Stop uses the current CAS and adopts only the fresh stopped revision', async () => {
  const running = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    available_revisions: [revision(2, 'armed'), revision(1, 'disabled')]
  });
  const stopped = monitoringDetail({
    config_revision: 3,
    available_revisions: [revision(3, 'disabled'), revision(2, 'armed'), revision(1, 'disabled')]
  });
  const calls: unknown[] = [];
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringOk(running),
      stop: async (input) => {
        calls.push(input);
        return monitoringOk(stopped);
      }
    })
  );
  await store.selectWatch('1');
  await store.setMonitoring(false);
  assert.deepEqual(calls, [{ config_id: '1', expected_revision: 2 }]);
  assert.equal(store.selectedDetail?.config_revision, 3);
  assert.equal(store.selectedDetail?.status, 'Stopped');
  assert.equal(store.selectedDetail?.desired_state, 'disabled');
  assert.equal(store.canEdit, true);
});

test('stale edit reload rebases the open draft when the server watch remains stopped', async () => {
  const server = monitoringDetail({ config_revision: 2, name: 'Server truth' });
  let gets = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringOk(gets++ === 0 ? monitoringDetail() : server),
      save: async () => monitoringFailure('SNIPING_CONFIG_REVISION_STALE')
    })
  );
  await store.selectWatch('1');
  store.openEdit();
  store.setDraft('name', 'Stale local edit');
  await store.saveDraft();
  assert.equal(store.dialogRevisionConflict, true);
  await store.reloadServerVersion();
  assert.equal(store.dialogOpen, true);
  assert.equal(store.revisionConflict, false);
  assert.equal(store.detailFresh, true);
  assert.equal(store.draft.name, 'Server truth');
  assert.equal(store.canEdit, true);
});

test('stale edit reload closes the editor when the server watch is now Monitoring', async () => {
  const armed = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    available_revisions: [revision(2, 'armed'), revision(1, 'disabled')]
  });
  let gets = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringOk(gets++ === 0 ? monitoringDetail() : armed),
      save: async () => monitoringFailure('SNIPING_CONFIG_REVISION_STALE')
    })
  );
  await store.selectWatch('1');
  store.openEdit();
  await store.saveDraft();
  assert.equal(store.dialogRevisionConflict, true);
  await store.reloadServerVersion();
  assert.equal(store.dialogOpen, false);
  assert.equal(store.dialogActionError, null);
  assert.equal(store.revisionConflict, false);
  assert.equal(store.selectedDetail?.status, 'Monitoring');
  assert.equal(store.canEdit, false);
});

test('a late lifecycle completion cannot overwrite a newer selected-watch intent', async () => {
  const pending = monitoringDeferred<SnipingBridgeResult<MonitoringDetailProjection>>();
  const first = monitoringDetail();
  const second = monitoringDetail({ config_id: '2' });
  const bridge = monitoringBridgeStub({
    get: ((input: { config_id: string }) =>
      Promise.resolve(
        monitoringOk(input.config_id === '1' ? first : second)
      )) as MonitoringBridge['get'],
    start: async () => pending.promise
  });
  const store = new MonitoringStore(bridge);
  await store.selectWatch('1');
  const staleAction = store.setMonitoring(true);
  await store.selectWatch('2');
  pending.resolve(
    monitoringOk(
      monitoringDetail({ config_revision: 2, desired_state: 'armed', status: 'Monitoring' })
    )
  );
  await staleAction;
  assert.equal(store.pendingAction, null);
  assert.equal(store.selectedConfigId, '2');
  assert.equal(store.selectedDetail, second);
  assert.equal(store.selectedDetail?.status, 'Stopped');
});

test('mutation history preserves desired state, creation time and monotonic sample evidence', () => {
  const prior = monitoringDetail({
    latest: null,
    available_revisions: [revision(1, 'disabled', true)]
  });
  const retained = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    available_revisions: [
      revision(2, 'armed', false, '2026-08-14T00:05:00.000Z'),
      revision(1, 'disabled', true)
    ]
  });
  assert.equal(retainsMonitoringRevisionHistory(retained, prior), true);
  for (const drift of [
    { desired_state: 'armed' as const },
    { created_at: '2026-08-14T00:01:00.000Z' },
    { has_samples: false }
  ]) {
    const forged = structuredClone(retained);
    Object.assign(forged.available_revisions[1], drift);
    assert.equal(retainsMonitoringRevisionHistory(forged, prior), false);
  }
  const lateSample = structuredClone(retained);
  prior.available_revisions[0].has_samples = false;
  lateSample.available_revisions[1].has_samples = true;
  assert.equal(retainsMonitoringRevisionHistory(lateSample, prior), true);
});

test('Edit rejects a response that rewrites the retained desired state', async () => {
  const forged = monitoringDetail({
    config_revision: 2,
    name: 'Updated watch',
    available_revisions: [revision(2, 'disabled'), revision(1, 'armed')]
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({ save: async () => monitoringOk(forged) })
  );
  await store.selectWatch('1');
  store.openEdit();
  store.setDraft('name', 'Updated watch');
  await store.saveDraft();
  assert.equal(store.dialogActionError, 'MONITORING_RESPONSE_INTEGRITY');
  assert.equal(store.selectedDetail?.config_revision, 1);
});

test('Start rejects a response that rewrites the retained revision creation time', async () => {
  const forged = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    available_revisions: [
      revision(2, 'armed'),
      revision(1, 'disabled', false, '2026-08-14T00:01:00.000Z')
    ]
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({ start: async () => monitoringOk(forged) })
  );
  await store.selectWatch('1');
  await store.setMonitoring(true);
  assert.equal(store.errors.action, 'MONITORING_RESPONSE_INTEGRITY');
  assert.equal(store.selectedDetail?.config_revision, 1);
});

test('Stop rejects a response that erases prior sample availability', async () => {
  const latest = monitoringSample({ revision: 2 });
  const running = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    latest,
    readiness: { state: 'READY', baseline_count: 72, minimum_baseline_count: 72 },
    available_revisions: [revision(2, 'armed', true), revision(1, 'disabled')]
  });
  const forged = monitoringDetail({
    config_revision: 3,
    available_revisions: [
      revision(3, 'disabled'),
      revision(2, 'armed', false),
      revision(1, 'disabled')
    ]
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringOk(running),
      stop: async () => monitoringOk(forged)
    })
  );
  await store.selectWatch('1');
  await store.setMonitoring(false);
  assert.equal(store.errors.action, 'MONITORING_RESPONSE_INTEGRITY');
  assert.equal(store.selectedDetail?.config_revision, 2);
});

test('retained sample failure is stale only after completion and Retry clears it', async () => {
  const first = monitoringDeferred<SnipingBridgeResult<MonitoringSampleListResponse>>();
  const second = monitoringDeferred<SnipingBridgeResult<MonitoringSampleListResponse>>();
  let calls = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () => (calls++ === 0 ? first.promise : second.promise)
    })
  );
  const sample = monitoringSample();
  store.detail = monitoringDetail();
  store.selectedConfigId = '1';
  store.detailFresh = true;
  store.samplesRevision = 1;
  store.samples = [sample];
  store.samplesIdentity = monitoringSampleIdentity(sample);
  store.samplesCursor = sample.bucket_sequence;
  store.errors.samples = 'OLD_ERROR';
  const failure = store.loadOlderSamples();
  assert.equal(store.errors.samples, undefined);
  assert.equal(store.samplesLoading, true);
  first.resolve(monitoringFailure('OLDER_FAILED'));
  await failure;
  assert.ok(store.samplesStaleSince);
  const retry = store.retrySamples();
  assert.equal(store.errors.samples, undefined);
  second.resolve(monitoringOk({ list: [], next_before_bucket_sequence: null }));
  await retry;
  assert.equal(store.samplesStaleSince, null);
  assert.deepEqual(store.samples, [sample]);
});

test('retained anomaly failure is stale only after completion and Retry clears it', async () => {
  const first = monitoringDeferred<SnipingBridgeResult<MonitoringAnomalyListResponse>>();
  const second = monitoringDeferred<SnipingBridgeResult<MonitoringAnomalyListResponse>>();
  let calls = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listAnomalies: async () => (calls++ === 0 ? first.promise : second.promise)
    })
  );
  const anomaly = monitoringSample({ name: 'Anomaly', state: 'HIGH' });
  store.anomalies = [anomaly];
  store.errors.anomalies = 'OLD_ERROR';
  const failure = store.refreshAnomalies(true);
  assert.equal(store.errors.anomalies, undefined);
  assert.equal(store.anomalyLoading, true);
  first.resolve(monitoringFailure('ANOMALY_FAILED'));
  await failure;
  assert.ok(store.anomaliesStaleSince);
  const retry = store.refreshAnomalies(true);
  assert.equal(store.errors.anomalies, undefined);
  second.resolve(monitoringOk({ list: [anomaly], next_cursor: null }));
  await retry;
  assert.equal(store.anomaliesStaleSince, null);
  assert.deepEqual(store.anomalies, [anomaly]);
});

test('failed older anomaly page retries its exact retained cursor', async () => {
  const anomaly = monitoringSample({ name: 'Anomaly', state: 'HIGH' });
  const cursor = {
    bucket_sequence: anomaly.bucket_sequence,
    config_id: anomaly.config_id,
    config_revision: anomaly.config_revision
  };
  const calls: unknown[] = [];
  let attempt = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listAnomalies: async (input) => {
        calls.push(input);
        attempt += 1;
        return attempt === 1
          ? monitoringFailure('OLDER_FAILED')
          : monitoringOk({ list: [], next_cursor: null });
      }
    })
  );
  store.anomalies = [anomaly];
  store.anomalyCursor = cursor;
  await store.loadOlderAnomalies();
  assert.deepEqual(store.anomalyFailedCursor, cursor);
  await store.retryAnomalies();
  assert.deepEqual(calls, [
    { page_size: 50, cursor },
    { page_size: 50, cursor }
  ]);
  assert.equal(store.anomalyFailedCursor, null);
  assert.deepEqual(store.anomalies, [anomaly]);
});

test('selecting another watch clears a prior watch lifecycle error', async () => {
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async ({ config_id }) => monitoringOk(monitoringDetail({ config_id })),
      start: async () => monitoringFailure('START_FAILED')
    })
  );
  await store.selectWatch('1');
  await store.setMonitoring(true);
  assert.equal(store.errors.action, 'START_FAILED');
  await store.selectWatch('2');
  assert.equal(store.errors.action, undefined);
  assert.equal(store.selectedDetail?.config_id, '2');
});

test('workspace Refresh stays pending through its selected sample refresh', async () => {
  const samples = monitoringDeferred<SnipingBridgeResult<MonitoringSampleListResponse>>();
  const sampleStarted = monitoringDeferred<void>();
  let sampleCalls = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      list: async () => monitoringOk({ list: [], total: 0, page: 1, page_size: 20 }),
      get: async () => monitoringOk(monitoringDetail()),
      listSamples: async () => {
        sampleCalls += 1;
        if (sampleCalls === 1) return monitoringOk({ list: [], next_before_bucket_sequence: null });
        sampleStarted.resolve(undefined);
        return samples.promise;
      }
    })
  );
  await store.selectWatch('1');
  const pending = store.refreshSelectedScope('watches');
  await sampleStarted.promise;
  assert.equal(store.workspaceRefreshLoading, true);
  assert.equal(store.samplesLoading, true);
  assert.equal(store.samplesPendingOperation, 'initial');
  samples.resolve(monitoringOk({ list: [], next_before_bucket_sequence: null }));
  await pending;
  assert.equal(store.workspaceRefreshLoading, false);
  assert.equal(store.samplesPendingOperation, null);
});

test('same-revision list identity drift retains the verified cached query', async () => {
  const cached = monitoringDetail();
  const forged = monitoringDetail({ name: 'Forged same revision' });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      list: async () => monitoringOk({ list: [forged], total: 1, page: 1, page_size: 20 })
    })
  );
  store.watches = [cached];
  store.watchTotal = 1;
  store.phase = 'ready';
  await store.refreshWatches();
  assert.deepEqual(store.watches, [cached]);
  assert.equal(store.errors.list, 'MONITORING_RESPONSE_INTEGRITY');
  assert.ok(store.watchListStaleSince);
});

test('same-revision detail identity drift cannot replace verified detail', async () => {
  const cached = monitoringDetail();
  let gets = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () =>
        monitoringOk(gets++ === 0 ? cached : monitoringDetail({ name: 'Forged same revision' }))
    })
  );
  await store.selectWatch('1');
  await store.selectWatch('1', false);
  assert.equal(store.detail, cached);
  assert.equal(store.errors.detail, 'MONITORING_RESPONSE_INTEGRITY');
  assert.ok(store.detailStaleSince);
});

test('same-revision Reload identity drift keeps cached facts read-only', async () => {
  const cached = monitoringDetail();
  let gets = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () =>
        monitoringOk(
          gets++ === 0 ? cached : monitoringDetail({ updated_at: '2026-08-14T00:05:00.000Z' })
        )
    })
  );
  await store.selectWatch('1');
  await store.reloadServerVersion();
  assert.equal(store.detail, cached);
  assert.equal(store.errors.detail, 'MONITORING_RESPONSE_INTEGRITY');
  assert.equal(store.detailFresh, false);
  assert.ok(store.detailStaleSince);
});
