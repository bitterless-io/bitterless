import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  MonitoringBridge,
  MonitoringAnomalyListResponse,
  MonitoringDetailProjection,
  MonitoringListResponse,
  MonitoringSampleListResponse,
  MonitoringSampleListInput
} from '../../../src/shared/monitoring/monitoringBridge.type';
import type { SnipingBridgeResult } from '../../../src/shared/sniping/snipingBridge.type';
import { MonitoringStore } from '../../../src/renderer/coin/src/views/monitoring/monitoring.store';
import { monitoringSampleIdentity } from '../../../src/renderer/coin/src/views/monitoring/monitoringIntegrity.service';
import {
  MONITORING_ADDRESS,
  MONITORING_BUCKET_SEQUENCE,
  monitoringBridgeStub,
  monitoringDeferred,
  monitoringDetail,
  monitoringFailure,
  monitoringListItem,
  monitoringOk,
  monitoringSample
} from './monitoringFixtures';

const sequence = (offset: number): string =>
  String(BigInt(MONITORING_BUCKET_SEQUENCE) - BigInt(offset));

test('failed page navigation retries the exact page and query without relabeling cached rows', async () => {
  const cached = monitoringListItem({ name: 'Cached row' });
  const replacement = monitoringListItem({ config_id: '2', name: 'Page two' });
  const calls: unknown[] = [];
  let attempt = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      list: async (input) => {
        calls.push(input);
        attempt += 1;
        return attempt === 1
          ? monitoringFailure('PAGE_TWO_FAILED')
          : monitoringOk({ list: [replacement], total: 21, page: 2, page_size: 20 });
      }
    })
  );
  store.watches = [cached];
  store.watchTotal = 40;
  store.watchPage = 1;
  store.appliedWatchSearch = 'GME';
  await store.setWatchPage(2);
  assert.deepEqual(store.watches, [cached]);
  assert.equal(store.watchPage, 1);
  assert.equal(store.appliedWatchSearch, 'GME');
  assert.deepEqual(store.failedListIntent, { page: 2, search: 'GME' });
  await store.retryWatches();
  assert.deepEqual(calls, [
    { page: 2, page_size: 20, search_text: 'GME' },
    { page: 2, page_size: 20, search_text: 'GME' }
  ]);
  assert.deepEqual(store.watches, [replacement]);
  assert.equal(store.watchPage, 2);
  assert.equal(store.failedListIntent, null);
});

test('failed search retains rows under their last successful applied query', async () => {
  const cached = monitoringListItem({ name: 'SPCX cached' });
  const store = new MonitoringStore(
    monitoringBridgeStub({ list: async () => monitoringFailure('SEARCH_FAILED') })
  );
  store.watches = [cached];
  store.appliedWatchSearch = 'SPCX';
  store.watchSearch = 'GME';
  await store.applySearch();
  assert.deepEqual(store.watches, [cached]);
  assert.equal(store.appliedWatchSearch, 'SPCX');
  assert.equal(store.watchSearch, 'GME');
  assert.deepEqual(store.failedListIntent, { page: 1, search: 'GME' });
  assert.ok(store.watchListStaleSince);
});

test('late list completion cannot overwrite a newer query or its retry identity', async () => {
  const old = monitoringDeferred<SnipingBridgeResult<MonitoringListResponse>>();
  const next = monitoringDeferred<SnipingBridgeResult<MonitoringListResponse>>();
  const store = new MonitoringStore(
    monitoringBridgeStub({
      list: async (input = {}) => (input.search_text === 'old' ? old.promise : next.promise)
    })
  );
  const stale = store.refreshWatches(1, 'old');
  const newest = store.refreshWatches(1, 'new');
  next.resolve(monitoringFailure('NEW_FAILED'));
  await newest;
  old.resolve(
    monitoringOk({ list: [monitoringListItem({ name: 'Old' })], total: 1, page: 1, page_size: 20 })
  );
  await stale;
  assert.deepEqual(store.failedListIntent, { page: 1, search: 'new' });
  assert.equal(store.errors.list, 'NEW_FAILED');
  assert.equal(store.appliedWatchSearch, '');
});

test('draft validation rejects wrong CA and threshold without crossing the bridge', async () => {
  let saves = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      save: async () => {
        saves += 1;
        return monitoringFailure('MUST_NOT_REACH');
      }
    })
  );
  store.openCreate();
  store.setDraft('tokenAddress', `0x${'A'.repeat(40)}`);
  store.setDraft('threshold', '3');
  await store.saveDraft();
  assert.equal(store.draftError, 'MONITORING_ADDRESS_INVALID');
  store.setDraft('tokenAddress', MONITORING_ADDRESS);
  for (const threshold of ['1.99', '10.01', '3.001', 'NaN']) {
    store.setDraft('threshold', threshold);
    await store.saveDraft();
    assert.equal(store.draftError, 'MONITORING_THRESHOLD_INVALID');
  }
  assert.equal(saves, 0);
});

test('create failure stays in the dialog and cannot stale or conflict a selected watch', async () => {
  const selected = monitoringDetail();
  const store = new MonitoringStore(
    monitoringBridgeStub({ save: async () => monitoringFailure('CREATE_FAILED') })
  );
  store.detail = selected;
  store.selectedConfigId = selected.config_id;
  store.detailFresh = true;
  store.openCreate();
  store.setDraft('tokenAddress', MONITORING_ADDRESS);
  await store.saveDraft();
  assert.equal(store.dialogActionError, 'CREATE_FAILED');
  assert.equal(store.detailFresh, true);
  assert.equal(store.revisionConflict, false);
  assert.equal(store.detailStaleSince, null);
  assert.equal(store.canMutate, true);
  store.closeDialog();
  assert.equal(store.dialogActionError, null);
  assert.equal(store.errors.action, undefined);
});

test('create success selects its detail and enters the mobile detail surface outside the list query', async () => {
  const created = monitoringDetail({ config_id: '9', name: 'Created watch' });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      save: async () => monitoringOk(created),
      list: async (input = {}) =>
        monitoringOk({
          list: [],
          total: 0,
          page: input.page ?? 1,
          page_size: input.page_size ?? 20
        })
    })
  );
  store.watchSearch = 'not-created';
  store.appliedWatchSearch = 'not-created';
  store.openCreate();
  store.setDraft('name', 'Created watch');
  store.setDraft('tokenAddress', MONITORING_ADDRESS);
  await store.saveDraft();
  assert.equal(store.selectedConfigId, '9');
  assert.equal(store.selectedDetail, created);
  assert.equal(store.mobileDetail, true);
  store.backToWatches();
  assert.equal(store.mobileDetail, false);
});

test('create success atomically clears failed detail and unrelated sample scopes', async () => {
  const created = monitoringDetail({ config_id: '9', name: 'Created watch' });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringFailure('DETAIL_FAILED'),
      save: async () => monitoringOk(created)
    })
  );
  await store.selectWatch('2');
  store.errors.samples = 'OLD_SAMPLE_FAILED';
  store.samplesLoading = true;
  store.samplesFailedRequest = { operation: 'initial', before: null };
  store.openCreate();
  store.setDraft('name', 'Created watch');
  store.setDraft('tokenAddress', MONITORING_ADDRESS);
  await store.saveDraft();
  assert.equal(store.selectedDetail, created);
  assert.equal(store.errors.detail, undefined);
  assert.equal(store.errors.samples, undefined);
  assert.equal(store.samplesLoading, false);
  assert.equal(store.samplesFailedRequest, null);
});

test('save identity drift preserves the draft and fails closed', async () => {
  const wrong = monitoringDetail({
    config_id: '1',
    config_revision: 1,
    token_address: `0x${'2'.repeat(40)}`,
    asset_key: `eip155:56:0x${'2'.repeat(40)}`
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({ save: async () => monitoringOk(wrong) })
  );
  store.openCreate();
  store.setDraft('name', 'GME');
  store.setDraft('tokenAddress', MONITORING_ADDRESS);
  store.setDraft('threshold', '3');
  await store.saveDraft();
  assert.equal(store.dialogActionError, 'MONITORING_RESPONSE_INTEGRITY');
  assert.equal(store.errors.action, undefined);
  assert.equal(store.dialogOpen, true);
  assert.equal(store.draft.name, 'GME');
  assert.equal(store.draft.tokenAddress, MONITORING_ADDRESS);
});

test('create dialog hides a retained detail conflict while edit dialog exposes it', async () => {
  const store = new MonitoringStore(
    monitoringBridgeStub({
      save: async () => monitoringFailure('SNIPING_CONFIG_REVISION_STALE')
    })
  );
  store.detail = monitoringDetail();
  store.selectedConfigId = store.detail.config_id;
  store.detailFresh = true;
  store.openEdit();
  await store.saveDraft();
  assert.equal(store.revisionConflict, true);
  assert.equal(store.dialogRevisionConflict, true);

  store.openCreate();
  assert.equal(store.revisionConflict, true);
  assert.equal(store.dialogRevisionConflict, false);
});

test('latest watch intent wins when an older detail resolves last', async () => {
  const first = monitoringDeferred<SnipingBridgeResult<MonitoringDetailProjection>>();
  const second = monitoringDeferred<SnipingBridgeResult<MonitoringDetailProjection>>();
  const bridge = monitoringBridgeStub({
    get: ((input: { config_id: string }) =>
      input.config_id === '1' ? first.promise : second.promise) as MonitoringBridge['get']
  });
  const store = new MonitoringStore(bridge);
  const oldIntent = store.selectWatch('1');
  const newIntent = store.selectWatch('2');
  second.resolve(monitoringOk(monitoringDetail({ config_id: '2' })));
  await newIntent;
  first.resolve(monitoringOk(monitoringDetail({ config_id: '1' })));
  await oldIntent;
  assert.equal(store.selectedConfigId, '2');
  assert.equal(store.detail?.config_id, '2');
});

test('failed cross-watch detail keeps cached evidence private and retries the selected target', async () => {
  const requested: string[] = [];
  let targetAttempt = 0;
  const cached = monitoringDetail({ config_id: '1' });
  const target = monitoringDetail({ config_id: '2' });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async ({ config_id }) => {
        requested.push(config_id);
        if (config_id === '1') return monitoringOk(cached);
        targetAttempt += 1;
        return targetAttempt === 1 ? monitoringFailure('DETAIL_UNAVAILABLE') : monitoringOk(target);
      }
    })
  );
  await store.selectWatch('1');
  await store.selectWatch('2');
  assert.equal(store.selectedConfigId, '2');
  assert.equal(store.mobileDetail, true);
  assert.equal(store.detail, cached);
  assert.equal(store.selectedDetail, null);
  assert.equal(store.errors.detail, 'DETAIL_UNAVAILABLE');
  assert.equal(store.detailStaleSince, null);

  await store.selectWatch(store.selectedConfigId!, false);
  assert.deepEqual(requested, ['1', '2', '2']);
  assert.equal(store.selectedDetail, target);
  assert.equal(store.errors.detail, undefined);
});

test('initial history combines two strict pages into at most 500 unique points', async () => {
  const firstRows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  const secondRows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(250 + index) })
  );
  const calls: MonitoringSampleListInput[] = [];
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async (input) => {
        calls.push(input);
        return calls.length === 1
          ? monitoringOk({
              list: firstRows,
              next_before_bucket_sequence: firstRows.at(-1)!.bucket_sequence
            })
          : monitoringOk({
              list: secondRows,
              next_before_bucket_sequence: secondRows.at(-1)!.bucket_sequence
            });
      }
    })
  );
  await store.selectWatch('1');
  assert.equal(store.samples.length, 500);
  assert.equal(new Set(store.samples.map((row) => row.bucket_sequence)).size, 500);
  assert.equal(store.samplesInitialPartial, false);
  assert.equal(store.samplesCursor, secondRows.at(-1)!.bucket_sequence);
  assert.deepEqual(calls, [
    { config_id: '1', config_revision: 1, page_size: 250 },
    {
      config_id: '1',
      config_revision: 1,
      before_bucket_sequence: firstRows.at(-1)!.bucket_sequence,
      page_size: 250
    }
  ]);
});

test('second-page failure retains the first verified 250 and labels the initial series partial', async () => {
  const firstRows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  let call = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () =>
        ++call === 1
          ? monitoringOk({
              list: firstRows,
              next_before_bucket_sequence: firstRows.at(-1)!.bucket_sequence
            })
          : monitoringFailure('SNIPING_REQUEST_FAILED')
    })
  );
  await store.selectWatch('1');
  assert.equal(store.samples.length, 250);
  assert.equal(store.samplesCursor, firstRows.at(-1)!.bucket_sequence);
  assert.equal(store.samplesInitialPartial, true);
  assert.equal(store.errors.samples, 'SNIPING_REQUEST_FAILED');
});

test('second-page Retry continues from the failed cursor without truncating verified rows', async () => {
  const firstRows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  const older = monitoringSample({ sequence: sequence(250) });
  const calls: MonitoringSampleListInput[] = [];
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async (input) => {
        calls.push(input);
        if (calls.length === 1)
          return monitoringOk({
            list: firstRows,
            next_before_bucket_sequence: firstRows.at(-1)!.bucket_sequence
          });
        if (calls.length === 2) return monitoringFailure('SECOND_PAGE_FAILED');
        return monitoringOk({ list: [older], next_before_bucket_sequence: null });
      }
    })
  );
  await store.selectWatch('1');
  await store.retrySamples();
  assert.equal(store.samples.length, 251);
  assert.equal(store.samples[0], firstRows[0]);
  assert.equal(store.samples.at(-1), older);
  assert.deepEqual(calls[2], {
    config_id: '1',
    config_revision: 1,
    before_bucket_sequence: firstRows.at(-1)!.bucket_sequence,
    page_size: 250
  });
});

test('sample retention rejects an 8,641st row and preserves the exact cursor', async () => {
  const current = monitoringSample();
  const cursor = sequence(8_640);
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () =>
        monitoringOk({
          list: [monitoringSample({ sequence: sequence(8_641) })],
          next_before_bucket_sequence: null
        })
    })
  );
  store.detail = monitoringDetail();
  store.selectedConfigId = '1';
  store.samplesRevision = 1;
  store.samples = Array(8_640).fill(current);
  store.samplesCursor = cursor;
  store.samplesIdentity = monitoringSampleIdentity(current);
  await store.loadOlderSamples();
  assert.equal(store.samples.length, 8_640);
  assert.equal(store.samplesCursor, cursor);
  assert.equal(store.errors.samples, 'MONITORING_RESPONSE_INTEGRITY');
});

test('same-revision detail refresh preserves verified series when its first page fails and can retry', async () => {
  const verifiedRows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  const retried = monitoringSample({ sequence: sequence(500) });
  let sampleCall = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () => monitoringOk(monitoringDetail()),
      listSamples: async () => {
        sampleCall += 1;
        if (sampleCall === 1) {
          return monitoringOk({
            list: verifiedRows,
            next_before_bucket_sequence: verifiedRows.at(-1)!.bucket_sequence
          });
        }
        if (sampleCall === 2) return monitoringFailure('SECOND_PAGE_UNAVAILABLE');
        if (sampleCall === 3) return monitoringFailure('REFRESH_FIRST_PAGE_UNAVAILABLE');
        return monitoringOk({ list: [retried], next_before_bucket_sequence: null });
      }
    })
  );
  await store.selectWatch('1');
  const priorRows = [...store.samples];
  const priorCursor = store.samplesCursor;
  const priorIdentity = structuredClone(store.samplesIdentity);

  await store.selectWatch('1', false);
  assert.deepEqual(store.samples, priorRows);
  assert.equal(store.samplesCursor, priorCursor);
  assert.deepEqual(store.samplesIdentity, priorIdentity);
  assert.equal(store.errors.samples, 'REFRESH_FIRST_PAGE_UNAVAILABLE');

  await store.refreshInitialSamples();
  assert.equal(sampleCall, 4);
  assert.deepEqual(store.samples, [retried]);
  assert.equal(store.samplesCursor, null);
  assert.equal(store.errors.samples, undefined);
});

test('manual revision switch with no retained rows can retry a failed first series page', async () => {
  const historical = monitoringSample({ revision: 1, sequence: sequence(1) });
  let sampleCall = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () => {
        sampleCall += 1;
        return sampleCall === 1
          ? monitoringFailure('HISTORICAL_SERIES_UNAVAILABLE')
          : monitoringOk({ list: [historical], next_before_bucket_sequence: null });
      }
    })
  );
  store.detail = monitoringDetail({
    config_revision: 2,
    available_revisions: [
      {
        revision: 2,
        desired_state: 'disabled',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: true
      },
      {
        revision: 1,
        desired_state: 'disabled',
        created_at: '2026-08-13T00:00:00.000Z',
        has_samples: true
      }
    ]
  });
  store.selectedConfigId = store.detail.config_id;
  store.samplesRevision = 2;
  store.samples = [monitoringSample({ revision: 2 })];

  await store.setSamplesRevision(1);
  assert.deepEqual(store.samples, []);
  assert.equal(store.samplesCursor, null);
  assert.equal(store.samplesIdentity, null);
  assert.equal(store.errors.samples, 'HISTORICAL_SERIES_UNAVAILABLE');

  await store.refreshInitialSamples();
  assert.deepEqual(store.samples, [historical]);
  assert.equal(store.errors.samples, undefined);
});

test('a revision switch fences a late second initial-history page', async () => {
  const lateSecond = monitoringDeferred<SnipingBridgeResult<MonitoringSampleListResponse>>();
  const secondStarted = monitoringDeferred<void>();
  const revisionTwo = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ revision: 2, sequence: sequence(index) })
  );
  let revisionTwoCalls = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      get: async () =>
        monitoringOk(
          monitoringDetail({
            config_revision: 2,
            available_revisions: [
              {
                revision: 2,
                desired_state: 'disabled',
                created_at: '2026-08-14T00:00:00.000Z',
                has_samples: true
              },
              {
                revision: 1,
                desired_state: 'disabled',
                created_at: '2026-08-13T00:00:00.000Z',
                has_samples: true
              }
            ]
          })
        ),
      listSamples: async (input) => {
        if (input.config_revision === 1) {
          return monitoringOk({ list: [], next_before_bucket_sequence: null });
        }
        revisionTwoCalls += 1;
        if (revisionTwoCalls === 1) {
          return monitoringOk({
            list: revisionTwo,
            next_before_bucket_sequence: revisionTwo.at(-1)!.bucket_sequence
          });
        }
        secondStarted.resolve();
        return await lateSecond.promise;
      }
    })
  );
  const selecting = store.selectWatch('1');
  await secondStarted.promise;
  await store.setSamplesRevision(1);
  lateSecond.resolve(
    monitoringOk({
      list: [monitoringSample({ revision: 2, sequence: sequence(1) })],
      next_before_bucket_sequence: null
    })
  );
  await selecting;
  assert.equal(store.samplesRevision, 1);
  assert.deepEqual(store.samples, []);
  assert.equal(store.errors.samples, undefined);
});

test('sample cursor must strictly progress and cannot append its boundary row again', async () => {
  const firstPage = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  const boundary = firstPage.at(-1)!;
  const duplicateBoundary = structuredClone(boundary);
  const older = Array.from({ length: 249 }, (_, index) =>
    monitoringSample({ sequence: sequence(250 + index) })
  );
  let call = 0;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () =>
        ++call === 1
          ? monitoringOk({ list: firstPage, next_before_bucket_sequence: boundary.bucket_sequence })
          : monitoringOk({
              list: [duplicateBoundary, ...older],
              next_before_bucket_sequence: older.at(-1)!.bucket_sequence
            })
    })
  );
  await store.selectWatch('1');
  assert.deepEqual(
    store.samples.map((row) => row.bucket_sequence),
    firstPage.map((row) => row.bucket_sequence)
  );
  assert.equal(store.samplesCursor, boundary.bucket_sequence);
  assert.equal(store.samplesInitialPartial, true);
  assert.equal(store.errors.samples, 'MONITORING_RESPONSE_INTEGRITY');
});

test('sample identity drift is isolated from already verified detail', async () => {
  const wrongConfig = monitoringSample({ configId: '2' });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listSamples: async () =>
        monitoringOk({ list: [wrongConfig], next_before_bucket_sequence: null })
    })
  );
  await store.selectWatch('1');
  assert.equal(store.detail?.config_id, '1');
  assert.equal(store.detailFresh, true);
  assert.deepEqual(store.samples, []);
  assert.equal(store.errors.samples, 'MONITORING_RESPONSE_INTEGRITY');
});

test('anomaly filter change clears old rows/cursor before its replacement request resolves', async () => {
  const deferred = monitoringDeferred<SnipingBridgeResult<MonitoringAnomalyListResponse>>();
  let received: unknown;
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listAnomalies: (async (input) => {
        received = input;
        return await deferred.promise;
      }) as MonitoringBridge['listAnomalies']
    })
  );
  store.anomalies = [monitoringSample({ name: 'Old', state: 'HIGH' })];
  store.anomalyCursor = { bucket_sequence: sequence(0), config_id: '1', config_revision: 1 };
  const pending = store.setAnomalyFilter('2', ['LOW', 'REGION_MISMATCH']);
  assert.deepEqual(store.anomalies, []);
  assert.equal(store.anomalyCursor, null);
  assert.deepEqual(received, {
    page_size: 50,
    config_id: '2',
    states: ['LOW', 'REGION_MISMATCH']
  });
  deferred.resolve(monitoringOk({ list: [], next_cursor: null }));
  await pending;
});

test('anomaly option and row refresh failures remain isolated under concurrent initialization', async () => {
  const verified = monitoringSample({ name: 'Verified anomaly', state: 'HIGH' });
  const lateOptions = monitoringDeferred<SnipingBridgeResult<MonitoringListResponse>>();
  const optionsFail = new MonitoringStore(
    monitoringBridgeStub({
      list: async () => await lateOptions.promise,
      listAnomalies: async () => monitoringOk({ list: [verified], next_cursor: null })
    })
  );
  optionsFail.errors.anomalies = 'STALE_ANOMALY_ERROR';
  const optionsFailing = optionsFail.initializeAnomalies();
  lateOptions.resolve(monitoringFailure('OPTIONS_UNAVAILABLE'));
  await optionsFailing;
  assert.equal(optionsFail.errors.anomalyOptions, 'OPTIONS_UNAVAILABLE');
  assert.equal(optionsFail.errors.anomalies, undefined);
  assert.deepEqual(optionsFail.anomalies, [verified]);

  const verifiedOption = monitoringListItem({ config_id: '9', name: 'Verified option' });
  const retained = monitoringSample({ name: 'Retained anomaly', state: 'LOW' });
  const lateAnomalies = monitoringDeferred<SnipingBridgeResult<MonitoringAnomalyListResponse>>();
  const anomaliesFail = new MonitoringStore(
    monitoringBridgeStub({
      list: async () => monitoringOk({ list: [verifiedOption], total: 1, page: 1, page_size: 100 }),
      listAnomalies: async () => await lateAnomalies.promise
    })
  );
  anomaliesFail.errors.anomalyOptions = 'STALE_OPTION_ERROR';
  anomaliesFail.anomalies = [retained];
  const anomaliesFailing = anomaliesFail.initializeAnomalies();
  lateAnomalies.resolve(monitoringFailure('ANOMALIES_UNAVAILABLE'));
  await anomaliesFailing;
  assert.equal(anomaliesFail.errors.anomalyOptions, undefined);
  assert.equal(anomaliesFail.errors.anomalies, 'ANOMALIES_UNAVAILABLE');
  assert.deepEqual(anomaliesFail.anomalyWatchOptions, [verifiedOption]);
  assert.deepEqual(anomaliesFail.anomalies, [retained]);
});

test('same anomaly cursor is rejected to prevent an infinite Load older loop', async () => {
  const row = monitoringSample({ name: 'High watch', state: 'HIGH' });
  const cursor = {
    bucket_sequence: row.bucket_sequence,
    config_id: row.config_id,
    config_revision: row.config_revision
  };
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listAnomalies: async () =>
        monitoringOk({
          list: Array.from({ length: 50 }, (_, index) =>
            monitoringSample({
              configId: '1',
              name: `Older ${index}`,
              state: 'HIGH',
              sequence: sequence(index + 1)
            })
          ),
          next_cursor: cursor
        })
    })
  );
  store.anomalies = [row];
  store.anomalyCursor = cursor;
  await store.loadOlderAnomalies();
  assert.deepEqual(store.anomalies, [row]);
  assert.deepEqual(store.anomalyCursor, cursor);
  assert.equal(store.errors.anomalies, 'MONITORING_RESPONSE_INTEGRITY');
});

test('older anomaly page cannot drift immutable identity for an existing config revision', async () => {
  const existing = monitoringSample({ name: 'Watch', state: 'HIGH' });
  const cursor = {
    bucket_sequence: existing.bucket_sequence,
    config_id: existing.config_id,
    config_revision: existing.config_revision
  };
  const drifted = monitoringSample({
    name: 'Watch',
    state: 'HIGH',
    sequence: sequence(1),
    tokenAddress: `0x${'2'.repeat(40)}`
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      listAnomalies: async () => monitoringOk({ list: [drifted], next_cursor: null })
    })
  );
  store.anomalies = [existing];
  store.anomalyCursor = cursor;
  await store.loadOlderAnomalies();
  assert.deepEqual(store.anomalies, [existing]);
  assert.deepEqual(store.anomalyCursor, cursor);
  assert.equal(store.errors.anomalies, 'MONITORING_RESPONSE_INTEGRITY');
});

test('Start uses current CAS and accepts only a fresh WARMING revision', async () => {
  const calls: unknown[] = [];
  const started = monitoringDetail({
    config_revision: 2,
    desired_state: 'armed',
    status: 'Monitoring',
    available_revisions: [
      {
        revision: 2,
        desired_state: 'armed',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: false
      },
      {
        revision: 1,
        desired_state: 'disabled',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: false
      }
    ]
  });
  const store = new MonitoringStore(
    monitoringBridgeStub({
      start: async (input) => {
        calls.push(input);
        return monitoringOk(started);
      }
    })
  );
  await store.selectWatch('1');
  await store.setMonitoring(true);
  assert.deepEqual(calls, [{ config_id: '1', expected_revision: 1 }]);
  assert.equal(store.detail?.config_revision, 2);
  assert.equal(store.detail?.status, 'Monitoring');
  assert.deepEqual(store.detail?.readiness, {
    state: 'WARMING',
    baseline_count: 0,
    minimum_baseline_count: 72
  });
});
