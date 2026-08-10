import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COIN_ADDRESS_INPUT_MAX_LENGTH,
  coinCandidateChains,
  extractCoinAddressCandidates,
  extractSingleCoinAddress,
  gmgnTokenInfoIdentityOutcome,
  gmgnTokenInfoProvesAddress,
} from '../../../src/shared/coin/coinAddress';
import type { CoinChain } from '../../../src/shared/coin/coinAnalysis.type';
import {
  CoinDataService,
  type CoinDataServiceDependencies,
} from '../../../src/main/coin/data/coinData.service';
import {
  GmgnReadError,
  type GmgnCliService,
  type GmgnReadInput,
  type GmgnReadResult,
} from '../../../src/main/coin/resources/gmgnCli.service';
import { parseMemeAutoAnalyzeInput } from '../../../src/main/coin/data/coinData.validation';

const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER_EVM_ADDRESS = '0x2222222222222222222222222222222222222222';
const SOLANA_ADDRESS = 'So11111111111111111111111111111111111111112';

interface GmgnFixture {
  service: CoinDataService;
  calls: GmgnReadInput[];
}

const createService = (
  tokenInfo: Partial<Record<CoinChain, unknown>>,
  options: {
    installed?: boolean;
    read?: (input: GmgnReadInput, signal?: AbortSignal) => Promise<GmgnReadResult>;
  } = {},
): GmgnFixture => {
  const calls: GmgnReadInput[] = [];
  let clock = 1_000;
  const read = options.read ?? (async (input: GmgnReadInput): Promise<GmgnReadResult> => ({
    operation: input.operation,
    observedAt: clock++,
    data: input.operation === 'token-info'
      ? tokenInfo[input.chain] ?? { message: 'not found' }
      : { data: {} },
  }));
  const gmgn = {
    readCooldownUntil: 0,
    detect: async () => ({
      installed: options.installed ?? true,
      version: '1.5.2',
      displayPath: '/fixture/gmgn-cli',
      apiKeyConfigured: true,
      privateKeyDetected: false,
      checkedAt: clock++,
      lastProbe: null,
    }),
    read: async (input: GmgnReadInput, signal?: AbortSignal) => {
      calls.push(input);
      return await read(input, signal);
    },
  } as unknown as GmgnCliService;
  const dependencies: CoinDataServiceDependencies = {
    http: { requestJson: async () => { throw new Error('HTTP source must not be called.'); } } as unknown as CoinDataServiceDependencies['http'],
    services: {
      getStatuses: () => [],
      resolve: () => { throw new Error('Service source must not be called.'); },
    } as unknown as CoinDataServiceDependencies['services'],
    gmgn,
    createWebSocket: () => ({
      addEventListener: () => undefined,
      close: () => undefined,
    }),
    now: () => clock++,
  };
  return { service: new CoinDataService(dependencies), calls };
};

const autoInput = (contractAddress: string) => ({
  requestId: `auto-${contractAddress.slice(-8)}`,
  contractAddress,
  holderLimit: 100,
  traderLimit: 100,
});

test('extracts exactly one bounded CA and chooses candidate chains without user selection', () => {
  assert.deepEqual(extractCoinAddressCandidates(`token: \`${EVM_ADDRESS}\``), [EVM_ADDRESS]);
  assert.equal(extractSingleCoinAddress(`${EVM_ADDRESS}, ${OTHER_EVM_ADDRESS}`), null);
  assert.equal(extractSingleCoinAddress('no address'), null);
  assert.deepEqual(coinCandidateChains(EVM_ADDRESS), ['bsc', 'robinhood']);
  assert.deepEqual(coinCandidateChains(SOLANA_ADDRESS), ['solana']);
  assert.deepEqual(extractCoinAddressCandidates(`prefix_${EVM_ADDRESS}_suffix`), []);
  assert.deepEqual(extractCoinAddressCandidates(
    `${'x'.repeat(COIN_ADDRESS_INPUT_MAX_LENGTH)} ${EVM_ADDRESS}`,
  ), []);
  assert.equal(
    parseMemeAutoAnalyzeInput(autoInput(`token: ${EVM_ADDRESS}`)).contractAddress,
    EVM_ADDRESS,
  );
  assert.throws(() => parseMemeAutoAnalyzeInput(
    autoInput(`${EVM_ADDRESS}, ${OTHER_EVM_ADDRESS}`),
  ));
});

test('requires a strict top-level GMGN token-info address proof', () => {
  assert.equal(gmgnTokenInfoProvesAddress({ address: EVM_ADDRESS.toUpperCase() }, 'bsc', EVM_ADDRESS), true);
  assert.equal(gmgnTokenInfoProvesAddress({ data: { address: EVM_ADDRESS } }, 'bsc', EVM_ADDRESS), false);
  assert.equal(gmgnTokenInfoProvesAddress({ address: OTHER_EVM_ADDRESS }, 'bsc', EVM_ADDRESS), false);
  assert.equal(gmgnTokenInfoProvesAddress({ address: SOLANA_ADDRESS.toLowerCase() }, 'solana', SOLANA_ADDRESS), false);
  assert.equal(gmgnTokenInfoIdentityOutcome({ message: 'token not found' }, 'bsc', EVM_ADDRESS), 'provider-error');
  assert.equal(gmgnTokenInfoIdentityOutcome({ error: 'upstream unavailable' }, 'bsc', EVM_ADDRESS), 'provider-error');
  assert.equal(gmgnTokenInfoIdentityOutcome({ data: { address: EVM_ADDRESS } }, 'bsc', EVM_ADDRESS), 'provider-error');
});

test('probes both EVM chains before analysis and resolves BSC without a service fallback', async () => {
  const fixture = createService({
    bsc: { address: EVM_ADDRESS, data: { name: 'BSC fixture', symbol: 'BSC' } },
    robinhood: { address: OTHER_EVM_ADDRESS },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

  assert.equal(envelope.status, 'ready');
  assert.deepEqual(envelope.data?.probedChains, ['bsc', 'robinhood']);
  assert.deepEqual(envelope.data?.matches.map(({ chain }) => chain), ['bsc']);
  assert.equal(envelope.data?.activeChain, 'bsc');
  assert.equal(envelope.data?.matches[0].analysis.asset.chainIdentityVerified.value, true);
  assert.deepEqual(fixture.calls.slice(0, 2).map(({ operation, chain }) => [operation, chain]), [
    ['token-info', 'bsc'],
    ['token-info', 'robinhood'],
  ]);
  assert.equal(fixture.calls.filter(({ operation, chain }) => operation === 'token-info' && chain === 'bsc').length, 1);
  assert.equal(fixture.calls.slice(2).every(({ chain }) => chain === 'bsc'), true);
});

test('resolves Robinhood only after both EVM identity probes complete', async () => {
  const fixture = createService({
    bsc: { address: OTHER_EVM_ADDRESS },
    robinhood: { address: EVM_ADDRESS, data: { name: 'Robinhood fixture', symbol: 'RHC' } },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

  assert.deepEqual(envelope.data?.matches.map(({ chain }) => chain), ['robinhood']);
  assert.equal(envelope.data?.activeChain, 'robinhood');
  assert.deepEqual(fixture.calls.slice(0, 2).map(({ chain }) => chain), ['bsc', 'robinhood']);
  assert.equal(fixture.calls.slice(2).every(({ chain }) => chain === 'robinhood'), true);
});

test('records a genuine dual EVM match in stable BSC then Robinhood order', async () => {
  const fixture = createService({
    bsc: { address: EVM_ADDRESS },
    robinhood: { address: EVM_ADDRESS },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

  assert.deepEqual(envelope.data?.matches.map(({ chain }) => chain), ['bsc', 'robinhood']);
  assert.equal(envelope.data?.activeChain, 'bsc');
  assert.equal(envelope.data?.matches.every(({ analysis }) =>
    analysis.asset.chainIdentityVerified.value === true), true);
});

test('a Solana-shaped address probes only Solana', async () => {
  const fixture = createService({
    solana: { address: SOLANA_ADDRESS },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(SOLANA_ADDRESS));

  assert.deepEqual(envelope.data?.probedChains, ['solana']);
  assert.deepEqual(envelope.data?.matches.map(({ chain }) => chain), ['solana']);
  assert.equal(fixture.calls.every(({ chain }) => chain === 'solana'), true);
});

test('a successful zero-match probe does not fabricate an analysis', async () => {
  const fixture = createService({
    bsc: { address: OTHER_EVM_ADDRESS },
    robinhood: { address: OTHER_EVM_ADDRESS },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

  assert.equal(envelope.status, 'ready');
  assert.deepEqual(envelope.data?.matches, []);
  assert.equal(envelope.data?.activeChain, null);
  assert.equal(fixture.calls.length, 2);
});

test('successful error-shaped or unsupported token-info JSON fails closed', async () => {
  for (const payload of [
    { error: 'upstream unavailable' },
    { data: { address: EVM_ADDRESS } },
  ]) {
    const fixture = createService({
      bsc: payload,
      robinhood: { address: OTHER_EVM_ADDRESS },
    });
    const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

    assert.equal(envelope.status, 'error');
    assert.equal(envelope.data, null);
    assert.equal(envelope.error?.code, 'invalid-response');
    assert.equal(fixture.calls.length, 2);
  }
});

test('provider failure is an error, never a not-found result or service fallback', async () => {
  const fixture = createService({}, {
    read: async (input) => {
      if (input.chain === 'robinhood') throw new GmgnReadError('process-failed');
      return { operation: input.operation, observedAt: 1_000, data: { address: EVM_ADDRESS } };
    },
  });
  const envelope = await fixture.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));

  assert.equal(envelope.status, 'error');
  assert.equal(envelope.data, null);
  assert.equal(envelope.error?.code, 'process-failed');
  assert.equal(fixture.calls.length, 2);
});

test('source-unavailable and cancellation remain distinct outcomes', async () => {
  const unavailable = createService({}, { installed: false });
  const unavailableEnvelope = await unavailable.service.autoAnalyzeMeme(autoInput(EVM_ADDRESS));
  assert.equal(unavailableEnvelope.status, 'unavailable');
  assert.equal(unavailableEnvelope.error?.code, 'source-unavailable');
  assert.equal(unavailable.calls.length, 0);

  const cancelled = createService({}, {
    read: async (input, signal) => await new Promise<GmgnReadResult>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new GmgnReadError('cancelled')), { once: true });
    }),
  });
  const pending = cancelled.service.autoAnalyzeMeme({
    ...autoInput(EVM_ADDRESS),
    requestId: 'auto-cancelled',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelled.service.cancel({ requestId: 'auto-cancelled' }).cancelled, true);
  const cancelledEnvelope = await pending;
  assert.equal(cancelledEnvelope.status, 'cancelled');
  assert.equal(cancelledEnvelope.error?.code, 'cancelled');
});
