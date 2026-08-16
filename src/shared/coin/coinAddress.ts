import type { CoinChain } from './coinAnalysis.type';

export const COIN_EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const COIN_SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const COIN_ADDRESS_INPUT_MAX_LENGTH = 2_048;

const EMBEDDED_ADDRESS_PATTERN =
  /(^|[^0-9A-Za-z_])(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?=$|[^0-9A-Za-z_])/g;

export const extractCoinAddressCandidates = (value: string): string[] => {
  if (value.length > COIN_ADDRESS_INPUT_MAX_LENGTH) return [];
  const candidates: string[] = [];
  for (const match of value.matchAll(EMBEDDED_ADDRESS_PATTERN)) {
    if (match[2]) candidates.push(match[2]);
  }
  return candidates;
};

export const extractSingleCoinAddress = (value: string): string | null => {
  const candidates = extractCoinAddressCandidates(value);
  return candidates.length === 1 ? candidates[0] : null;
};

export const coinCandidateChains = (address: string): CoinChain[] => {
  if (COIN_SOLANA_ADDRESS_PATTERN.test(address)) return ['solana'];
  if (COIN_EVM_ADDRESS_PATTERN.test(address)) return ['bsc', 'robinhood'];
  return [];
};

export const coinAddressesEqual = (
  chain: CoinChain,
  left: string,
  right: string,
): boolean => chain === 'solana'
  ? left === right
  : left.toLowerCase() === right.toLowerCase();

export const gmgnTokenInfoProvesAddress = (
  payload: unknown,
  chain: CoinChain,
  expectedAddress: string,
): boolean => gmgnTokenInfoIdentityOutcome(payload, chain, expectedAddress) === 'match';

export type GmgnTokenInfoIdentityOutcome = 'match' | 'no-match' | 'provider-error';

const nonEmptyTokenText = (record: Record<string, unknown>): boolean =>
  ['name', 'symbol', 'token_name', 'token_symbol'].some((key) =>
    typeof record[key] === 'string' && record[key].trim().length > 0,
  );

const positiveTokenNumber = (record: Record<string, unknown>): boolean =>
  ['circulating_supply', 'circulatingSupply', 'total_supply', 'totalSupply'].some((key) => {
    const value = record[key];
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
  });

const nonEmptyPoolEvidence = (record: Record<string, unknown>): boolean =>
  ['pool', 'pool_address', 'poolAddress', 'pair_address', 'pairAddress'].some((key) => {
    const value = record[key];
    if (typeof value === 'string') {
      const text = value.trim();
      return text.length > 0 && (!Number.isFinite(Number(text)) || Number(text) > 0);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const pool = value as Record<string, unknown>;
    const hasIdentity = ['address', 'pool_address', 'poolAddress', 'pair_address', 'pairAddress']
      .some((identityKey) => {
        const identity = pool[identityKey];
        if (typeof identity !== 'string') return false;
        const text = identity.trim();
        return text.length > 0 && (!Number.isFinite(Number(text)) || Number(text) > 0);
      });
    const hasLiquidity = ['liquidity', 'base_reserve', 'baseReserve', 'quote_reserve', 'quoteReserve']
      .some((liquidityKey) => {
        const liquidity = pool[liquidityKey];
        if (typeof liquidity !== 'number' && typeof liquidity !== 'string') return false;
        const number = Number(liquidity);
        return Number.isFinite(number) && number > 0;
      });
    return hasIdentity || hasLiquidity;
  });

const emptyTokenInfoSentinel = (record: Record<string, unknown>): boolean => {
  const identityKeys = ['name', 'symbol', 'token_name', 'token_symbol'];
  const supplyKeys = ['circulating_supply', 'circulatingSupply', 'total_supply', 'totalSupply'];
  const existenceKeys = [
    ...identityKeys,
    ...supplyKeys,
    'pool', 'pool_address', 'poolAddress', 'pair_address', 'pairAddress', 'price',
  ];
  if (!identityKeys.some((key) => Object.hasOwn(record, key)) ||
    !supplyKeys.some((key) => Object.hasOwn(record, key))) return false;
  return existenceKeys.every((key) => {
    if (!Object.hasOwn(record, key)) return true;
    const value = record[key];
    if (value === null || value === '') return true;
    if (typeof value === 'number' || typeof value === 'string') {
      const number = Number(value);
      return Number.isFinite(number) && number === 0;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.values(value as Record<string, unknown>);
    return entries.length === 0 || entries.every((nested) => {
      if (nested === null || nested === '') return true;
      const number = typeof nested === 'number' || typeof nested === 'string'
        ? Number(nested)
        : Number.NaN;
      return Number.isFinite(number) && number === 0;
    });
  });
};

export const gmgnTokenInfoIdentityOutcome = (
  payload: unknown,
  chain: CoinChain,
  expectedAddress: string,
): GmgnTokenInfoIdentityOutcome => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'provider-error';
  const record = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'address')) {
    const address = record.address;
    if (typeof address !== 'string' || !address.trim()) return 'provider-error';
    if (!coinAddressesEqual(chain, address.trim(), expectedAddress)) return 'no-match';
    if (nonEmptyTokenText(record) || positiveTokenNumber(record) || nonEmptyPoolEvidence(record)) {
      return 'match';
    }
    return emptyTokenInfoSentinel(record) ? 'no-match' : 'provider-error';
  }
  return 'provider-error';
};
