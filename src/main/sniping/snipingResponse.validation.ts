import type {
  SnipingActivityListResult,
  SnipingActivityOutcome,
  SnipingActivityProduct,
  SnipingActivityRow,
  SnipingChain,
  SnipingConfigDetail,
  SnipingConfigSummary,
  SnipingDesiredState,
  SnipingJsonObject,
  SnipingJsonValue,
  SnipingObservedState,
  SnipingPage,
  SnipingRegion,
  SnipingReleaseProjection,
  SnipingRuntimeListResult,
  SnipingRuntimeProjection,
  SnipingShadowPosition,
  SnipingSimulationAttempt,
  SnipingSimulationEvent,
  SnipingSimulationOutcome,
  SnipingSimulationReport,
  SnipingSimulationRequestProjection,
  SnipingValidationReceipt,
} from '@shared/sniping/snipingBridge.type';
import { parseSafeSnipingProjectionJsonObject } from './snipingRequest.validation';

const CHAINS = new Set<SnipingChain>(['bsc', 'ethereum', 'base', 'arbitrum', 'solana']);
const REGIONS = new Set<SnipingRegion>(['sg', 'jp', 'local']);
const DESIRED = new Set<SnipingDesiredState>(['disabled', 'armed']);
const OBSERVED = new Set<SnipingObservedState>([
  'offline', 'standby', 'active', 'degraded', 'paused', 'expired', 'error',
]);
const SIMULATION_OUTCOMES = new Set<SnipingSimulationOutcome>(['executable', 'blocked', 'unknown', 'duplicate']);
const ACTIVITY_PRODUCTS = new Set<SnipingActivityProduct>(['monitor', 'exact', 'shadow']);
const ACTIVITY_OUTCOMES = new Set<SnipingActivityOutcome>([
  'hit', 'filtered', 'blocked', 'failed', 'executable', 'unknown', 'duplicate', 'claimed', 'expired', 'retryable',
]);
const CONFIG_ID = /^[1-9]\d{0,18}$/;
const COMPONENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEMVER_IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)` +
  `(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?` +
  '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);
const HASH = /^[0-9a-f]{64}$/;
const EVM_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const REASON = /^[A-Z][A-Z0-9_]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_KEY = /^bsc:56:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(0|[1-9]\d{0,9})$/;
const ACTIVITY_ID = /^(?:monitor|exact|shadow):[0-9]{20}$/;
const UNSIGNED = /^(0|[1-9]\d{0,77})$/;
const SIGNED = /^-?(0|[1-9]\d{0,77})$/;

export class SnipingResponseError extends Error {
  readonly code = 'SNIPING_RESPONSE_INVALID';
}

const object = (value: unknown, keys?: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SnipingResponseError();
  const row = value as Record<string, unknown>;
  if (keys) {
    const actual = Object.keys(row).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new SnipingResponseError();
    }
  }
  return row;
};

const text = (value: unknown, maximum = 256, pattern?: RegExp): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) {
    throw new SnipingResponseError();
  }
  return value;
};

const nullableText = (value: unknown, maximum = 256, pattern?: RegExp): string | null =>
  value === null ? null : text(value, maximum, pattern);

const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new SnipingResponseError();
  }
  return Number(value);
};

const nullableInteger = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null =>
  value === null ? null : integer(value, minimum, maximum);

const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new SnipingResponseError();
  return value;
};

const nullableBool = (value: unknown): boolean | null => value === null ? null : bool(value);

const projection = (value: unknown): SnipingJsonObject => {
  try {
    return parseSafeSnipingProjectionJsonObject(value);
  } catch {
    throw new SnipingResponseError();
  }
};

const date = (value: unknown): string => {
  const result = text(value, 24);
  let canonical: string;
  try {
    canonical = new Date(result).toISOString();
  } catch {
    throw new SnipingResponseError();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || canonical !== result) {
    throw new SnipingResponseError();
  }
  return result;
};

const nullableDate = (value: unknown): string | null => value === null ? null : date(value);

const stringArray = (value: unknown, maximum = 64): string[] => {
  if (!Array.isArray(value) || value.length > maximum) throw new SnipingResponseError();
  const result = value.map((item) => text(item, 128));
  if (new Set(result).size !== result.length) throw new SnipingResponseError();
  return result;
};

const chain = (value: unknown): SnipingChain => {
  if (!CHAINS.has(value as SnipingChain)) throw new SnipingResponseError();
  return value as SnipingChain;
};

const region = (value: unknown): SnipingRegion => {
  if (!REGIONS.has(value as SnipingRegion)) throw new SnipingResponseError();
  return value as SnipingRegion;
};

const reason = (value: unknown): string => text(value, 128, REASON);

const flapProductEvidence = (value: SnipingJsonObject): SnipingJsonObject => {
  if (value.schema !== 'bl-sniping-flap-product-evidence-v1') return value;
  const keys = [
    'schema', 'scope', 'token_address', 'quote_token_address', 'spend_amount_decimal',
    'declared_quote_token_decimals', 'spend_amount_atomic', 'quote_token_code_ready',
    'quote_token_decimals_ready', 'quote_balance_atomic', 'balance_ready', 'allowance_atomic',
    'allowance_ready', 'native_balance_wei', 'gas_cost_ready', 'estimated_gas_units',
    'max_gas_units', 'gas_units_ready', 'portal_state_ready', 'quoted_output_atomic',
    'minimum_output_atomic', 'simulated_output_atomic', 'permit_policy', 'quote_unit', 'gas_unit',
    'cohort_counts',
  ];
  object(value, keys);
  const nullableUnsigned = (item: unknown): void => {
    if (item !== null) text(item, 78, UNSIGNED);
  };
  const nullableBoolean = (item: unknown): void => { if (item !== null) bool(item); };
  if (!['entry', 'checkpoint', 'shadow'].includes(String(value.scope))) throw new SnipingResponseError();
  if (value.token_address !== null) text(value.token_address, 42, ADDRESS);
  text(value.quote_token_address, 42, ADDRESS);
  text(value.spend_amount_decimal, 78, /^(0|[1-9]\d*)(?:\.\d+)?$/);
  integer(value.declared_quote_token_decimals, 0, 36);
  for (const key of [
    'spend_amount_atomic', 'max_gas_units',
  ]) text(value[key], 78, UNSIGNED);
  for (const key of [
    'quote_balance_atomic', 'allowance_atomic', 'native_balance_wei', 'estimated_gas_units',
    'quoted_output_atomic', 'minimum_output_atomic', 'simulated_output_atomic',
  ]) nullableUnsigned(value[key]);
  for (const key of [
    'quote_token_code_ready', 'quote_token_decimals_ready', 'balance_ready', 'allowance_ready',
    'gas_cost_ready', 'gas_units_ready', 'portal_state_ready',
  ]) nullableBoolean(value[key]);
  if (value.permit_policy !== 'empty-bytes-v1' || value.quote_unit !== 'quote-token-atomic' ||
      value.gas_unit !== 'native-wei') throw new SnipingResponseError();
  if (value.cohort_counts !== null) {
    const counts = object(value.cohort_counts, ['hit', 'executable', 'blocked', 'unknown', 'duplicate']);
    for (const count of Object.values(counts)) integer(count, 0, 500);
  }
  if (
    (value.scope === 'shadow') !== (value.cohort_counts !== null) ||
    (value.scope === 'shadow') !== (value.token_address === null)
  ) throw new SnipingResponseError();
  return value;
};

const configSummary = (value: unknown): SnipingConfigSummary => {
  const row = object(value, [
    'config_id', 'name', 'component_id', 'component_version', 'schema_hash', 'release_available',
    'chain', 'config_revision', 'desired_state', 'primary_region', 'standby_region', 'updated_at',
  ]);
  if (!DESIRED.has(row.desired_state as SnipingDesiredState)) throw new SnipingResponseError();
  return {
    config_id: text(row.config_id, 19, CONFIG_ID),
    name: text(row.name, 128),
    component_id: text(row.component_id, 64, COMPONENT),
    component_version: text(row.component_version, 64, SEMVER),
    schema_hash: text(row.schema_hash, 64, HASH),
    release_available: bool(row.release_available),
    chain: chain(row.chain),
    config_revision: integer(row.config_revision, 1, 2_147_483_647),
    desired_state: row.desired_state as SnipingDesiredState,
    primary_region: region(row.primary_region),
    standby_region: region(row.standby_region),
    updated_at: date(row.updated_at),
  };
};

const runtime = (value: unknown): SnipingRuntimeProjection => {
  const row = object(value, [
    'region', 'desired_state', 'observed_state', 'cursor_summary', 'lag_ms', 'last_error_code', 'heartbeat_at',
  ]);
  if (!DESIRED.has(row.desired_state as SnipingDesiredState) ||
      !OBSERVED.has(row.observed_state as SnipingObservedState)) throw new SnipingResponseError();
  return {
    region: region(row.region),
    desired_state: row.desired_state as SnipingDesiredState,
    observed_state: row.observed_state as SnipingObservedState,
    cursor_summary: row.cursor_summary === null ? null : projection(row.cursor_summary),
    lag_ms: nullableInteger(row.lag_ms),
    last_error_code: row.last_error_code === null ? null : reason(row.last_error_code),
    heartbeat_at: nullableDate(row.heartbeat_at),
  };
};

export const parseSnipingComponentsResponse = (value: unknown): SnipingReleaseProjection[] => {
  if (!Array.isArray(value) || value.length > 128) throw new SnipingResponseError();
  return value.map((item) => {
    const row = object(item, [
      'component_id', 'component_version', 'schema_hash', 'title', 'description', 'mode',
      'trigger_family', 'available', 'chains', 'required_capabilities', 'config_schema', 'ui_schema',
      'default_config', 'secret_slots',
    ]);
    if (row.mode !== 'monitor-only' || !Array.isArray(row.chains) || row.chains.length < 1) {
      throw new SnipingResponseError();
    }
    return {
      component_id: text(row.component_id, 64, COMPONENT),
      component_version: text(row.component_version, 64, SEMVER),
      schema_hash: text(row.schema_hash, 64, HASH),
      title: text(row.title, 128),
      description: text(row.description, 1024),
      mode: 'monitor-only',
      trigger_family: text(row.trigger_family, 64, COMPONENT),
      available: bool(row.available),
      chains: row.chains.map(chain),
      required_capabilities: stringArray(row.required_capabilities),
      config_schema: projection(row.config_schema),
      ui_schema: projection(row.ui_schema),
      default_config: projection(row.default_config),
      secret_slots: stringArray(row.secret_slots),
    };
  });
};

const page = <T>(value: unknown, parseItem: (item: unknown) => T): SnipingPage<T> => {
  const row = object(value, ['list', 'total', 'page', 'page_size']);
  if (!Array.isArray(row.list) || row.list.length > 100) throw new SnipingResponseError();
  return {
    list: row.list.map(parseItem),
    total: integer(row.total),
    page: integer(row.page, 1, 1_000_000),
    page_size: integer(row.page_size, 1, 100),
  };
};

export const parseSnipingConfigListResponse = (value: unknown): SnipingPage<SnipingConfigSummary> =>
  page(value, configSummary);

export const parseSnipingConfigDetailResponse = (value: unknown): SnipingConfigDetail => {
  const row = object(value);
  const summary = configSummary(Object.fromEntries(Object.entries(row).filter(([key]) => ![
    'config', 'credential_status', 'runtimes',
  ].includes(key))));
  if (!Array.isArray(row.credential_status) || row.credential_status.length > 64 ||
      !Array.isArray(row.runtimes) || row.runtimes.length > 3) throw new SnipingResponseError();
  return {
    ...summary,
    config: projection(row.config),
    credential_status: row.credential_status.map((item) => {
      const status = object(item, ['slot', 'configured']);
      return { slot: text(status.slot, 64, COMPONENT), configured: bool(status.configured) };
    }),
    runtimes: row.runtimes.map(runtime),
  };
};

export const parseSnipingValidationResponse = (value: unknown): SnipingValidationReceipt => {
  const row = object(value, ['valid', 'schema_hash', 'normalized_config_hash']);
  if (row.valid !== true) throw new SnipingResponseError();
  return {
    valid: true,
    schema_hash: text(row.schema_hash, 64, HASH),
    normalized_config_hash: text(row.normalized_config_hash, 64, HASH),
  };
};

export const parseSnipingRuntimeListResponse = (value: unknown): SnipingRuntimeListResult => {
  const row = object(value, ['config_id', 'desired_state', 'list']);
  if (!DESIRED.has(row.desired_state as SnipingDesiredState) || !Array.isArray(row.list) || row.list.length > 3) {
    throw new SnipingResponseError();
  }
  return {
    config_id: text(row.config_id, 19, CONFIG_ID),
    desired_state: row.desired_state as SnipingDesiredState,
    list: row.list.map(runtime),
  };
};

const simulationEvent = (value: unknown): SnipingSimulationEvent => {
  const row = object(value, [
    'canonical_event_key', 'token_address', 'quote_token_address', 'block_number', 'block_hash',
    'observed_at', 'finalized_at',
  ]);
  const observed = date(row.observed_at);
  const finalized = date(row.finalized_at);
  if (observed > finalized) throw new SnipingResponseError();
  return {
    canonical_event_key: text(row.canonical_event_key, 256, EVENT_KEY),
    token_address: text(row.token_address, 42, ADDRESS),
    quote_token_address: text(row.quote_token_address, 42, ADDRESS),
    block_number: text(row.block_number, 30, UNSIGNED),
    block_hash: text(row.block_hash, 66, EVM_HASH),
    observed_at: observed,
    finalized_at: finalized,
  };
};

export const parseSnipingSimulationEventListResponse = (value: unknown): SnipingPage<SnipingSimulationEvent> =>
  page(value, simulationEvent);

const simulationReport = (value: unknown): SnipingSimulationReport => {
  const row = object(value, ['schema', 'evidence_class', 'kind', 'identity', 'result', 'checkpoint_count', 'product_evidence']);
  if (row.schema !== 'bl-sniping-simulation-report-v1' || row.evidence_class !== 'SIMULATED' ||
      (row.kind !== 'exact' && row.kind !== 'shadow')) throw new SnipingResponseError();
  const identity = object(row.identity, [
    'config_id', 'config_revision', 'component_id', 'component_version', 'schema_hash', 'chain', 'event',
    'sender_address', 'simulator_build_version', 'config_fingerprint', 'build_fingerprint',
    'protocol_fingerprint', 'call_policy_hash', 'request_fingerprint',
  ]);
  const result = object(row.result, [
    'outcome', 'reason_code', 'expected_output_atomic', 'minimum_output_atomic', 'estimated_gas',
    'balance_ready', 'allowance_ready', 'virtual_gross_atomic', 'virtual_net_atomic',
  ]);
  if (identity.chain !== 'bsc' || !SIMULATION_OUTCOMES.has(result.outcome as SnipingSimulationOutcome) ||
      result.outcome === 'duplicate') throw new SnipingResponseError();
  const productEvidence = row.product_evidence === null
    ? null
    : flapProductEvidence(projection(row.product_evidence));
  if (
    productEvidence?.schema === 'bl-sniping-flap-product-evidence-v1' &&
    ((row.kind === 'exact' && productEvidence.scope !== 'entry') ||
      (row.kind === 'shadow' && productEvidence.scope !== 'shadow'))
  ) throw new SnipingResponseError();
  return {
    schema: 'bl-sniping-simulation-report-v1',
    evidence_class: 'SIMULATED',
    kind: row.kind,
    identity: {
      config_id: text(identity.config_id, 19, CONFIG_ID),
      config_revision: integer(identity.config_revision, 1, 2_147_483_647),
      component_id: text(identity.component_id, 64, COMPONENT),
      component_version: text(identity.component_version, 64, SEMVER),
      schema_hash: text(identity.schema_hash, 64, HASH),
      chain: 'bsc',
      event: identity.event === null ? null : projection(identity.event),
      sender_address: text(identity.sender_address, 42, ADDRESS),
      simulator_build_version: nullableText(identity.simulator_build_version, 64, SEMVER),
      config_fingerprint: text(identity.config_fingerprint, 64, HASH),
      build_fingerprint: text(identity.build_fingerprint, 64, HASH),
      protocol_fingerprint: text(identity.protocol_fingerprint, 64, HASH),
      call_policy_hash: text(identity.call_policy_hash, 64, HASH),
      request_fingerprint: text(identity.request_fingerprint, 64, HASH),
    },
    result: {
      outcome: result.outcome as Exclude<SnipingSimulationOutcome, 'duplicate'>,
      reason_code: reason(result.reason_code),
      expected_output_atomic: nullableText(result.expected_output_atomic, 78, UNSIGNED),
      minimum_output_atomic: nullableText(result.minimum_output_atomic, 78, UNSIGNED),
      estimated_gas: nullableText(result.estimated_gas, 78, UNSIGNED),
      balance_ready: nullableBool(result.balance_ready),
      allowance_ready: nullableBool(result.allowance_ready),
      virtual_gross_atomic: nullableText(result.virtual_gross_atomic, 78, UNSIGNED),
      virtual_net_atomic: nullableText(result.virtual_net_atomic, 79, SIGNED),
    },
    checkpoint_count: integer(row.checkpoint_count, 0, 8),
    product_evidence: productEvidence,
  };
};

const simulationAttempt = (value: unknown): SnipingSimulationAttempt => {
  const row = object(value, ['attempt_number', 'state', 'outcome', 'reason_code', 'report', 'expires_at', 'created_at']);
  const states = ['claimed', 'expired', 'retryable', 'succeeded', 'blocked', 'failed'];
  if (!states.includes(String(row.state)) ||
      (row.outcome !== null && !SIMULATION_OUTCOMES.has(row.outcome as SnipingSimulationOutcome))) {
    throw new SnipingResponseError();
  }
  const state = row.state as SnipingSimulationAttempt['state'];
  const hasReport = row.report !== null;
  if (
    (['claimed', 'expired', 'retryable', 'failed'].includes(state) && (row.outcome !== null || hasReport)) ||
    (state === 'succeeded' && (row.outcome !== 'executable' || !hasReport)) ||
    (state === 'blocked' && (!['blocked', 'unknown'].includes(String(row.outcome)) || !hasReport)) ||
    (hasReport ? row.expires_at === null : row.expires_at !== null)
  ) throw new SnipingResponseError();
  return {
    attempt_number: integer(row.attempt_number, 1, 3),
    state: row.state as SnipingSimulationAttempt['state'],
    outcome: row.outcome as SnipingSimulationOutcome | null,
    reason_code: reason(row.reason_code),
    report: row.report === null ? null : simulationReport(row.report),
    expires_at: nullableDate(row.expires_at),
    created_at: date(row.created_at),
  };
};

const validAttemptLedger = (
  attempts: SnipingSimulationAttempt[],
  attemptCount: number,
  acceptedAttemptNumber: number | null,
  requestState: SnipingSimulationRequestProjection['state'],
  evidenceExpiresAt: string | null,
  evidenceExpired: boolean,
): boolean => {
  if (
    attempts.length > 6 ||
    attempts.some((attempt) => attempt.attempt_number > attemptCount) ||
    attempts.some((attempt, index) => index > 0 &&
      (attempt.attempt_number < attempts[index - 1].attempt_number ||
        attempt.created_at < attempts[index - 1].created_at)) ||
    attempts.some((attempt) =>
      (attempt.state === 'claimed' && attempt.reason_code !== 'SIMULATION_CLAIMED') ||
      (attempt.state === 'expired' && attempt.reason_code !== 'SIMULATION_CLAIM_EXPIRED'))
  ) return false;
  const byNumber = new Map<number, SnipingSimulationAttempt[]>();
  for (const attempt of attempts) {
    const rows = byNumber.get(attempt.attempt_number) ?? [];
    if (rows.some((row) => row.state === attempt.state)) return false;
    rows.push(attempt);
    byNumber.set(attempt.attempt_number, rows);
  }
  if (attemptCount === 0) {
    if (attempts.length !== 0) return false;
  } else if (
    byNumber.size !== attemptCount ||
    [...byNumber.keys()].some((attemptNumber, index) => attemptNumber !== index + 1)
  ) return false;
  const groups = [...byNumber.values()];
  for (const [index, rows] of groups.entries()) {
    const terminal = rows[1];
    if (index < groups.length - 1) {
      if (rows.length !== 2 || rows[0].state !== 'claimed' ||
        !['retryable', 'expired'].includes(terminal.state)) return false;
    } else if (
      rows.length > 2 ||
      (rows.length === 2 && rows[0].state !== 'claimed') ||
      rows.filter((row) => row.state !== 'claimed').length > 1
    ) return false;
  }
  const accepted = acceptedAttemptNumber === null
    ? []
    : attempts.filter((attempt) => attempt.attempt_number === acceptedAttemptNumber && attempt.report !== null);
  const reportRows = attempts.filter((attempt) => attempt.report !== null);
  if (accepted.length !== (acceptedAttemptNumber === null ? 0 : 1) || reportRows.length > 1) return false;
  const latestGroup = groups.at(-1) ?? [];
  const latest = latestGroup.at(-1);
  if (requestState === 'completed') {
    return acceptedAttemptNumber === attemptCount &&
      latestGroup.length === 2 && latestGroup[0].state === 'claimed' &&
      Boolean(latest && ['succeeded', 'blocked'].includes(latest.state) && latest.report !== null) &&
      latest?.attempt_number === acceptedAttemptNumber && latest.expires_at === evidenceExpiresAt &&
      evidenceExpiresAt !== null;
  }
  if (acceptedAttemptNumber !== null || evidenceExpiresAt !== null || evidenceExpired ||
    attempts.some((attempt) => attempt.expires_at !== null)) return false;
  if (requestState === 'claimed') {
    return latestGroup.length === 1 && latest?.attempt_number === attemptCount && latest.state === 'claimed';
  }
  if (requestState === 'pending') {
    return attemptCount === 0 || Boolean(
      attemptCount < 3 && latestGroup.length === 2 && latestGroup[0].state === 'claimed' &&
      latest && ['retryable', 'expired'].includes(latest.state),
    );
  }
  return Boolean(
    latest && (
      latest.state === 'failed' ||
      (attemptCount === 3 && latestGroup.length === 2 && latestGroup[0].state === 'claimed' &&
        latest.state === 'expired')
    ),
  );
};

const shadowPosition = (value: unknown): SnipingShadowPosition => {
  const row = object(value, [
    'canonical_event_key', 'block_number', 'block_hash', 'transaction_hash', 'log_index', 'outcome',
    'reason_code', 'first_action_block_number', 'observation_to_action_ms', 'expected_output_atomic',
    'minimum_output_atomic', 'virtual_gross_atomic', 'virtual_net_atomic', 'request_fingerprint',
    'checkpoints', 'created_at',
  ]);
  if (!SIMULATION_OUTCOMES.has(row.outcome as SnipingSimulationOutcome) || !Array.isArray(row.checkpoints) ||
      row.checkpoints.length > 8) throw new SnipingResponseError();
  let previousBlock = -1n;
  const checkpoints = row.checkpoints.map((checkpoint) => {
    const item = object(projection(checkpoint), [
      'block_number', 'block_hash', 'outcome', 'reason_code', 'expected_output_atomic',
      'minimum_output_atomic', 'virtual_gross_atomic', 'virtual_net_atomic',
    ]);
    const block = BigInt(text(item.block_number, 30, UNSIGNED));
    if (
      block <= previousBlock || block <= BigInt(text(row.block_number, 30, UNSIGNED)) ||
      !SIMULATION_OUTCOMES.has(item.outcome as SnipingSimulationOutcome)
    ) {
      throw new SnipingResponseError();
    }
    previousBlock = block;
    text(item.block_hash, 66, EVM_HASH);
    reason(item.reason_code);
    for (const key of ['expected_output_atomic', 'minimum_output_atomic', 'virtual_gross_atomic']) {
      nullableText(item[key], 78, UNSIGNED);
    }
    nullableText(item.virtual_net_atomic, 79, SIGNED);
    return item as SnipingJsonObject;
  });
  return {
    canonical_event_key: text(row.canonical_event_key, 256, EVENT_KEY),
    block_number: text(row.block_number, 30, UNSIGNED),
    block_hash: text(row.block_hash, 66, EVM_HASH),
    transaction_hash: text(row.transaction_hash, 66, EVM_HASH),
    log_index: integer(row.log_index, 0, 2_147_483_647),
    outcome: row.outcome as SnipingSimulationOutcome,
    reason_code: reason(row.reason_code),
    first_action_block_number: nullableText(row.first_action_block_number, 30, UNSIGNED),
    observation_to_action_ms: nullableText(row.observation_to_action_ms, 30, UNSIGNED),
    expected_output_atomic: nullableText(row.expected_output_atomic, 78, UNSIGNED),
    minimum_output_atomic: nullableText(row.minimum_output_atomic, 78, UNSIGNED),
    virtual_gross_atomic: nullableText(row.virtual_gross_atomic, 78, UNSIGNED),
    virtual_net_atomic: nullableText(row.virtual_net_atomic, 79, SIGNED),
    request_fingerprint: text(row.request_fingerprint, 64, HASH),
    checkpoints,
    created_at: date(row.created_at),
  };
};

export const parseSnipingSimulationRequestResponse = (value: unknown): SnipingSimulationRequestProjection => {
  const row = object(value, [
    'request_id', 'config_id', 'config_revision', 'kind', 'canonical_event_key', 'shadow_policy',
    'state', 'attempt_count', 'accepted_attempt_number', 'evidence_expires_at', 'evidence_expired',
    ...(Object.hasOwn(object(value), 'position_count') ? ['position_count'] : []),
    ...(Object.hasOwn(object(value), 'positions') ? ['positions'] : []),
    'attempts', 'created_at', 'updated_at',
  ]);
  if ((row.kind !== 'exact' && row.kind !== 'shadow') ||
      !['pending', 'claimed', 'completed', 'failed'].includes(String(row.state)) ||
      !Array.isArray(row.attempts) || row.attempts.length > 6 ||
      (row.positions !== undefined && (!Array.isArray(row.positions) || row.positions.length > 500))) {
    throw new SnipingResponseError();
  }
  let policy: SnipingSimulationRequestProjection['shadow_policy'] = null;
  if (row.shadow_policy !== null) {
    const raw = object(row.shadow_policy, ['max_events', 'checkpoint_blocks', 'evidence_ttl_seconds']);
    if (!Array.isArray(raw.checkpoint_blocks)) throw new SnipingResponseError();
    policy = {
      max_events: integer(raw.max_events, 1, 500),
      checkpoint_blocks: raw.checkpoint_blocks.map((item) => integer(item, 1, 100_000)),
      evidence_ttl_seconds: integer(raw.evidence_ttl_seconds, 60, 86_400),
    };
    if (
      policy.checkpoint_blocks.length < 1 || policy.checkpoint_blocks.length > 8 ||
      new Set(policy.checkpoint_blocks).size !== policy.checkpoint_blocks.length ||
      policy.checkpoint_blocks.some((block, index) => index > 0 && block <= policy!.checkpoint_blocks[index - 1])
    ) throw new SnipingResponseError();
  }
  const configId = text(row.config_id, 19, CONFIG_ID);
  const configRevision = integer(row.config_revision, 1, 2_147_483_647);
  const canonicalEventKey = nullableText(row.canonical_event_key, 256, EVENT_KEY);
  const attempts = row.attempts.map(simulationAttempt);
  const attemptCount = integer(row.attempt_count, 0, 3);
  const acceptedAttemptNumber = nullableInteger(row.accepted_attempt_number, 1, 3);
  const evidenceExpiresAt = nullableDate(row.evidence_expires_at);
  const evidenceExpired = bool(row.evidence_expired);
  const positionCount = row.position_count === undefined ? undefined : integer(row.position_count, 0, 500);
  const positions = row.positions === undefined
    ? undefined
    : (row.positions as unknown[]).map(shadowPosition);
  if (
    !validAttemptLedger(
      attempts,
      attemptCount,
      acceptedAttemptNumber,
      row.state as SnipingSimulationRequestProjection['state'],
      evidenceExpiresAt,
      evidenceExpired,
    ) ||
    attempts.some((attempt) => attempt.report && (
      attempt.report.kind !== row.kind || attempt.report.identity.config_id !== configId ||
      attempt.report.identity.config_revision !== configRevision ||
      attempt.outcome !== attempt.report.result.outcome || attempt.reason_code !== attempt.report.result.reason_code
    )) ||
    (row.kind === 'exact' && (
      canonicalEventKey === null || policy !== null || positions !== undefined ||
      (positionCount !== undefined && positionCount !== 0)
    )) ||
    (row.kind === 'shadow' && (
      canonicalEventKey !== null || policy === null || positions === undefined ||
      positionCount === undefined || positionCount !== positions.length
    ))
  ) throw new SnipingResponseError();
  const acceptedReport = acceptedAttemptNumber === null
    ? null
    : attempts.find((attempt) =>
      attempt.attempt_number === acceptedAttemptNumber && attempt.report !== null)?.report ?? null;
  if (attempts.some((attempt) => {
    const report = attempt.report;
    if (!report || report.identity.component_id !== 'flap-quote-token-snipe') return false;
    const evidence = report.product_evidence;
    return evidence?.schema !== 'bl-sniping-flap-product-evidence-v1' ||
      report.result.expected_output_atomic !== evidence.quoted_output_atomic ||
      report.result.minimum_output_atomic !== evidence.minimum_output_atomic ||
      report.result.estimated_gas !== evidence.estimated_gas_units ||
      report.result.balance_ready !== evidence.balance_ready ||
      report.result.allowance_ready !== evidence.allowance_ready;
  })) throw new SnipingResponseError();
  if (acceptedReport?.identity.component_id === 'flap-quote-token-snipe') {
    if (row.kind === 'shadow') {
      if (
        acceptedReport.identity.event !== null ||
        acceptedReport.checkpoint_count !== policy?.checkpoint_blocks.length
      ) throw new SnipingResponseError();
    } else {
      if (acceptedReport.checkpoint_count !== 0) throw new SnipingResponseError();
      const event = object(acceptedReport.identity.event, [
        'chain', 'chain_id', 'portal_address', 'block_number', 'block_hash', 'transaction_hash',
        'log_index', 'event_topic',
      ]);
      if (event.chain !== 'bsc' || event.chain_id !== 56) throw new SnipingResponseError();
      text(event.portal_address, 42, ADDRESS);
      const blockHash = text(event.block_hash, 66, EVM_HASH);
      const transactionHash = text(event.transaction_hash, 66, EVM_HASH);
      text(event.block_number, 30, UNSIGNED);
      const logIndex = integer(event.log_index, 0, 2_147_483_647);
      text(event.event_topic, 66, EVM_HASH);
      if (`bsc:56:${blockHash}:${transactionHash}:${logIndex}` !== canonicalEventKey) {
        throw new SnipingResponseError();
      }
    }
  }
  if (
    positions?.some((position) =>
      acceptedReport === null || position.request_fingerprint !== acceptedReport.identity.request_fingerprint ||
      (acceptedReport.identity.component_id === 'flap-quote-token-snipe' && position.outcome === 'duplicate') ||
      position.canonical_event_key !==
        `bsc:56:${position.block_hash}:${position.transaction_hash}:${position.log_index}` ||
      position.checkpoints.length !== policy?.checkpoint_blocks.length ||
      position.checkpoints.some((checkpoint, index) =>
        BigInt(String(checkpoint.block_number)) !==
          BigInt(position.block_number) + BigInt(policy?.checkpoint_blocks[index] ?? -1))
    )
  ) throw new SnipingResponseError();
  if (positions && new Set(positions.map((position) => position.canonical_event_key)).size !== positions.length) {
    throw new SnipingResponseError();
  }
  const productCounts = acceptedReport?.product_evidence?.cohort_counts;
  if (row.kind === 'shadow' && productCounts && typeof productCounts === 'object' &&
    !Array.isArray(productCounts)) {
    const counts = productCounts as Record<string, SnipingJsonValue>;
    const outcomeCount = (outcome: SnipingSimulationOutcome): number =>
      positions?.filter((position) => position.outcome === outcome).length ?? 0;
    if (
      counts.hit !== positionCount || counts.executable !== outcomeCount('executable') ||
      counts.blocked !== outcomeCount('blocked') || counts.unknown !== outcomeCount('unknown') ||
      outcomeCount('executable') + outcomeCount('blocked') + outcomeCount('unknown') !== positionCount
    ) throw new SnipingResponseError();
  }
  return {
    request_id: text(row.request_id, 128, REQUEST_ID),
    config_id: configId,
    config_revision: configRevision,
    kind: row.kind,
    canonical_event_key: canonicalEventKey,
    shadow_policy: policy,
    state: row.state as SnipingSimulationRequestProjection['state'],
    attempt_count: attemptCount,
    accepted_attempt_number: acceptedAttemptNumber,
    evidence_expires_at: evidenceExpiresAt,
    evidence_expired: evidenceExpired,
    ...(positionCount === undefined ? {} : { position_count: positionCount }),
    ...(positions === undefined ? {} : { positions }),
    attempts,
    created_at: date(row.created_at),
    updated_at: date(row.updated_at),
  };
};

export const parseSnipingSimulationListResponse = (value: unknown): SnipingPage<SnipingSimulationRequestProjection> =>
  page(value, parseSnipingSimulationRequestResponse);

const activityRow = (value: unknown): SnipingActivityRow => {
  const row = object(value, [
    'activity_id', 'product', 'config_id', 'config_name', 'component_id', 'component_version',
    'chain', 'canonical_event_key', 'outcome', 'reason_code', 'token_address', 'quote_token_address',
    'action_class', 'request_id', 'attempt_number', 'attempt_state', 'request_fingerprint',
    'evidence_class', 'created_at',
  ]);
  if (!ACTIVITY_PRODUCTS.has(row.product as SnipingActivityProduct) ||
      !ACTIVITY_OUTCOMES.has(row.outcome as SnipingActivityOutcome) ||
      (row.evidence_class !== null && row.evidence_class !== 'SIMULATED')) throw new SnipingResponseError();
  return {
    activity_id: text(row.activity_id, 28, ACTIVITY_ID),
    product: row.product as SnipingActivityProduct,
    config_id: text(row.config_id, 19, CONFIG_ID),
    config_name: text(row.config_name, 128),
    component_id: text(row.component_id, 64, COMPONENT),
    component_version: text(row.component_version, 64, SEMVER),
    chain: chain(row.chain),
    canonical_event_key: nullableText(row.canonical_event_key, 256),
    outcome: row.outcome as SnipingActivityOutcome,
    reason_code: reason(row.reason_code),
    token_address: nullableText(row.token_address, 42, ADDRESS),
    quote_token_address: nullableText(row.quote_token_address, 42, ADDRESS),
    action_class: nullableText(row.action_class, 64, COMPONENT),
    request_id: nullableText(row.request_id, 128, REQUEST_ID),
    attempt_number: nullableInteger(row.attempt_number, 1, 3),
    attempt_state: nullableText(row.attempt_state, 32, COMPONENT),
    request_fingerprint: nullableText(row.request_fingerprint, 64, HASH),
    evidence_class: row.evidence_class as 'SIMULATED' | null,
    created_at: date(row.created_at),
  };
};

export const parseSnipingActivityResponse = (value: unknown): SnipingActivityListResult => {
  const row = object(value, ['list', 'next_cursor']);
  if (!Array.isArray(row.list) || row.list.length > 100) throw new SnipingResponseError();
  let cursor: SnipingActivityListResult['next_cursor'] = null;
  if (row.next_cursor !== null) {
    const raw = object(row.next_cursor, ['created_at', 'activity_id']);
    cursor = { created_at: date(raw.created_at), activity_id: text(raw.activity_id, 28, ACTIVITY_ID) };
  }
  return { list: row.list.map(activityRow), next_cursor: cursor };
};
