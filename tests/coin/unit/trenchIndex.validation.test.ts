import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTrenchIndexAddTargetInput,
  parseTrenchIndexWorkspaceSnapshot,
  TrenchIndexValidationError,
} from '../../../src/shared/trench/trenchIndex.validation';

test('accepts a bounded exact Add CA batch and rejects malformed batch contracts', () => {
  const parsed = parseTrenchIndexAddTargetInput({
    requestId: '11111111-1111-4111-8111-111111111111',
    targets: [
      { contractAddress: ' 0x1111111111111111111111111111111111111111 ' },
      { contractAddress: '11111111111111111111111111111111', chain: 'solana' },
    ],
  });
  assert.equal(parsed.targets.length, 2);
  assert.equal(parsed.targets[0]?.chain, 'auto');
  assert.throws(
    () => parseTrenchIndexAddTargetInput({
      requestId: '11111111-1111-4111-8111-111111111111',
      targets: [],
    }),
    TrenchIndexValidationError,
  );
  assert.throws(
    () => parseTrenchIndexAddTargetInput({
      requestId: '11111111-1111-4111-8111-111111111111',
      targets: [{ contractAddress: 'x', unexpected: true }],
    }),
    TrenchIndexValidationError,
  );
});

test('accepts ordered workspace v2 projections and rejects v1 or mixed-chain rows', () => {
  const base = {
    schema: 'bl-trench-index-workspace-v2',
    revision: 0,
    jobState: 'idle',
    activeRun: null,
    currentRun: null,
    lastFailedRun: null,
    chainProjections: [
      { chain: 'solana', targets: [], wallets: [] },
      { chain: 'bsc', targets: [], wallets: [] },
    ],
  };
  assert.equal(parseTrenchIndexWorkspaceSnapshot(base).schema, 'bl-trench-index-workspace-v2');
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    targets: [],
    wallets: [],
  }), /workspace contains unknown field: targets/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    wallets: [],
  }), /workspace contains unknown field: wallets/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    chainProjections: [
      { chain: 'solana', targets: [], wallets: [], legacyTargets: [] },
      { chain: 'bsc', targets: [], wallets: [] },
    ],
  }), /workspace\.chainProjections\[0\] contains unknown field: legacyTargets/);
  const { currentRun: _currentRun, ...missingCurrentRun } = base;
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot(missingCurrentRun),
    /workspace is missing required field: currentRun/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({ ...base, schema: 'bl-trench-index-workspace-v1' }),
    /workspace schema/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    chainProjections: [
      { chain: 'bsc', targets: [], wallets: [] },
      { chain: 'solana', targets: [], wallets: [] },
    ],
  }), /must be ordered/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    chainProjections: [
      { chain: 'solana', targets: [{ chain: 'bsc' }], wallets: [] },
      { chain: 'bsc', targets: [], wallets: [] },
    ],
  }), /another chain/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    chainProjections: [
      { chain: 'solana', targets: [], wallets: [] },
      { chain: 'bsc', targets: [], wallets: [
        { chain: 'bsc', chainRank: 1 },
        { chain: 'bsc', chainRank: 1 },
      ] },
    ],
  }), /contiguous chain ranks/);
  assert.throws(() => parseTrenchIndexWorkspaceSnapshot({
    ...base,
    chainProjections: [
      { chain: 'solana', targets: [], wallets: [] },
      { chain: 'bsc', targets: [], wallets: Array.from({ length: 301 }, (_, index) => ({
        chain: 'bsc',
        chainRank: index + 1,
      })) },
    ],
  }), /at most 300/);
});
