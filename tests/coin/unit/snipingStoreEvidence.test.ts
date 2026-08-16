import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  SnipingBridge,
  SnipingBridgeResult,
  SnipingConfigDetail,
  SnipingPage,
  SnipingReleaseProjection,
  SnipingSimulationReport,
  SnipingSimulationRequestProjection,
} from '../../../src/shared/sniping/snipingBridge.type';
import { SnipingStore } from '../../../src/renderer/coin/src/views/sniping/sniping.store';
import {
  buildSnipingEvidenceStages,
  simulationProjectionMatchesDetail,
} from '../../../src/renderer/coin/src/views/sniping/snipingEvidence.service';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
});

const ok = <T>(value: T): SnipingBridgeResult<T> => ({ ok: true, value });
const page = <T>(list: T[], currentPage = 1): SnipingPage<T> => ({
  list, total: list.length, page: currentPage, page_size: 20,
});
const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void } => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};

const RELEASE: SnipingReleaseProjection = {
  component_id: 'flap-quote-token-snipe', component_version: '1.0.0', schema_hash: 'schema-v1',
  title: 'Flap', description: 'Flap', mode: 'monitor-only', trigger_family: 'chain-event',
  available: true, chains: ['bsc'], required_capabilities: [], secret_slots: [],
  config_schema: {
    type: 'object',
    properties: { quote_token_address: { type: 'string', minLength: 42, maxLength: 42 } },
    required: ['quote_token_address'], unevaluatedProperties: false,
  },
  ui_schema: {
    schema: 'bl-sniping-ui-hints-v1', groups: [{ id: 'target', label: 'Target', order: 1 }],
    fields: { quote_token_address: {
      group: 'target', label: 'Quote token', order: 1, unit: null,
      derived: false, read_only: false, advanced_only: false,
    } },
  },
  default_config: { quote_token_address: '0x1111111111111111111111111111111111111111' },
};

const detail = (componentId = RELEASE.component_id): SnipingConfigDetail => ({
  config_id: '1', name: 'SPCX test', component_id: componentId,
  component_version: RELEASE.component_version, schema_hash: RELEASE.schema_hash,
  release_available: true, chain: 'bsc', config_revision: 1, desired_state: 'disabled',
  primary_region: 'sg', standby_region: 'jp', updated_at: '2026-08-14T00:00:00.000Z',
  config: RELEASE.default_config, credential_status: [], runtimes: [],
});

const simulation = (
  requestId: string,
  kind: 'exact' | 'shadow',
): SnipingSimulationRequestProjection => ({
  request_id: requestId, config_id: '1', config_revision: 1, kind,
  canonical_event_key: kind === 'exact' ? 'event-1' : null,
  shadow_policy: kind === 'shadow'
    ? { max_events: 2, checkpoint_blocks: [1, 2], evidence_ttl_seconds: 60 }
    : null,
  state: 'completed', attempt_count: 0, accepted_attempt_number: null,
  evidence_expires_at: '2026-08-14T01:00:00.000Z', evidence_expired: false,
  ...(kind === 'shadow' ? { position_count: 0, positions: [] } : {}),
  attempts: [], created_at: '2026-08-14T00:00:00.000Z', updated_at: '2026-08-14T00:00:00.000Z',
});

const reportedSimulation = (
  kind: 'exact' | 'shadow',
  identity: Partial<SnipingSimulationReport['identity']> = {},
  componentId = RELEASE.component_id,
): SnipingSimulationRequestProjection => {
  const run = simulation(`${kind}-reported`, kind);
  const report: SnipingSimulationReport = {
    schema: 'bl-sniping-simulation-report-v1', evidence_class: 'SIMULATED', kind,
    identity: {
      config_id: '1', config_revision: 1, component_id: componentId,
      component_version: RELEASE.component_version, schema_hash: RELEASE.schema_hash,
      chain: 'bsc', event: null, sender_address: '0x1111111111111111111111111111111111111111',
      simulator_build_version: '1.0.0', config_fingerprint: 'a'.repeat(64),
      build_fingerprint: 'b'.repeat(64), protocol_fingerprint: 'c'.repeat(64),
      call_policy_hash: 'd'.repeat(64), request_fingerprint: 'e'.repeat(64), ...identity,
    },
    result: {
      outcome: 'blocked', reason_code: 'SIMULATION_BLOCKED', expected_output_atomic: null,
      minimum_output_atomic: null, estimated_gas: null, balance_ready: null,
      allowance_ready: null, virtual_gross_atomic: null, virtual_net_atomic: null,
    },
    checkpoint_count: 0,
    product_evidence: componentId === RELEASE.component_id
      ? { schema: 'bl-sniping-flap-product-evidence-v1' }
      : null,
  };
  return {
    ...run, attempt_count: 1, accepted_attempt_number: 1,
    attempts: [{
      attempt_number: 1, state: 'blocked', outcome: 'blocked', reason_code: 'SIMULATION_BLOCKED',
      report, expires_at: '2026-08-14T01:00:00.000Z', created_at: '2026-08-14T00:00:00.000Z',
    }],
  };
};

const createBridge = (overrides: Partial<SnipingBridge> = {}): SnipingBridge => ({
  listComponents: async () => ok([RELEASE]),
  listConfigs: async () => ok(page([{ ...detail(), config: undefined, credential_status: undefined, runtimes: undefined }] as never[])),
  getConfig: async () => ok(detail()),
  validateConfig: async () => ok({ valid: true, schema_hash: RELEASE.schema_hash, normalized_config_hash: 'hash' }),
  saveConfig: async () => ok(detail()), startMonitoring: async () => ok(detail()),
  stopMonitoring: async () => ok(detail()),
  listRuntimes: async () => ok({ config_id: '1', desired_state: 'disabled', list: [] }),
  listSimulationEvents: async () => ok(page([])),
  requestExactSimulation: async () => ok(simulation('request-exact', 'exact')),
  listExactSimulations: async () => ok(page([])),
  requestShadowSimulation: async () => ok(simulation('request-shadow', 'shadow')),
  listShadowSimulations: async () => ok(page([])),
  listActivity: async () => ok({ list: [], next_cursor: null }),
  ...overrides,
});

test('history pagination never replaces independently fetched latest exact or Shadow evidence', async () => {
  const exactLatest = reportedSimulation('exact');
  const shadowLatest = reportedSimulation('shadow');
  const exactOld = simulation('exact-old-page', 'exact');
  const shadowOld = simulation('shadow-old-page', 'shadow');
  const calls: Array<[string, number, number]> = [];
  const store = new SnipingStore(createBridge({
    listExactSimulations: async (input) => {
      calls.push(['exact', input.page ?? 1, input.page_size ?? 20]);
      return ok(page(input.page_size === 1 ? [exactLatest] : input.page === 2 ? [exactOld] : [exactLatest], input.page));
    },
    listShadowSimulations: async (input) => {
      calls.push(['shadow', input.page ?? 1, input.page_size ?? 20]);
      return ok(page(input.page_size === 1 ? [shadowLatest] : input.page === 2 ? [shadowOld] : [shadowLatest], input.page));
    },
  }));
  await store.initialize(); await store.selectConfig('1');
  await store.setExactPage(2); await store.setShadowPage(2);
  assert.deepEqual([
    store.exactRuns[0]?.request_id, store.shadowRuns[0]?.request_id,
    store.latestExactRun?.request_id, store.latestShadowRun?.request_id,
  ], [exactOld.request_id, shadowOld.request_id, exactLatest.request_id, shadowLatest.request_id]);
  assert.deepEqual(calls.slice(-4), [
    ['exact', 2, 20], ['exact', 1, 1], ['shadow', 2, 20], ['shadow', 1, 1],
  ]);
});

test('late latest-evidence responses cannot overwrite a newer page-one identity', async () => {
  const oldLatest = deferred<SnipingBridgeResult<SnipingPage<SnipingSimulationRequestProjection>>>();
  const newLatest = reportedSimulation('exact', { request_fingerprint: 'f'.repeat(64) });
  let racing = false; let latestCalls = 0;
  const store = new SnipingStore(createBridge({ listExactSimulations: async (input) => {
    if (!racing || input.page_size !== 1) return ok(page([]));
    latestCalls += 1;
    return latestCalls === 1 ? await oldLatest.promise : ok(page([newLatest]));
  } }));
  await store.initialize(); await store.selectConfig('1'); racing = true;
  const stale = store.refreshExactRuns(); await store.refreshExactRuns();
  oldLatest.resolve(ok(page([reportedSimulation('exact')]))); await stale;
  assert.equal(store.latestExactRun?.attempts[0]?.report?.identity.request_fingerprint, 'f'.repeat(64));
});

test('simulation evidence requires every report identity dimension to match selected detail', () => {
  const selected = detail();
  const mismatches: Array<Partial<SnipingSimulationReport['identity']>> = [
    { config_id: '2' }, { config_revision: 2 }, { component_id: 'other-component' },
    { component_version: '2.0.0' }, { schema_hash: 'other-schema' }, { chain: 'eth' as never },
  ];
  assert.equal(simulationProjectionMatchesDetail(reportedSimulation('exact'), selected, 'exact'), true);
  for (const mismatch of mismatches) {
    assert.equal(simulationProjectionMatchesDetail(reportedSimulation('exact', mismatch), selected, 'exact'), false);
  }
  assert.equal(simulationProjectionMatchesDetail({
    ...reportedSimulation('exact'), config_id: '2',
  }, selected, 'exact'), false);
  assert.equal(simulationProjectionMatchesDetail({
    ...reportedSimulation('exact'), config_revision: 2,
  }, selected, 'exact'), false);
  const otherDetail = {
    ...selected, component_id: 'other-component', component_version: '9.0.0', schema_hash: 'other-schema',
  };
  const lying = reportedSimulation('exact', {
    component_id: 'other-component', component_version: '9.0.0', schema_hash: 'other-schema',
  }, 'other-component');
  const report = lying.attempts[0]?.report;
  if (!report) assert.fail('reported fixture required');
  report.product_evidence = { schema: 'bl-sniping-flap-product-evidence-v1' };
  assert.equal(simulationProjectionMatchesDetail(lying, otherDetail, 'exact'), false);
});

test('mismatched history/latest/request evidence retains prior safe scoped projections', async () => {
  const safe = reportedSimulation('exact');
  const mismatch = reportedSimulation('exact', { schema_hash: 'other-schema' });
  let corrupt = false;
  const store = new SnipingStore(createBridge({
    listExactSimulations: async () => ok(page([corrupt ? mismatch : safe])),
    requestExactSimulation: async () => ok(mismatch),
  }));
  await store.initialize(); await store.selectConfig('1'); corrupt = true;
  await store.refreshExactRuns();
  assert.equal(store.surfaceErrors.exact, 'SNIPING_RESPONSE_INTEGRITY');
  assert.equal(store.latestExactRun?.request_id, safe.request_id);
  assert.equal(store.exactRuns[0]?.request_id, safe.request_id);
  store.events = [{
    canonical_event_key: 'event-1', token_address: '0x2222222222222222222222222222222222222222',
    quote_token_address: '0x1111111111111111111111111111111111111111', block_number: '1',
    block_hash: `0x${'a'.repeat(64)}`, observed_at: '2026-08-14T00:00:00.000Z',
    finalized_at: '2026-08-14T00:00:01.000Z',
  }];
  store.selectEvent('event-1'); await store.requestExact();
  assert.equal(store.surfaceErrors.exact, 'SNIPING_RESPONSE_INTEGRITY');
  assert.equal(store.exactRuns[0]?.request_id, safe.request_id);
});

test('evidence-stage workflow derivation is pure and based only on latest inputs', () => {
  const stages = buildSnipingEvidenceStages({
    runtimeState: 'active', canonicalSelected: true,
    exact: reportedSimulation('exact'), shadow: reportedSimulation('shadow'),
  });
  assert.deepEqual(stages.map((stage) => [stage.key, stage.state, stage.detail]), [
    ['signal', 'ready', 'observerActive'], ['canonical', 'ready', 'selectedCanonical'],
    ['request', 'ready', 'completed'], ['exact', 'blocked', 'SIMULATION_BLOCKED'],
    ['shadow', 'blocked', 'positionCount'],
  ]);
});
