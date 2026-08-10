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
    return coinAddressesEqual(chain, address.trim(), expectedAddress) ? 'match' : 'no-match';
  }
  return 'provider-error';
};
