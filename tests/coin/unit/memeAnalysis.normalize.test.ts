import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoinChain, CoinMemeAnalyzeInput, CoinSourceReceipt } from '../../../src/shared/coin/coinAnalysis.type';
import {
  buildLocalMemeAnalysis,
  normalizeMemeServicePayload,
  type LocalMemeReadSet,
} from '../../../src/main/coin/data/memeAnalysis.normalize';
import { coinMemeAnalysisResultSchema } from '../../../src/main/coin/state/coinState.schema';

type Fixture = Record<string, any>;
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(process.cwd(), 'tests/coin/fixtures', name), 'utf8')) as Fixture;
const receipt = (operation: string, source: CoinSourceReceipt['source'] = 'gmgn-cli'): CoinSourceReceipt => ({
  id: `receipt-${operation}`,
  source,
  mode: source === 'gmgn-cli' ? 'local_cli' : source === 'meme-service' ? 'service' : 'local_rpc',
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

const holderUniverseFixture = fixture('gmgn-holder-universe.json');
const holderCaseResult = (name: string) => {
  const holderCase = holderUniverseFixture.cases[name] as Fixture;
  const chain = (holderCase.chain ?? holderUniverseFixture.chain) as CoinChain;
  const generatedHolders = Array.from({ length: holderCase.generatedRows ?? 0 }, (_, index) => {
    const rank = index + 1;
    return {
      rank,
      address: `0xa${rank.toString(16).padStart(39, '0')}`,
      holding_percentage: 1,
      addr_type: 0,
      ...(holderCase.excludedRanks?.includes(rank) ? { label: 'exchange' } : {}),
    };
  });
  const rawHolders = holderCase.holders ?? generatedHolders;
  const holderKinds = holderCase.holderKinds ?? Object.fromEntries(
    rawHolders.map((holder: Fixture) => [holder.address, 'wallet']),
  );
  const holders = rawHolders.map((holder: Fixture) => {
    const kind = holderKinds[holder.address.toLowerCase()] ?? holderKinds[holder.address];
    return holder.addr_type !== undefined || kind !== 'wallet'
      ? holder
      : { ...holder, addr_type: 0 };
  });
  const value = {
    chain,
    contractAddress: holderUniverseFixture.contractAddress,
  };
  const reads: LocalMemeReadSet = {
    holders: {
      operation: 'token-holders',
      observedAt: 5_000,
      data: {
        holder_count: holderCase.holderCount,
        fresh_wallet_rate_pct: 20,
        bot_degen_rate_pct: 10,
        holders,
      },
    },
    receipts: [receipt('token-holders')],
  };
  return buildLocalMemeAnalysis(inputFor(value), reads, 6_000);
};

test('local GMGN evidence produces filtered holders, observed concepts, and unavailable cohorts', () => {
  const value = fixture('gmgn-local-analysis.json');
  const reads: LocalMemeReadSet = {
    info: { operation: 'token-info', observedAt: 1_000, data: value.info },
    security: { operation: 'token-security', observedAt: 1_000, data: value.security },
    holders: {
      operation: 'token-holders',
      observedAt: 1_000,
      data: {
        ...value.holders.data,
        holders: value.holders.data.holders.map((holder: Fixture, index: number) => ({
          ...holder,
          ...(index === 2 ? { tags: ['contract'] } : { addr_type: 0 }),
        })),
      },
    },
    traders: { operation: 'token-traders', observedAt: 1_000, data: { list: [] } },
    hotSearches: { operation: 'hot-searches', observedAt: 1_000, data: value.hotSearches },
    trending: { operation: 'trending', observedAt: 1_000, data: value.trending },
    receipts: [
      receipt('token-info'),
      receipt('token-security'),
      receipt('token-holders'),
      receipt('token-traders'),
      receipt('hot-searches'),
      receipt('trending'),
    ],
  };
  const result = buildLocalMemeAnalysis(inputFor(value), reads, 2_000);
  assert.equal(result.holderDistribution.holderCount.value, 3);
  assert.equal(result.holderDistribution.top10SharePct.value, 15);
  assert.equal(result.holderDistribution.top100SharePct.value, 15);
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit[0]?.class, 'contract_program');
  assert.equal(result.eoaAnalysis.holderCount.value, 2);
  assert.equal(result.keyWallets[0]?.holderRank, 1);
  assert.equal(result.keyWallets[0]?.sourceHolderRank, 1);
  assert.equal(result.concepts[0]?.basis, 'observed');
  assert.equal(result.concepts[0]?.attentionScore.value, 84);
  assert.equal(result.concepts[1]?.attentionScore.value, null);
  assert.match(result.concepts[1]?.attentionScore.reason || '', /not present/i);
  assert.equal(result.top100Cohorts.every(({ matchCount }) => matchCount.value === null && Boolean(matchCount.reason)), true);
  assert.equal(result.unavailable.some(({ field }) => field === 'top100Cohorts.curated.matchCount'), true);
});

test('GMGN-only evidence remains usable while deferred chain verification stays unavailable', () => {
  const value = fixture('gmgn-local-analysis.json');
  const reads: LocalMemeReadSet = {
    info: {
      operation: 'token-info',
      observedAt: 1_000,
      data: {
        ...value.info.data,
        holder_count: 4,
        stat: {
          fresh_wallet_rate: 0.2736,
          bot_degen_rate: 0.1478,
          top_entrapment_trader_percentage: 0.3972,
        },
      },
    },
    security: { operation: 'token-security', observedAt: 1_000, data: value.security },
    holders: {
      operation: 'token-holders',
      observedAt: 1_000,
      data: {
        list: [
          {
            address: '0x1000000000000000000000000000000000000001',
            amount_percentage: 0.4,
            addr_type: 2,
            exchange: 'pancakeswap_amm',
          },
          {
            address: '0x1000000000000000000000000000000000000002',
            amount_percentage: 0.2,
            addr_type: 2,
            exchange: 'binance',
          },
          {
            address: '0x1000000000000000000000000000000000000003',
            amount_percentage: 0.1,
            amount_cur: 1_000_000,
            addr_type: 0,
            tags: ['smart_degen'],
            maker_token_tags: ['top_holder'],
            realized_profit: 1_200,
            unrealized_profit: 300,
          },
          {
            address: '0x1000000000000000000000000000000000000004',
            amount_percentage: 0.05,
            addr_type: 0,
          },
        ],
      },
    },
    traders: { operation: 'token-traders', observedAt: 1_000, data: { list: [] } },
    hotSearches: { operation: 'hot-searches', observedAt: 1_000, data: value.hotSearches },
    trending: { operation: 'trending', observedAt: 1_000, data: value.trending },
    receipts: [
      receipt('token-info'),
      receipt('token-security'),
      receipt('token-holders'),
      receipt('token-traders'),
      receipt('hot-searches'),
      receipt('trending'),
    ],
  };
  const result = buildLocalMemeAnalysis(inputFor(value), reads, 2_000);
  assert.equal(result.holderDistribution.holderCount.value, 4);
  assert.equal(result.holderDistribution.freshWalletRatePct.value, 27.36);
  assert.equal(result.holderDistribution.botDegenRatePct.value, 14.78);
  assert.equal(result.holderDistribution.entrapmentTraderRatePct.value, 39.72);
  assert.equal(result.holderDistribution.top10SharePct.value, 15);
  assert.equal(result.holderDistribution.top100SharePct.value, 15);
  assert.equal(result.holderDistribution.holderUniverse.topHolder.class, 'liquidity_pool');
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit.some(({ class: exclusionClass }) => exclusionClass === 'exchange_custody'), true);
  assert.equal(result.eoaAnalysis.holderCount.value, 2);
  assert.equal(result.keyWallets[0]?.holderRank, 1);
  assert.equal(result.keyWallets[0]?.sourceHolderRank, 3);
  assert.equal(result.keyWallets[0]?.holdingSharePct, 10);
  assert.equal(result.keyWallets[0]?.realizedPnlUsd, 1_200);
  assert.equal(result.keyWallets[0]?.unrealizedPnlUsd, 300);
  assert.equal(result.concepts[0]?.attentionScore.value, 84);
  assert.equal(result.asset.chainIdentityVerified.value, null);
  assert.match(result.asset.chainIdentityVerified.reason || '', /deferred/i);
  assert.equal(result.receipts.every(({ source }) => source === 'gmgn-cli'), true);
  assert.doesNotMatch(JSON.stringify(result), /Alchemy/);
});

test('partial GMGN-only evidence never converts unsupported fields into zero', () => {
  const value = fixture('gmgn-local-partial.json');
  const reads: LocalMemeReadSet = {
    info: { operation: 'token-info', observedAt: 3_000, data: value.info },
    hotSearches: { operation: 'hot-searches', observedAt: 3_000, data: value.hotSearches },
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

test('burn/system raw rank 1 is audited and the next independent wallet is re-ranked', () => {
  const result = holderCaseResult('burnRankOne');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.status, 'excluded');
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit[0]?.class, 'burn_null_system');
  assert.equal(result.holderDistribution.top10SharePct.value, 10);
  assert.equal(result.keyWallets[0]?.holderRank, 1);
  assert.equal(result.keyWallets[0]?.sourceHolderRank, 2);
});

test('a realistic numbered exchange label overrides GMGN regular-wallet classification', () => {
  const result = holderCaseResult('exchangeRankOne');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.class, 'exchange_custody');
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit[0]?.sourceRank, 1);
  assert.equal(result.holderDistribution.top10SharePct.value, 9);
});

test('GMGN regular-wallet rank 1 is retained as independent', () => {
  const result = holderCaseResult('independentRankOne');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.status, 'independent');
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit.length, 0);
  assert.equal(result.holderDistribution.top10SharePct.value, 30);
});

test('unknown raw rank 1 blocks filtered concentration and holder-derived score', () => {
  const result = holderCaseResult('unknownRankOne');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.status, 'unknown');
  assert.equal(result.holderDistribution.top10SharePct.value, null);
  assert.equal(result.holderDistribution.top100SharePct.value, null);
  assert.equal(result.deterministicScore.value, null);
  assert.equal(result.risks.some(({ code }) => code === 'HOLDER_RANK_ONE_UNKNOWN'), true);
});

test('explicit insider and bundler tags override GMGN regular-wallet classification', () => {
  const result = holderCaseResult('coordinatedRankOne');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.status, 'excluded');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.class, 'other_non_independent');
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit[0]?.sourceRank, 1);
  assert.equal(result.holderDistribution.top10SharePct.value, 6);
});

test('filtered Top 10 backfills from later source rows and keeps source rank separate', () => {
  const result = holderCaseResult('top10Backfill');
  assert.equal(result.holderDistribution.holderUniverse.coverage.top10Complete, true);
  assert.equal(result.holderDistribution.holderUniverse.coverage.top10EligibleCount, 10);
  assert.equal(result.holderDistribution.top10SharePct.value, 10);
  assert.equal(result.holderDistribution.holderUniverse.exclusionAudit[0]?.sourceRank, 1);
});

test('filtered Top 100 is unavailable when the non-pageable source window cannot backfill', () => {
  const result = holderCaseResult('top100Incomplete');
  assert.equal(result.holderDistribution.holderUniverse.coverage.sourceRowCount, 100);
  assert.equal(result.holderDistribution.holderUniverse.coverage.eligibleRowCount, 99);
  assert.equal(result.holderDistribution.holderUniverse.coverage.top100Complete, false);
  assert.equal(result.holderDistribution.top100SharePct.value, null);
  assert.match(result.holderDistribution.top100SharePct.reason || '', /non-pageable/i);
});

test('a holder without GMGN address type or an explicit label remains unknown', () => {
  const result = holderCaseResult('missingGmgnAddressType');
  assert.equal(result.holderDistribution.holderUniverse.topHolder.status, 'unknown');
  assert.equal(result.holderDistribution.top10SharePct.value, null);
});

test('legacy service holder values and key wallets are unavailable without attestation', () => {
  const value = holderUniverseFixture;
  const result = normalizeMemeServicePayload({
    reportVersion: 'meme-analysis-v1',
    asOf: 7_000,
    asset: { chain: 'bsc', ca: value.contractAddress, name: 'Legacy', symbol: 'LEG' },
    holderDistribution: { totalHolders: 1000, top10HolderPct: 42, top100HolderPct: 70 },
    walletLibraryOverlap: {},
    eoaAnalysis: {},
    hotNarrativeAnalysis: {},
    keyMatchedWallets: [{ rank: 1, address: '0xa000000000000000000000000000000000000001', holderRank: 1 }],
  }, inputFor(value), receipt('meme-analysis', 'meme-service'), 8_000);
  assert.equal(result.holderDistribution.holderUniverse.attestation.filtered, false);
  assert.equal(result.holderDistribution.top10SharePct.value, null);
  assert.equal(result.keyWallets.length, 0);
  assert.match(result.keyWalletsReason || '', /attest/i);
});

test('state schema migrates stored results without holder-universe metadata to unavailable values', () => {
  const legacy = JSON.parse(JSON.stringify(holderCaseResult('independentRankOne'))) as Fixture;
  delete legacy.holderDistribution.holderUniverse;
  legacy.holderDistribution.top10SharePct.value = 30;
  const parsed = coinMemeAnalysisResultSchema.parse(legacy);
  assert.equal(parsed.holderDistribution.holderUniverse.attestation.filtered, false);
  assert.equal(parsed.holderDistribution.top10SharePct.value, null);
  assert.equal(parsed.keyWallets.length, 0);
});
