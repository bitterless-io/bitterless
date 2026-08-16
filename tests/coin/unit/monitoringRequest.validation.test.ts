import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MonitoringInputError,
  parseMonitoringAnomalyListInput,
  parseMonitoringIdentityInput,
  parseMonitoringListInput,
  parseMonitoringRevisionInput,
  parseMonitoringSampleListInput,
  parseMonitoringSaveInput
} from '../../../src/main/monitoring/monitoringRequest.validation';
import { MONITORING_ADDRESS } from './monitoringFixtures';

const forbiddenFreeText = [
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

test('monitoring renderer inputs are exact closed envelopes', () => {
  assert.deepEqual(parseMonitoringListInput({ page: 2, page_size: 100, search_text: 'GME' }), {
    page: 2,
    page_size: 100,
    search_text: 'GME'
  });
  assert.deepEqual(parseMonitoringIdentityInput({ config_id: '1' }), { config_id: '1' });
  assert.deepEqual(parseMonitoringRevisionInput({ config_id: '1', expected_revision: 4 }), {
    config_id: '1',
    expected_revision: 4
  });
  assert.deepEqual(
    parseMonitoringSampleListInput({
      config_id: '1',
      config_revision: 2,
      before_bucket_sequence: '0',
      page_size: 250
    }),
    {
      config_id: '1',
      config_revision: 2,
      before_bucket_sequence: '0',
      page_size: 250
    }
  );
  assert.deepEqual(
    parseMonitoringAnomalyListInput({
      config_id: '1',
      states: ['HIGH', 'LOW', 'REGION_MISMATCH'],
      cursor: { bucket_sequence: '0', config_id: '2', config_revision: 1 },
      page_size: 100
    }),
    {
      config_id: '1',
      states: ['HIGH', 'LOW', 'REGION_MISMATCH'],
      cursor: { bucket_sequence: '0', config_id: '2', config_revision: 1 },
      page_size: 100
    }
  );

  for (const input of [
    { config_id: '1', chain: 'bsc' },
    { config_id: '1', expected_revision: 1, desired_state: 'armed' },
    { config_id: '1', config_revision: 1, regions: ['sg', 'jp'] },
    { page: 1, endpoint: 'https://evil.test' }
  ])
    assert.throws(() => {
      if ('expected_revision' in input) parseMonitoringRevisionInput(input);
      else if ('config_revision' in input) parseMonitoringSampleListInput(input);
      else if ('page' in input) parseMonitoringListInput(input);
      else parseMonitoringIdentityInput(input);
    }, MonitoringInputError);
});

test('save accepts only canonical BSC CA, bounded two-decimal threshold and CAS shape', () => {
  assert.deepEqual(
    parseMonitoringSaveInput({
      token_address: MONITORING_ADDRESS,
      zscore_threshold: 2,
      expected_revision: 0
    }),
    {
      token_address: MONITORING_ADDRESS,
      zscore_threshold: 2,
      expected_revision: 0
    }
  );
  assert.equal(
    parseMonitoringSaveInput({
      config_id: '9',
      name: 'SPCX activity',
      token_address: MONITORING_ADDRESS,
      zscore_threshold: 10,
      expected_revision: 2
    }).zscore_threshold,
    10
  );

  for (const patch of [
    { token_address: `0x${'A'.repeat(40)}` },
    { token_address: `0x${'0'.repeat(40)}` },
    { zscore_threshold: 1.99 },
    { zscore_threshold: 10.01 },
    { zscore_threshold: 3.001 },
    { zscore_threshold: Number.NaN },
    { expected_revision: 1 },
    { name: 'https://evil.test/watch' },
    { name: 'Bearer hidden' },
    { name: 'select token from secrets' },
    { provider_reference_ids: ['bsc-read-sg'] },
    { primary_region: 'sg' },
    { headers: { authorization: 'hidden' } }
  ])
    assert.throws(
      () =>
        parseMonitoringSaveInput({
          token_address: MONITORING_ADDRESS,
          zscore_threshold: 3,
          expected_revision: 0,
          ...patch
        }),
      MonitoringInputError,
      JSON.stringify(patch)
    );

  assert.throws(
    () =>
      parseMonitoringSaveInput({
        config_id: '1',
        token_address: MONITORING_ADDRESS,
        zscore_threshold: 3,
        expected_revision: 0
      }),
    MonitoringInputError
  );
});

test('save name length is bounded by Unicode code points instead of UTF-16 units', () => {
  const emoji = '😀';
  const accepted = emoji.repeat(128);
  assert.equal(
    parseMonitoringSaveInput({
      name: accepted,
      token_address: MONITORING_ADDRESS,
      zscore_threshold: 3,
      expected_revision: 0
    }).name,
    accepted
  );
  assert.throws(
    () =>
      parseMonitoringSaveInput({
        name: emoji.repeat(129),
        token_address: MONITORING_ADDRESS,
        zscore_threshold: 3,
        expected_revision: 0
      }),
    MonitoringInputError
  );
});

test('search and label free text reuse the normalized secret and executable scanner', () => {
  for (const value of forbiddenFreeText) {
    assert.throws(() => parseMonitoringListInput({ search_text: value }), MonitoringInputError);
    assert.throws(
      () =>
        parseMonitoringSaveInput({
          name: value,
          token_address: MONITORING_ADDRESS,
          zscore_threshold: 3,
          expected_revision: 0
        }),
      MonitoringInputError
    );
  }
  for (const value of ['GME token watch', 'BSC monitor v1.0.0', 'Version 1.2.3 release']) {
    assert.equal(parseMonitoringListInput({ search_text: value }).search_text, value);
  }
});

test('IDs, cursors, pages and anomaly states remain bounded and canonical', () => {
  for (const config_id of ['0', '01', '-1', '9223372036854775808', 1, '']) {
    assert.throws(() => parseMonitoringIdentityInput({ config_id }), MonitoringInputError);
  }
  for (const page_size of [0, 251, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        parseMonitoringSampleListInput({
          config_id: '1',
          config_revision: 1,
          page_size
        }),
      MonitoringInputError
    );
  }
  for (const states of [
    ['READY'],
    ['HIGH', 'HIGH'],
    [],
    ['UNKNOWN'],
    [
      'WARMING',
      'BASELINE_FLAT',
      'HIGH',
      'LOW',
      'INCOMPLETE_RANGE',
      'REGION_MISMATCH',
      'SINGLE_REGION',
      'HIGH'
    ]
  ])
    assert.throws(() => parseMonitoringAnomalyListInput({ states }), MonitoringInputError);
  for (const cursor of [
    { bucket_sequence: '01', config_id: '1', config_revision: 1 },
    { bucket_sequence: '1', config_id: '0', config_revision: 1 },
    { bucket_sequence: '1', config_id: '1', config_revision: 0 },
    { bucket_sequence: '1', config_id: '1', config_revision: 1, extra: true }
  ])
    assert.throws(() => parseMonitoringAnomalyListInput({ cursor }), MonitoringInputError);
});

test('non-plain renderer objects fail closed before any projection is accepted', () => {
  assert.throws(() => parseMonitoringListInput([]), MonitoringInputError);
  assert.throws(() => parseMonitoringListInput(new (class Input {})()), MonitoringInputError);
  assert.throws(() => parseMonitoringListInput(Object.create(null)), MonitoringInputError);
});
