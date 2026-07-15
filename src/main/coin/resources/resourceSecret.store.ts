import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { CoinResourceChain } from '@shared/coin/coinResource.type';

export interface AlchemySecretEndpoint {
  httpUrl: string;
  wssUrl: string;
}

export interface CoinResourceSecretPayload {
  version: 1;
  alchemy: Partial<Record<CoinResourceChain, AlchemySecretEndpoint>>;
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class CoinResourceSecretStoreError extends Error {
  constructor(readonly code: 'corrupt' | 'secure-storage-unavailable' | 'write-failed') {
    super(code);
    this.name = 'CoinResourceSecretStoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, allowed: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

export const parseCoinResourceSecretPayload = (value: unknown): CoinResourceSecretPayload => {
  if (!isRecord(value) || !exactKeys(value, ['version', 'alchemy']) || value.version !== 1) {
    throw new CoinResourceSecretStoreError('corrupt');
  }
  if (!isRecord(value.alchemy)) throw new CoinResourceSecretStoreError('corrupt');
  const alchemy: Partial<Record<CoinResourceChain, AlchemySecretEndpoint>> = {};
  for (const [chain, endpoint] of Object.entries(value.alchemy)) {
    if (!['robinhood', 'bsc', 'solana'].includes(chain) || !isRecord(endpoint)) {
      throw new CoinResourceSecretStoreError('corrupt');
    }
    if (
      !exactKeys(endpoint, ['httpUrl', 'wssUrl']) ||
      typeof endpoint.httpUrl !== 'string' ||
      typeof endpoint.wssUrl !== 'string'
    ) {
      throw new CoinResourceSecretStoreError('corrupt');
    }
    alchemy[chain as CoinResourceChain] = {
      httpUrl: endpoint.httpUrl,
      wssUrl: endpoint.wssUrl,
    };
  }
  return { version: 1, alchemy };
};

const ensurePrivateDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
};

export class CoinResourceSecretStore {
  constructor(
    private readonly userDataRoot: () => string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  get filePath(): string {
    return join(this.userDataRoot(), 'coin', 'resources.enc');
  }

  isEncryptionAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  read(): CoinResourceSecretPayload {
    this.assertEncryptionAvailable();
    if (!existsSync(this.filePath)) return { version: 1, alchemy: {} };
    try {
      const plaintext = this.safeStorage.decryptString(readFileSync(this.filePath));
      return parseCoinResourceSecretPayload(JSON.parse(plaintext) as unknown);
    } catch (error) {
      if (error instanceof CoinResourceSecretStoreError) throw error;
      throw new CoinResourceSecretStoreError('corrupt');
    }
  }

  write(payload: CoinResourceSecretPayload): void {
    this.assertEncryptionAvailable();
    const parsed = parseCoinResourceSecretPayload(payload);
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    ensurePrivateDirectory(directory);
    try {
      const ciphertext = this.safeStorage.encryptString(JSON.stringify(parsed));
      writeFileSync(temporaryPath, ciphertext, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.filePath);
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
    } catch {
      rmSync(temporaryPath, { force: true });
      throw new CoinResourceSecretStoreError('write-failed');
    }
  }

  private assertEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new CoinResourceSecretStoreError('secure-storage-unavailable');
    }
  }
}
