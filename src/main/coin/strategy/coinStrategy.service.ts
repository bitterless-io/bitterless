import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CoinDecisionReason,
  CoinDecisionResult,
  CoinStrategyInput,
} from '@shared/coin/coinAnalysis.type';

const FAST_STAGE_MAX_AGE_SECONDS = 120;
const DEFAULT_MAX_AGE_SECONDS = 600;
const MAX_POSITION_LIQUIDITY_RATIO = 0.01;
const ENTRY_NET_EV_PCT = 8;
const HOLD_NET_EV_PCT = 1;
const ENTRY_CONFIDENCE = 0.65;
const HOLD_CONFIDENCE = 0.55;
const STOP_LOSS_PCT = -15;
const TRAILING_ACTIVATION_PCT = 25;
const TRAILING_DRAWDOWN_PCT = 18;
const MAX_HOLD_MINUTES = 360;

const score = z.number().finite().min(0).max(100);
const positive = z.number().finite().positive();
const nonNegative = z.number().finite().nonnegative();
const evidenceRefs = z.array(z.string().min(1).max(160)).max(32);
const requiredEvidenceRefs = evidenceRefs.min(1);
const chain = z.enum(['robinhood', 'bsc', 'solana']);
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

const strategyInputSchema = z.object({
  schema: z.literal('coin-strategy-input-v1'),
  asset: z.object({
    chain,
    contractAddress: z.string().trim().min(1).max(160),
    launchStage,
    tokenAgeMinutes: nonNegative,
  }).strict(),
  market: z.object({
    priceUsd: positive,
    liquidityUsd: nonNegative,
    snapshotAgeSeconds: nonNegative,
  }).strict(),
  execution: z.object({
    plannedEntryAmount: nonNegative,
    riskBudget: nonNegative,
    roundTripCostPct: nonNegative.max(100),
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
    dataConfidence: z.number().finite().min(0).max(1),
  }).strict(),
  forecast: z.object({
    modelVersion: z.string().trim().min(1).max(120),
    horizonMinutes: z.literal(60),
    winProbability: z.number().finite().min(0).max(1),
    expectedUpsidePctGivenWin: nonNegative,
    expectedDownsidePctGivenLoss: nonNegative,
  }).strict(),
  risk: z.object({
    sellable: z.boolean(),
    honeypotConfirmed: z.boolean(),
    criticalSourceConflict: z.boolean(),
  }).strict(),
  position: z.object({
    entryPrice: positive,
    remainingAmount: positive,
    investedAmount: positive,
    peakPrice: positive.nullable(),
    heldMinutes: nonNegative,
  }).strict().nullable(),
  evidence: z.array(z.object({
    id: z.string().min(1).max(160),
    label: z.string().min(1).max(240),
    source: z.enum(['source', 'owner_input', 'derived']),
  }).strict()).min(1).max(128),
  evidenceRefs: z.object({
    asset: requiredEvidenceRefs,
    market: requiredEvidenceRefs,
    execution: requiredEvidenceRefs,
    signals: requiredEvidenceRefs,
    forecast: requiredEvidenceRefs,
    risk: requiredEvidenceRefs,
    position: evidenceRefs,
  }).strict(),
}).strict().superRefine((input, context) => {
  if (!input.position && input.evidenceRefs.position.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs', 'position'],
      message: 'Position evidence is only valid for an open position.',
    });
  }
  if (input.position && input.evidenceRefs.position.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRefs', 'position'],
      message: 'HOLD eligibility requires position evidence.',
    });
  }
  if (!input.position && input.execution.plannedEntryAmount <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['execution', 'plannedEntryAmount'],
      message: 'A planned entry amount is required without a position.',
    });
  }
  const evidenceIds = new Set(input.evidence.map(({ id }) => id));
  if (evidenceIds.size !== input.evidence.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidence'],
      message: 'Evidence IDs must be unique.',
    });
  }
  for (const [group, refs] of Object.entries(input.evidenceRefs)) {
    for (const ref of refs) {
      if (!evidenceIds.has(ref)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['evidenceRefs', group],
          message: `Unknown evidence reference: ${ref}`,
        });
      }
    }
  }
});

const FAST_STAGES = new Set([
  'near_graduation',
  'migration_pending',
  'graduated_recently',
]);

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const reason = (
  code: string,
  text: string,
  evidenceRefs: string[],
): CoinDecisionReason => ({ code, text, evidenceRefs: [...new Set(evidenceRefs)] });

const refs = (
  input: CoinStrategyInput,
  ...groups: Array<keyof CoinStrategyInput['evidenceRefs']>
): string[] => [...new Set(groups.flatMap((group) => input.evidenceRefs[group]))];

interface StrategyMetrics {
  decisionPositionUsd: number;
  positionReturnPct: number | null;
  peakReturnPct: number | null;
  drawdownFromPeakPct: number | null;
  netExpectedValuePct: number;
  expectedLossUsd: number;
}

const calculateMetrics = (input: CoinStrategyInput): StrategyMetrics => {
  const position = input.position;
  const decisionPositionUsd = position
    ? input.market.priceUsd * position.remainingAmount
    : input.execution.plannedEntryAmount;
  const positionReturnPct = position
    ? (input.market.priceUsd / position.entryPrice - 1) * 100
    : null;
  const peakReturnPct = position?.peakPrice
    ? (position.peakPrice / position.entryPrice - 1) * 100
    : null;
  const drawdownFromPeakPct = position?.peakPrice
    ? ((position.peakPrice - input.market.priceUsd) / position.peakPrice) * 100
    : null;
  const grossExpectedValuePct =
    input.forecast.winProbability * input.forecast.expectedUpsidePctGivenWin -
    (1 - input.forecast.winProbability) *
      input.forecast.expectedDownsidePctGivenLoss;
  const netExpectedValuePct = grossExpectedValuePct - input.execution.roundTripCostPct;
  const expectedLossUsd =
    (decisionPositionUsd *
      ((1 - input.forecast.winProbability) *
        input.forecast.expectedDownsidePctGivenLoss +
        input.execution.roundTripCostPct)) /
    100;

  return {
    decisionPositionUsd: round(decisionPositionUsd),
    positionReturnPct: positionReturnPct === null ? null : round(positionReturnPct),
    peakReturnPct: peakReturnPct === null ? null : round(peakReturnPct),
    drawdownFromPeakPct:
      drawdownFromPeakPct === null ? null : round(drawdownFromPeakPct),
    netExpectedValuePct: round(netExpectedValuePct),
    expectedLossUsd: round(expectedLossUsd),
  };
};

const calculateScore = (input: CoinStrategyInput): number => {
  const signals = input.signals;
  const positiveScore =
    signals.walletOverlapScore * 0.16 +
    signals.attentionPotentialScore * 0.16 +
    signals.momentumScore * 0.13 +
    signals.buyerQualityScore * 0.12 +
    signals.holderHealthScore * 0.12 +
    signals.liquidityScore * 0.12 +
    signals.smartMoneyFlowScore * 0.1 +
    signals.graduationScore * 0.09;
  return round(Math.max(0, Math.min(100, positiveScore - signals.riskScore * 0.25)));
};

const hardSellReasons = (
  input: CoinStrategyInput,
  metrics: StrategyMetrics,
): CoinDecisionReason[] => {
  const reasons: CoinDecisionReason[] = [];
  const riskRefs = refs(input, 'risk');
  const marketRefs = refs(input, 'market');
  const positionRefs = refs(input, 'position', 'market');
  const maxAge = FAST_STAGES.has(input.asset.launchStage)
    ? FAST_STAGE_MAX_AGE_SECONDS
    : DEFAULT_MAX_AGE_SECONDS;

  if (!input.risk.sellable) {
    reasons.push(reason('NOT_SELLABLE', 'Read-only evidence says the asset is not sellable.', riskRefs));
  }
  if (input.risk.honeypotConfirmed) {
    reasons.push(reason('HONEYPOT_CONFIRMED', 'Source evidence confirms a honeypot condition.', riskRefs));
  }
  if (input.risk.criticalSourceConflict) {
    reasons.push(reason('CRITICAL_SOURCE_CONFLICT', 'Critical sources disagree on asset or pool identity.', riskRefs));
  }
  if (input.market.snapshotAgeSeconds > maxAge) {
    reasons.push(reason(
      'MARKET_DATA_STALE',
      `Market evidence is ${round(input.market.snapshotAgeSeconds)}s old; this stage permits ${maxAge}s.`,
      marketRefs,
    ));
  }
  if (metrics.decisionPositionUsd > input.market.liquidityUsd * MAX_POSITION_LIQUIDITY_RATIO) {
    reasons.push(reason(
      'POSITION_EXCEEDS_LIQUIDITY_LIMIT',
      `The evaluated position exceeds 1% of observed liquidity.`,
      refs(input, 'market', 'execution', 'position'),
    ));
  }
  if (input.position && metrics.positionReturnPct !== null && metrics.positionReturnPct <= STOP_LOSS_PCT) {
    reasons.push(reason(
      'STOP_LOSS_TRIGGERED',
      `Position return ${metrics.positionReturnPct}% crossed the ${STOP_LOSS_PCT}% stop.`,
      positionRefs,
    ));
  }
  if (
    input.position &&
    metrics.peakReturnPct !== null &&
    metrics.drawdownFromPeakPct !== null &&
    metrics.peakReturnPct >= TRAILING_ACTIVATION_PCT &&
    metrics.drawdownFromPeakPct >= TRAILING_DRAWDOWN_PCT
  ) {
    reasons.push(reason(
      'TRAILING_STOP_TRIGGERED',
      `Drawdown from the recorded peak reached ${metrics.drawdownFromPeakPct}%.`,
      positionRefs,
    ));
  }
  return reasons;
};

export class CoinStrategyService {
  constructor(private readonly now: () => number = Date.now) {}

  evaluate(value: unknown): CoinDecisionResult {
    const input = strategyInputSchema.parse(value) as CoinStrategyInput;
    const metrics = calculateMetrics(input);
    const hardReasons = hardSellReasons(input, metrics);
    const hasPosition = input.position !== null;
    const mustRequalify = Boolean(
      input.position && input.position.heldMinutes >= MAX_HOLD_MINUTES,
    );
    const entryThreshold = !hasPosition || mustRequalify;
    const evThreshold = entryThreshold ? ENTRY_NET_EV_PCT : HOLD_NET_EV_PCT;
    const confidenceThreshold = entryThreshold ? ENTRY_CONFIDENCE : HOLD_CONFIDENCE;
    const reasons = [...hardReasons];

    if (reasons.length === 0 && metrics.netExpectedValuePct < evThreshold) {
      reasons.push(reason(
        'NET_EXPECTED_VALUE_BELOW_THRESHOLD',
        `Net expected value ${metrics.netExpectedValuePct}% is below the ${evThreshold}% threshold.`,
        refs(input, 'forecast', 'execution'),
      ));
    }
    if (reasons.length === 0 && input.signals.dataConfidence < confidenceThreshold) {
      reasons.push(reason(
        'DATA_CONFIDENCE_BELOW_THRESHOLD',
        `Data confidence ${round(input.signals.dataConfidence)} is below ${confidenceThreshold}.`,
        refs(input, 'signals'),
      ));
    }
    if (reasons.length === 0 && metrics.expectedLossUsd > input.execution.riskBudget) {
      reasons.push(reason(
        'EXPECTED_LOSS_EXCEEDS_BUDGET',
        `Expected loss ${metrics.expectedLossUsd} USD exceeds the supplied risk budget.`,
        refs(input, 'forecast', 'execution', 'market', 'position'),
      ));
    }

    const decision = reasons.length > 0 ? 'SELL' : hasPosition ? 'HOLD' : 'BUY';
    if (reasons.length === 0) {
      reasons.push(reason(
        'POSITIVE_NET_EXPECTED_VALUE',
        `Net expected value ${metrics.netExpectedValuePct}% clears the ${evThreshold}% threshold.`,
        refs(input, 'forecast', 'execution'),
      ));
      reasons.push(reason(
        'LOSS_WITHIN_BUDGET',
        `Expected loss ${metrics.expectedLossUsd} USD is within the supplied risk budget.`,
        refs(input, 'forecast', 'execution', 'market', 'position'),
      ));
      reasons.push(reason(
        hasPosition ? 'POSITION_REMAINS_QUALIFIED' : 'ENTRY_SIGNALS_QUALIFIED',
        hasPosition
          ? 'The valid owner-supplied position remains qualified under strategy v1.'
          : 'The structured entry signals qualify under strategy v1.',
        refs(input, hasPosition ? 'position' : 'signals', 'signals'),
      ));
    }

    return {
      schema: 'coin-decision-v1',
      id: randomUUID(),
      decision,
      score: calculateScore(input),
      confidence: round(input.signals.dataConfidence),
      reasons: reasons.slice(0, 5),
      invalidation: [
        'A hard risk gate changes state.',
        `Net expected value falls below ${evThreshold}%.`,
        `Data confidence falls below ${confidenceThreshold}.`,
        'Expected loss exceeds the supplied risk budget.',
      ],
      generatedAt: this.now(),
      metrics: {
        decisionPositionUsd: metrics.decisionPositionUsd,
        positionReturnPct: metrics.positionReturnPct,
        drawdownFromPeakPct: metrics.drawdownFromPeakPct,
        netExpectedValuePct: metrics.netExpectedValuePct,
        expectedLossUsd: metrics.expectedLossUsd,
      },
    };
  }
}

export const coinStrategyService = new CoinStrategyService();
