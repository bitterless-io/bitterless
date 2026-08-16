import type {
  SnipingBridgeError,
  SnipingBridgeResult,
} from '@shared/sniping/snipingBridge.type';
import type { ActiveSnipingSession, SnipingSessionService } from './snipingSession.service';
import { isForbiddenSnipingCredentialTokenKey } from './snipingRequest.validation';
import { SnipingResponseError } from './snipingResponse.validation';

const DEFAULT_PROD_CORE_URL = 'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run';
const DEFAULT_DEV_CORE_URL = 'https://bl-test-api.terncloud.com';
const TOKEN_HEADER = '-x-bl-token';
const REQUEST_TIMEOUT_MS = 20_000;
const RESPONSE_LIMIT_BYTES = 1_048_576;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const ERROR_KEYWORD = /^[a-z][a-z0-9_-]{0,63}$/;
const ERROR_PATH = /^(?:\/(?:[A-Za-z0-9_$.-]|~[01]){1,64}){1,8}$/;
const errorPathTokens = (path: string): string[] => path
  .normalize('NFKC')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9]+/g, '_')
  .toLowerCase()
  .split('_')
  .filter(Boolean);
const forbiddenErrorPath = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean).map((segment) => errorPathTokens(segment));
  const standalone = ['authorization', 'credential', 'secret', 'password', 'header'];
  const pairs = [
    ['api', 'key'], ['private', 'key'], ['session', 'id'], ['rpc', 'url'], ['rpc', 'uri'],
    ['endpoint', 'url'], ['endpoint', 'uri'],
  ];
  return segments.some((tokens) => {
    const compact = tokens.join('');
    return isForbiddenSnipingCredentialTokenKey(tokens.join('_')) ||
      ['url', 'uri'].includes(compact) ||
      standalone.some((token) => compact.includes(token)) ||
      pairs.some((pair) => compact.includes(pair.join('')));
  });
};

export const SNIPING_CORE_ROUTES = {
  listComponents: { method: 'GET', path: '/sniping/components' },
  listConfigs: { method: 'POST', path: '/sniping/config/list' },
  getConfig: { method: 'POST', path: '/sniping/config/detail' },
  validateConfig: { method: 'POST', path: '/sniping/config/validate' },
  saveConfig: { method: 'POST', path: '/sniping/config/save' },
  setDesiredState: { method: 'POST', path: '/sniping/config/set-desired-state' },
  listRuntimes: { method: 'POST', path: '/sniping/runtime/list' },
  listSimulationEvents: { method: 'POST', path: '/sniping/simulation/event/list' },
  requestExactSimulation: { method: 'POST', path: '/sniping/simulation/request' },
  listExactSimulations: { method: 'POST', path: '/sniping/simulation/list' },
  requestShadowSimulation: { method: 'POST', path: '/sniping/shadow/request' },
  listShadowSimulations: { method: 'POST', path: '/sniping/shadow/list' },
  listActivity: { method: 'POST', path: '/sniping/activity/list' },
} as const;

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(reason?: unknown): Promise<void>;
    };
  } | null;
}

export type SnipingFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<FetchResponse>;

export interface SnipingRelayClientOptions {
  session: SnipingSessionService;
  fetchImpl: SnipingFetch;
  baseUrl?: string;
  timeoutMs?: number;
  onCurrentUnauthorized?: (sessionId: string) => void;
}

const resolveBaseUrl = (): string => {
  const configured = import.meta.env.VITE_BITTERLESS_CORE_URL;
  const fallback = import.meta.env.VITE_ENV === 'prod' ? DEFAULT_PROD_CORE_URL : DEFAULT_DEV_CORE_URL;
  return configured || fallback;
};

const canonicalBaseUrl = (raw: string): string => {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) throw new Error('[sniping relay] Core URL is invalid');
  return url.origin;
};

const issue = (value: unknown): { path: string; keyword: string } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => key !== 'path' && key !== 'keyword') ||
    typeof row.path !== 'string' || row.path.length < 1 || row.path.length > 256 ||
    !ERROR_PATH.test(row.path) ||
    forbiddenErrorPath(row.path) ||
    /[\u0000-\u001f\u007f]/.test(row.path) ||
    typeof row.keyword !== 'string' || !ERROR_KEYWORD.test(row.keyword)
  ) return null;
  return { path: row.path, keyword: row.keyword };
};

const serverError = (status: number, value: unknown): SnipingBridgeError => {
  const fallback: SnipingBridgeError = {
    code: 'SNIPING_REQUEST_FAILED',
    message: 'The Sniping request could not be completed.',
    status,
    retryable: status >= 500 || status === 429,
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  if (
    typeof row.code !== 'string' || !ERROR_CODE.test(row.code) ||
    typeof row.message !== 'string' || row.message.length < 1 || row.message.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(row.message)
  ) return fallback;
  let issues: Array<{ path: string; keyword: string }> | undefined;
  if (row.issues !== undefined) {
    if (!Array.isArray(row.issues) || row.issues.length > 64) return fallback;
    const parsed = row.issues.map(issue);
    if (parsed.some((item) => item === null)) return fallback;
    issues = parsed as Array<{ path: string; keyword: string }>;
  }
  return {
    code: row.code,
    message: 'The Sniping request could not be completed.',
    status,
    retryable: status >= 500 || status === 429,
    ...(issues ? { issues } : {}),
  };
};

const closedError = (
  code: string,
  message: string,
  status: number | null,
  retryable: boolean,
): SnipingBridgeError => ({ code, message, status, retryable });

const readBoundedResponse = async (response: FetchResponse): Promise<string> => {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > RESPONSE_LIMIT_BYTES) {
      throw new SnipingResponseError();
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) throw new SnipingResponseError();
      byteLength += chunk.byteLength;
      if (byteLength > RESPONSE_LIMIT_BYTES) throw new SnipingResponseError();
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error instanceof SnipingResponseError ? error : new SnipingResponseError();
  }
};

export class SnipingRelayClient {
  private readonly session: SnipingSessionService;
  private readonly fetchImpl: SnipingFetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onCurrentUnauthorized: (sessionId: string) => void;

  constructor(options: SnipingRelayClientOptions) {
    this.session = options.session;
    this.fetchImpl = options.fetchImpl;
    this.baseUrl = canonicalBaseUrl(options.baseUrl ?? resolveBaseUrl());
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.onCurrentUnauthorized = options.onCurrentUnauthorized ?? (() => undefined);
  }

  request = async <T>(options: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    parse: (value: unknown) => T;
  }): Promise<SnipingBridgeResult<T>> => {
    let active: ActiveSnipingSession;
    try {
      active = this.session.capture();
    } catch {
      return { ok: false, error: closedError('SNIPING_SESSION_REQUIRED', 'Sign in to use Sniping.', null, false) };
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort(active.signal.reason);
    if (active.signal.aborted) abort();
    else active.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('SNIPING_REQUEST_TIMEOUT')), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers: {
          'content-type': 'application/json',
          [TOKEN_HEADER]: active.token,
        },
        ...(options.method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!this.session.isCurrent(active)) {
        return { ok: false, error: closedError('SNIPING_SESSION_REPLACED', 'The signed-in session changed.', null, true) };
      }
      if (response.status === 401) {
        const cleared = this.session.clearIfCurrent(active);
        if (cleared) this.onCurrentUnauthorized(active.sessionId);
        void response.body?.getReader().cancel(new Error('SNIPING_SESSION_EXPIRED')).catch(() => undefined);
        return cleared
          ? {
            ok: false,
            error: closedError('SNIPING_SESSION_EXPIRED', 'The signed-in session expired.', 401, false),
          }
          : {
            ok: false,
            error: closedError('SNIPING_SESSION_REPLACED', 'The signed-in session changed.', null, true),
          };
      }
      const responseText = await readBoundedResponse(response);
      if (!this.session.isCurrent(active)) {
        return { ok: false, error: closedError('SNIPING_SESSION_REPLACED', 'The signed-in session changed.', null, true) };
      }
      let payload: unknown = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new SnipingResponseError();
      }
      if (!response.ok) {
        return { ok: false, error: serverError(response.status, payload) };
      }
      const parsed = options.parse(payload);
      if (!this.session.isCurrent(active)) {
        return { ok: false, error: closedError('SNIPING_SESSION_REPLACED', 'The signed-in session changed.', null, true) };
      }
      return { ok: true, value: parsed };
    } catch (error) {
      if (error instanceof SnipingResponseError) {
        return {
          ok: false,
          error: closedError('SNIPING_RESPONSE_INVALID', 'Sniping returned an invalid response.', null, false),
        };
      }
      if (!this.session.isCurrent(active)) {
        return { ok: false, error: closedError('SNIPING_SESSION_REPLACED', 'The signed-in session changed.', null, true) };
      }
      if (controller.signal.aborted) {
        return { ok: false, error: closedError('SNIPING_REQUEST_ABORTED', 'The Sniping request was cancelled.', null, true) };
      }
      return {
        ok: false,
        error: closedError('SNIPING_CORE_UNAVAILABLE', 'Sniping is temporarily unavailable.', null, true),
      };
    } finally {
      clearTimeout(timer);
      active.signal.removeEventListener('abort', abort);
    }
  };
}
