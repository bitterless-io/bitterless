import { randomUUID } from 'node:crypto';
import type {
  CoinAttentionConcept,
  CoinChain,
  CoinCohortKey,
  CoinCohortOverlap,
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
import type { AlchemyAssetInspection } from '../resources/alchemyResource.service';
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
const ACCOUNT_CLASSIFICATION_REASON = 'Alchemy account classification is incomplete for the returned holder set.';
const UNSUPPORTED_SCORE_REASON = 'The source did not provide this score; Bitterless does not infer it from rank alone.';

export interface LocalMemeReadSet {
  info?: GmgnReadResult;
  security?: GmgnReadResult;
  holders?: GmgnReadResult;
  traders?: GmgnReadResult;
  trending?: GmgnReadResult;
  hotSearches?: GmgnReadResult;
  alchemy?: AlchemyAssetInspection;
  alchemyReason?: string;
  receipts: CoinSourceReceipt[];
}

interface LocalHolder {
  address: string;
  rank: number;
  sharePct: number | null;
  amount: number | null;
  label: string | null;
  tags: string[];
  walletScore: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
}

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

const alchemyEvidence = (reads: LocalMemeReadSet): string[] =>
  reads.receipts.filter((receipt) => receipt.source.startsWith('alchemy-')).flatMap((receipt) => receipt.evidenceIds);

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
    for (const nestedKey of ['data', 'result', 'token', 'info', 'market', 'stats', 'security']) {
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
  const tags = valueByKeys(value, ['tags', 'labels', 'tag']);
  if (Array.isArray(tags)) {
    return tags.map((tag) => stringValue(tag, 80)).filter((tag): tag is string => Boolean(tag)).slice(0, 12);
  }
  const text = stringValue(tags, 240);
  return text ? text.split(/[,|]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12) : [];
};

const localHolders = (reads: LocalMemeReadSet): LocalHolder[] => {
  const rows = firstArray(reads.holders?.data, ['holders', 'items', 'list', 'rank']);
  const holders: LocalHolder[] = [];
  rows.forEach((value, index) => {
    if (!isRecord(value)) return;
    const address = textByKeys(value, ['address', 'wallet_address', 'owner', 'wallet'], 160);
    if (!address) return;
    const sharePct = numberByKeys(value, [
      'holding_percentage',
      'holding_pct',
      'holdingPercent',
      'percentage',
      'percent',
      'share_pct',
    ]);
    holders.push({
      address,
      rank: Math.max(1, Math.trunc(numberByKeys(value, ['rank', 'holder_rank']) ?? index + 1)),
      sharePct: sharePct !== null && sharePct >= 0 && sharePct <= 100 ? sharePct : null,
      amount: numberByKeys(value, ['amount', 'token_amount', 'balance']),
      label: textByKeys(value, ['label', 'wallet_label', 'name'], 160),
      tags: tagsFrom(value),
      walletScore: numberByKeys(value, ['wallet_score', 'score']),
      realizedPnlUsd: numberByKeys(value, ['realized_pnl_usd', 'realized_profit_usd']),
      unrealizedPnlUsd: numberByKeys(value, ['unrealized_pnl_usd', 'unrealized_profit_usd']),
    });
  });
  return holders.slice(0, 100);
};

export const extractLocalHolderAddresses = (reads: LocalMemeReadSet): string[] =>
  localHolders(reads).map(({ address }) => address);

const holderCountMetric = (reads: LocalMemeReadSet, holders: LocalHolder[]) => {
  const evidence = readEvidence(reads, 'token-holders');
  const count = numberByKeys(reads.holders?.data, ['holder_count', 'holders_count', 'total_holders', 'total']);
  if (count !== null && count >= 0) return metric(Math.trunc(count), evidence);
  if (holders.length > 0 && holders.length < 100) {
    return unavailableMetric<number>('GMGN returned a holder page but did not identify the total holder count.', evidence);
  }
  return unavailableMetric<number>('GMGN did not return a total holder count.', evidence);
};

const concentrationMetric = (
  holders: LocalHolder[],
  requestedDepth: 10 | 100,
  totalHolders: number | null,
  evidence: string[],
): CoinRatioMetric => {
  const required = totalHolders === null ? requestedDepth : Math.min(requestedDepth, totalHolders);
  const selected = holders.slice(0, required);
  if (selected.length < required || selected.some(({ sharePct }) => sharePct === null)) {
    return unavailableRatio(
      `GMGN did not return complete holding-share evidence for the Top ${requestedDepth}.`,
      evidence,
    );
  }
  return ratio(selected.reduce((sum, holder) => sum + (holder.sharePct ?? 0), 0), evidence);
};

const sourceRate = (
  value: unknown,
  keys: string[],
  unavailableReason: string,
  evidence: string[],
): CoinRatioMetric => {
  const rate = numberByKeys(value, keys);
  return rate !== null && rate >= 0 && rate <= 100
    ? ratio(rate, evidence)
    : unavailableRatio(unavailableReason, evidence);
};

const unavailableCohorts = (): CoinCohortOverlap[] =>
  COHORTS.map(({ cohort, label }) => ({
    cohort,
    label,
    matchCount: unavailableMetric<number>(COHORT_REASON),
    holdingSharePct: unavailableRatio(COHORT_REASON),
  }));

const localKeyWallets = (holders: LocalHolder[], evidence: string[]): CoinKeyWallet[] =>
  holders
    .filter((holder) => holder.label || holder.tags.length > 0)
    .map((holder, index) => ({
      rank: index + 1,
      address: holder.address,
      holderRank: holder.rank,
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
  const alchemySource: CoinSourceId = result.asset.chain === 'robinhood'
    ? 'alchemy-robinhood'
    : result.asset.chain === 'bsc'
      ? 'alchemy-bsc'
      : 'alchemy-solana';
  const collected: Array<CoinUnavailableField | null> = [
    unavailableField('asset.name', result.asset.name, defaultSource),
    unavailableField('asset.symbol', result.asset.symbol, defaultSource),
    unavailableField('asset.launchStage', result.asset.launchStage, defaultSource),
    unavailableField('asset.priceUsd', result.asset.priceUsd, defaultSource),
    unavailableField('asset.marketCapUsd', result.asset.marketCapUsd, defaultSource),
    unavailableField('asset.liquidityUsd', result.asset.liquidityUsd, defaultSource),
    unavailableField('asset.chainIdentityVerified', result.asset.chainIdentityVerified, alchemySource),
    unavailableField('asset.contractVerified', result.asset.contractVerified, alchemySource),
    unavailableField('holderDistribution.holderCount', result.holderDistribution.holderCount, defaultSource),
    unavailableField('holderDistribution.top10SharePct', result.holderDistribution.top10SharePct, defaultSource),
    unavailableField('holderDistribution.top100SharePct', result.holderDistribution.top100SharePct, defaultSource),
    unavailableField('holderDistribution.freshWalletRatePct', result.holderDistribution.freshWalletRatePct, defaultSource),
    unavailableField('holderDistribution.botDegenRatePct', result.holderDistribution.botDegenRatePct, defaultSource),
    unavailableField('holderDistribution.entrapmentTraderRatePct', result.holderDistribution.entrapmentTraderRatePct, defaultSource),
    unavailableField('holderDistribution.excludedAddressCount', result.holderDistribution.excludedAddressCount, alchemySource),
    unavailableField('eoaAnalysis.holderCount', result.eoaAnalysis.holderCount, alchemySource),
    unavailableField('eoaAnalysis.holdingSharePct', result.eoaAnalysis.holdingSharePct, alchemySource),
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

const localScore = (
  top10: CoinRatioMetric,
  fresh: CoinRatioMetric,
  bot: CoinRatioMetric,
  risks: CoinRiskEvidence[],
  evidenceRefs: string[],
): CoinNullableMetric<number> => {
  const components: number[] = [];
  if (top10.value !== null) components.push(Math.max(0, 100 - top10.value * 2));
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
  const top10SharePct = concentrationMetric(holders, 10, holderCount.value, holderEvidence);
  const top100SharePct = concentrationMetric(holders, 100, holderCount.value, holderEvidence);
  const freshWalletRatePct = sourceRate(
    reads.holders?.data,
    ['fresh_wallet_rate_pct', 'fresh_wallet_rate', 'fresh_rate'],
    'GMGN did not supply a fresh-wallet rate.',
    holderEvidence,
  );
  const botDegenRatePct = sourceRate(
    reads.holders?.data,
    ['bot_degen_rate_pct', 'bot_degen_rate', 'bot_rate'],
    'GMGN did not supply a bot/degen rate.',
    holderEvidence,
  );
  const traderEvidence = readEvidence(reads, 'token-traders');
  const entrapmentTraderRatePct = sourceRate(
    reads.traders?.data,
    ['top_entrapment_trader_pct', 'entrapment_trader_rate_pct', 'entrapment_rate'],
    'GMGN did not supply an entrapment-trader rate.',
    traderEvidence,
  );

  const nameValue = textByKeys(reads.info?.data, ['name', 'token_name'], 200);
  const symbolValue = textByKeys(reads.info?.data, ['symbol', 'token_symbol', 'ticker'], 80);
  const launchStageValue = normalizeLaunchStage(valueByKeys(reads.info?.data, ['launch_stage', 'stage', 'status']));
  const priceValue = numberByKeys(reads.info?.data, ['price_usd', 'priceUsd', 'price']);
  const marketCapValue = numberByKeys(reads.info?.data, ['market_cap_usd', 'marketCapUsd', 'market_cap']);
  const liquidityValue = numberByKeys(reads.info?.data, ['liquidity_usd', 'liquidityUsd', 'liquidity']);
  const missingFromInfo = (label: string) => `${label} is not present in the GMGN token-info response.`;

  const allClassified = holders.length > 0 && holders.every((holder) => reads.alchemy?.holderKinds[holder.address] && reads.alchemy.holderKinds[holder.address] !== 'unknown');
  const walletHolders = allClassified
    ? holders.filter((holder) => reads.alchemy?.holderKinds[holder.address] === 'wallet')
    : [];
  const walletSharesComplete = allClassified && walletHolders.every(({ sharePct }) => sharePct !== null);
  const accountEvidence = alchemyEvidence(reads);
  const eoaHolderCount = allClassified
    ? metric(walletHolders.length, accountEvidence)
    : unavailableMetric<number>(reads.alchemyReason ?? ACCOUNT_CLASSIFICATION_REASON, accountEvidence);
  const eoaHoldingShare = walletSharesComplete
    ? ratio(walletHolders.reduce((sum, holder) => sum + (holder.sharePct ?? 0), 0), accountEvidence)
    : unavailableRatio(reads.alchemyReason ?? ACCOUNT_CLASSIFICATION_REASON, accountEvidence);
  const excludedCount = allClassified
    ? metric(holders.length - walletHolders.length, accountEvidence)
    : unavailableMetric<number>(reads.alchemyReason ?? ACCOUNT_CLASSIFICATION_REASON, accountEvidence);
  const excludedByType = allClassified
    ? [
        {
          type: input.chain === 'solana' ? 'PROGRAM_OR_ACCOUNT' : 'CONTRACT',
          count: holders.length - walletHolders.length,
          evidenceRefs: accountEvidence,
        },
      ]
    : [];

  const concepts = observedConcepts(reads);
  const fits = tokenConceptFits(concepts, nameValue, symbolValue);
  const keyWallets = localKeyWallets(holders, holderEvidence);
  const risks = localRisks(reads);
  if (reads.alchemy && !reads.alchemy.chainIdentityVerified) {
    risks.push({
      code: 'CHAIN_IDENTITY_MISMATCH',
      severity: 'critical',
      text: 'The configured Alchemy endpoint did not match the selected chain identity.',
      evidenceRefs: accountEvidence,
    });
  }
  if (reads.alchemy && !reads.alchemy.assetAccountVerified) {
    risks.push({
      code: 'ASSET_ACCOUNT_UNVERIFIED',
      severity: 'critical',
      text: 'Alchemy could not verify the supplied contract or token account.',
      evidenceRefs: accountEvidence,
    });
  }

  const scoreEvidence = [...new Set([...holderEvidence, ...traderEvidence, ...risks.flatMap((risk) => risk.evidenceRefs)])];
  const deterministicScore = localScore(top10SharePct, freshWalletRatePct, botDegenRatePct, risks, scoreEvidence);
  const confidenceDimensions = [
    nameValue,
    priceValue,
    holderCount.value,
    top10SharePct.value,
    freshWalletRatePct.value,
    botDegenRatePct.value,
    entrapmentTraderRatePct.value,
    reads.alchemy?.assetAccountVerified ?? null,
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
      chainIdentityVerified: reads.alchemy
        ? metric(reads.alchemy.chainIdentityVerified, accountEvidence)
        : unavailableMetric(reads.alchemyReason ?? 'Alchemy is not configured for this chain.', accountEvidence),
      contractVerified: reads.alchemy
        ? metric(reads.alchemy.assetAccountVerified, accountEvidence)
        : unavailableMetric(reads.alchemyReason ?? 'Alchemy is not configured for this chain.', accountEvidence),
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
      : 'GMGN returned no labelled wallets in the bounded holder page.',
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
      'Local CLI/RPC mode is explicit and does not fall back to a deployed Meme service.',
      COHORT_REASON,
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
    unavailableField('eoaAnalysis.holderCount', eoaHolderCount, input.chain === 'robinhood' ? 'alchemy-robinhood' : input.chain === 'bsc' ? 'alchemy-bsc' : 'alchemy-solana'),
    unavailableField('eoaAnalysis.holdingSharePct', eoaHoldingShare, input.chain === 'robinhood' ? 'alchemy-robinhood' : input.chain === 'bsc' ? 'alchemy-bsc' : 'alchemy-solana'),
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
  result.unavailable = completeUnavailableFields(result, result.unavailable);
  return coinMemeAnalysisResultSchema.parse(result) as CoinMemeAnalysisResult;
};
