import type {
  CoinDiscoverCandidate,
  CoinDiscoverInput,
  CoinLaunchStage,
  CoinSourceReceipt,
} from '@shared/coin/coinAnalysis.type';
import { finiteNumber, isRecord, stringValue, timestampValue } from './coinData.normalize';

const firstArray = (value: unknown, depth = 0): unknown[] => {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.slice(0, 200);
  if (!isRecord(value)) return [];
  for (const key of ['candidates', 'items', 'list', 'tokens', 'data', 'rank']) {
    if (Array.isArray(value[key])) return (value[key] as unknown[]).slice(0, 200);
  }
  for (const key of ['data', 'result']) {
    const nested = firstArray(value[key], depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
};

const valueByKeys = (value: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
};

const stageValue = (value: unknown): CoinLaunchStage | null => {
  const text = stringValue(value, 80)?.toLowerCase().replace(/[ -]+/g, '_');
  if (!text) return null;
  const aliases: Record<string, CoinLaunchStage> = {
    new_creation: 'discovered',
    discovered: 'discovered',
    filling: 'filling',
    near_completion: 'near_graduation',
    near_graduation: 'near_graduation',
    migration_pending: 'migration_pending',
    completed: 'graduated_recently',
    graduated: 'graduated_recently',
    graduated_recently: 'graduated_recently',
    dex_live: 'dex_live',
    cooled: 'cooled',
    rejected: 'rejected',
    stale: 'stale',
  };
  return aliases[text] ?? null;
};

const boundedScore = (value: unknown): number | null => {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
};

const pollPriority = (stage: CoinLaunchStage | null, progress: number | null): number => {
  const stageBase: Record<CoinLaunchStage, number> = {
    discovered: 35,
    filling: 45,
    near_graduation: 85,
    migration_pending: 100,
    graduated_recently: 90,
    dex_live: 55,
    cooled: 20,
    rejected: 0,
    stale: 5,
  };
  const base = stage ? stageBase[stage] : 25;
  const progressBoost = progress === null ? 0 : Math.max(0, Math.min(15, (progress - 70) / 2));
  return Math.round(Math.max(0, Math.min(100, base + progressBoost)));
};

const researchScore = (
  explicit: number | null,
  attention: number | null,
  overlap: number | null,
  risk: number | null,
): number | null => {
  if (explicit !== null) return explicit;
  const positive = [attention, overlap].filter((value): value is number => value !== null);
  if (positive.length < 1 || risk === null) return null;
  const average = positive.reduce((sum, value) => sum + value, 0) / positive.length;
  return Math.round(Math.max(0, Math.min(100, average * 0.75 + (100 - risk) * 0.25)) * 100) / 100;
};

const normalizeCandidate = (
  value: unknown,
  input: CoinDiscoverInput,
  now: number,
  receiptEvidence: string[],
  previous: Map<string, CoinDiscoverCandidate>,
): CoinDiscoverCandidate | null => {
  if (!isRecord(value)) return null;
  const contractAddress = stringValue(
    valueByKeys(value, ['contractAddress', 'contract_address', 'address', 'ca', 'token_address']),
    160,
  );
  if (!contractAddress) return null;
  const stage = stageValue(valueByKeys(value, ['launchStage', 'launch_stage', 'stage', 'status', 'type']));
  if (stage && !input.stages.includes(stage)) return null;
  const progressRaw = finiteNumber(valueByKeys(value, ['curveProgressPct', 'curve_progress_pct', 'progress', 'progress_pct']));
  const progress = progressRaw !== null && progressRaw >= 0 && progressRaw <= 100 ? progressRaw : null;
  const attention = boundedScore(valueByKeys(value, ['attentionScore', 'attention_score', 'hot_score']));
  const overlap = boundedScore(valueByKeys(value, ['overlapScore', 'wallet_overlap_score', 'overlap_score']));
  const risk = boundedScore(valueByKeys(value, ['riskScore', 'risk_score']));
  const explicitResearch = boundedScore(valueByKeys(value, ['researchScore', 'research_score', 'score']));
  const score = researchScore(explicitResearch, attention, overlap, risk);
  const prior = previous.get(contractAddress.toLowerCase());
  const observedAt = timestampValue(valueByKeys(value, ['observedAt', 'observed_at', 'updated_at', 'created_at'])) ?? now;
  const reasonCodes: string[] = [];
  if (!prior) reasonCodes.push('CANDIDATE_DISCOVERED');
  if (prior && prior.launchStage !== stage) reasonCodes.push('LAUNCH_STAGE_CHANGED');
  if (progress !== null && prior?.curveProgressPct !== null && prior?.curveProgressPct !== undefined && progress > prior.curveProgressPct) {
    reasonCodes.push('CURVE_PROGRESS_ADVANCED');
  }
  if (score !== null && prior?.researchScore !== null && prior?.researchScore !== undefined && score > prior.researchScore) {
    reasonCodes.push('RESEARCH_SCORE_INCREASED');
  }
  if (risk !== null && prior?.riskScore !== null && prior?.riskScore !== undefined && risk > prior.riskScore) {
    reasonCodes.push('RISK_SCORE_INCREASED');
  }
  if (reasonCodes.length === 0) reasonCodes.push('SOURCE_SNAPSHOT_UPDATED');
  const stale = now - observedAt > input.intervalSeconds * 2_000;
  return {
    chain: input.chain,
    contractAddress,
    name: stringValue(valueByKeys(value, ['name', 'token_name']), 200),
    symbol: stringValue(valueByKeys(value, ['symbol', 'token_symbol', 'ticker']), 80),
    launchStage: stage,
    ageMinutes: finiteNumber(valueByKeys(value, ['ageMinutes', 'age_minutes', 'token_age_minutes'])),
    curveProgressPct: progress,
    attentionScore: attention,
    overlapScore: overlap,
    riskScore: risk,
    pollPriority: pollPriority(stage, progress),
    researchScore: score,
    scoreDelta: score !== null && prior?.researchScore !== null && prior?.researchScore !== undefined
      ? Math.round((score - prior.researchScore) * 100) / 100
      : null,
    reasonCodes,
    observedAt,
    nextPollAt: now + input.intervalSeconds * 1000,
    stale,
    evidenceRefs: receiptEvidence,
  };
};

export const normalizeDiscoverCandidates = (
  payloads: unknown[],
  input: CoinDiscoverInput,
  previousCandidates: CoinDiscoverCandidate[],
  receipts: CoinSourceReceipt[],
  now: number,
): CoinDiscoverCandidate[] => {
  const previous = new Map(previousCandidates.map((candidate) => [candidate.contractAddress.toLowerCase(), candidate]));
  const evidence = receipts.flatMap((receipt) => receipt.evidenceIds);
  const candidates = new Map<string, CoinDiscoverCandidate>();
  for (const payload of payloads) {
    for (const value of firstArray(payload)) {
      const candidate = normalizeCandidate(value, input, now, evidence, previous);
      if (!candidate) continue;
      const key = candidate.contractAddress.toLowerCase();
      const current = candidates.get(key);
      if (!current || candidate.pollPriority > current.pollPriority) candidates.set(key, candidate);
    }
  }
  return [...candidates.values()]
    .sort((left, right) =>
      right.pollPriority - left.pollPriority ||
      (right.researchScore ?? -1) - (left.researchScore ?? -1) ||
      left.contractAddress.localeCompare(right.contractAddress),
    )
    .slice(0, input.limit);
};
