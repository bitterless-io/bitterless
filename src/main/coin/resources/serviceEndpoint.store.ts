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
import type { CoinServiceId } from '@shared/coin/coinResource.type';

export interface StoredServiceEndpoint {
  httpUrl: string;
  wsUrl?: string;
}

export interface ServiceEndpointPayload {
  version: 1;
  endpoints: Partial<Record<CoinServiceId, StoredServiceEndpoint>>;
}

export class ServiceEndpointStoreError extends Error {
  constructor(readonly code: 'corrupt' | 'write-failed') {
    super(code);
    this.name = 'ServiceEndpointStoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

export const parseServiceEndpointPayload = (value: unknown): ServiceEndpointPayload => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== 1 ||
    !isRecord(value.endpoints)
  ) {
    throw new ServiceEndpointStoreError('corrupt');
  }
  const endpoints: Partial<Record<CoinServiceId, StoredServiceEndpoint>> = {};
  for (const [service, endpoint] of Object.entries(value.endpoints)) {
    if (!['monitor', 'screener', 'meme'].includes(service) || !isRecord(endpoint)) {
      throw new ServiceEndpointStoreError('corrupt');
    }
    const allowed = service === 'monitor' ? ['httpUrl', 'wsUrl'] : ['httpUrl'];
    if (!hasOnlyKeys(endpoint, allowed) || Object.keys(endpoint).length !== allowed.length) {
      throw new ServiceEndpointStoreError('corrupt');
    }
    if (
      typeof endpoint.httpUrl !== 'string' ||
      (service === 'monitor' && typeof endpoint.wsUrl !== 'string')
    ) {
      throw new ServiceEndpointStoreError('corrupt');
    }
    endpoints[service as CoinServiceId] = {
      httpUrl: endpoint.httpUrl,
      ...(service === 'monitor' ? { wsUrl: endpoint.wsUrl as string } : {}),
    };
  }
  return { version: 1, endpoints };
};

const ensurePrivateDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
};

export class ServiceEndpointStore {
  constructor(private readonly userDataRoot: () => string) {}

  get filePath(): string {
    return join(this.userDataRoot(), 'coin', 'service-endpoints.json');
  }

  read(): ServiceEndpointPayload {
    if (!existsSync(this.filePath)) return { version: 1, endpoints: {} };
    try {
      return parseServiceEndpointPayload(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      if (error instanceof ServiceEndpointStoreError) throw error;
      throw new ServiceEndpointStoreError('corrupt');
    }
  }

  write(payload: ServiceEndpointPayload): void {
    const parsed = parseServiceEndpointPayload(payload);
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    ensurePrivateDirectory(directory);
    try {
      writeFileSync(temporaryPath, JSON.stringify(parsed, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.filePath);
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
    } catch {
      rmSync(temporaryPath, { force: true });
      throw new ServiceEndpointStoreError('write-failed');
    }
  }
}
