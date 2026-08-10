import { TRENCH_CHAINS, type TrenchChain } from './trench.type';
import type {
  TrenchAnalysisGetParams,
  TrenchIndexWalletGetParams,
  TrenchListParams,
  TrenchNegativeWalletGetParams,
} from './trenchXpc.type';

export class TrenchXpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrenchXpcValidationError';
  }
}

const expectObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrenchXpcValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const expectOnlyKeys = (value: Record<string, unknown>, allowed: string[]): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new TrenchXpcValidationError(`Unknown parameter: ${unexpected}.`);
};

const expectString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TrenchXpcValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
};

const expectChain = (value: unknown): TrenchChain => {
  if (!TRENCH_CHAINS.includes(value as TrenchChain)) {
    throw new TrenchXpcValidationError('chain must be bsc, solana, or robinhood.');
  }
  return value as TrenchChain;
};

export const parseTrenchListParams = (value: unknown): TrenchListParams => {
  if (value === undefined) return {};
  const params = expectObject(value, 'params');
  expectOnlyKeys(params, ['query', 'cursor', 'limit']);
  const result: TrenchListParams = {};
  if (params.query !== undefined) {
    if (typeof params.query !== 'string') {
      throw new TrenchXpcValidationError('query must be a string.');
    }
    result.query = params.query;
  }
  if (params.cursor !== undefined) result.cursor = expectString(params.cursor, 'cursor');
  if (params.limit !== undefined) {
    if (!Number.isInteger(params.limit) || Number(params.limit) < 1 || Number(params.limit) > 100) {
      throw new TrenchXpcValidationError('limit must be an integer from 1 to 100.');
    }
    result.limit = Number(params.limit);
  }
  return result;
};

export const parseTrenchAnalysisGetParams = (value: unknown): TrenchAnalysisGetParams => {
  const params = expectObject(value, 'params');
  expectOnlyKeys(params, ['contractAddress']);
  return { contractAddress: expectString(params.contractAddress, 'contractAddress') };
};

export const parseTrenchIndexWalletGetParams = (
  value: unknown,
): TrenchIndexWalletGetParams => {
  const params = expectObject(value, 'params');
  expectOnlyKeys(params, ['chain', 'address', 'cursor', 'limit']);
  return {
    chain: expectChain(params.chain),
    address: expectString(params.address, 'address'),
    ...parseTrenchListParams({ cursor: params.cursor, limit: params.limit }),
  };
};

export const parseTrenchNegativeWalletGetParams = (
  value: unknown,
): TrenchNegativeWalletGetParams => {
  const params = expectObject(value, 'params');
  expectOnlyKeys(params, ['chain', 'address']);
  return {
    chain: expectChain(params.chain),
    address: expectString(params.address, 'address'),
  };
};
