import { createHash } from 'node:crypto';
import {
  canonicalizeTrenchAddress,
  assertTrenchChain,
  assertTrenchRequestId,
} from './trench.validation';
import type {
  TrenchIndexAddTargetInput,
  TrenchIndexReanalyzeInput,
  TrenchIndexTargetInput,
  TrenchIndexWorkspaceSnapshot,
} from './trenchIndex.type';
import { TRENCH_INDEX_MAX_TARGETS, TRENCH_INDEX_MAX_WALLETS } from './trenchIndex.type';
import type { TrenchChain } from './trench.type';

export class TrenchIndexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrenchIndexValidationError';
  }
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrenchIndexValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new TrenchIndexValidationError(`${label} contains unknown field: ${unexpected}.`);
};

const exactRequiredKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void => {
  exactKeys(value, required, label);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TrenchIndexValidationError(`${label} is missing required field: ${missing}.`);
};

const requestId = (value: unknown): string => {
  try {
    return assertTrenchRequestId(value, 'requestId');
  } catch (error) {
    throw new TrenchIndexValidationError(error instanceof Error ? error.message : 'requestId is invalid.');
  }
};

export const parseTrenchIndexAddTargetInput = (
  value: unknown,
): TrenchIndexAddTargetInput => {
  const input = record(value, 'input');
  exactKeys(input, ['requestId', 'targets'], 'input');
  if (!Array.isArray(input.targets) || input.targets.length < 1 ||
    input.targets.length > TRENCH_INDEX_MAX_TARGETS) {
    throw new TrenchIndexValidationError(`targets must contain 1..${TRENCH_INDEX_MAX_TARGETS} entries.`);
  }
  const targets = input.targets.map((value, index): TrenchIndexTargetInput => {
    const target = record(value, `targets[${index}]`);
    exactKeys(target, ['contractAddress', 'chain'], `targets[${index}]`);
    if (typeof target.contractAddress !== 'string' || !target.contractAddress.trim()) {
      throw new TrenchIndexValidationError(`targets[${index}].contractAddress is required.`);
    }
    const contractAddress = target.contractAddress.trim();
    if (contractAddress.length > 2_048) {
      throw new TrenchIndexValidationError(`targets[${index}].contractAddress is too long.`);
    }
    let chain: 'auto' | TrenchChain = 'auto';
    if (target.chain !== undefined && target.chain !== 'auto') {
      try {
        chain = assertTrenchChain(target.chain);
      } catch (error) {
        throw new TrenchIndexValidationError(
          error instanceof Error ? error.message : `targets[${index}].chain is invalid.`,
        );
      }
    }
    return { contractAddress, chain };
  });
  return { requestId: requestId(input.requestId), targets };
};

export const parseTrenchIndexReanalyzeInput = (
  value: unknown,
): TrenchIndexReanalyzeInput => {
  const input = record(value, 'input');
  exactKeys(input, ['requestId'], 'input');
  return { requestId: requestId(input.requestId) };
};

export const canonicalizeIndexAddress = (
  value: unknown,
  chain: TrenchChain,
  label: string,
): string => {
  try {
    return canonicalizeTrenchAddress(value, chain, label);
  } catch (error) {
    throw new TrenchIndexValidationError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
};

export const trenchIndexRequestFingerprint = (
  trigger: 'add-target' | 'reanalyze',
  values: readonly string[],
): string => createHash('sha256')
  .update(JSON.stringify([trigger, ...values]))
  .digest('hex');

export const parseTrenchIndexWorkspaceSnapshot = (
  value: unknown,
): TrenchIndexWorkspaceSnapshot => {
  const workspace = record(value, 'workspace');
  exactRequiredKeys(workspace, [
    'schema',
    'revision',
    'jobState',
    'activeRun',
    'currentRun',
    'lastFailedRun',
    'chainProjections',
  ], 'workspace');
  if (workspace.schema !== 'bl-trench-index-workspace-v2') {
    throw new TrenchIndexValidationError('workspace schema must be bl-trench-index-workspace-v2.');
  }
  if (!Array.isArray(workspace.chainProjections)) {
    throw new TrenchIndexValidationError('workspace.chainProjections must be an array.');
  }
  const expected: readonly TrenchChain[] = ['solana', 'bsc', 'robinhood'];
  const chains = workspace.chainProjections.map((value, index) => {
    const projection = record(value, `workspace.chainProjections[${index}]`);
    exactRequiredKeys(
      projection,
      ['chain', 'targets', 'wallets'],
      `workspace.chainProjections[${index}]`,
    );
    let chain: TrenchChain;
    try {
      chain = assertTrenchChain(projection.chain);
    } catch (error) {
      throw new TrenchIndexValidationError(
        error instanceof Error ? error.message : `workspace.chainProjections[${index}].chain is invalid.`,
      );
    }
    if (!Array.isArray(projection.targets) || !Array.isArray(projection.wallets)) {
      throw new TrenchIndexValidationError(
        `workspace.chainProjections[${index}] must contain targets and wallets arrays.`,
      );
    }
    if ([...projection.targets, ...projection.wallets].some((row) =>
      !row || typeof row !== 'object' || (row as { chain?: unknown }).chain !== chain)) {
      throw new TrenchIndexValidationError(
        `workspace.chainProjections[${index}] contains a row from another chain.`,
      );
    }
    if (projection.wallets.length > TRENCH_INDEX_MAX_WALLETS || projection.wallets.some((row, rank) =>
      !Number.isInteger((row as { chainRank?: unknown }).chainRank) ||
      (row as { chainRank?: unknown }).chainRank !== rank + 1)) {
      throw new TrenchIndexValidationError(
        `workspace.chainProjections[${index}] must contain at most ${TRENCH_INDEX_MAX_WALLETS} contiguous chain ranks.`,
      );
    }
    return chain;
  });
  if (chains.length < 2 || chains.length > 3 || chains.some((chain, index) => chain !== expected[index])) {
    throw new TrenchIndexValidationError(
      'workspace.chainProjections must be ordered solana, bsc, then optional robinhood.',
    );
  }
  return value as TrenchIndexWorkspaceSnapshot;
};
