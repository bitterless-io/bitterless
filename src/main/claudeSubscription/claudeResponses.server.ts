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
  parseClaudeResponsesRequest,
  resolveClaudeSubscriptionModel
} from './claudeResponses.translator';

export class ClaudeResponsesRuntime {
  constructor(
    private readonly router: ClaudeAccountRouter,
    private readonly executor: ClaudeExecutor
  ) {}

  async execute(
    request: ClaudeResponsesRequest,
    signal?: AbortSignal
  ): Promise<ClaudeCompletedResponse> {
    const model = resolveClaudeSubscriptionModel(request.model);
    const payload = buildClaudeBridgePayload(request);
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
          { model, effort: request.claudeEffort, payload, context: lease.context },
          signal ? { signal } : {}
        );
        return makeClaudeCompletedResponse(
          request.model,
          result.decision,
          normalizeClaudeUsage(result.rawUsage)
        );
      } catch (error) {
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
        .catch(() => {
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
    if (request.headers.origin !== undefined) {
      respondJson(response, 403, {
        error: {
          type: 'invalid_request',
          code: 'invalid_request',
          message: 'Browser-origin requests are not accepted.'
        }
      });
      return;
    }

    const pathname = request.url?.split('?', 1)[0] ?? '/';
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
      respondJson(response, 200, claudeSubscriptionModelCatalog());
      return;
    }
    if (request.method !== 'POST' || pathname !== '/v1/responses') {
      respondJson(response, 404, {
        error: { type: 'not_found', message: 'Not found.' }
      });
      return;
    }

    if (!hasJsonContentType(request)) {
      respondClaudeError(
        response,
        new ClaudeSubscriptionInvalidRequestError(
          'Responses requests require Content-Type: application/json.',
          undefined,
          415
        )
      );
      return;
    }

    const abort = (): void => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      const rawBody = await readJsonBody(request, this.#maxBodyBytes, controller.signal);
      const claudeRequest = parseClaudeResponsesRequest(rawBody);
      const completed = await this.runtime.execute(claudeRequest, controller.signal);
      if (!response.destroyed) writeClaudeResponsesStream(response, completed);
    } catch (error) {
      if (response.headersSent || response.writableEnded || response.destroyed) {
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
  respondJson(response, 502, {
    error: {
      type: 'claude_execution',
      code: 'claude_execution',
      message: 'Claude CLI execution failed.'
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
