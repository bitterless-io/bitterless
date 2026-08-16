import type { GmgnReadResult } from '../resources/gmgnCli.service';
import { classifyLocalHolder, type LocalHolder } from '../data/memeAnalysis.normalize';
import { canonicalizeTrenchAddress } from '@shared/trench/trench.validation';
import type { TrenchChain, TrenchJsonObject } from '@shared/trench/trench.type';
import {
  TRENCH_INDEX_MAX_CANDIDATES_PER_TARGET,
  TRENCH_INDEX_MAX_WALLETS,
  type TrenchIndexCandidate,
  type TrenchIndexExclusionReason,
  type TrenchIndexRankedWallet,
  type TrenchIndexTargetAnalysis,
  type TrenchIndexTokenMetadata,
  type TrenchWalletClassificationSource,
  type TrenchWalletKind,
} from '@shared/trench/trenchIndex.type';
import { normalizeTrenchXIdentity } from '@shared/trench/trenchPerson.validation';

const REGISTRY_OWNED_EVIDENCE_KEYS = new Set([
  'address',
  'wallet',
  'wallet_address',
  'walletaddress',
  'owner',
  'account',
  'chain',
  'canonical_address',
  'canonicaladdress',
  'name',
  'wallet_name',
  'walletname',
  'display_name',
  'displayname',
  'avatar',
  'avatar_url',
  'avatarurl',
  'note',
  'metadata',
  'metadata_json',
  'metadatasource',
  'metadata_source',
  'wallet_kind',
  'walletkind',
  'twitter',
  'twitter_username',
  'twitterusername',
  'twitter_handle',
  'twitterhandle',
  'x',
  'x_handle',
  'xhandle',
  'x_username',
  'xusername',
  'wallet_score',
  'walletscore',
  'classification_source',
  'classificationsource',
  'classification_updated_at',
  'classificationupdatedat',
  'addr_type',
  'addrtype',
  'exchange',
  'label',
  'labels',
  'tag',
  'tags',
  'maker_token_tags',
  'is_amm',
  'is_lp',
  'is_exchange',
  'is_cex',
  'is_contract',
]);

const MAX_EVIDENCE_BYTES = 16 * 1024;
const MAX_EVIDENCE_DEPTH = 6;
const MAX_EVIDENCE_KEYS = 64;
const MAX_EVIDENCE_ARRAY = 100;
const MAX_EVIDENCE_STRING = 500;

export class TrenchIndexSourceError extends Error {
  readonly code = 'SOURCE_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'TrenchIndexSourceError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const optionalFinite = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = finiteNumber(value);
  if (parsed === null) throw new TrenchIndexSourceError(`${label} must be finite when present.`);
  return parsed;
};

const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && Array.from(text).length <= max && !/[\0\r\n]/.test(text) ? text : null;
};

const valueByKeys = (
  value: unknown,
  keys: readonly string[],
  depth = 0,
  seen = new Set<unknown>(),
): unknown => {
  if (depth > 4 || !isRecord(value) || seen.has(value)) return undefined;
  seen.add(value);
  for (const key of keys) {
    if (Object.hasOwn(value, key) && value[key] !== null && value[key] !== undefined) {
      return value[key];
    }
  }
  for (const key of ['data', 'result', 'token', 'info', 'market', 'stat', 'stats']) {
    const nested = valueByKeys(value[key], keys, depth + 1, seen);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const numericByKeys = (value: unknown, keys: readonly string[]): number | null =>
  finiteNumber(valueByKeys(value, keys));

const textByKeys = (value: unknown, keys: readonly string[], max: number): string | null =>
  boundedText(valueByKeys(value, keys), max);

const booleanMarker = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

const tagsFrom = (value: Record<string, unknown>): string[] => {
  const values: string[] = [];
  for (const key of ['tags', 'labels', 'tag', 'maker_token_tags']) {
    const entry = value[key];
    if (Array.isArray(entry)) {
      values.push(...entry.map((item) => boundedText(item, 80)).filter((item): item is string => !!item));
    } else {
      const text = boundedText(entry, 240);
      if (text) values.push(...text.split(/[,|]/).map((item) => item.trim()).filter(Boolean));
    }
  }
  if (booleanMarker(value.is_contract)) values.push('contract');
  if (booleanMarker(value.is_amm) || booleanMarker(value.is_lp)) values.push('liquidity pool');
  if (booleanMarker(value.is_exchange) || booleanMarker(value.is_cex)) values.push('exchange');
  return [...new Set(values)].slice(0, 12);
};

const sanitizeEvidenceValue = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): unknown => {
  if (depth > MAX_EVIDENCE_DEPTH) {
    throw new TrenchIndexSourceError('Trader evidence exceeds the bounded depth.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TrenchIndexSourceError('Trader evidence contains a non-finite number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_EVIDENCE_STRING || value.includes('\0')) {
      throw new TrenchIndexSourceError('Trader evidence contains an invalid string.');
    }
    return value;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (ancestors.has(value)) throw new TrenchIndexSourceError('Trader evidence contains a cycle.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_EVIDENCE_ARRAY) {
        throw new TrenchIndexSourceError('Trader evidence array is too large.');
      }
      return value
        .map((item) => sanitizeEvidenceValue(item, depth + 1, ancestors))
        .filter((item) => item !== undefined);
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !REGISTRY_OWNED_EVIDENCE_KEYS.has(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > MAX_EVIDENCE_KEYS) {
      throw new TrenchIndexSourceError('Trader evidence object has too many fields.');
    }
    const result: TrenchJsonObject = {};
    for (const [key, item] of entries) {
      const sanitized = sanitizeEvidenceValue(item, depth + 1, ancestors);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
};

export const sanitizeTrenchIndexEvidence = (value: unknown): TrenchJsonObject => {
  if (!isRecord(value)) throw new TrenchIndexSourceError('Trader evidence row must be an object.');
  const sanitized = sanitizeEvidenceValue(value, 0, new Set()) as TrenchJsonObject;
  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new TrenchIndexSourceError('Trader evidence exceeds the bounded byte limit.');
  }
  return sanitized;
};

interface IndexWalletClassification {
  walletKind: TrenchWalletKind;
  eligible: boolean;
  exclusionReason: TrenchIndexExclusionReason | null;
  source: TrenchWalletClassificationSource;
}

const nonUserClassification = (
  classified: ReturnType<typeof classifyLocalHolder>,
): IndexWalletClassification | null => {
  const source: TrenchWalletClassificationSource = classified.evidenceRefs
    .includes('holder-classifier:chain-known-v1')
    ? 'chain-known'
    : 'gmgn-label';
  if (classified.class === 'liquidity_pool') {
    return {
      walletKind: 'amm',
      eligible: false,
      exclusionReason: 'amm-or-liquidity-pool',
      source,
    };
  }
  if (classified.class === 'exchange_custody') {
    return {
      walletKind: 'exchange',
      eligible: false,
      exclusionReason: 'exchange-or-custody',
      source,
    };
  }
  if (classified.class === 'contract_program' || classified.class === 'burn_null_system') {
    return {
      walletKind: 'contract',
      eligible: false,
      exclusionReason: 'contract-or-program',
      source,
    };
  }
  if (classified.class === 'bridge_router' || classified.class === 'treasury_vesting') {
    return {
      walletKind: 'unknown',
      eligible: false,
      exclusionReason: 'other-non-user',
      source,
    };
  }
  return null;
};

const normalizedIndexLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/[_/\\:-]+/g, ' ').replace(/\s+/g, ' ');

const INDEX_AMM_LABELS = new Set(['market maker', 'automated market maker']);

const classifyIndexWallet = (
  chain: TrenchChain,
  holder: LocalHolder,
): IndexWalletClassification => {
  const chainClassification = classifyLocalHolder(chain, {
    ...holder,
    label: null,
    tags: [],
    addressType: null,
    exchange: null,
  }, []);
  const chainExclusion = nonUserClassification(chainClassification);
  if (chainExclusion) {
    return {
      ...chainExclusion,
      source: 'chain-known',
    };
  }

  for (const label of [holder.label, ...holder.tags].filter((value): value is string => !!value)) {
    if (INDEX_AMM_LABELS.has(normalizedIndexLabel(label))) {
      return {
        walletKind: 'amm',
        eligible: false,
        exclusionReason: 'amm-or-liquidity-pool',
        source: 'gmgn-label',
      };
    }
    const labelClassification = classifyLocalHolder(chain, {
      ...holder,
      label,
      tags: [],
      addressType: null,
      exchange: null,
    }, []);
    const labelExclusion = nonUserClassification(labelClassification);
    if (labelExclusion) return { ...labelExclusion, source: 'gmgn-label' };
  }

  if (holder.addressType === 2 && !holder.exchange) {
    return {
      walletKind: 'unknown',
      eligible: false,
      exclusionReason: 'other-non-user',
      source: 'gmgn-addr-type',
    };
  }
  const providerClassification = classifyLocalHolder(chain, {
    ...holder,
    label: null,
    tags: [],
  }, []);
  const providerExclusion = nonUserClassification(providerClassification);
  if (providerExclusion) return { ...providerExclusion, source: 'gmgn-addr-type' };

  if (holder.addressType === 0 || providerClassification.status === 'independent') {
    return {
      walletKind: 'user',
      eligible: true,
      exclusionReason: null,
      source: 'gmgn-addr-type',
    };
  }
  const explicitClassification = classifyLocalHolder(chain, holder, []);
  if (explicitClassification.status === 'independent') {
    return {
      walletKind: 'user',
      eligible: true,
      exclusionReason: null,
      source: 'gmgn-label',
    };
  }
  return {
    walletKind: 'unknown',
    eligible: false,
    exclusionReason: 'unknown-wallet-kind',
    source: 'unclassified',
  };
};

const normalizedAvatarUrl = (value: unknown): string | null => {
  const text = boundedText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

const walletMetadata = (row: Record<string, unknown>): TrenchJsonObject => {
  const metadata: TrenchJsonObject = {};
  const score = optionalFinite(row.wallet_score, 'wallet_score');
  if (score !== null) metadata.walletScore = score;
  return metadata;
};

const providerXIdentity = (value: unknown): TrenchIndexCandidate['xIdentity'] => {
  if (value === undefined || value === null || value === '') return null;
  const identity = normalizeTrenchXIdentity(value);
  if (!identity) throw new TrenchIndexSourceError('Trader X identity is invalid.');
  return identity;
};

export const normalizeTrenchTokenInfo = (
  read: GmgnReadResult,
  observedHighestMarketCapUsd: number | null = null,
): TrenchIndexTokenMetadata => {
  if (read.operation !== 'token-info' || !isRecord(read.data)) {
    throw new TrenchIndexSourceError('Token info response must be an object.');
  }
  const nestedPrice = isRecord(read.data.price) ? finiteNumber(read.data.price.price) : null;
  const priceUsd = nestedPrice ?? numericByKeys(read.data, ['price_usd', 'priceUsd', 'price']);
  const circulatingSupply = numericByKeys(read.data, ['circulating_supply', 'circulatingSupply']);
  const directMarketCap = numericByKeys(read.data, ['market_cap_usd', 'marketCapUsd', 'market_cap', 'marketCap']);
  const currentMarketCapUsd = directMarketCap ?? (
    priceUsd !== null && circulatingSupply !== null ? priceUsd * circulatingSupply : null
  );
  const providerHighest = numericByKeys(read.data, [
    'highest_market_cap_usd',
    'highestMarketCapUsd',
    'history_highest_market_cap',
    'historical_highest_market_cap',
    'ath_market_cap_usd',
    'ath_market_cap',
  ]);
  const athPrice = numericByKeys(read.data, ['ath_price_usd', 'athPriceUsd', 'ath_price', 'athPrice']);
  const estimatedHighest = athPrice !== null && circulatingSupply !== null
    ? athPrice * circulatingSupply
    : null;
  const observedHighest = [observedHighestMarketCapUsd, currentMarketCapUsd]
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .reduce<number | null>((highest, value) => highest === null ? value : Math.max(highest, value), null);
  const highestMarketCapUsd = providerHighest ?? estimatedHighest ?? observedHighest;
  const highestMarketCapKind = providerHighest !== null
    ? 'provider-ath'
    : estimatedHighest !== null
      ? 'estimated-ath'
      : observedHighest !== null
        ? 'observed'
        : 'unavailable';
  for (const [label, value] of [
    ['price', priceUsd],
    ['circulating supply', circulatingSupply],
    ['current market cap', currentMarketCapUsd],
    ['highest market cap', highestMarketCapUsd],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new TrenchIndexSourceError(`Token ${label} must be a non-negative finite number.`);
    }
  }
  return {
    name: textByKeys(read.data, ['name', 'token_name'], 200),
    symbol: textByKeys(read.data, ['symbol', 'token_symbol'], 40),
    priceUsd,
    circulatingSupply,
    currentMarketCapUsd,
    highestMarketCapUsd,
    highestMarketCapKind,
    observedAt: read.observedAt,
  };
};

export const normalizeTrenchTraderCandidates = (
  read: GmgnReadResult,
  chain: TrenchChain,
): TrenchIndexCandidate[] => {
  if (read.operation !== 'token-traders' || !isRecord(read.data) || !Array.isArray(read.data.list)) {
    throw new TrenchIndexSourceError('Token trader response must be an object with a list array.');
  }
  if (read.data.list.length > TRENCH_INDEX_MAX_CANDIDATES_PER_TARGET) {
    throw new TrenchIndexSourceError('Token trader response exceeds the top-100 limit.');
  }
  const candidates: TrenchIndexCandidate[] = [];
  const walletKeys = new Set<string>();
  const sourceRanks = new Set<number>();
  for (const [index, value] of read.data.list.entries()) {
    if (!isRecord(value)) throw new TrenchIndexSourceError('Each token trader row must be an object.');
    const address = boundedText(
      value.address ?? value.wallet_address ?? value.owner ?? value.wallet,
      160,
    );
    if (!address) throw new TrenchIndexSourceError('Each token trader row must contain a wallet address.');
    let canonicalAddress: string;
    try {
      canonicalAddress = canonicalizeTrenchAddress(address, chain, 'trader.address');
    } catch (error) {
      throw new TrenchIndexSourceError(error instanceof Error ? error.message : 'Trader address is invalid.');
    }
    const walletKey = `${chain}:${canonicalAddress}`;
    if (walletKeys.has(walletKey)) {
      throw new TrenchIndexSourceError('Token trader response contains a duplicate wallet.');
    }
    walletKeys.add(walletKey);
    const sourceRankValue = value.rank ?? value.trader_rank ?? index + 1;
    const sourceRankNumber = finiteNumber(sourceRankValue);
    if (
      sourceRankNumber === null ||
      !Number.isInteger(sourceRankNumber) ||
      sourceRankNumber < 1 ||
      sourceRankNumber > TRENCH_INDEX_MAX_CANDIDATES_PER_TARGET ||
      sourceRanks.has(sourceRankNumber)
    ) {
      throw new TrenchIndexSourceError('Token trader response contains an invalid source rank.');
    }
    sourceRanks.add(sourceRankNumber);
    const profitUsd = optionalFinite(value.profit ?? value.profit_usd ?? value.total_profit, 'profit');
    if (profitUsd === null) throw new TrenchIndexSourceError('Each token trader row must contain finite profit.');
    const holder: LocalHolder = {
      address,
      sourceRank: sourceRankNumber,
      sharePct: null,
      amount: null,
      label: boundedText(value.label ?? value.wallet_label ?? value.name, 160),
      tags: tagsFrom(value),
      addressType: optionalFinite(value.addr_type, 'addr_type'),
      exchange: boundedText(value.exchange, 160),
      walletScore: optionalFinite(value.wallet_score ?? value.score, 'wallet_score'),
      realizedPnlUsd: optionalFinite(value.realized_profit ?? value.realized_profit_usd, 'realized_profit'),
      unrealizedPnlUsd: optionalFinite(value.unrealized_profit ?? value.unrealized_profit_usd, 'unrealized_profit'),
    };
    const classification = classifyIndexWallet(chain, holder);
    candidates.push({
      wallet: {
        chain,
        address: canonicalAddress,
        canonicalAddress,
        name: boundedText(value.name ?? value.wallet_name ?? value.display_name, 200),
        avatarUrl: normalizedAvatarUrl(value.avatar_url ?? value.avatar),
        metadata: walletMetadata(value),
        walletKind: classification.walletKind,
        classificationSource: classification.source,
        classificationUpdatedAt: read.observedAt,
      },
      xIdentity: providerXIdentity(value.twitter_username ?? value.twitter),
      sourceRank: sourceRankNumber,
      profitUsd,
      realizedProfitUsd: holder.realizedPnlUsd,
      unrealizedProfitUsd: holder.unrealizedPnlUsd,
      eligible: classification.eligible,
      exclusionReason: classification.exclusionReason,
      evidence: sanitizeTrenchIndexEvidence(value),
    });
  }
  return candidates.sort((left, right) => left.sourceRank - right.sourceRank);
};

interface RankingAccumulator {
  chain: TrenchChain;
  canonicalAddress: string;
  xIdentities: Map<string, Array<{ displayValue: string; sourceRank: number; targetId: string }>>;
  totalProfitUsd: number;
  sourceTargets: Set<string>;
  profitableCaCount: number;
  bestSourceRank: number;
  realizedProfitUsd: number;
  realizedKnown: boolean;
  unrealizedProfitUsd: number;
  unrealizedKnown: boolean;
}

export const rankTrenchIndexWallets = (
  analyses: readonly TrenchIndexTargetAnalysis[],
): TrenchIndexRankedWallet[] => {
  const excludedWallets = new Set<string>();
  for (const analysis of analyses) {
    for (const candidate of analysis.candidates) {
      if (!candidate.eligible || candidate.wallet.walletKind !== 'user') {
        excludedWallets.add(`${candidate.wallet.chain}:${candidate.wallet.canonicalAddress}`);
      }
    }
  }
  const byWallet = new Map<string, RankingAccumulator>();
  for (const analysis of analyses) {
    if (analysis.candidates.length > TRENCH_INDEX_MAX_CANDIDATES_PER_TARGET) {
      throw new TrenchIndexSourceError('A target analysis exceeds the top-100 candidate limit.');
    }
    for (const candidate of analysis.candidates) {
      if (candidate.wallet.chain !== analysis.chain) {
        throw new TrenchIndexSourceError('A candidate wallet belongs to the wrong target chain.');
      }
      const key = `${candidate.wallet.chain}:${candidate.wallet.canonicalAddress}`;
      if (!candidate.eligible || candidate.wallet.walletKind !== 'user' || excludedWallets.has(key)) {
        continue;
      }
      const accumulator = byWallet.get(key) ?? {
        chain: candidate.wallet.chain,
        canonicalAddress: candidate.wallet.canonicalAddress,
        xIdentities: new Map(),
        totalProfitUsd: 0,
        sourceTargets: new Set<string>(),
        profitableCaCount: 0,
        bestSourceRank: candidate.sourceRank,
        realizedProfitUsd: 0,
        realizedKnown: false,
        unrealizedProfitUsd: 0,
        unrealizedKnown: false,
      };
      accumulator.totalProfitUsd += candidate.profitUsd;
      if (candidate.xIdentity) {
        const identityEvidence = accumulator.xIdentities.get(candidate.xIdentity.canonicalValue) ?? [];
        identityEvidence.push({
          displayValue: candidate.xIdentity.displayValue,
          sourceRank: candidate.sourceRank,
          targetId: analysis.targetId,
        });
        accumulator.xIdentities.set(candidate.xIdentity.canonicalValue, identityEvidence);
      }
      accumulator.sourceTargets.add(analysis.targetId);
      if (candidate.profitUsd > 0) accumulator.profitableCaCount += 1;
      accumulator.bestSourceRank = Math.min(accumulator.bestSourceRank, candidate.sourceRank);
      if (candidate.realizedProfitUsd !== null) {
        accumulator.realizedKnown = true;
        accumulator.realizedProfitUsd += candidate.realizedProfitUsd;
      }
      if (candidate.unrealizedProfitUsd !== null) {
        accumulator.unrealizedKnown = true;
        accumulator.unrealizedProfitUsd += candidate.unrealizedProfitUsd;
      }
      if (![
        accumulator.totalProfitUsd,
        accumulator.realizedProfitUsd,
        accumulator.unrealizedProfitUsd,
      ].every(Number.isFinite)) {
        throw new TrenchIndexSourceError('Aggregated wallet profit is not finite.');
      }
      byWallet.set(key, accumulator);
    }
  }
  const chainOrder: readonly TrenchChain[] = ['solana', 'bsc', 'robinhood'];
  return chainOrder.flatMap((chain) => [...byWallet.values()]
    .filter((wallet) => wallet.chain === chain)
    .sort((left, right) =>
      right.totalProfitUsd - left.totalProfitUsd ||
      right.profitableCaCount - left.profitableCaCount ||
      right.sourceTargets.size - left.sourceTargets.size ||
      left.bestSourceRank - right.bestSourceRank ||
      left.canonicalAddress.localeCompare(right.canonicalAddress))
    .slice(0, TRENCH_INDEX_MAX_WALLETS)
    .map((wallet, index) => {
      const [canonicalValue] = wallet.xIdentities.size === 1
        ? [...wallet.xIdentities.keys()]
        : [];
      const preferredIdentity = canonicalValue
        ? [...wallet.xIdentities.get(canonicalValue)!].sort((left, right) =>
            left.sourceRank - right.sourceRank ||
            left.targetId.localeCompare(right.targetId) ||
            left.displayValue.localeCompare(right.displayValue))[0]!
        : null;
      return {
        chain: wallet.chain,
        canonicalAddress: wallet.canonicalAddress,
        xIdentity: canonicalValue && preferredIdentity
          ? { canonicalValue, displayValue: preferredIdentity.displayValue }
          : null,
        chainRank: index + 1,
        totalProfitUsd: wallet.totalProfitUsd,
        sourceCaCount: wallet.sourceTargets.size,
        profitableCaCount: wallet.profitableCaCount,
        bestSourceRank: wallet.bestSourceRank,
        realizedProfitUsd: wallet.realizedKnown ? wallet.realizedProfitUsd : null,
        unrealizedProfitUsd: wallet.unrealizedKnown ? wallet.unrealizedProfitUsd : null,
      };
    }));
};
