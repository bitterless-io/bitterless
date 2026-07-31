import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CodexBrowserCallbackCapture } from './codexCallbackCapture';
import {
  CodexFileCredentialStore,
  CodexMemoryCredentialStore,
  type CodexCredentialStore
} from './codexCredential.store';
import {
  CodexLoopbackObserver,
  CodexLoopbackProbeError,
  type CodexLoopbackObserverCallbacks,
  type CodexLoopbackOwnershipObserver
} from './codexLoopbackObserver.service';
import { CodexTokenExchangeObserver } from './codexTokenExchangeObserver.service';
import {
  sanitizeDiagnostic,
  sanitizeDiagnosticUrl,
  sanitizeErrorCauseChain
} from '@shared/diagnostics/diagnostic.service';

const CODEX_PROVIDER = 'openai-codex';
const CODEX_STATUS_MODEL = 'gpt-5.5';
const BROWSER_TIMEOUT_MS = 180_000;
const DEVICE_TIMEOUT_MS = 16 * 60_000;

export type CodexLoginMethod = 'browser' | 'device_code';
export type CodexCredentialErrorCode =
  | 'cancelled'
  | 'login-failed'
  | 'login-in-progress'
  | 'logout-failed'
  | 'status-unavailable'
  | 'timeout';

export interface CodexCredentialStatus {
  provider: 'openai-codex';
  connected: boolean;
  loginInProgress: boolean;
  lastVerifiedAt: number;
  errorCode?: 'status-unavailable';
}

export type CodexCredentialTransitionKind = 'login-succeeded' | 'logout-succeeded';

export interface CodexCredentialTransition {
  provider: 'openai-codex';
  kind: CodexCredentialTransitionKind;
  observedAt: number;
}

export type CodexCredentialTransitionListener = (transition: CodexCredentialTransition) => void;

export interface CodexDeviceCodeNotice {
  userCode: string;
  verificationHost: string;
  expiresAt: number | null;
}

export interface CodexConnectObserver {
  onDeviceCode?: (notice: CodexDeviceCodeNotice) => void;
  onProgress?: (message: string) => void;
}

interface CodexLoginAttempt {
  id: number;
  cancelled: boolean;
  controller: AbortController;
  capture: CodexBrowserCallbackCapture | null;
  observers: Set<CodexConnectObserver>;
  promotedStore: PiAuthStorage | null;
  promise: Promise<CodexCredentialStatus>;
}

export interface PiAuthStorage extends CodexCredentialStore {
  login?(
    provider: string,
    callbacks: {
      onSelect: () => Promise<string | undefined>;
      onAuth: (params: { url: string }) => void;
      onManualCodeInput: () => Promise<string>;
      onDeviceCode: (params: {
        userCode: string;
        verificationUri: string;
        expiresInSeconds?: number;
      }) => void;
      onPrompt: () => Promise<string>;
      onProgress: (message: string) => void;
      signal: AbortSignal;
    }
  ): Promise<unknown>;
  logout?(provider: string): void;
}

interface PiAuthModelRuntime {
  getModel(provider: string, model: string): unknown | undefined;
  hasConfiguredAuth(provider: string): boolean;
  login(
    provider: string,
    type: 'oauth',
    interaction: {
      signal: AbortSignal;
      prompt(prompt: {
        type: 'text' | 'secret' | 'select' | 'manual_code';
        message?: string;
        options?: readonly { id: string; label: string; description?: string }[];
        signal?: AbortSignal;
      }): Promise<string>;
      notify(event: {
        type: 'info' | 'auth_url' | 'device_code' | 'progress';
        message?: string;
        url?: string;
        userCode?: string;
        verificationUri?: string;
        expiresInSeconds?: number;
      }): void;
    }
  ): Promise<unknown>;
  logout(provider: string): Promise<void>;
}

export interface PiAuthModule {
  ModelRuntime?: {
    create(options?: {
      authPath?: string;
      modelsPath?: string | null;
      credentials?: PiAuthStorage;
      allowModelNetwork?: boolean;
    }): Promise<PiAuthModelRuntime>;
  };
  ModelRegistry: {
    create(
      authStorage: PiAuthStorage,
      modelsPath?: string
    ): {
      find(provider: string, model: string): unknown;
      hasConfiguredAuth(model: unknown): boolean;
    };
  };
}

export interface CodexCredentialServiceDependencies {
  authPath(): string;
  modelsPath(): string;
  loadPiAuthModule(): Promise<PiAuthModule>;
  openExternal(url: string): Promise<void>;
  createBrowserCallbackCapture(): Promise<CodexBrowserCallbackCapture>;
  createPersistentCredentialStore?: (path: string) => PiAuthStorage;
  createAttemptCredentialStore?: () => PiAuthStorage;
  createLoopbackObserver?: (
    callbacks: CodexLoopbackObserverCallbacks
  ) => CodexLoopbackOwnershipObserver;
  platform?: NodeJS.Platform;
  now?: () => number;
  browserTimeoutMs?: number;
  deviceTimeoutMs?: number;
  ensurePrivateDirectory?: (path: string) => void;
}

export class CodexCredentialError extends Error {
  constructor(
    readonly code: CodexCredentialErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'CodexCredentialError';
    if (cause !== undefined) this.cause = cause;
  }
}

const sanitizeCodexStage = (value: string): string =>
  /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : sanitizeDiagnostic(value, 64);

const logCodexLifecycle = (
  attemptId: number | 'status',
  stage: string,
  details: string = ''
): void => {
  const safeStage = sanitizeCodexStage(stage);
  const safeDetails = sanitizeDiagnostic(details, 180);
  console.info(
    `[codex-login] attempt=${attemptId} stage=${safeStage}${safeDetails ? ` ${safeDetails}` : ''}`
  );
};

const logCodexFailure = (attemptId: number | 'status', stage: string, error: unknown): void => {
  const cause = sanitizeErrorCauseChain(error);
  console.error(
    `[codex-login] attempt=${attemptId} stage=${sanitizeCodexStage(stage)}${
      cause ? ` cause=${cause}` : ''
    }`
  );
};

const ensurePrivateDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(path, 0o700);
};

const parseLoginMethod = (value: unknown): CodexLoginMethod => {
  if (value === 'browser' || value === 'device_code') return value;
  throw new CodexCredentialError('login-failed', 'Unsupported Codex sign-in method.');
};

const parseOpenAiExternalUrl = (value: string): URL => {
  const url = new URL(value);
  const allowedHost = url.hostname === 'auth.openai.com' || url.hostname === 'chatgpt.com';
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password) {
    throw new CodexCredentialError('login-failed', 'Codex returned an unsupported sign-in URL.');
  }
  return url;
};

const sanitizeProgress = (value: string): string =>
  value
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[redacted]')
    .slice(0, 180);

const waitForAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new CodexCredentialError('timeout', 'Codex sign-in timed out.')
      );
      return;
    }
    signal.addEventListener(
      'abort',
      () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new CodexCredentialError('timeout', 'Codex sign-in timed out.')
        ),
      { once: true }
    );
  });

const createPiModelRuntime = async (
  pi: PiAuthModule,
  authPath: string,
  modelsPath: string,
  credentials?: PiAuthStorage
): Promise<PiAuthModelRuntime | null> =>
  pi.ModelRuntime?.create
    ? await pi.ModelRuntime.create({
        authPath,
        modelsPath,
        credentials,
        allowModelNetwork: false
      })
    : null;

export class CodexCredentialService {
  private readonly now: () => number;
  private readonly ensureDirectory: (path: string) => void;
  private readonly createPersistentCredentialStore: (path: string) => PiAuthStorage;
  private readonly createAttemptCredentialStore: () => PiAuthStorage;
  private readonly createLoopbackObserver: (
    callbacks: CodexLoopbackObserverCallbacks
  ) => CodexLoopbackOwnershipObserver;
  private readonly platform: NodeJS.Platform;
  private readonly transitionListeners = new Set<CodexCredentialTransitionListener>();
  private loginAttemptId = 0;
  private activeLoginAttempt: CodexLoginAttempt | null = null;
  private loginPromise: Promise<CodexCredentialStatus> | null = null;

  constructor(private readonly dependencies: CodexCredentialServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.ensureDirectory = dependencies.ensurePrivateDirectory ?? ensurePrivateDirectory;
    this.createPersistentCredentialStore =
      dependencies.createPersistentCredentialStore ??
      ((path) => new CodexFileCredentialStore(path));
    this.createAttemptCredentialStore =
      dependencies.createAttemptCredentialStore ?? (() => new CodexMemoryCredentialStore());
    this.createLoopbackObserver =
      dependencies.createLoopbackObserver ?? ((callbacks) => new CodexLoopbackObserver(callbacks));
    this.platform = dependencies.platform ?? process.platform;
  }

  async getStatus(): Promise<CodexCredentialStatus> {
    const lastVerifiedAt = this.now();
    logCodexLifecycle('status', 'status-started');
    try {
      const pi = await this.dependencies.loadPiAuthModule();
      const authPath = this.dependencies.authPath();
      const modelsPath = this.dependencies.modelsPath();
      const modelRuntime = await createPiModelRuntime(pi, authPath, modelsPath);
      let connected = false;
      if (modelRuntime) {
        const model = modelRuntime.getModel(CODEX_PROVIDER, CODEX_STATUS_MODEL);
        connected = Boolean(model && modelRuntime.hasConfiguredAuth(CODEX_PROVIDER));
      } else {
        const auth = this.createPersistentCredentialStore(authPath);
        const registry = pi.ModelRegistry.create(auth, modelsPath);
        const model = registry.find(CODEX_PROVIDER, CODEX_STATUS_MODEL);
        connected = Boolean(model && registry.hasConfiguredAuth(model));
      }
      const status: CodexCredentialStatus = {
        provider: CODEX_PROVIDER,
        connected,
        loginInProgress: this.activeLoginAttempt !== null,
        lastVerifiedAt
      };
      logCodexLifecycle(
        'status',
        'status-resolved',
        `connected=${status.connected} loginInProgress=${status.loginInProgress}`
      );
      return status;
    } catch (error) {
      logCodexFailure('status', 'status-failed', error);
      return {
        provider: CODEX_PROVIDER,
        connected: false,
        loginInProgress: this.activeLoginAttempt !== null,
        lastVerifiedAt,
        errorCode: 'status-unavailable'
      };
    }
  }

  subscribeTransitions(listener: CodexCredentialTransitionListener): () => void {
    this.transitionListeners.add(listener);
    return () => this.transitionListeners.delete(listener);
  }

  connect(
    params: { method: CodexLoginMethod } & CodexConnectObserver
  ): Promise<CodexCredentialStatus> {
    const method = parseLoginMethod(params?.method);
    const observer: CodexConnectObserver = {
      onDeviceCode: params?.onDeviceCode,
      onProgress: params?.onProgress
    };
    let attempt = this.activeLoginAttempt;
    if (!attempt) {
      const controller = new AbortController();
      attempt = {
        id: ++this.loginAttemptId,
        cancelled: false,
        controller,
        capture: null,
        observers: new Set([observer]),
        promotedStore: null,
        promise: Promise.resolve({
          provider: CODEX_PROVIDER,
          connected: false,
          loginInProgress: false,
          lastVerifiedAt: this.now()
        })
      };
      this.activeLoginAttempt = attempt;
      logCodexLifecycle(attempt.id, 'attempt-created', `method=${method}`);
      const login = this.performConnect(method, attempt);
      const tracked = login.finally(() => {
        if (this.loginPromise === tracked) this.loginPromise = null;
        if (this.activeLoginAttempt === attempt) this.activeLoginAttempt = null;
      });
      attempt.promise = tracked;
      this.loginPromise = tracked;
    } else {
      attempt.observers.add(observer);
      logCodexLifecycle(attempt.id, 'attempt-observer-attached');
    }

    return attempt.promise.finally(() => attempt.observers.delete(observer));
  }

  async cancelConnect(): Promise<void> {
    const attempt = this.activeLoginAttempt;
    if (!attempt) return;

    logCodexLifecycle(attempt.id, 'cancel-requested');
    const error = new CodexCredentialError('cancelled', 'Codex sign-in was cancelled.');
    attempt.cancelled = true;
    this.loginAttemptId += 1;
    if (this.activeLoginAttempt === attempt) this.activeLoginAttempt = null;
    if (this.loginPromise === attempt.promise) this.loginPromise = null;
    attempt.observers.clear();
    attempt.controller.abort(error);
    attempt.capture?.cancel(error);
    if (attempt.capture) {
      const capture = attempt.capture;
      attempt.capture = null;
      await capture.close().catch(() => undefined);
    }
    if (attempt.promotedStore) {
      const promotedStore = attempt.promotedStore;
      attempt.promotedStore = null;
      await promotedStore.delete(CODEX_PROVIDER).catch(() => undefined);
    }
    logCodexLifecycle(attempt.id, 'cancel-completed');
  }

  async disconnect(): Promise<CodexCredentialStatus> {
    if (this.activeLoginAttempt) {
      throw new CodexCredentialError(
        'login-in-progress',
        'Finish the active Codex sign-in before disconnecting.'
      );
    }
    try {
      const pi = await this.dependencies.loadPiAuthModule();
      const modelRuntime = await createPiModelRuntime(
        pi,
        this.dependencies.authPath(),
        this.dependencies.modelsPath()
      );
      if (modelRuntime) {
        await modelRuntime.logout(CODEX_PROVIDER);
      } else {
        const auth = this.createPersistentCredentialStore(this.dependencies.authPath());
        if (auth.logout) auth.logout(CODEX_PROVIDER);
        else await auth.delete(CODEX_PROVIDER);
      }
      const status = await this.getStatus();
      if (!status.connected && !status.errorCode) this.notifyTransition('logout-succeeded');
      return status;
    } catch {
      throw new CodexCredentialError('logout-failed', 'Codex could not be disconnected.');
    }
  }

  private async performConnect(
    method: CodexLoginMethod,
    attempt: CodexLoginAttempt
  ): Promise<CodexCredentialStatus> {
    const timeoutMs =
      method === 'device_code'
        ? (this.dependencies.deviceTimeoutMs ?? DEVICE_TIMEOUT_MS)
        : (this.dependencies.browserTimeoutMs ?? BROWSER_TIMEOUT_MS);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let browserAuthorization: Promise<void> | null = null;
    let ipv6Companion: CodexBrowserCallbackCapture | null = null;
    let loopbackObserver: CodexLoopbackOwnershipObserver | null = null;
    let piIpv4CallbackAccepted = false;
    let tokenExchangeObserver: CodexTokenExchangeObserver | null = null;

    try {
      logCodexLifecycle(attempt.id, 'attempt-started', `method=${method}`);
      const pi = await Promise.race([
        this.dependencies.loadPiAuthModule(),
        waitForAbort(attempt.controller.signal)
      ]);
      this.assertActiveAttempt(attempt);
      const authPath = this.dependencies.authPath();
      const modelsPath = this.dependencies.modelsPath();
      this.ensureDirectory(dirname(authPath));
      const attemptAuth = this.createAttemptCredentialStore();
      const persistentAuth = this.createPersistentCredentialStore(authPath);
      await Promise.race([
        persistentAuth.delete(CODEX_PROVIDER),
        waitForAbort(attempt.controller.signal)
      ]);
      logCodexLifecycle(attempt.id, 'persistent-credential-cleared');
      this.assertActiveAttempt(attempt);
      const modelRuntime = pi.ModelRuntime?.create
        ? await Promise.race([
            createPiModelRuntime(pi, authPath, modelsPath, attemptAuth),
            waitForAbort(attempt.controller.signal)
          ])
        : null;
      this.assertActiveAttempt(attempt);
      logCodexLifecycle(attempt.id, 'runtime-created', `owner=${modelRuntime ? 'pi' : 'legacy'}`);
      const needsCallbackCapture =
        method === 'browser' && (!modelRuntime || this.platform === 'darwin');
      if (needsCallbackCapture) {
        try {
          attempt.capture = await Promise.race([
            this.dependencies.createBrowserCallbackCapture(),
            waitForAbort(attempt.controller.signal)
          ]);
          this.assertActiveAttempt(attempt);
          if (modelRuntime) {
            ipv6Companion = attempt.capture;
            logCodexLifecycle(
              attempt.id,
              'callback-companion-ready',
              'owner=bitterless family=ipv6'
            );
          } else {
            logCodexLifecycle(attempt.id, 'callback-listener-ready', 'owner=legacy family=ipv6');
          }
        } catch (error) {
          logCodexFailure(
            attempt.id,
            modelRuntime ? 'callback-companion-unavailable' : 'callback-listener-unavailable',
            error
          );
          throw error;
        }
      }
      if (modelRuntime && method === 'browser') {
        loopbackObserver = this.createLoopbackObserver({
          onCallbackRequest: (diagnostic) => {
            if (!this.isActiveAttempt(attempt)) return;
            logCodexLifecycle(
              attempt.id,
              'callback-request-received',
              `family=${diagnostic.family} method=${diagnostic.method} path=${diagnostic.path} hasCode=${diagnostic.hasCode} hasState=${diagnostic.hasState}`
            );
          },
          onCallbackResponse: (diagnostic) => {
            if (!this.isActiveAttempt(attempt)) return;
            logCodexLifecycle(
              attempt.id,
              'callback-response-sent',
              `family=${diagnostic.family} method=${diagnostic.method} path=${diagnostic.path} status=${diagnostic.statusCode}`
            );
            if (
              diagnostic.family === 'ipv4' &&
              diagnostic.statusCode === 200 &&
              ipv6Companion
            ) {
              piIpv4CallbackAccepted = true;
              logCodexLifecycle(
                attempt.id,
                'callback-companion-closing',
                'reason=pi-ipv4-callback'
              );
              void ipv6Companion
                .close()
                .then(() =>
                  logCodexLifecycle(
                    attempt.id,
                    'callback-companion-closed',
                    'reason=pi-ipv4-callback'
                  )
                )
                .catch((error) =>
                  logCodexFailure(attempt.id, 'callback-companion-close-failed', error)
                );
            }
          }
        });
        loopbackObserver.start();
        tokenExchangeObserver = new CodexTokenExchangeObserver({
          onRequest: () => {
            if (!this.isActiveAttempt(attempt)) return;
            if (piIpv4CallbackAccepted && ipv6Companion) {
              ipv6Companion.cancel(
                new CodexCredentialError('cancelled', 'Pi accepted the IPv4 callback.')
              );
            }
            logCodexLifecycle(attempt.id, 'token-exchange-started');
          },
          onResponse: (statusCode) => {
            if (!this.isActiveAttempt(attempt)) return;
            logCodexLifecycle(attempt.id, 'token-exchange-response', `status=${statusCode}`);
          },
          onError: (error) => {
            if (!this.isActiveAttempt(attempt)) return;
            logCodexFailure(attempt.id, 'token-exchange-failed', error);
          }
        });
        tokenExchangeObserver.start();
      }
      timer = setTimeout(() => {
        timedOut = true;
        const error = new CodexCredentialError('timeout', 'Codex sign-in timed out.');
        logCodexLifecycle(attempt.id, 'timeout-triggered');
        attempt.controller.abort(error);
        attempt.capture?.cancel(error);
      }, timeoutMs);

      const manualCodeInput = async (promptSignal?: AbortSignal): Promise<string> => {
        this.assertActiveAttempt(attempt);
        const redirect = attempt.capture?.waitForRedirect();
        const waits: Promise<string>[] = [
          redirect ?? waitForAbort(attempt.controller.signal),
          waitForAbort(attempt.controller.signal)
        ];
        if (promptSignal && promptSignal !== attempt.controller.signal) {
          waits.push(waitForAbort(promptSignal));
        }
        const value = await Promise.race(waits);
        this.assertActiveAttempt(attempt);
        logCodexLifecycle(
          attempt.id,
          modelRuntime ? 'callback-forwarded-to-pi' : 'callback-received',
          `owner=${modelRuntime ? 'bitterless' : 'legacy'} family=ipv6`
        );
        return value;
      };
      const login = modelRuntime
        ? modelRuntime.login(CODEX_PROVIDER, 'oauth', {
            signal: attempt.controller.signal,
            prompt: async (prompt) => {
              if (prompt.type === 'select') return method;
              if (prompt.type === 'manual_code') {
                return await manualCodeInput(prompt.signal);
              }
              return await waitForAbort(prompt.signal ?? attempt.controller.signal);
            },
            notify: (event) => {
              if (!this.isActiveAttempt(attempt)) return;
              if (event.type === 'auth_url' && event.url) {
                logCodexLifecycle(attempt.id, 'callback-listener-announced', 'owner=pi family=ipv4');
                if (browserAuthorization) {
                  const error = new CodexCredentialError(
                    'login-failed',
                    'Codex announced more than one browser authorization request.'
                  );
                  logCodexFailure(attempt.id, 'authorization-url-duplicate', error);
                  attempt.controller.abort(error);
                  attempt.capture?.cancel(error);
                  return;
                }
                const authorization = (async (): Promise<void> => {
                  logCodexLifecycle(
                    attempt.id,
                    'callback-listener-verification-started',
                    `ipv6Required=${Boolean(ipv6Companion)}`
                  );
                  try {
                    const evidence = await loopbackObserver!.verifyOwnership({
                      includeIpv6: Boolean(ipv6Companion),
                      signal: attempt.controller.signal
                    });
                    this.assertActiveAttempt(attempt);
                    logCodexLifecycle(
                      attempt.id,
                      'callback-listener-verified',
                      evidence
                        .map(
                          ({ route, family, statusCode }) =>
                            `${route}=${family}:${statusCode}`
                        )
                        .join(' ')
                    );
                  } catch (error) {
                    if (!this.isActiveAttempt(attempt)) {
                      throw new CodexCredentialError(
                        'cancelled',
                        'Codex sign-in was cancelled.'
                      );
                    }
                    if (error instanceof CodexLoopbackProbeError) {
                      logCodexLifecycle(
                        attempt.id,
                        'callback-listener-verification-failed',
                        `route=${error.route} reason=${error.reason}`
                      );
                    } else {
                      logCodexFailure(
                        attempt.id,
                        'callback-listener-verification-failed',
                        error
                      );
                    }
                    throw new CodexCredentialError(
                      'login-failed',
                      'Codex callback listener ownership could not be verified.',
                      error
                    );
                  }
                  this.assertActiveAttempt(attempt);
                  await this.openAuthUrl(event.url!, attempt.id);
                })();
                browserAuthorization = authorization;
                void authorization.catch((error) => {
                  if (!this.isActiveAttempt(attempt)) return;
                  attempt.controller.abort(error);
                  attempt.capture?.cancel(
                    error instanceof Error
                      ? error
                      : new CodexCredentialError('login-failed', 'Codex sign-in failed.')
                  );
                });
              }
              if (event.type === 'device_code') this.notifyDeviceCode(attempt, event);
              if (event.type === 'progress' && event.message) {
                logCodexLifecycle(
                  attempt.id,
                  'login-progress',
                  sanitizeDiagnostic(event.message, 120)
                );
                this.notifyProgress(attempt, event.message);
              }
              if (event.type === 'info' && event.message) {
                logCodexLifecycle(attempt.id, 'login-info', sanitizeDiagnostic(event.message, 120));
                this.notifyProgress(attempt, event.message);
              }
            }
          })
        : this.loginWithLegacyStorage(attemptAuth, method, attempt, manualCodeInput);
      logCodexLifecycle(attempt.id, 'login-promise-started');
      void login.catch(() => undefined);
      await Promise.race([login, waitForAbort(attempt.controller.signal)]);
      logCodexLifecycle(attempt.id, 'login-promise-resolved');
      this.assertActiveAttempt(attempt);
      if (modelRuntime && method === 'browser') {
        if (!browserAuthorization) {
          throw new CodexCredentialError(
            'login-failed',
            'Codex did not announce a browser authorization request.'
          );
        }
        await Promise.race([
          browserAuthorization,
          waitForAbort(attempt.controller.signal)
        ]);
        this.assertActiveAttempt(attempt);
      }
      const credential = await attemptAuth.read(CODEX_PROVIDER);
      logCodexLifecycle(attempt.id, 'token-credential-stored', `stored=${Boolean(credential)}`);
      this.assertActiveAttempt(attempt);
      if (!credential) {
        throw new CodexCredentialError(
          'login-failed',
          'Codex sign-in did not create a usable credential.'
        );
      }
      attempt.promotedStore = persistentAuth;
      logCodexLifecycle(attempt.id, 'promotion-started');
      await Promise.race([
        persistentAuth.modify(CODEX_PROVIDER, async () => {
          this.assertActiveAttempt(attempt);
          return credential;
        }),
        waitForAbort(attempt.controller.signal)
      ]);
      this.assertActiveAttempt(attempt);
      logCodexLifecycle(attempt.id, 'promotion-completed');
      logCodexLifecycle(attempt.id, 'status-verification-started');
      const status = await Promise.race([
        this.getStatus(),
        waitForAbort(attempt.controller.signal)
      ]);
      this.assertActiveAttempt(attempt);
      logCodexLifecycle(
        attempt.id,
        'status-verification-resolved',
        `connected=${status.connected} unavailable=${Boolean(status.errorCode)}`
      );
      if (!status.connected) {
        throw new CodexCredentialError(
          'login-failed',
          'Codex sign-in did not create a usable credential.'
        );
      }
      this.notifyTransition('login-succeeded');
      attempt.promotedStore = null;
      logCodexLifecycle(attempt.id, 'attempt-succeeded');
      return status;
    } catch (error) {
      logCodexFailure(attempt.id, 'attempt-failed', error);
      if (attempt.cancelled || attempt.id !== this.loginAttemptId) {
        throw new CodexCredentialError('cancelled', 'Codex sign-in was cancelled.');
      }
      if (timedOut) {
        throw new CodexCredentialError('timeout', 'Codex sign-in timed out.');
      }
      if (error instanceof CodexCredentialError) throw error;
      throw new CodexCredentialError('login-failed', 'Codex sign-in failed.', error);
    } finally {
      loopbackObserver?.stop();
      tokenExchangeObserver?.stop();
      if (timer) clearTimeout(timer);
      attempt.controller.abort();
      if (attempt.capture) {
        const capture = attempt.capture;
        attempt.capture = null;
        capture.cancel(new CodexCredentialError('cancelled', 'Codex sign-in attempt ended.'));
        await capture.close().catch(() => undefined);
      }
      await browserAuthorization?.catch(() => undefined);
      if ((attempt.cancelled || attempt.id !== this.loginAttemptId) && attempt.promotedStore) {
        const promotedStore = attempt.promotedStore;
        attempt.promotedStore = null;
        await promotedStore.delete(CODEX_PROVIDER).catch(() => undefined);
      }
      logCodexLifecycle(attempt.id, 'attempt-cleanup-completed');
    }
  }

  private async loginWithLegacyStorage(
    auth: PiAuthStorage,
    method: CodexLoginMethod,
    attempt: CodexLoginAttempt,
    manualCodeInput: () => Promise<string>
  ): Promise<unknown> {
    if (!auth.login) {
      throw new CodexCredentialError('login-failed', 'Codex sign-in is unavailable.');
    }
    return await auth.login(CODEX_PROVIDER, {
      onSelect: async () => method,
      onAuth: ({ url }) => {
        if (this.isActiveAttempt(attempt)) {
          logCodexLifecycle(attempt.id, 'authorization-url-received', 'owner=legacy');
          void this.openAuthUrl(url, attempt.id).catch(() => undefined);
        }
      },
      onManualCodeInput: manualCodeInput,
      onDeviceCode: (info) => this.notifyDeviceCode(attempt, info),
      onPrompt: async () => await waitForAbort(attempt.controller.signal),
      onProgress: (message) => this.notifyProgress(attempt, message),
      signal: attempt.controller.signal
    });
  }

  private async openAuthUrl(url: string, attemptId: number): Promise<void> {
    try {
      const external = parseOpenAiExternalUrl(url);
      logCodexLifecycle(
        attemptId,
        'authorization-url-opening',
        `url=${sanitizeDiagnosticUrl(external.href)}`
      );
      await this.dependencies.openExternal(external.href);
      logCodexLifecycle(attemptId, 'authorization-url-opened');
    } catch (error) {
      logCodexFailure(attemptId, 'authorization-url-open-failed', error);
      throw error;
    }
  }

  private notifyDeviceCode(
    attempt: CodexLoginAttempt,
    info: {
      userCode?: string;
      verificationUri?: string;
      expiresInSeconds?: number;
    }
  ): void {
    if (!this.isActiveAttempt(attempt) || !info.verificationUri) return;
    const external = parseOpenAiExternalUrl(info.verificationUri);
    logCodexLifecycle(
      attempt.id,
      'device-verification-url-opening',
      `url=${sanitizeDiagnosticUrl(external.href)}`
    );
    void this.dependencies
      .openExternal(external.href)
      .then(() => logCodexLifecycle(attempt.id, 'device-verification-url-opened'))
      .catch((error) => logCodexFailure(attempt.id, 'device-verification-url-open-failed', error));
    const userCode = String(info.userCode || '')
      .replace(/[^A-Za-z0-9-]/g, '')
      .slice(0, 32);
    const expiresAt = Number.isFinite(info.expiresInSeconds)
      ? this.now() + Number(info.expiresInSeconds) * 1000
      : null;
    for (const observer of attempt.observers) {
      observer.onDeviceCode?.({
        userCode,
        verificationHost: external.host,
        expiresAt
      });
    }
  }

  private notifyProgress(attempt: CodexLoginAttempt, message: string): void {
    if (!this.isActiveAttempt(attempt)) return;
    const safeMessage = sanitizeProgress(String(message || ''));
    for (const observer of attempt.observers) observer.onProgress?.(safeMessage);
  }

  private isActiveAttempt(attempt: CodexLoginAttempt): boolean {
    return (
      !attempt.cancelled &&
      attempt.id === this.loginAttemptId &&
      this.activeLoginAttempt === attempt
    );
  }

  private assertActiveAttempt(attempt: CodexLoginAttempt): void {
    if (this.isActiveAttempt(attempt)) return;
    throw new CodexCredentialError('cancelled', 'Codex sign-in was cancelled.');
  }

  private notifyTransition(kind: CodexCredentialTransitionKind): void {
    const transition: CodexCredentialTransition = {
      provider: CODEX_PROVIDER,
      kind,
      observedAt: this.now()
    };
    for (const listener of this.transitionListeners) {
      try {
        listener(transition);
      } catch {
        // Credential operations must not fail because an observer is unavailable.
      }
    }
  }
}
