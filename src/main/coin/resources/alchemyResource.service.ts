import type {
  CoinAlchemyProbeReceipt,
  CoinAlchemySaveReceipt,
  CoinAlchemyStatus,
  CoinResourceChain,
} from '@shared/coin/coinResource.type';
import { COIN_RESOURCE_CHAINS } from '@shared/coin/coinResource.type';
import {
  CoinResourceSecretStore,
  CoinResourceSecretStoreError,
  type AlchemySecretEndpoint,
} from './resourceSecret.store';
import {
  maskSecretEndpoint,
  parseAlchemySaveInput,
  parseResourceChain,
  validateStoredAlchemyEndpoint,
} from './resourceValidation';

export interface CoinJsonRpcResponse {
  status: number;
  body: unknown;
}

export interface AlchemyResourceServiceDependencies {
  store: CoinResourceSecretStore;
  requestJsonRpc(params: {
    url: string;
    body: unknown;
    signal: AbortSignal;
  }): Promise<CoinJsonRpcResponse>;
  allowLoopback: boolean;
  now?: () => number;
  timeoutMs?: number;
}

export type AlchemyAccountKind = 'wallet' | 'contract' | 'account' | 'unknown';

export interface AlchemyAssetInspection {
  chain: CoinResourceChain;
  observedAt: number;
  chainIdentityVerified: boolean;
  assetAccountVerified: boolean;
  holderKinds: Record<string, AlchemyAccountKind>;
}

export class AlchemyReadError extends Error {
  constructor(readonly code: 'cancelled' | 'invalid-input' | 'invalid-response' | 'not-configured' | 'timeout') {
    super(code);
    this.name = 'AlchemyReadError';
  }
}

const methodForChain = (chain: CoinResourceChain): 'eth_chainId' | 'getHealth' =>
  chain === 'solana' ? 'getHealth' : 'eth_chainId';

const missingStatus = (
  chain: CoinResourceChain,
  state: CoinAlchemyStatus['state'],
  lastProbe: CoinAlchemyProbeReceipt | null,
): CoinAlchemyStatus => ({
  chain,
  state,
  configured: false,
  maskedHttpEndpoint: null,
  maskedWssEndpoint: null,
  lastProbe,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isValidProbeResponse = (
  chain: CoinResourceChain,
  response: CoinJsonRpcResponse,
): boolean => {
  if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) return false;
  if ('error' in response.body) return false;
  const result = response.body.result;
  return chain === 'solana'
    ? result === 'ok'
    : typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result);
};

const expectedEvmChainId: Record<'robinhood' | 'bsc', string> = {
  robinhood: '0x1237',
  bsc: '0x38',
};

const parseRpcResults = (body: unknown): Map<number, unknown> => {
  const rows = Array.isArray(body) ? body : [body];
  const results = new Map<number, unknown>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'number' || 'error' in row) continue;
    results.set(row.id, row.result);
  }
  return results;
};

const isValidAssetAddress = (chain: CoinResourceChain, value: string): boolean =>
  chain === 'solana'
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    : /^0x[0-9a-fA-F]{40}$/.test(value);

export class AlchemyResourceService {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly lastProbe = new Map<CoinResourceChain, CoinAlchemyProbeReceipt>();
  private readonly activeProbes = new Map<CoinResourceChain, Promise<CoinAlchemyProbeReceipt>>();
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: AlchemyResourceServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.timeoutMs = dependencies.timeoutMs ?? 10_000;
  }

  getStatuses(): CoinAlchemyStatus[] {
    if (!this.dependencies.store.isEncryptionAvailable()) {
      return COIN_RESOURCE_CHAINS.map((chain) =>
        missingStatus(chain, 'secure-storage-unavailable', this.lastProbe.get(chain) ?? null),
      );
    }
    try {
      const payload = this.dependencies.store.read();
      return COIN_RESOURCE_CHAINS.map((chain) => {
        const endpoint = payload.alchemy[chain];
        if (!endpoint) return missingStatus(chain, 'missing', this.lastProbe.get(chain) ?? null);
        const validated = validateStoredAlchemyEndpoint(
          endpoint.httpUrl,
          endpoint.wssUrl,
          this.dependencies.allowLoopback,
        );
        return {
          chain,
          state: 'configured',
          configured: true,
          maskedHttpEndpoint: maskSecretEndpoint(validated.httpUrl),
          maskedWssEndpoint: maskSecretEndpoint(validated.wssUrl),
          lastProbe: this.lastProbe.get(chain) ?? null,
        };
      });
    } catch {
      return COIN_RESOURCE_CHAINS.map((chain) =>
        missingStatus(chain, 'corrupt', this.lastProbe.get(chain) ?? null),
      );
    }
  }

  async save(value: unknown): Promise<CoinAlchemySaveReceipt> {
    let input: ReturnType<typeof parseAlchemySaveInput>;
    try {
      input = parseAlchemySaveInput(value, this.dependencies.allowLoopback);
    } catch {
      const chain = this.safeChain(value);
      return {
        ok: false,
        status: this.statusForChain(chain),
        errorCode: 'invalid-input',
      };
    }

    const operation = this.saveQueue.then(async () => {
      const payload = this.dependencies.store.read();
      payload.alchemy[input.chain] = {
        httpUrl: input.httpUrl,
        wssUrl: input.wssUrl,
      };
      this.dependencies.store.write(payload);
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
      return { ok: true, status: this.statusForChain(input.chain) };
    } catch (error) {
      const errorCode =
        error instanceof CoinResourceSecretStoreError &&
        error.code === 'secure-storage-unavailable'
          ? 'secure-storage-unavailable'
          : 'storage-error';
      return { ok: false, status: this.statusForChain(input.chain), errorCode };
    }
  }

  test(value: unknown): Promise<CoinAlchemyProbeReceipt> {
    let chain: CoinResourceChain;
    try {
      chain = parseResourceChain(
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>).chain
          : undefined,
      );
      if (Object.keys(value as Record<string, unknown>).length !== 1) throw new Error('invalid');
    } catch {
      return Promise.resolve(this.probeReceipt('bsc', 'invalid-response', this.now()));
    }
    const active = this.activeProbes.get(chain);
    if (active) return active;
    const probe = this.performProbe(chain);
    const tracked = probe.finally(() => {
      if (this.activeProbes.get(chain) === tracked) this.activeProbes.delete(chain);
    });
    this.activeProbes.set(chain, tracked);
    return tracked;
  }

  async inspectAsset(
    chain: CoinResourceChain,
    contractAddress: string,
    holderAddresses: string[],
    signal?: AbortSignal,
  ): Promise<AlchemyAssetInspection> {
    const address = contractAddress.trim();
    const holders = [...new Set(holderAddresses.map((value) => value.trim()))].slice(0, 100);
    if (
      !isValidAssetAddress(chain, address) ||
      holders.some((holder) => !isValidAssetAddress(chain, holder))
    ) {
      throw new AlchemyReadError('invalid-input');
    }
    let endpoint: AlchemySecretEndpoint | null;
    try {
      endpoint = this.readEndpoint(chain);
    } catch {
      throw new AlchemyReadError('not-configured');
    }
    if (!endpoint) throw new AlchemyReadError('not-configured');

    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = (): void => controller.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const body = chain === 'solana'
        ? this.solanaInspectionRequest(address, holders)
        : this.evmInspectionRequest(chain, address, holders);
      const response = await this.dependencies.requestJsonRpc({
        url: endpoint.httpUrl,
        body,
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new AlchemyReadError('invalid-response');
      }
      return chain === 'solana'
        ? this.parseSolanaInspection(response.body, holders)
        : this.parseEvmInspection(chain, response.body, holders);
    } catch (error) {
      if (error instanceof AlchemyReadError) throw error;
      if (signal?.aborted) throw new AlchemyReadError('cancelled');
      throw new AlchemyReadError(timedOut ? 'timeout' : 'invalid-response');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', relayAbort);
      controller.abort();
    }
  }

  private safeChain(value: unknown): CoinResourceChain {
    try {
      return parseResourceChain(
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>).chain
          : undefined,
      );
    } catch {
      return 'bsc';
    }
  }

  private statusForChain(chain: CoinResourceChain): CoinAlchemyStatus {
    return (
      this.getStatuses().find((status) => status.chain === chain) ??
      missingStatus(chain, 'missing', this.lastProbe.get(chain) ?? null)
    );
  }

  private readEndpoint(chain: CoinResourceChain): AlchemySecretEndpoint | null {
    const endpoint = this.dependencies.store.read().alchemy[chain];
    if (!endpoint) return null;
    return validateStoredAlchemyEndpoint(
      endpoint.httpUrl,
      endpoint.wssUrl,
      this.dependencies.allowLoopback,
    );
  }

  private probeReceipt(
    chain: CoinResourceChain,
    code: CoinAlchemyProbeReceipt['code'],
    startedAt: number,
  ): CoinAlchemyProbeReceipt {
    const receipt: CoinAlchemyProbeReceipt = {
      ok: code === 'verified',
      code,
      chain,
      method: methodForChain(chain),
      startedAt,
      completedAt: this.now(),
    };
    this.lastProbe.set(chain, receipt);
    return receipt;
  }

  private async performProbe(chain: CoinResourceChain): Promise<CoinAlchemyProbeReceipt> {
    const startedAt = this.now();
    let endpoint: AlchemySecretEndpoint | null;
    try {
      endpoint = this.readEndpoint(chain);
    } catch {
      return this.probeReceipt(chain, 'not-configured', startedAt);
    }
    if (!endpoint) return this.probeReceipt(chain, 'not-configured', startedAt);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const method = methodForChain(chain);
    try {
      const response = await Promise.race([
        this.dependencies.requestJsonRpc({
          url: endpoint.httpUrl,
          body: { jsonrpc: '2.0', id: 1, method, params: [] },
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
      ]);
      return this.probeReceipt(
        chain,
        isValidProbeResponse(chain, response) ? 'verified' : 'invalid-response',
        startedAt,
      );
    } catch {
      return this.probeReceipt(chain, timedOut ? 'timeout' : 'network-error', startedAt);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private evmInspectionRequest(
    chain: 'robinhood' | 'bsc',
    contractAddress: string,
    holders: string[],
  ): Array<Record<string, unknown>> {
    return [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getCode', params: [contractAddress, 'latest'] },
      ...holders.map((holder, index) => ({
        jsonrpc: '2.0',
        id: index + 10,
        method: 'eth_getCode',
        params: [holder, 'latest'],
      })),
    ];
  }

  private solanaInspectionRequest(
    contractAddress: string,
    holders: string[],
  ): Array<Record<string, unknown>> {
    return [
      { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'getAccountInfo',
        params: [contractAddress, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }],
      },
      ...(holders.length > 0
        ? [{
            jsonrpc: '2.0',
            id: 3,
            method: 'getMultipleAccounts',
            params: [holders, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }],
          }]
        : []),
    ];
  }

  private parseEvmInspection(
    chain: 'robinhood' | 'bsc',
    body: unknown,
    holders: string[],
  ): AlchemyAssetInspection {
    const results = parseRpcResults(body);
    const chainId = results.get(1);
    const contractCode = results.get(2);
    if (
      typeof chainId !== 'string' ||
      typeof contractCode !== 'string' ||
      !/^0x[0-9a-f]*$/i.test(contractCode)
    ) {
      throw new AlchemyReadError('invalid-response');
    }
    const holderKinds: Record<string, AlchemyAccountKind> = {};
    holders.forEach((holder, index) => {
      const code = results.get(index + 10);
      holderKinds[holder] = typeof code === 'string' && /^0x[0-9a-f]*$/i.test(code)
        ? code === '0x' || code === '0x0'
          ? 'wallet'
          : 'contract'
        : 'unknown';
    });
    return {
      chain,
      observedAt: this.now(),
      chainIdentityVerified: chainId.toLowerCase() === expectedEvmChainId[chain],
      assetAccountVerified: contractCode !== '0x' && contractCode !== '0x0',
      holderKinds,
    };
  }

  private parseSolanaInspection(
    body: unknown,
    holders: string[],
  ): AlchemyAssetInspection {
    const results = parseRpcResults(body);
    const health = results.get(1);
    const assetInfo = results.get(2);
    if (health !== 'ok' || !isRecord(assetInfo) || !('value' in assetInfo)) {
      throw new AlchemyReadError('invalid-response');
    }
    const holderKinds: Record<string, AlchemyAccountKind> = {};
    const multiple = results.get(3);
    const values = isRecord(multiple) && Array.isArray(multiple.value) ? multiple.value : [];
    holders.forEach((holder, index) => {
      const account = values[index];
      if (!isRecord(account) || typeof account.owner !== 'string') {
        holderKinds[holder] = 'unknown';
      } else {
        holderKinds[holder] = account.owner === '11111111111111111111111111111111'
          ? 'wallet'
          : 'account';
      }
    });
    return {
      chain: 'solana',
      observedAt: this.now(),
      chainIdentityVerified: true,
      assetAccountVerified: assetInfo.value !== null,
      holderKinds,
    };
  }
}
