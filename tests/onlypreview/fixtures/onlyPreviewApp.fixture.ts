import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildBitterlessE2ELaunchArgs } from '../../e2e/electronLaunchArgs';
import { createOnlyPreviewFixtures, type OnlyPreviewFixtureSet } from './createOnlyPreviewFixtures';

const projectRoot = resolve(__dirname, '..', '..', '..');
const mainEntry = join(projectRoot, 'out', 'main', 'app.main.js');

const electronExecutablePath = (): string => {
  if (process.platform === 'darwin') {
    return join(projectRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  }
  if (process.platform === 'win32') {
    return join(projectRoot, 'node_modules/electron/dist/electron.exe');
  }
  return join(projectRoot, 'node_modules/electron/dist/electron');
};

const startMockServer = async (): Promise<{ server: Server; origin: string }> => {
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.url === '/auth/me') {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          id: 1,
          email: 'onlypreview-e2e@example.test',
          nickname: 'OnlyPreview E2E',
          scope: 'customer',
          status: 'active',
          has_password: true,
          must_set_password: false
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
};

const waitForProcessExit = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
};

const isolatedEnv = (params: {
  homeDir: string;
  userDataDir: string;
  mockOrigin: string;
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
    HOME: params.homeDir,
    USERPROFILE: params.homeDir,
    APPDATA: join(params.homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(params.homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(params.homeDir, '.config'),
    XDG_DATA_HOME: join(params.homeDir, '.local/share'),
    XDG_CACHE_HOME: join(params.homeDir, '.cache'),
    MICROMEET_DIR: join(params.homeDir, '.micromeet'),
    BITTERLESS_E2E: '1',
    BITTERLESS_E2E_HOME_DIR: params.homeDir,
    BITTERLESS_E2E_USER_DATA_DIR: params.userDataDir,
    BITTERLESS_E2E_MOCK_ORIGIN: params.mockOrigin,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
};

export type OnlyPreviewRendererMode = 'shell' | 'previewHeader' | 'preview';

export interface OnlyPreviewE2ESession {
  app: ElectronApplication;
  fixtures: OnlyPreviewFixtureSet;
  tempRoot: string;
  output: string[];
  evaluateRenderer<T>(mode: OnlyPreviewRendererMode, expression: string): Promise<T>;
  sendInput(mode: OnlyPreviewRendererMode, input: Electron.InputEvent): Promise<void>;
  sendInputs(mode: OnlyPreviewRendererMode, inputs: Electron.InputEvent[]): Promise<void>;
}

interface OnlyPreviewFixtures {
  onlyPreview: OnlyPreviewE2ESession;
}

export const test = base.extend<OnlyPreviewFixtures>({
  // Playwright requires a destructured first fixture argument even when this worker owns no inputs.
  // eslint-disable-next-line no-empty-pattern
  onlyPreview: async ({}, use) => {
    const executablePath = electronExecutablePath();
    if (!existsSync(executablePath)) throw new Error(`Electron is missing: ${executablePath}`);
    if (!existsSync(mainEntry)) throw new Error(`Build is missing: ${mainEntry}. Run yarn build.`);
    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp';
    const tempRoot = mkdtempSync(join(tempBase, 'bl-onlypreview-'));
    const homeDir = join(tempRoot, 'home');
    const userDataDir = join(tempRoot, 'user-data');
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(join(homeDir, 'AppData/Roaming'), { recursive: true });
    mkdirSync(join(homeDir, 'AppData/Local'), { recursive: true });
    const fixtures = createOnlyPreviewFixtures(join(tempRoot, 'fixtures'));
    const mock = await startMockServer();
    const output: string[] = [];
    let app: ElectronApplication | null = null;
    try {
      app = await electron.launch({
        executablePath,
        args: buildBitterlessE2ELaunchArgs({
          platform: process.platform,
          applicationPath: projectRoot,
          applicationArguments: [`--onlypreview-open=${fixtures.root}`]
        }),
        env: isolatedEnv({
          homeDir,
          userDataDir,
          mockOrigin: mock.origin
        }),
        timeout: 60_000
      });
      for (const stream of [app.process().stdout, app.process().stderr]) {
        stream?.on('data', (chunk) => output.push(String(chunk)));
      }
      const instrumentedPages = new WeakSet<Page>();
      const captureRendererDiagnostics = (page: Page): void => {
        if (instrumentedPages.has(page)) return;
        instrumentedPages.add(page);
        const identify = () => page.url() || '<renderer without URL>';
        page.on('pageerror', (error) => {
          output.push(`[renderer pageerror] ${identify()}\n${error.stack ?? error.message}\n`);
        });
        page.on('console', (message) => {
          if (message.type() !== 'error' && message.type() !== 'warning') return;
          output.push(`[renderer ${message.type()}] ${identify()}\n${message.text()}\n`);
        });
        page.on('crash', () => output.push(`[renderer crash] ${identify()}\n`));
      };
      for (const page of app.windows()) captureRendererDiagnostics(page);
      app.on('window', captureRendererDiagnostics);
      try {
        await expect
          .poll(
            async () =>
              await app!.evaluate(
                ({ BaseWindow }) =>
                  BaseWindow.getAllWindows().filter((window) => window.getTitle() === 'OnlyPreview')
                    .length
              ),
            { timeout: 60_000 }
          )
          .toBe(1);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`OnlyPreview did not open.\n${output.slice(-40).join('')}\n${detail}`);
      }
      const evaluateRenderer = async <T>(
        mode: OnlyPreviewRendererMode,
        expression: string
      ): Promise<T> =>
        (await app!.evaluate(
          async ({ BaseWindow }, args) => {
            const window = BaseWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'OnlyPreview'
            );
            const view = window?.contentView.children.find((candidate) =>
              new RegExp(`/onlypreview/${args.mode}/index\\.html(?:$|[?#])`).test(
                candidate.webContents.getURL()
              )
            );
            if (!view) throw new Error(`OnlyPreview ${args.mode} view is unavailable`);
            return await view.webContents.executeJavaScript(args.expression, true);
          },
          { mode, expression }
        )) as T;

      const sendInputs = async (
        mode: OnlyPreviewRendererMode,
        inputs: Electron.InputEvent[]
      ): Promise<void> => {
        await app!.evaluate(
          ({ BaseWindow }, args) => {
            const window = BaseWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'OnlyPreview'
            );
            const view = window?.contentView.children.find((candidate) =>
              new RegExp(`/onlypreview/${args.mode}/index\\.html(?:$|[?#])`).test(
                candidate.webContents.getURL()
              )
            );
            if (!view) throw new Error(`OnlyPreview ${args.mode} view is unavailable`);
            view.webContents.focus();
            for (const input of args.inputs) view.webContents.sendInputEvent(input);
          },
          { mode, inputs }
        );
      };
      const sendInput = async (
        mode: OnlyPreviewRendererMode,
        input: Electron.InputEvent
      ): Promise<void> => await sendInputs(mode, [input]);

      await use({
        app,
        fixtures,
        tempRoot,
        output,
        evaluateRenderer,
        sendInput,
        sendInputs
      });
    } finally {
      const errors: unknown[] = [];
      if (app) {
        const child = app.process();
        try {
          let closed = false;
          const closeAttempt = app.close().then(
            () => {
              closed = true;
            },
            (error) => {
              errors.push(error);
            }
          );
          let closeTimeout: ReturnType<typeof setTimeout> | null = null;
          await Promise.race([
            closeAttempt,
            new Promise<void>((resolveTimeout) => {
              closeTimeout = setTimeout(resolveTimeout, 10_000);
            })
          ]);
          if (closeTimeout) clearTimeout(closeTimeout);
          if (!closed && child.exitCode === null && child.signalCode === null) {
            output.push(
              'Electron did not close within 10 seconds; force-terminating the isolated E2E process.\n'
            );
            child.kill('SIGKILL');
          }
          if (!(await waitForProcessExit(child, 5_000))) {
            errors.push(new Error(`Electron process ${child.pid ?? 'unknown'} did not exit`));
          }
        } catch (error) {
          errors.push(error);
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await waitForProcessExit(child, 5_000);
        }
      }
      try {
        await closeServer(mock.server);
      } catch (error) {
        errors.push(error);
      }
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) output.push(`OnlyPreview E2E cleanup failed: ${String(errors[0])}`);
    }
  }
});

export { expect };
