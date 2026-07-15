import { COIN_SERVICE_IDS } from '@shared/coin/coinResource.type';
import type {
  CoinServiceId,
  CoinServiceSaveReceipt,
  CoinServiceStatus,
} from '@shared/coin/coinResource.type';
import {
  ServiceEndpointStore,
  type ServiceEndpointPayload,
  type StoredServiceEndpoint,
} from './serviceEndpoint.store';
import {
  endpointHost,
  parseServiceSaveInput,
  validateStoredServiceEndpoint,
} from './resourceValidation';

const SERVICE_ENV: Record<CoinServiceId, { http: string; ws?: string }> = {
  monitor: {
    http: 'VITE_COIN_MONITOR_API_BASE',
    ws: 'VITE_COIN_MONITOR_WS_BASE',
  },
  screener: { http: 'VITE_COIN_SCREEN_API_BASE' },
  meme: { http: 'VITE_COIN_MEME_API_BASE' },
};

export interface ResolvedCoinServiceEndpoint {
  service: CoinServiceId;
  httpUrl: string;
  wsUrl?: string;
  source: 'override' | 'runtime';
}

export interface ServiceEndpointServiceDependencies {
  store: ServiceEndpointStore;
  runtimeEnv(): NodeJS.ProcessEnv;
  allowLoopback: boolean;
}

const status = (
  service: CoinServiceId,
  state: CoinServiceStatus['state'],
  endpoint: ResolvedCoinServiceEndpoint | null = null,
): CoinServiceStatus => ({
  service,
  state,
  configured: state === 'configured',
  httpHost: endpoint ? endpointHost(endpoint.httpUrl) : null,
  wsHost: endpoint?.wsUrl ? endpointHost(endpoint.wsUrl) : null,
  source: endpoint?.source ?? null,
});

export class ServiceEndpointService {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: ServiceEndpointServiceDependencies) {}

  getStatuses(): CoinServiceStatus[] {
    let payload: ServiceEndpointPayload;
    try {
      payload = this.dependencies.store.read();
    } catch {
      return COIN_SERVICE_IDS.map((service) => status(service, 'invalid'));
    }
    return COIN_SERVICE_IDS.map((service) => {
      const resolved = this.resolveFromPayload(service, payload);
      if (resolved.kind === 'configured') return status(service, 'configured', resolved.endpoint);
      return status(service, resolved.kind);
    });
  }

  resolve(service: CoinServiceId): ResolvedCoinServiceEndpoint | null {
    const payload = this.dependencies.store.read();
    const resolved = this.resolveFromPayload(service, payload);
    return resolved.kind === 'configured' ? resolved.endpoint : null;
  }

  async save(value: unknown): Promise<CoinServiceSaveReceipt> {
    let input: ReturnType<typeof parseServiceSaveInput>;
    try {
      input = parseServiceSaveInput(value, this.dependencies.allowLoopback);
    } catch {
      const service = this.safeService(value);
      return {
        ok: false,
        status: this.statusForService(service),
        errorCode: 'invalid-input',
      };
    }
    const operation = this.saveQueue.then(async () => {
      const payload = this.dependencies.store.read();
      payload.endpoints[input.service] =
        input.service === 'monitor'
          ? { httpUrl: input.httpUrl, wsUrl: input.wsUrl }
          : { httpUrl: input.httpUrl };
      this.dependencies.store.write(payload);
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
      return { ok: true, status: this.statusForService(input.service) };
    } catch {
      return {
        ok: false,
        status: this.statusForService(input.service),
        errorCode: 'storage-error',
      };
    }
  }

  private safeService(value: unknown): CoinServiceId {
    const requested =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).service
        : null;
    return requested === 'monitor' || requested === 'screener' || requested === 'meme'
      ? requested
      : 'monitor';
  }

  private statusForService(service: CoinServiceId): CoinServiceStatus {
    return this.getStatuses().find((item) => item.service === service) ?? status(service, 'missing');
  }

  private runtimeEndpoint(service: CoinServiceId): StoredServiceEndpoint | null | 'invalid' {
    const env = this.dependencies.runtimeEnv();
    const names = SERVICE_ENV[service];
    const httpUrl = env[names.http]?.trim() || '';
    const wsUrl = names.ws ? env[names.ws]?.trim() || '' : '';
    if (!httpUrl && !wsUrl) return null;
    if (!httpUrl || (service === 'monitor' && !wsUrl)) return 'invalid';
    return service === 'monitor' ? { httpUrl, wsUrl } : { httpUrl };
  }

  private resolveFromPayload(
    service: CoinServiceId,
    payload: ServiceEndpointPayload,
  ):
    | { kind: 'configured'; endpoint: ResolvedCoinServiceEndpoint }
    | { kind: 'invalid' | 'missing' } {
    const override = payload.endpoints[service];
    const candidate = override ?? this.runtimeEndpoint(service);
    if (candidate === null) return { kind: 'missing' };
    if (candidate === 'invalid') return { kind: 'invalid' };
    try {
      const validated = validateStoredServiceEndpoint(
        service,
        candidate,
        this.dependencies.allowLoopback,
      );
      return {
        kind: 'configured',
        endpoint: {
          service,
          httpUrl: validated.httpUrl,
          ...(validated.wsUrl ? { wsUrl: validated.wsUrl } : {}),
          source: override ? 'override' : 'runtime',
        },
      };
    } catch {
      return { kind: 'invalid' };
    }
  }
}
