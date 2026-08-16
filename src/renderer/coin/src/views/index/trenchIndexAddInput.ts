import { coinCandidateChains } from '@shared/coin/coinAddress';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchIndexAddTargetInput } from '@shared/trench/trenchIndex.type';

export interface TrenchIndexAddInputPartition {
  enteredCount: number;
  retained: string[];
  ignoredCount: number;
  ignoredChain: 'bsc' | 'solana';
  invalidCount: number;
}

export const partitionTrenchIndexAddInput = (
  value: string,
  selectedChain: TrenchChain,
): TrenchIndexAddInputPartition => {
  const addresses = value.split(/[\s,;]+/).map((address) => address.trim()).filter(Boolean);
  const retained: string[] = [];
  let ignoredCount = 0;
  let invalidCount = 0;
  for (const address of addresses) {
    const candidates = coinCandidateChains(address);
    if (candidates.length === 0) {
      invalidCount += 1;
    } else if (candidates.includes(selectedChain)) {
      retained.push(address);
    } else {
      ignoredCount += 1;
    }
  }
  return {
    enteredCount: addresses.length,
    retained,
    ignoredCount,
    ignoredChain: selectedChain === 'solana' ? 'bsc' : 'solana',
    invalidCount,
  };
};

export const buildTrenchIndexAddTargetInput = (
  partition: TrenchIndexAddInputPartition,
  selectedChain: TrenchChain,
  requestId: string,
): TrenchIndexAddTargetInput | null => partition.invalidCount > 0 || partition.retained.length === 0
  ? null
  : {
      requestId,
      targets: partition.retained.map((contractAddress) => ({
        contractAddress,
        chain: selectedChain,
      })),
    };
