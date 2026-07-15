export const COIN_CHAINS = ['robinhood', 'bsc', 'solana'] as const;
export const COIN_LAUNCH_STAGES = [
  'discovered',
  'filling',
  'near_graduation',
  'migration_pending',
  'graduated_recently',
  'dex_live',
  'cooled',
  'rejected',
  'stale',
] as const;
export const COIN_AI_MODELS = ['gpt-5.5', 'gpt-5.4'] as const;
export const COIN_AI_EFFORTS = ['low', 'medium', 'high'] as const;
export const COIN_HOLDER_EXCLUSION_CLASSES = [
  'burn_null_system',
  'exchange_custody',
  'liquidity_pool',
  'contract_program',
  'bridge_router',
  'treasury_vesting',
  'other_non_independent',
] as const;

export type CoinChain = (typeof COIN_CHAINS)[number];
export type CoinLaunchStage = (typeof COIN_LAUNCH_STAGES)[number];
export type CoinMemeSourceMode = 'service' | 'local_cli_rpc';
export type CoinScreenerMode = 'live_public' | 'sample';
export type CoinDataState = 'ready' | 'partial' | 'unavailable' | 'error' | 'cancelled';
export type CoinReceiptState = 'ready' | 'partial' | 'unavailable' | 'error' | 'stale';
export type CoinDecision = 'BUY' | 'HOLD' | 'SELL';
export type CoinAiModel = (typeof COIN_AI_MODELS)[number];
export type CoinAiEffort = (typeof COIN_AI_EFFORTS)[number];
export type CoinAiTargetKind = 'monitor' | 'screener' | 'meme' | 'strategy';
export type CoinHolderExclusionClass = (typeof COIN_HOLDER_EXCLUSION_CLASSES)[number];
export type CoinHolderClassificationStatus = 'independent' | 'excluded' | 'unknown';

export interface CoinAiAnalysisTarget {
  kind: CoinAiTargetKind;
  resultId: string;
}

export interface CoinAiAnalysisResult {
  schema: 'coin-ai-analysis-v1';
  summary: string;
  attentionThesis: string[];
  risks: string[];
  evidenceRefs: string[];
  unsupportedClaims: string[];
  confidence: number;
}

export interface CoinAiAnalysisReceipt {
  schema: 'coin-ai-analysis-receipt-v1';
  runId: string;
  target: CoinAiAnalysisTarget;
  provider: 'openai-codex';
  model: CoinAiModel;
  effort: CoinAiEffort;
  contextHash: string;
  startedAt: number;
  completedAt: number;
  evidenceRefs: string[];
  result: CoinAiAnalysisResult;
}

export interface CoinAiPreferences {
  model: CoinAiModel;
  effort: CoinAiEffort;
}

export interface CoinAiPersistentState extends CoinAiPreferences {
  receipts: CoinAiAnalysisReceipt[];
}

export interface CoinAiAnalyzeInput extends CoinAiPreferences {
  runId: string;
  target: CoinAiAnalysisTarget;
}

export type CoinAiRunErrorCode =
  | 'busy'
  | 'context-too-large'
  | 'effort-mismatch'
  | 'invalid-input'
  | 'invalid-output'
  | 'model-mismatch'
  | 'not-connected'
  | 'output-too-large'
  | 'persistence-error'
  | 'provider-error'
  | 'runtime-unavailable'
  | 'stale-run'
  | 'target-not-found'
  | 'timeout'
  | 'tool-violation'
  | 'unsupported-evidence';

export interface CoinAiRunError {
  code: CoinAiRunErrorCode;
  message: string;
  retryable: boolean;
}

export type CoinAiAnalyzeResult =
  | {
      status: 'completed';
      runId: string;
      receipt: CoinAiAnalysisReceipt;
      snapshot: CoinStateSnapshot;
    }
  | { status: 'cancelled'; runId: string }
  | { status: 'error'; runId: string; error: CoinAiRunError };

export interface CoinAiCancelInput {
  runId: string;
}

export interface CoinAiCancelReceipt {
  runId: string;
  cancelled: boolean;
}

export type CoinSourceId =
  | 'monitor-http'
  | 'monitor-ws'
  | 'screener'
  | 'meme-service'
  | 'gmgn-cli'
  | 'alchemy-robinhood'
  | 'alchemy-bsc'
  | 'alchemy-solana'
  | 'owner-cohorts'
  | 'strategy-v1';

export interface CoinDataError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CoinSourceReceipt {
  id: string;
  source: CoinSourceId;
  mode: 'http' | 'websocket' | 'sample' | 'service' | 'local_cli' | 'local_rpc' | 'deterministic';
  status: CoinReceiptState;
  observedAt: number | null;
  receivedAt: number;
  stale: boolean;
  reason: string | null;
  evidenceIds: string[];
}

export interface CoinDataEnvelope<T> {
  status: CoinDataState;
  data: T | null;
  receipt: CoinSourceReceipt;
  error: CoinDataError | null;
}

export interface CoinDataSourceStatus {
  source: CoinSourceId;
  configured: boolean;
  support: 'read-only' | 'sample' | 'partial' | 'unsupported' | 'unavailable';
  state: CoinReceiptState;
  lastObservedAt: number | null;
  cooldownUntil: number | null;
  reason: string | null;
}

export interface CoinCancelInput {
  requestId: string;
}

export interface CoinCancelReceipt {
  requestId: string;
  cancelled: boolean;
}

export type CoinMonitorSort = 'low_multiple_asc' | 'low_multiple_desc' | 'symbol_asc';

export interface CoinMonitorInput {
  requestId: string;
  symbols: string[];
  connectLive: boolean;
}

export interface CoinMonitorRow {
  symbol: string;
  venue: 'binance-usdm';
  currentPrice: number | null;
  historicalLowPrice: number | null;
  historicalHighPrice: number | null;
  lowMultiple: number | null;
  listedAt: number | null;
  listingAgeDays: number | null;
  observedAt: number | null;
  freshnessSeconds: number | null;
  state: 'ready' | 'stale' | 'error';
  reason: string | null;
  evidenceIds: string[];
}

export interface CoinMonitorResult {
  schema: 'coin-monitor-v1';
  requestedSymbols: string[];
  rows: CoinMonitorRow[];
  missingSymbols: string[];
  readAt: number;
  connection: 'connecting' | 'live' | 'retrying' | 'closed' | 'unavailable' | 'error';
  receipts: CoinSourceReceipt[];
}

export type CoinMonitorEvent =
  | {
      type: 'connection';
      connection: CoinMonitorResult['connection'];
      reason: string | null;
      receipt: CoinSourceReceipt;
    }
  | {
      type: 'row';
      row: CoinMonitorRow;
      receipt: CoinSourceReceipt;
    };

export type CoinFilterOperator = 'gte' | 'lte' | 'eq' | 'between';
export type CoinFilterValue = string | number | [string | number, string | number];

export interface CoinFilterClause {
  field: string;
  op: CoinFilterOperator;
  value: CoinFilterValue;
}

export interface CoinScreenerParseInput {
  requestId: string;
  query: string;
}

export interface CoinScreenerParsedQuery {
  query: string;
  mode: CoinScreenerMode;
  exchange: string;
  market: string;
  quoteAsset: string;
  contractType: string;
  filters: CoinFilterClause[];
  symbols: string[];
  limit: number;
  warnings: string[];
  parser: 'deterministic' | 'llm' | 'external';
}

export interface CoinScreenerParseResult {
  schema: 'coin-screener-parse-v1';
  parsed: CoinScreenerParsedQuery;
  receipt: CoinSourceReceipt;
}

export interface CoinScreenerInput {
  requestId: string;
  query: string;
  mode: CoinScreenerMode;
  symbols: string[];
  maxSymbols: number;
  limit: number;
  filters: CoinFilterClause[];
}

export interface CoinScreenerRow {
  rank: number;
  symbol: string;
  score: number | null;
  state: string | null;
  currentPrice: number | null;
  historicalLowPrice: number | null;
  priceMultiple: number | null;
  listingAgeDays: number | null;
  fundingRatePct: number | null;
  fundingRateSpreadPct: number | null;
  warning: string | null;
  evidenceIds: string[];
}

export interface CoinScreenerResult {
  schema: 'coin-screener-v1';
  mode: CoinScreenerMode;
  generatedAt: number;
  scanned: number;
  matched: number;
  rejected: number;
  filters: CoinFilterClause[];
  rows: CoinScreenerRow[];
  warnings: string[];
  receipts: CoinSourceReceipt[];
}

export interface CoinNullableMetric<T> {
  value: T | null;
  reason: string | null;
  evidenceRefs: string[];
}

export interface CoinRatioMetric extends CoinNullableMetric<number> {
  numerator: number | null;
  denominator: number | null;
}

export interface CoinMemeAnalyzeInput {
  requestId: string;
  mode: CoinMemeSourceMode;
  chain: CoinChain;
  contractAddress: string;
  holderLimit: number;
  traderLimit: number;
}

export interface CoinMemeAsset {
  chain: CoinChain;
  contractAddress: string;
  name: CoinNullableMetric<string>;
  symbol: CoinNullableMetric<string>;
  launchStage: CoinNullableMetric<CoinLaunchStage>;
  priceUsd: CoinNullableMetric<number>;
  marketCapUsd: CoinNullableMetric<number>;
  liquidityUsd: CoinNullableMetric<number>;
  chainIdentityVerified: CoinNullableMetric<boolean>;
  contractVerified: CoinNullableMetric<boolean>;
}

export interface CoinHolderExclusionAudit {
  sourceRank: number;
  address: string;
  class: CoinHolderExclusionClass;
  reason: string;
  evidenceRefs: string[];
}

export interface CoinTopHolderClassification {
  sourceRank: number | null;
  address: string | null;
  status: CoinHolderClassificationStatus;
  class: CoinHolderExclusionClass | null;
  reason: string;
  evidenceRefs: string[];
}

export interface CoinHolderUniverseCoverage {
  rawHolderCount: number | null;
  sourceLimit: number;
  sourceRowCount: number;
  classifiedRowCount: number;
  eligibleRowCount: number;
  excludedRowCount: number;
  unknownRowCount: number;
  top10EligibleCount: number;
  top10Complete: boolean;
  top100EligibleCount: number;
  top100Complete: boolean;
}

export interface CoinHolderUniverseMetadata {
  attestation: {
    filtered: boolean;
    method: 'local-classifier-v1' | 'service-attestation' | 'unattested';
    reason: string | null;
    evidenceRefs: string[];
  };
  topHolder: CoinTopHolderClassification;
  coverage: CoinHolderUniverseCoverage;
  exclusionAudit: CoinHolderExclusionAudit[];
}

export const createUnattestedCoinHolderUniverse = (
  reason = 'This result does not attest that holder-derived values use the filtered holder universe.',
): CoinHolderUniverseMetadata => ({
  attestation: {
    filtered: false,
    method: 'unattested',
    reason,
    evidenceRefs: [],
  },
  topHolder: {
    sourceRank: null,
    address: null,
    status: 'unknown',
    class: null,
    reason,
    evidenceRefs: [],
  },
  coverage: {
    rawHolderCount: null,
    sourceLimit: 0,
    sourceRowCount: 0,
    classifiedRowCount: 0,
    eligibleRowCount: 0,
    excludedRowCount: 0,
    unknownRowCount: 0,
    top10EligibleCount: 0,
    top10Complete: false,
    top100EligibleCount: 0,
    top100Complete: false,
  },
  exclusionAudit: [],
});

export interface CoinMemeHolderDistribution {
  holderCount: CoinNullableMetric<number>;
  top10SharePct: CoinRatioMetric;
  top100SharePct: CoinRatioMetric;
  freshWalletRatePct: CoinRatioMetric;
  botDegenRatePct: CoinRatioMetric;
  entrapmentTraderRatePct: CoinRatioMetric;
  excludedAddressCount: CoinNullableMetric<number>;
  excludedByType: Array<{ type: string; count: number; evidenceRefs: string[] }>;
  holderUniverse: CoinHolderUniverseMetadata;
}

export type CoinCohortKey = 'curated' | 'robinhood' | 'bsc' | 'pvp';

export interface CoinCohortOverlap {
  cohort: CoinCohortKey;
  label: string;
  matchCount: CoinNullableMetric<number>;
  holdingSharePct: CoinRatioMetric;
}

export interface CoinMemeEoaAnalysis {
  label: 'EOA' | 'INDEPENDENT_WALLET';
  holderCount: CoinNullableMetric<number>;
  holdingSharePct: CoinRatioMetric;
  cohorts: CoinCohortOverlap[];
}

export interface CoinKeyWallet {
  rank: number;
  address: string;
  holderRank: number | null;
  sourceHolderRank?: number | null;
  label: string;
  cohorts: CoinCohortKey[];
  holdingSharePct: number | null;
  tokenAmount: number | null;
  positionValueUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  walletScore: number | null;
  reason: string;
  evidenceRefs: string[];
}

export interface CoinAttentionConcept {
  rank: number;
  key: string;
  label: string;
  basis: 'observed' | 'inferred';
  trend: 'RISING' | 'STABLE' | 'FALLING' | 'UNAVAILABLE';
  attentionScore: CoinNullableMetric<number>;
  growthScore: CoinNullableMetric<number>;
  noveltyScore: CoinNullableMetric<number>;
  saturationScore: CoinNullableMetric<number>;
  representativeTokens: string[];
  evidence: string[];
  counterEvidence: string[];
  risks: string[];
  evidenceRefs: string[];
}

export interface CoinTokenConceptFit {
  conceptKey: string;
  basis: 'observed' | 'inferred';
  fitScore: CoinNullableMetric<number>;
  summary: string;
  evidence: string[];
  evidenceRefs: string[];
}

export interface CoinRiskEvidence {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  text: string;
  evidenceRefs: string[];
}

export interface CoinUnavailableField {
  field: string;
  reason: string;
  source: CoinSourceId | null;
}

export interface CoinMemeAnalysisResult {
  schema: 'coin-meme-analysis-v1';
  id: string;
  mode: CoinMemeSourceMode;
  generatedAt: number;
  asset: CoinMemeAsset;
  holderDistribution: CoinMemeHolderDistribution;
  top100Cohorts: CoinCohortOverlap[];
  eoaAnalysis: CoinMemeEoaAnalysis;
  keyWallets: CoinKeyWallet[];
  keyWalletsReason: string | null;
  concepts: CoinAttentionConcept[];
  tokenConceptFits: CoinTokenConceptFit[];
  conceptsReason: string | null;
  risks: CoinRiskEvidence[];
  deterministicScore: CoinNullableMetric<number>;
  confidence: CoinNullableMetric<number>;
  unavailable: CoinUnavailableField[];
  warnings: string[];
  receipts: CoinSourceReceipt[];
}

export interface CoinDiscoverInput {
  mode: CoinMemeSourceMode;
  chain: CoinChain;
  stages: CoinLaunchStage[];
  windowMinutes: 15 | 60 | 360 | 1440;
  limit: number;
  intervalSeconds: number;
}

export interface CoinDiscoverCandidate {
  chain: CoinChain;
  contractAddress: string;
  name: string | null;
  symbol: string | null;
  launchStage: CoinLaunchStage | null;
  ageMinutes: number | null;
  curveProgressPct: number | null;
  attentionScore: number | null;
  overlapScore: number | null;
  riskScore: number | null;
  pollPriority: number;
  researchScore: number | null;
  scoreDelta: number | null;
  reasonCodes: string[];
  observedAt: number;
  nextPollAt: number;
  stale: boolean;
  evidenceRefs: string[];
}

export interface CoinDiscoverSnapshot {
  schema: 'coin-discover-v1';
  sessionId: string;
  running: boolean;
  mode: CoinMemeSourceMode;
  chain: CoinChain;
  candidates: CoinDiscoverCandidate[];
  startedAt: number;
  completedAt: number | null;
  nextPollAt: number | null;
  error: CoinDataError | null;
  receipts: CoinSourceReceipt[];
}

export interface CoinDiscoverStartReceipt {
  started: boolean;
  sessionId: string;
  mode: CoinMemeSourceMode;
  intervalSeconds: number;
  error: CoinDataError | null;
}

export interface CoinDiscoverStopReceipt {
  stopped: boolean;
  sessionId: string | null;
}

export interface CoinEvidenceDescriptor {
  id: string;
  label: string;
  source: 'source' | 'owner_input' | 'derived';
}

export interface CoinStrategyPosition {
  entryPrice: number;
  remainingAmount: number;
  investedAmount: number;
  peakPrice: number | null;
  heldMinutes: number;
}

export interface CoinStrategyInput {
  schema: 'coin-strategy-input-v1';
  asset: {
    chain: CoinChain;
    contractAddress: string;
    launchStage: CoinLaunchStage;
    tokenAgeMinutes: number;
  };
  market: {
    priceUsd: number;
    liquidityUsd: number;
    snapshotAgeSeconds: number;
  };
  execution: {
    plannedEntryAmount: number;
    riskBudget: number;
    roundTripCostPct: number;
  };
  signals: {
    walletOverlapScore: number;
    attentionPotentialScore: number;
    momentumScore: number;
    buyerQualityScore: number;
    holderHealthScore: number;
    liquidityScore: number;
    smartMoneyFlowScore: number;
    graduationScore: number;
    riskScore: number;
    dataConfidence: number;
  };
  forecast: {
    modelVersion: string;
    horizonMinutes: 60;
    winProbability: number;
    expectedUpsidePctGivenWin: number;
    expectedDownsidePctGivenLoss: number;
  };
  risk: {
    sellable: boolean;
    honeypotConfirmed: boolean;
    criticalSourceConflict: boolean;
  };
  position: CoinStrategyPosition | null;
  evidence: CoinEvidenceDescriptor[];
  evidenceRefs: {
    asset: string[];
    market: string[];
    execution: string[];
    signals: string[];
    forecast: string[];
    risk: string[];
    position: string[];
  };
}

export interface CoinDecisionReason {
  code: string;
  text: string;
  evidenceRefs: string[];
}

export interface CoinDecisionResult {
  schema: 'coin-decision-v1';
  id: string;
  decision: CoinDecision;
  score: number;
  confidence: number;
  reasons: CoinDecisionReason[];
  invalidation: string[];
  generatedAt: number;
  metrics: {
    decisionPositionUsd: number;
    positionReturnPct: number | null;
    drawdownFromPeakPct: number | null;
    netExpectedValuePct: number;
    expectedLossUsd: number;
  };
}

export type CoinAnalysisType = 'monitor' | 'screener' | 'meme';
export type CoinHistoryType = CoinAnalysisType | 'decision';

export interface CoinStoredAnalysis {
  id: string;
  type: CoinAnalysisType;
  chain: CoinChain | null;
  asset: string;
  createdAt: number;
  result: CoinMonitorResult | CoinScreenerResult | CoinMemeAnalysisResult;
}

export interface CoinStoredDecision {
  id: string;
  asset: string;
  chain: CoinChain;
  createdAt: number;
  input: CoinStrategyInput;
  result: CoinDecisionResult;
}

export interface CoinWatchItem {
  id: string;
  kind: 'symbol' | 'token';
  asset: string;
  chain: CoinChain | null;
  createdAt: number;
}

export interface CoinHistoryEntry {
  id: string;
  type: CoinHistoryType;
  asset: string;
  chain: CoinChain | null;
  summary: string;
  createdAt: number;
  analysisId: string | null;
  decisionId: string | null;
  sourceReceiptIds: string[];
}

export interface CoinStrategyDraft {
  chain: CoinChain;
  contractAddress: string;
  launchStage: CoinLaunchStage;
  tokenAgeMinutes: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  snapshotAgeSeconds: number | null;
  plannedEntryAmount: number | null;
  riskBudget: number | null;
  roundTripCostPct: number | null;
  walletOverlapScore: number | null;
  attentionPotentialScore: number | null;
  momentumScore: number | null;
  buyerQualityScore: number | null;
  holderHealthScore: number | null;
  liquidityScore: number | null;
  smartMoneyFlowScore: number | null;
  graduationScore: number | null;
  riskScore: number | null;
  dataConfidence: number | null;
  winProbability: number | null;
  expectedUpsidePctGivenWin: number | null;
  expectedDownsidePctGivenLoss: number | null;
  sellable: boolean;
  honeypotConfirmed: boolean;
  criticalSourceConflict: boolean;
  hasPosition: boolean;
  entryPrice: number | null;
  remainingAmount: number | null;
  investedAmount: number | null;
  peakPrice: number | null;
  heldMinutes: number | null;
}

export interface CoinPersistentData {
  activePage: 'monitor' | 'screener' | 'meme' | 'strategy' | 'history' | 'resources';
  drafts: {
    monitor: { symbolsText: string; sort: CoinMonitorSort };
    screener: { query: string; mode: CoinScreenerMode; symbolsText: string };
    meme: {
      view: 'discover' | 'analyze';
      mode: CoinMemeSourceMode;
      chain: CoinChain;
      contractAddress: string;
      stages: CoinLaunchStage[];
      windowMinutes: 15 | 60 | 360 | 1440;
      limit: number;
      intervalSeconds: number;
    };
    strategy: CoinStrategyDraft;
  };
  watchlist: CoinWatchItem[];
  analyses: CoinStoredAnalysis[];
  decisions: CoinStoredDecision[];
  sourceReceipts: CoinSourceReceipt[];
  history: CoinHistoryEntry[];
  ai: CoinAiPersistentState;
}

export interface CoinStateSnapshot {
  schema: 'coin-state-v1';
  revision: number;
  updatedAt: number;
  data: CoinPersistentData;
}

export type CoinStateLoadResult =
  | { status: 'ready'; snapshot: CoinStateSnapshot }
  | {
      status: 'malformed';
      snapshot: null;
      error: { code: 'coin-state-malformed'; recoverable: true };
    };

export interface CoinStateSaveInput {
  expectedRevision: number;
  data: CoinPersistentData;
}

export type CoinStateSaveResult =
  | { status: 'saved'; snapshot: CoinStateSnapshot }
  | { status: 'conflict'; snapshot: CoinStateSnapshot }
  | { status: 'malformed'; snapshot: null };

export interface CoinStateRecoveryResult {
  status: 'recovered' | 'failed';
  snapshot: CoinStateSnapshot | null;
}

export const createDefaultCoinPersistentData = (): CoinPersistentData => ({
  activePage: 'monitor',
  drafts: {
    monitor: { symbolsText: 'BTCUSDT, ETHUSDT', sort: 'low_multiple_asc' },
    screener: { query: '', mode: 'live_public', symbolsText: '' },
    meme: {
      view: 'discover',
      mode: 'local_cli_rpc',
      chain: 'bsc',
      contractAddress: '',
      stages: ['near_graduation', 'graduated_recently'],
      windowMinutes: 60,
      limit: 20,
      intervalSeconds: 60,
    },
    strategy: {
      chain: 'bsc',
      contractAddress: '',
      launchStage: 'dex_live',
      tokenAgeMinutes: null,
      priceUsd: null,
      liquidityUsd: null,
      snapshotAgeSeconds: null,
      plannedEntryAmount: null,
      riskBudget: null,
      roundTripCostPct: null,
      walletOverlapScore: null,
      attentionPotentialScore: null,
      momentumScore: null,
      buyerQualityScore: null,
      holderHealthScore: null,
      liquidityScore: null,
      smartMoneyFlowScore: null,
      graduationScore: null,
      riskScore: null,
      dataConfidence: null,
      winProbability: null,
      expectedUpsidePctGivenWin: null,
      expectedDownsidePctGivenLoss: null,
      sellable: true,
      honeypotConfirmed: false,
      criticalSourceConflict: false,
      hasPosition: false,
      entryPrice: null,
      remainingAmount: null,
      investedAmount: null,
      peakPrice: null,
      heldMinutes: null,
    },
  },
  watchlist: [],
  analyses: [],
  decisions: [],
  sourceReceipts: [],
  history: [],
  ai: {
    model: 'gpt-5.5',
    effort: 'high',
    receipts: [],
  },
});
