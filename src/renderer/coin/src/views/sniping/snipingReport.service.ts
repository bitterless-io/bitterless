import type {
  SnipingJsonObject,
  SnipingJsonValue,
  SnipingShadowPosition,
  SnipingSimulationAttempt,
  SnipingSimulationReport,
  SnipingSimulationRequestProjection,
} from '@shared/sniping/snipingBridge.type';

export interface SnipingReportField {
  key: string;
  value: string;
}

export interface SnipingShadowPositionDisplay {
  canonicalEventKey: string;
  blockNumber: string;
  outcome: string;
  reasonCode: string;
  virtualGrossAtomic: string;
  virtualNetAtomic: string;
  observationToActionMs: string;
  checkpointSummary: string;
}

export interface SnipingSimulationRunDisplay {
  requestId: string;
  kind: 'exact' | 'shadow';
  configRevision: number;
  currentEvidence: boolean;
  state: SnipingSimulationRequestProjection['state'];
  latestAttempt: SnipingSimulationAttempt | null;
  evidenceExpired: boolean;
  evidenceExpiresAt: string | null;
  report: {
    reasonCode: string;
    expectedOutputAtomic: string;
    minimumOutputAtomic: string;
    estimatedGas: string;
    detailFields: SnipingReportField[];
  } | null;
  shadowPolicySummary: string | null;
  hasPositionsProjection: boolean;
  hasReportedEvidence: boolean;
  positionCount: number | null;
  outcomeSummary: string;
  positions: SnipingShadowPositionDisplay[];
}

const object = (value: SnipingJsonValue | null | undefined): SnipingJsonObject | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;

const display = (value: SnipingJsonValue | undefined): string => {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const latestSnipingAttempt = (
  run: SnipingSimulationRequestProjection,
): SnipingSimulationAttempt | null => run.attempts.at(-1) ?? null;

export const reportedSnipingReport = (
  run: SnipingSimulationRequestProjection,
): SnipingSimulationReport | null => {
  if (run.accepted_attempt_number === null) return null;
  return run.attempts.find((attempt) =>
    attempt.attempt_number === run.accepted_attempt_number && attempt.report !== null)?.report ?? null;
};

export const acceptedSnipingReport = (
  run: SnipingSimulationRequestProjection,
): SnipingSimulationReport | null => run.evidence_expired ? null : reportedSnipingReport(run);

export const shadowCohortCounts = (
  run: SnipingSimulationRequestProjection,
): SnipingJsonObject | null => {
  const report = reportedSnipingReport(run);
  const evidence = object(report?.product_evidence);
  const counts = object(evidence?.cohort_counts);
  return evidence?.schema === 'bl-sniping-flap-product-evidence-v1' ? counts : null;
};

export const reportEventFields = (report: SnipingSimulationReport): SnipingReportField[] => {
  const event = object(report.identity.event);
  if (!event) return [];
  return [
    ['eventChainId', event.chain_id],
    ['eventPortal', event.portal_address],
    ['eventBlock', event.block_number],
    ['eventBlockHash', event.block_hash],
    ['eventTransaction', event.transaction_hash],
    ['eventLogIndex', event.log_index],
    ['eventTopic', event.event_topic],
  ].map(([key, value]) => ({ key: String(key), value: display(value) }));
};

export const reportProductFields = (report: SnipingSimulationReport): SnipingReportField[] => {
  const evidence = object(report.product_evidence);
  if (evidence?.schema !== 'bl-sniping-flap-product-evidence-v1') return [];
  return [
    ['token', evidence.token_address],
    ['quoteToken', evidence.quote_token_address],
    ['spend', evidence.spend_amount_decimal],
    ['spendAtomic', evidence.spend_amount_atomic],
    ['declaredDecimals', evidence.declared_quote_token_decimals],
    ['quoteCode', evidence.quote_token_code_ready],
    ['quoteDecimals', evidence.quote_token_decimals_ready],
    ['balance', evidence.balance_ready],
    ['allowance', evidence.allowance_ready],
    ['portal', evidence.portal_state_ready],
    ['gasCost', evidence.gas_cost_ready],
    ['gasUnits', evidence.gas_units_ready],
    ['simulatedOutput', evidence.simulated_output_atomic],
    ['quotedOutput', evidence.quoted_output_atomic],
    ['minimumOutput', evidence.minimum_output_atomic],
    ['quoteUnit', evidence.quote_unit],
    ['gasUnit', evidence.gas_unit],
  ].map(([key, value]) => ({ key: String(key), value: display(value) }));
};

export const reportIdentityFields = (report: SnipingSimulationReport): SnipingReportField[] => [
  { key: 'release', value: `${report.identity.component_id}@${report.identity.component_version}` },
  { key: 'configRevision', value: `r${report.identity.config_revision}` },
  { key: 'schemaHash', value: report.identity.schema_hash },
  { key: 'sender', value: report.identity.sender_address },
  { key: 'buildVersion', value: report.identity.simulator_build_version ?? '—' },
  { key: 'fingerprint', value: report.identity.request_fingerprint },
  { key: 'configFingerprint', value: report.identity.config_fingerprint },
  { key: 'buildFingerprint', value: report.identity.build_fingerprint },
  { key: 'protocolFingerprint', value: report.identity.protocol_fingerprint },
  { key: 'callPolicyHash', value: report.identity.call_policy_hash },
];

const checkpointSummary = (position: SnipingShadowPosition): string => position.checkpoints.length
  ? position.checkpoints.map((checkpoint) => {
    const block = typeof checkpoint.block_number === 'string' ? checkpoint.block_number : '—';
    const outcome = typeof checkpoint.outcome === 'string' ? checkpoint.outcome : 'unknown';
    const net = typeof checkpoint.virtual_net_atomic === 'string' ? checkpoint.virtual_net_atomic : '—';
    return `${block}: ${outcome} / ${net}`;
  }).join(' · ')
  : '—';

const positionDisplay = (position: SnipingShadowPosition): SnipingShadowPositionDisplay => ({
  canonicalEventKey: position.canonical_event_key,
  blockNumber: position.block_number,
  outcome: position.outcome,
  reasonCode: position.reason_code,
  virtualGrossAtomic: position.virtual_gross_atomic ?? '—',
  virtualNetAtomic: position.virtual_net_atomic ?? '—',
  observationToActionMs: position.observation_to_action_ms ?? '—',
  checkpointSummary: checkpointSummary(position),
});

const shadowOutcomeSummary = (
  run: SnipingSimulationRequestProjection,
  positions: SnipingShadowPosition[],
): string => {
  const cohort = shadowCohortCounts(run);
  if (cohort) {
    return ['hit', 'executable', 'blocked', 'unknown', 'duplicate']
      .map((outcome) => `${outcome} ${String(cohort[outcome] ?? 0)}`)
      .join(' · ');
  }
  const counts = new Map<string, number>();
  positions.forEach((position) => counts.set(position.outcome, (counts.get(position.outcome) ?? 0) + 1));
  return ['executable', 'blocked', 'unknown']
    .map((outcome) => `${outcome} ${counts.get(outcome) ?? 0}`)
    .join(' · ');
};

export const buildSnipingSimulationRunDisplay = (
  run: SnipingSimulationRequestProjection,
  currentRevision: number,
): SnipingSimulationRunDisplay => {
  const latestAttempt = latestSnipingAttempt(run);
  const report = reportedSnipingReport(run);
  const positions = run.positions ?? [];
  return {
    requestId: run.request_id,
    kind: run.kind,
    configRevision: run.config_revision,
    currentEvidence: run.config_revision === currentRevision && !run.evidence_expired,
    state: run.state,
    latestAttempt,
    evidenceExpired: run.evidence_expired,
    evidenceExpiresAt: run.evidence_expires_at,
    report: report ? {
      reasonCode: report.result.reason_code,
      expectedOutputAtomic: report.result.expected_output_atomic ?? '—',
      minimumOutputAtomic: report.result.minimum_output_atomic ?? '—',
      estimatedGas: report.result.estimated_gas ?? '—',
      detailFields: [
        ...reportIdentityFields(report),
        ...reportEventFields(report),
        ...reportProductFields(report),
      ],
    } : null,
    shadowPolicySummary: run.shadow_policy
      ? `${run.shadow_policy.max_events} · +${run.shadow_policy.checkpoint_blocks.join('/')} · ${run.shadow_policy.evidence_ttl_seconds}s`
      : null,
    hasPositionsProjection: run.positions !== undefined,
    hasReportedEvidence: report !== null,
    positionCount: run.position_count ?? null,
    outcomeSummary: report ? shadowOutcomeSummary(run, positions) : '—',
    positions: positions.map(positionDisplay),
  };
};
