import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  SnipingActivityListInput,
  SnipingActivityListResult,
  SnipingActivityRow,
  SnipingBridge,
  SnipingBridgeResult,
  SnipingConfigDetail,
  SnipingConfigSummary,
  SnipingPage,
  SnipingReleaseProjection,
  SnipingRuntimeProjection,
  SnipingSimulationRequestProjection,
} from '../../../src/shared/sniping/snipingBridge.type';
import { SnipingStore } from '../../../src/renderer/coin/src/views/sniping/sniping.store';

let uuidCounter = 0;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    crypto: {
      randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    },
  },
});

const ok = <T>(value: T): SnipingBridgeResult<T> => ({ ok: true, value });
const failure = (code: string, status: number | null = null): SnipingBridgeResult<never> => ({
  ok: false,
  error: { code, message: 'sanitized', status, retryable: false },
});
const page = <T>(list: T[], currentPage = 1): SnipingPage<T> => ({
  list, total: list.length, page: currentPage, page_size: 20,
});
const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void } => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};

const RELEASE: SnipingReleaseProjection = {
  component_id: 'flap-quote-token-snipe',
  component_version: '1.0.0',
  schema_hash: 'schema-v1',
  title: 'Flap quote-token simulation',
  description: 'One quote token per instance.',
  mode: 'monitor-only',
  trigger_family: 'chain-event',
  available: true,
  chains: ['bsc'],
  required_capabilities: ['evm-json-rpc', 'evm-websocket'],
  config_schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      quote_token_address: {
        type: 'string', minLength: 42, maxLength: 42, pattern: '^0x[0-9a-f]{40}$',
      },
      spend_amount_atomic: {
        type: 'string', minLength: 1, maxLength: 78, pattern: '^(0|[1-9][0-9]*)$',
      },
    },
    required: ['quote_token_address'],
    unevaluatedProperties: false,
  },
  ui_schema: {
    schema: 'bl-sniping-ui-hints-v1',
    groups: [{ id: 'target', label: 'Target', order: 10 }],
    fields: {
      quote_token_address: {
        group: 'target', label: 'Quote token', order: 10, unit: null,
        derived: false, read_only: false, advanced_only: false,
      },
      spend_amount_atomic: {
        group: 'target', label: 'Atomic spend', order: 20, unit: 'atomic',
        derived: true, read_only: true, advanced_only: false,
      },
    },
  },
  default_config: {
    quote_token_address: '0x1111111111111111111111111111111111111111',
    spend_amount_atomic: '1',
  },
  secret_slots: [],
};

const runtime = (
  observedState: SnipingRuntimeProjection['observed_state'],
): SnipingRuntimeProjection => ({
  region: 'sg',
  desired_state: observedState === 'active' ? 'armed' : 'disabled',
  observed_state: observedState,
  cursor_summary: null,
  lag_ms: null,
  last_error_code: null,
  heartbeat_at: '2026-08-14T00:00:00.000Z',
});

const summary = (
  configId: string,
  name: string,
  revision = 1,
  desiredState: SnipingConfigSummary['desired_state'] = 'disabled',
): SnipingConfigSummary => ({
  config_id: configId,
  name,
  component_id: RELEASE.component_id,
  component_version: RELEASE.component_version,
  schema_hash: RELEASE.schema_hash,
  release_available: true,
  chain: 'bsc',
  config_revision: revision,
  desired_state: desiredState,
  primary_region: 'sg',
  standby_region: 'jp',
  updated_at: '2026-08-14T00:00:00.000Z',
});

const detail = (
  configId: string,
  name: string,
  revision = 1,
  desiredState: SnipingConfigDetail['desired_state'] = 'disabled',
  quoteToken = '0x1111111111111111111111111111111111111111',
  runtimes: SnipingRuntimeProjection[] = [runtime('standby')],
): SnipingConfigDetail => ({
  ...summary(configId, name, revision, desiredState),
  config: { quote_token_address: quoteToken, spend_amount_atomic: '1' },
  credential_status: [],
  runtimes,
});

const simulation = (
  requestId: string,
  configId: string,
  revision: number,
  kind: 'exact' | 'shadow' = 'exact',
): SnipingSimulationRequestProjection => ({
  request_id: requestId,
  config_id: configId,
  config_revision: revision,
  kind,
  canonical_event_key: kind === 'exact' ? 'event-1' : null,
  shadow_policy: kind === 'shadow'
    ? { max_events: 2, checkpoint_blocks: [1, 2], evidence_ttl_seconds: 60 }
    : null,
  state: 'completed',
  attempt_count: 0,
  accepted_attempt_number: null,
  evidence_expires_at: '2026-08-14T01:00:00.000Z',
  evidence_expired: false,
  attempts: [],
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
});


const activity = (activityId: string, product: 'monitor' | 'shadow'): SnipingActivityRow => ({
  activity_id: activityId,
  product,
  config_id: '1',
  config_name: 'SPCX test',
  component_id: RELEASE.component_id,
  component_version: RELEASE.component_version,
  chain: 'bsc',
  canonical_event_key: null,
  outcome: product === 'shadow' ? 'unknown' : 'hit',
  reason_code: product === 'shadow' ? 'HISTORICAL_STATE_UNKNOWN' : 'FLAP_LAUNCH_MATCH',
  token_address: null,
  quote_token_address: null,
  action_class: null,
  request_id: null,
  attempt_number: null,
  attempt_state: null,
  request_fingerprint: null,
  evidence_class: product === 'shadow' ? 'SIMULATED' : null,
  created_at: '2026-08-14T00:00:00.000Z',
});

const createBridge = (overrides: Partial<SnipingBridge> = {}): SnipingBridge => ({
  listComponents: async () => ok([RELEASE]),
  listConfigs: async () => ok(page([summary('1', 'SPCX test'), summary('2', 'GME test')])),
  getConfig: async ({ config_id }) => ok(detail(config_id, config_id === '1' ? 'SPCX test' : 'GME test')),
  validateConfig: async () => ok({
    valid: true, schema_hash: RELEASE.schema_hash, normalized_config_hash: 'normalized-v1',
  }),
  saveConfig: async (input) => ok(detail(input.config_id ?? '3', input.name, input.expected_revision + 1)),
  startMonitoring: async (input) => ok(detail(
    input.config_id, 'SPCX test', input.expected_revision + 1, 'armed',
    '0x1111111111111111111111111111111111111111', [runtime('active')],
  )),
  stopMonitoring: async (input) => ok(detail(
    input.config_id, 'SPCX test', input.expected_revision + 1, 'disabled',
  )),
  listRuntimes: async ({ config_id }) => ok({
    config_id: config_id, desired_state: 'disabled', list: [runtime('standby')],
  }),
  listSimulationEvents: async () => ok(page([])),
  requestExactSimulation: async (input) => ok(simulation(input.request_id, input.config_id, input.expected_revision)),
  listExactSimulations: async () => ok(page([])),
  requestShadowSimulation: async (input) => ok({
    ...simulation(input.request_id, input.config_id, input.expected_revision, 'shadow'),
    shadow_policy: input.shadow_policy,
  }),
  listShadowSimulations: async () => ok(page([])),
  listActivity: async () => ok({ list: [], next_cursor: null }),
  ...overrides,
});

test('catalog projection retains separate SPCX/GME instances and maps armed to Monitoring', async () => {
  const unavailable = { ...RELEASE, component_version: '2.0.0', available: false };
  const store = new SnipingStore(createBridge({
    listComponents: async () => ok([RELEASE, unavailable]),
    listConfigs: async () => ok(page([
      summary('spcx', 'SPCX test', 3),
      summary('gme', 'GME', 7, 'armed'),
    ])),
    getConfig: async () => ok(detail('gme', 'GME', 7, 'armed',
      '0x2222222222222222222222222222222222222222', [runtime('active')])),
    listRuntimes: async () => ok({
      config_id: 'gme', desired_state: 'armed', list: [runtime('active')],
    }),
  }));
  await store.initialize();
  assert.deepEqual(store.releases.map((release) => release.component_version), ['1.0.0']);
  assert.deepEqual(store.configs.map((config) => [config.config_id, config.name, config.config_revision]), [
    ['spcx', 'SPCX test', 3], ['gme', 'GME', 7],
  ]);
  await store.selectConfig('gme');
  assert.equal(store.displayStateKey, 'monitoring');
  assert.equal(store.isMonitoring, true);
  assert.equal(store.monitorQualificationReady, true);
  assert.equal(store.editable, false);
});

test('newer catalog and detail intents win over older deferred reads', async () => {
  const oldCatalog = deferred<SnipingBridgeResult<SnipingPage<SnipingConfigSummary>>>();
  const oldDetail = deferred<SnipingBridgeResult<SnipingConfigDetail>>();
  let listCalls = 0;
  const store = new SnipingStore(createBridge({
    listConfigs: async (input) => {
      listCalls += 1;
      if (listCalls === 1) return await oldCatalog.promise;
      return ok(page([summary('new', input?.search_text ?? 'new')]));
    },
    getConfig: async ({ config_id }) => config_id === 'old'
      ? await oldDetail.promise
      : ok(detail('new', 'New detail')),
  }));
  const firstList = store.refreshProducts();
  await store.searchConfigs('new');
  oldCatalog.resolve(ok(page([summary('old', 'Old catalog')])));
  await firstList;
  assert.deepEqual(store.configs.map((config) => config.config_id), ['new']);

  const firstDetail = store.selectConfig('old');
  await store.selectConfig('new');
  oldDetail.resolve(ok(detail('old', 'Old detail')));
  await firstDetail;
  assert.equal(store.selectedConfigId, 'new');
  assert.equal(store.detail?.name, 'New detail');
});

test('a save CAS conflict refreshes revision facts without overwriting the owner draft', async () => {
  let reads = 0;
  const oldAddress = '0x1111111111111111111111111111111111111111';
  const ownerAddress = '0x2222222222222222222222222222222222222222';
  const serverAddress = '0x3333333333333333333333333333333333333333';
  const store = new SnipingStore(createBridge({
    getConfig: async () => {
      reads += 1;
      return ok(detail('1', reads === 1 ? 'SPCX test' : 'Server name', reads === 1 ? 3 : 4,
        'disabled', reads === 1 ? oldAddress : serverAddress));
    },
    saveConfig: async () => failure('REVISION_CONFLICT', 409),
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.setName('Owner draft');
  store.setField('quote_token_address', ownerAddress);
  store.exactRuns = [simulation('stale-exact', '1', 3)];
  store.shadowRuns = [simulation('stale-shadow', '1', 3, 'shadow')];
  store.shadowRequestId = 'stale-shadow-request';
  store.shadowFingerprint = 'stale-shadow-fingerprint';

  await store.save();
  assert.equal(store.detail?.config_revision, 4);
  assert.equal(store.detail?.name, 'Owner draft');
  assert.equal(store.detail?.config.quote_token_address, serverAddress);
  assert.equal(store.draft.value.quote_token_address, ownerAddress);
  assert.equal(store.draft.changed, true);
  assert.equal(store.revisionConflict, true);
  assert.equal(store.shadowRequestId, null);
  assert.deepEqual(store.exactRuns, []);
  assert.deepEqual(store.shadowRuns, []);
});

test('workspace refresh preserves a changed owner draft and only fences a new revision', async () => {
  let reads = 0;
  const ownerAddress = '0x2222222222222222222222222222222222222222';
  const store = new SnipingStore(createBridge({
    getConfig: async () => {
      reads += 1;
      return ok(detail(
        '1', reads === 1 ? 'Initial name' : 'Remote name', reads < 3 ? 5 : 6,
        'disabled', reads < 3
          ? '0x1111111111111111111111111111111111111111'
          : '0x3333333333333333333333333333333333333333',
      ));
    },
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.setName('Owner name');
  store.setField('quote_token_address', ownerAddress);
  store.shadowRequestId = 'same-revision-shadow';
  store.shadowFingerprint = 'same-revision-fingerprint';

  await store.refreshWorkspace();
  assert.equal(store.detail?.config_revision, 5);
  assert.equal(store.detail?.name, 'Owner name');
  assert.equal(store.draft.value.quote_token_address, ownerAddress);
  assert.equal(store.draft.changed, true);
  assert.equal(store.revisionConflict, false);
  assert.equal(store.shadowRequestId, 'same-revision-shadow');

  store.exactRuns = [simulation('stale-exact', '1', 5)];
  store.shadowRuns = [simulation('stale-shadow', '1', 5, 'shadow')];
  await store.refreshWorkspace();
  assert.equal(store.detail?.config_revision, 6);
  assert.equal(store.detail?.name, 'Owner name');
  assert.equal(store.draft.value.quote_token_address, ownerAddress);
  assert.equal(store.draft.changed, true);
  assert.equal(store.revisionConflict, true);
  assert.equal(store.shadowRequestId, null);
  assert.deepEqual(store.exactRuns, []);
  assert.deepEqual(store.shadowRuns, []);
});

test('a name-only owner draft is dirty, survives Refresh, conflicts on revision, and commits on Save', async () => {
  let reads = 0;
  let saves = 0;
  const store = new SnipingStore(createBridge({
    getConfig: async () => {
      reads += 1;
      return ok(detail('1', reads === 1 ? 'Initial name' : 'Remote name', reads < 3 ? 5 : 6));
    },
    saveConfig: async (input) => {
      saves += 1;
      return ok(detail('1', input.name, input.expected_revision + 1));
    },
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.setName('Owner name only');
  assert.equal(store.draft.changed, false);
  assert.equal(store.ownerDraftChanged, true);
  assert.equal(store.canStartMonitoring, false);
  assert.equal(store.canRequestSimulation, false);

  await store.refreshWorkspace();
  assert.equal(store.detail?.name, 'Owner name only');
  assert.equal(store.detail?.config_revision, 5);
  assert.equal(store.ownerDraftChanged, true);
  assert.equal(store.revisionConflict, false);

  await store.refreshWorkspace();
  assert.equal(store.detail?.name, 'Owner name only');
  assert.equal(store.detail?.config_revision, 6);
  assert.equal(store.ownerDraftChanged, true);
  assert.equal(store.revisionConflict, true);
  await store.save();
  assert.equal(saves, 1);
  assert.equal(store.detail?.name, 'Owner name only');
  assert.equal(store.ownerDraftChanged, false);
  assert.equal(store.revisionConflict, false);
});

test('a failed current detail refresh disables only detail-dependent mutations until retry succeeds', async () => {
  let failDetail = false;
  const retainedExact = simulation('retained-exact', '1', 1);
  const retainedActivity = activity('retained-activity', 'monitor');
  const store = new SnipingStore(createBridge({
    getConfig: async () => failDetail ? failure('DETAIL_UNAVAILABLE') : ok(detail('1', 'SPCX test')),
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.exactRuns = [retainedExact];
  store.activity = [retainedActivity];
  failDetail = true;
  await store.selectConfig('1', false);
  assert.equal(store.detail?.name, 'SPCX test');
  assert.equal(store.detailProjectionStale, true);
  assert.deepEqual(
    [store.detailRemoteReady, store.editable, store.canStartMonitoring, store.canRequestSimulation],
    [false, false, false, false],
  );
  assert.deepEqual(store.exactRuns, [retainedExact]);
  assert.deepEqual(store.activity, [retainedActivity]);
  assert.equal(store.activityErrorCode, null);

  failDetail = false;
  await store.selectConfig('1', false);
  assert.equal(store.detailProjectionStale, false);
  assert.deepEqual(
    [store.detailRemoteReady, store.editable, store.canStartMonitoring, store.canRequestSimulation],
    [true, true, true, true],
  );
});

test('a late failed detail intent cannot make a newer successful selection stale', async () => {
  const old = deferred<SnipingBridgeResult<SnipingConfigDetail>>();
  const store = new SnipingStore(createBridge({
    getConfig: async ({ config_id }) => config_id === 'old' ? await old.promise : ok(detail('new', 'New')),
  }));
  await store.initialize();
  const stale = store.selectConfig('old');
  await store.selectConfig('new');
  old.resolve(failure('OLD_DETAIL_UNAVAILABLE'));
  await stale;
  assert.equal(store.detail?.config_id, 'new');
  assert.equal(store.detailProjectionStale, false);
  assert.equal(store.detailRemoteReady, true);
});

test('refreshing or unavailable products disable editing, start, simulation, and Stop', async () => {
  let starts = 0;
  let stops = 0;
  const store = new SnipingStore(createBridge({
    startMonitoring: async (input) => {
      starts += 1;
      return ok(detail(input.config_id, 'SPCX test', input.expected_revision + 1, 'armed'));
    },
    stopMonitoring: async (input) => {
      stops += 1;
      return ok(detail(input.config_id, 'SPCX test', input.expected_revision + 1));
    },
  }));
  await store.initialize();
  await store.selectConfig('1');
  assert.deepEqual(
    [store.editable, store.canStartMonitoring, store.canRequestSimulation],
    [true, true, true],
  );

  for (const phase of ['refreshing', 'unavailable'] as const) {
    store.phase = phase;
    assert.deepEqual(
      [store.editable, store.canStartMonitoring, store.canRequestSimulation],
      [false, false, false],
      phase,
    );
    await store.setMonitoring(true);
    store.detail = store.detail ? { ...store.detail, desired_state: 'armed' } : null;
    await store.setMonitoring(false);
    store.detail = store.detail ? { ...store.detail, desired_state: 'disabled' } : null;
  }
  assert.equal(starts, 0);
  assert.equal(stops, 0);
});

test('invalid UI ownership and retired pinned releases disable every remote product mutation', async () => {
  let validations = 0;
  let simulations = 0;
  const invalidUiRelease = {
    ...RELEASE,
    ui_schema: { ...RELEASE.ui_schema, unexpected: true },
  };
  const invalidUi = new SnipingStore(createBridge({
    listComponents: async () => ok([invalidUiRelease]),
    validateConfig: async () => {
      validations += 1;
      return ok({ valid: true, schema_hash: RELEASE.schema_hash, normalized_config_hash: 'hash' });
    },
  }));
  await invalidUi.initialize();
  await invalidUi.selectConfig('1');
  const original = structuredClone(invalidUi.draft.value);
  invalidUi.setAdvancedJson('{"quote_token_address":"0x2222222222222222222222222222222222222222"}');
  await invalidUi.validate();
  assert.equal(invalidUi.form.safeAdvanced, false);
  assert.equal(invalidUi.editable, false);
  assert.deepEqual(invalidUi.draft.value, original);
  assert.equal(validations, 0);

  const retired = new SnipingStore(createBridge({
    listComponents: async () => ok([]),
    requestExactSimulation: async () => {
      simulations += 1;
      return ok(simulation('unexpected', '1', 1));
    },
  }));
  await retired.initialize();
  await retired.selectConfig('1');
  retired.events = [{
    canonical_event_key: 'event-1',
    token_address: '0x2222222222222222222222222222222222222222',
    quote_token_address: '0x1111111111111111111111111111111111111111',
    block_number: '1', block_hash: `0x${'a'.repeat(64)}`,
    observed_at: '2026-08-14T00:00:00.000Z', finalized_at: '2026-08-14T00:00:01.000Z',
  }];
  retired.selectEvent('event-1');
  await retired.requestExact();
  assert.equal(retired.releaseUsable, false);
  assert.equal(retired.editable, false);
  assert.equal(retired.canRequestSimulation, false);
  assert.equal(simulations, 0);
});

test('Products and Activity errors remain isolated and clear only on their own surface', async () => {
  let activityFails = true;
  const store = new SnipingStore(createBridge({
    listExactSimulations: async () => failure('EXACT_HISTORY_UNAVAILABLE'),
    listActivity: async () => activityFails
      ? failure('ACTIVITY_UNAVAILABLE')
      : ok({ list: [], next_cursor: null }),
  }));
  await store.initialize();
  await store.selectConfig('1');
  await store.refreshActivity();
  assert.equal(store.productsErrorCode, 'EXACT_HISTORY_UNAVAILABLE');
  assert.equal(store.activityErrorCode, 'ACTIVITY_UNAVAILABLE');
  assert.equal(store.currentErrorCode, 'EXACT_HISTORY_UNAVAILABLE');

  activityFails = false;
  await store.refreshActivity();
  assert.equal(store.activityErrorCode, null);
  assert.equal(store.productsErrorCode, 'EXACT_HISTORY_UNAVAILABLE');
});

test('monitoring revision adoption invalidates evidence and never exposes financial Armed semantics', async () => {
  const store = new SnipingStore(createBridge({
    listRuntimes: async ({ config_id }) => ok({
      config_id: config_id, desired_state: 'armed', list: [runtime('active')],
    }),
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.events = [{
    canonical_event_key: 'event-1',
    token_address: '0x4444444444444444444444444444444444444444',
    quote_token_address: '0x1111111111111111111111111111111111111111',
    block_number: '10',
    block_hash: `0x${'a'.repeat(64)}`,
    observed_at: '2026-08-14T00:00:00.000Z',
    finalized_at: '2026-08-14T00:00:01.000Z',
  }];
  store.selectedEventKey = 'event-1';
  store.exactRuns = [simulation('exact-r1', '1', 1)];
  store.shadowRuns = [simulation('shadow-r1', '1', 1, 'shadow')];
  store.shadowRequestId = 'shadow-r1';
  store.shadowFingerprint = 'fingerprint-r1';

  await store.setMonitoring(true);
  assert.equal(store.detail?.config_revision, 2);
  assert.equal(store.displayStateKey, 'monitoring');
  assert.equal(store.monitorQualificationReady, true);
  assert.deepEqual(store.events, []);
  assert.deepEqual(store.exactRuns, []);
  assert.deepEqual(store.shadowRuns, []);
  assert.equal(store.selectedEventKey, null);
  assert.equal(store.shadowRequestId, null);

  await store.setMonitoring(false);
  assert.equal(store.detail?.config_revision, 3);
  assert.equal(store.displayStateKey, 'disabled');
  assert.equal(store.monitorQualificationReady, false);
});

test('Shadow uncertain retry reuses one id only while config, revision and policy stay exact', async () => {
  const requests: Array<{ request_id: string; max_events: number }> = [];
  const outcomes = ['success', 'retryable', 'retryable', 'deterministic', 'retryable', 'success'];
  const store = new SnipingStore(createBridge({
    requestShadowSimulation: async (input) => {
      requests.push({ request_id: input.request_id, max_events: input.shadow_policy.max_events });
      const outcome = outcomes.shift();
      if (outcome === 'retryable' || outcome === 'deterministic') {
        return {
          ok: false,
          error: {
            code: outcome === 'retryable' ? 'SNIPING_CORE_UNAVAILABLE' : 'SNIPING_REQUEST_INVALID',
            message: 'sanitized',
            status: outcome === 'retryable' ? null : 400,
            retryable: outcome === 'retryable',
          },
        };
      }
      return ok({
        ...simulation(input.request_id, input.config_id, input.expected_revision, 'shadow'),
        shadow_policy: input.shadow_policy,
      });
    },
  }));
  await store.initialize();
  await store.selectConfig('1');
  store.setShadowPolicyField('maxEvents', '2');
  store.setShadowPolicyField('checkpointBlocks', '1, 3, 8');
  store.setShadowPolicyField('evidenceTtlSeconds', '60');

  await store.requestNewShadow();
  const terminalId = requests[0]?.request_id;
  assert.equal(store.shadowRetryAvailable, false);

  await store.requestNewShadow();
  const uncertainId = requests[1]?.request_id;
  assert.notEqual(uncertainId, terminalId);
  assert.equal(store.shadowRetryAvailable, true);
  await store.retryShadow();
  assert.equal(requests[2]?.request_id, uncertainId);
  assert.equal(store.shadowRetryAvailable, true);

  await store.retryShadow();
  assert.equal(requests[3]?.request_id, uncertainId);
  assert.equal(store.shadowRetryAvailable, false);

  await store.requestNewShadow();
  const changedPolicyId = requests[4]?.request_id;
  assert.notEqual(changedPolicyId, uncertainId);
  assert.equal(store.shadowRetryAvailable, true);

  store.setShadowPolicyField('maxEvents', '3');
  assert.equal(store.shadowRetryAvailable, false);
  await store.retryShadow();
  assert.equal(requests.length, 5);

  await store.requestNewShadow();
  assert.notEqual(requests[5]?.request_id, changedPolicyId);
  assert.equal(requests[5]?.max_events, 3);
  assert.equal(store.shadowRetryAvailable, false);
});

test('Activity filter changes clear the cursor and fence a late prior page', async () => {
  const oldCursor = { created_at: '2026-08-14T00:00:00.000Z', activity_id: 'old' };
  const newCursor = { created_at: '2026-08-14T00:01:00.000Z', activity_id: 'new' };
  const staleMore = deferred<SnipingBridgeResult<SnipingActivityListResult>>();
  const calls: SnipingActivityListInput[] = [];
  const store = new SnipingStore(createBridge({
    listActivity: async (input = {}) => {
      calls.push(input);
      if (input.cursor) return await staleMore.promise;
      if (input.product === 'shadow') return ok({ list: [activity('new', 'shadow')], next_cursor: newCursor });
      return ok({ list: [activity('old', 'monitor')], next_cursor: oldCursor });
    },
  }));
  await store.refreshActivity();
  store.selectActivity(store.activity[0] ?? null);
  const oldLoad = store.loadMoreActivity();
  await store.setActivityFilter({ product: 'shadow', search: '  GME  ' });
  staleMore.resolve(ok({ list: [activity('stale-more', 'monitor')], next_cursor: null }));
  await oldLoad;

  assert.deepEqual(store.activity.map((row) => row.activity_id), ['new']);
  assert.deepEqual(store.activityCursor, newCursor);
  assert.equal(store.selectedActivity, null);
  assert.equal(store.activityLoading, false);
  assert.equal(calls.at(-1)?.cursor, undefined);
  assert.equal(calls.at(-1)?.product, 'shadow');
  assert.equal(calls.at(-1)?.search_text, 'GME');
});

test('same-filter Activity refresh retains stale rows when Core is unavailable', async () => {
  let unavailable = false;
  const store = new SnipingStore(createBridge({
    listActivity: async () => unavailable
      ? failure('ACTIVITY_UNAVAILABLE')
      : ok({ list: [activity('retained', 'monitor')], next_cursor: null }),
  }));
  await store.refreshActivity();
  store.selectActivity(store.activity[0] ?? null);
  unavailable = true;
  await store.refreshActivity();
  assert.deepEqual(store.activity.map((row) => row.activity_id), ['retained']);
  assert.equal(store.selectedActivity?.activity_id, 'retained');
  assert.equal(store.activityErrorCode, 'ACTIVITY_UNAVAILABLE');
});

test('config, event, exact and shadow pagination remain independent 1-based state', async () => {
  const pages = { configs: [] as number[], events: [] as number[], exact: [] as number[], shadow: [] as number[] };
  const store = new SnipingStore(createBridge({
    listConfigs: async (input) => { pages.configs.push(input?.page ?? 1); return ok(page([])); },
    listSimulationEvents: async (input) => { pages.events.push(input.page ?? 1); return ok(page([])); },
    listExactSimulations: async (input) => { pages.exact.push(input.page ?? 1); return ok(page([])); },
    listShadowSimulations: async (input) => { pages.shadow.push(input.page ?? 1); return ok(page([])); },
  }));
  await store.initialize();
  await store.selectConfig('1');
  await Promise.all([
    store.setConfigPage(2), store.setEventPage(3), store.setExactPage(4), store.setShadowPage(5),
  ]);
  assert.deepEqual(
    [store.configPage, store.eventPage, store.exactPage, store.shadowPage],
    [2, 3, 4, 5],
  );
  assert.equal(pages.configs.at(-1), 2);
  assert.equal(pages.events.at(-1), 3);
  assert.equal(pages.exact.includes(4), true);
  assert.equal(pages.shadow.includes(5), true);
  assert.equal(pages.exact.at(-1), 1);
  assert.equal(pages.shadow.at(-1), 1);
});

test('partial simulation refresh preserves one failed surface despite later peer successes', async () => {
  let exactFails = true;
  const store = new SnipingStore(createBridge({
    listSimulationEvents: async () => ok(page([])),
    listExactSimulations: async () => exactFails
      ? failure('EXACT_HISTORY_UNAVAILABLE')
      : ok(page([])),
    listShadowSimulations: async () => ok(page([])),
    listRuntimes: async ({ config_id }) => ok({
      config_id: config_id, desired_state: 'disabled', list: [runtime('standby')],
    }),
  }));
  await store.initialize();
  await store.selectConfig('1');
  assert.equal(store.surfaceErrors.exact, 'EXACT_HISTORY_UNAVAILABLE');
  assert.equal(store.surfaceErrors.events, undefined);
  assert.equal(store.surfaceErrors.shadow, undefined);
  assert.equal(store.surfaceErrors.runtime, undefined);
  assert.equal(store.currentErrorCode, 'EXACT_HISTORY_UNAVAILABLE');

  await Promise.all([store.refreshEvents(), store.refreshShadowRuns(), store.refreshRuntimes()]);
  assert.equal(store.surfaceErrors.exact, 'EXACT_HISTORY_UNAVAILABLE');
  assert.equal(store.currentErrorCode, 'EXACT_HISTORY_UNAVAILABLE');

  exactFails = false;
  await store.refreshExactRuns();
  assert.equal(store.surfaceErrors.exact, undefined);
  assert.equal(store.currentErrorCode, null);
});
