import { randomBytes } from 'node:crypto';
import { channel, type Channel } from 'node:diagnostics_channel';
import {
  request as createHttpRequest,
  type ClientRequest,
  type IncomingMessage
} from 'node:http';

const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_PATH = '/auth/callback';
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const PROBE_PATH_PREFIX = '/__bitterless_codex_probe__/';

type DiagnosticMessage = Record<string, unknown>;
type DiagnosticListener = (message: unknown) => void;

export type CodexLoopbackFamily = 'ipv4' | 'ipv6';
export type CodexLoopbackProbeRoute = 'localhost' | 'ipv4' | 'ipv6';
export type CodexLoopbackProbeFailureReason =
  | 'cancelled'
  | 'foreign-listener'
  | 'listener-unreachable'
  | 'probe-failed'
  | 'probe-timeout'
  | 'unexpected-response';

export interface CodexLoopbackCallbackDiagnostic {
  family: CodexLoopbackFamily;
  method: string;
  path: typeof CODEX_CALLBACK_PATH;
  hasCode: boolean;
  hasState: boolean;
}

export interface CodexLoopbackCallbackResponseDiagnostic
  extends CodexLoopbackCallbackDiagnostic {
  statusCode: number;
}

export interface CodexLoopbackProbeEvidence {
  route: CodexLoopbackProbeRoute;
  family: CodexLoopbackFamily;
  statusCode: 404;
}

export interface CodexLoopbackObserverCallbacks {
  onCallbackRequest(diagnostic: CodexLoopbackCallbackDiagnostic): void;
  onCallbackResponse(diagnostic: CodexLoopbackCallbackResponseDiagnostic): void;
}

export interface CodexLoopbackOwnershipObserver {
  start(): void;
  verifyOwnership(options: {
    includeIpv6: boolean;
    signal: AbortSignal;
    timeoutMs?: number;
  }): Promise<CodexLoopbackProbeEvidence[]>;
  stop(): void;
}

export interface CodexLoopbackChannels {
  serverRequestStart: Channel;
  serverResponseFinish: Channel;
}

interface ActiveProbe {
  route: CodexLoopbackProbeRoute;
  expectedFamily: CodexLoopbackFamily | null;
  observedFamily: CodexLoopbackFamily | null;
}

interface ProbeTarget {
  route: CodexLoopbackProbeRoute;
  hostname: string;
  family?: 4 | 6;
  expectedFamily: CodexLoopbackFamily | null;
}

const defaultChannels = (): CodexLoopbackChannels => ({
  serverRequestStart: channel('http.server.request.start'),
  serverResponseFinish: channel('http.server.response.finish')
});

const messageRecord = (message: unknown): DiagnosticMessage | null =>
  message && typeof message === 'object' && !Array.isArray(message)
    ? (message as DiagnosticMessage)
    : null;

const objectField = (message: DiagnosticMessage, field: string): Record<string, unknown> | null => {
  const value = message[field];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const loopbackFamily = (address: unknown): CodexLoopbackFamily | null => {
  if (address === '127.0.0.1' || address === '::ffff:127.0.0.1') return 'ipv4';
  if (address === '::1') return 'ipv6';
  return null;
};

const requestPath = (request: Record<string, unknown>): URL | null => {
  if (typeof request.url !== 'string') return null;
  try {
    return new URL(request.url, 'http://localhost');
  } catch {
    return null;
  }
};

const requestMethod = (request: Record<string, unknown>): string => {
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
  return /^[A-Z]{1,16}$/.test(method) ? method : 'OTHER';
};

const responseStatus = (response: Record<string, unknown> | null): number | null => {
  const statusCode = response?.statusCode;
  return Number.isInteger(statusCode) && Number(statusCode) >= 100 && Number(statusCode) <= 599
    ? Number(statusCode)
    : null;
};

const networkErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
};

const probeTargets = (includeIpv6: boolean): ProbeTarget[] => [
  {
    route: 'localhost',
    hostname: 'localhost',
    expectedFamily: null
  },
  {
    route: 'ipv4',
    hostname: '127.0.0.1',
    family: 4,
    expectedFamily: 'ipv4'
  },
  ...(includeIpv6
    ? [
        {
          route: 'ipv6' as const,
          hostname: '::1',
          family: 6 as const,
          expectedFamily: 'ipv6' as const
        }
      ]
    : [])
];

export class CodexLoopbackProbeError extends Error {
  constructor(
    readonly reason: CodexLoopbackProbeFailureReason,
    readonly route: CodexLoopbackProbeRoute
  ) {
    super(`Codex ${route} callback listener verification failed (${reason}).`);
    this.name = 'CodexLoopbackProbeError';
  }
}

export class CodexLoopbackObserver implements CodexLoopbackOwnershipObserver {
  private subscribed = false;
  private callbackRequests = new WeakMap<object, CodexLoopbackCallbackDiagnostic>();
  private readonly activeProbes = new Map<string, ActiveProbe>();
  private readonly activeVerifications = new Set<AbortController>();
  private readonly channels: CodexLoopbackChannels;

  constructor(
    private readonly callbacks: CodexLoopbackObserverCallbacks,
    channels: CodexLoopbackChannels = defaultChannels()
  ) {
    this.channels = channels;
  }

  private readonly onServerRequestStart: DiagnosticListener = (message) => {
    try {
      const event = messageRecord(message);
      if (!event) return;
      const request = objectField(event, 'request');
      const socket = objectField(event, 'socket');
      if (!request || !socket || Number(socket.localPort) !== CODEX_CALLBACK_PORT) return;
      const family = loopbackFamily(socket.localAddress);
      if (!family) return;
      const url = requestPath(request);
      if (!url) return;

      const probe = this.activeProbes.get(url.pathname);
      if (probe && requestMethod(request) === 'GET') {
        if (!probe.expectedFamily || probe.expectedFamily === family) {
          probe.observedFamily = family;
        }
        return;
      }

      if (url.pathname !== CODEX_CALLBACK_PATH) return;
      const diagnostic: CodexLoopbackCallbackDiagnostic = {
        family,
        method: requestMethod(request),
        path: CODEX_CALLBACK_PATH,
        hasCode: url.searchParams.has('code'),
        hasState: url.searchParams.has('state')
      };
      this.callbackRequests.set(request, diagnostic);
      this.safeNotify(() => this.callbacks.onCallbackRequest(diagnostic));
    } catch {
      // Observability must never alter the OAuth callback lifecycle.
    }
  };

  private readonly onServerResponseFinish: DiagnosticListener = (message) => {
    try {
      const event = messageRecord(message);
      if (!event) return;
      const request = objectField(event, 'request');
      if (!request) return;
      const diagnostic = this.callbackRequests.get(request);
      if (!diagnostic) return;
      this.callbackRequests.delete(request);
      const statusCode = responseStatus(objectField(event, 'response'));
      if (statusCode === null) return;
      this.safeNotify(() =>
        this.callbacks.onCallbackResponse({
          ...diagnostic,
          statusCode
        })
      );
    } catch {
      // Observability must never alter the OAuth callback lifecycle.
    }
  };

  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.channels.serverRequestStart.subscribe(this.onServerRequestStart);
    this.channels.serverResponseFinish.subscribe(this.onServerResponseFinish);
  }

  async verifyOwnership(options: {
    includeIpv6: boolean;
    signal: AbortSignal;
    timeoutMs?: number;
  }): Promise<CodexLoopbackProbeEvidence[]> {
    if (!this.subscribed) {
      throw new CodexLoopbackProbeError('probe-failed', 'localhost');
    }

    const controller = new AbortController();
    this.activeVerifications.add(controller);
    const abort = (): void => controller.abort(options.signal.reason);
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });

    const nonce = randomBytes(18).toString('hex');
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const probes = probeTargets(options.includeIpv6).map((target) =>
      this.probeTarget(target, `${PROBE_PATH_PREFIX}${nonce}/${target.route}`, controller.signal, timeoutMs)
    );

    try {
      return await Promise.all(probes);
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(probes);
      throw error;
    } finally {
      options.signal.removeEventListener('abort', abort);
      this.activeVerifications.delete(controller);
    }
  }

  stop(): void {
    for (const controller of this.activeVerifications) controller.abort();
    this.activeVerifications.clear();
    this.activeProbes.clear();
    this.callbackRequests = new WeakMap<object, CodexLoopbackCallbackDiagnostic>();
    if (!this.subscribed) return;
    this.subscribed = false;
    this.channels.serverRequestStart.unsubscribe(this.onServerRequestStart);
    this.channels.serverResponseFinish.unsubscribe(this.onServerResponseFinish);
  }

  private async probeTarget(
    target: ProbeTarget,
    path: string,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<CodexLoopbackProbeEvidence> {
    const activeProbe: ActiveProbe = {
      route: target.route,
      expectedFamily: target.expectedFamily,
      observedFamily: null
    };
    this.activeProbes.set(path, activeProbe);

    return await new Promise<CodexLoopbackProbeEvidence>((resolve, reject) => {
      let settled = false;
      let request: ClientRequest | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.activeProbes.delete(path);
      };
      const succeed = (family: CodexLoopbackFamily): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          route: target.route,
          family,
          statusCode: 404
        });
      };
      const fail = (error: CodexLoopbackProbeError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        request?.destroy();
        reject(error);
      };
      const onAbort = (): void =>
        fail(new CodexLoopbackProbeError('cancelled', target.route));

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => fail(new CodexLoopbackProbeError('probe-timeout', target.route)),
        timeoutMs
      );

      try {
        request = createHttpRequest(
          {
            hostname: target.hostname,
            port: CODEX_CALLBACK_PORT,
            family: target.family,
            method: 'GET',
            path,
            agent: false
          },
          (response: IncomingMessage) => {
            const statusCode = response.statusCode ?? 0;
            response.once('aborted', () =>
              fail(new CodexLoopbackProbeError('probe-failed', target.route))
            );
            response.once('error', () =>
              fail(new CodexLoopbackProbeError('probe-failed', target.route))
            );
            response.once('end', () => {
              const observedFamily = activeProbe.observedFamily;
              if (!observedFamily) {
                fail(new CodexLoopbackProbeError('foreign-listener', target.route));
                return;
              }
              if (statusCode !== 404) {
                fail(new CodexLoopbackProbeError('unexpected-response', target.route));
                return;
              }
              succeed(observedFamily);
            });
            response.resume();
          }
        );
        request.once('error', (error) => {
          if (settled) return;
          const reason =
            networkErrorCode(error) === 'ECONNREFUSED' ? 'listener-unreachable' : 'probe-failed';
          fail(new CodexLoopbackProbeError(reason, target.route));
        });
        request.end();
      } catch {
        fail(new CodexLoopbackProbeError('probe-failed', target.route));
      }
    });
  }

  private safeNotify(notify: () => void): void {
    try {
      notify();
    } catch {
      // Diagnostics must never alter the OAuth callback lifecycle.
    }
  }
}
