import {
  COIN_RESOURCE_CHAINS,
  COIN_SERVICE_IDS,
  type CoinAlchemySaveInput,
  type CoinGmgnOfficialLinkTarget,
  type CoinResourceChain,
  type CoinServiceId,
  type CoinServiceSaveInput,
} from '@shared/coin/coinResource.type';

export interface ValidatedAlchemyInput extends CoinAlchemySaveInput {}

export type ValidatedServiceInput = CoinServiceSaveInput;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (record: Record<string, unknown>, keys: string[]): void => {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Unexpected resource input fields.');
  }
};

export const parseResourceChain = (value: unknown): CoinResourceChain => {
  if (typeof value === 'string' && COIN_RESOURCE_CHAINS.includes(value as CoinResourceChain)) {
    return value as CoinResourceChain;
  }
  throw new Error('Unsupported Coin resource chain.');
};

export const parseServiceId = (value: unknown): CoinServiceId => {
  if (typeof value === 'string' && COIN_SERVICE_IDS.includes(value as CoinServiceId)) {
    return value as CoinServiceId;
  }
  throw new Error('Unsupported Coin service.');
};

const isLoopbackHost = (hostname: string): boolean =>
  ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname.toLowerCase());

const parseEndpoint = (
  value: unknown,
  options: { kind: 'http' | 'ws'; allowLoopback: boolean; secret: boolean },
): URL => {
  if (typeof value !== 'string') throw new Error('Endpoint must be a string.');
  const input = value.trim();
  if (!input || input.length > 4096 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Endpoint is invalid.');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Endpoint is invalid.');
  }
  const secureProtocol = options.kind === 'http' ? 'https:' : 'wss:';
  const loopbackProtocol = options.kind === 'http' ? 'http:' : 'ws:';
  const secure = url.protocol === secureProtocol;
  const allowedLoopback =
    options.allowLoopback && url.protocol === loopbackProtocol && isLoopbackHost(url.hostname);
  if (!secure && !allowedLoopback) throw new Error('Endpoint must use a secure scheme.');
  if (!url.hostname || url.username || url.password || url.hash || url.search) {
    throw new Error('Endpoint cannot contain user info, a query, or a fragment.');
  }
  if (!options.secret && url.pathname !== '/' && url.pathname.endsWith('/../')) {
    throw new Error('Service endpoint path is invalid.');
  }
  return url;
};

export const parseAlchemySaveInput = (
  value: unknown,
  allowLoopback: boolean,
): ValidatedAlchemyInput => {
  if (!isRecord(value)) throw new Error('Alchemy input is invalid.');
  assertExactKeys(value, ['chain', 'httpUrl', 'wssUrl']);
  const chain = parseResourceChain(value.chain);
  const httpUrl = parseEndpoint(value.httpUrl, {
    kind: 'http',
    allowLoopback,
    secret: true,
  }).href;
  const wssUrl = parseEndpoint(value.wssUrl, {
    kind: 'ws',
    allowLoopback,
    secret: true,
  }).href;
  return { chain, httpUrl, wssUrl };
};

export const parseServiceSaveInput = (
  value: unknown,
  allowLoopback: boolean,
): ValidatedServiceInput => {
  if (!isRecord(value)) throw new Error('Service input is invalid.');
  const service = parseServiceId(value.service);
  if (service === 'monitor') {
    assertExactKeys(value, ['service', 'httpUrl', 'wsUrl']);
    return {
      service,
      httpUrl: parseEndpoint(value.httpUrl, {
        kind: 'http',
        allowLoopback,
        secret: false,
      }).href,
      wsUrl: parseEndpoint(value.wsUrl, {
        kind: 'ws',
        allowLoopback,
        secret: false,
      }).href,
    };
  }
  assertExactKeys(value, ['service', 'httpUrl']);
  return {
    service,
    httpUrl: parseEndpoint(value.httpUrl, {
      kind: 'http',
      allowLoopback,
      secret: false,
    }).href,
  };
};

export const validateStoredAlchemyEndpoint = (
  httpUrl: string,
  wssUrl: string,
  allowLoopback: boolean,
): { httpUrl: string; wssUrl: string } => ({
  httpUrl: parseEndpoint(httpUrl, { kind: 'http', allowLoopback, secret: true }).href,
  wssUrl: parseEndpoint(wssUrl, { kind: 'ws', allowLoopback, secret: true }).href,
});

export const validateStoredServiceEndpoint = (
  service: CoinServiceId,
  value: { httpUrl: string; wsUrl?: string },
  allowLoopback: boolean,
): { httpUrl: string; wsUrl?: string } => {
  const httpUrl = parseEndpoint(value.httpUrl, {
    kind: 'http',
    allowLoopback,
    secret: false,
  }).href;
  if (service !== 'monitor') return { httpUrl };
  if (!value.wsUrl) throw new Error('Monitor WebSocket endpoint is required.');
  return {
    httpUrl,
    wsUrl: parseEndpoint(value.wsUrl, {
      kind: 'ws',
      allowLoopback,
      secret: false,
    }).href,
  };
};

export const maskSecretEndpoint = (value: string): string => {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/***`;
};

export const endpointHost = (value: string): string => new URL(value).host;

export const parseGmgnOfficialLinkTarget = (value: unknown): CoinGmgnOfficialLinkTarget => {
  if (value === 'repository' || value === 'cliDocs' || value === 'apiKey') return value;
  throw new Error('Unsupported GMGN link target.');
};
