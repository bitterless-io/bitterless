import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CodexBrowserCallbackCapture } from './codexCallbackCapture';

const CODEX_PROVIDER = 'openai-codex';
const CODEX_STATUS_MODEL = 'gpt-5.5';
const BROWSER_TIMEOUT_MS = 180_000;
const DEVICE_TIMEOUT_MS = 16 * 60_000;

export type CodexLoginMethod = 'browser' | 'device_code';
export type CodexCredentialErrorCode =
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

export interface CodexDeviceCodeNotice {
  userCode: string;
  verificationHost: string;
  expiresAt: number | null;
}

export interface CodexConnectObserver {
  onDeviceCode?: (notice: CodexDeviceCodeNotice) => void;
  onProgress?: (message: string) => void;
}

interface PiAuthStorage {
  login(
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
    },
  ): Promise<unknown>;
  logout(provider: string): void;
}

export interface PiAuthModule {
  AuthStorage: { create(path: string): PiAuthStorage };
  ModelRegistry: {
    create(
      authStorage: PiAuthStorage,
      modelsPath?: string,
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
  now?: () => number;
  browserTimeoutMs?: number;
  deviceTimeoutMs?: number;
  ensurePrivateDirectory?: (path: string) => void;
}

export class CodexCredentialError extends Error {
  constructor(
    readonly code: CodexCredentialErrorCode,
    message: string,
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

const waitForAbort = (signal: AbortSignal): Promise<string> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new CodexCredentialError('timeout', 'Codex sign-in timed out.')),
      { once: true },
    );
  });

export class CodexCredentialService {
  private readonly now: () => number;
  private readonly ensureDirectory: (path: string) => void;
  private readonly observers = new Set<CodexConnectObserver>();
  private loginPromise: Promise<CodexCredentialStatus> | null = null;

  constructor(private readonly dependencies: CodexCredentialServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.ensureDirectory = dependencies.ensurePrivateDirectory ?? ensurePrivateDirectory;
  }

  async getStatus(): Promise<CodexCredentialStatus> {
    const lastVerifiedAt = this.now();
    try {
      const pi = await this.dependencies.loadPiAuthModule();
      const auth = pi.AuthStorage.create(this.dependencies.authPath());
      const registry = pi.ModelRegistry.create(auth, this.dependencies.modelsPath());
      const model = registry.find(CODEX_PROVIDER, CODEX_STATUS_MODEL);
      return {
        provider: CODEX_PROVIDER,
        connected: Boolean(model && registry.hasConfiguredAuth(model)),
        loginInProgress: this.loginPromise !== null,
        lastVerifiedAt,
      };
    } catch {
      return {
        provider: CODEX_PROVIDER,
        connected: false,
        loginInProgress: this.loginPromise !== null,
        lastVerifiedAt,
        errorCode: 'status-unavailable',
      };
    }
  }

  connect(params: { method: CodexLoginMethod } & CodexConnectObserver): Promise<CodexCredentialStatus> {
    const method = parseLoginMethod(params?.method);
    const observer: CodexConnectObserver = {
      onDeviceCode: params?.onDeviceCode,
      onProgress: params?.onProgress,
    };
    this.observers.add(observer);

    if (!this.loginPromise) {
      const login = this.performConnect(method);
      const tracked = login.finally(() => {
        if (this.loginPromise === tracked) this.loginPromise = null;
      });
      this.loginPromise = tracked;
    }

    const active = this.loginPromise;
    return active.finally(() => this.observers.delete(observer));
  }

  async disconnect(): Promise<CodexCredentialStatus> {
    if (this.loginPromise) {
      throw new CodexCredentialError(
        'login-in-progress',
        'Finish the active Codex sign-in before disconnecting.',
      );
    }
    try {
      const pi = await this.dependencies.loadPiAuthModule();
      pi.AuthStorage.create(this.dependencies.authPath()).logout(CODEX_PROVIDER);
      return await this.getStatus();
    } catch {
      throw new CodexCredentialError('logout-failed', 'Codex could not be disconnected.');
    }
  }

  private async performConnect(method: CodexLoginMethod): Promise<CodexCredentialStatus> {
    const timeoutMs =
      method === 'device_code'
        ? (this.dependencies.deviceTimeoutMs ?? DEVICE_TIMEOUT_MS)
        : (this.dependencies.browserTimeoutMs ?? BROWSER_TIMEOUT_MS);
    const controller = new AbortController();
    let capture: CodexBrowserCallbackCapture | null = null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const pi = await this.dependencies.loadPiAuthModule();
      const authPath = this.dependencies.authPath();
      this.ensureDirectory(dirname(authPath));
      const auth = pi.AuthStorage.create(authPath);
      if (method === 'browser') {
        capture = await this.dependencies.createBrowserCallbackCapture();
      }
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        capture?.cancel(new CodexCredentialError('timeout', 'Codex sign-in timed out.'));
      }, timeoutMs);

      await auth.login(CODEX_PROVIDER, {
        onSelect: async () => method,
        onAuth: ({ url }) => {
          const external = parseOpenAiExternalUrl(url);
          void this.dependencies.openExternal(external.href).catch(() => undefined);
        },
        onManualCodeInput: async () =>
          capture ? await capture.waitForRedirect() : await waitForAbort(controller.signal),
        onDeviceCode: (info) => {
          const external = parseOpenAiExternalUrl(info.verificationUri);
          void this.dependencies.openExternal(external.href).catch(() => undefined);
          const userCode = String(info.userCode || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
          const expiresAt = Number.isFinite(info.expiresInSeconds)
            ? this.now() + Number(info.expiresInSeconds) * 1000
            : null;
          for (const observer of this.observers) {
            observer.onDeviceCode?.({
              userCode,
              verificationHost: external.host,
              expiresAt,
            });
          }
        },
        onPrompt: async () => await waitForAbort(controller.signal),
        onProgress: (message) => {
          const safeMessage = sanitizeProgress(String(message || ''));
          for (const observer of this.observers) observer.onProgress?.(safeMessage);
        },
        signal: controller.signal,
      });
      const status = await this.getStatus();
      if (!status.connected) {
        throw new CodexCredentialError('login-failed', 'Codex sign-in did not create a usable credential.');
      }
      return status;
    } catch (error) {
      if (timedOut) {
        throw new CodexCredentialError('timeout', 'Codex sign-in timed out.');
      }
      if (error instanceof CodexCredentialError) throw error;
      throw new CodexCredentialError('login-failed', 'Codex sign-in failed.');
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      if (capture) await capture.close().catch(() => undefined);
    }
  }
}
