import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

export interface FakeProviderState {
  claude?: {
    mode?: 'success' | 'failed' | 'invalid-json' | 'unsupported';
    advertiseAll?: boolean;
    error?: string;
    entries?: unknown[];
  };
  codex?: {
    mode?: 'success' | 'failed' | 'invalid-json';
    error?: string;
    entries?: unknown[];
  };
}

export interface CodingAgentE2ESession {
  readonly app: ElectronApplication;
  readonly hostPage: Page;
  readonly tempRoot: string;
  readonly homeDir: string;
  readonly userDataDir: string;
  readonly projectDir: string;
  readonly providerStatePath: string;
  readonly launchEnv: NodeJS.ProcessEnv;
  readonly mockOrigin: string;
  readonly rendererErrors: string[];
  readonly mainOutput: string[];
  readonly unexpectedMockRequests: string[];
  deniedNetworkRequests: () => string[];
  setProviderState: (state: FakeProviderState) => void;
  request: <T>(method: string, params?: unknown) => Promise<T>;
  installOpenExternalProbe: (failureMessage?: string) => Promise<void>;
  openedExternalUrls: () => Promise<string[]>;
  restoreOpenExternal: () => Promise<void>;
  installOpenPathProbe: (failureMessage?: string) => Promise<void>;
  openedPaths: () => Promise<string[]>;
  restoreOpenPath: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<Page>;
}

interface MockServer {
  server: Server;
  origin: string;
  unexpected: string[];
}

interface CodingAgentFixtures {
  bitterless: CodingAgentE2ESession;
}

const projectRoot = resolve(__dirname, '..', '..', '..');
const mainEntry = join(projectRoot, 'out', 'main', 'app.main.js');
const providerFixture = join(__dirname, 'provider.fixture.mjs');

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const electronExecutablePath = (): string => {
  if (process.platform === 'darwin') {
    return join(
      projectRoot,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron'
    );
  }
  if (process.platform === 'win32') {
    return join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  }
  return join(projectRoot, 'node_modules', 'electron', 'dist', 'electron');
};

const assertLaunchPrerequisites = (): void => {
  const electronPath = electronExecutablePath();
  if (!existsSync(electronPath)) throw new Error(`Electron executable is missing: ${electronPath}`);
  if (!existsSync(mainEntry)) {
    throw new Error(`Built Electron main entry is missing: ${mainEntry}. Run yarn build first.`);
  }
};

const startMockServer = async (): Promise<MockServer> => {
  const unexpected: string[] = [];
  const server = createServer((request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const key = `${method} ${url.pathname}`;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS');

    if (url.pathname === '/auth/me' && method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (url.pathname === '/auth/me' && method === 'GET') {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          id: 9104,
          email: 'coding-agent-e2e@example.test',
          nickname: 'Coding Agent E2E',
          scope: 'customer',
          status: 'active',
          has_password: true,
          must_set_password: false
        })
      );
      return;
    }

    unexpected.push(key);
    response.statusCode = 500;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end(`Unexpected coding-agent E2E mock request: ${key}`);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    unexpected
  };
};

const closeMockServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
};

const writeProviderState = (path: string, value: FakeProviderState): void => {
  const state: FakeProviderState = {
    claude: { mode: 'success', advertiseAll: true, entries: [], ...value.claude },
    codex: { mode: 'success', entries: [], ...value.codex }
  };
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
};

const createProviderExecutables = (binDir: string): void => {
  mkdirSync(binDir, { recursive: true });
  for (const provider of ['claude', 'codex'] as const) {
    if (process.platform === 'win32') {
      const path = join(binDir, `${provider}.cmd`);
      if (process.execPath.includes('"') || providerFixture.includes('"')) {
        throw new Error('Windows provider fixture paths cannot contain double quotes');
      }
      writeFileSync(
        path,
        `@echo off\r\n"${process.execPath}" "${providerFixture}" ${provider} %*\r\n`,
        'utf8'
      );
    } else {
      const path = join(binDir, provider);
      writeFileSync(
        path,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(providerFixture)} ${provider} "$@"\n`,
        { encoding: 'utf8', mode: 0o700 }
      );
      chmodSync(path, 0o700);
    }
  }
};

const isolatedLaunchEnv = (paths: {
  homeDir: string;
  userDataDir: string;
  mockOrigin: string;
  providerStatePath: string;
  binDir: string;
}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  const allowedKeys = new Set([
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'CI'
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null && (allowedKeys.has(key) || key.startsWith('LC_'))) env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: 'production',
    PATH: `${paths.binDir}${delimiter}${env.PATH ?? ''}`,
    HOME: paths.homeDir,
    USERPROFILE: paths.homeDir,
    APPDATA: join(paths.homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(paths.homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(paths.homeDir, '.config'),
    XDG_DATA_HOME: join(paths.homeDir, '.local', 'share'),
    XDG_CACHE_HOME: join(paths.homeDir, '.cache'),
    MICROMEET_DIR: join(paths.homeDir, '.micromeet'),
    BITTERLESS_E2E: '1',
    BITTERLESS_E2E_HOME_DIR: paths.homeDir,
    BITTERLESS_E2E_USER_DATA_DIR: paths.userDataDir,
    BITTERLESS_E2E_MOCK_ORIGIN: paths.mockOrigin,
    BITTERLESS_E2E_PROVIDER_STATE: paths.providerStatePath,
    COACH_OPEN_DEVTOOLS: '0',
    COACH_WORKBENCH_DEVTOOLS: '0',
    COACH_DEVTOOLS: '0',
    COACH_DEMO_SMOKE_OUT: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
};

const pageMatchesHome = (page: Page): boolean =>
  /\/renderer\/home\/index\.html(?:$|[?#])/.test(page.url());

const waitForHomePage = async (
  app: ElectronApplication,
  diagnostics: () => string
): Promise<Page> => {
  const existing = app.windows().find(pageMatchesHome);
  if (existing) return existing;
  return await app
    .waitForEvent('window', {
      predicate: pageMatchesHome,
      timeout: 30_000
    })
    .catch(() => {
      throw new Error(
        `Timed out waiting for Home renderer. Open pages: ${app
          .windows()
          .map((page) => page.url())
          .join(', ')}\n${diagnostics()}`
      );
    });
};

const attachRendererDiagnostics = (page: Page, errors: string[]): void => {
  const prefix = (): string => page.url() || 'about:blank';
  page.on('pageerror', (error) =>
    errors.push(`[pageerror ${prefix()}] ${error.stack || error.message}`)
  );
  page.on('crash', () => errors.push(`[crash ${prefix()}]`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = prefix();
    const messageText = message.text();
    const isExpectedUnpackagedQdrantAbsence =
      /\/renderer\/sqlite\/index\.html(?:$|[?#])/.test(url) &&
      messageText.startsWith('[qdrant] failed to start: spawn ') &&
      messageText.endsWith('/external_resources/qdrant/qdrant ENOENT');
    const isExpectedDevToolsAutofillAbsence =
      url.startsWith('devtools://') &&
      (messageText.startsWith('Request Autofill.enable failed. ') ||
        messageText.startsWith('Request Autofill.setAddresses failed. ')) &&
      messageText.includes("wasn't found");
    if (!isExpectedUnpackagedQdrantAbsence && !isExpectedDevToolsAutofillAbsence) {
      errors.push(`[console ${url}] ${messageText}`);
    }
  });
};

class CodingAgentE2ESessionController implements CodingAgentE2ESession {
  private currentApp: ElectronApplication | null = null;
  private currentHostPage: Page | null = null;

  constructor(
    readonly tempRoot: string,
    readonly homeDir: string,
    readonly userDataDir: string,
    readonly projectDir: string,
    readonly providerStatePath: string,
    readonly launchEnv: NodeJS.ProcessEnv,
    readonly mockOrigin: string,
    readonly rendererErrors: string[],
    readonly mainOutput: string[],
    readonly unexpectedMockRequests: string[]
  ) {}

  get app(): ElectronApplication {
    if (!this.currentApp) throw new Error('Bitterless Electron app is not running');
    return this.currentApp;
  }

  get hostPage(): Page {
    if (!this.currentHostPage) throw new Error('Bitterless Home renderer is not running');
    return this.currentHostPage;
  }

  deniedNetworkRequests = (): string[] => {
    const deniedLog = join(this.userDataDir, 'e2e-network-denied.log');
    return existsSync(deniedLog) ? readFileSync(deniedLog, 'utf8').split('\n').filter(Boolean) : [];
  };

  setProviderState = (state: FakeProviderState): void => {
    writeProviderState(this.providerStatePath, state);
  };

  async launch(): Promise<Page> {
    if (this.currentApp) throw new Error('Bitterless Electron app is already running');
    const app = await electron.launch({
      executablePath: electronExecutablePath(),
      args: [projectRoot],
      env: this.launchEnv,
      timeout: 60_000
    });
    this.currentApp = app;
    for (const stream of [app.process().stdout, app.process().stderr]) {
      stream?.on('data', (chunk) => this.mainOutput.push(String(chunk)));
    }
    for (const page of app.windows()) attachRendererDiagnostics(page, this.rendererErrors);
    app.on('window', (page) => attachRendererDiagnostics(page, this.rendererErrors));
    const hostPage = await waitForHomePage(
      app,
      () =>
        `Renderer errors:\n${this.rendererErrors.join('\n') || '(none)'}\nMain output:\n${this.mainOutput.slice(-40).join('') || '(none)'}`
    );
    await hostPage.waitForLoadState('domcontentloaded');
    this.currentHostPage = hostPage;
    return hostPage;
  }

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    return await this.hostPage.evaluate(
      async ({ method, params, hasParams }) => {
        const xpcRenderer = (
          globalThis as typeof globalThis & {
            xpcRenderer: { send(channel: string, params?: unknown): Promise<unknown> };
          }
        ).xpcRenderer;
        const channel = `CodingAgentSessionXpcHandler/${method}`;
        return (
          hasParams ? await xpcRenderer.send(channel, params) : await xpcRenderer.send(channel)
        ) as T;
      },
      { method, params: params ?? null, hasParams: params !== undefined }
    );
  };

  installOpenExternalProbe = async (failureMessage?: string): Promise<void> => {
    await this.app.evaluate(({ shell }, message) => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOriginalOpenExternal?: typeof shell.openExternal;
        __codingAgentOpenedExternalUrls?: string[];
      };
      if (!state.__codingAgentOriginalOpenExternal) {
        state.__codingAgentOriginalOpenExternal = shell.openExternal;
      }
      state.__codingAgentOpenedExternalUrls = [];
      shell.openExternal = async (url: string): Promise<void> => {
        state.__codingAgentOpenedExternalUrls?.push(url);
        if (message) throw new Error(message);
      };
    }, failureMessage ?? null);
  };

  openedExternalUrls = async (): Promise<string[]> => {
    return await this.app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOpenedExternalUrls?: string[];
      };
      return [...(state.__codingAgentOpenedExternalUrls ?? [])];
    });
  };

  restoreOpenExternal = async (): Promise<void> => {
    if (!this.currentApp) return;
    await this.currentApp.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOriginalOpenExternal?: typeof shell.openExternal;
        __codingAgentOpenedExternalUrls?: string[];
      };
      if (state.__codingAgentOriginalOpenExternal) {
        shell.openExternal = state.__codingAgentOriginalOpenExternal;
      }
      delete state.__codingAgentOriginalOpenExternal;
      delete state.__codingAgentOpenedExternalUrls;
    });
  };

  installOpenPathProbe = async (failureMessage?: string): Promise<void> => {
    await this.app.evaluate(({ shell }, message) => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOriginalOpenPath?: typeof shell.openPath;
        __codingAgentOpenedPaths?: string[];
      };
      if (!state.__codingAgentOriginalOpenPath) {
        state.__codingAgentOriginalOpenPath = shell.openPath;
      }
      state.__codingAgentOpenedPaths = [];
      shell.openPath = async (path: string): Promise<string> => {
        state.__codingAgentOpenedPaths?.push(path);
        return message ?? '';
      };
    }, failureMessage ?? null);
  };

  openedPaths = async (): Promise<string[]> => {
    return await this.app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOpenedPaths?: string[];
      };
      return [...(state.__codingAgentOpenedPaths ?? [])];
    });
  };

  restoreOpenPath = async (): Promise<void> => {
    if (!this.currentApp) return;
    await this.currentApp.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        __codingAgentOriginalOpenPath?: typeof shell.openPath;
        __codingAgentOpenedPaths?: string[];
      };
      if (state.__codingAgentOriginalOpenPath) {
        shell.openPath = state.__codingAgentOriginalOpenPath;
      }
      delete state.__codingAgentOriginalOpenPath;
      delete state.__codingAgentOpenedPaths;
    });
  };

  stop = async (): Promise<void> => {
    const app = this.currentApp;
    this.currentApp = null;
    this.currentHostPage = null;
    if (!app) return;
    try {
      await app.evaluate(({ shell }) => {
        const state = globalThis as typeof globalThis & {
          __codingAgentOriginalOpenExternal?: typeof shell.openExternal;
          __codingAgentOpenedExternalUrls?: string[];
          __codingAgentOriginalOpenPath?: typeof shell.openPath;
          __codingAgentOpenedPaths?: string[];
        };
        if (state.__codingAgentOriginalOpenExternal) {
          shell.openExternal = state.__codingAgentOriginalOpenExternal;
        }
        if (state.__codingAgentOriginalOpenPath) {
          shell.openPath = state.__codingAgentOriginalOpenPath;
        }
        delete state.__codingAgentOriginalOpenExternal;
        delete state.__codingAgentOpenedExternalUrls;
        delete state.__codingAgentOriginalOpenPath;
        delete state.__codingAgentOpenedPaths;
      });
    } finally {
      await app.close();
    }
  };

  restart = async (): Promise<Page> => {
    await this.stop();
    return await this.launch();
  };
}

export const test = base.extend<CodingAgentFixtures>({
  // Playwright requires an object-destructuring first argument even when no built-in fixture is used.
  // eslint-disable-next-line no-empty-pattern
  bitterless: async ({}, use) => {
    assertLaunchPrerequisites();
    // macOS Unix-domain sockets have a short path limit. Keep the per-test userData identity
    // compact while retaining mkdtemp isolation; Windows uses a hashed named-pipe endpoint.
    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp';
    const tempRoot = mkdtempSync(join(tempBase, 'bl-ca-e2e-'));
    const homeDir = join(tempRoot, 'home');
    const userDataDir = join(tempRoot, 'user-data');
    const projectDir = join(tempRoot, 'workspace');
    const binDir = join(tempRoot, 'bin');
    const providerStatePath = join(tempRoot, 'providers.json');
    for (const path of [
      homeDir,
      userDataDir,
      projectDir,
      join(homeDir, 'AppData', 'Roaming'),
      join(homeDir, 'AppData', 'Local')
    ]) {
      mkdirSync(path, { recursive: true });
    }
    createProviderExecutables(binDir);
    writeProviderState(providerStatePath, {});

    const mock = await startMockServer();
    const rendererErrors: string[] = [];
    const mainOutput: string[] = [];
    const launchEnv = isolatedLaunchEnv({
      homeDir,
      userDataDir,
      mockOrigin: mock.origin,
      providerStatePath,
      binDir
    });
    const controller = new CodingAgentE2ESessionController(
      tempRoot,
      homeDir,
      userDataDir,
      projectDir,
      providerStatePath,
      launchEnv,
      mock.origin,
      rendererErrors,
      mainOutput,
      mock.unexpected
    );

    let fixtureError: unknown;
    try {
      await controller.launch();
      await use(controller);
    } catch (error) {
      fixtureError = error;
    }
    const cleanupErrors: unknown[] = [];
    try {
      await controller.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await closeMockServer(mock.server);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (fixtureError !== undefined) {
      if (cleanupErrors.length) {
        throw new AggregateError(
          [fixtureError, ...cleanupErrors],
          'Coding-agent E2E execution and cleanup failed'
        );
      }
      throw fixtureError;
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'Coding-agent E2E cleanup failed');
    }
  }
});

export { expect };
