import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMonitoringAnomalyListResponse,
  parseMonitoringDetailResponse,
  parseMonitoringListResponse,
  parseMonitoringSampleListResponse
} from '../../../src/main/monitoring/monitoringResponse.validation';
import { SnipingResponseError } from '../../../src/main/sniping/snipingResponse.validation';
import {
  MONITORING_BUCKET_SEQUENCE,
  monitoringDetail,
  monitoringListItem,
  monitoringSample
} from './monitoringFixtures';

const clone = <T>(value: T): T => structuredClone(value);
const sequence = (offset: number): string =>
  String(BigInt(MONITORING_BUCKET_SEQUENCE) - BigInt(offset));

test('strict monitor list/detail projections preserve exact release, asset and runtime truth', () => {
  const latest = monitoringSample({ state: 'HIGH' });
  const detail = monitoringDetail({
    latest,
    readiness: { state: 'HIGH', baseline_count: 72, minimum_baseline_count: 72 },
    available_revisions: [
      {
        revision: 1,
        desired_state: 'disabled',
        created_at: '2026-08-14T00:00:00.000Z',
        has_samples: true
      }
    ]
  });
  assert.equal(parseMonitoringDetailResponse(detail).latest?.confirmed, true);
  const listRow = monitoringListItem({
    latest,
    readiness: { state: 'HIGH', baseline_count: 72, minimum_baseline_count: 72 }
  });
  assert.equal(
    parseMonitoringListResponse({ list: [listRow], total: 1, page: 1, page_size: 20 }).total,
    1
  );

  const mutations: Array<(fixture: Record<string, any>) => void> = [
    (fixture) => {
      fixture.asset_key = `eip155:56:0x${'2'.repeat(40)}`;
    },
    (fixture) => {
      fixture.chain = 'eth';
    },
    (fixture) => {
      fixture.primary_region = 'jp';
      fixture.standby_region = 'jp';
    },
    (fixture) => {
      fixture.status = 'Monitoring';
    },
    (fixture) => {
      fixture.zscore_threshold = 3.001;
    },
    (fixture) => {
      fixture.latest.config_id = '2';
    },
    (fixture) => {
      fixture.latest.config_revision = 2;
    },
    (fixture) => {
      fixture.latest.asset_key = `eip155:56:0x${'2'.repeat(40)}`;
    },
    (fixture) => {
      fixture.latest.schema_hash = 'f'.repeat(64);
    },
    (fixture) => {
      fixture.latest.zscore_threshold = 4;
    },
    (fixture) => {
      fixture.readiness.baseline_count = 71;
    },
    (fixture) => {
      fixture.runtime[0].cursor_summary.lag_blocks = '3';
    },
    (fixture) => {
      fixture.available_revisions[0].revision = 2;
    }
  ];
  for (const mutate of mutations) {
    const fixture = clone(detail) as unknown as Record<string, any>;
    mutate(fixture);
    assert.throws(() => parseMonitoringDetailResponse(fixture), SnipingResponseError);
  }
});

test('monitor summaries pin the reviewed SG primary and JP standby topology', () => {
  const valid = monitoringDetail();
  assert.deepEqual(
    [parseMonitoringDetailResponse(valid).primary_region, valid.standby_region],
    ['sg', 'jp']
  );
  for (const topology of [
    { primary_region: 'jp', standby_region: 'sg' },
    { primary_region: 'sg', standby_region: 'sg' }
  ] as const) {
    assert.throws(
      () => parseMonitoringDetailResponse(monitoringDetail(topology)),
      SnipingResponseError
    );
  }
});

test('response names count Unicode code points instead of UTF-16 units', () => {
  const emoji = '😀';
  const accepted = emoji.repeat(128);
  assert.equal(parseMonitoringDetailResponse(monitoringDetail({ name: accepted })).name, accepted);
  assert.throws(
    () => parseMonitoringDetailResponse(monitoringDetail({ name: emoji.repeat(129) })),
    SnipingResponseError
  );
});

test('list detail and anomaly names fail closed on normalized credential and route evidence', () => {
  const forbidden = [
    'token=opaquevalue',
    'coreToken=opaquevalue',
    'customerJwt=opaquevalue',
    'refreshToken=opaquevalue',
    'sessionId=session-1',
    'credential_reference_id=cred-1',
    'secret_reference_id=secret-1',
    'provider_reference_id=bsc-read-sg',
    'headers=x-custom',
    'endpoint_url=provider.example/rpc',
    'module_path=/tmp/runner.ts',
    'component_path=/tmp/private',
    'abcdefghij.abcdefghij.abcdefghij',
    'wss://user:secret@provider.example/rpc',
    'grpc://provider.example/rpc'
  ];
  for (const name of forbidden) {
    const item = monitoringListItem({ name });
    assert.throws(
      () => parseMonitoringListResponse({ list: [item], total: 1, page: 1, page_size: 20 }),
      SnipingResponseError,
      name
    );
    assert.throws(
      () => parseMonitoringDetailResponse(monitoringDetail({ name })),
      SnipingResponseError,
      name
    );
    assert.throws(
      () =>
        parseMonitoringAnomalyListResponse({
          list: [monitoringSample({ name, state: 'HIGH' })],
          next_cursor: null
        }),
      SnipingResponseError,
      name
    );
  }
  for (const name of ['GME token watch', 'BSC monitor v1.0.0']) {
    assert.equal(parseMonitoringDetailResponse(monitoringDetail({ name })).name, name);
  }
});

test('detail revision history is an exact consecutive newest-500 window', () => {
  for (const current of [1, 5, 501]) {
    const parsed = parseMonitoringDetailResponse(monitoringDetail({ config_revision: current }));
    assert.equal(parsed.available_revisions.length, Math.min(current, 500));
    assert.equal(parsed.available_revisions.at(-1)?.revision, Math.max(1, current - 499));
  }
  const missing = monitoringDetail({ config_revision: 5 });
  missing.available_revisions.splice(2, 1);
  assert.throws(() => parseMonitoringDetailResponse(missing), SnipingResponseError);
  const impossibleSamples = monitoringDetail();
  impossibleSamples.available_revisions[0].has_samples = true;
  assert.throws(() => parseMonitoringDetailResponse(impossibleSamples), SnipingResponseError);
});

test('sample evidence distinguishes zero, incomplete and region disagreement without synthesis', () => {
  const zero = monitoringSample();
  zero.transfer_event_count = 0;
  zero.regions[0].transfer_event_count = 0;
  zero.regions[1].transfer_event_count = 0;
  assert.equal(
    parseMonitoringSampleListResponse({
      list: [zero],
      next_before_bucket_sequence: zero.bucket_sequence
    }).list[0].transfer_event_count,
    0
  );

  const incomplete = monitoringSample({ state: 'INCOMPLETE_RANGE' });
  const mismatch = monitoringSample({ state: 'REGION_MISMATCH', sequence: sequence(1) });
  const single = monitoringSample({ state: 'SINGLE_REGION', sequence: sequence(2) });
  const parsed = parseMonitoringSampleListResponse({
    list: [incomplete, mismatch, single],
    next_before_bucket_sequence: single.bucket_sequence
  });
  assert.deepEqual(
    parsed.list.map((row) => [row.state, row.confirmed, row.z_score]),
    [
      ['INCOMPLETE_RANGE', false, null],
      ['REGION_MISMATCH', false, null],
      ['SINGLE_REGION', false, null]
    ]
  );

  for (const mutate of [
    (fixture: any) => {
      fixture.transfer_event_count = 0;
    },
    (fixture: any) => {
      fixture.regions[0].transfer_event_count = 0;
    },
    (fixture: any) => {
      fixture.z_score = '0';
    },
    (fixture: any) => {
      fixture.confirmed = true;
    }
  ]) {
    const fixture = clone(incomplete);
    mutate(fixture);
    assert.throws(
      () =>
        parseMonitoringSampleListResponse({
          list: [fixture],
          next_before_bucket_sequence: fixture.bucket_sequence
        }),
      SnipingResponseError
    );
  }
});

test('sample identity, threshold, region semantics and bucket alignment fail closed on mutation', () => {
  const source = monitoringSample({ state: 'HIGH' });
  const mutations: Array<(fixture: Record<string, any>) => void> = [
    (fixture) => {
      fixture.asset_key = `eip155:1:0x${'1'.repeat(40)}`;
    },
    (fixture) => {
      fixture.component_id = 'other';
    },
    (fixture) => {
      fixture.component_version = '1.0.1';
    },
    (fixture) => {
      fixture.schema_hash = 'A'.repeat(64);
    },
    (fixture) => {
      fixture.metric_kind = 'price';
    },
    (fixture) => {
      fixture.detector_version = 'client-v1';
    },
    (fixture) => {
      fixture.zscore_threshold = 3.001;
    },
    (fixture) => {
      fixture.bucket_sequence = String(BigInt(fixture.bucket_sequence) + 1n);
    },
    (fixture) => {
      fixture.bucket_end = '2026-08-14T00:06:00.000Z';
    },
    (fixture) => {
      fixture.transfer_event_count = 27;
    },
    (fixture) => {
      fixture.regions[1].transfer_event_count = 27;
    },
    (fixture) => {
      fixture.regions[1].sample_fingerprint = 'd'.repeat(64);
    },
    (fixture) => {
      fixture.regions[0].z_score = '2.99';
      fixture.regions[1].z_score = '2.99';
    },
    (fixture) => {
      fixture.extra = true;
    }
  ];
  for (const mutate of mutations) {
    const fixture = clone(source) as unknown as Record<string, any>;
    mutate(fixture);
    assert.throws(
      () =>
        parseMonitoringSampleListResponse({
          list: [fixture],
          next_before_bucket_sequence: fixture.bucket_sequence
        }),
      SnipingResponseError
    );
  }
});

test('sample pages cap at 250 and require unique descending rows plus the last-row cursor', () => {
  const rows = Array.from({ length: 250 }, (_, index) =>
    monitoringSample({ sequence: sequence(index) })
  );
  const response = { list: rows, next_before_bucket_sequence: rows.at(-1)!.bucket_sequence };
  assert.equal(parseMonitoringSampleListResponse(response).list.length, 250);
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') < 1_048_576);

  const worstCase = structuredClone(response);
  for (const row of worstCase.list) {
    const reason = `R${'X'.repeat(127)}`;
    const fromBlock = '8'.repeat(29);
    const toBlock = '9'.repeat(29);
    const decimal = `${'9'.repeat(18)}.${'9'.repeat(12)}`;
    Object.assign(row, {
      from_block: fromBlock,
      to_block: toBlock,
      baseline_mean: decimal,
      baseline_stddev: decimal,
      reason_code: reason
    });
    for (const region of row.regions)
      Object.assign(region, {
        from_block: fromBlock,
        to_block: toBlock,
        baseline_mean: decimal,
        baseline_stddev: decimal,
        reason_code: reason
      });
  }
  assert.equal(parseMonitoringSampleListResponse(worstCase).list.length, 250);
  assert.ok(Buffer.byteLength(JSON.stringify(worstCase), 'utf8') < 1_048_576);

  assert.throws(
    () =>
      parseMonitoringSampleListResponse({
        list: [...rows, monitoringSample({ sequence: sequence(250) })],
        next_before_bucket_sequence: sequence(250)
      }),
    SnipingResponseError
  );
  assert.throws(
    () =>
      parseMonitoringSampleListResponse({
        list: [rows[0], clone(rows[0])],
        next_before_bucket_sequence: rows[0].bucket_sequence
      }),
    SnipingResponseError
  );
  assert.throws(
    () =>
      parseMonitoringSampleListResponse({
        list: [rows[1], rows[0]],
        next_before_bucket_sequence: rows[0].bucket_sequence
      }),
    SnipingResponseError
  );
  assert.throws(
    () =>
      parseMonitoringSampleListResponse({
        list: rows.slice(0, 2),
        next_before_bucket_sequence: rows[0].bucket_sequence
      }),
    SnipingResponseError
  );
});

test('monitoring decimals match the canonical Private 18 integer and 12 fraction contract', () => {
  const valid = monitoringSample();
  for (const value of ['0', '1', '-1', '0.000000000001', `${'9'.repeat(18)}.${'9'.repeat(12)}`]) {
    const fixture = clone(valid);
    fixture.baseline_mean = value;
    for (const region of fixture.regions) region.baseline_mean = value;
    assert.equal(
      parseMonitoringSampleListResponse({ list: [fixture], next_before_bucket_sequence: null })
        .list[0].baseline_mean,
      value
    );
  }
  for (const value of [
    '-0',
    '00',
    '01',
    '.1',
    '1.',
    '1.0',
    '1.230',
    '1e-12',
    '9'.repeat(19),
    `0.${'1'.repeat(13)}`
  ]) {
    const fixture = clone(valid);
    fixture.baseline_mean = value;
    for (const region of fixture.regions) region.baseline_mean = value;
    assert.throws(
      () =>
        parseMonitoringSampleListResponse({ list: [fixture], next_before_bucket_sequence: null }),
      SnipingResponseError,
      value
    );
  }
});

test('anomaly pages require name, exception state, strict tuple order and exact last cursor', () => {
  const first = monitoringSample({ configId: '2', name: 'Watch 2', state: 'HIGH' });
  const second = monitoringSample({ configId: '1', name: 'Watch 1', state: 'LOW' });
  const cursor = {
    bucket_sequence: second.bucket_sequence,
    config_id: second.config_id,
    config_revision: second.config_revision
  };
  assert.deepEqual(
    parseMonitoringAnomalyListResponse({ list: [first, second], next_cursor: cursor }).next_cursor,
    cursor
  );

  const cases = [
    { list: [second, first], next_cursor: cursor },
    { list: [first, clone(first)], next_cursor: cursor },
    { list: [monitoringSample({ name: 'Ready', state: 'READY' })], next_cursor: null },
    { list: [{ ...first, name: undefined }], next_cursor: null },
    {
      list: [first, second],
      next_cursor: {
        bucket_sequence: first.bucket_sequence,
        config_id: first.config_id,
        config_revision: first.config_revision
      }
    }
  ];
  for (const value of cases) {
    assert.throws(() => parseMonitoringAnomalyListResponse(value), SnipingResponseError);
  }
  const maximum = Array.from({ length: 101 }, (_, index) =>
    monitoringSample({
      configId: String(200 - index),
      name: `Watch ${index}`,
      state: 'HIGH',
      sequence: sequence(index)
    })
  );
  assert.throws(
    () => parseMonitoringAnomalyListResponse({ list: maximum, next_cursor: null }),
    SnipingResponseError
  );
});

test('list pages reject duplicate identities, impossible totals and malformed empty readiness', () => {
  const item = monitoringListItem();
  assert.throws(
    () =>
      parseMonitoringListResponse({
        list: [item, clone(item)],
        total: 2,
        page: 1,
        page_size: 20
      }),
    SnipingResponseError
  );
  assert.throws(
    () =>
      parseMonitoringListResponse({
        list: [item],
        total: 0,
        page: 1,
        page_size: 20
      }),
    SnipingResponseError
  );
  const malformed = clone(item);
  malformed.readiness.baseline_count = 1;
  assert.throws(
    () =>
      parseMonitoringListResponse({
        list: [malformed],
        total: 1,
        page: 1,
        page_size: 20
      }),
    SnipingResponseError
  );
});
