import { z } from 'zod';
import type {
  CoinPersistentData,
  CoinStateSaveInput,
  CoinStateSnapshot,
} from '@shared/coin/coinAnalysis.type';
import {
  COIN_AI_EFFORTS,
  COIN_AI_MODELS,
  COIN_HOLDER_EXCLUSION_CLASSES,
  createUnattestedCoinHolderUniverse,
} from '@shared/coin/coinAnalysis.type';
import {
  COIN_AI_MAX_RECEIPTS,
  coinAiAnalysisReceiptSchema,
} from '../ai/coinAiAnalysis.schema';

const boundedString = (max = 500): z.ZodString => z.string().max(max);
const finite = z.number().finite();
const timestamp = finite.nonnegative();
const nullableTimestamp = timestamp.nullable();
const evidenceRefs = z.array(boundedString(160).min(1)).max(64);
const chain = z.enum(['robinhood', 'bsc', 'solana']);
const nullableChain = chain.nullable();
const launchStage = z.enum([
  'discovered',
  'filling',
  'near_graduation',
  'migration_pending',
  'graduated_recently',
  'dex_live',
  'cooled',
  'rejected',
  'stale',
]);

const sourceId = z.enum([
  'monitor-http',
  'monitor-ws',
  'screener',
  'meme-service',
  'gmgn-cli',
  'alchemy-robinhood',
  'alchemy-bsc',
  'alchemy-solana',
  'owner-cohorts',
  'strategy-v1',
]);

export const coinSourceReceiptSchema = z.object({
  id: boundedString(160).min(1),
  source: sourceId,
  mode: z.enum(['http', 'websocket', 'sample', 'service', 'local_cli', 'local_rpc', 'deterministic']),
  status: z.enum(['ready', 'partial', 'unavailable', 'error', 'stale']),
  observedAt: nullableTimestamp,
  receivedAt: timestamp,
  stale: z.boolean(),
  reason: boundedString(500).nullable(),
  evidenceIds: evidenceRefs,
}).strict();

const nullableMetric = <T extends z.ZodTypeAny>(value: T) => z.object({
  value: value.nullable(),
  reason: boundedString(500).nullable(),
  evidenceRefs,
}).strict().superRefine((metric, context) => {
  if (metric.value === null && !metric.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'A missing metric must include a reason.',
    });
  }
});

const ratioMetric = z.object({
  value: finite.min(0).max(100).nullable(),
  reason: boundedString(500).nullable(),
  evidenceRefs,
  numerator: finite.nonnegative().nullable(),
  denominator: finite.nonnegative().nullable(),
}).strict().superRefine((metric, context) => {
  if (metric.value === null && !metric.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'A missing ratio must include a reason.',
    });
  }
});

const monitorRow = z.object({
  symbol: boundedString(32).min(1),
  venue: z.literal('binance-usdm'),
  currentPrice: finite.nonnegative().nullable(),
  historicalLowPrice: finite.nonnegative().nullable(),
  historicalHighPrice: finite.nonnegative().nullable(),
  lowMultiple: finite.nonnegative().nullable(),
  listedAt: nullableTimestamp,
  listingAgeDays: finite.nonnegative().nullable(),
  observedAt: nullableTimestamp,
  freshnessSeconds: finite.nonnegative().nullable(),
  state: z.enum(['ready', 'stale', 'error']),
  reason: boundedString(500).nullable(),
  evidenceIds: evidenceRefs,
}).strict();

const monitorResult = z.object({
  schema: z.literal('coin-monitor-v1'),
  requestedSymbols: z.array(boundedString(32).min(1)).max(50),
  rows: z.array(monitorRow).max(50),
  missingSymbols: z.array(boundedString(32).min(1)).max(50),
  readAt: timestamp,
  connection: z.enum(['connecting', 'live', 'retrying', 'closed', 'unavailable', 'error']),
  receipts: z.array(coinSourceReceiptSchema).max(20),
}).strict();

const filterValue = z.union([
  boundedString(200),
  finite,
  z.tuple([z.union([boundedString(200), finite]), z.union([boundedString(200), finite])]),
]);
const filterClause = z.object({
  field: boundedString(80).min(1),
  op: z.enum(['gte', 'lte', 'eq', 'between']),
  value: filterValue,
}).strict();

const screenerRow = z.object({
  rank: z.number().int().positive(),
  symbol: boundedString(40).min(1),
  score: finite.nullable(),
  state: boundedString(80).nullable(),
  currentPrice: finite.nonnegative().nullable(),
  historicalLowPrice: finite.nonnegative().nullable(),
  priceMultiple: finite.nonnegative().nullable(),
  listingAgeDays: finite.nonnegative().nullable(),
  fundingRatePct: finite.nullable(),
  fundingRateSpreadPct: finite.nullable(),
  warning: boundedString(500).nullable(),
  evidenceIds: evidenceRefs,
}).strict();

const screenerResult = z.object({
  schema: z.literal('coin-screener-v1'),
  mode: z.enum(['live_public', 'sample']),
  generatedAt: timestamp,
  scanned: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  filters: z.array(filterClause).max(64),
  rows: z.array(screenerRow).max(100),
  warnings: z.array(boundedString(500)).max(100),
  receipts: z.array(coinSourceReceiptSchema).max(20),
}).strict();

const cohort = z.object({
  cohort: z.enum(['curated', 'robinhood', 'bsc', 'pvp']),
  label: boundedString(120).min(1),
  matchCount: nullableMetric(z.number().int().nonnegative()),
  holdingSharePct: ratioMetric,
}).strict();

const holderExclusionClass = z.enum(COIN_HOLDER_EXCLUSION_CLASSES);
const holderUniverse = z.object({
  attestation: z.object({
    filtered: z.boolean(),
    method: z.enum(['local-classifier-v1', 'service-attestation', 'unattested']),
    reason: boundedString(500).nullable(),
    evidenceRefs,
  }).strict(),
  topHolder: z.object({
    sourceRank: z.number().int().positive().nullable(),
    address: boundedString(160).min(1).nullable(),
    status: z.enum(['independent', 'excluded', 'unknown']),
    class: holderExclusionClass.nullable(),
    reason: boundedString(500).min(1),
    evidenceRefs,
  }).strict(),
  coverage: z.object({
    rawHolderCount: z.number().int().nonnegative().nullable(),
    sourceLimit: z.number().int().nonnegative(),
    sourceRowCount: z.number().int().nonnegative(),
    classifiedRowCount: z.number().int().nonnegative(),
    eligibleRowCount: z.number().int().nonnegative(),
    excludedRowCount: z.number().int().nonnegative(),
    unknownRowCount: z.number().int().nonnegative(),
    top10EligibleCount: z.number().int().nonnegative().max(10),
    top10Complete: z.boolean(),
    top100EligibleCount: z.number().int().nonnegative().max(100),
    top100Complete: z.boolean(),
  }).strict(),
  exclusionAudit: z.array(z.object({
    sourceRank: z.number().int().positive(),
    address: boundedString(160).min(1),
    class: holderExclusionClass,
    reason: boundedString(500).min(1),
    evidenceRefs,
  }).strict()).max(100),
}).strict().default(createUnattestedCoinHolderUniverse());

const keyWallet = z.object({
  rank: z.number().int().positive(),
  address: boundedString(160).min(1),
  holderRank: z.number().int().positive().nullable(),
  sourceHolderRank: z.number().int().positive().nullable().default(null),
  label: boundedString(160).min(1),
  cohorts: z.array(z.enum(['curated', 'robinhood', 'bsc', 'pvp'])).max(4),
  holdingSharePct: finite.min(0).max(100).nullable(),
  tokenAmount: finite.nonnegative().nullable(),
  positionValueUsd: finite.nonnegative().nullable(),
  realizedPnlUsd: finite.nullable(),
  unrealizedPnlUsd: finite.nullable(),
  walletScore: finite.min(0).max(100).nullable(),
  reason: boundedString(500).min(1),
  evidenceRefs,
}).strict();

const isSchemaRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const migrationEvidenceRefs = (value: unknown): string[] =>
  isSchemaRecord(value) && Array.isArray(value.evidenceRefs)
    ? value.evidenceRefs.filter((ref): ref is string => typeof ref === 'string').slice(0, 64)
    : [];

const unavailableMigrationMetric = (value: unknown, reason: string) => ({
  value: null,
  reason,
  evidenceRefs: migrationEvidenceRefs(value),
});

const unavailableMigrationRatio = (value: unknown, reason: string) => ({
  ...unavailableMigrationMetric(value, reason),
  numerator: null,
  denominator: null,
});

const migrateUnattestedHolderUniverse = (value: unknown): unknown => {
  if (!isSchemaRecord(value) || !isSchemaRecord(value.holderDistribution)) return value;
  const distribution = value.holderDistribution;
  const universe = isSchemaRecord(distribution.holderUniverse) ? distribution.holderUniverse : null;
  const attestation = universe && isSchemaRecord(universe.attestation) ? universe.attestation : null;
  if (attestation?.filtered === true) return value;

  const reason = 'Legacy holder-derived values are unavailable because the result has no filtered-universe attestation.';
  const unavailableCohorts = (cohorts: unknown): unknown => Array.isArray(cohorts)
    ? cohorts.map((entry) => isSchemaRecord(entry) ? {
        ...entry,
        matchCount: unavailableMigrationMetric(entry.matchCount, reason),
        holdingSharePct: unavailableMigrationRatio(entry.holdingSharePct, reason),
      } : entry)
    : cohorts;
  const eoa = isSchemaRecord(value.eoaAnalysis) ? value.eoaAnalysis : null;

  return {
    ...value,
    holderDistribution: {
      ...distribution,
      top10SharePct: unavailableMigrationRatio(distribution.top10SharePct, reason),
      top100SharePct: unavailableMigrationRatio(distribution.top100SharePct, reason),
      excludedAddressCount: unavailableMigrationMetric(distribution.excludedAddressCount, reason),
      excludedByType: [],
      holderUniverse: createUnattestedCoinHolderUniverse(reason),
    },
    top100Cohorts: unavailableCohorts(value.top100Cohorts),
    eoaAnalysis: eoa ? {
      ...eoa,
      holderCount: unavailableMigrationMetric(eoa.holderCount, reason),
      holdingSharePct: unavailableMigrationRatio(eoa.holdingSharePct, reason),
      cohorts: unavailableCohorts(eoa.cohorts),
    } : value.eoaAnalysis,
    keyWallets: [],
    keyWalletsReason: reason,
    deterministicScore: unavailableMigrationMetric(value.deterministicScore, reason),
  };
};

const concept = z.object({
  rank: z.number().int().positive(),
  key: boundedString(160).min(1),
  label: boundedString(160).min(1),
  basis: z.enum(['observed', 'inferred']),
  trend: z.enum(['RISING', 'STABLE', 'FALLING', 'UNAVAILABLE']),
  attentionScore: nullableMetric(finite.min(0).max(100)),
  growthScore: nullableMetric(finite.min(0).max(100)),
  noveltyScore: nullableMetric(finite.min(0).max(100)),
  saturationScore: nullableMetric(finite.min(0).max(100)),
  representativeTokens: z.array(boundedString(120).min(1)).max(30),
  evidence: z.array(boundedString(500).min(1)).max(30),
  counterEvidence: z.array(boundedString(500).min(1)).max(30),
  risks: z.array(boundedString(500).min(1)).max(30),
  evidenceRefs,
}).strict();

const conceptFit = z.object({
  conceptKey: boundedString(160).min(1),
  basis: z.enum(['observed', 'inferred']),
  fitScore: nullableMetric(finite.min(0).max(100)),
  summary: boundedString(500).min(1),
  evidence: z.array(boundedString(500).min(1)).max(30),
  evidenceRefs,
}).strict();

const coinMemeAnalysisResultBaseSchema = z.object({
  schema: z.literal('coin-meme-analysis-v1'),
  id: boundedString(160).min(1),
  mode: z.enum(['service', 'local_cli_rpc']),
  generatedAt: timestamp,
  asset: z.object({
    chain,
    contractAddress: boundedString(160).min(1),
    name: nullableMetric(boundedString(200).min(1)),
    symbol: nullableMetric(boundedString(80).min(1)),
    launchStage: nullableMetric(launchStage),
    priceUsd: nullableMetric(finite.nonnegative()),
    marketCapUsd: nullableMetric(finite.nonnegative()),
    liquidityUsd: nullableMetric(finite.nonnegative()),
    chainIdentityVerified: nullableMetric(z.boolean()),
    contractVerified: nullableMetric(z.boolean()),
  }).strict(),
  holderDistribution: z.object({
    holderCount: nullableMetric(z.number().int().nonnegative()),
    top10SharePct: ratioMetric,
    top100SharePct: ratioMetric,
    freshWalletRatePct: ratioMetric,
    botDegenRatePct: ratioMetric,
    entrapmentTraderRatePct: ratioMetric,
    excludedAddressCount: nullableMetric(z.number().int().nonnegative()),
    excludedByType: z.array(z.object({
      type: boundedString(80).min(1),
      count: z.number().int().nonnegative(),
      evidenceRefs,
    }).strict()).max(30),
    holderUniverse,
  }).strict(),
  top100Cohorts: z.array(cohort).length(4),
  eoaAnalysis: z.object({
    label: z.enum(['EOA', 'INDEPENDENT_WALLET']),
    holderCount: nullableMetric(z.number().int().nonnegative()),
    holdingSharePct: ratioMetric,
    cohorts: z.array(cohort).length(4),
  }).strict(),
  keyWallets: z.array(keyWallet).max(100),
  keyWalletsReason: boundedString(500).nullable(),
  concepts: z.array(concept).max(30),
  tokenConceptFits: z.array(conceptFit).max(30),
  conceptsReason: boundedString(500).nullable(),
  risks: z.array(z.object({
    code: boundedString(100).min(1),
    severity: z.enum(['info', 'warning', 'critical']),
    text: boundedString(500).min(1),
    evidenceRefs,
  }).strict()).max(100),
  deterministicScore: nullableMetric(finite.min(0).max(100)),
  confidence: nullableMetric(finite.min(0).max(1)),
  unavailable: z.array(z.object({
    field: boundedString(200).min(1),
    reason: boundedString(500).min(1),
    source: sourceId.nullable(),
  }).strict()).max(200),
  warnings: z.array(boundedString(500)).max(100),
  receipts: z.array(coinSourceReceiptSchema).max(40),
}).strict();

export const coinMemeAnalysisResultSchema = z.preprocess(
  migrateUnattestedHolderUniverse,
  coinMemeAnalysisResultBaseSchema,
);

const evidenceDescriptor = z.object({
  id: boundedString(160).min(1),
  label: boundedString(240).min(1),
  source: z.enum(['source', 'owner_input', 'derived']),
}).strict();
const score = finite.min(0).max(100);
const strategyInput = z.object({
  schema: z.literal('coin-strategy-input-v1'),
  asset: z.object({
    chain,
    contractAddress: boundedString(160).min(1),
    launchStage,
    tokenAgeMinutes: finite.nonnegative(),
  }).strict(),
  market: z.object({
    priceUsd: finite.positive(),
    liquidityUsd: finite.nonnegative(),
    snapshotAgeSeconds: finite.nonnegative(),
  }).strict(),
  execution: z.object({
    plannedEntryAmount: finite.nonnegative(),
    riskBudget: finite.nonnegative(),
    roundTripCostPct: finite.nonnegative(),
  }).strict(),
  signals: z.object({
    walletOverlapScore: score,
    attentionPotentialScore: score,
    momentumScore: score,
    buyerQualityScore: score,
    holderHealthScore: score,
    liquidityScore: score,
    smartMoneyFlowScore: score,
    graduationScore: score,
    riskScore: score,
    dataConfidence: finite.min(0).max(1),
  }).strict(),
  forecast: z.object({
    modelVersion: boundedString(120).min(1),
    horizonMinutes: z.literal(60),
    winProbability: finite.min(0).max(1),
    expectedUpsidePctGivenWin: finite.nonnegative(),
    expectedDownsidePctGivenLoss: finite.nonnegative(),
  }).strict(),
  risk: z.object({
    sellable: z.boolean(),
    honeypotConfirmed: z.boolean(),
    criticalSourceConflict: z.boolean(),
  }).strict(),
  position: z.object({
    entryPrice: finite.positive(),
    remainingAmount: finite.positive(),
    investedAmount: finite.positive(),
    peakPrice: finite.positive().nullable(),
    heldMinutes: finite.nonnegative(),
  }).strict().nullable(),
  evidence: z.array(evidenceDescriptor).min(1).max(128),
  evidenceRefs: z.object({
    asset: evidenceRefs,
    market: evidenceRefs,
    execution: evidenceRefs,
    signals: evidenceRefs,
    forecast: evidenceRefs,
    risk: evidenceRefs,
    position: evidenceRefs,
  }).strict(),
}).strict();

const decisionResult = z.object({
  schema: z.literal('coin-decision-v1'),
  id: boundedString(160).min(1),
  decision: z.enum(['BUY', 'HOLD', 'SELL']),
  score,
  confidence: finite.min(0).max(1),
  reasons: z.array(z.object({
    code: boundedString(100).min(1),
    text: boundedString(500).min(1),
    evidenceRefs: evidenceRefs.min(1),
  }).strict()).min(1).max(5),
  invalidation: z.array(boundedString(500).min(1)).max(20),
  generatedAt: timestamp,
  metrics: z.object({
    decisionPositionUsd: finite.nonnegative(),
    positionReturnPct: finite.nullable(),
    drawdownFromPeakPct: finite.nullable(),
    netExpectedValuePct: finite,
    expectedLossUsd: finite.nonnegative(),
  }).strict(),
}).strict();

const strategyDraft = z.object({
  chain,
  contractAddress: boundedString(160),
  launchStage,
  tokenAgeMinutes: finite.nonnegative().nullable(),
  priceUsd: finite.nonnegative().nullable(),
  liquidityUsd: finite.nonnegative().nullable(),
  snapshotAgeSeconds: finite.nonnegative().nullable(),
  plannedEntryAmount: finite.nonnegative().nullable(),
  riskBudget: finite.nonnegative().nullable(),
  roundTripCostPct: finite.nonnegative().nullable(),
  walletOverlapScore: score.nullable(),
  attentionPotentialScore: score.nullable(),
  momentumScore: score.nullable(),
  buyerQualityScore: score.nullable(),
  holderHealthScore: score.nullable(),
  liquidityScore: score.nullable(),
  smartMoneyFlowScore: score.nullable(),
  graduationScore: score.nullable(),
  riskScore: score.nullable(),
  dataConfidence: finite.min(0).max(1).nullable(),
  winProbability: finite.min(0).max(1).nullable(),
  expectedUpsidePctGivenWin: finite.nonnegative().nullable(),
  expectedDownsidePctGivenLoss: finite.nonnegative().nullable(),
  sellable: z.boolean(),
  honeypotConfirmed: z.boolean(),
  criticalSourceConflict: z.boolean(),
  hasPosition: z.boolean(),
  entryPrice: finite.positive().nullable(),
  remainingAmount: finite.positive().nullable(),
  investedAmount: finite.positive().nullable(),
  peakPrice: finite.positive().nullable(),
  heldMinutes: finite.nonnegative().nullable(),
}).strict();

const aiState = z.object({
  model: z.enum(COIN_AI_MODELS),
  effort: z.enum(COIN_AI_EFFORTS),
  receipts: z.array(coinAiAnalysisReceiptSchema).max(COIN_AI_MAX_RECEIPTS),
}).strict().default({
  model: 'gpt-5.5',
  effort: 'high',
  receipts: [],
});

export const coinPersistentDataSchema = z.object({
  activePage: z.enum(['monitor', 'screener', 'meme', 'strategy', 'history', 'resources']),
  drafts: z.object({
    monitor: z.object({
      symbolsText: boundedString(500),
      sort: z.enum(['low_multiple_asc', 'low_multiple_desc', 'symbol_asc']),
    }).strict(),
    screener: z.object({
      query: boundedString(2_000),
      mode: z.enum(['live_public', 'sample']),
      symbolsText: boundedString(2_000),
    }).strict(),
    meme: z.object({
      view: z.enum(['discover', 'analyze']),
      mode: z.enum(['service', 'local_cli_rpc']),
      chain,
      contractAddress: boundedString(160),
      stages: z.array(launchStage).min(1).max(9),
      windowMinutes: z.union([z.literal(15), z.literal(60), z.literal(360), z.literal(1440)]),
      limit: z.number().int().min(1).max(50),
      intervalSeconds: z.number().int().min(15).max(1800),
    }).strict(),
    strategy: strategyDraft,
  }).strict(),
  watchlist: z.array(z.object({
    id: boundedString(160).min(1),
    kind: z.enum(['symbol', 'token']),
    asset: boundedString(160).min(1),
    chain: nullableChain,
    createdAt: timestamp,
  }).strict()).max(500),
  analyses: z.array(z.discriminatedUnion('type', [
    z.object({
      id: boundedString(160).min(1),
      type: z.literal('monitor'),
      chain: z.null(),
      asset: boundedString(500).min(1),
      createdAt: timestamp,
      result: monitorResult,
    }).strict(),
    z.object({
      id: boundedString(160).min(1),
      type: z.literal('screener'),
      chain: z.null(),
      asset: boundedString(500).min(1),
      createdAt: timestamp,
      result: screenerResult,
    }).strict(),
    z.object({
      id: boundedString(160).min(1),
      type: z.literal('meme'),
      chain,
      asset: boundedString(160).min(1),
      createdAt: timestamp,
      result: coinMemeAnalysisResultSchema,
    }).strict(),
  ])).max(500),
  decisions: z.array(z.object({
    id: boundedString(160).min(1),
    asset: boundedString(160).min(1),
    chain,
    createdAt: timestamp,
    input: strategyInput,
    result: decisionResult,
  }).strict()).max(500),
  sourceReceipts: z.array(coinSourceReceiptSchema).max(2_000),
  history: z.array(z.object({
    id: boundedString(160).min(1),
    type: z.enum(['monitor', 'screener', 'meme', 'decision']),
    asset: boundedString(500).min(1),
    chain: nullableChain,
    summary: boundedString(500).min(1),
    createdAt: timestamp,
    analysisId: boundedString(160).min(1).nullable(),
    decisionId: boundedString(160).min(1).nullable(),
    sourceReceiptIds: evidenceRefs,
  }).strict()).max(2_000),
  ai: aiState,
}).strict();

export const coinStateSnapshotSchema = z.object({
  schema: z.literal('coin-state-v1'),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  data: coinPersistentDataSchema,
}).strict();

export const coinStateSaveInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  data: coinPersistentDataSchema,
}).strict();

export const parseCoinStateSnapshot = (value: unknown): CoinStateSnapshot =>
  coinStateSnapshotSchema.parse(value) as CoinStateSnapshot;

export const parseCoinStateSaveInput = (value: unknown): CoinStateSaveInput =>
  coinStateSaveInputSchema.parse(value) as CoinStateSaveInput;

export const parseCoinPersistentData = (value: unknown): CoinPersistentData =>
  coinPersistentDataSchema.parse(value) as CoinPersistentData;
