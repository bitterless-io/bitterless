import type {
  MonitoringDetailProjection,
  MonitoringListItem,
  MonitoringProjectedState,
  MonitoringRegion,
  MonitoringRuntimeProjection,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';

export interface MonitoringEvidenceDisplay {
  state: MonitoringProjectedState | null;
  confirmation: 'unknown' | 'paired' | 'confirmed' | 'unconfirmed';
  count: string | null;
  zScore: string | null;
  confirmed: boolean;
  unconfirmed: boolean;
  verifiedZero: boolean;
}

export interface MonitoringChartSegment {
  key: string;
  points: string;
}

export interface MonitoringChartModel {
  countSegments: MonitoringChartSegment[];
  zSegments: MonitoringChartSegment[];
  empty: boolean;
  hasGap: boolean;
  upperThresholdY: number;
  lowerThresholdY: number;
}

export interface MonitoringSampleDisplay {
  sample: MonitoringSampleProjection;
  evidence: MonitoringEvidenceDisplay;
  baselineCount: number | null;
  baselineMean: string | null;
  baselineStddev: string | null;
  blockRange: string | null;
  aggregateZ: string | null;
  releaseIdentity: MonitoringReleaseIdentity;
  regionDiagnostics: MonitoringRegionDiagnosticDisplay[];
}

export interface MonitoringRegionDisplay {
  region: MonitoringRegion;
  runtimeObservedState: string;
  runtimeLagBlocks: string | null;
  runtimeLastErrorCode: string | null;
  runtimeBlockNumber: string | null;
  runtimeSlot: string | null;
  runtimeHeartbeat: string | null;
  evidenceState: MonitoringProjectedState | null;
  evidenceFingerprint: string | null;
}

export interface MonitoringRegionDiagnosticDisplay {
  region: MonitoringRegion;
  state: MonitoringProjectedState;
  count: string | null;
  baselineCount: number;
  baselineMean: string | null;
  baselineStddev: string | null;
  zScore: string | null;
  blockRange: string;
  endHash: string | null;
  completeness: 'COMPLETE' | 'INCOMPLETE_RANGE';
  reason: string;
  fingerprint: string;
}

export interface MonitoringEvidenceIdentity {
  assetKey: string;
  componentId: string;
  componentVersion: string;
  schemaHash: string;
  metricKind: string;
  detectorVersion: string;
  zscoreThreshold: number;
}

export interface MonitoringReleaseIdentity {
  componentId: string;
  componentVersion: string;
  schemaHash: string;
  metricKind: string;
  detectorVersion: string;
}

export interface MonitoringWatchDisplay {
  currentSample: MonitoringSampleProjection | null;
  evidence: MonitoringEvidenceDisplay;
  evidenceIdentity: MonitoringEvidenceIdentity | null;
  baselineCount: number | null;
  baselineState: MonitoringProjectedState | null;
  baselineMinimumCount: number | null;
  regions: MonitoringRegionDisplay[];
  staleRuntime: boolean;
}

export interface MonitoringWatchListDisplay {
  watch: MonitoringListItem;
  regions: Pick<
    MonitoringRegionDisplay,
    'region' | 'runtimeObservedState' | 'runtimeLastErrorCode'
  >[];
}

export type MonitoringCollectionMode = 'loading' | 'error' | 'empty' | 'ready';

export interface MonitoringCollectionDisplayState {
  mode: MonitoringCollectionMode;
  showRows: boolean;
  showEmpty: boolean;
  showRetry: boolean;
  showFooter: boolean;
}

const fixedRegions: MonitoringRegion[] = ['sg', 'jp'];
const staleObservedStates = new Set(['offline', 'degraded', 'expired', 'error']);

const monitoringRuntimeDisplays = (
  runtimes: MonitoringRuntimeProjection[]
): Pick<MonitoringRegionDisplay, 'region' | 'runtimeObservedState' | 'runtimeLastErrorCode'>[] =>
  fixedRegions.map((region) => {
    const runtime = runtimes.find((item) => item.region === region);
    return {
      region,
      runtimeObservedState: runtime?.observed_state ?? 'unknown',
      runtimeLastErrorCode: runtime?.last_error_code ?? null
    };
  });

const signed = (value: string | null): string | null => {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(2)}`;
};

export const monitoringEvidenceDisplay = (
  sample: MonitoringSampleProjection | null
): MonitoringEvidenceDisplay => {
  if (!sample) {
    return {
      state: null,
      confirmation: 'unknown',
      count: null,
      zScore: null,
      confirmed: false,
      unconfirmed: false,
      verifiedZero: false
    };
  }
  const unconfirmed = sample.agreement !== 'MATCHED';
  const confirmation = unconfirmed ? 'unconfirmed' : sample.confirmed ? 'confirmed' : 'paired';
  return {
    state: sample.state,
    confirmation,
    count:
      unconfirmed || sample.transfer_event_count === null
        ? null
        : String(sample.transfer_event_count),
    zScore: unconfirmed ? null : signed(sample.z_score),
    confirmed: sample.confirmed,
    unconfirmed,
    verifiedZero:
      sample.agreement === 'MATCHED' &&
      sample.completeness === 'COMPLETE' &&
      sample.transfer_event_count === 0
  };
};

export const monitoringStateTone = (
  state: MonitoringProjectedState | null
): 'good' | 'warm' | 'bad' | 'neutral' => {
  if (state === 'READY') return 'good';
  if (state === 'WARMING' || state === 'BASELINE_FLAT') return 'warm';
  if (
    state === 'HIGH' ||
    state === 'LOW' ||
    state === 'INCOMPLETE_RANGE' ||
    state === 'REGION_MISMATCH' ||
    state === 'SINGLE_REGION'
  )
    return 'bad';
  return 'neutral';
};

export const monitoringCollectionDisplayState = (
  count: number,
  loading: boolean,
  error: string | undefined
): MonitoringCollectionDisplayState => {
  const mode: MonitoringCollectionMode =
    count > 0 ? 'ready' : loading ? 'loading' : error ? 'error' : 'empty';
  return {
    mode,
    showRows: count > 0,
    showEmpty: mode === 'empty',
    showRetry: Boolean(error),
    showFooter: count > 0 || mode === 'empty'
  };
};

export const shortMonitoringAddress = (address: string): string =>
  address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;

export const monitoringUtcRange = (start: string, end: string): string => {
  const left = new Date(start).toISOString().slice(0, 16).replace('T', ' ');
  const right = new Date(end).toISOString().slice(0, 16).replace('T', ' ');
  return `${left}–${right} UTC`;
};

export const monitoringUtcInstant = (value: string | null): string | null => {
  if (!value) return null;
  return `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
};

export const monitoringDetailCurrent = (
  detail: MonitoringDetailProjection | null,
  configId: string,
  revision: number
): boolean =>
  Boolean(detail && detail.config_id === configId && detail.config_revision === revision);

export const monitoringCurrentSample = (
  samples: MonitoringSampleProjection[],
  samplesRevision: number | null,
  detail: MonitoringDetailProjection | null
): MonitoringSampleProjection | null =>
  samples[0] ??
  (samplesRevision !== null && samplesRevision === detail?.config_revision ? detail.latest : null);

export const monitoringSampleDisplay = (
  sample: MonitoringSampleProjection
): MonitoringSampleDisplay => {
  const evidence = monitoringEvidenceDisplay(sample);
  return {
    sample,
    evidence,
    baselineCount:
      sample.agreement === 'MATCHED'
        ? Math.min(...sample.regions.map((item) => item.baseline_count))
        : null,
    baselineMean: sample.agreement === 'MATCHED' ? sample.baseline_mean : null,
    baselineStddev: sample.agreement === 'MATCHED' ? sample.baseline_stddev : null,
    blockRange: sample.from_block === null ? null : `${sample.from_block}–${sample.to_block}`,
    aggregateZ: evidence.unconfirmed ? null : evidence.zScore,
    releaseIdentity: {
      componentId: sample.component_id,
      componentVersion: sample.component_version,
      schemaHash: sample.schema_hash,
      metricKind: sample.metric_kind,
      detectorVersion: sample.detector_version
    },
    regionDiagnostics: sample.regions.map((region) => ({
      region: region.region,
      state: region.state,
      count: region.transfer_event_count === null ? null : String(region.transfer_event_count),
      baselineCount: region.baseline_count,
      baselineMean: region.baseline_mean,
      baselineStddev: region.baseline_stddev,
      zScore: signed(region.z_score),
      blockRange: `${region.from_block}–${region.to_block}`,
      endHash: region.end_block_hash,
      completeness: region.completeness,
      reason: region.reason_code,
      fingerprint: region.sample_fingerprint
    }))
  };
};

export const monitoringWatchListDisplay = (
  watch: MonitoringListItem
): MonitoringWatchListDisplay => ({
  watch,
  regions: monitoringRuntimeDisplays(watch.runtime)
});

export const monitoringWatchDisplay = (
  samples: MonitoringSampleProjection[],
  samplesRevision: number | null,
  detail: MonitoringDetailProjection | null
): MonitoringWatchDisplay => {
  const currentSample = monitoringCurrentSample(samples, samplesRevision, detail);
  const evidence = monitoringEvidenceDisplay(currentSample);
  const sampleDisplay = currentSample ? monitoringSampleDisplay(currentSample) : null;
  const runtimeDisplays = monitoringRuntimeDisplays(detail?.runtime ?? []);
  const identitySource =
    currentSample ??
    (samplesRevision !== null && samplesRevision === detail?.config_revision ? detail : null);
  return {
    currentSample,
    evidence,
    evidenceIdentity: identitySource
      ? {
          assetKey: identitySource.asset_key,
          componentId: identitySource.component_id,
          componentVersion: identitySource.component_version,
          schemaHash: identitySource.schema_hash,
          metricKind: identitySource.metric_kind,
          detectorVersion: identitySource.detector_version,
          zscoreThreshold: identitySource.zscore_threshold
        }
      : null,
    baselineCount:
      sampleDisplay?.baselineCount ??
      (!currentSample && samplesRevision === detail?.config_revision
        ? detail.readiness.baseline_count
        : null),
    baselineState:
      currentSample?.state ??
      (samplesRevision === detail?.config_revision ? (detail?.readiness.state ?? null) : null),
    baselineMinimumCount:
      currentSample?.state === 'WARMING'
        ? 72
        : currentSample
          ? 288
          : samplesRevision === detail?.config_revision && detail.readiness.state === 'WARMING'
            ? detail.readiness.minimum_baseline_count
            : null,
    regions: runtimeDisplays.map((runtime) => {
      const region = runtime.region;
      const proof = currentSample?.regions.find((item) => item.region === region);
      return {
        ...runtime,
        runtimeLagBlocks:
          detail?.runtime.find((item) => item.region === region)?.lag_blocks ?? null,
        runtimeBlockNumber:
          detail?.runtime.find((item) => item.region === region)?.cursor_summary?.block_number ??
          null,
        runtimeSlot:
          detail?.runtime.find((item) => item.region === region)?.cursor_summary?.slot ?? null,
        runtimeHeartbeat:
          detail?.runtime.find((item) => item.region === region)?.heartbeat_at ?? null,
        evidenceState: proof?.state ?? null,
        evidenceFingerprint: proof?.sample_fingerprint ?? null
      };
    }),
    staleRuntime:
      currentSample !== null &&
      runtimeDisplays.some((runtime) => staleObservedStates.has(runtime.runtimeObservedState))
  };
};

export const monitoringAnomalyDisplay = monitoringSampleDisplay;

export const monitoringSampleMatches = (
  sample: MonitoringSampleProjection,
  detail: MonitoringDetailProjection,
  revision: number
): boolean =>
  sample.config_id === detail.config_id &&
  sample.config_revision === revision &&
  sample.component_id === detail.component_id &&
  sample.component_version === detail.component_version &&
  sample.metric_kind === detail.metric_kind &&
  sample.detector_version === detail.detector_version &&
  (revision !== detail.config_revision ||
    (sample.asset_key === detail.asset_key &&
      sample.schema_hash === detail.schema_hash &&
      sample.zscore_threshold === detail.zscore_threshold));

const finiteRange = (values: number[]): { minimum: number; span: number } => {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return { minimum, span: Math.max(maximum - minimum, 1) };
};

export const buildMonitoringChart = (
  samples: MonitoringSampleProjection[]
): MonitoringChartModel => {
  const ordered = [...samples].reverse();
  const complete = ordered.filter(
    (sample) =>
      sample.agreement === 'MATCHED' &&
      sample.completeness === 'COMPLETE' &&
      sample.transfer_event_count !== null
  );
  const threshold = ordered[0]?.zscore_threshold ?? 3;
  if (complete.length < 1) {
    return {
      countSegments: [],
      zSegments: [],
      empty: true,
      hasGap: ordered.length > 0,
      upperThresholdY: 68.6,
      lowerThresholdY: 79.4
    };
  }
  const counts = complete.map((sample) => sample.transfer_event_count as number);
  const zValues = complete.flatMap((sample) =>
    sample.z_score === null ? [] : [Number(sample.z_score)]
  );
  const countRange = finiteRange(counts);
  const zRange = finiteRange([...zValues, -10, 10, -threshold, threshold]);
  const x = (index: number): number =>
    ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100;
  const countY = (value: number): number =>
    8 + 36 * (1 - (value - countRange.minimum) / countRange.span);
  const zY = (value: number): number => 56 + 36 * (1 - (value - zRange.minimum) / zRange.span);
  const upperThresholdY = zY(threshold);
  const lowerThresholdY = zY(-threshold);
  const countSegments: MonitoringChartSegment[] = [];
  const zSegments: MonitoringChartSegment[] = [];
  let sequenceGap = false;
  let countPoints: string[] = [];
  let zPoints: string[] = [];
  const flushCount = (index: number): void => {
    if (countPoints.length) {
      countSegments.push({
        key: `count-${index}-${countSegments.length}`,
        points: countPoints.join(' ')
      });
    }
    countPoints = [];
  };
  const flushZ = (index: number): void => {
    if (zPoints.length) {
      zSegments.push({ key: `z-${index}-${zSegments.length}`, points: zPoints.join(' ') });
    }
    zPoints = [];
  };
  ordered.forEach((sample, index) => {
    const prior = ordered[index - 1];
    if (prior && BigInt(sample.bucket_sequence) !== BigInt(prior.bucket_sequence) + 1n) {
      sequenceGap = true;
      flushCount(index);
      flushZ(index);
    }
    if (
      sample.agreement !== 'MATCHED' ||
      sample.completeness !== 'COMPLETE' ||
      sample.transfer_event_count === null
    ) {
      flushCount(index);
      flushZ(index);
      return;
    }
    countPoints.push(`${x(index).toFixed(2)},${countY(sample.transfer_event_count).toFixed(2)}`);
    if (sample.z_score === null) flushZ(index);
    else zPoints.push(`${x(index).toFixed(2)},${zY(Number(sample.z_score)).toFixed(2)}`);
  });
  flushCount(ordered.length);
  flushZ(ordered.length);
  return {
    countSegments,
    zSegments,
    empty: false,
    hasGap: sequenceGap || complete.length !== ordered.length,
    upperThresholdY,
    lowerThresholdY
  };
};
