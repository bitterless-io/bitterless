import { Buffer } from 'node:buffer';
import type {
  CoinAiAnalysisTarget,
  CoinAiTargetKind,
  CoinMemeAnalysisResult,
  CoinNullableMetric,
  CoinPersistentData,
  CoinSourceReceipt,
  CoinStateSnapshot,
  CoinStoredAnalysis,
  CoinStoredDecision,
} from '@shared/coin/coinAnalysis.type';
import { COIN_AI_MAX_CONTEXT_BYTES } from './coinAiAnalysis.schema';

const MAX_FACTS = 24;
const MAX_EVIDENCE = 32;
const MAX_RECEIPTS = 8;
const MAX_WARNINGS = 12;
const MAX_MISSING = 16;
const MAX_REASON_ITEMS = 8;
const MAX_REFS_PER_ITEM = 6;
const MAX_CONTEXT_STRING = 360;

type CoinAiFactValue = string | number | boolean | null;

export interface CoinAiEvidenceFact {
  id: string;
  label: string;
  value: CoinAiFactValue;
  evidenceRefs: string[];
}

export interface CoinAiEvidenceSnapshot {
  schema: 'coin-ai-evidence-v1';
  target: {
    kind: CoinAiTargetKind;
    resultId: string;
    asset: string;
    chain: string | null;
  };
  observedFacts: CoinAiEvidenceFact[];
  deterministic: {
    score: number | null;
    confidence: number | null;
    decision: 'BUY' | 'HOLD' | 'SELL' | null;
    reasons: Array<{ code: string; text: string; evidenceRefs: string[] }>;
    invalidation: string[];
    finalDecisionRule: string;
  };
  sourceReceipts: Array<{
    id: string;
    source: string;
    mode: string;
    status: string;
    observedAt: number | null;
    receivedAt: number;
    stale: boolean;
    reason: string | null;
    evidenceIds: string[];
  }>;
  warnings: string[];
  missingDimensions: Array<{ field: string; reason: string }>;
  positionRisk: CoinAiEvidenceFact[];
  evidence: Array<{
    id: string;
    label: string;
    source: 'source' | 'owner_input' | 'derived';
    receiptId: string | null;
  }>;
}

export interface CoinAiEvidenceContext {
  snapshot: CoinAiEvidenceSnapshot;
  json: string;
  evidenceIds: Set<string>;
  stateRevision: number;
}

export class CoinAiEvidenceError extends Error {
  constructor(readonly code: 'context-too-large' | 'target-not-found') {
    super(code);
    this.name = 'CoinAiEvidenceError';
  }
}

export const sanitizeCoinAiEvidenceString = (
  value: unknown,
  max = MAX_CONTEXT_STRING,
): string => {
  const stringValue = String(value ?? '')
    .replace(/https?:\/\/[^\s)\]}>,;]+/gi, '[redacted-url]')
    .replace(
      /\b(api[_-]?key|authorization|password|secret|token)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/\b(?:sk|sess|bearer)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_=-]{96,}/g, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  return stringValue.slice(0, max);
};

const boundedRefs = (refs: string[]): string[] =>
  [...new Set(refs.map((ref) => sanitizeCoinAiEvidenceString(ref, 160)).filter(Boolean))]
    .slice(0, MAX_REFS_PER_ITEM);

const metricValue = <T>(metric: CoinNullableMetric<T>): T | null => metric.value;

const targetRecord = (
  data: CoinPersistentData,
  target: CoinAiAnalysisTarget,
): CoinStoredAnalysis | CoinStoredDecision => {
  if (target.kind === 'strategy') {
    const decision = [...data.decisions].reverse().find(({ id }) => id === target.resultId);
    if (!decision) throw new CoinAiEvidenceError('target-not-found');
    return decision;
  }
  const analysis = [...data.analyses]
    .reverse()
    .find(({ id, type }) => id === target.resultId && type === target.kind);
  if (!analysis) throw new CoinAiEvidenceError('target-not-found');
  return analysis;
};

const relevantStrategyReceipts = (
  data: CoinPersistentData,
  decision: CoinStoredDecision,
): CoinSourceReceipt[] => {
  const evidenceIds = new Set(decision.input.evidence.map(({ id }) => id));
  return data.sourceReceipts.filter((receipt) =>
    (receipt.source === 'strategy-v1' && receipt.observedAt === decision.createdAt) ||
    receipt.evidenceIds.some((id) => evidenceIds.has(id)));
};

const createSnapshotBase = (
  target: CoinAiAnalysisTarget,
  asset: string,
  chain: string | null,
): CoinAiEvidenceSnapshot => ({
  schema: 'coin-ai-evidence-v1',
  target: {
    kind: target.kind,
    resultId: sanitizeCoinAiEvidenceString(target.resultId, 160),
    asset: sanitizeCoinAiEvidenceString(asset, 200),
    chain,
  },
  observedFacts: [],
  deterministic: {
    score: null,
    confidence: null,
    decision: null,
    reasons: [],
    invalidation: [],
    finalDecisionRule:
      'The deterministic strategy decision and hard risk gates are final. AI may explain but never change BUY, HOLD, or SELL; HOLD requires a valid position.',
  },
  sourceReceipts: [],
  warnings: [],
  missingDimensions: [],
  positionRisk: [],
  evidence: [],
});

const addFact = (
  snapshot: CoinAiEvidenceSnapshot,
  label: string,
  value: unknown,
  refs: string[] = [],
  positionRisk = false,
): void => {
  const destination = positionRisk ? snapshot.positionRisk : snapshot.observedFacts;
  if (destination.length >= MAX_FACTS) return;
  const normalizedValue: CoinAiFactValue =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'boolean' || value === null
        ? value
        : sanitizeCoinAiEvidenceString(value);
  destination.push({
    id: `${positionRisk ? 'position-risk' : 'fact'}:${String(destination.length + 1).padStart(2, '0')}`,
    label: sanitizeCoinAiEvidenceString(label, 160),
    value: normalizedValue,
    evidenceRefs: boundedRefs(refs),
  });
};

const addMetric = <T>(
  snapshot: CoinAiEvidenceSnapshot,
  field: string,
  metric: CoinNullableMetric<T>,
): void => {
  if (metric.value === null) {
    if (snapshot.missingDimensions.length < MAX_MISSING) {
      snapshot.missingDimensions.push({
        field: sanitizeCoinAiEvidenceString(field, 160),
        reason: sanitizeCoinAiEvidenceString(metric.reason || 'Unavailable'),
      });
    }
    return;
  }
  addFact(snapshot, field, metric.value, metric.evidenceRefs);
};

const addReceipts = (
  snapshot: CoinAiEvidenceSnapshot,
  receipts: CoinSourceReceipt[],
): void => {
  snapshot.sourceReceipts = receipts.slice(-MAX_RECEIPTS).map((receipt) => ({
    id: sanitizeCoinAiEvidenceString(receipt.id, 160),
    source: receipt.source,
    mode: receipt.mode,
    status: receipt.status,
    observedAt: receipt.observedAt,
    receivedAt: receipt.receivedAt,
    stale: receipt.stale,
    reason: receipt.reason ? sanitizeCoinAiEvidenceString(receipt.reason) : null,
    evidenceIds: boundedRefs(receipt.evidenceIds),
  }));
};

const addMemeEvidence = (
  snapshot: CoinAiEvidenceSnapshot,
  result: CoinMemeAnalysisResult,
): void => {
  const assetMetrics: Array<[string, CoinNullableMetric<unknown>]> = [
    ['Asset name', result.asset.name],
    ['Asset symbol', result.asset.symbol],
    ['Launch stage', result.asset.launchStage],
    ['Price USD', result.asset.priceUsd],
    ['Market cap USD', result.asset.marketCapUsd],
    ['Liquidity USD', result.asset.liquidityUsd],
    ['Chain identity verified', result.asset.chainIdentityVerified],
    ['Contract/account verified', result.asset.contractVerified],
    ['Holder count', result.holderDistribution.holderCount],
    ['Top 10 holding share percent', result.holderDistribution.top10SharePct],
    ['Top 100 holding share percent', result.holderDistribution.top100SharePct],
    ['Fresh-wallet rate percent', result.holderDistribution.freshWalletRatePct],
    ['Bot/degen rate percent', result.holderDistribution.botDegenRatePct],
    ['Entrapment-trader rate percent', result.holderDistribution.entrapmentTraderRatePct],
    ['EOA-only holder count', result.eoaAnalysis.holderCount],
    ['EOA-only holding share percent', result.eoaAnalysis.holdingSharePct],
  ];
  for (const [label, metric] of assetMetrics) addMetric(snapshot, label, metric);

  const universe = result.holderDistribution.holderUniverse;
  addFact(
    snapshot,
    'Holder universe attestation',
    `filtered=${universe.attestation.filtered}; method=${universe.attestation.method}; reason=${universe.attestation.reason ?? 'none'}`,
    universe.attestation.evidenceRefs,
  );
  addFact(
    snapshot,
    'Holder universe coverage',
    `raw=${universe.coverage.rawHolderCount ?? 'unknown'}; source=${universe.coverage.sourceRowCount}/${universe.coverage.sourceLimit}; classified=${universe.coverage.classifiedRowCount}; eligible=${universe.coverage.eligibleRowCount}; excluded=${universe.coverage.excludedRowCount}; unknown=${universe.coverage.unknownRowCount}; top10Complete=${universe.coverage.top10Complete}; top100Complete=${universe.coverage.top100Complete}`,
    universe.attestation.evidenceRefs,
  );
  addFact(
    snapshot,
    'Raw rank 1 classification',
    `sourceRank=${universe.topHolder.sourceRank ?? 'missing'}; address=${universe.topHolder.address ?? 'missing'}; status=${universe.topHolder.status}; class=${universe.topHolder.class ?? 'none'}; reason=${universe.topHolder.reason}`,
    universe.topHolder.evidenceRefs,
  );
  for (const exclusion of universe.exclusionAudit.slice(0, 3)) {
    addFact(
      snapshot,
      `Excluded holder at source rank ${exclusion.sourceRank}`,
      `address=${exclusion.address}; class=${exclusion.class}; reason=${exclusion.reason}`,
      exclusion.evidenceRefs,
    );
  }

  for (const concept of result.concepts.slice(0, 6)) {
    addFact(
      snapshot,
      `Attention concept ${concept.label}`,
      `basis=${concept.basis}; trend=${concept.trend}; attention=${concept.attentionScore.value ?? 'unavailable'}; growth=${concept.growthScore.value ?? 'unavailable'}; evidence=${concept.evidence.slice(0, 3).map((value) => sanitizeCoinAiEvidenceString(value)).join(' | ')}`,
      concept.evidenceRefs,
    );
  }
  for (const cohort of [...result.top100Cohorts, ...result.eoaAnalysis.cohorts].slice(0, 6)) {
    addFact(
      snapshot,
      `${cohort.label} cohort overlap`,
      `matches=${metricValue(cohort.matchCount) ?? 'unavailable'}; holdingSharePct=${metricValue(cohort.holdingSharePct) ?? 'unavailable'}`,
      [...cohort.matchCount.evidenceRefs, ...cohort.holdingSharePct.evidenceRefs],
    );
  }
  for (const wallet of result.keyWallets.slice(0, 4)) {
    addFact(
      snapshot,
      `Key wallet ${wallet.rank}`,
      `address=${wallet.address}; label=${wallet.label}; sharePct=${wallet.holdingSharePct ?? 'unavailable'}; score=${wallet.walletScore ?? 'unavailable'}; reason=${wallet.reason}`,
      wallet.evidenceRefs,
    );
  }

  snapshot.deterministic.score = result.deterministicScore.value;
  snapshot.deterministic.confidence = result.confidence.value;
  snapshot.deterministic.reasons = result.risks.slice(0, MAX_REASON_ITEMS).map((risk) => ({
    code: sanitizeCoinAiEvidenceString(risk.code, 100),
    text: sanitizeCoinAiEvidenceString(`${risk.severity}: ${risk.text}`),
    evidenceRefs: boundedRefs(risk.evidenceRefs),
  }));
  snapshot.warnings = result.warnings
    .slice(0, MAX_WARNINGS)
    .map((value) => sanitizeCoinAiEvidenceString(value));
  snapshot.missingDimensions.push(
    ...result.unavailable.slice(0, Math.max(0, MAX_MISSING - snapshot.missingDimensions.length)).map((item) => ({
      field: sanitizeCoinAiEvidenceString(item.field, 160),
      reason: sanitizeCoinAiEvidenceString(item.reason),
    })),
  );
  addReceipts(snapshot, result.receipts);
};

const addStrategyEvidence = (
  snapshot: CoinAiEvidenceSnapshot,
  data: CoinPersistentData,
  decision: CoinStoredDecision,
): void => {
  const { input, result } = decision;
  const refs = input.evidenceRefs;
  addFact(snapshot, 'Launch stage', input.asset.launchStage, refs.asset);
  addFact(snapshot, 'Token age minutes', input.asset.tokenAgeMinutes, refs.asset);
  addFact(snapshot, 'Price USD', input.market.priceUsd, refs.market);
  addFact(snapshot, 'Liquidity USD', input.market.liquidityUsd, refs.market);
  addFact(snapshot, 'Snapshot age seconds', input.market.snapshotAgeSeconds, refs.market);
  addFact(snapshot, 'Planned entry amount', input.execution.plannedEntryAmount, refs.execution);
  addFact(snapshot, 'Risk budget', input.execution.riskBudget, refs.execution);
  addFact(snapshot, 'Round-trip cost percent', input.execution.roundTripCostPct, refs.execution);
  for (const [label, value] of Object.entries(input.signals)) {
    addFact(snapshot, `Signal ${label}`, value, refs.signals);
  }
  addFact(snapshot, 'Forecast win probability', input.forecast.winProbability, refs.forecast);
  addFact(snapshot, 'Expected upside percent given win', input.forecast.expectedUpsidePctGivenWin, refs.forecast);
  addFact(snapshot, 'Expected downside percent given loss', input.forecast.expectedDownsidePctGivenLoss, refs.forecast);
  addFact(snapshot, 'Sellable', input.risk.sellable, refs.risk, true);
  addFact(snapshot, 'Honeypot confirmed', input.risk.honeypotConfirmed, refs.risk, true);
  addFact(snapshot, 'Critical source conflict', input.risk.criticalSourceConflict, refs.risk, true);
  if (input.position) {
    addFact(snapshot, 'Position entry price', input.position.entryPrice, refs.position, true);
    addFact(snapshot, 'Position remaining amount', input.position.remainingAmount, refs.position, true);
    addFact(snapshot, 'Position invested amount', input.position.investedAmount, refs.position, true);
    addFact(snapshot, 'Position peak price', input.position.peakPrice, refs.position, true);
    addFact(snapshot, 'Position held minutes', input.position.heldMinutes, refs.position, true);
  } else {
    snapshot.missingDimensions.push({
      field: 'position',
      reason: 'No existing position was supplied; deterministic HOLD is ineligible.',
    });
  }

  snapshot.deterministic.score = result.score;
  snapshot.deterministic.confidence = result.confidence;
  snapshot.deterministic.decision = result.decision;
  snapshot.deterministic.reasons = result.reasons.slice(0, MAX_REASON_ITEMS).map((reason) => ({
    code: sanitizeCoinAiEvidenceString(reason.code, 100),
    text: sanitizeCoinAiEvidenceString(reason.text),
    evidenceRefs: boundedRefs(reason.evidenceRefs),
  }));
  snapshot.deterministic.invalidation = result.invalidation
    .slice(0, MAX_REASON_ITEMS)
    .map((value) => sanitizeCoinAiEvidenceString(value));
  addReceipts(snapshot, relevantStrategyReceipts(data, decision));

  const descriptors = new Map(input.evidence.map((item) => [item.id, item]));
  for (const descriptor of descriptors.values()) {
    snapshot.evidence.push({
      id: sanitizeCoinAiEvidenceString(descriptor.id, 160),
      label: sanitizeCoinAiEvidenceString(descriptor.label, 240),
      source: descriptor.source,
      receiptId: null,
    });
  }
};

const addMonitorEvidence = (
  snapshot: CoinAiEvidenceSnapshot,
  analysis: CoinStoredAnalysis,
): void => {
  if (analysis.result.schema !== 'coin-monitor-v1') throw new CoinAiEvidenceError('target-not-found');
  const result = analysis.result;
  for (const row of result.rows.slice(0, 20)) {
    addFact(
      snapshot,
      `Monitor ${row.symbol}`,
      `state=${row.state}; price=${row.currentPrice ?? 'unavailable'}; lowMultiple=${row.lowMultiple ?? 'unavailable'}; listingAgeDays=${row.listingAgeDays ?? 'unavailable'}; freshnessSeconds=${row.freshnessSeconds ?? 'unavailable'}; reason=${row.reason ?? 'none'}`,
      row.evidenceIds,
    );
  }
  snapshot.missingDimensions = result.missingSymbols.slice(0, MAX_MISSING).map((symbol) => ({
    field: sanitizeCoinAiEvidenceString(symbol, 32),
    reason: 'The requested symbol was missing from the source response.',
  }));
  addReceipts(snapshot, result.receipts);
};

const addScreenerEvidence = (
  snapshot: CoinAiEvidenceSnapshot,
  analysis: CoinStoredAnalysis,
): void => {
  if (analysis.result.schema !== 'coin-screener-v1') throw new CoinAiEvidenceError('target-not-found');
  const result = analysis.result;
  addFact(snapshot, 'Screen mode', result.mode);
  addFact(snapshot, 'Scanned count', result.scanned);
  addFact(snapshot, 'Matched count', result.matched);
  addFact(snapshot, 'Rejected count', result.rejected);
  for (const filter of result.filters.slice(0, 12)) {
    addFact(snapshot, `Filter ${filter.field}`, `${filter.op}:${JSON.stringify(filter.value)}`);
  }
  for (const row of result.rows.slice(0, 16)) {
    addFact(
      snapshot,
      `Screen rank ${row.rank} ${row.symbol}`,
      `score=${row.score ?? 'unavailable'}; price=${row.currentPrice ?? 'unavailable'}; multiple=${row.priceMultiple ?? 'unavailable'}; listingAgeDays=${row.listingAgeDays ?? 'unavailable'}; fundingPct=${row.fundingRatePct ?? 'unavailable'}; warning=${row.warning ?? 'none'}`,
      row.evidenceIds,
    );
  }
  snapshot.warnings = result.warnings
    .slice(0, MAX_WARNINGS)
    .map((value) => sanitizeCoinAiEvidenceString(value));
  addReceipts(snapshot, result.receipts);
};

const finalizeEvidence = (snapshot: CoinAiEvidenceSnapshot): void => {
  const derivedId = sanitizeCoinAiEvidenceString(
    `derived:${snapshot.target.kind}:${snapshot.target.resultId}`,
    160,
  );
  if (!snapshot.observedFacts.length) addFact(snapshot, 'Validated stored result', snapshot.target.kind, [derivedId]);
  if (!snapshot.deterministic.reasons.length) {
    snapshot.deterministic.reasons.push({
      code: 'STORED_RESULT',
      text: 'Interpret only the validated deterministic and source-backed fields in this snapshot.',
      evidenceRefs: [derivedId],
    });
  }

  const receiptByEvidence = new Map<string, { id: string; source: string }>();
  for (const receipt of snapshot.sourceReceipts) {
    for (const id of receipt.evidenceIds) receiptByEvidence.set(id, receipt);
  }
  const used = new Set<string>([derivedId]);
  for (const fact of [...snapshot.observedFacts, ...snapshot.positionRisk]) {
    fact.evidenceRefs.forEach((ref) => used.add(ref));
  }
  for (const reason of snapshot.deterministic.reasons) {
    reason.evidenceRefs.forEach((ref) => used.add(ref));
  }
  for (const receipt of snapshot.sourceReceipts) {
    receipt.evidenceIds.forEach((ref) => used.add(ref));
  }

  const existing = new Map(snapshot.evidence.map((item) => [item.id, item]));
  if (!existing.has(derivedId)) {
    existing.set(derivedId, {
      id: derivedId,
      label: `Validated ${snapshot.target.kind} result`,
      source: 'derived',
      receiptId: null,
    });
  }
  for (const id of used) {
    if (existing.has(id)) continue;
    const receipt = receiptByEvidence.get(id);
    existing.set(id, {
      id,
      label: receipt ? `${receipt.source} source evidence` : 'Validated result evidence',
      source: receipt ? 'source' : 'derived',
      receiptId: receipt?.id ?? null,
    });
  }
  snapshot.evidence = [...existing.values()].filter(({ id }) => used.has(id)).slice(0, MAX_EVIDENCE);
  const allowed = new Set(snapshot.evidence.map(({ id }) => id));
  const filterRefs = (refs: string[]): string[] => refs.filter((ref) => allowed.has(ref));
  for (const fact of [...snapshot.observedFacts, ...snapshot.positionRisk]) {
    fact.evidenceRefs = filterRefs(fact.evidenceRefs);
  }
  for (const reason of snapshot.deterministic.reasons) {
    reason.evidenceRefs = filterRefs(reason.evidenceRefs);
  }
  for (const receipt of snapshot.sourceReceipts) {
    receipt.evidenceIds = filterRefs(receipt.evidenceIds);
  }
};

export const buildCoinAiEvidenceContext = (
  state: CoinStateSnapshot,
  target: CoinAiAnalysisTarget,
): CoinAiEvidenceContext => {
  const record = targetRecord(state.data, target);
  let snapshot: CoinAiEvidenceSnapshot;
  if (target.kind === 'strategy') {
    const decision = record as CoinStoredDecision;
    snapshot = createSnapshotBase(target, decision.input.asset.contractAddress, decision.input.asset.chain);
    addStrategyEvidence(snapshot, state.data, decision);
  } else {
    const analysis = record as CoinStoredAnalysis;
    const asset = target.kind === 'screener'
      ? 'ranked-market-screen'
      : target.kind === 'monitor' && analysis.result.schema === 'coin-monitor-v1'
        ? analysis.result.requestedSymbols.slice(0, 20).join(',')
        : analysis.asset;
    snapshot = createSnapshotBase(target, asset, analysis.chain);
    if (target.kind === 'monitor') addMonitorEvidence(snapshot, analysis);
    if (target.kind === 'screener') addScreenerEvidence(snapshot, analysis);
    if (target.kind === 'meme') {
      if (analysis.result.schema !== 'coin-meme-analysis-v1') {
        throw new CoinAiEvidenceError('target-not-found');
      }
      addMemeEvidence(snapshot, analysis.result);
    }
  }

  finalizeEvidence(snapshot);
  let json = JSON.stringify(snapshot);
  while (Buffer.byteLength(json, 'utf8') > COIN_AI_MAX_CONTEXT_BYTES && snapshot.observedFacts.length > 10) {
    snapshot.observedFacts.pop();
    finalizeEvidence(snapshot);
    json = JSON.stringify(snapshot);
  }
  if (Buffer.byteLength(json, 'utf8') > COIN_AI_MAX_CONTEXT_BYTES) {
    throw new CoinAiEvidenceError('context-too-large');
  }
  return {
    snapshot,
    json,
    evidenceIds: new Set(snapshot.evidence.map(({ id }) => id)),
    stateRevision: state.revision,
  };
};
