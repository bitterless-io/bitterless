import type {
  MonitoringAgreement,
  MonitoringAnomalyCursor,
  MonitoringAnomalyListResponse,
  MonitoringDetailProjection,
  MonitoringListItem,
  MonitoringListResponse,
  MonitoringProjectedState,
  MonitoringReadiness,
  MonitoringRegion,
  MonitoringRegionEvidence,
  MonitoringRevisionProjection,
  MonitoringRuntimeProjection,
  MonitoringSampleListResponse,
  MonitoringSampleProjection,
  MonitoringSummaryProjection
} from '@shared/monitoring/monitoringBridge.type';
import { MONITORING_TRANSFER_RELEASE } from '@shared/monitoring/monitoringBridge.type';
import type { SnipingDesiredState, SnipingObservedState } from '@shared/sniping/snipingBridge.type';
import { SnipingResponseError } from '../sniping/snipingResponse.validation';
import { assertSafeSnipingFreeText } from '../sniping/snipingRequest.validation';

const CONFIG_ID = /^[1-9]\d{0,18}$/;
const UNSIGNED = /^(0|[1-9]\d{0,29})$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ASSET_KEY = /^eip155:56:0x[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const EVM_HASH = /^0x[0-9a-f]{64}$/;
const FIXED_DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d*[1-9]))?$/;
const REASON = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const STATES = new Set<MonitoringProjectedState>([
  'WARMING',
  'BASELINE_FLAT',
  'READY',
  'HIGH',
  'LOW',
  'INCOMPLETE_RANGE',
  'SINGLE_REGION',
  'REGION_MISMATCH'
]);
const DETECTOR_STATES = new Set([
  'WARMING',
  'BASELINE_FLAT',
  'READY',
  'HIGH',
  'LOW',
  'INCOMPLETE_RANGE'
]);
const AGREEMENTS = new Set<MonitoringAgreement>(['MATCHED', 'SINGLE_REGION', 'REGION_MISMATCH']);
const DESIRED = new Set<SnipingDesiredState>(['disabled', 'armed']);
const OBSERVED = new Set<SnipingObservedState>([
  'offline',
  'standby',
  'active',
  'degraded',
  'paused',
  'expired',
  'error'
]);

const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SnipingResponseError();
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new SnipingResponseError();
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SnipingResponseError();
  }
  return row;
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const text = (value: unknown, maximum: number, pattern?: RegExp): string => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    [...value].length > maximum ||
    hasControlCharacter(value) ||
    (pattern && !pattern.test(value))
  ) {
    throw new SnipingResponseError();
  }
  return value;
};

const displayText = (value: unknown, maximum: number): string => {
  const result = text(value, maximum);
  try {
    assertSafeSnipingFreeText(result);
  } catch {
    throw new SnipingResponseError();
  }
  return result;
};

const nullableText = (value: unknown, maximum: number, pattern?: RegExp): string | null =>
  value === null ? null : text(value, maximum, pattern);

const nullableFixedDecimal = (value: unknown): string | null => {
  if (value === null) return null;
  const result = text(value, 32);
  const match = FIXED_DECIMAL.exec(result);
  if (result === '-0' || !match || match[2].length > 18 || (match[3]?.length ?? 0) > 12) {
    throw new SnipingResponseError();
  }
  return result;
};

const boundedBigint = (value: unknown, pattern = UNSIGNED): string => {
  const result = text(value, 30, pattern);
  if (BigInt(result) > MAX_BIGINT) throw new SnipingResponseError();
  return result;
};

const configId = (value: unknown): string => boundedBigint(value, CONFIG_ID);

const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new SnipingResponseError();
  }
  return Number(value);
};

const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new SnipingResponseError();
  return value;
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

const region = (value: unknown): MonitoringRegion => {
  if (value !== 'sg' && value !== 'jp') throw new SnipingResponseError();
  return value;
};

const desired = (value: unknown): SnipingDesiredState => {
  if (!DESIRED.has(value as SnipingDesiredState)) throw new SnipingResponseError();
  return value as SnipingDesiredState;
};

const state = (value: unknown): MonitoringProjectedState => {
  if (!STATES.has(value as MonitoringProjectedState)) throw new SnipingResponseError();
  return value as MonitoringProjectedState;
};

const threshold = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 2 ||
    value > 10 ||
    Number(value.toFixed(2)) !== value
  )
    throw new SnipingResponseError();
  return value;
};

const runtime = (value: unknown): MonitoringRuntimeProjection => {
  const row = object(value, [
    'region',
    'observed_state',
    'last_error_code',
    'cursor_summary',
    'lag_blocks',
    'heartbeat_at'
  ]);
  if (!OBSERVED.has(row.observed_state as SnipingObservedState)) throw new SnipingResponseError();
  let cursor: MonitoringRuntimeProjection['cursor_summary'] = null;
  if (row.cursor_summary !== null) {
    const raw = object(row.cursor_summary, ['cursor_kind', 'block_number', 'slot', 'lag_blocks']);
    if (raw.cursor_kind !== 'evm-monitor-bucket') throw new SnipingResponseError();
    cursor = {
      cursor_kind: 'evm-monitor-bucket',
      block_number: text(raw.block_number, 30, UNSIGNED),
      slot: text(raw.slot, 30, UNSIGNED),
      lag_blocks: text(raw.lag_blocks, 30, UNSIGNED)
    };
  }
  const lagBlocks = nullableText(row.lag_blocks, 30, UNSIGNED);
  if ((cursor === null) !== (lagBlocks === null) || (cursor && cursor.lag_blocks !== lagBlocks)) {
    throw new SnipingResponseError();
  }
  return {
    region: region(row.region),
    observed_state: row.observed_state as SnipingObservedState,
    last_error_code: nullableText(row.last_error_code, 128, REASON),
    cursor_summary: cursor,
    lag_blocks: lagBlocks,
    heartbeat_at: row.heartbeat_at === null ? null : date(row.heartbeat_at)
  };
};

const regionalEvidence = (value: unknown, zscoreThreshold: number): MonitoringRegionEvidence => {
  const row = object(value, [
    'region',
    'state',
    'completeness',
    'from_block',
    'to_block',
    'end_block_hash',
    'transfer_event_count',
    'baseline_count',
    'baseline_mean',
    'baseline_stddev',
    'z_score',
    'reason_code',
    'sample_fingerprint'
  ]);
  if (
    !DETECTOR_STATES.has(String(row.state)) ||
    (row.completeness !== 'COMPLETE' && row.completeness !== 'INCOMPLETE_RANGE')
  ) {
    throw new SnipingResponseError();
  }
  const fromBlock = text(row.from_block, 30, UNSIGNED);
  const toBlock = text(row.to_block, 30, UNSIGNED);
  if (BigInt(fromBlock) > BigInt(toBlock)) throw new SnipingResponseError();
  const result: MonitoringRegionEvidence = {
    region: region(row.region),
    state: String(row.state) as MonitoringRegionEvidence['state'],
    completeness: row.completeness,
    from_block: fromBlock,
    to_block: toBlock,
    end_block_hash: nullableText(row.end_block_hash, 66, EVM_HASH),
    transfer_event_count:
      row.transfer_event_count === null
        ? null
        : integer(row.transfer_event_count, 0, 2_147_483_647),
    baseline_count: integer(row.baseline_count, 0, 288),
    baseline_mean: nullableFixedDecimal(row.baseline_mean),
    baseline_stddev: nullableFixedDecimal(row.baseline_stddev),
    z_score: nullableFixedDecimal(row.z_score),
    reason_code: text(row.reason_code, 128, REASON),
    sample_fingerprint: text(row.sample_fingerprint, 64, HASH)
  };
  if (
    (result.state === 'INCOMPLETE_RANGE') !== (result.completeness === 'INCOMPLETE_RANGE') ||
    (result.completeness === 'INCOMPLETE_RANGE' &&
      (result.state !== 'INCOMPLETE_RANGE' ||
        result.transfer_event_count !== null ||
        result.baseline_count !== 0 ||
        result.baseline_mean !== null ||
        result.baseline_stddev !== null ||
        result.z_score !== null)) ||
    (result.completeness === 'COMPLETE' &&
      (result.transfer_event_count === null || result.end_block_hash === null)) ||
    (result.state === 'WARMING' &&
      (result.baseline_count >= 72 ||
        result.baseline_mean !== null ||
        result.baseline_stddev !== null ||
        result.z_score !== null)) ||
    (result.state === 'BASELINE_FLAT' &&
      (result.baseline_count < 72 ||
        result.baseline_mean === null ||
        !Number.isFinite(Number(result.baseline_mean)) ||
        result.z_score !== null ||
        result.baseline_stddev === null ||
        Number(result.baseline_stddev) !== 0)) ||
    (['READY', 'HIGH', 'LOW'].includes(result.state) &&
      (result.baseline_count < 72 ||
        result.baseline_mean === null ||
        !Number.isFinite(Number(result.baseline_mean)) ||
        result.baseline_stddev === null ||
        Number(result.baseline_stddev) <= 0 ||
        result.z_score === null ||
        !Number.isFinite(Number(result.z_score)))) ||
    (result.state === 'HIGH' && Number(result.z_score) < zscoreThreshold) ||
    (result.state === 'LOW' && Number(result.z_score) > -zscoreThreshold) ||
    (result.state === 'READY' && Math.abs(Number(result.z_score)) >= zscoreThreshold)
  )
    throw new SnipingResponseError();
  return result;
};

const sample = (value: unknown, allowName: boolean): MonitoringSampleProjection => {
  const required = [
    'config_id',
    ...(allowName ? ['name'] : []),
    'config_revision',
    'asset_key',
    'component_id',
    'component_version',
    'schema_hash',
    'metric_kind',
    'detector_version',
    'zscore_threshold',
    'bucket_sequence',
    'bucket_start',
    'bucket_end',
    'state',
    'detector_state',
    'agreement',
    'confirmed',
    'from_block',
    'to_block',
    'end_block_hash',
    'completeness',
    'transfer_event_count',
    'baseline_count',
    'baseline_mean',
    'baseline_stddev',
    'z_score',
    'reason_code',
    'regions'
  ];
  const row = object(value, required);
  if (
    row.component_id !== MONITORING_TRANSFER_RELEASE.component_id ||
    row.component_version !== MONITORING_TRANSFER_RELEASE.component_version ||
    row.schema_hash !== MONITORING_TRANSFER_RELEASE.schema_hash ||
    row.metric_kind !== MONITORING_TRANSFER_RELEASE.metric_kind ||
    row.detector_version !== MONITORING_TRANSFER_RELEASE.detector_version ||
    !AGREEMENTS.has(row.agreement as MonitoringAgreement) ||
    !Array.isArray(row.regions) ||
    row.regions.length < 1 ||
    row.regions.length > 2
  )
    throw new SnipingResponseError();
  const zscoreThreshold = threshold(row.zscore_threshold);
  const regions = row.regions.map((item) => regionalEvidence(item, zscoreThreshold));
  if (new Set(regions.map((item) => item.region)).size !== regions.length)
    throw new SnipingResponseError();
  const agreement = row.agreement as MonitoringAgreement;
  const projectedState = state(row.state);
  const detectorState = row.detector_state === null ? null : text(row.detector_state, 32);
  const confirmed = bool(row.confirmed);
  const fromBlock = nullableText(row.from_block, 30, UNSIGNED);
  const toBlock = nullableText(row.to_block, 30, UNSIGNED);
  const endBlockHash = nullableText(row.end_block_hash, 66, EVM_HASH);
  const completeness = row.completeness as 'COMPLETE' | 'INCOMPLETE_RANGE' | null;
  const count =
    row.transfer_event_count === null ? null : integer(row.transfer_event_count, 0, 2_147_483_647);
  const baselineCount = row.baseline_count === null ? null : integer(row.baseline_count, 0, 288);
  const baselineMean = nullableFixedDecimal(row.baseline_mean);
  const baselineStddev = nullableFixedDecimal(row.baseline_stddev);
  const zScore = nullableFixedDecimal(row.z_score);
  const matched = agreement === 'MATCHED';
  const first = regions[0];
  if (
    (matched &&
      (regions.length !== 2 ||
        regions[0].sample_fingerprint !== regions[1].sample_fingerprint ||
        detectorState === null ||
        detectorState !== projectedState ||
        projectedState !== first.state ||
        fromBlock !== first.from_block ||
        toBlock !== first.to_block ||
        endBlockHash !== first.end_block_hash ||
        completeness !== first.completeness ||
        count !== first.transfer_event_count ||
        baselineCount !== first.baseline_count ||
        baselineMean !== first.baseline_mean ||
        baselineStddev !== first.baseline_stddev ||
        zScore !== first.z_score)) ||
    (!matched &&
      (projectedState !== agreement ||
        detectorState !== null ||
        confirmed ||
        fromBlock !== null ||
        toBlock !== null ||
        endBlockHash !== null ||
        completeness !== null ||
        count !== null ||
        baselineCount !== null ||
        baselineMean !== null ||
        baselineStddev !== null ||
        zScore !== null)) ||
    (agreement === 'SINGLE_REGION' && regions.length !== 1) ||
    (agreement === 'REGION_MISMATCH' &&
      (regions.length !== 2 || regions[0].sample_fingerprint === regions[1].sample_fingerprint)) ||
    confirmed !== (matched && (projectedState === 'HIGH' || projectedState === 'LOW')) ||
    (completeness !== null && completeness !== 'COMPLETE' && completeness !== 'INCOMPLETE_RANGE')
  )
    throw new SnipingResponseError();
  const parsedConfigId = configId(row.config_id);
  const assetKey = text(row.asset_key, 61, ASSET_KEY);
  const bucketStart = date(row.bucket_start);
  const bucketEnd = date(row.bucket_end);
  const bucketSequence = boundedBigint(row.bucket_sequence);
  const bucketStartMs = Date.parse(bucketStart);
  if (
    assetKey.slice('eip155:56:'.length) === '0x0000000000000000000000000000000000000000' ||
    Date.parse(bucketEnd) - Date.parse(bucketStart) !== 300_000 ||
    bucketStartMs % 300_000 !== 0 ||
    BigInt(bucketStartMs / 300_000) !== BigInt(bucketSequence) ||
    (matched && row.reason_code !== first.reason_code) ||
    (!matched && row.reason_code !== agreement) ||
    (regions.length === 2 && new Set(regions.map((item) => item.region)).size !== 2) ||
    (regions.length === 2 &&
      (!regions.some((item) => item.region === 'sg') ||
        !regions.some((item) => item.region === 'jp')))
  )
    throw new SnipingResponseError();
  if (matched) {
    const semantic = (item: MonitoringRegionEvidence): string =>
      JSON.stringify({
        state: item.state,
        completeness: item.completeness,
        from_block: item.from_block,
        to_block: item.to_block,
        end_block_hash: item.end_block_hash,
        transfer_event_count: item.transfer_event_count,
        baseline_count: item.baseline_count,
        baseline_mean: item.baseline_mean,
        baseline_stddev: item.baseline_stddev,
        z_score: item.z_score,
        reason_code: item.reason_code,
        sample_fingerprint: item.sample_fingerprint
      });
    if (semantic(regions[0]) !== semantic(regions[1])) throw new SnipingResponseError();
  }
  return {
    config_id: parsedConfigId,
    ...(allowName ? { name: displayText(row.name, 128) } : {}),
    config_revision: integer(row.config_revision, 1, 2_147_483_647),
    asset_key: assetKey,
    component_id: MONITORING_TRANSFER_RELEASE.component_id,
    component_version: MONITORING_TRANSFER_RELEASE.component_version,
    schema_hash: MONITORING_TRANSFER_RELEASE.schema_hash,
    metric_kind: MONITORING_TRANSFER_RELEASE.metric_kind,
    detector_version: MONITORING_TRANSFER_RELEASE.detector_version,
    zscore_threshold: zscoreThreshold,
    bucket_sequence: bucketSequence,
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    state: projectedState,
    detector_state: detectorState,
    agreement,
    confirmed,
    from_block: fromBlock,
    to_block: toBlock,
    end_block_hash: endBlockHash,
    completeness,
    transfer_event_count: count,
    baseline_count: baselineCount,
    baseline_mean: baselineMean,
    baseline_stddev: baselineStddev,
    z_score: zScore,
    reason_code: text(row.reason_code, 128, REASON),
    regions
  };
};

const summary = (value: unknown): MonitoringSummaryProjection => {
  const row = object(value, [
    'config_id',
    'name',
    'asset_key',
    'chain',
    'token_address',
    'zscore_threshold',
    'component_id',
    'component_version',
    'schema_hash',
    'metric_kind',
    'detector_version',
    'config_revision',
    'desired_state',
    'status',
    'primary_region',
    'standby_region',
    'updated_at'
  ]);
  if (
    row.chain !== 'bsc' ||
    row.component_id !== MONITORING_TRANSFER_RELEASE.component_id ||
    row.component_version !== MONITORING_TRANSFER_RELEASE.component_version ||
    row.schema_hash !== MONITORING_TRANSFER_RELEASE.schema_hash ||
    row.metric_kind !== MONITORING_TRANSFER_RELEASE.metric_kind ||
    row.detector_version !== MONITORING_TRANSFER_RELEASE.detector_version ||
    (row.status !== 'Monitoring' && row.status !== 'Stopped')
  )
    throw new SnipingResponseError();
  const primary = region(row.primary_region);
  const standby = region(row.standby_region);
  const tokenAddress = text(row.token_address, 42, ADDRESS);
  const desiredState = desired(row.desired_state);
  if (
    primary !== 'sg' ||
    standby !== 'jp' ||
    `eip155:56:${tokenAddress}` !== row.asset_key ||
    tokenAddress === '0x0000000000000000000000000000000000000000' ||
    (desiredState === 'armed') !== (row.status === 'Monitoring')
  )
    throw new SnipingResponseError();
  return {
    config_id: configId(row.config_id),
    name: displayText(row.name, 128),
    asset_key: text(row.asset_key, 61, ASSET_KEY),
    chain: 'bsc',
    token_address: tokenAddress,
    zscore_threshold: threshold(row.zscore_threshold),
    component_id: MONITORING_TRANSFER_RELEASE.component_id,
    component_version: MONITORING_TRANSFER_RELEASE.component_version,
    schema_hash: MONITORING_TRANSFER_RELEASE.schema_hash,
    metric_kind: MONITORING_TRANSFER_RELEASE.metric_kind,
    detector_version: MONITORING_TRANSFER_RELEASE.detector_version,
    config_revision: integer(row.config_revision, 1, 2_147_483_647),
    desired_state: desiredState,
    status: row.status,
    primary_region: primary,
    standby_region: standby,
    updated_at: date(row.updated_at)
  };
};

const readiness = (value: unknown): MonitoringReadiness => {
  const row = object(value, ['state', 'baseline_count', 'minimum_baseline_count']);
  if (row.minimum_baseline_count !== 72) throw new SnipingResponseError();
  return {
    state: state(row.state),
    baseline_count: integer(row.baseline_count, 0, 288),
    minimum_baseline_count: 72
  };
};

const listItem = (value: unknown): MonitoringListItem => {
  const summaryKeys = [
    'config_id',
    'name',
    'asset_key',
    'chain',
    'token_address',
    'zscore_threshold',
    'component_id',
    'component_version',
    'schema_hash',
    'metric_kind',
    'detector_version',
    'config_revision',
    'desired_state',
    'status',
    'primary_region',
    'standby_region',
    'updated_at'
  ];
  const all = object(value, [...summaryKeys, 'runtime', 'latest', 'readiness']);
  if (!Array.isArray(all.runtime) || all.runtime.length > 2) throw new SnipingResponseError();
  const base = summary(Object.fromEntries(summaryKeys.map((key) => [key, all[key]])));
  const runtimes = all.runtime.map(runtime);
  if (new Set(runtimes.map((item) => item.region)).size !== runtimes.length)
    throw new SnipingResponseError();
  const latest = all.latest === null ? null : sample(all.latest, false);
  const ready = readiness(all.readiness);
  if (
    latest &&
    (latest.config_id !== base.config_id ||
      latest.config_revision !== base.config_revision ||
      latest.asset_key !== base.asset_key ||
      latest.schema_hash !== base.schema_hash ||
      latest.zscore_threshold !== base.zscore_threshold ||
      ready.state !== latest.state ||
      ready.baseline_count !== Math.min(...latest.regions.map((item) => item.baseline_count)))
  ) {
    throw new SnipingResponseError();
  }
  if (!latest && (ready.state !== 'WARMING' || ready.baseline_count !== 0))
    throw new SnipingResponseError();
  return { ...base, runtime: runtimes, latest, readiness: ready };
};

const revision = (value: unknown): MonitoringRevisionProjection => {
  const row = object(value, ['revision', 'desired_state', 'created_at', 'has_samples']);
  return {
    revision: integer(row.revision, 1, 2_147_483_647),
    desired_state: desired(row.desired_state),
    created_at: date(row.created_at),
    has_samples: bool(row.has_samples)
  };
};

export const parseMonitoringListResponse = (value: unknown): MonitoringListResponse => {
  const row = object(value, ['list', 'total', 'page', 'page_size']);
  if (!Array.isArray(row.list) || row.list.length > 100) throw new SnipingResponseError();
  const list = row.list.map(listItem);
  if (new Set(list.map((item) => item.config_id)).size !== list.length)
    throw new SnipingResponseError();
  const total = integer(row.total);
  if (total < list.length) throw new SnipingResponseError();
  return {
    list,
    total,
    page: integer(row.page, 1, 1_000_000),
    page_size: integer(row.page_size, 1, 100)
  };
};

export const parseMonitoringDetailResponse = (value: unknown): MonitoringDetailProjection => {
  const itemKeys = [
    'config_id',
    'name',
    'asset_key',
    'chain',
    'token_address',
    'zscore_threshold',
    'component_id',
    'component_version',
    'schema_hash',
    'metric_kind',
    'detector_version',
    'config_revision',
    'desired_state',
    'status',
    'primary_region',
    'standby_region',
    'updated_at',
    'runtime',
    'latest',
    'readiness'
  ];
  const all = object(value, [...itemKeys, 'available_revisions']);
  if (!Array.isArray(all.available_revisions) || all.available_revisions.length > 500) {
    throw new SnipingResponseError();
  }
  const item = listItem(Object.fromEntries(itemKeys.map((key) => [key, all[key]])));
  const revisions = all.available_revisions.map(revision);
  const expectedRevisionCount = Math.min(item.config_revision, 500);
  if (
    revisions.length !== expectedRevisionCount ||
    revisions[0].revision !== item.config_revision ||
    revisions[0].desired_state !== item.desired_state ||
    revisions[0].has_samples !== (item.latest !== null) ||
    revisions.some((entry, index) => entry.revision !== item.config_revision - index)
  ) {
    throw new SnipingResponseError();
  }
  return { ...item, available_revisions: revisions };
};

export const parseMonitoringSampleListResponse = (value: unknown): MonitoringSampleListResponse => {
  const row = object(value, ['list', 'next_before_bucket_sequence']);
  if (!Array.isArray(row.list) || row.list.length > 250) throw new SnipingResponseError();
  const list = row.list.map((item) => sample(item, false));
  if (
    list.some(
      (item, index) =>
        index > 0 && BigInt(item.bucket_sequence) >= BigInt(list[index - 1].bucket_sequence)
    )
  ) {
    throw new SnipingResponseError();
  }
  const rawCursor = row.next_before_bucket_sequence;
  const cursor = rawCursor === null ? null : boundedBigint(rawCursor);
  const last = list.at(-1);
  if (cursor && (!last || cursor !== last.bucket_sequence)) throw new SnipingResponseError();
  return {
    list,
    next_before_bucket_sequence: cursor
  };
};

const anomalyCursor = (value: unknown): MonitoringAnomalyCursor => {
  const row = object(value, ['bucket_sequence', 'config_id', 'config_revision']);
  return {
    bucket_sequence: boundedBigint(row.bucket_sequence),
    config_id: configId(row.config_id),
    config_revision: integer(row.config_revision, 1, 2_147_483_647)
  };
};

export const parseMonitoringAnomalyListResponse = (
  value: unknown
): MonitoringAnomalyListResponse => {
  const row = object(value, ['list', 'next_cursor']);
  if (!Array.isArray(row.list) || row.list.length > 100) throw new SnipingResponseError();
  const list = row.list.map((item) => sample(item, true));
  if (
    list.some((item) => item.state === 'READY') ||
    list.some((item, index) => {
      if (index === 0) return false;
      const prior = list[index - 1];
      return (
        BigInt(item.bucket_sequence) > BigInt(prior.bucket_sequence) ||
        (item.bucket_sequence === prior.bucket_sequence &&
          BigInt(item.config_id) > BigInt(prior.config_id)) ||
        (item.bucket_sequence === prior.bucket_sequence &&
          item.config_id === prior.config_id &&
          item.config_revision >= prior.config_revision)
      );
    })
  )
    throw new SnipingResponseError();
  const cursor = row.next_cursor === null ? null : anomalyCursor(row.next_cursor);
  const last = list.at(-1);
  if (
    cursor &&
    (!last ||
      cursor.bucket_sequence !== last.bucket_sequence ||
      cursor.config_id !== last.config_id ||
      cursor.config_revision !== last.config_revision)
  ) {
    throw new SnipingResponseError();
  }
  return { list, next_cursor: cursor };
};
