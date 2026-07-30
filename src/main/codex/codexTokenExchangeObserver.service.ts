import { channel, type Channel } from 'node:diagnostics_channel';

const TOKEN_ORIGIN = 'https://auth.openai.com';
const TOKEN_PATH = '/oauth/token';

type DiagnosticMessage = Record<string, unknown>;
type DiagnosticListener = (message: unknown) => void;

export interface CodexTokenExchangeObserverCallbacks {
  onRequest(): void;
  onResponse(statusCode: number): void;
  onError(error: unknown): void;
}

export interface CodexTokenExchangeChannels {
  requestCreate: Channel;
  requestHeaders: Channel;
  requestError: Channel;
}

const defaultChannels = (): CodexTokenExchangeChannels => ({
  requestCreate: channel('undici:request:create'),
  requestHeaders: channel('undici:request:headers'),
  requestError: channel('undici:request:error')
});

const eventRequest = (message: unknown): Record<string, unknown> | null => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const request = (message as DiagnosticMessage).request;
  return request && typeof request === 'object' && !Array.isArray(request)
    ? (request as Record<string, unknown>)
    : null;
};

const isCodexTokenRequest = (request: Record<string, unknown>): boolean => {
  if (request.method !== 'POST' || typeof request.path !== 'string') return false;
  if (typeof request.origin !== 'string' && !(request.origin instanceof URL)) return false;

  try {
    const origin = new URL(String(request.origin));
    if (
      origin.origin !== TOKEN_ORIGIN ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      return false;
    }
    const target = new URL(request.path, origin);
    return target.origin === TOKEN_ORIGIN && target.pathname === TOKEN_PATH;
  } catch {
    return false;
  }
};

const responseStatus = (message: unknown): number | null => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const response = (message as DiagnosticMessage).response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const statusCode = (response as Record<string, unknown>).statusCode;
  return Number.isInteger(statusCode) && Number(statusCode) >= 100 && Number(statusCode) <= 599
    ? Number(statusCode)
    : null;
};

export class CodexTokenExchangeObserver {
  private subscribed = false;
  private tokenRequests = new WeakSet<object>();
  private readonly channels: CodexTokenExchangeChannels;

  constructor(
    private readonly callbacks: CodexTokenExchangeObserverCallbacks,
    channels: CodexTokenExchangeChannels = defaultChannels()
  ) {
    this.channels = channels;
  }

  private readonly onRequestCreate: DiagnosticListener = (message) => {
    try {
      const request = eventRequest(message);
      if (!request || !isCodexTokenRequest(request) || this.tokenRequests.has(request)) return;
      this.tokenRequests.add(request);
      this.safeNotify(() => this.callbacks.onRequest());
    } catch {
      // Observability must not affect Undici.
    }
  };

  private readonly onRequestHeaders: DiagnosticListener = (message) => {
    try {
      const request = eventRequest(message);
      if (!request || !this.tokenRequests.has(request)) return;
      const statusCode = responseStatus(message);
      if (statusCode !== null) {
        this.safeNotify(() => this.callbacks.onResponse(statusCode));
      }
      this.tokenRequests.delete(request);
    } catch {
      // Observability must not affect Undici.
    }
  };

  private readonly onRequestError: DiagnosticListener = (message) => {
    try {
      const request = eventRequest(message);
      if (!request || !this.tokenRequests.has(request)) return;
      const error =
        message && typeof message === 'object' ? (message as DiagnosticMessage).error : undefined;
      this.safeNotify(() => this.callbacks.onError(error));
      this.tokenRequests.delete(request);
    } catch {
      // Observability must not affect Undici.
    }
  };

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.channels.requestCreate.subscribe(this.onRequestCreate);
    this.channels.requestHeaders.subscribe(this.onRequestHeaders);
    this.channels.requestError.subscribe(this.onRequestError);
  }

  stop(): void {
    if (!this.subscribed) return;
    this.subscribed = false;
    this.channels.requestCreate.unsubscribe(this.onRequestCreate);
    this.channels.requestHeaders.unsubscribe(this.onRequestHeaders);
    this.channels.requestError.unsubscribe(this.onRequestError);
    this.tokenRequests = new WeakSet<object>();
  }

  private safeNotify(notify: () => void): void {
    try {
      notify();
    } catch {
      // Diagnostics must never alter the OAuth request lifecycle.
    }
  }
}
