import { randomUUID } from 'node:crypto';
import type {
  CoinFilterClause,
  CoinFilterOperator,
  CoinMonitorResult,
  CoinMonitorRow,
  CoinScreenerMode,
  CoinScreenerParseResult,
  CoinScreenerParsedQuery,
  CoinScreenerResult,
  CoinScreenerRow,
  CoinSourceId,
  CoinSourceReceipt,
} from '@shared/coin/coinAnalysis.type';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const finiteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

export const stringValue = (value: unknown, max = 500): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
    : null;

export const timestampValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const createSourceReceipt = (params: {
  source: CoinSourceId;
  mode: CoinSourceReceipt['mode'];
  status: CoinSourceReceipt['status'];
  observedAt: number | null;
  receivedAt: number;
  reason?: string | null;
  evidenceIds?: string[];
}): CoinSourceReceipt => ({
  id: randomUUID(),
  source: params.source,
  mode: params.mode,
  status: params.status,
  observedAt: params.observedAt,
  receivedAt: params.receivedAt,
  stale: params.status === 'stale',
  reason: params.reason ?? null,
  evidenceIds: [...new Set(params.evidenceIds ?? [])].slice(0, 64),
});

const monitorEvidenceId = (symbol: string, observedAt: number | null): string =>
  `monitor:${symbol}:${observedAt ?? 'unknown'}`;

const normalizeMonitorRow = (
  value: unknown,
  now: number,
): CoinMonitorRow | null => {
  if (!isRecord(value)) return null;
  const symbol = stringValue(value.symbol, 32)?.toUpperCase() ?? null;
  if (!symbol || !/^[A-Z0-9]{2,24}$/.test(symbol)) return null;
  const current = isRecord(value.currentPrice) ? value.currentPrice : {};
  const low = isRecord(value.historicalLow) ? value.historicalLow : {};
  const high = isRecord(value.historicalHigh) ? value.historicalHigh : {};
  const currentPrice = finiteNumber(current.price);
  const historicalLowPrice = finiteNumber(low.price);
  const historicalHighPrice = finiteNumber(high.price);
  const observedAt =
    timestampValue(value.updatedAt) ??
    timestampValue(value.refreshedAt) ??
    timestampValue(current.time);
  const freshnessSeconds = observedAt === null
    ? null
    : Math.max(0, Math.floor((now - observedAt) / 1000));
  const stale = freshnessSeconds !== null && freshnessSeconds > 120;
  const invalid = currentPrice === null || currentPrice < 0;
  const evidenceId = monitorEvidenceId(symbol, observedAt);
  return {
    symbol,
    venue: 'binance-usdm',
    currentPrice: invalid ? null : currentPrice,
    historicalLowPrice:
      historicalLowPrice !== null && historicalLowPrice >= 0 ? historicalLowPrice : null,
    historicalHighPrice:
      historicalHighPrice !== null && historicalHighPrice >= 0 ? historicalHighPrice : null,
    lowMultiple:
      !invalid && historicalLowPrice !== null && historicalLowPrice > 0
        ? Math.round((currentPrice / historicalLowPrice) * 10_000) / 10_000
        : null,
    listedAt: timestampValue(value.onboardDate) ?? timestampValue(value.onboardDateIso),
    listingAgeDays:
      finiteNumber(value.listingAgeDays) !== null && finiteNumber(value.listingAgeDays)! >= 0
        ? finiteNumber(value.listingAgeDays)
        : null,
    observedAt,
    freshnessSeconds,
    state: invalid ? 'error' : stale ? 'stale' : 'ready',
    reason: invalid
      ? 'The configured monitor returned no valid current price for this symbol.'
      : stale
        ? 'The latest monitor observation is older than 120 seconds.'
        : observedAt === null
          ? 'The monitor did not provide an observation timestamp.'
          : null,
    evidenceIds: [evidenceId],
  };
};

const missingMonitorRow = (symbol: string): CoinMonitorRow => ({
  symbol,
  venue: 'binance-usdm',
  currentPrice: null,
  historicalLowPrice: null,
  historicalHighPrice: null,
  lowMultiple: null,
  listedAt: null,
  listingAgeDays: null,
  observedAt: null,
  freshnessSeconds: null,
  state: 'error',
  reason: 'The configured monitor did not return this requested symbol.',
  evidenceIds: [],
});

export const normalizeMonitorPayload = (
  payload: unknown,
  requestedSymbols: string[],
  now: number,
  receipt: CoinSourceReceipt,
  connection: CoinMonitorResult['connection'],
): CoinMonitorResult => {
  if (!isRecord(payload) || !Array.isArray(payload.states) || payload.states.length > 100) {
    throw new Error('invalid-monitor-response');
  }
  const bySymbol = new Map<string, CoinMonitorRow>();
  for (const value of payload.states) {
    const row = normalizeMonitorRow(value, now);
    if (row && requestedSymbols.includes(row.symbol)) bySymbol.set(row.symbol, row);
  }
  const rows = requestedSymbols.map((symbol) => bySymbol.get(symbol) ?? missingMonitorRow(symbol));
  const missingSymbols = rows.filter(({ state, currentPrice }) => state === 'error' && currentPrice === null)
    .map(({ symbol }) => symbol);
  const readAt = timestampValue(payload.readAt) ?? timestampValue(payload.refreshedAt) ?? now;
  return {
    schema: 'coin-monitor-v1',
    requestedSymbols: [...requestedSymbols],
    rows,
    missingSymbols,
    readAt,
    connection,
    receipts: [receipt],
  };
};

export const normalizeMonitorWebSocketPayload = (
  payload: unknown,
  trackedSymbols: string[],
  now: number,
): CoinMonitorRow | null => {
  if (!isRecord(payload) || payload.type !== 'symbolFeatureState.updated') return null;
  const row = normalizeMonitorRow(payload.state, now);
  return row && trackedSymbols.includes(row.symbol) ? row : null;
};

const parseFilterValue = (value: unknown): CoinFilterClause['value'] | null => {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return typeof value === 'string' ? value.slice(0, 200) : value;
  }
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part)))
  ) {
    return [
      typeof value[0] === 'string' ? value[0].slice(0, 200) : value[0],
      typeof value[1] === 'string' ? value[1].slice(0, 200) : value[1],
    ];
  }
  return null;
};

const normalizeFilters = (value: unknown): CoinFilterClause[] => {
  if (!Array.isArray(value)) return [];
  const filters: CoinFilterClause[] = [];
  for (const item of value.slice(0, 64)) {
    if (!isRecord(item)) continue;
    const field = stringValue(item.field, 80);
    const op = item.op as CoinFilterOperator;
    const parsedValue = parseFilterValue(item.value);
    if (!field || !['gte', 'lte', 'eq', 'between'].includes(op) || parsedValue === null) continue;
    filters.push({ field, op, value: parsedValue });
  }
  return filters;
};

const stringArray = (value: unknown, maxItems: number, maxLength = 500): string[] =>
  Array.isArray(value)
    ? value.map((item) => stringValue(item, maxLength)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
    : [];

export const normalizeScreenerParsePayload = (
  payload: unknown,
  query: string,
  receipt: CoinSourceReceipt,
): CoinScreenerParseResult => {
  if (!isRecord(payload)) throw new Error('invalid-screener-parse-response');
  const source = isRecord(payload.parsed) ? payload.parsed : payload;
  const mode: CoinScreenerMode = source.mode === 'live_public' ? 'live_public' : 'sample';
  const parser = source.parser === 'llm' || source.parser === 'external'
    ? source.parser
    : 'deterministic';
  const parsed: CoinScreenerParsedQuery = {
    query: stringValue(source.query, 2_000) ?? query,
    mode,
    exchange: stringValue(source.exchange, 80) ?? 'unknown',
    market: stringValue(source.market, 80) ?? 'unknown',
    quoteAsset: stringValue(source.quoteAsset, 32) ?? 'USDT',
    contractType: stringValue(source.contractType, 32) ?? 'PERPETUAL',
    filters: normalizeFilters(source.filters ?? payload.filters),
    symbols: stringArray(source.symbols, 100, 32),
    limit: Math.max(1, Math.min(100, Math.trunc(finiteNumber(source.limit) ?? 20))),
    warnings: stringArray(source.warnings, 100),
    parser,
  };
  return { schema: 'coin-screener-parse-v1', parsed, receipt };
};

const normalizeScreenerRow = (value: unknown, rank: number): CoinScreenerRow | null => {
  if (!isRecord(value)) return null;
  const symbol = stringValue(value.symbol, 40)?.toUpperCase() ?? null;
  if (!symbol) return null;
  return {
    rank,
    symbol,
    score: finiteNumber(value.score),
    state: stringValue(value.state, 80),
    currentPrice: finiteNumber(value.currentPrice ?? value.markPrice),
    historicalLowPrice: finiteNumber(value.historicalLowPrice ?? value.robustLow),
    priceMultiple: finiteNumber(value.priceMultiple ?? value.multipleFromRobustLow),
    listingAgeDays: finiteNumber(value.listingAgeDays),
    fundingRatePct: finiteNumber(value.binanceFundingRatePct ?? value.fundingRatePct),
    fundingRateSpreadPct: finiteNumber(value.fundingRateSpreadAbsPct ?? value.fundingRateSpreadPct),
    warning: stringValue(value.warning, 500),
    evidenceIds: [`screener:${symbol}:${rank}`],
  };
};

const rejectedCount = (value: unknown): number => {
  const direct = finiteNumber(value);
  if (direct !== null) return Math.max(0, Math.trunc(direct));
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>((total, item) => {
    const count = finiteNumber(item);
    return total + (count === null ? 0 : Math.max(0, Math.trunc(count)));
  }, 0);
};

export const normalizeScreenerPayload = (
  payload: unknown,
  requestedMode: CoinScreenerMode,
  receipt: CoinSourceReceipt,
  now: number,
): CoinScreenerResult => {
  if (!isRecord(payload) || !Array.isArray(payload.results) || payload.results.length > 500) {
    throw new Error('invalid-screener-response');
  }
  const mode = payload.mode === 'sample' ? 'sample' : payload.mode === 'live_public' ? 'live_public' : null;
  if (mode !== requestedMode) throw new Error('screener-mode-mismatch');
  const rows = payload.results
    .map((item, index) => normalizeScreenerRow(item, index + 1))
    .filter((item): item is CoinScreenerRow => Boolean(item))
    .slice(0, 100);
  const scanned = Math.max(0, Math.trunc(finiteNumber(payload.scanned) ?? rows.length));
  return {
    schema: 'coin-screener-v1',
    mode,
    generatedAt: timestampValue(payload.generatedAt) ?? now,
    scanned,
    matched: Math.max(0, Math.trunc(finiteNumber(payload.matched) ?? rows.length)),
    rejected: rejectedCount(payload.rejected),
    filters: normalizeFilters(payload.filters),
    rows,
    warnings: stringArray(payload.warnings, 100),
    receipts: [receipt],
  };
};
