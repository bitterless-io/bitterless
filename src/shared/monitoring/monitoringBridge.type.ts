import type {
  SnipingBridgeResult,
  SnipingDesiredState,
  SnipingObservedState
} from '../sniping/snipingBridge.type';

export const MONITORING_TRANSFER_RELEASE = {
  component_id: 'erc20-transfer-activity-monitor',
  component_version: '1.0.0',
  schema_hash: '76866cd75a9a9e86825f1fb26e92c27ad6808b7f0df875b960b96aca8c63d116',
  metric_kind: 'erc20-transfer-event-count',
  detector_version: 'zscore-population-v1'
} as const;

export type MonitoringRegion = 'sg' | 'jp';
export type MonitoringPublicState = 'Monitoring' | 'Stopped';
export type MonitoringAgreement = 'MATCHED' | 'SINGLE_REGION' | 'REGION_MISMATCH';
export type MonitoringProjectedState =
  | 'WARMING'
  | 'BASELINE_FLAT'
  | 'READY'
  | 'HIGH'
  | 'LOW'
  | 'INCOMPLETE_RANGE'
  | 'SINGLE_REGION'
  | 'REGION_MISMATCH';
export type MonitoringAnomalyFilterState = Exclude<MonitoringProjectedState, 'READY'>;

export interface MonitoringReadiness {
  state: MonitoringProjectedState;
  baseline_count: number;
  minimum_baseline_count: 72;
}

export interface MonitoringRuntimeProjection {
  region: MonitoringRegion;
  observed_state: SnipingObservedState;
  last_error_code: string | null;
  cursor_summary: null | {
    cursor_kind: 'evm-monitor-bucket';
    block_number: string;
    slot: string;
    lag_blocks: string;
  };
  lag_blocks: string | null;
  heartbeat_at: string | null;
}

export interface MonitoringRegionEvidence {
  region: MonitoringRegion;
  state: Exclude<MonitoringProjectedState, 'SINGLE_REGION' | 'REGION_MISMATCH'>;
  completeness: 'COMPLETE' | 'INCOMPLETE_RANGE';
  from_block: string;
  to_block: string;
  end_block_hash: string | null;
  transfer_event_count: number | null;
  baseline_count: number;
  baseline_mean: string | null;
  baseline_stddev: string | null;
  z_score: string | null;
  reason_code: string;
  sample_fingerprint: string;
}

export interface MonitoringSampleProjection {
  config_id: string;
  name?: string;
  config_revision: number;
  asset_key: string;
  component_id: 'erc20-transfer-activity-monitor';
  component_version: '1.0.0';
  schema_hash: string;
  metric_kind: 'erc20-transfer-event-count';
  detector_version: 'zscore-population-v1';
  zscore_threshold: number;
  bucket_sequence: string;
  bucket_start: string;
  bucket_end: string;
  state: MonitoringProjectedState;
  detector_state: string | null;
  agreement: MonitoringAgreement;
  confirmed: boolean;
  from_block: string | null;
  to_block: string | null;
  end_block_hash: string | null;
  completeness: 'COMPLETE' | 'INCOMPLETE_RANGE' | null;
  transfer_event_count: number | null;
  baseline_count: number | null;
  baseline_mean: string | null;
  baseline_stddev: string | null;
  z_score: string | null;
  reason_code: string;
  regions: MonitoringRegionEvidence[];
}

export interface MonitoringSummaryProjection {
  config_id: string;
  name: string;
  asset_key: string;
  chain: 'bsc';
  token_address: string;
  zscore_threshold: number;
  component_id: 'erc20-transfer-activity-monitor';
  component_version: '1.0.0';
  schema_hash: string;
  metric_kind: 'erc20-transfer-event-count';
  detector_version: 'zscore-population-v1';
  config_revision: number;
  desired_state: SnipingDesiredState;
  status: MonitoringPublicState;
  primary_region: MonitoringRegion;
  standby_region: MonitoringRegion;
  updated_at: string;
}

export interface MonitoringAnomalyCursor {
  bucket_sequence: string;
  config_id: string;
  config_revision: number;
}

export interface MonitoringRevisionProjection {
  revision: number;
  desired_state: SnipingDesiredState;
  created_at: string;
  has_samples: boolean;
}

export interface MonitoringListInput {
  page?: number;
  page_size?: number;
  search_text?: string;
}

export interface MonitoringIdentityInput {
  config_id: string;
}

export interface MonitoringSaveInput {
  config_id?: string;
  name?: string;
  token_address: string;
  zscore_threshold: number;
  expected_revision: number;
}

export interface MonitoringRevisionInput extends MonitoringIdentityInput {
  expected_revision: number;
}

export interface MonitoringSampleListInput extends MonitoringIdentityInput {
  config_revision: number;
  before_bucket_sequence?: string;
  page_size?: number;
}

export interface MonitoringAnomalyListInput {
  config_id?: string;
  states?: MonitoringAnomalyFilterState[];
  cursor?: MonitoringAnomalyCursor;
  page_size?: number;
}

export interface MonitoringListItem extends MonitoringSummaryProjection {
  runtime: MonitoringRuntimeProjection[];
  latest: MonitoringSampleProjection | null;
  readiness: MonitoringReadiness;
}

export interface MonitoringDetailProjection extends MonitoringListItem {
  available_revisions: MonitoringRevisionProjection[];
}

export interface MonitoringListResponse {
  list: MonitoringListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface MonitoringSampleListResponse {
  list: MonitoringSampleProjection[];
  next_before_bucket_sequence: string | null;
}

export interface MonitoringAnomalyListResponse {
  list: MonitoringSampleProjection[];
  next_cursor: MonitoringAnomalyCursor | null;
}

export const MONITORING_IPC_CHANNELS = {
  list: 'monitoring:watches:list',
  get: 'monitoring:watch:get',
  save: 'monitoring:watch:save',
  start: 'monitoring:watch:start',
  stop: 'monitoring:watch:stop',
  listSamples: 'monitoring:samples:list',
  listAnomalies: 'monitoring:anomalies:list'
} as const;

export interface MonitoringBridge {
  list(input?: MonitoringListInput): Promise<SnipingBridgeResult<MonitoringListResponse>>;
  get(input: MonitoringIdentityInput): Promise<SnipingBridgeResult<MonitoringDetailProjection>>;
  save(input: MonitoringSaveInput): Promise<SnipingBridgeResult<MonitoringDetailProjection>>;
  start(input: MonitoringRevisionInput): Promise<SnipingBridgeResult<MonitoringDetailProjection>>;
  stop(input: MonitoringRevisionInput): Promise<SnipingBridgeResult<MonitoringDetailProjection>>;
  listSamples(
    input: MonitoringSampleListInput
  ): Promise<SnipingBridgeResult<MonitoringSampleListResponse>>;
  listAnomalies(
    input?: MonitoringAnomalyListInput
  ): Promise<SnipingBridgeResult<MonitoringAnomalyListResponse>>;
}
