import type {
  MonitoringBridge,
  MonitoringDetailProjection,
  MonitoringListItem,
  MonitoringSampleProjection
} from '../../../src/shared/monitoring/monitoringBridge.type';
import { MONITORING_TRANSFER_RELEASE } from '../../../src/shared/monitoring/monitoringBridge.type';
import type { SnipingBridgeResult } from '../../../src/shared/sniping/snipingBridge.type';

export const MONITORING_ADDRESS = `0x${'1'.repeat(40)}`;
export const MONITORING_ASSET_KEY = `eip155:56:${MONITORING_ADDRESS}`;
export const MONITORING_SCHEMA_HASH = MONITORING_TRANSFER_RELEASE.schema_hash;
export const MONITORING_BLOCK_HASH = `0x${'b'.repeat(64)}`;
export const MONITORING_DATE = '2026-08-14T00:00:00.000Z';
export const MONITORING_BUCKET_SEQUENCE = String(Date.parse(MONITORING_DATE) / 300_000);

export const monitoringOk = <T>(value: T): SnipingBridgeResult<T> => ({ ok: true, value });

export const monitoringFailure = (
  code: string,
  status: number | null = null
): SnipingBridgeResult<never> => ({
  ok: false,
  error: { code, message: 'sanitized', status, retryable: false }
});

export interface MonitoringSampleOptions {
  configId?: string;
  revision?: number;
  sequence?: string;
  state?: MonitoringSampleProjection['state'];
  name?: string;
  tokenAddress?: string;
  threshold?: number;
}

const completeRegion = (
  region: 'sg' | 'jp',
  state: 'READY' | 'HIGH' | 'LOW' = 'READY',
  threshold = 3
) => ({
  region,
  state,
  completeness: 'COMPLETE' as const,
  from_block: '100',
  to_block: '110',
  end_block_hash: MONITORING_BLOCK_HASH,
  transfer_event_count: state === 'HIGH' ? 28 : state === 'LOW' ? 1 : 12,
  baseline_count: 72,
  baseline_mean: '10',
  baseline_stddev: '2',
  z_score:
    state === 'HIGH' ? String(threshold + 1) : state === 'LOW' ? String(-threshold - 1) : '1',
  reason_code: `MONITOR_${state}`,
  sample_fingerprint: 'c'.repeat(64)
});

const incompleteRegion = (region: 'sg' | 'jp') => ({
  region,
  state: 'INCOMPLETE_RANGE' as const,
  completeness: 'INCOMPLETE_RANGE' as const,
  from_block: '100',
  to_block: '110',
  end_block_hash: null,
  transfer_event_count: null,
  baseline_count: 0,
  baseline_mean: null,
  baseline_stddev: null,
  z_score: null,
  reason_code: 'MONITOR_INCOMPLETE_RANGE',
  sample_fingerprint: 'd'.repeat(64)
});

export const monitoringSample = (
  options: MonitoringSampleOptions = {}
): MonitoringSampleProjection => {
  const configId = options.configId ?? '1';
  const revision = options.revision ?? 1;
  const sequence = options.sequence ?? MONITORING_BUCKET_SEQUENCE;
  const state = options.state ?? 'READY';
  const tokenAddress = options.tokenAddress ?? MONITORING_ADDRESS;
  const threshold = options.threshold ?? 3;
  const bucketStart = new Date(Number(sequence) * 300_000).toISOString();
  const bucketEnd = new Date((Number(sequence) + 1) * 300_000).toISOString();
  const detectorState =
    state === 'HIGH' || state === 'LOW' || state === 'READY'
      ? state
      : state === 'INCOMPLETE_RANGE'
        ? 'INCOMPLETE_RANGE'
        : null;
  const regions =
    state === 'INCOMPLETE_RANGE'
      ? [incompleteRegion('sg'), incompleteRegion('jp')]
      : state === 'REGION_MISMATCH'
        ? [
            completeRegion('sg'),
            {
              ...completeRegion('jp'),
              sample_fingerprint: 'e'.repeat(64),
              transfer_event_count: 13
            }
          ]
        : state === 'SINGLE_REGION'
          ? [completeRegion('sg')]
          : [
              completeRegion('sg', state as 'READY' | 'HIGH' | 'LOW', threshold),
              completeRegion('jp', state as 'READY' | 'HIGH' | 'LOW', threshold)
            ];
  const matched = state !== 'REGION_MISMATCH' && state !== 'SINGLE_REGION';
  const aggregate = matched ? regions[0] : null;
  return {
    config_id: configId,
    ...(options.name === undefined ? {} : { name: options.name }),
    config_revision: revision,
    asset_key: `eip155:56:${tokenAddress}`,
    component_id: 'erc20-transfer-activity-monitor',
    component_version: '1.0.0',
    schema_hash: MONITORING_SCHEMA_HASH,
    metric_kind: 'erc20-transfer-event-count',
    detector_version: 'zscore-population-v1',
    zscore_threshold: threshold,
    bucket_sequence: sequence,
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    state,
    detector_state: matched ? detectorState : null,
    agreement:
      state === 'REGION_MISMATCH'
        ? 'REGION_MISMATCH'
        : state === 'SINGLE_REGION'
          ? 'SINGLE_REGION'
          : 'MATCHED',
    confirmed: matched && (state === 'HIGH' || state === 'LOW'),
    from_block: aggregate?.from_block ?? null,
    to_block: aggregate?.to_block ?? null,
    end_block_hash: aggregate?.end_block_hash ?? null,
    completeness: aggregate?.completeness ?? null,
    transfer_event_count: aggregate?.transfer_event_count ?? null,
    baseline_count: aggregate?.baseline_count ?? null,
    baseline_mean: aggregate?.baseline_mean ?? null,
    baseline_stddev: aggregate?.baseline_stddev ?? null,
    z_score: aggregate?.z_score ?? null,
    reason_code: matched ? aggregate!.reason_code : state,
    regions
  };
};

export const monitoringListItem = (
  overrides: Partial<MonitoringListItem> = {}
): MonitoringListItem => ({
  config_id: '1',
  name: 'GME transfer activity',
  asset_key: MONITORING_ASSET_KEY,
  chain: 'bsc',
  token_address: MONITORING_ADDRESS,
  zscore_threshold: 3,
  component_id: 'erc20-transfer-activity-monitor',
  component_version: '1.0.0',
  schema_hash: MONITORING_SCHEMA_HASH,
  metric_kind: 'erc20-transfer-event-count',
  detector_version: 'zscore-population-v1',
  config_revision: 1,
  desired_state: 'disabled',
  status: 'Stopped',
  primary_region: 'sg',
  standby_region: 'jp',
  updated_at: MONITORING_DATE,
  runtime: [
    {
      region: 'sg',
      observed_state: 'standby',
      last_error_code: null,
      cursor_summary: {
        cursor_kind: 'evm-monitor-bucket',
        block_number: '110',
        slot: MONITORING_BUCKET_SEQUENCE,
        lag_blocks: '2'
      },
      lag_blocks: '2',
      heartbeat_at: MONITORING_DATE
    },
    {
      region: 'jp',
      observed_state: 'standby',
      last_error_code: null,
      cursor_summary: null,
      lag_blocks: null,
      heartbeat_at: null
    }
  ],
  latest: null,
  readiness: { state: 'WARMING', baseline_count: 0, minimum_baseline_count: 72 },
  ...overrides
});

export const monitoringDetail = (
  overrides: Partial<MonitoringDetailProjection> = {}
): MonitoringDetailProjection => {
  const base = monitoringListItem(overrides);
  return {
    ...base,
    available_revisions:
      overrides.available_revisions ??
      Array.from({ length: Math.min(base.config_revision, 500) }, (_, index) => ({
        revision: base.config_revision - index,
        desired_state: base.desired_state,
        created_at: MONITORING_DATE,
        has_samples: index === 0 ? base.latest !== null : true
      }))
  };
};

export const monitoringBridgeStub = (
  overrides: Partial<MonitoringBridge> = {}
): MonitoringBridge => ({
  list: async (input = {}) =>
    monitoringOk({
      list: [],
      total: 0,
      page: input.page ?? 1,
      page_size: input.page_size ?? 20
    }),
  get: async () => monitoringOk(monitoringDetail()),
  save: async () => monitoringFailure('NOT_IMPLEMENTED'),
  start: async () => monitoringFailure('NOT_IMPLEMENTED'),
  stop: async () => monitoringFailure('NOT_IMPLEMENTED'),
  listSamples: async () => monitoringOk({ list: [], next_before_bucket_sequence: null }),
  listAnomalies: async () => monitoringOk({ list: [], next_cursor: null }),
  ...overrides
});

export const monitoringDeferred = <T>(): { promise: Promise<T>; resolve(value: T): void } => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};
