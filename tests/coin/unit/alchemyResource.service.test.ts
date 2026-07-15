import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AlchemyResourceService } from '../../../src/main/coin/resources/alchemyResource.service';
import {
  CoinResourceSecretStore,
  parseCoinResourceSecretPayload,
  type SafeStorageAdapter,
} from '../../../src/main/coin/resources/resourceSecret.store';
import {
  parseAlchemySaveInput,
  parseServiceSaveInput,
} from '../../../src/main/coin/resources/resourceValidation';

const encryptedStorage = (): SafeStorageAdapter => ({
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
  decryptString: (value) => {
    const text = value.toString('utf8');
    if (!text.startsWith('cipher:')) throw new Error('invalid ciphertext');
    return Buffer.from(text.slice('cipher:'.length), 'base64').toString('utf8');
  },
});

const makeFixture = (safeStorage: SafeStorageAdapter = encryptedStorage()) => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-alchemy-test-'));
  const store = new CoinResourceSecretStore(() => root, safeStorage);
  return { root, store };
};

test('encrypts Alchemy endpoints, enforces owner-only mode, and returns masked status', async () => {
  const fixture = makeFixture();
  const secret = 'alchemy-secret-fixture-key';
  try {
    const service = new AlchemyResourceService({
      store: fixture.store,
      allowLoopback: false,
      requestJsonRpc: async () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x38' } }),
      now: () => 1_000,
    });
    const receipt = await service.save({
      chain: 'bsc',
      httpUrl: `https://bnb-mainnet.g.alchemy.com/v2/${secret}`,
      wssUrl: `wss://bnb-mainnet.g.alchemy.com/v2/${secret}`,
    });
    assert.equal(receipt.ok, true);
    const ciphertext = readFileSync(fixture.store.filePath);
    assert.doesNotMatch(ciphertext.toString('utf8'), new RegExp(secret));
    if (process.platform !== 'win32') {
      assert.equal(statSync(dirname(fixture.store.filePath)).mode & 0o777, 0o700);
      assert.equal(statSync(fixture.store.filePath).mode & 0o777, 0o600);
    }
    const status = service.getStatuses().find((item) => item.chain === 'bsc')!;
    assert.equal(status.configured, true);
    assert.equal(status.maskedHttpEndpoint, 'https://bnb-mainnet.g.alchemy.com/***');
    assert.equal(status.maskedWssEndpoint, 'wss://bnb-mainnet.g.alchemy.com/***');
    assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('uses fixed chain-appropriate read-only JSON-RPC probes and redacted receipts', async () => {
  const fixture = makeFixture();
  const requests: Array<{ url: string; body: unknown }> = [];
  try {
    const service = new AlchemyResourceService({
      store: fixture.store,
      allowLoopback: true,
      requestJsonRpc: async ({ url, body }) => {
        requests.push({ url, body });
        const request = body as Record<string, unknown>;
        return request.method === 'getHealth'
          ? { status: 200, body: { jsonrpc: '2.0', id: 1, result: 'ok' } }
          : { status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x38' } };
      },
      now: (() => {
        let now = 2_000;
        return () => ++now;
      })(),
    });
    await service.save({
      chain: 'bsc',
      httpUrl: 'http://127.0.0.1:4010/bsc-secret',
      wssUrl: 'ws://127.0.0.1:4011/bsc-secret',
    });
    await service.save({
      chain: 'solana',
      httpUrl: 'http://127.0.0.1:4020/sol-secret',
      wssUrl: 'ws://127.0.0.1:4021/sol-secret',
    });
    const bsc = await service.test({ chain: 'bsc' });
    const solana = await service.test({ chain: 'solana' });
    assert.equal(bsc.method, 'eth_chainId');
    assert.equal(solana.method, 'getHealth');
    assert.equal(bsc.ok, true);
    assert.equal(solana.ok, true);
    assert.deepEqual(requests.map((request) => request.body), [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] },
    ]);
    assert.doesNotMatch(JSON.stringify([bsc, solana]), /bsc-secret|sol-secret/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('inspects contract and holder identity with a bounded read-only RPC batch', async () => {
  const fixture = makeFixture();
  let requestBody: unknown;
  try {
    const service = new AlchemyResourceService({
      store: fixture.store,
      allowLoopback: true,
      requestJsonRpc: async ({ body }) => {
        requestBody = body;
        return {
          status: 200,
          body: [
            { jsonrpc: '2.0', id: 1, result: '0x38' },
            { jsonrpc: '2.0', id: 2, result: '0x60006000' },
            { jsonrpc: '2.0', id: 10, result: '0x' },
            { jsonrpc: '2.0', id: 11, result: '0x6000' },
          ],
        };
      },
      now: () => 5_000,
    });
    await service.save({
      chain: 'bsc',
      httpUrl: 'http://127.0.0.1:4040/private-path',
      wssUrl: 'ws://127.0.0.1:4041/private-path',
    });
    const wallet = '0x0000000000000000000000000000000000000001';
    const contract = '0x0000000000000000000000000000000000000002';
    const result = await service.inspectAsset(
      'bsc',
      '0x1111111111111111111111111111111111111111',
      [wallet, contract],
    );
    assert.equal(result.chainIdentityVerified, true);
    assert.equal(result.assetAccountVerified, true);
    assert.deepEqual(result.holderKinds, { [wallet]: 'wallet', [contract]: 'contract' });
    const methods = (requestBody as Array<{ method: string }>).map(({ method }) => method);
    assert.deepEqual(methods, ['eth_chainId', 'eth_getCode', 'eth_getCode', 'eth_getCode']);
    assert.equal(methods.some((method) => /send|sign|transaction/i.test(method)), false);
    assert.doesNotMatch(JSON.stringify(result), /private-path/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('deduplicates a row-local test and reports timeout without endpoint data', async () => {
  const fixture = makeFixture();
  let calls = 0;
  try {
    const service = new AlchemyResourceService({
      store: fixture.store,
      allowLoopback: true,
      timeoutMs: 10,
      requestJsonRpc: async () => {
        calls += 1;
        return await new Promise(() => undefined);
      },
    });
    await service.save({
      chain: 'robinhood',
      httpUrl: 'http://127.0.0.1:4030/private-path',
      wssUrl: 'ws://127.0.0.1:4031/private-path',
    });
    const first = service.test({ chain: 'robinhood' });
    const second = service.test({ chain: 'robinhood' });
    assert.equal(first, second);
    const receipt = await first;
    assert.equal(receipt.code, 'timeout');
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /private-path/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('refuses unavailable safeStorage and surfaces corrupt encrypted state', async () => {
  const unavailable = makeFixture({
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('must not encrypt');
    },
    decryptString: () => {
      throw new Error('must not decrypt');
    },
  });
  try {
    const service = new AlchemyResourceService({
      store: unavailable.store,
      allowLoopback: false,
      requestJsonRpc: async () => ({ status: 500, body: null }),
    });
    assert.equal(service.getStatuses().every((item) => item.state === 'secure-storage-unavailable'), true);
    const saved = await service.save({
      chain: 'bsc',
      httpUrl: 'https://example.com/v2/key',
      wssUrl: 'wss://example.com/v2/key',
    });
    assert.equal(saved.ok, false);
    assert.equal(saved.errorCode, 'secure-storage-unavailable');
  } finally {
    rmSync(unavailable.root, { recursive: true, force: true });
  }

  const corrupt = makeFixture();
  try {
    mkdirSync(dirname(corrupt.store.filePath), { recursive: true });
    writeFileSync(corrupt.store.filePath, 'not-safe-storage-ciphertext', 'utf8');
    const service = new AlchemyResourceService({
      store: corrupt.store,
      allowLoopback: false,
      requestJsonRpc: async () => ({ status: 500, body: null }),
    });
    assert.equal(service.getStatuses().every((item) => item.state === 'corrupt'), true);
  } finally {
    rmSync(corrupt.root, { recursive: true, force: true });
  }
});

test('strictly validates storage versions and production/local endpoint schemes', () => {
  assert.throws(() => parseCoinResourceSecretPayload({ version: 2, alchemy: {} }));
  assert.throws(() =>
    parseCoinResourceSecretPayload({
      version: 1,
      alchemy: { bsc: { httpUrl: 'https://example.com' } },
    }),
  );
  assert.throws(() =>
    parseAlchemySaveInput(
      { chain: 'bsc', httpUrl: 'http://example.com', wssUrl: 'wss://example.com' },
      false,
    ),
  );
  assert.throws(() =>
    parseAlchemySaveInput(
      {
        chain: 'bsc',
        httpUrl: 'https://user:pass@example.com/v2/key',
        wssUrl: 'wss://example.com/v2/key',
      },
      false,
    ),
  );
  assert.doesNotThrow(() =>
    parseAlchemySaveInput(
      {
        chain: 'solana',
        httpUrl: 'http://localhost:8899',
        wssUrl: 'ws://localhost:8900',
      },
      true,
    ),
  );
  assert.throws(() =>
    parseServiceSaveInput(
      { service: 'screener', httpUrl: 'https://example.com/api?token=secret' },
      false,
    ),
  );
  assert.throws(() =>
    parseServiceSaveInput(
      { service: 'monitor', httpUrl: 'https://example.com', wsUrl: 'ws://example.com' },
      false,
    ),
  );
});
