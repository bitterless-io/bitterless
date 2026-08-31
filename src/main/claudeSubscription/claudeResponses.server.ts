import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
  type ClaudeAccountId,
  type ClaudeCompletedResponse,
  type ClaudeResponsesRequest
} from '@shared/claudeSubscription/claudeSubscription.contract';
import { redactClaudeSubscriptionSecrets } from '@shared/claudeSubscription/claudeSubscription.redaction';
import { ClaudeAccountRouter } from './claudeAccount.router';
import type { ClaudeExecutor } from './claudeCli.executor';
import {
  ClaudeExecutionError,
  ClaudeNoEligibleAccountError,
  ClaudeRequestAbortedError,
  ClaudeSubscriptionError,
  ClaudeSubscriptionInvalidRequestError,
  ClaudeUsageLimitError,
  isClaudeRoutingFailure
} from './claudeSubscription.errors';
import {
  makeClaudeCompletedResponse,
  normalizeClaudeUsage,
  writeClaudeResponsesStream
} from './claudeResponses.stream';
import {
  buildClaudeBridgePayload,
  claudeSubscriptionModelCatalog,
  claudeUpstreamTarget,
  parseClaudeResponsesRequest,
  resolveSub2ApiTarget,
  type Sub2ApiTarget,
  type Sub2ApiUpstreamAvailability
} from './claudeResponses.translator';
import { CodexRuntimeError } from '@main/codex/codexRuntime.service';
import type { CodexResponsesUpstream } from '@main/codex/codexResponses.upstream';
import {
  describeSub2ApiError,
  NO_SUB2API_LOG,
  type Sub2ApiLogger
} from './sub2apiLog.service';

/** Codex failures that mean "this upstream cannot serve anything right now". */
const CODEX_UPSTREAM_UNUSABLE: readonly string[] = ['not-configured', 'runtime-unavailable'];

export class ClaudeResponsesRuntime {
  readonly #codex: CodexResponsesUpstream | null;
  readonly #log: Sub2ApiLogger;

  constructor(
    private readonly router: ClaudeAccountRouter,
    private readonly executor: ClaudeExecutor,
    codex: CodexResponsesUpstream | null = null,
    log: Sub2ApiLogger = NO_SUB2API_LOG
  ) {
    this.#codex = codex;
    this.#log = log;
  }

  async availability(): Promise<Sub2ApiUpstreamAvailability> {
    const [claude, codex] = await Promise.all([
      this.router
        .health()
        .then((health) => health.eligible > 0)
        .catch(() => false),
      this.#codex?.isAvailable().catch(() => false) ?? Promise.resolve(false)
    ]);
    return { claude, codex };
  }

  async execute(
    request: ClaudeResponsesRequest,
    signal?: AbortSignal,
    requestId = ''
  ): Promise<ClaudeCompletedResponse> {
    const payload = buildClaudeBridgePayload(request);
    const target = resolveSub2ApiTarget(request);
    this.#log({
      level: 'info',
      event: 'dispatch',
      fields: {
        id: requestId,
        upstream: target.upstream,
        requestedModel: request.model,
        model: target.modelId,
        requestedEffort: request.claudeEffort,
        effort: target.effort,
        tools: payload.available_tools.length,
        unsupportedTools: payload.unsupported_codex_tool_types.join(',') || undefined
      }
    });
    if (target.upstream === 'codex') {
      const codex = this.#codex;
      if (codex) {
        try {
          const result = await codex.execute(
            { model: target.modelId, effort: target.effort, payload },
            signal ? { signal } : {}
          );
          this.#log({
            level: 'info',
            event: 'codex-completed',
            fields: { id: requestId, model: result.model, decision: result.decision.action }
          });
          return makeClaudeCompletedResponse(result.model, result.decision, normalizeClaudeUsage());
        } catch (error) {
          const described = describeSub2ApiError(error);
          const code = error instanceof CodexRuntimeError ? error.code : undefined;
          this.#log({
            level: 'warn',
            event: 'codex-failed',
            fields: {
              id: requestId,
              model: target.modelId,
              codexCode: code,
              fallback: code !== undefined && CODEX_UPSTREAM_UNUSABLE.includes(code),
              ...described
            }
          });
          // Only a *missing* Codex upstream falls through to Claude. A provider error
          // is a real failure of the model the caller chose, and hiding it behind a
          // different model would both mislead and spend Claude quota.
          if (
            !(error instanceof CodexRuntimeError) ||
            !CODEX_UPSTREAM_UNUSABLE.includes(error.code)
          ) {
            throw error;
          }
        }
      }
      // No Codex credential: answer from Claude rather than breaking the thread, and
      // report the model that actually ran.
      return await this.#executeClaude(
        claudeUpstreamTarget(request),
        payload,
        request,
        signal,
        requestId
      );
    }
    return await this.#executeClaude(target, payload, request, signal, requestId);
  }

  async #executeClaude(
    target: Extract<Sub2ApiTarget, { upstream: 'claude' }>,
    payload: ReturnType<typeof buildClaudeBridgePayload>,
    request: ClaudeResponsesRequest,
    signal?: AbortSignal,
    requestId = ''
  ): Promise<ClaudeCompletedResponse> {
    const model = target.cliModel;
    // Report what actually ran, not what was asked for — see
    // resolveClaudeSubscriptionModelId for why a mismatch is possible.
    const reportedModel = target.modelId;
    const excluded = new Set<ClaudeAccountId>();
    let priorUsageFailure: ClaudeUsageLimitError | undefined;
    let priorAuthenticationFailure: Error | undefined;

    // Every iteration either returns, rethrows a non-routing error, or adds exactly
    // one account to `excluded` — and `lease()` refuses excluded accounts — so the
    // loop is bounded by the size of the pool and ends with
    // ClaudeNoEligibleAccountError once every account has been tried. A previous
    // hard cap of two attempts meant a third, idle, fully-quota'd account was never
    // reached: the pool behaved as if it had two members.
    for (;;) {
      let lease;
      try {
        lease = await this.router.lease(request.prompt_cache_key, excluded);
      } catch (error) {
        if (error instanceof ClaudeNoEligibleAccountError) {
          if (priorUsageFailure) throw priorUsageFailure;
          if (priorAuthenticationFailure) throw priorAuthenticationFailure;
        }
        throw error;
      }

      if (excluded.has(lease.accountId)) {
        // The bound above depends on `lease()` honouring `excluded`. If it ever
        // does not, stop rather than spin, and report it as exhaustion.
        lease.release();
        break;
      }

      try {
        const result = await this.executor.execute(
          { model, effort: target.effort, payload, context: lease.context },
          signal ? { signal } : {}
        );
        if (result.rateLimit) {
          this.router.observeRateLimit(lease.accountId, {
            status: result.rateLimit.status,
            ...(result.rateLimit.rateLimitType ? { window: result.rateLimit.rateLimitType } : {}),
            ...(result.rateLimit.resetsAt !== undefined
              ? { resetsAt: result.rateLimit.resetsAt }
              : {}),
            ...(result.rateLimit.isUsingOverage !== undefined
              ? { usingOverage: result.rateLimit.isUsingOverage }
              : {}),
            observedAt: Date.now()
          });
        }
        this.#log({
          level: 'info',
          event: 'claude-completed',
          fields: {
            id: requestId,
            model: reportedModel,
            account: lease.accountId,
            decision: result.decision.action
          }
        });
        return makeClaudeCompletedResponse(
          reportedModel,
          result.decision,
          normalizeClaudeUsage(result.rawUsage)
        );
      } catch (error) {
        const described = describeSub2ApiError(error);
        this.#log({
          level: 'warn',
          event: 'claude-failed',
          fields: {
            id: requestId,
            model: reportedModel,
            account: lease.accountId,
            errorCode: error instanceof ClaudeSubscriptionError ? error.code : undefined,
            routingFailure: isClaudeRoutingFailure(error),
            ...described
          }
        });
        if (!isClaudeRoutingFailure(error)) {
          if (error instanceof Error) throw error;
          throw new ClaudeExecutionError();
        }

        excluded.add(lease.accountId);
        if (error instanceof ClaudeUsageLimitError) {
          priorUsageFailure = error;
          try {
            await this.router.markCooldown(lease.accountId, error.resetAt);
          } catch {
            // The router already applied its process-local cooldown.
          }
        } else {
          priorAuthenticationFailure = error;
          try {
            await this.router.markNeedsLogin(lease.accountId);
          } catch {
            // The router already applied its process-local login state.
          }
        }
      } finally {
        lease.release();
      }
    }

    if (priorUsageFailure) throw priorUsageFailure;
    if (priorAuthenticationFailure) throw priorAuthenticationFailure;
    throw new ClaudeNoEligibleAccountError();
  }
}

export interface ClaudeResponsesServerOptions {
  port?: number;
  maxBodyBytes?: number;
  log?: Sub2ApiLogger;
}

export interface ClaudeResponsesServerAddress {
  host: typeof CLAUDE_SUBSCRIPTION_HOST;
  port: number;
}

interface ClaudeActiveHttpRequest {
  controller: AbortController;
  request: IncomingMessage;
  response: ServerResponse;
}

export class ClaudeResponsesServer {
  readonly #server: Server;
  readonly #activeRequests = new Set<ClaudeActiveHttpRequest>();
  readonly #handlerPromises = new Set<Promise<void>>();
  readonly #port: number;
  readonly #maxBodyBytes: number;
  readonly #log: Sub2ApiLogger;
  #requestCounter = 0;
  #listening = false;
  #listenPromise: Promise<void> | null = null;
  #closingPromise: Promise<void> | null = null;

  constructor(
    private readonly router: ClaudeAccountRouter,
    private readonly runtime: ClaudeResponsesRuntime,
    options: ClaudeResponsesServerOptions = {}
  ) {
    this.#port = options.port ?? CLAUDE_SUBSCRIPTION_DEFAULT_PORT;
    this.#maxBodyBytes = options.maxBodyBytes ?? 32 * 1024 * 1024;
    this.#log = options.log ?? NO_SUB2API_LOG;
    if (!Number.isInteger(this.#port) || this.#port < 0 || this.#port > 65_535) {
      throw new Error('Claude Responses server port is invalid.');
    }
    if (!Number.isInteger(this.#maxBodyBytes) || this.#maxBodyBytes <= 0) {
      throw new Error('Claude Responses body limit is invalid.');
    }
    this.#server = http.createServer((request, response) => {
      if (this.#closingPromise) {
        request.destroy();
        response.destroy();
        return;
      }
      const active: ClaudeActiveHttpRequest = {
        controller: new AbortController(),
        request,
        response
      };
      this.#activeRequests.add(active);
      const handling = this.#handle(request, response, active.controller)
        .catch((error: unknown) => {
          // Reached only when #handle's own error path threw. Without this line the
          // cause is gone: the client is told "Claude CLI execution failed." no matter
          // what actually happened.
          this.#log({
            level: 'error',
            event: 'handler-crashed',
            fields: describeSub2ApiError(error)
          });
          if (!response.headersSent && !response.writableEnded && !response.destroyed) {
            respondClaudeError(response, new ClaudeExecutionError());
          }
        })
        .finally(() => {
          this.#activeRequests.delete(active);
          this.#handlerPromises.delete(handling);
        });
      this.#handlerPromises.add(handling);
      void handling;
    });
    this.#server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
  }

  async listen(): Promise<ClaudeResponsesServerAddress> {
    if (this.#closingPromise) {
      await this.#closingPromise;
      throw new Error('Claude Responses server is closing.');
    }
    if (this.#listening) return this.address();
    if (!this.#listenPromise) {
      this.#listenPromise = new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          this.#server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          this.#server.off('error', onError);
          resolve();
        };
        this.#server.once('error', onError);
        this.#server.once('listening', onListening);
        this.#server.listen(this.#port, CLAUDE_SUBSCRIPTION_HOST);
      });
    }
    const pendingListen = this.#listenPromise;
    try {
      await pendingListen;
    } finally {
      if (this.#listenPromise === pendingListen) this.#listenPromise = null;
    }
    if (this.#closingPromise || !this.#server.listening) {
      const pendingClose = this.#closingPromise;
      if (pendingClose) await pendingClose;
      throw new Error('Claude Responses server closed while starting.');
    }
    this.#listening = true;
    return this.address();
  }

  address(): ClaudeResponsesServerAddress {
    const address = this.#server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Claude Responses server is not listening.');
    }
    return {
      host: CLAUDE_SUBSCRIPTION_HOST,
      port: (address as AddressInfo).port
    };
  }

  async close(): Promise<void> {
    if (this.#closingPromise) return await this.#closingPromise;
    this.#closingPromise = this.#closeInternal();
    try {
      await this.#closingPromise;
    } finally {
      this.#closingPromise = null;
    }
  }

  async #closeInternal(): Promise<void> {
    try {
      await this.#listenPromise;
    } catch {
      // A failed startup leaves no listener to close.
    }
    const handlers = [...this.#handlerPromises];
    for (const active of this.#activeRequests) {
      active.controller.abort();
      active.request.destroy();
      active.response.destroy();
    }
    if (this.#server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => (error ? reject(error) : resolve()));
        this.#server.closeIdleConnections();
        this.#server.closeAllConnections();
      });
      this.#listening = false;
    }
    await Promise.allSettled(handlers);
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
    controller: AbortController
  ): Promise<void> {
    const requestId = `r${++this.#requestCounter}`;
    const startedAt = Date.now();
    const pathname = request.url?.split('?', 1)[0] ?? '/';
    // Logged before any rejection. Every early return below used to answer without a
    // trace, so a client refused here left the log looking as though it had never
    // called at all — which is indistinguishable from a client that never called.
    this.#log({
      level: 'info',
      event: 'received',
      fields: {
        id: requestId,
        method: request.method ?? '(none)',
        path: pathname,
        origin: request.headers.origin ?? '(none)',
        contentType: request.headers['content-type'] ?? '(none)',
        contentLength: request.headers['content-length'] ?? '(none)',
        userAgent: request.headers['user-agent'] ?? '(none)'
      }
    });

    const reject = (status: number, code: string, message: string): void => {
      this.#log({
        level: 'warn',
        event: 'rejected',
        fields: { id: requestId, status, errorCode: code, path: pathname }
      });
      respondJson(response, status, { error: { type: code, code, message } });
    };

    if (request.headers.origin !== undefined) {
      reject(403, 'invalid_request', 'Browser-origin requests are not accepted.');
      return;
    }

    if (request.method === 'GET' && pathname === '/health') {
      try {
        const accounts = await this.router.health();
        respondJson(response, 200, { ok: accounts.eligible > 0, accounts });
      } catch {
        respondJson(response, 503, {
          ok: false,
          error: {
            type: 'claude_health_unavailable',
            message: 'Claude account health is unavailable.'
          }
        });
      }
      return;
    }
    if (request.method === 'GET' && pathname === '/v1/models') {
      respondJson(response, 200, claudeSubscriptionModelCatalog(await this.runtime.availability()));
      return;
    }
    if (request.method !== 'POST' || pathname !== '/v1/responses') {
      reject(404, 'not_found', 'Not found.');
      return;
    }

    if (!hasJsonContentType(request)) {
      reject(415, 'invalid_request', 'Responses requests require Content-Type: application/json.');
      return;
    }

    const abort = (): void => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      const rawBody = await readJsonBody(request, this.#maxBodyBytes, controller.signal);
      this.#log({
        level: 'info',
        event: 'request',
        fields: { id: requestId, ...describeResponsesRequestBody(rawBody) }
      });
      const claudeRequest = parseClaudeResponsesRequest(rawBody);
      const completed = await this.runtime.execute(claudeRequest, controller.signal, requestId);
      if (!response.destroyed) writeClaudeResponsesStream(response, completed);
      this.#log({
        level: 'info',
        event: 'responded',
        fields: {
          id: requestId,
          status: 200,
          model: completed.model,
          ms: Date.now() - startedAt
        }
      });
    } catch (error) {
      const described = describeSub2ApiError(error);
      const status = error instanceof ClaudeSubscriptionError ? error.statusCode : 502;
      const streaming = response.headersSent || response.writableEnded || response.destroyed;
      this.#log({
        level: 'error',
        event: streaming ? 'failed-mid-stream' : 'failed',
        fields: {
          id: requestId,
          status,
          errorCode: error instanceof ClaudeSubscriptionError ? error.code : undefined,
          ms: Date.now() - startedAt,
          ...described
        }
      });
      if (streaming) {
        if (!response.destroyed) response.destroy();
        return;
      }
      respondClaudeError(response, error);
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }
}

/**
 * Summarises a request body for the log without copying the transcript into it. The
 * shape is what distinguishes a client that works from one that does not — the model,
 * the tool set, and how much text arrived — so it is recorded before parsing, which is
 * itself one of the things that can reject the request.
 */
const describeResponsesRequestBody = (body: unknown): Record<string, string | number | boolean> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { bodyType: typeof body };
  }
  const value = body as Record<string, unknown>;
  const input = value.input;
  const tools = Array.isArray(value.tools) ? value.tools : [];
  const toolTypes = new Set<string>();
  for (const tool of tools) {
    if (typeof tool === 'object' && tool !== null && typeof (tool as { type?: unknown }).type === 'string') {
      toolTypes.add((tool as { type: string }).type);
    }
  }
  const reasoning = value.reasoning;
  return {
    model: typeof value.model === 'string' ? value.model : '(missing)',
    stream: value.stream === true,
    effort:
      typeof reasoning === 'object' && reasoning !== null
        ? String((reasoning as { effort?: unknown }).effort ?? '(default)')
        : '(default)',
    instructionsBytes:
      typeof value.instructions === 'string' ? Buffer.byteLength(value.instructions, 'utf8') : 0,
    inputItems: Array.isArray(input) ? input.length : typeof input === 'string' ? 1 : 0,
    tools: tools.length,
    toolTypes: [...toolTypes].join(',') || '(none)',
    extraKeys: Object.keys(value)
      .filter((key) => !KNOWN_RESPONSES_KEYS.has(key))
      .join(',') || '(none)'
  };
};

/** Fields Bitterless reads. Anything else is logged so an unexpected one is visible. */
const KNOWN_RESPONSES_KEYS = new Set([
  'model',
  'stream',
  'instructions',
  'input',
  'tools',
  'reasoning',
  'prompt_cache_key'
]);

const hasJsonContentType = (request: IncomingMessage): boolean => {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string') return false;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
};

const readJsonBody = (
  request: IncomingMessage,
  limit: number,
  signal: AbortSignal
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      request.resume();
      reject(
        new ClaudeSubscriptionInvalidRequestError(
          'Responses request body exceeds the configured limit.',
          undefined,
          413
        )
      );
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
      signal.removeEventListener('abort', onSignalAbort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (value: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) {
        request.resume();
        fail(
          new ClaudeSubscriptionInvalidRequestError(
            'Responses request body exceeds the configured limit.',
            undefined,
            413
          )
        );
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      try {
        succeed(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        fail(
          new ClaudeSubscriptionInvalidRequestError('Invalid JSON request body.', {
            cause: error
          })
        );
      }
    };
    const onAborted = (): void => fail(new ClaudeRequestAbortedError());
    const onError = (error: Error): void => fail(error);
    const onSignalAbort = (): void => fail(new ClaudeRequestAbortedError());

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
    signal.addEventListener('abort', onSignalAbort, { once: true });
    if (signal.aborted) onSignalAbort();
  });

const respondClaudeError = (response: ServerResponse, error: unknown): void => {
  if (error instanceof ClaudeSubscriptionError) {
    respondJson(response, error.statusCode, {
      error: {
        type: error.code,
        code: error.code,
        message: redactClaudeSubscriptionSecrets(error.message)
      }
    });
    return;
  }
  // An untyped failure used to be reported as the same fixed sentence as every other
  // one, which is why Codex could only render "Unknown error". The real message is
  // redacted and bounded, then included, so the client shows something actionable.
  const described = describeSub2ApiError(error);
  const detail = redactClaudeSubscriptionSecrets(
    `${described.errorName}: ${described.errorMessage}`
  ).slice(0, 500);
  respondJson(response, 502, {
    error: {
      type: 'claude_execution',
      code: 'claude_execution',
      message: `Bitterless Sub2API could not complete the request. ${detail}`
    }
  });
};

const respondJson = (response: ServerResponse, statusCode: number, value: unknown): void => {
  if (response.writableEnded || response.destroyed) return;
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
};
