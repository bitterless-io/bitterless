import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoinStrategyInput } from '../../../src/shared/coin/coinAnalysis.type';
import { CoinStrategyService } from '../../../src/main/coin/strategy/coinStrategy.service';

const evidence = [
  { id: 'owner:asset', label: 'Fixture asset evidence', source: 'owner_input' as const },
  { id: 'owner:market', label: 'Fixture market evidence', source: 'owner_input' as const },
  { id: 'owner:execution', label: 'Fixture execution evidence', source: 'owner_input' as const },
  { id: 'owner:signals', label: 'Fixture signal evidence', source: 'owner_input' as const },
  { id: 'owner:forecast', label: 'Fixture forecast evidence', source: 'owner_input' as const },
  { id: 'owner:risk', label: 'Fixture risk evidence', source: 'owner_input' as const },
  { id: 'owner:position', label: 'Fixture position evidence', source: 'owner_input' as const },
];

const input = (position = false): CoinStrategyInput => ({
  schema: 'coin-strategy-input-v1',
  asset: {
    chain: 'bsc',
    contractAddress: '0x1111111111111111111111111111111111111111',
    launchStage: 'dex_live',
    tokenAgeMinutes: 90,
  },
  market: { priceUsd: 1.2, liquidityUsd: 100_000, snapshotAgeSeconds: 30 },
  execution: { plannedEntryAmount: position ? 0 : 100, riskBudget: 20, roundTripCostPct: 1 },
  signals: {
    walletOverlapScore: 80,
    attentionPotentialScore: 82,
    momentumScore: 78,
    buyerQualityScore: 75,
    holderHealthScore: 76,
    liquidityScore: 85,
    smartMoneyFlowScore: 73,
    graduationScore: 80,
    riskScore: 12,
    dataConfidence: 0.8,
  },
  forecast: {
    modelVersion: 'fixture-v1',
    horizonMinutes: 60,
    winProbability: 0.7,
    expectedUpsidePctGivenWin: 30,
    expectedDownsidePctGivenLoss: 10,
  },
  risk: { sellable: true, honeypotConfirmed: false, criticalSourceConflict: false },
  position: position
    ? { entryPrice: 1, remainingAmount: 100, investedAmount: 100, peakPrice: 1.3, heldMinutes: 45 }
    : null,
  evidence,
  evidenceRefs: {
    asset: ['owner:asset'],
    market: ['owner:market'],
    execution: ['owner:execution'],
    signals: ['owner:signals'],
    forecast: ['owner:forecast'],
    risk: ['owner:risk'],
    position: position ? ['owner:position'] : [],
  },
});

test('strategy v1 returns BUY without a position and cites only registered evidence', () => {
  const service = new CoinStrategyService(() => 1_000);
  const value = input(false);
  const result = service.evaluate(value);
  assert.equal(result.decision, 'BUY');
  assert.equal(result.generatedAt, 1_000);
  const ids = new Set(value.evidence.map(({ id }) => id));
  assert.equal(result.reasons.every((reason) => reason.evidenceRefs.length > 0), true);
  assert.equal(result.reasons.flatMap(({ evidenceRefs }) => evidenceRefs).every((id) => ids.has(id)), true);
});

test('strategy v1 returns HOLD only for a complete evidence-backed position', () => {
  const service = new CoinStrategyService(() => 2_000);
  const result = service.evaluate(input(true));
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.reasons.some(({ code }) => code === 'POSITION_REMAINS_QUALIFIED'), true);

  const incomplete = input(false);
  incomplete.evidenceRefs.position = ['owner:position'];
  assert.throws(() => service.evaluate(incomplete));
});

test('hard risk gates force SELL without producing an execution instruction', () => {
  const service = new CoinStrategyService(() => 3_000);
  const value = input(true);
  value.risk.honeypotConfirmed = true;
  const result = service.evaluate(value);
  assert.equal(result.decision, 'SELL');
  assert.equal(result.reasons.some(({ code }) => code === 'HONEYPOT_CONFIRMED'), true);
  assert.equal('order' in result, false);
  assert.equal('transaction' in result, false);
});
