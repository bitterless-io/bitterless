import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CodexBrowserCallbackCapture } from './codexCallbackCapture';
import {
  CodexFileCredentialStore,
  CodexMemoryCredentialStore,
  type CodexCredentialStore
} from './codexCredential.store';

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
    },
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
  now?: () => number;
  browserTimeoutMs?: number;
  deviceTimeoutMs?: number;
  ensurePrivateDirectory?: (path: string) => void;
}

export class CodexCredentialError extends Error {
  constructor(
    readonly code: CodexCredentialErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CodexCredentialError';
  }
}

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
  }

  async getStatus(): Promise<CodexCredentialStatus> {
    const lastVerifiedAt = this.now();
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
      return {
        provider: CODEX_PROVIDER,
        connected,
        loginInProgress: this.activeLoginAttempt !== null,
        lastVerifiedAt
      };
    } catch {
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
      const login = this.performConnect(method, attempt);
      const tracked = login.finally(() => {
        if (this.loginPromise === tracked) this.loginPromise = null;
        if (this.activeLoginAttempt === attempt) this.activeLoginAttempt = null;
      });
      attempt.promise = tracked;
      this.loginPromise = tracked;
    } else {
      attempt.observers.add(observer);
    }

    return attempt.promise.finally(() => attempt.observers.delete(observer));
  }

  async cancelConnect(): Promise<void> {
    const attempt = this.activeLoginAttempt;
    if (!attempt) return;

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

    try {
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
      this.assertActiveAttempt(attempt);
      const modelRuntime = pi.ModelRuntime?.create
        ? await Promise.race([
            createPiModelRuntime(pi, authPath, modelsPath, attemptAuth),
            waitForAbort(attempt.controller.signal)
          ])
        : null;
      this.assertActiveAttempt(attempt);
      if (!modelRuntime && method === 'browser') {
        attempt.capture = await Promise.race([
          this.dependencies.createBrowserCallbackCapture(),
          waitForAbort(attempt.controller.signal)
        ]);
        this.assertActiveAttempt(attempt);
      }
      timer = setTimeout(() => {
        timedOut = true;
        const error = new CodexCredentialError('timeout', 'Codex sign-in timed out.');
        attempt.controller.abort(error);
        attempt.capture?.cancel(error);
      }, timeoutMs);

      const manualCodeInput = async (): Promise<string> => {
        this.assertActiveAttempt(attempt);
        const value = attempt.capture
          ? await attempt.capture.waitForRedirect()
          : await waitForAbort(attempt.controller.signal);
        this.assertActiveAttempt(attempt);
        return value;
      };
      const login = modelRuntime
        ? modelRuntime.login(CODEX_PROVIDER, 'oauth', {
            signal: attempt.controller.signal,
            prompt: async (prompt) => {
              if (prompt.type === 'select') return method;
              if (prompt.type === 'manual_code') {
                return await Promise.race([
                  waitForAbort(prompt.signal ?? attempt.controller.signal),
                  waitForAbort(attempt.controller.signal)
                ]);
              }
              return await waitForAbort(prompt.signal ?? attempt.controller.signal);
            },
            notify: (event) => {
              if (!this.isActiveAttempt(attempt)) return;
              if (event.type === 'auth_url' && event.url) this.openAuthUrl(event.url);
              if (event.type === 'device_code') this.notifyDeviceCode(attempt, event);
              if (event.type === 'progress' && event.message) {
                this.notifyProgress(attempt, event.message);
              }
              if (event.type === 'info' && event.message) {
                this.notifyProgress(attempt, event.message);
              }
            }
          })
        : this.loginWithLegacyStorage(attemptAuth, method, attempt, manualCodeInput);
      void login.catch(() => undefined);
      await Promise.race([login, waitForAbort(attempt.controller.signal)]);
      this.assertActiveAttempt(attempt);
      const credential = await attemptAuth.read(CODEX_PROVIDER);
      this.assertActiveAttempt(attempt);
      if (!credential) {
        throw new CodexCredentialError(
          'login-failed',
          'Codex sign-in did not create a usable credential.'
        );
      }
      attempt.promotedStore = persistentAuth;
      await Promise.race([
        persistentAuth.modify(CODEX_PROVIDER, async () => {
          this.assertActiveAttempt(attempt);
          return credential;
        }),
        waitForAbort(attempt.controller.signal)
      ]);
      this.assertActiveAttempt(attempt);
      const status = await Promise.race([
        this.getStatus(),
        waitForAbort(attempt.controller.signal)
      ]);
      this.assertActiveAttempt(attempt);
      if (!status.connected) {
        throw new CodexCredentialError(
          'login-failed',
          'Codex sign-in did not create a usable credential.'
        );
      }
      this.notifyTransition('login-succeeded');
      attempt.promotedStore = null;
      return status;
    } catch (error) {
      if (attempt.cancelled || attempt.id !== this.loginAttemptId) {
        throw new CodexCredentialError('cancelled', 'Codex sign-in was cancelled.');
      }
      if (timedOut) {
        throw new CodexCredentialError('timeout', 'Codex sign-in timed out.');
      }
      if (error instanceof CodexCredentialError) throw error;
      throw new CodexCredentialError('login-failed', 'Codex sign-in failed.');
    } finally {
      if (timer) clearTimeout(timer);
      attempt.controller.abort();
      if (attempt.capture) {
        const capture = attempt.capture;
        attempt.capture = null;
        await capture.close().catch(() => undefined);
      }
      if ((attempt.cancelled || attempt.id !== this.loginAttemptId) && attempt.promotedStore) {
        const promotedStore = attempt.promotedStore;
        attempt.promotedStore = null;
        await promotedStore.delete(CODEX_PROVIDER).catch(() => undefined);
      }
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
        if (this.isActiveAttempt(attempt)) this.openAuthUrl(url);
      },
      onManualCodeInput: manualCodeInput,
      onDeviceCode: (info) => this.notifyDeviceCode(attempt, info),
      onPrompt: async () => await waitForAbort(attempt.controller.signal),
      onProgress: (message) => this.notifyProgress(attempt, message),
      signal: attempt.controller.signal
    });
  }

  private openAuthUrl(url: string): void {
    const external = parseOpenAiExternalUrl(url);
    void this.dependencies.openExternal(external.href).catch(() => undefined);
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
    void this.dependencies.openExternal(external.href).catch(() => undefined);
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
