import assert from 'node:assert/strict';
import test from 'node:test';
import { TrenchIndexOrchestrator } from '../../../src/main/coin/index/trenchIndex.orchestrator';
import type { GmgnReadInput } from '../../../src/main/coin/resources/gmgnCli.service';
import type {
  TrenchIndexStorageAddTargetsAndBeginRunInput,
  TrenchIndexWorkspaceSnapshot,
} from '../../../src/shared/trench/trenchIndex.type';

const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';

const workspace: TrenchIndexWorkspaceSnapshot = {
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

const makeHarness = (
  identity: (input: GmgnReadInput) => string,
  currentWorkspace: TrenchIndexWorkspaceSnapshot = workspace,
) => {
  const writes: TrenchIndexStorageAddTargetsAndBeginRunInput[] = [];
  const reads: GmgnReadInput[] = [];
  const storage = {
    getWorkspace: async () => ({ ok: true as const, value: currentWorkspace }),
    addTargetsAndBeginRun: async (input: TrenchIndexStorageAddTargetsAndBeginRunInput) => {
      writes.push(input);
      return {
        ok: true as const,
        value: {
          runId: '99999999-9999-4999-8999-999999999999',
          revision: 1,
          targets: [],
          replayed: true,
          status: 'completed' as const,
        },
      };
    },
    beginRun: async () => { throw new Error('unused'); },
    completeRun: async () => { throw new Error('unused'); },
    failRun: async () => { throw new Error('unused'); },
  };
  const orchestrator = new TrenchIndexOrchestrator({
    storage,
    gmgn: {
      read: async (input) => {
        reads.push(input);
        return {
          operation: input.operation,
          observedAt: 10,
          data: {
            address: identity(input),
            name: 'Token',
            symbol: 'TOK',
            market_cap: 10,
          },
        };
      },
    },
    broadcast: () => undefined,
  });
  return { orchestrator, reads, writes };
};

test('resolves an Add CA batch completely before one atomic storage command', async () => {
  const { orchestrator, writes } = makeHarness((input) => input.chain === 'bsc'
    ? String('address' in input ? input.address : '')
    : '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const result = await orchestrator.addTargets({
    requestId: '11111111-1111-4111-8111-111111111111',
    targets: [{ contractAddress: first }, { contractAddress: second }],
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.targets.length, 2);
  if (result.ok) assert.equal(result.value.targetPersistedCount, 2);
});

test('duplicate resolved identities collapse while unresolved items fail before storage mutation', async () => {
  const duplicate = makeHarness((input) => String('address' in input ? input.address : ''));
  const duplicateResult = await duplicate.orchestrator.addTargets({
    requestId: '22222222-2222-4222-8222-222222222222',
    targets: [{ contractAddress: first, chain: 'bsc' }, { contractAddress: first, chain: 'bsc' }],
  });
  assert.equal(duplicateResult.ok, true);
  assert.equal(duplicate.writes.length, 1);
  assert.equal(duplicate.writes[0]?.targets.length, 1);

  const unresolved = makeHarness(() => '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const unresolvedResult = await unresolved.orchestrator.addTargets({
    requestId: '33333333-3333-4333-8333-333333333333',
    targets: [{ contractAddress: first, chain: 'bsc' }],
  });
  assert.equal(unresolvedResult.ok, false);
  if (!unresolvedResult.ok) assert.equal(unresolvedResult.error.code, 'TOKEN_NOT_FOUND');
  assert.equal(unresolved.writes.length, 0);
});

test('rejects an Add batch before GMGN resolution while a run is active', async () => {
  const harness = makeHarness((input) => String('address' in input ? input.address : ''), {
    ...workspace,
    jobState: 'running',
    activeRun: {
      runId: '88888888-8888-4888-8888-888888888888',
      trigger: 'reanalyze',
      status: 'running',
      startedAt: 10,
      completedAt: null,
      targetCount: 1,
      candidateCount: 0,
      eligibleCount: 0,
      publishedCount: 0,
      errorCode: null,
      errorMessage: null,
    },
  });
  const result = await harness.orchestrator.addTargets({
    requestId: '99999999-9999-4999-8999-999999999999',
    targets: [{ contractAddress: first }, { contractAddress: second }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'ANALYSIS_BUSY');
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.writes.length, 0);
});
