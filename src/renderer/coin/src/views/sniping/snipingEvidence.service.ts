import type {
  SnipingBridge,
  SnipingBridgeResult,
  SnipingConfigDetail,
  SnipingPage,
  SnipingSimulationRequestProjection,
} from '@shared/sniping/snipingBridge.type';
import { acceptedSnipingReport, reportedSnipingReport } from './snipingReport.service';

export type SnipingEvidenceState = 'idle' | 'ready' | 'blocked' | 'unknown' | 'expired';

export interface SnipingEvidenceStage {
  key: 'signal' | 'canonical' | 'request' | 'exact' | 'shadow';
  state: SnipingEvidenceState;
  detail: string;
  translated: boolean;
  count?: number;
}

export const simulationProjectionMatchesDetail = (
  run: SnipingSimulationRequestProjection,
  detail: SnipingConfigDetail,
  kind: 'exact' | 'shadow',
): boolean => run.kind === kind && run.config_id === detail.config_id &&
  run.config_revision === detail.config_revision && run.attempts.every((attempt) => {
    const identity = attempt.report?.identity;
    const evidence = attempt.report?.product_evidence;
    return !identity || (
      identity.config_id === detail.config_id &&
      identity.config_revision === detail.config_revision &&
      identity.component_id === detail.component_id &&
      identity.component_version === detail.component_version &&
      identity.schema_hash === detail.schema_hash &&
      identity.chain === detail.chain &&
      !(identity.component_id !== 'flap-quote-token-snipe' &&
        evidence?.schema === 'bl-sniping-flap-product-evidence-v1')
    );
  });

const reportState = (run: SnipingSimulationRequestProjection | null): SnipingEvidenceState => {
  if (run?.evidence_expired) return 'expired';
  const outcome = run ? acceptedSnipingReport(run)?.result.outcome : null;
  if (outcome === 'executable') return 'ready';
  if (outcome === 'blocked') return 'blocked';
  return outcome === 'unknown' ? 'unknown' : 'idle';
};

const requestState = (run: SnipingSimulationRequestProjection | null): SnipingEvidenceState => {
  if (run?.state === 'failed') return 'blocked';
  if (run?.state !== 'completed') return 'idle';
  return reportedSnipingReport(run) ? 'ready' : 'unknown';
};

export const buildSnipingEvidenceStages = (input: {
  runtimeState: string | null;
  canonicalSelected: boolean;
  exact: SnipingSimulationRequestProjection | null;
  shadow: SnipingSimulationRequestProjection | null;
}): SnipingEvidenceStage[] => [
  {
    key: 'signal',
    state: input.runtimeState === 'active' ? 'ready' : 'idle',
    detail: input.runtimeState === 'active' ? 'observerActive' : 'noSignal',
    translated: true,
  },
  {
    key: 'canonical',
    state: input.canonicalSelected ? 'ready' : 'idle',
    detail: input.canonicalSelected ? 'selectedCanonical' : 'noCanonical',
    translated: true,
  },
  {
    key: 'request',
    state: requestState(input.exact),
    detail: input.exact?.state ?? 'noRequest',
    translated: input.exact === null,
  },
  {
    key: 'exact',
    state: reportState(input.exact),
    detail: input.exact ? acceptedSnipingReport(input.exact)?.result.reason_code ?? 'noExact' : 'noExact',
    translated: !input.exact || acceptedSnipingReport(input.exact) === null,
  },
  {
    key: 'shadow',
    state: reportState(input.shadow),
    detail: input.shadow
      ? reportedSnipingReport(input.shadow) ? 'positionCount' : 'positionUnknown'
      : 'noShadow',
    translated: true,
    ...(input.shadow && reportedSnipingReport(input.shadow)
      ? { count: input.shadow.position_count ?? 0 }
      : {}),
  },
];

interface LatestResult {
  stale: boolean;
  error: string | null;
}

export class SnipingLatestEvidenceController {
  exact: SnipingSimulationRequestProjection | null = null;
  shadow: SnipingSimulationRequestProjection | null = null;
  private exactSequence = 0;
  private shadowSequence = 0;

  clear(): void {
    this.exactSequence += 1;
    this.shadowSequence += 1;
    this.exact = null;
    this.shadow = null;
  }

  loadExact(
    bridge: SnipingBridge,
    detail: SnipingConfigDetail,
    isCurrent: () => boolean,
  ): Promise<LatestResult> {
    return this.load('exact', bridge.listExactSimulations({
      config_id: detail.config_id, page: 1, page_size: 1,
    }), detail, isCurrent);
  }

  loadShadow(
    bridge: SnipingBridge,
    detail: SnipingConfigDetail,
    isCurrent: () => boolean,
  ): Promise<LatestResult> {
    return this.load('shadow', bridge.listShadowSimulations({
      config_id: detail.config_id, page: 1, page_size: 1,
    }), detail, isCurrent);
  }

  private async load(
    kind: 'exact' | 'shadow',
    pending: Promise<SnipingBridgeResult<SnipingPage<SnipingSimulationRequestProjection>>>,
    detail: SnipingConfigDetail,
    isCurrent: () => boolean,
  ): Promise<LatestResult> {
    const sequence = kind === 'exact' ? ++this.exactSequence : ++this.shadowSequence;
    const result = await pending;
    const current = kind === 'exact' ? this.exactSequence : this.shadowSequence;
    if (sequence !== current || !isCurrent()) return { stale: true, error: null };
    if (!result.ok) return { stale: false, error: result.error.code };
    if (result.value.list.some((run) => !simulationProjectionMatchesDetail(run, detail, kind))) {
      return { stale: false, error: 'SNIPING_RESPONSE_INTEGRITY' };
    }
    const latest = result.value.list[0] ?? null;
    if (kind === 'exact') this.exact = latest;
    else this.shadow = latest;
    return { stale: false, error: null };
  }
}
