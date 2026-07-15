export type CoinHttpErrorCode =
  | 'cancelled'
  | 'http-error'
  | 'invalid-response'
  | 'network-error'
  | 'output-limit'
  | 'timeout';

export class CoinHttpError extends Error {
  constructor(
    readonly code: CoinHttpErrorCode,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = 'CoinHttpError';
  }
}

export interface CoinHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type CoinHttpFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<CoinHttpResponse>;

export interface CoinHttpJsonInput {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;

export const appendCoinServicePath = (baseUrl: string, path: string): string => {
  const url = new URL(baseUrl);
  const baseSegments = url.pathname.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  if (
    baseSegments.length > 0 &&
    pathSegments.length > 0 &&
    baseSegments[baseSegments.length - 1] === pathSegments[0]
  ) {
    pathSegments.shift();
  }
  url.pathname = `/${[...baseSegments, ...pathSegments].join('/')}`;
  url.search = '';
  url.hash = '';
  return url.href;
};

export class CoinHttpClient {
  constructor(private readonly fetch: CoinHttpFetch) {}

  async requestJson(input: CoinHttpJsonInput): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = (): void => controller.abort();
    input.signal?.addEventListener('abort', relayAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let body: string | undefined;
    if (input.method === 'POST') {
      body = JSON.stringify(input.body ?? {});
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', relayAbort);
        throw new CoinHttpError('output-limit');
      }
    }
    try {
      const response = await this.fetch(input.url, {
        method: input.method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > (input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
        throw new CoinHttpError('output-limit', response.status);
      }
      if (!response.ok) throw new CoinHttpError('http-error', response.status);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new CoinHttpError('invalid-response', response.status);
      }
    } catch (error) {
      if (error instanceof CoinHttpError) throw error;
      if (input.signal?.aborted) throw new CoinHttpError('cancelled');
      if (timedOut) throw new CoinHttpError('timeout');
      throw new CoinHttpError('network-error');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', relayAbort);
      controller.abort();
    }
  }
}
