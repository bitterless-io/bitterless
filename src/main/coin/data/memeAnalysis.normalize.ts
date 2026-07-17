import { randomUUID } from 'node:crypto';
import { createUnattestedCoinHolderUniverse } from '@shared/coin/coinAnalysis.type';
import type {
  CoinAttentionConcept,
  CoinChain,
  CoinCohortKey,
  CoinCohortOverlap,
  CoinHolderExclusionAudit,
  CoinHolderExclusionClass,
  CoinHolderUniverseMetadata,
  CoinKeyWallet,
  CoinLaunchStage,
  CoinMemeAnalysisResult,
  CoinMemeAnalyzeInput,
  CoinNullableMetric,
  CoinRatioMetric,
  CoinRiskEvidence,
  CoinSourceId,
  CoinSourceReceipt,
  CoinTokenConceptFit,
  CoinUnavailableField,
} from '@shared/coin/coinAnalysis.type';
import type { GmgnReadResult } from '../resources/gmgnCli.service';
import { coinMemeAnalysisResultSchema } from '../state/coinState.schema';
import { finiteNumber, isRecord, stringValue, timestampValue } from './coinData.normalize';

const COHORTS: Array<{ cohort: CoinCohortKey; label: string }> = [
  { cohort: 'curated', label: 'Curated library' },
  { cohort: 'robinhood', label: 'Robinhood benchmark' },
  { cohort: 'bsc', label: 'BSC benchmark' },
  { cohort: 'pvp', label: 'PVP benchmark' },
];
const COHORT_REASON = 'No reviewed, versioned owner cohort registry is configured for local analysis.';
const ACCOUNT_CLASSIFICATION_REASON = 'GMGN did not explicitly classify every returned holder as independent or non-independent.';
const CHAIN_VERIFICATION_DEFERRED_REASON = 'Independent chain and account verification is deferred in the GMGN-only release.';
const UNSUPPORTED_SCORE_REASON = 'The source did not provide this score; Bitterless does not infer it from rank alone.';
const RANK_ONE_REASON = 'Raw source rank 1 is not verified as independent or non-independent.';
const UNATTESTED_UNIVERSE_REASON = 'The Meme service did not attest that holder-derived values use the filtered holder universe.';

export interface LocalMemeReadSet {
  info?: GmgnReadResult;
  security?: GmgnReadResult;
  holders?: GmgnReadResult;
  traders?: GmgnReadResult;
  trending?: GmgnReadResult;
  hotSearches?: GmgnReadResult;
  receipts: CoinSourceReceipt[];
}

interface LocalHolder {
  address: string;
  sourceRank: number;
  sharePct: number | null;
  amount: number | null;
  label: string | null;
  tags: string[];
  addressType: number | null;
  exchange: string | null;
  walletScore: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
}

interface ClassifiedLocalHolder {
  holder: LocalHolder;
  status: 'independent' | 'excluded' | 'unknown';
  class: CoinHolderExclusionClass | null;
  reason: string;
  evidenceRefs: string[];
}

interface EligibleLocalHolder extends LocalHolder {
  eligibleRank: number;
}

const EVM_BURN_SYSTEM_ADDRESSES = new Set([
  ...Array.from({ length: 11 }, (_, index) => `0x${index.toString(16).padStart(40, '0')}`),
  '0x000000000000000000000000000000000000dead',
]);
const SOLANA_BURN_SYSTEM_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
]);
const SOLANA_PROGRAM_ADDRESSES = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'BPFLoader1111111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
]);
const EXPLICIT_EXCLUSION_LABELS = new Map<string, CoinHolderExclusionClass>([
  ['burn', 'burn_null_system'],
  ['burn address', 'burn_null_system'],
  ['burn null system', 'burn_null_system'],
  ['dead address', 'burn_null_system'],
  ['null address', 'burn_null_system'],
  ['black hole', 'burn_null_system'],
  ['system address', 'burn_null_system'],
  ['exchange', 'exchange_custody'],
  ['exchange custody', 'exchange_custody'],
  ['exchange wallet', 'exchange_custody'],
  ['centralized exchange', 'exchange_custody'],
  ['cex', 'exchange_custody'],
  ['cex wallet', 'exchange_custody'],
  ['custody', 'exchange_custody'],
  ['custody wallet', 'exchange_custody'],
  ['custodian', 'exchange_custody'],
  ['exchange deposit', 'exchange_custody'],
  ['liquidity pool', 'liquidity_pool'],
  ['lp', 'liquidity_pool'],
  ['lp wallet', 'liquidity_pool'],
  ['amm pool', 'liquidity_pool'],
  ['dex pool', 'liquidity_pool'],
  ['contract', 'contract_program'],
  ['contract program', 'contract_program'],
  ['contract address', 'contract_program'],
  ['smart contract', 'contract_program'],
  ['program', 'contract_program'],
  ['program account', 'contract_program'],
  ['bridge', 'bridge_router'],
  ['bridge wallet', 'bridge_router'],
  ['bridge router', 'bridge_router'],
  ['router', 'bridge_router'],
  ['treasury', 'treasury_vesting'],
  ['project treasury', 'treasury_vesting'],
  ['protocol treasury', 'treasury_vesting'],
  ['vesting', 'treasury_vesting'],
  ['vesting wallet', 'treasury_vesting'],
  ['vesting contract', 'treasury_vesting'],
  ['treasury vesting', 'treasury_vesting'],
  ['non independent', 'other_non_independent'],
  ['other non independent', 'other_non_independent'],
  ['dev', 'other_non_independent'],
  ['developer', 'other_non_independent'],
  ['deployer', 'other_non_independent'],
  ['creator', 'other_non_independent'],
  ['token creator', 'other_non_independent'],
  ['insider', 'other_non_independent'],
  ['bundler', 'other_non_independent'],
  ['sniper', 'other_non_independent'],
  ['team', 'other_non_independent'],
  ['non independent wallet', 'other_non_independent'],
  ['market maker', 'other_non_independent'],
  ['protocol wallet', 'other_non_independent'],
  ['team wallet', 'other_non_independent'],
]);
const EXPLICIT_INDEPENDENT_LABELS = new Set(['independent wallet', 'individual wallet']);
const LIQUIDITY_POOL_MARKERS = [
  'amm',
  'dex',
  'liquidity',
  'meteora',
  'orca',
  'pancakeswap',
  'pool',
  'pump',
  'raydium',
  'sushiswap',
  'uniswap',
] as const;
const EXCHANGE_CUSTODY_BRANDS = [
  'binance',
  'okx',
  'bybit',
  'coinbase',
  'kraken',
  'kucoin',
  'mexc',
  'gate.io',
  'htx',
  'huobi',
  'bitget',
  'crypto.com',
  'upbit',
  'bithumb',
  'bitfinex',
  'gemini',
  'robinhood',
] as const;
const EXCHANGE_CUSTODY_SAFE_SUFFIX_TOKENS = new Set<string>([
  'wallet',
  'custody',
  'hot',
  'cold',
  'deposit',
  'withdrawal',
  'exchange',
  'account',
]);

const holderAddressKey = (chain: CoinChain, address: string): string =>
  chain === 'solana' ? address.trim() : address.trim().toLowerCase();

const normalizedClassificationLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/[_/\\:-]+/g, ' ').replace(/\s+/g, ' ');

const isExchangeCustodyBrandLabel = (value: string): boolean =>
  EXCHANGE_CUSTODY_BRANDS.some((brand) => {
    if (value === brand) return true;
    if (!value.startsWith(`${brand} `)) return false;
    const suffixTokens = value.slice(brand.length + 1).split(' ');
    return suffixTokens.length > 0 && suffixTokens.every((token) =>
      EXCHANGE_CUSTODY_SAFE_SUFFIX_TOKENS.has(token) || /^\d+$/.test(token));
  });

const isLiquidityPoolLabel = (value: string): boolean =>
  LIQUIDITY_POOL_MARKERS.some((marker) => value.includes(marker));

const classifyLocalHolder = (
  chain: CoinChain,
  holder: LocalHolder,
  holderEvidence: string[],
): ClassifiedLocalHolder => {
  const addressKey = holderAddressKey(chain, holder.address);
  if (
    (chain === 'solana' && SOLANA_BURN_SYSTEM_ADDRESSES.has(addressKey)) ||
    (chain !== 'solana' && EVM_BURN_SYSTEM_ADDRESSES.has(addressKey))
  ) {
    return {
      holder,
      status: 'excluded',
      class: 'burn_null_system',
      reason: 'A deterministic chain-known burn, null, or system address rule matched this holder.',
      evidenceRefs: [...new Set([...holderEvidence, 'holder-classifier:chain-known-v1'])],
    };
  }
  if (chain === 'solana' && SOLANA_PROGRAM_ADDRESSES.has(addressKey)) {
    return {
      holder,
      status: 'excluded',
      class: 'contract_program',
      reason: 'A deterministic chain-known Solana program address rule matched this holder.',
      evidenceRefs: [...new Set([...holderEvidence, 'holder-classifier:chain-known-v1'])],
    };
  }

  const explicitLabels = [holder.label, ...holder.tags]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ raw: value, normalized: normalizedClassificationLabel(value) }));
  for (const label of explicitLabels) {
    const exclusionClass = EXPLICIT_EXCLUSION_LABELS.get(label.normalized);
    if (exclusionClass) {
      return {
        holder,
        status: 'excluded',
        class: exclusionClass,
        reason: `Explicit holder label/tag "${label.raw}" classifies this address as non-independent.`,
        evidenceRefs: holderEvidence,
      };
    }
    if (isExchangeCustodyBrandLabel(label.normalized)) {
      return {
        holder,
        status: 'excluded',
        class: 'exchange_custody',
        reason: `Explicit exchange/custody brand label "${label.raw}" classifies this address as non-independent.`,
        evidenceRefs: holderEvidence,
      };
    }
    if (EXPLICIT_INDEPENDENT_LABELS.has(label.normalized)) {
      return {
        holder,
        status: 'independent',
        class: null,
        reason: `Explicit holder label/tag "${label.raw}" identifies an independent wallet.`,
        evidenceRefs: holderEvidence,
      };
    }
  }

  if (holder.addressType === 2 || holder.exchange) {
    const exchange = holder.exchange ? normalizedClassificationLabel(holder.exchange) : '';
    const exclusionClass: CoinHolderExclusionClass = isLiquidityPoolLabel(exchange)
      ? 'liquidity_pool'
      : 'exchange_custody';
    return {
      holder,
      status: 'excluded',
      class: exclusionClass,
      reason: holder.exchange
        ? `GMGN addr_type identifies an exchange or liquidity-pool address (${holder.exchange}).`
        : 'GMGN addr_type identifies an exchange or liquidity-pool address.',
      evidenceRefs: holderEvidence,
    };
  }
  if (holder.addressType === 0) {
    return {
      holder,
      status: 'independent',
      class: null,
      reason: 'GMGN addr_type identifies a regular wallet and no higher-precedence exclusion matched.',
      evidenceRefs: holderEvidence,
    };
  }

  return {
    holder,
    status: 'unknown',
    class: null,
    reason: ACCOUNT_CLASSIFICATION_REASON,
    evidenceRefs: holderEvidence,
  };
};

const metric = <T>(value: T, evidenceRefs: string[]): CoinNullableMetric<T> => ({
  value,
  reason: null,
  evidenceRefs: [...new Set(evidenceRefs)],
});

const unavailableMetric = <T>(reason: string, evidenceRefs: string[] = []): CoinNullableMetric<T> => ({
  value: null,
  reason,
  evidenceRefs: [...new Set(evidenceRefs)],
});

const ratio = (value: number, evidenceRefs: string[], numerator: number | null = null, denominator: number | null = null): CoinRatioMetric => ({
  value: Math.max(0, Math.min(100, Math.round(value * 10_000) / 10_000)),
  reason: null,
  evidenceRefs: [...new Set(evidenceRefs)],
  numerator,
  denominator,
});

const unavailableRatio = (reason: string, evidenceRefs: string[] = []): CoinRatioMetric => ({
  value: null,
  reason,
  evidenceRefs: [...new Set(evidenceRefs)],
  numerator: null,
  denominator: null,
});

const readEvidence = (reads: LocalMemeReadSet, operation: GmgnReadResult['operation']): string[] =>
  reads.receipts
    .filter((receipt) => receipt.source === 'gmgn-cli' && receipt.evidenceIds.some((id) => id.includes(operation)))
    .flatMap((receipt) => receipt.evidenceIds);

const valueByKeys = (
  value: unknown,
  keys: string[],
  depth = 0,
  visited = new Set<unknown>(),
): unknown => {
  if (depth > 4 || !value || typeof value !== 'object' || visited.has(value)) return undefined;
  visited.add(value);
  if (isRecord(value)) {
    for (const key of keys) {
      if (Object.hasOwn(value, key) && value[key] !== null && value[key] !== undefined) return value[key];
    }
    for (const nestedKey of ['data', 'result', 'token', 'info', 'market', 'stat', 'stats', 'security']) {
      const nested = valueByKeys(value[nestedKey], keys, depth + 1, visited);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

const firstArray = (value: unknown, preferredKeys: string[], depth = 0): unknown[] => {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.slice(0, 200);
  if (!isRecord(value)) return [];
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return (value[key] as unknown[]).slice(0, 200);
  }
  for (const key of ['data', 'result']) {
    const nested = firstArray(value[key], preferredKeys, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
};

const numberByKeys = (value: unknown, keys: string[]): number | null =>
  finiteNumber(valueByKeys(value, keys));

const textByKeys = (value: unknown, keys: string[], max = 200): string | null =>
  stringValue(valueByKeys(value, keys), max);

const booleanByKeys = (value: unknown, keys: string[]): boolean | null => {
  const found = valueByKeys(value, keys);
  if (typeof found === 'boolean') return found;
  if (found === 1 || found === '1' || found === 'true') return true;
  if (found === 0 || found === '0' || found === 'false') return false;
  return null;
};

const normalizeLaunchStage = (value: unknown): CoinLaunchStage | null => {
  const text = stringValue(value, 80)?.toLowerCase().replace(/[ -]+/g, '_');
  if (!text) return null;
  const aliases: Record<string, CoinLaunchStage> = {
    new_creation: 'discovered',
    filling: 'filling',
    near_completion: 'near_graduation',
    near_graduation: 'near_graduation',
    migration_pending: 'migration_pending',
    completed: 'graduated_recently',
    graduated: 'graduated_recently',
    graduated_recently: 'graduated_recently',
    dex_live: 'dex_live',
    cooled: 'cooled',
    rejected: 'rejected',
    stale: 'stale',
  };
  return aliases[text] ?? null;
};

const tagsFrom = (value: unknown): string[] => {
  const tags: string[] = [];
  for (const key of ['tags', 'labels', 'tag', 'maker_token_tags']) {
    const found = valueByKeys(value, [key]);
    if (Array.isArray(found)) {
      tags.push(...found.map((tag) => stringValue(tag, 80)).filter((tag): tag is string => Boolean(tag)));
      continue;
    }
    const text = stringValue(found, 240);
    if (text) tags.push(...text.split(/[,|]/).map((tag) => tag.trim()).filter(Boolean));
  }
  return [...new Set(tags)].slice(0, 12);
};

const localHolders = (reads: LocalMemeReadSet): LocalHolder[] => {
  const rows = firstArray(reads.holders?.data, ['holders', 'items', 'list', 'rank']);
  const holders: LocalHolder[] = [];
  for (const [index, value] of rows.entries()) {
    if (!isRecord(value)) continue;
    const address = textByKeys(value, ['address', 'wallet_address', 'owner', 'wallet'], 160);
    if (!address) continue;
    const explicitSharePct = numberByKeys(value, [
      'holding_percentage',
      'holding_pct',
      'holdingPercent',
      'percentage',
      'percent',
      'share_pct',
    ]);
    const amountPercentage = numberByKeys(value, ['amount_percentage']);
    const sharePct = explicitSharePct ?? (
      amountPercentage !== null && amountPercentage >= 0
        ? amountPercentage <= 1 ? amountPercentage * 100 : amountPercentage
        : null
    );
    holders.push({
      address,
      sourceRank: Math.max(1, Math.trunc(numberByKeys(value, ['rank', 'holder_rank']) ?? index + 1)),
      sharePct: sharePct !== null && sharePct >= 0 && sharePct <= 100 ? sharePct : null,
      amount: numberByKeys(value, ['amount', 'amount_cur', 'token_amount', 'balance']),
      label: textByKeys(value, ['label', 'wallet_label', 'name'], 160),
      tags: tagsFrom(value),
      addressType: numberByKeys(value, ['addr_type']),
      exchange: textByKeys(value, ['exchange'], 160),
      walletScore: numberByKeys(value, ['wallet_score', 'score']),
      realizedPnlUsd: numberByKeys(value, ['realized_pnl_usd', 'realized_profit_usd', 'realized_profit']),
      unrealizedPnlUsd: numberByKeys(value, ['unrealized_pnl_usd', 'unrealized_profit_usd', 'unrealized_profit']),
    });
  }
  return holders.sort((left, right) => left.sourceRank - right.sourceRank).slice(0, 100);
};

const holderCountMetric = (reads: LocalMemeReadSet, holders: LocalHolder[]) => {
  const holderEvidence = readEvidence(reads, 'token-holders');
  const infoEvidence = readEvidence(reads, 'token-info');
  const holderCount = numberByKeys(reads.holders?.data, ['holder_count', 'holders_count', 'total_holders', 'total']);
  const infoCount = numberByKeys(reads.info?.data, ['holder_count', 'holders_count', 'total_holders']);
  const count = holderCount ?? infoCount;
  const evidence = [...new Set([
    ...(holderCount !== null ? holderEvidence : []),
    ...(infoCount !== null ? infoEvidence : []),
  ])];
  if (count !== null && count >= 0) return metric(Math.trunc(count), evidence);
  if (holders.length > 0 && holders.length < 100) {
    return unavailableMetric<number>('GMGN returned a holder page but did not identify the total holder count.', evidence);
  }
  return unavailableMetric<number>('GMGN did not return a total holder count.', evidence);
};

const concentrationMetric = (
  holders: EligibleLocalHolder[],
  requestedDepth: 10 | 100,
  coverageComplete: boolean,
  completeRawPopulation: boolean,
  sourceRowCount: number,
  evidence: string[],
): CoinRatioMetric => {
  if (!coverageComplete) {
    const reason = requestedDepth === 100
      ? `Filtered Top 100 is unavailable because GMGN's non-pageable source window has ${holders.length} eligible holders across ${sourceRowCount} source rows.`
      : `Filtered Top 10 is unavailable because the source window cannot establish 10 classified eligible holders.`;
    return unavailableRatio(reason, evidence);
  }
  const required = completeRawPopulation ? Math.min(requestedDepth, holders.length) : requestedDepth;
  const selected = holders.slice(0, required);
  if (selected.length < required || selected.some(({ sharePct }) => sharePct === null)) {
    return unavailableRatio(
      `GMGN did not return complete holding-share evidence for the Top ${requestedDepth}.`,
      evidence,
    );
  }
  const share = selected.reduce((sum, holder) => sum + (holder.sharePct ?? 0), 0);
  return ratio(share, evidence, share, 100);
};

const sourceRate = (
  values: unknown[],
  percentageKeys: string[],
  ratioKeys: string[],
  unavailableReason: string,
  evidence: string[],
): CoinRatioMetric => {
  for (const value of values) {
    const percentage = numberByKeys(value, percentageKeys);
    if (percentage !== null && percentage >= 0 && percentage <= 100) {
      return ratio(percentage, evidence);
    }
    const rate = numberByKeys(value, ratioKeys);
    if (rate !== null && rate >= 0 && rate <= 1) return ratio(rate * 100, evidence);
  }
  return unavailableRatio(unavailableReason, evidence);
};

const unavailableCohorts = (reason = COHORT_REASON): CoinCohortOverlap[] =>
  COHORTS.map(({ cohort, label }) => ({
    cohort,
    label,
    matchCount: unavailableMetric<number>(reason),
    holdingSharePct: unavailableRatio(reason),
  }));

const localKeyWallets = (holders: EligibleLocalHolder[], evidence: string[]): CoinKeyWallet[] =>
  holders
    .filter((holder) => holder.label || holder.tags.length > 0)
    .map((holder, index) => ({
      rank: index + 1,
      address: holder.address,
      holderRank: holder.eligibleRank,
      sourceHolderRank: holder.sourceRank,
      label: holder.label ?? holder.tags.join(', '),
      cohorts: [],
      holdingSharePct: holder.sharePct,
      tokenAmount: holder.amount,
      positionValueUsd: null,
      realizedPnlUsd: holder.realizedPnlUsd,
      unrealizedPnlUsd: holder.unrealizedPnlUsd,
      walletScore: holder.walletScore !== null && holder.walletScore >= 0 && holder.walletScore <= 100
        ? holder.walletScore
        : null,
      reason: 'GMGN returned an observed wallet label or tag; no owner cohort match is implied.',
      evidenceRefs: evidence,
    }))
    .slice(0, 30);

const trendDirection = (value: unknown): CoinAttentionConcept['trend'] => {
  const direct = textByKeys(value, ['trend_direction', 'trend', 'direction'], 40)?.toUpperCase();
  if (direct === 'RISING' || direct === 'UP') return 'RISING';
  if (direct === 'STABLE' || direct === 'FLAT') return 'STABLE';
  if (direct === 'FALLING' || direct === 'DOWN') return 'FALLING';
  const change = numberByKeys(value, ['rank_change', 'change']);
  if (change === null) return 'UNAVAILABLE';
  return change > 0 ? 'RISING' : change < 0 ? 'FALLING' : 'STABLE';
};

const observedConcepts = (reads: LocalMemeReadSet): CoinAttentionConcept[] => {
  const sources: Array<{ read: GmgnReadResult | undefined; operation: 'trending' | 'hot-searches'; label: string }> = [
    { read: reads.hotSearches, operation: 'hot-searches', label: 'hot searches' },
    { read: reads.trending, operation: 'trending', label: 'trending' },
  ];
  const seen = new Set<string>();
  const concepts: CoinAttentionConcept[] = [];
  for (const source of sources) {
    const evidenceRefsForSource = readEvidence(reads, source.operation);
    const rows = firstArray(source.read?.data, ['items', 'list', 'tokens', 'rank', 'data']);
    for (const [index, value] of rows.entries()) {
      if (!isRecord(value)) continue;
      const symbol = textByKeys(value, ['symbol', 'token_symbol', 'ticker'], 80);
      const name = textByKeys(value, ['name', 'token_name', 'title'], 160);
      const address = textByKeys(value, ['address', 'contract_address', 'ca'], 160);
      const label = name ?? symbol ?? address;
      if (!label) continue;
      const key = (address ?? symbol ?? label).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const explicitAttention = numberByKeys(value, ['attention_score', 'hot_score', 'score']);
      const explicitGrowth = numberByKeys(value, ['growth_score', 'growth', 'velocity_score']);
      const explicitNovelty = numberByKeys(value, ['novelty_score']);
      const explicitSaturation = numberByKeys(value, ['saturation_score']);
      const scoreMetric = (score: number | null, kind: string) =>
        score !== null && score >= 0 && score <= 100
          ? metric(score, evidenceRefsForSource)
          : unavailableMetric<number>(`${kind} is not present in the GMGN ${source.label} response.`, evidenceRefsForSource);
      concepts.push({
        rank: concepts.length + 1,
        key,
        label,
        basis: 'observed',
        trend: trendDirection(value),
        attentionScore: scoreMetric(explicitAttention, 'Attention score'),
        growthScore: scoreMetric(explicitGrowth, 'Growth score'),
        noveltyScore: scoreMetric(explicitNovelty, 'Novelty score'),
        saturationScore: scoreMetric(explicitSaturation, 'Saturation score'),
        representativeTokens: [symbol ?? name ?? address ?? label],
        evidence: [`Observed at GMGN ${source.label} rank ${index + 1}.`],
        counterEvidence: [],
        risks: ['A market-list rank alone does not establish narrative fit or future attention.'],
        evidenceRefs: evidenceRefsForSource,
      });
      if (concepts.length >= 10) return concepts;
    }
  }
  return concepts;
};

const tokenConceptFits = (
  concepts: CoinAttentionConcept[],
  name: string | null,
  symbol: string | null,
): CoinTokenConceptFit[] => {
  const identities = new Set([name, symbol].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()));
  return concepts
    .filter((concept) => identities.has(concept.label.toLowerCase()) || concept.representativeTokens.some((token) => identities.has(token.toLowerCase())))
    .map((concept) => ({
      conceptKey: concept.key,
      basis: 'observed',
      fitScore: unavailableMetric<number>('Exact token identity is observed, but no semantic concept-fit score is supported.', concept.evidenceRefs),
      summary: 'This token appears directly in current GMGN hot-search or trending evidence.',
      evidence: concept.evidence,
      evidenceRefs: concept.evidenceRefs,
    }));
};

const localRisks = (reads: LocalMemeReadSet): CoinRiskEvidence[] => {
  const security = reads.security?.data;
  const evidence = readEvidence(reads, 'token-security');
  const risks: CoinRiskEvidence[] = [];
  const addBooleanRisk = (keys: string[], code: string, text: string, severity: CoinRiskEvidence['severity'] = 'warning') => {
    if (booleanByKeys(security, keys) === true) risks.push({ code, severity, text, evidenceRefs: evidence });
  };
  addBooleanRisk(['is_honeypot', 'honeypot'], 'HONEYPOT_FLAG', 'GMGN security evidence flags a honeypot.', 'critical');
  addBooleanRisk(['is_mintable', 'mintable'], 'MINTABLE', 'GMGN security evidence indicates supply can be minted.');
  addBooleanRisk(['is_blacklisted', 'blacklist'], 'BLACKLIST_CONTROL', 'GMGN security evidence indicates blacklist controls.');
  addBooleanRisk(['freeze_authority', 'freezable'], 'FREEZE_AUTHORITY', 'GMGN security evidence indicates freeze authority or equivalent control.');
  addBooleanRisk(['owner_change_balance'], 'OWNER_BALANCE_CONTROL', 'GMGN security evidence indicates owner balance controls.');
  const buyTax = numberByKeys(security, ['buy_tax', 'buyTax']);
  const sellTax = numberByKeys(security, ['sell_tax', 'sellTax']);
  if (buyTax !== null && buyTax > 10) {
    risks.push({ code: 'HIGH_BUY_TAX', severity: 'warning', text: `Observed buy tax is ${buyTax}%.`, evidenceRefs: evidence });
  }
  if (sellTax !== null && sellTax > 10) {
    risks.push({ code: 'HIGH_SELL_TAX', severity: 'warning', text: `Observed sell tax is ${sellTax}%.`, evidenceRefs: evidence });
  }
  return risks;
};

const unavailableField = (
  field: string,
  value: CoinNullableMetric<unknown> | CoinRatioMetric,
  source: CoinSourceId | null,
): CoinUnavailableField | null =>
  value.value === null && value.reason ? { field, reason: value.reason, source } : null;

const completeUnavailableFields = (
  result: CoinMemeAnalysisResult,
  initial: CoinUnavailableField[],
): CoinUnavailableField[] => {
  const defaultSource: CoinSourceId = result.mode === 'service' ? 'meme-service' : 'gmgn-cli';
  const collected: Array<CoinUnavailableField | null> = [
    unavailableField('asset.name', result.asset.name, defaultSource),
    unavailableField('asset.symbol', result.asset.symbol, defaultSource),
    unavailableField('asset.launchStage', result.asset.launchStage, defaultSource),
    unavailableField('asset.priceUsd', result.asset.priceUsd, defaultSource),
    unavailableField('asset.marketCapUsd', result.asset.marketCapUsd, defaultSource),
    unavailableField('asset.liquidityUsd', result.asset.liquidityUsd, defaultSource),
    unavailableField('asset.chainIdentityVerified', result.asset.chainIdentityVerified, null),
    unavailableField('asset.contractVerified', result.asset.contractVerified, null),
    unavailableField('holderDistribution.holderCount', result.holderDistribution.holderCount, defaultSource),
    unavailableField('holderDistribution.top10SharePct', result.holderDistribution.top10SharePct, defaultSource),
    unavailableField('holderDistribution.top100SharePct', result.holderDistribution.top100SharePct, defaultSource),
    unavailableField('holderDistribution.freshWalletRatePct', result.holderDistribution.freshWalletRatePct, defaultSource),
    unavailableField('holderDistribution.botDegenRatePct', result.holderDistribution.botDegenRatePct, defaultSource),
    unavailableField('holderDistribution.entrapmentTraderRatePct', result.holderDistribution.entrapmentTraderRatePct, defaultSource),
    unavailableField('holderDistribution.excludedAddressCount', result.holderDistribution.excludedAddressCount, defaultSource),
    unavailableField('eoaAnalysis.holderCount', result.eoaAnalysis.holderCount, defaultSource),
    unavailableField('eoaAnalysis.holdingSharePct', result.eoaAnalysis.holdingSharePct, defaultSource),
    unavailableField('deterministicScore', result.deterministicScore, null),
    unavailableField('confidence', result.confidence, null),
  ];
  for (const cohort of result.top100Cohorts) {
    collected.push(
      unavailableField(`top100Cohorts.${cohort.cohort}.matchCount`, cohort.matchCount, 'owner-cohorts'),
      unavailableField(`top100Cohorts.${cohort.cohort}.holdingSharePct`, cohort.holdingSharePct, 'owner-cohorts'),
    );
  }
  for (const cohort of result.eoaAnalysis.cohorts) {
    collected.push(
      unavailableField(`eoaAnalysis.cohorts.${cohort.cohort}.matchCount`, cohort.matchCount, 'owner-cohorts'),
      unavailableField(`eoaAnalysis.cohorts.${cohort.cohort}.holdingSharePct`, cohort.holdingSharePct, 'owner-cohorts'),
    );
  }
  result.concepts.forEach((concept, index) => {
    collected.push(
      unavailableField(`concepts.${index}.attentionScore`, concept.attentionScore, defaultSource),
      unavailableField(`concepts.${index}.growthScore`, concept.growthScore, defaultSource),
      unavailableField(`concepts.${index}.noveltyScore`, concept.noveltyScore, defaultSource),
      unavailableField(`concepts.${index}.saturationScore`, concept.saturationScore, defaultSource),
    );
  });
  result.tokenConceptFits.forEach((fit, index) => {
    collected.push(unavailableField(`tokenConceptFits.${index}.fitScore`, fit.fitScore, defaultSource));
  });
  const byField = new Map(initial.map((field) => [field.field, field]));
  collected.forEach((field) => {
    if (field) byField.set(field.field, field);
  });
  return [...byField.values()].slice(0, 200);
};

const holderDepthComplete = (
  classified: ClassifiedLocalHolder[],
  eligible: EligibleLocalHolder[],
  depth: 10 | 100,
  completeRawPopulation: boolean,
): boolean => {
  if (eligible.length >= depth) {
    const boundarySourceRank = eligible[depth - 1]?.sourceRank ?? Number.POSITIVE_INFINITY;
    return !classified.some(({ status, holder }) => status === 'unknown' && holder.sourceRank <= boundarySourceRank);
  }
  return completeRawPopulation && classified.every(({ status }) => status !== 'unknown');
};

const localScore = (
  top10: CoinRatioMetric,
  fresh: CoinRatioMetric,
  bot: CoinRatioMetric,
  risks: CoinRiskEvidence[],
  evidenceRefs: string[],
): CoinNullableMetric<number> => {
  if (top10.value === null) {
    return unavailableMetric('Local score v1 requires an available filtered Top 10 concentration.', evidenceRefs);
  }
  const components: number[] = [];
  components.push(Math.max(0, 100 - top10.value * 2));
  if (fresh.value !== null) components.push(Math.min(100, fresh.value * 2));
  if (bot.value !== null) components.push(Math.max(0, 100 - bot.value * 2));
  if (components.length < 2) {
    return unavailableMetric('Local score v1 needs at least two observed holder-quality dimensions.', evidenceRefs);
  }
  const riskPenalty = risks.reduce((sum, risk) => sum + (risk.severity === 'critical' ? 35 : risk.severity === 'warning' ? 10 : 2), 0);
  const score = Math.max(0, Math.min(100, components.reduce((sum, value) => sum + value, 0) / components.length - riskPenalty));
  return metric(Math.round(score * 100) / 100, evidenceRefs);
};

export const buildLocalMemeAnalysis = (
  input: CoinMemeAnalyzeInput,
  reads: LocalMemeReadSet,
  now: number,
): CoinMemeAnalysisResult => {
  const infoEvidence = readEvidence(reads, 'token-info');
  const holderEvidence = readEvidence(reads, 'token-holders');
  const holders = localHolders(reads);
  const holderCount = holderCountMetric(reads, holders);
  const classifiedHolders = holders.map((holder) =>
    classifyLocalHolder(input.chain, holder, holderEvidence));
  const eligibleHolders: EligibleLocalHolder[] = classifiedHolders
    .filter(({ status }) => status === 'independent')
    .map(({ holder }, index) => ({ ...holder, eligibleRank: index + 1 }));
  const exclusionAudit: CoinHolderExclusionAudit[] = classifiedHolders
    .filter((item): item is ClassifiedLocalHolder & { class: CoinHolderExclusionClass } =>
      item.status === 'excluded' && item.class !== null)
    .map(({ holder, class: exclusionClass, reason, evidenceRefs }) => ({
      sourceRank: holder.sourceRank,
      address: holder.address,
      class: exclusionClass,
      reason,
      evidenceRefs,
    }));
  const rawTopHolder = classifiedHolders.find(({ holder }) => holder.sourceRank === 1);
  const topHolder: CoinHolderUniverseMetadata['topHolder'] = rawTopHolder
    ? {
        sourceRank: rawTopHolder.holder.sourceRank,
        address: rawTopHolder.holder.address,
        status: rawTopHolder.status,
        class: rawTopHolder.class,
        reason: rawTopHolder.status === 'unknown' ? RANK_ONE_REASON : rawTopHolder.reason,
        evidenceRefs: rawTopHolder.evidenceRefs,
      }
    : {
        sourceRank: null,
        address: null,
        status: 'unknown',
        class: null,
        reason: 'The GMGN holder source did not include raw source rank 1.',
        evidenceRefs: holderEvidence,
      };
  const rankOneClassified = topHolder.sourceRank === 1 && topHolder.status !== 'unknown';
  const completeRawPopulation = holderCount.value !== null && holders.length >= holderCount.value;
  const top10Complete = rankOneClassified && holderDepthComplete(classifiedHolders, eligibleHolders, 10, completeRawPopulation);
  const top100Complete = rankOneClassified && holderDepthComplete(classifiedHolders, eligibleHolders, 100, completeRawPopulation);
  const holderUniverse: CoinHolderUniverseMetadata = {
    attestation: {
      filtered: true,
      method: 'local-classifier-v1',
      reason: null,
      evidenceRefs: [...new Set([...holderEvidence, 'holder-classifier:local-v1'])],
    },
    topHolder,
    coverage: {
      rawHolderCount: holderCount.value,
      sourceLimit: Math.min(100, Math.max(1, input.holderLimit)),
      sourceRowCount: holders.length,
      classifiedRowCount: classifiedHolders.filter(({ status }) => status !== 'unknown').length,
      eligibleRowCount: eligibleHolders.length,
      excludedRowCount: exclusionAudit.length,
      unknownRowCount: classifiedHolders.filter(({ status }) => status === 'unknown').length,
      top10EligibleCount: Math.min(10, eligibleHolders.length),
      top10Complete,
      top100EligibleCount: Math.min(100, eligibleHolders.length),
      top100Complete,
    },
    exclusionAudit,
  };
  const concentrationEvidence = holderEvidence;
  const top10SharePct = rankOneClassified
    ? concentrationMetric(eligibleHolders, 10, top10Complete, completeRawPopulation, holders.length, concentrationEvidence)
    : unavailableRatio(`Filtered Top 10 is unavailable because ${RANK_ONE_REASON}`, concentrationEvidence);
  const top100SharePct = rankOneClassified
    ? concentrationMetric(eligibleHolders, 100, top100Complete, completeRawPopulation, holders.length, concentrationEvidence)
    : unavailableRatio(`Filtered Top 100 is unavailable because ${RANK_ONE_REASON}`, concentrationEvidence);
  const freshWalletRatePct = sourceRate(
    [reads.holders?.data, reads.info?.data],
    ['fresh_wallet_rate_pct', 'fresh_rate_pct'],
    ['fresh_wallet_rate', 'fresh_rate'],
    'GMGN did not supply a fresh-wallet rate.',
    [...new Set([...holderEvidence, ...infoEvidence])],
  );
  const botDegenRatePct = sourceRate(
    [reads.holders?.data, reads.info?.data],
    ['bot_degen_rate_pct', 'bot_rate_pct'],
    ['bot_degen_rate', 'bot_rate'],
    'GMGN did not supply a bot/degen rate.',
    [...new Set([...holderEvidence, ...infoEvidence])],
  );
  const traderEvidence = readEvidence(reads, 'token-traders');
  const entrapmentTraderRatePct = sourceRate(
    [reads.traders?.data, reads.info?.data],
    ['top_entrapment_trader_pct', 'entrapment_trader_rate_pct'],
    ['top_entrapment_trader_percentage', 'entrapment_trader_rate', 'entrapment_rate'],
    'GMGN did not supply an entrapment-trader rate.',
    [...new Set([...traderEvidence, ...infoEvidence])],
  );

  const nameValue = textByKeys(reads.info?.data, ['name', 'token_name'], 200);
  const symbolValue = textByKeys(reads.info?.data, ['symbol', 'token_symbol', 'ticker'], 80);
  const launchStageValue = normalizeLaunchStage(valueByKeys(reads.info?.data, ['launch_stage', 'stage', 'status']));
  const priceValue = numberByKeys(reads.info?.data, ['price_usd', 'priceUsd', 'price']);
  const marketCapValue = numberByKeys(reads.info?.data, ['market_cap_usd', 'marketCapUsd', 'market_cap']);
  const liquidityValue = numberByKeys(reads.info?.data, ['liquidity_usd', 'liquidityUsd', 'liquidity']);
  const missingFromInfo = (label: string) => `${label} is not present in the GMGN token-info response.`;

  const classificationComplete = (holders.length > 0 || holderCount.value === 0) &&
    classifiedHolders.every(({ status }) => status !== 'unknown');
  const walletSharesComplete = classificationComplete && eligibleHolders.every(({ sharePct }) => sharePct !== null);
  const eoaHolderCount = classificationComplete
    ? metric(eligibleHolders.length, concentrationEvidence)
    : unavailableMetric<number>(ACCOUNT_CLASSIFICATION_REASON, concentrationEvidence);
  const eoaHoldingShare = walletSharesComplete
    ? ratio(
        eligibleHolders.reduce((sum, holder) => sum + (holder.sharePct ?? 0), 0),
        concentrationEvidence,
      )
    : unavailableRatio(ACCOUNT_CLASSIFICATION_REASON, concentrationEvidence);
  const excludedCount = reads.holders
    ? metric(exclusionAudit.length, concentrationEvidence)
    : unavailableMetric<number>('GMGN did not return a holder source window.', concentrationEvidence);
  const excludedGroups = new Map<CoinHolderExclusionClass, CoinHolderExclusionAudit[]>();
  exclusionAudit.forEach((entry) => {
    excludedGroups.set(entry.class, [...(excludedGroups.get(entry.class) ?? []), entry]);
  });
  const excludedByType = [...excludedGroups.entries()].map(([type, entries]) => ({
    type,
    count: entries.length,
    evidenceRefs: [...new Set(entries.flatMap(({ evidenceRefs }) => evidenceRefs))],
  }));

  const concepts = observedConcepts(reads);
  const fits = tokenConceptFits(concepts, nameValue, symbolValue);
  const keyWallets = localKeyWallets(eligibleHolders, concentrationEvidence);
  const risks = localRisks(reads);
  const holderWarnings: string[] = [];
  if (!rankOneClassified) {
    risks.push({
      code: 'HOLDER_RANK_ONE_UNKNOWN',
      severity: 'warning',
      text: `${RANK_ONE_REASON} Filtered concentration and the holder-derived deterministic score are unavailable.`,
      evidenceRefs: topHolder.evidenceRefs,
    });
    holderWarnings.push(`${RANK_ONE_REASON} Holder-derived concentration and scoring are blocked.`);
  }
  if (rankOneClassified && !top100Complete) {
    risks.push({
      code: 'HOLDER_TOP100_INCOMPLETE',
      severity: 'warning',
      text: 'The filtered Top 100 is incomplete because the bounded GMGN source window cannot backfill all exclusions or unknown rows.',
      evidenceRefs: concentrationEvidence,
    });
    holderWarnings.push('Filtered Top 100 coverage is incomplete in the non-pageable GMGN holder window.');
  }
  const scoreEvidence = [...new Set([...holderEvidence, ...traderEvidence, ...risks.flatMap((risk) => risk.evidenceRefs)])];
  const deterministicScore = rankOneClassified
    ? localScore(top10SharePct, freshWalletRatePct, botDegenRatePct, risks, scoreEvidence)
    : unavailableMetric(`Local score v1 is unavailable because ${RANK_ONE_REASON}`, scoreEvidence);
  const confidenceDimensions = [
    nameValue,
    priceValue,
    holderCount.value,
    top10SharePct.value,
    freshWalletRatePct.value,
    botDegenRatePct.value,
    entrapmentTraderRatePct.value,
  ];
  const availableDimensions = confidenceDimensions.filter((value) => value !== null && value !== undefined).length;
  const confidence = availableDimensions > 0
    ? metric(Math.round(Math.min(0.9, availableDimensions / confidenceDimensions.length) * 100) / 100, reads.receipts.flatMap((receipt) => receipt.evidenceIds))
    : unavailableMetric<number>('No supported local evidence dimensions were returned.');

  const result: CoinMemeAnalysisResult = {
    schema: 'coin-meme-analysis-v1',
    id: randomUUID(),
    mode: 'local_cli_rpc',
    generatedAt: now,
    asset: {
      chain: input.chain,
      contractAddress: input.contractAddress,
      name: nameValue ? metric(nameValue, infoEvidence) : unavailableMetric(missingFromInfo('Token name'), infoEvidence),
      symbol: symbolValue ? metric(symbolValue, infoEvidence) : unavailableMetric(missingFromInfo('Token symbol'), infoEvidence),
      launchStage: launchStageValue ? metric(launchStageValue, infoEvidence) : unavailableMetric(missingFromInfo('Launch stage'), infoEvidence),
      priceUsd: priceValue !== null && priceValue >= 0 ? metric(priceValue, infoEvidence) : unavailableMetric(missingFromInfo('USD price'), infoEvidence),
      marketCapUsd: marketCapValue !== null && marketCapValue >= 0 ? metric(marketCapValue, infoEvidence) : unavailableMetric(missingFromInfo('Market cap'), infoEvidence),
      liquidityUsd: liquidityValue !== null && liquidityValue >= 0 ? metric(liquidityValue, infoEvidence) : unavailableMetric(missingFromInfo('Liquidity'), infoEvidence),
      chainIdentityVerified: unavailableMetric(CHAIN_VERIFICATION_DEFERRED_REASON),
      contractVerified: unavailableMetric(CHAIN_VERIFICATION_DEFERRED_REASON),
    },
    holderDistribution: {
      holderCount,
      top10SharePct,
      top100SharePct,
      freshWalletRatePct,
      botDegenRatePct,
      entrapmentTraderRatePct,
      excludedAddressCount: excludedCount,
      excludedByType,
      holderUniverse,
    },
    top100Cohorts: unavailableCohorts(),
    eoaAnalysis: {
      label: input.chain === 'solana' ? 'INDEPENDENT_WALLET' : 'EOA',
      holderCount: eoaHolderCount,
      holdingSharePct: eoaHoldingShare,
      cohorts: unavailableCohorts(),
    },
    keyWallets,
    keyWalletsReason: keyWallets.length > 0
      ? null
      : 'GMGN returned no labelled wallets in the classified eligible holder universe.',
    concepts,
    tokenConceptFits: fits,
    conceptsReason: concepts.length > 0
      ? null
      : 'GMGN hot-search and trending responses contained no supported token evidence.',
    risks,
    deterministicScore,
    confidence,
    unavailable: [],
    warnings: [
      'Local GMGN CLI mode is explicit and does not fall back to a deployed Meme service.',
      COHORT_REASON,
      ...holderWarnings,
    ],
    receipts: reads.receipts,
  };

  const unavailable = [
    unavailableField('asset.name', result.asset.name, 'gmgn-cli'),
    unavailableField('asset.symbol', result.asset.symbol, 'gmgn-cli'),
    unavailableField('asset.launchStage', result.asset.launchStage, 'gmgn-cli'),
    unavailableField('asset.priceUsd', result.asset.priceUsd, 'gmgn-cli'),
    unavailableField('asset.marketCapUsd', result.asset.marketCapUsd, 'gmgn-cli'),
    unavailableField('asset.liquidityUsd', result.asset.liquidityUsd, 'gmgn-cli'),
    unavailableField('holderDistribution.holderCount', holderCount, 'gmgn-cli'),
    unavailableField('holderDistribution.top10SharePct', top10SharePct, 'gmgn-cli'),
    unavailableField('holderDistribution.top100SharePct', top100SharePct, 'gmgn-cli'),
    unavailableField('holderDistribution.freshWalletRatePct', freshWalletRatePct, 'gmgn-cli'),
    unavailableField('holderDistribution.botDegenRatePct', botDegenRatePct, 'gmgn-cli'),
    unavailableField('holderDistribution.entrapmentTraderRatePct', entrapmentTraderRatePct, 'gmgn-cli'),
    unavailableField('eoaAnalysis.holderCount', eoaHolderCount, 'gmgn-cli'),
    unavailableField('eoaAnalysis.holdingSharePct', eoaHoldingShare, 'gmgn-cli'),
    unavailableField('deterministicScore', deterministicScore, null),
  ].filter((field): field is CoinUnavailableField => Boolean(field));
  for (const cohort of COHORTS) {
    unavailable.push({
      field: `top100Cohorts.${cohort.cohort}`,
      reason: COHORT_REASON,
      source: 'owner-cohorts',
    });
    unavailable.push({
      field: `eoaAnalysis.cohorts.${cohort.cohort}`,
      reason: COHORT_REASON,
      source: 'owner-cohorts',
    });
  }
  result.unavailable = completeUnavailableFields(result, unavailable);
  return coinMemeAnalysisResultSchema.parse(result) as CoinMemeAnalysisResult;
};

const legacyChain = (value: unknown): CoinChain | null => {
  if (value === 'sol' || value === 'solana') return 'solana';
  if (value === 'bsc' || value === 'robinhood') return value;
  return null;
};

const legacyCohorts = (
  groups: unknown,
  matchCount: unknown,
  holdingPct: unknown,
  evidenceRefs: string[],
): CoinCohortOverlap[] => {
  const records = Array.isArray(groups) ? groups.filter(isRecord) : [];
  const groupFor = (cohort: CoinCohortKey) => records.find((item) => {
    const key = stringValue(item.key, 100)?.toLowerCase() ?? '';
    return key.includes(cohort);
  });
  return COHORTS.map(({ cohort, label }) => {
    const group = cohort === 'curated' ? null : groupFor(cohort);
    const count = finiteNumber(group?.matchCount ?? (cohort === 'curated' ? matchCount : null));
    const share = finiteNumber(group?.holdingPct ?? (cohort === 'curated' ? holdingPct : null));
    const reason = `The Meme service did not supply ${label} overlap.`;
    return {
      cohort,
      label: stringValue(group?.label, 120) ?? label,
      matchCount: count !== null && count >= 0 ? metric(Math.trunc(count), evidenceRefs) : unavailableMetric(reason, evidenceRefs),
      holdingSharePct: share !== null && share >= 0 && share <= 100 ? ratio(share, evidenceRefs) : unavailableRatio(reason, evidenceRefs),
    };
  });
};

const unavailableExistingCohorts = (
  cohorts: CoinCohortOverlap[],
  reason: string,
): CoinCohortOverlap[] => cohorts.map((cohort) => ({
  ...cohort,
  matchCount: unavailableMetric(reason, cohort.matchCount.evidenceRefs),
  holdingSharePct: unavailableRatio(reason, cohort.holdingSharePct.evidenceRefs),
}));

const gateUnattestedServiceUniverse = (
  result: CoinMemeAnalysisResult,
  reason: string,
): void => {
  const evidenceRefs = result.receipts.flatMap(({ evidenceIds }) => evidenceIds);
  result.holderDistribution.top10SharePct = unavailableRatio(reason, result.holderDistribution.top10SharePct.evidenceRefs);
  result.holderDistribution.top100SharePct = unavailableRatio(reason, result.holderDistribution.top100SharePct.evidenceRefs);
  result.holderDistribution.excludedAddressCount = unavailableMetric(reason, evidenceRefs);
  result.holderDistribution.excludedByType = [];
  result.holderDistribution.holderUniverse = createUnattestedCoinHolderUniverse(reason);
  result.top100Cohorts = unavailableExistingCohorts(result.top100Cohorts, reason);
  result.eoaAnalysis.holderCount = unavailableMetric(reason, result.eoaAnalysis.holderCount.evidenceRefs);
  result.eoaAnalysis.holdingSharePct = unavailableRatio(reason, result.eoaAnalysis.holdingSharePct.evidenceRefs);
  result.eoaAnalysis.cohorts = unavailableExistingCohorts(result.eoaAnalysis.cohorts, reason);
  result.keyWallets = [];
  result.keyWalletsReason = reason;
  result.deterministicScore = unavailableMetric(reason, result.deterministicScore.evidenceRefs);
};

const enforceServiceHolderUniverse = (result: CoinMemeAnalysisResult): void => {
  const universe = result.holderDistribution.holderUniverse;
  const serviceAttested = universe.attestation.filtered && universe.attestation.method === 'service-attestation';
  if (!serviceAttested) {
    gateUnattestedServiceUniverse(result, UNATTESTED_UNIVERSE_REASON);
    if (!result.risks.some(({ code }) => code === 'HOLDER_UNIVERSE_UNATTESTED')) {
      result.risks.push({
        code: 'HOLDER_UNIVERSE_UNATTESTED',
        severity: 'warning',
        text: UNATTESTED_UNIVERSE_REASON,
        evidenceRefs: result.receipts.flatMap(({ evidenceIds }) => evidenceIds),
      });
    }
    if (!result.warnings.includes(UNATTESTED_UNIVERSE_REASON)) result.warnings.push(UNATTESTED_UNIVERSE_REASON);
    result.risks = result.risks.slice(-100);
    result.warnings = result.warnings.slice(-100);
    return;
  }

  const excludedAddresses = new Set(
    universe.exclusionAudit.map(({ address }) => holderAddressKey(result.asset.chain, address)),
  );
  const filteredKeyWallets = result.keyWallets.filter(({ address }) =>
    !excludedAddresses.has(holderAddressKey(result.asset.chain, address)));
  if (filteredKeyWallets.length !== result.keyWallets.length) {
    result.keyWallets = filteredKeyWallets.map((wallet, index) => ({ ...wallet, rank: index + 1 }));
    if (result.keyWallets.length === 0) {
      result.keyWalletsReason = 'All service key-wallet rows were present in the holder exclusion audit.';
    }
    result.warnings.push('Service key-wallet rows present in the exclusion audit were removed locally.');
  }

  const rankOneVerified = universe.topHolder.sourceRank === 1 && universe.topHolder.status !== 'unknown';
  const rankOneReason = `Holder-derived service values are unavailable because ${RANK_ONE_REASON}`;
  if (!rankOneVerified || !universe.coverage.top10Complete) {
    const reason = rankOneVerified
      ? 'Filtered Top 10 is unavailable because the service attestation reports incomplete eligible coverage.'
      : rankOneReason;
    result.holderDistribution.top10SharePct = unavailableRatio(reason, result.holderDistribution.top10SharePct.evidenceRefs);
    result.deterministicScore = unavailableMetric(reason, result.deterministicScore.evidenceRefs);
  }
  if (!rankOneVerified || !universe.coverage.top100Complete) {
    const reason = rankOneVerified
      ? 'Filtered Top 100 is unavailable because the service attestation reports incomplete eligible coverage.'
      : rankOneReason;
    result.holderDistribution.top100SharePct = unavailableRatio(reason, result.holderDistribution.top100SharePct.evidenceRefs);
    result.top100Cohorts = unavailableExistingCohorts(result.top100Cohorts, reason);
  }
  if (!rankOneVerified && !result.risks.some(({ code }) => code === 'HOLDER_RANK_ONE_UNKNOWN')) {
    result.risks.push({
      code: 'HOLDER_RANK_ONE_UNKNOWN',
      severity: 'warning',
      text: rankOneReason,
      evidenceRefs: universe.topHolder.evidenceRefs,
    });
    result.warnings.push(rankOneReason);
  }
  result.risks = result.risks.slice(-100);
  result.warnings = result.warnings.slice(-100);
};

export const normalizeMemeServicePayload = (
  payload: unknown,
  input: CoinMemeAnalyzeInput,
  serviceReceipt: CoinSourceReceipt,
  now: number,
): CoinMemeAnalysisResult => {
  if (isRecord(payload) && payload.schema === 'coin-meme-analysis-v1') {
    const parsed = coinMemeAnalysisResultSchema.parse(payload) as CoinMemeAnalysisResult;
    if (
      parsed.mode !== 'service' ||
      parsed.asset.chain !== input.chain ||
      parsed.asset.contractAddress.toLowerCase() !== input.contractAddress.toLowerCase()
    ) {
      throw new Error('meme-service-identity-mismatch');
    }
    const result: CoinMemeAnalysisResult = {
      ...parsed,
      receipts: [...parsed.receipts, serviceReceipt].slice(-40),
    };
    enforceServiceHolderUniverse(result);
    result.unavailable = completeUnavailableFields(result, result.unavailable);
    return coinMemeAnalysisResultSchema.parse(result) as CoinMemeAnalysisResult;
  }
  if (!isRecord(payload) || payload.reportVersion !== 'meme-analysis-v1') {
    throw new Error('invalid-meme-service-response');
  }
  const asset = isRecord(payload.asset) ? payload.asset : {};
  const distribution = isRecord(payload.holderDistribution) ? payload.holderDistribution : {};
  const overlap = isRecord(payload.walletLibraryOverlap) ? payload.walletLibraryOverlap : {};
  const eoa = isRecord(payload.eoaAnalysis) ? payload.eoaAnalysis : {};
  const narratives = isRecord(payload.hotNarrativeAnalysis) ? payload.hotNarrativeAnalysis : {};
  const parsedChain = legacyChain(asset.chain);
  const contractAddress = stringValue(asset.ca, 160);
  if (
    parsedChain !== input.chain ||
    !contractAddress ||
    contractAddress.toLowerCase() !== input.contractAddress.toLowerCase()
  ) {
    throw new Error('meme-service-identity-mismatch');
  }
  const evidence = serviceReceipt.evidenceIds;
  const numberMetric = (value: unknown, reason: string) => {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? metric(number, evidence) : unavailableMetric<number>(reason, evidence);
  };
  const percentMetric = (value: unknown, reason: string) => {
    const number = finiteNumber(value);
    return number !== null && number >= 0 && number <= 100 ? ratio(number, evidence) : unavailableRatio(reason, evidence);
  };
  const name = stringValue(asset.name, 200);
  const symbol = stringValue(asset.symbol, 80);
  const stage = normalizeLaunchStage(asset.launchStage);
  const topCohorts = legacyCohorts(overlap.benchmarkGroups, overlap.top100LibraryMatchCount, overlap.matchedHoldingPct, evidence);
  const eoaCohorts = legacyCohorts(eoa.benchmarkGroups, eoa.libraryMatchCount, eoa.matchedHoldingPct, evidence);
  const concepts = (Array.isArray(narratives.marketNarratives) ? narratives.marketNarratives : [])
    .filter(isRecord)
    .slice(0, 30)
    .map<CoinAttentionConcept | null>((item, index) => {
      const label = stringValue(item.label, 160);
      if (!label) return null;
      const key = stringValue(item.key, 160) ?? label.toLowerCase().replace(/\s+/g, '-');
      const scoreMetric = (value: unknown, label: string) => {
        const score = finiteNumber(value);
        return score !== null && score >= 0 && score <= 100
          ? metric(score, evidence)
          : unavailableMetric<number>(`The Meme service did not supply ${label}.`, evidence);
      };
      return {
        rank: Math.max(1, Math.trunc(finiteNumber(item.rank) ?? index + 1)),
        key,
        label,
        basis: 'observed',
        trend: trendDirection(item),
        attentionScore: scoreMetric(item.attentionScore, 'attention score'),
        growthScore: scoreMetric(item.growthScore, 'growth score'),
        noveltyScore: scoreMetric(item.noveltyScore, 'novelty score'),
        saturationScore: scoreMetric(item.saturationScore, 'saturation score'),
        representativeTokens: Array.isArray(item.representativeTokens)
          ? item.representativeTokens.map((token) => stringValue(token, 120)).filter((token): token is string => Boolean(token)).slice(0, 30)
          : [],
        evidence: Array.isArray(item.evidence) ? item.evidence.map((text) => stringValue(text, 500)).filter((text): text is string => Boolean(text)).slice(0, 30) : [],
        counterEvidence: Array.isArray(item.counterEvidence) ? item.counterEvidence.map((text) => stringValue(text, 500)).filter((text): text is string => Boolean(text)).slice(0, 30) : [],
        risks: Array.isArray(item.risks) ? item.risks.map((text) => stringValue(text, 500)).filter((text): text is string => Boolean(text)).slice(0, 30) : [],
        evidenceRefs: evidence,
      };
    })
    .filter((concept): concept is CoinAttentionConcept => concept !== null);
  const fits = (Array.isArray(narratives.tokenFits) ? narratives.tokenFits : [])
    .filter(isRecord)
    .slice(0, 30)
    .map<CoinTokenConceptFit | null>((item) => {
      const conceptKey = stringValue(item.narrativeKey, 160);
      if (!conceptKey) return null;
      const score = finiteNumber(item.fitScore);
      return {
        conceptKey,
        basis: 'inferred',
        fitScore: score !== null && score >= 0 && score <= 100
          ? metric(score, evidence)
          : unavailableMetric('The Meme service did not supply a concept-fit score.', evidence),
        summary: stringValue(item.summary, 500) ?? 'The Meme service returned no fit summary.',
        evidence: Array.isArray(item.evidence) ? item.evidence.map((text) => stringValue(text, 500)).filter((text): text is string => Boolean(text)).slice(0, 30) : [],
        evidenceRefs: evidence,
      };
    })
    .filter((fit): fit is CoinTokenConceptFit => fit !== null);
  const keyWallets = (Array.isArray(payload.keyMatchedWallets) ? payload.keyMatchedWallets : [])
    .filter(isRecord)
    .slice(0, 100)
    .map<CoinKeyWallet | null>((wallet, index) => {
      const address = stringValue(wallet.address, 160);
      if (!address) return null;
      const holdingSharePct = finiteNumber(wallet.holdingPct);
      const tokenAmount = finiteNumber(wallet.tokenAmount);
      const positionValueUsd = finiteNumber(wallet.positionValueUsd);
      const walletScore = finiteNumber(wallet.walletScore);
      return {
        rank: Math.max(1, Math.trunc(finiteNumber(wallet.rank) ?? index + 1)),
        address,
        holderRank: finiteNumber(wallet.holderRank) === null ? null : Math.max(1, Math.trunc(finiteNumber(wallet.holderRank)!)),
        sourceHolderRank: finiteNumber(wallet.sourceHolderRank) === null
          ? null
          : Math.max(1, Math.trunc(finiteNumber(wallet.sourceHolderRank)!)),
        label: (Array.isArray(wallet.tags) ? wallet.tags.map((tag) => stringValue(tag, 80)).filter(Boolean).join(', ') : '') || 'Service-labelled wallet',
        cohorts: [],
        holdingSharePct: holdingSharePct !== null && holdingSharePct >= 0 && holdingSharePct <= 100 ? holdingSharePct : null,
        tokenAmount: tokenAmount !== null && tokenAmount >= 0 ? tokenAmount : null,
        positionValueUsd: positionValueUsd !== null && positionValueUsd >= 0 ? positionValueUsd : null,
        realizedPnlUsd: finiteNumber(wallet.realizedPnlUsd),
        unrealizedPnlUsd: finiteNumber(wallet.unrealizedPnlUsd),
        walletScore: walletScore !== null && walletScore >= 0 && walletScore <= 100 ? walletScore : null,
        reason: Array.isArray(wallet.evidence)
          ? wallet.evidence.map((item) => stringValue(item, 500)).filter(Boolean).join('; ').slice(0, 500) || 'Service supplied a wallet label without narrative evidence.'
          : 'Service supplied a wallet label without narrative evidence.',
        evidenceRefs: evidence,
      };
    })
    .filter((wallet): wallet is CoinKeyWallet => wallet !== null);
  const dataConfidence = finiteNumber(payload.dataConfidence);
  const result: CoinMemeAnalysisResult = {
    schema: 'coin-meme-analysis-v1',
    id: randomUUID(),
    mode: 'service',
    generatedAt: timestampValue(payload.asOf) ?? now,
    asset: {
      chain: parsedChain,
      contractAddress,
      name: name ? metric(name, evidence) : unavailableMetric('The Meme service did not supply a token name.', evidence),
      symbol: symbol ? metric(symbol, evidence) : unavailableMetric('The Meme service did not supply a token symbol.', evidence),
      launchStage: stage ? metric(stage, evidence) : unavailableMetric('The Meme service did not supply a supported launch stage.', evidence),
      priceUsd: numberMetric(asset.priceUsd, 'The Meme service did not supply a USD price.'),
      marketCapUsd: numberMetric(asset.marketCapUsd, 'The Meme service did not supply market cap.'),
      liquidityUsd: numberMetric(asset.liquidityUsd, 'The Meme service did not supply liquidity.'),
      chainIdentityVerified: unavailableMetric('The legacy service response has no independent chain-identity receipt.', evidence),
      contractVerified: unavailableMetric('The legacy service response has no independent account-verification receipt.', evidence),
    },
    holderDistribution: {
      holderCount: numberMetric(distribution.totalHolders, 'The Meme service did not supply holder count.'),
      top10SharePct: percentMetric(distribution.top10HolderPct, 'The Meme service did not supply Top 10 concentration.'),
      top100SharePct: percentMetric(distribution.top100HolderPct, 'The Meme service did not supply Top 100 concentration.'),
      freshWalletRatePct: percentMetric(distribution.freshWalletRatePct, 'The Meme service did not supply fresh-wallet rate.'),
      botDegenRatePct: percentMetric(distribution.botDegenRatePct, 'The Meme service did not supply bot/degen rate.'),
      entrapmentTraderRatePct: percentMetric(distribution.topEntrapmentTraderPct, 'The Meme service did not supply entrapment-trader rate.'),
      excludedAddressCount: numberMetric(distribution.excludedAddressCount, 'The Meme service did not supply excluded-address count.'),
      excludedByType: Array.isArray(distribution.excludedByType)
        ? distribution.excludedByType.filter(isRecord).flatMap((item) => {
            const type = stringValue(item.type, 80);
            const count = finiteNumber(item.count);
            return type && count !== null && count >= 0
              ? [{ type, count: Math.trunc(count), evidenceRefs: evidence }]
              : [];
          }).slice(0, 30)
        : [],
      holderUniverse: createUnattestedCoinHolderUniverse(UNATTESTED_UNIVERSE_REASON),
    },
    top100Cohorts: topCohorts,
    eoaAnalysis: {
      label: eoa.walletLabel === 'INDEPENDENT_WALLET' || parsedChain === 'solana' ? 'INDEPENDENT_WALLET' : 'EOA',
      holderCount: numberMetric(eoa.topHolderCount, 'The Meme service did not supply EOA-only holder count.'),
      holdingSharePct: percentMetric(eoa.topHolderHoldingPct, 'The Meme service did not supply EOA-only holding share.'),
      cohorts: eoaCohorts,
    },
    keyWallets,
    keyWalletsReason: keyWallets.length > 0 ? null : 'The Meme service returned no key-wallet matches.',
    concepts,
    tokenConceptFits: fits,
    conceptsReason: concepts.length > 0 ? null : 'The Meme service returned no current concept evidence.',
    risks: concepts.flatMap((concept) => concept.risks.map((text) => ({ code: 'CONCEPT_RISK', severity: 'warning' as const, text, evidenceRefs: evidence }))).slice(0, 100),
    deterministicScore: unavailableMetric('The legacy Meme service response did not supply a deterministic score.', evidence),
    confidence: dataConfidence !== null && dataConfidence >= 0 && dataConfidence <= 1
      ? metric(dataConfidence, evidence)
      : unavailableMetric('The Meme service did not supply confidence.', evidence),
    unavailable: (Array.isArray(payload.missingData) ? payload.missingData : [])
      .map((field) => stringValue(field, 200))
      .filter((field): field is string => Boolean(field))
      .map((field) => ({ field, reason: 'The Meme service marked this field unavailable.', source: 'meme-service' as const })),
    warnings: [],
    receipts: [serviceReceipt],
  };
  enforceServiceHolderUniverse(result);
  result.unavailable = completeUnavailableFields(result, result.unavailable);
  return coinMemeAnalysisResultSchema.parse(result) as CoinMemeAnalysisResult;
};
