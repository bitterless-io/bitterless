import { readFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, type Dispatcher } from 'undici';
import { configureCodexProxyDispatcher } from '../networking/outboundHttpDispatcher.service';

const CODEX_PROXY_NO_PROXY = '127.0.0.1,localhost,[::1]';

type CodexProxyErrorCode =
  | 'settings-unreadable'
  | 'settings-malformed'
  | 'settings-schema-invalid'
  | 'proxy-url-invalid'
  | 'dispatcher-install-failed';

type CodexProxyHostClass = 'ipv4-loopback' | 'localhost' | 'ipv6-loopback';

export interface CodexProxyConfiguration {
  httpProxy: string;
  scheme: 'http' | 'https';
  hostClass: CodexProxyHostClass;
  port: number;
}

export interface CodexProxyDispatcherOptions {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export interface CodexProxyServiceDependencies {
  readSettings?: (settingsPath: string) => Promise<string>;
  createDispatcher?: (options: CodexProxyDispatcherOptions) => Dispatcher;
  configureDispatcher?: (dispatcher: Dispatcher) => void;
  logger?: Pick<Console, 'info' | 'error'>;
}

export class CodexProxyConfigurationError extends Error {
  readonly code: CodexProxyErrorCode;

  constructor(code: CodexProxyErrorCode, message: string) {
    super(message);
    this.name = 'CodexProxyConfigurationError';
    this.code = code;
  }
}

const proxyError = (
  code: CodexProxyErrorCode,
  message: string
): CodexProxyConfigurationError => new CodexProxyConfigurationError(code, message);

const parseProxyUrl = (value: unknown): CodexProxyConfiguration => {
  if (typeof value !== 'string') {
    throw proxyError('proxy-url-invalid', 'Codex proxy URL is invalid.');
  }

  const match =
    /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{0,4})$/i.exec(value);
  if (!match) {
    throw proxyError('proxy-url-invalid', 'Codex proxy URL is invalid.');
  }

  const port = Number(match[3]);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw proxyError('proxy-url-invalid', 'Codex proxy URL is invalid.');
  }

  const scheme = match[1].toLowerCase() as CodexProxyConfiguration['scheme'];
  const host = match[2].toLowerCase();
  const hostClass: CodexProxyHostClass =
    host === '127.0.0.1'
      ? 'ipv4-loopback'
      : host === 'localhost'
        ? 'localhost'
        : 'ipv6-loopback';

  return {
    httpProxy: value,
    scheme,
    hostClass,
    port
  };
};

export const parseCodexProxySettings = (value: unknown): CodexProxyConfiguration => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw proxyError('settings-schema-invalid', 'Codex proxy settings schema is invalid.');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'httpProxy' ||
    keys[1] !== 'schemaVersion' ||
    record.schemaVersion !== 1
  ) {
    throw proxyError('settings-schema-invalid', 'Codex proxy settings schema is invalid.');
  }

  return parseProxyUrl(record.httpProxy);
};

const readCodexProxyConfiguration = async (
  readSettings: (settingsPath: string) => Promise<string>,
  settingsPath: string
): Promise<CodexProxyConfiguration | null> => {
  let source: string;
  try {
    source = await readSettings(settingsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw proxyError('settings-unreadable', 'Codex proxy settings could not be read.');
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw proxyError('settings-malformed', 'Codex proxy settings JSON is malformed.');
  }

  return parseCodexProxySettings(value);
};

export class CodexProxyService {
  private readonly readSettings: (settingsPath: string) => Promise<string>;
  private readonly createDispatcher: (options: CodexProxyDispatcherOptions) => Dispatcher;
  private readonly configureDispatcher: (dispatcher: Dispatcher) => void;
  private readonly logger: Pick<Console, 'info' | 'error'>;
  private setupPromise: Promise<void> | null = null;

  constructor(dependencies: CodexProxyServiceDependencies = {}) {
    this.readSettings =
      dependencies.readSettings ?? (async (path) => await readFile(path, 'utf8'));
    this.createDispatcher =
      dependencies.createDispatcher ?? ((options) => new EnvHttpProxyAgent(options));
    this.configureDispatcher =
      dependencies.configureDispatcher ?? configureCodexProxyDispatcher;
    this.logger = dependencies.logger ?? console;
  }

  private async install(settingsPath: string): Promise<void> {
    let configuration: CodexProxyConfiguration | null;
    try {
      configuration = await readCodexProxyConfiguration(this.readSettings, settingsPath);
    } catch (error) {
      const failure =
        error instanceof CodexProxyConfigurationError
          ? error
          : proxyError('settings-unreadable', 'Codex proxy settings could not be read.');
      this.logger.error(
        `[codex-proxy] stage=config-rejected reason=${failure.code} cause=name=${failure.name} message=${failure.message}`
      );
      throw failure;
    }

    if (!configuration) {
      this.logger.info('[codex-proxy] stage=not-configured source=file');
      return;
    }

    try {
      const dispatcher = this.createDispatcher({
        httpProxy: configuration.httpProxy,
        httpsProxy: configuration.httpProxy,
        noProxy: CODEX_PROXY_NO_PROXY
      });
      this.configureDispatcher(dispatcher);
    } catch {
      const failure = proxyError(
        'dispatcher-install-failed',
        'Codex proxy dispatcher could not be installed.'
      );
      this.logger.error(
        `[codex-proxy] stage=install-failed reason=${failure.code} cause=name=${failure.name} message=${failure.message}`
      );
      throw failure;
    }

    this.logger.info(
      `[codex-proxy] stage=configured source=file scheme=${configuration.scheme} host=${configuration.hostClass} port=${configuration.port}`
    );
  }

  ensure(settingsPath: string): Promise<void> {
    this.setupPromise ??= this.install(settingsPath);
    return this.setupPromise;
  }
}

const codexProxyService = new CodexProxyService();

export const ensureCodexProxyDispatcher = (settingsPath: string): Promise<void> =>
  codexProxyService.ensure(settingsPath);
