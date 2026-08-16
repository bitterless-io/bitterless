import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTrenchIndexAddTargetInput,
  partitionTrenchIndexAddInput,
} from '../../../src/renderer/coin/src/views/index/trenchIndexAddInput';

const bsc = '0x1111111111111111111111111111111111111111';
const solana = 'So11111111111111111111111111111111111111112';

test('selected SOL keeps only Solana rows and reports the exact ignored BSC count', () => {
  assert.deepEqual(partitionTrenchIndexAddInput(`${bsc}\n${solana}\n${bsc}`, 'solana'), {
    enteredCount: 3,
    retained: [solana],
    ignoredCount: 2,
    ignoredChain: 'bsc',
    invalidCount: 0,
  });
});

test('selected BSC keeps only EVM rows and all-wrong input leaves no submission rows', () => {
  assert.deepEqual(partitionTrenchIndexAddInput(`${solana} ${bsc}`, 'bsc'), {
    enteredCount: 2,
    retained: [bsc],
    ignoredCount: 1,
    ignoredChain: 'solana',
    invalidCount: 0,
  });
  const allWrong = partitionTrenchIndexAddInput(solana, 'bsc');
  assert.equal(allWrong.retained.length, 0);
  let boundaryCalls = 0;
  const request = buildTrenchIndexAddTargetInput(
    allWrong,
    'bsc',
    '11111111-1111-4111-8111-111111111111',
  );
  if (request) boundaryCalls += 1;
  assert.equal(request, null);
  assert.equal(boundaryCalls, 0);
});

test('mixed paste submits retained rows with the selected chain and never routes ignored rows', () => {
  const request = buildTrenchIndexAddTargetInput(
    partitionTrenchIndexAddInput(`${solana} ${bsc}`, 'bsc'),
    'bsc',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.deepEqual(request?.targets, [{ contractAddress: bsc, chain: 'bsc' }]);
});
