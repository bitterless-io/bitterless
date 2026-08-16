export type SnipingJsonPrimitive = string | number | boolean | null;
export type SnipingJsonValue =
  | SnipingJsonPrimitive
  | SnipingJsonValue[]
  | { [key: string]: SnipingJsonValue };
export type SnipingJsonObject = { [key: string]: SnipingJsonValue };

export type SnipingChain = 'bsc' | 'ethereum' | 'base' | 'arbitrum' | 'solana';
export type SnipingRegion = 'sg' | 'jp' | 'local';
export type SnipingDesiredState = 'disabled' | 'armed';
export type SnipingObservedState =
  | 'offline'
  | 'standby'
  | 'active'
  | 'degraded'
  | 'paused'
  | 'expired'
  | 'error';
export type SnipingSimulationKind = 'exact' | 'shadow';
export type SnipingSimulationOutcome = 'executable' | 'blocked' | 'unknown' | 'duplicate';
export type SnipingActivityProduct = 'monitor' | 'exact' | 'shadow';
export type SnipingActivityOutcome =
  | 'hit'
  | 'filtered'
  | 'blocked'
  | 'failed'
  | 'executable'
  | 'unknown'
  | 'duplicate'
  | 'claimed'
  | 'expired'
  | 'retryable';

export interface SnipingBridgeError {
  code: string;
  message: string;
  status: number | null;
  retryable: boolean;
  issues?: Array<{ path: string; keyword: string }>;
}

export type SnipingBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SnipingBridgeError };

export interface SnipingReleaseProjection {
  component_id: string;
  component_version: string;
  schema_hash: string;
  title: string;
  description: string;
  mode: 'monitor-only';
  trigger_family: string;
  available: boolean;
  chains: SnipingChain[];
  required_capabilities: string[];
  config_schema: SnipingJsonObject;
  ui_schema: SnipingJsonObject;
  default_config: SnipingJsonObject;
  secret_slots: string[];
}

export interface SnipingRuntimeProjection {
  region: SnipingRegion;
  desired_state: SnipingDesiredState;
  observed_state: SnipingObservedState;
  cursor_summary: SnipingJsonObject | null;
  lag_ms: number | null;
  last_error_code: string | null;
  heartbeat_at: string | null;
}

export interface SnipingConfigSummary {
  config_id: string;
  name: string;
  component_id: string;
  component_version: string;
  schema_hash: string;
  release_available: boolean;
  chain: SnipingChain;
  config_revision: number;
  desired_state: SnipingDesiredState;
  primary_region: SnipingRegion;
  standby_region: SnipingRegion;
  updated_at: string;
}

export interface SnipingConfigDetail extends SnipingConfigSummary {
  config: SnipingJsonObject;
  credential_status: Array<{ slot: string; configured: boolean }>;
  runtimes: SnipingRuntimeProjection[];
}

export interface SnipingPage<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface SnipingConfigListInput {
  page?: number;
  page_size?: number;
  search_text?: string;
}

export interface SnipingConfigIdentityInput {
  config_id: string;
}

export interface SnipingReleaseConfigInput {
  component_id: string;
  component_version: string;
  schema_hash: string;
  chain: SnipingChain;
  config: SnipingJsonObject;
}

export interface SnipingConfigSaveInput extends SnipingReleaseConfigInput {
  config_id?: string;
  name: string;
  primary_region: SnipingRegion;
  standby_region: SnipingRegion;
  expected_revision: number;
}

export interface SnipingRevisionInput {
  config_id: string;
  expected_revision: number;
}

export interface SnipingValidationReceipt {
  valid: true;
  schema_hash: string;
  normalized_config_hash: string;
}

export interface SnipingRuntimeListResult {
  config_id: string;
  desired_state: SnipingDesiredState;
  list: SnipingRuntimeProjection[];
}

export interface SnipingSimulationEvent {
  canonical_event_key: string;
  token_address: string;
  quote_token_address: string;
  block_number: string;
  block_hash: string;
  observed_at: string;
  finalized_at: string;
}

export interface SnipingSimulationEventListInput extends SnipingConfigIdentityInput {
  page?: number;
  page_size?: number;
}

export interface SnipingExactRequestInput extends SnipingRevisionInput {
  request_id: string;
  canonical_event_key: string;
}

export interface SnipingShadowPolicy {
  max_events: number;
  checkpoint_blocks: number[];
  evidence_ttl_seconds: number;
}

export interface SnipingShadowRequestInput extends SnipingRevisionInput {
  request_id: string;
  shadow_policy: SnipingShadowPolicy;
}

export interface SnipingSimulationListInput extends SnipingConfigIdentityInput {
  page?: number;
  page_size?: number;
}

export interface SnipingSimulationReport {
  schema: 'bl-sniping-simulation-report-v1';
  evidence_class: 'SIMULATED';
  kind: SnipingSimulationKind;
  identity: {
    config_id: string;
    config_revision: number;
    component_id: string;
    component_version: string;
    schema_hash: string;
    chain: 'bsc';
    event: SnipingJsonObject | null;
    sender_address: string;
    simulator_build_version: string | null;
    config_fingerprint: string;
    build_fingerprint: string;
    protocol_fingerprint: string;
    call_policy_hash: string;
    request_fingerprint: string;
  };
  result: {
    outcome: Exclude<SnipingSimulationOutcome, 'duplicate'>;
    reason_code: string;
    expected_output_atomic: string | null;
    minimum_output_atomic: string | null;
    estimated_gas: string | null;
    balance_ready: boolean | null;
    allowance_ready: boolean | null;
    virtual_gross_atomic: string | null;
    virtual_net_atomic: string | null;
  };
  checkpoint_count: number;
  product_evidence: SnipingJsonObject | null;
}

export interface SnipingSimulationAttempt {
  attempt_number: number;
  state: 'claimed' | 'expired' | 'retryable' | 'succeeded' | 'blocked' | 'failed';
  outcome: SnipingSimulationOutcome | null;
  reason_code: string;
  report: SnipingSimulationReport | null;
  expires_at: string | null;
  created_at: string;
}

export interface SnipingShadowPosition {
  canonical_event_key: string;
  block_number: string;
  block_hash: string;
  transaction_hash: string;
  log_index: number;
  outcome: SnipingSimulationOutcome;
  reason_code: string;
  first_action_block_number: string | null;
  observation_to_action_ms: string | null;
  expected_output_atomic: string | null;
  minimum_output_atomic: string | null;
  virtual_gross_atomic: string | null;
  virtual_net_atomic: string | null;
  request_fingerprint: string;
  checkpoints: SnipingJsonObject[];
  created_at: string;
}

export interface SnipingSimulationRequestProjection {
  request_id: string;
  config_id: string;
  config_revision: number;
  kind: SnipingSimulationKind;
  canonical_event_key: string | null;
  shadow_policy: SnipingShadowPolicy | null;
  state: 'pending' | 'claimed' | 'completed' | 'failed';
  attempt_count: number;
  accepted_attempt_number: number | null;
  evidence_expires_at: string | null;
  evidence_expired: boolean;
  position_count?: number;
  positions?: SnipingShadowPosition[];
  attempts: SnipingSimulationAttempt[];
  created_at: string;
  updated_at: string;
}

export interface SnipingActivityCursor {
  created_at: string;
  activity_id: string;
}

export interface SnipingActivityListInput {
  page_size?: number;
  product?: SnipingActivityProduct;
  outcome?: SnipingActivityOutcome;
  chain?: SnipingChain;
  search_text?: string;
  cursor?: SnipingActivityCursor;
}

export interface SnipingActivityRow {
  activity_id: string;
  product: SnipingActivityProduct;
  config_id: string;
  config_name: string;
  component_id: string;
  component_version: string;
  chain: SnipingChain;
  canonical_event_key: string | null;
  outcome: SnipingActivityOutcome;
  reason_code: string;
  token_address: string | null;
  quote_token_address: string | null;
  action_class: string | null;
  request_id: string | null;
  attempt_number: number | null;
  attempt_state: string | null;
  request_fingerprint: string | null;
  evidence_class: 'SIMULATED' | null;
  created_at: string;
}

export interface SnipingActivityListResult {
  list: SnipingActivityRow[];
  next_cursor: SnipingActivityCursor | null;
}

export const SNIPING_IPC_CHANNELS = {
  listComponents: 'sniping:components:list',
  listConfigs: 'sniping:configs:list',
  getConfig: 'sniping:config:get',
  validateConfig: 'sniping:config:validate',
  saveConfig: 'sniping:config:save',
  startMonitoring: 'sniping:monitoring:start',
  stopMonitoring: 'sniping:monitoring:stop',
  listRuntimes: 'sniping:runtimes:list',
  listSimulationEvents: 'sniping:simulation-events:list',
  requestExactSimulation: 'sniping:exact:request',
  listExactSimulations: 'sniping:exact:list',
  requestShadowSimulation: 'sniping:shadow:request',
  listShadowSimulations: 'sniping:shadow:list',
  listActivity: 'sniping:activity:list',
} as const;

export interface SnipingBridge {
  listComponents(): Promise<SnipingBridgeResult<SnipingReleaseProjection[]>>;
  listConfigs(input?: SnipingConfigListInput): Promise<SnipingBridgeResult<SnipingPage<SnipingConfigSummary>>>;
  getConfig(input: SnipingConfigIdentityInput): Promise<SnipingBridgeResult<SnipingConfigDetail>>;
  validateConfig(input: SnipingReleaseConfigInput): Promise<SnipingBridgeResult<SnipingValidationReceipt>>;
  saveConfig(input: SnipingConfigSaveInput): Promise<SnipingBridgeResult<SnipingConfigDetail>>;
  startMonitoring(input: SnipingRevisionInput): Promise<SnipingBridgeResult<SnipingConfigDetail>>;
  stopMonitoring(input: SnipingRevisionInput): Promise<SnipingBridgeResult<SnipingConfigDetail>>;
  listRuntimes(input: SnipingConfigIdentityInput): Promise<SnipingBridgeResult<SnipingRuntimeListResult>>;
  listSimulationEvents(input: SnipingSimulationEventListInput): Promise<SnipingBridgeResult<SnipingPage<SnipingSimulationEvent>>>;
  requestExactSimulation(input: SnipingExactRequestInput): Promise<SnipingBridgeResult<SnipingSimulationRequestProjection>>;
  listExactSimulations(input: SnipingSimulationListInput): Promise<SnipingBridgeResult<SnipingPage<SnipingSimulationRequestProjection>>>;
  requestShadowSimulation(input: SnipingShadowRequestInput): Promise<SnipingBridgeResult<SnipingSimulationRequestProjection>>;
  listShadowSimulations(input: SnipingSimulationListInput): Promise<SnipingBridgeResult<SnipingPage<SnipingSimulationRequestProjection>>>;
  listActivity(input?: SnipingActivityListInput): Promise<SnipingBridgeResult<SnipingActivityListResult>>;
}
