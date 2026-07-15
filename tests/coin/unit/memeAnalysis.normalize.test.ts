import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoinChain, CoinMemeAnalyzeInput, CoinSourceReceipt } from '../../../src/shared/coin/coinAnalysis.type';
import { buildLocalMemeAnalysis, type LocalMemeReadSet } from '../../../src/main/coin/data/memeAnalysis.normalize';

type Fixture = Record<string, any>;
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(process.cwd(), 'tests/coin/fixtures', name), 'utf8')) as Fixture;
const receipt = (operation: string, source: CoinSourceReceipt['source'] = 'gmgn-cli'): CoinSourceReceipt => ({
  id: `receipt-${operation}`,
  source,
  mode: source === 'gmgn-cli' ? 'local_cli' : 'local_rpc',
  status: 'ready',
  observedAt: 1_000,
  receivedAt: 1_001,
  stale: false,
  reason: null,
  evidenceIds: [`gmgn:${operation}:1000`],
});
const inputFor = (value: Fixture): CoinMemeAnalyzeInput => ({
  requestId: 'fixture-request',
  mode: 'local_cli_rpc',
  chain: value.chain as CoinChain,
  contractAddress: value.contractAddress,
  holderLimit: 100,
  traderLimit: 100,
});

test('local GMGN and Alchemy evidence produces observed concepts and explicit unavailable cohorts', () => {
  const value = fixture('gmgn-local-analysis.json');
  const reads: LocalMemeReadSet = {
    info: { operation: 'token-info', observedAt: 1_000, data: value.info },
    security: { operation: 'token-security', observedAt: 1_000, data: value.security },
    holders: { operation: 'token-holders', observedAt: 1_000, data: value.holders },
    traders: { operation: 'token-traders', observedAt: 1_000, data: value.traders },
    hotSearches: { operation: 'hot-searches', observedAt: 1_000, data: value.hotSearches },
    trending: { operation: 'trending', observedAt: 1_000, data: value.trending },
    alchemy: { chain: 'bsc', observedAt: 1_000, ...value.alchemy },
    receipts: [
      receipt('token-info'),
      receipt('token-security'),
      receipt('token-holders'),
      receipt('token-traders'),
      receipt('hot-searches'),
      receipt('trending'),
      receipt('alchemy', 'alchemy-bsc'),
    ],
  };
  const result = buildLocalMemeAnalysis(inputFor(value), reads, 2_000);
  assert.equal(result.holderDistribution.holderCount.value, 3);
  assert.equal(result.holderDistribution.top10SharePct.value, 17);
  assert.equal(result.eoaAnalysis.holderCount.value, 2);
  assert.equal(result.concepts[0]?.basis, 'observed');
  assert.equal(result.concepts[0]?.attentionScore.value, 84);
  assert.equal(result.concepts[1]?.attentionScore.value, null);
  assert.match(result.concepts[1]?.attentionScore.reason || '', /not present/i);
  assert.equal(result.top100Cohorts.every(({ matchCount }) => matchCount.value === null && Boolean(matchCount.reason)), true);
  assert.equal(result.unavailable.some(({ field }) => field === 'top100Cohorts.curated.matchCount'), true);
});

test('partial local evidence never converts unsupported fields into zero', () => {
  const value = fixture('gmgn-local-partial.json');
  const reads: LocalMemeReadSet = {
    info: { operation: 'token-info', observedAt: 3_000, data: value.info },
    hotSearches: { operation: 'hot-searches', observedAt: 3_000, data: value.hotSearches },
    alchemyReason: 'Alchemy fixture unavailable.',
    receipts: [receipt('token-info'), receipt('hot-searches')],
  };
  const result = buildLocalMemeAnalysis(inputFor(value), reads, 4_000);
  assert.equal(result.asset.priceUsd.value, null);
  assert.match(result.asset.priceUsd.reason || '', /not present/i);
  assert.equal(result.holderDistribution.holderCount.value, null);
  assert.equal(result.deterministicScore.value, null);
  assert.equal(result.confidence.value === 0, false);
  assert.equal(result.concepts[0]?.basis, 'observed');
  assert.equal(result.concepts[0]?.attentionScore.value, null);
});
