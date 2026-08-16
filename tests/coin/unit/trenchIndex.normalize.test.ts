import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTrenchTokenInfo,
  normalizeTrenchTraderCandidates,
  rankTrenchIndexWallets,
} from '../../../src/main/coin/index/trenchIndex.normalize';
import type {
  TrenchIndexCandidate,
  TrenchIndexTargetAnalysis,
} from '../../../src/shared/trench/trenchIndex.type';
import type { TrenchChain } from '../../../src/shared/trench/trench.type';

const evmAddress = (digit: string): string => `0x${digit.repeat(40)}`;

const normalizeRows = (list: Array<Record<string, unknown>>) => normalizeTrenchTraderCandidates({
  operation: 'token-traders',
  observedAt: 3_000,
  data: { list },
}, 'bsc');

const rankedCandidate = (
  chain: TrenchChain,
  address: string,
  profitUsd: number,
  sourceRank: number,
  eligible = true,
): TrenchIndexCandidate => ({
  wallet: {
    chain,
    address,
    canonicalAddress: address,
    name: null,
    avatarUrl: null,
    metadata: {},
    walletKind: eligible ? 'user' : 'amm',
    classificationSource: eligible ? 'gmgn-addr-type' : 'gmgn-label',
    classificationUpdatedAt: 1,
  },
  xIdentity: null,
  sourceRank,
  profitUsd,
  realizedProfitUsd: profitUsd,
  unrealizedProfitUsd: null,
  eligible,
  exclusionReason: eligible ? null : 'amm-or-liquidity-pool',
  evidence: {},
});

const analysis = (
  targetId: string,
  candidates: TrenchIndexCandidate[],
  chain: TrenchChain = 'bsc',
): TrenchIndexTargetAnalysis => ({
  targetId,
  chain,
  contractAddress: chain === 'solana'
    ? 'So11111111111111111111111111111111111111112'
    : evmAddress('f'),
  metadata: normalizeTrenchTokenInfo({
    operation: 'token-info',
    observedAt: 1,
    data: {},
  }),
  candidates,
});

test('normalizes documented nested GMGN price before legacy flat aliases', () => {
  const normalized = normalizeTrenchTokenInfo({
    operation: 'token-info',
    observedAt: 1_000,
    data: {
      price: { price: '0.25' },
      price_usd: '99',
      circulating_supply: '400',
    },
  });

  assert.equal(normalized.priceUsd, 0.25);
  assert.equal(normalized.currentMarketCapUsd, 100);
});

test('normalizes documented GMGN history_highest_market_cap as provider ATH evidence', () => {
  const normalized = normalizeTrenchTokenInfo({
    operation: 'token-info',
    observedAt: 2_000,
    data: {
      history_highest_market_cap: '1234567.89',
    },
  });

  assert.equal(normalized.highestMarketCapUsd, 1_234_567.89);
  assert.equal(normalized.highestMarketCapKind, 'provider-ath');
});

test('classifies INDEX candidates by wallet identity and fails closed for unknowns', () => {
  const candidates = normalizeRows([
    { address: evmAddress('1'), profit: 100, addr_type: 0 },
    { address: evmAddress('2'), profit: 90, addr_type: 0, tags: ['dev', 'sniper', 'smart_degen'] },
    { address: evmAddress('3'), profit: 80, addr_type: 0, label: 'market maker' },
    { address: evmAddress('4'), profit: 70, addr_type: 0, label: 'LP wallet' },
    { address: evmAddress('5'), profit: 60, addr_type: 2, exchange: 'Binance' },
    { address: evmAddress('6'), profit: 50, addr_type: 0, label: 'smart contract' },
    { address: evmAddress('7'), profit: 40 },
    { address: evmAddress('9'), profit: 30, addr_type: 2 },
    { address: evmAddress('a'), profit: 20, addr_type: 0, label: 'bridge router' },
    { address: evmAddress('b'), profit: 10, addr_type: 0, tags: ['project treasury'] },
  ]);

  assert.deepEqual(candidates.map(({ wallet, eligible, exclusionReason }) => ({
    walletKind: wallet.walletKind,
    eligible,
    exclusionReason,
  })), [
    { walletKind: 'user', eligible: true, exclusionReason: null },
    { walletKind: 'user', eligible: true, exclusionReason: null },
    { walletKind: 'amm', eligible: false, exclusionReason: 'amm-or-liquidity-pool' },
    { walletKind: 'amm', eligible: false, exclusionReason: 'amm-or-liquidity-pool' },
    { walletKind: 'exchange', eligible: false, exclusionReason: 'exchange-or-custody' },
    { walletKind: 'contract', eligible: false, exclusionReason: 'contract-or-program' },
    { walletKind: 'unknown', eligible: false, exclusionReason: 'unknown-wallet-kind' },
    { walletKind: 'unknown', eligible: false, exclusionReason: 'other-non-user' },
    { walletKind: 'unknown', eligible: false, exclusionReason: 'other-non-user' },
    { walletKind: 'unknown', eligible: false, exclusionReason: 'other-non-user' },
  ]);
});

test('moves promoted wallet metadata into the registry and strips it from candidate evidence', () => {
  const [candidate] = normalizeRows([{
    address: evmAddress('8'),
    profit: 25,
    addr_type: 0,
    name: 'Promoted name',
    avatar_url: 'https://example.com/avatar.png',
    twitter_username: ' @HoLdEr ',
    wallet_score: 91,
    score: 12,
    transactions: 34,
  }]);

  assert.deepEqual(candidate?.wallet.metadata, { walletScore: 91 });
  assert.deepEqual(candidate?.xIdentity, {
    canonicalValue: 'holder',
    displayValue: '@HoLdEr',
  });
  assert.deepEqual(candidate?.evidence, {
    profit: 25,
    score: 12,
    transactions: 34,
  });
});

test('rejects an explicit invalid X identity instead of silently dropping person evidence', () => {
  assert.throws(() => normalizeRows([{
    address: evmAddress('8'),
    profit: 25,
    addr_type: 0,
    twitter_username: '@not-valid!',
  }]), /X identity is invalid/);
});

test('ranks only eligible users by cross-CA aggregates with deterministic tie keys', () => {
  const walletA = evmAddress('1');
  const walletB = evmAddress('2');
  const bscTie = evmAddress('3');
  const solTie = 'So11111111111111111111111111111111111111112';
  const ranked = rankTrenchIndexWallets([
    analysis('target-a', [
      rankedCandidate('bsc', walletA, 100, 2),
      rankedCandidate('bsc', walletB, 50, 1),
      rankedCandidate('bsc', bscTie, 10, 4),
      rankedCandidate('bsc', evmAddress('9'), 9_999, 5, false),
    ]),
    analysis('target-b', [
      rankedCandidate('bsc', walletA, -20, 3),
      rankedCandidate('bsc', walletB, 30, 1),
    ]),
    analysis('target-sol', [rankedCandidate('solana', solTie, 10, 4)], 'solana'),
  ]);

  assert.deepEqual(ranked.map(({ chain, canonicalAddress, totalProfitUsd }) => ({
    chain,
    canonicalAddress,
    totalProfitUsd,
  })), [
    { chain: 'solana', canonicalAddress: solTie, totalProfitUsd: 10 },
    { chain: 'bsc', canonicalAddress: walletB, totalProfitUsd: 80 },
    { chain: 'bsc', canonicalAddress: walletA, totalProfitUsd: 80 },
    { chain: 'bsc', canonicalAddress: bscTie, totalProfitUsd: 10 },
  ]);
  assert.deepEqual(ranked.filter(({ chain }) => chain === 'bsc').slice(0, 2)
    .map(({ sourceCaCount, profitableCaCount, bestSourceRank }) => ({
    sourceCaCount,
    profitableCaCount,
    bestSourceRank,
  })), [
    { sourceCaCount: 2, profitableCaCount: 2, bestSourceRank: 1 },
    { sourceCaCount: 2, profitableCaCount: 1, bestSourceRank: 2 },
  ]);
  assert.equal(ranked.some(({ canonicalAddress }) => canonicalAddress === evmAddress('9')), false);
  assert.equal(ranked.length, 4);
});

test('caps deterministic INDEX output at 300 on every chain while sources remain top 100', () => {
  const allAnalyses = (['solana', 'bsc', 'robinhood'] as const).flatMap((chain) =>
    Array.from({ length: 4 }, (_, targetIndex) => analysis(
      `target-${chain}-${targetIndex}`,
      Array.from({ length: 100 }, (_, index) => {
        const ordinal = targetIndex * 100 + index + 1;
        const address = chain === 'solana'
          ? `S${String(ordinal).padStart(31, '1')}`
          : `0x${ordinal.toString(16).padStart(40, '0')}`;
        return rankedCandidate(chain, address, 10_000 - ordinal, index + 1);
      }),
      chain,
    )));
  const ranked = rankTrenchIndexWallets(allAnalyses);
  assert.equal(ranked.length, 900);
  for (const chain of ['solana', 'bsc', 'robinhood'] as const) {
    assert.deepEqual(ranked.filter((wallet) => wallet.chain === chain).map(({ chainRank }) => chainRank),
      Array.from({ length: 300 }, (_, index) => index + 1));
    assert.equal(ranked.find((wallet) => wallet.chain === chain)?.chainRank, 1);
  }
  assert.equal(ranked.some(({ canonicalAddress }) =>
    canonicalAddress === `0x${(301).toString(16).padStart(40, '0')}`), false);
});

test('rejects candidate evidence assigned to a different target chain', () => {
  assert.throws(
    () => rankTrenchIndexWallets([
      analysis('target-a', [rankedCandidate('solana', 'So11111111111111111111111111111111111111112', 1, 1)]),
    ]),
    /wrong target chain/,
  );
});

test('keeps the provider candidate boundary at 100 while final ranking accepts 300', () => {
  assert.throws(() => normalizeRows(Array.from({ length: 101 }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    rank: index + 1,
    profit: 101 - index,
    addr_type: 0,
  }))), /top-100 limit/);
  assert.throws(() => rankTrenchIndexWallets([
    analysis('target-over-limit', Array.from({ length: 101 }, (_, index) => rankedCandidate(
      'bsc',
      `0x${(index + 1).toString(16).padStart(40, '0')}`,
      101 - index,
      index + 1,
    ))),
  ]), /top-100 candidate limit/);
});

test('globally excludes a wallet when any CA classifies the identity as non-user', () => {
  const conflicted = evmAddress('c');
  const safe = evmAddress('d');
  const firstOrder = [
    analysis('target-a', [rankedCandidate('bsc', conflicted, 100, 1), rankedCandidate('bsc', safe, 5, 2)]),
    analysis('target-b', [rankedCandidate('bsc', conflicted, 50, 1, false)]),
  ];
  const reversed = [
    analysis('target-b', [...firstOrder[1]!.candidates].reverse()),
    analysis('target-a', [...firstOrder[0]!.candidates].reverse()),
  ];
  assert.deepEqual(rankTrenchIndexWallets(firstOrder), rankTrenchIndexWallets(reversed));
  assert.deepEqual(rankTrenchIndexWallets(firstOrder).map(({ canonicalAddress }) => canonicalAddress), [safe]);
});
