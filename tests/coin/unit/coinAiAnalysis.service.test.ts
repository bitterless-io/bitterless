import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type {
  CoinStrategyInput,
  CoinStateSnapshot,
} from '../../../src/shared/coin/coinAnalysis.type';
import { createDefaultCoinPersistentData } from '../../../src/shared/coin/coinAnalysis.type';
import { CoinStrategyService } from '../../../src/main/coin/strategy/coinStrategy.service';
import {
  COIN_AI_MAX_CONTEXT_BYTES,
  COIN_AI_MAX_OUTPUT_BYTES,
  parseCoinAiAnalysisText,
} from '../../../src/main/coin/ai/coinAiAnalysis.schema';
import {
  buildCoinAiEvidenceContext,
} from '../../../src/main/coin/ai/coinAiEvidence.service';
import { CoinAiAnalysisService } from '../../../src/main/coin/ai/coinAiAnalysis.service';
import { CodexRuntimeError } from '../../../src/main/codex/codexRuntime.service';

const input = (): CoinStrategyInput => ({
  schema: 'coin-strategy-input-v1',
  asset: { chain: 'bsc', contractAddress: '0x1111111111111111111111111111111111111111', launchStage: 'dex_live', tokenAgeMinutes: 90 },
  market: { priceUsd: 1.2, liquidityUsd: 100_000, snapshotAgeSeconds: 30 },
  execution: { plannedEntryAmount: 100, riskBudget: 20, roundTripCostPct: 1 },
  signals: {
    walletOverlapScore: 80, attentionPotentialScore: 82, momentumScore: 78,
    buyerQualityScore: 75, holderHealthScore: 76, liquidityScore: 85,
    smartMoneyFlowScore: 73, graduationScore: 80, riskScore: 12, dataConfidence: 0.8,
  },
  forecast: { modelVersion: 'fixture-v1', horizonMinutes: 60, winProbability: 0.7, expectedUpsidePctGivenWin: 30, expectedDownsidePctGivenLoss: 10 },
  risk: { sellable: true, honeypotConfirmed: false, criticalSourceConflict: false },
  position: null,
  evidence: [
    { id: 'owner:asset', label: 'https://secret.example/path?token=hidden apiKey=hidden', source: 'owner_input' },
    { id: 'owner:market', label: 'Market evidence', source: 'owner_input' },
    { id: 'owner:execution', label: 'Execution evidence', source: 'owner_input' },
    { id: 'owner:signals', label: 'Signal evidence', source: 'owner_input' },
    { id: 'owner:forecast', label: 'Forecast evidence', source: 'owner_input' },
    { id: 'owner:risk', label: 'Risk evidence', source: 'owner_input' },
  ],
  evidenceRefs: {
    asset: ['owner:asset'], market: ['owner:market'], execution: ['owner:execution'],
    signals: ['owner:signals'], forecast: ['owner:forecast'], risk: ['owner:risk'], position: [],
  },
});

const state = (): CoinStateSnapshot => {
  const value = input();
  const result = new CoinStrategyService(() => 10_000).evaluate(value);
  const data = createDefaultCoinPersistentData();
  data.decisions.push({
    id: result.id,
    asset: value.asset.contractAddress,
    chain: value.asset.chain,
    createdAt: result.generatedAt,
    input: value,
    result,
  });
  return { schema: 'coin-state-v1', revision: 7, updatedAt: 10_000, data };
};

const validOutput = (): string => readFileSync(
  join(process.cwd(), 'tests/coin/fixtures/coin-ai-valid.json'),
  'utf8',
);

test('bounds and redacts the structured evidence snapshot', () => {
  const snapshot = state();
  const target = { kind: 'strategy' as const, resultId: snapshot.data.decisions[0].id };
  const context = buildCoinAiEvidenceContext(snapshot, target);
  assert.ok(Buffer.byteLength(context.json, 'utf8') <= COIN_AI_MAX_CONTEXT_BYTES);
  assert.ok(context.snapshot.observedFacts.length <= 24);
  assert.ok(context.snapshot.evidence.length <= 32);
  assert.equal(context.json.includes('secret.example'), false);
  assert.equal(context.json.includes('apiKey=hidden'), false);
  assert.match(context.json, /\[redacted-url\]/);
});

test('accepts only exact bounded JSON with known evidence references', () => {
  const parsed = parseCoinAiAnalysisText(validOutput(), new Set(['owner:market']));
  assert.equal(parsed.schema, 'coin-ai-analysis-v1');
  assert.throws(() => parseCoinAiAnalysisText(
    JSON.stringify({ ...parsed, extra: true }),
    new Set(['owner:market']),
  ));
  assert.throws(() => parseCoinAiAnalysisText(
    JSON.stringify({ ...parsed, evidenceRefs: ['unknown:evidence'] }),
    new Set(['owner:market']),
  ), /coin-ai-unsupported-evidence/);
  assert.throws(() => parseCoinAiAnalysisText(
    'x'.repeat(COIN_AI_MAX_OUTPUT_BYTES + 1),
    new Set(['owner:market']),
  ), /coin-ai-output-too-large/);
  assert.throws(() => parseCoinAiAnalysisText(`\`\`\`json\n${validOutput()}\n\`\`\``, new Set(['owner:market'])));
});

test('rejects a stale validated run before persistence', async () => {
  const snapshot = state();
  const target = { kind: 'strategy' as const, resultId: snapshot.data.decisions[0].id };
  const service = new CoinAiAnalysisService({
    credentials: { getStatus: async () => ({ provider: 'openai-codex', connected: true, loginInProgress: false, lastVerifiedAt: 1 }) },
    runtime: { run: async ({ model, effort }) => ({ provider: 'openai-codex', model, effort, text: validOutput() }) },
    state: {
      load: () => ({ status: 'ready', snapshot }),
      appendAiReceipt: async () => ({ status: 'conflict', snapshot: null }),
    },
  });
  const result = await service.analyze({
    runId: '11111111-1111-4111-8111-111111111111',
    target,
    model: 'gpt-5.6-sol',
    effort: 'high',
  });
  assert.equal(result.status, 'error');
  if (result.status === 'error') assert.equal(result.error.code, 'stale-run');
});

test('cancels by runId and never persists an aborted result', async () => {
  const snapshot = state();
  const target = { kind: 'strategy' as const, resultId: snapshot.data.decisions[0].id };
  let started = (): void => undefined;
  const runtimeStarted = new Promise<void>((resolve) => { started = resolve; });
  let persisted = false;
  const service = new CoinAiAnalysisService({
    credentials: { getStatus: async () => ({ provider: 'openai-codex', connected: true, loginInProgress: false, lastVerifiedAt: 1 }) },
    runtime: {
      run: async ({ signal }) => {
        started();
        await new Promise<void>((_resolve, reject) => signal.addEventListener(
          'abort',
          () => reject(new CodexRuntimeError('cancelled')),
          { once: true },
        ));
        throw new CodexRuntimeError('cancelled');
      },
    },
    state: {
      load: () => ({ status: 'ready', snapshot }),
      appendAiReceipt: async () => {
        persisted = true;
        return { status: 'malformed', snapshot: null };
      },
    },
  });
  const runId = '22222222-2222-4222-8222-222222222222';
  const pending = service.analyze({ runId, target, model: 'gpt-5.6-sol', effort: 'medium' });
  await runtimeStarted;
  assert.deepEqual(service.cancel({ runId }), { runId, cancelled: true });
  assert.deepEqual(await pending, { status: 'cancelled', runId });
  assert.equal(persisted, false);
});
