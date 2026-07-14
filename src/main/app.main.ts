import { app, net, session } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { packageMainHelper } from '../shared/packageHelper/main/package.helper';
import { pathMainHelper } from '../shared/pathHelper/main/pathMain.helper';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { connectorWindowHelper } from './windows/connectorWindow.helper';
import { initXpc } from './xpc/xpc.helper';
import { initDirectory } from './directoryHelper/directory.helper';
import { llamaWindowHelper } from './windows/llamaWindow.helper';
import { omniWindowHelper } from './windows/omniWindow.helper';
import { trayHelper } from './tray/tray.helper';
import { dialogHelper } from './dialog/dialog.helper';
import './xpc/app.handler';
import { updateService } from '@main/updateHelper/update.service';
import { mcpBridgeServer } from './mcp/mcpBridge.server';
import { startBitterlessMcpStdioServer } from './mcp/mcpStdio.helper';
import { coworkWindowHandler } from './xpc/coworkWindow.handler';
import { COWORK_PARTITION } from '@cowork-main/data/coworkDataRoot';

const isMcpHelperMode = process.argv.includes('--mcp-helper');
const isE2E = process.env.BITTERLESS_E2E === '1';

const configureE2EUserData = (): void => {
  if (!isE2E) return;
  if (app.isPackaged) {
    throw new Error('BITTERLESS_E2E is unavailable in packaged builds');
  }
  const userDataPath = process.env.BITTERLESS_E2E_USER_DATA_DIR?.trim();
  if (!userDataPath) {
    throw new Error('BITTERLESS_E2E_USER_DATA_DIR is required when BITTERLESS_E2E=1');
  }
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
};

configureE2EUserData();

const e2eMockOrigin = (): string => {
  const raw = process.env.BITTERLESS_E2E_MOCK_ORIGIN?.trim();
  if (!raw) throw new Error('BITTERLESS_E2E_MOCK_ORIGIN is required when BITTERLESS_E2E=1');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('BITTERLESS_E2E_MOCK_ORIGIN must be an HTTP loopback origin');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BITTERLESS_E2E_MOCK_ORIGIN must contain only a loopback origin');
  }
  return url.origin;
};

const installE2ENetworkGuard = (): void => {
  if (!isE2E) return;
  const mockOrigin = e2eMockOrigin();
  const deniedLog = join(app.getPath('userData'), 'e2e-network-denied.log');
  const authOrigins = new Set(['https://bl-test-api.terncloud.com', 'https://api.bitterless.io']);

  const deniedResponse = (request: Request): Response => {
    const url = new URL(request.url);
    appendFileSync(deniedLog, `${request.method} ${url.protocol}//${url.host}${url.pathname}\n`, 'utf8');
    return Response.error();
  };

  const mockResponse = async (path: string, request: Request): Promise<Response> =>
    await net.fetch(`${mockOrigin}${path}`, {
      method: request.method,
      bypassCustomProtocolHandlers: true
    });

  const defaultHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      url.protocol === 'https:' &&
      authOrigins.has(url.origin) &&
      !url.username &&
      !url.password &&
      url.pathname === '/auth/me' &&
      !url.search &&
      ['GET', 'OPTIONS'].includes(request.method)
    ) {
      return await mockResponse('/auth/me', request);
    }
    return deniedResponse(request);
  };

  const coworkHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      url.protocol === 'http:' &&
      url.origin === 'http://crms.micromeet.ai' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      request.method === 'GET'
    ) {
      return await mockResponse('/ai-crms', request);
    }
    return deniedResponse(request);
  };

  for (const scheme of ['http', 'https']) {
    session.defaultSession.protocol.handle(scheme, defaultHandler);
    session.fromPartition(COWORK_PARTITION).protocol.handle(scheme, coworkHandler);
  }
};

let isQuitting = false;
let hasShownQuitDialog = false;
let cleanupPromise: Promise<void> | null = null;

const redirectConsoleToStderr = (): void => {
  const write = (level: string, args: unknown[]): void => {
    process.stderr.write(`[${level}] ${args.map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ')}\n`);
  };

  console.log = (...args: unknown[]) => write('log', args);
  console.info = (...args: unknown[]) => write('info', args);
  console.warn = (...args: unknown[]) => write('warn', args);
  console.error = (...args: unknown[]) => write('error', args);
};

const cleanupResources = (): Promise<void> => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    try { console.log('[app] Cleaning up resources...'); } catch {}

    try { mcpBridgeServer.stop(); } catch {}
    try { await coworkWindowHandler.destroyForHostQuit(); } catch {}
    try { mainWindowHelper.destroy(); } catch {}
    try { sqliteWindowHelper.destroy(); } catch {}
    try { llamaWindowHelper.destroy(); } catch {}
    try { connectorWindowHelper.destroy(); } catch {}
    try { omniWindowHelper.destroy(); } catch {}
    try { trayHelper.destroy(); } catch {}

    try { console.log('[app] Cleanup complete'); } catch {}
  })();
  return cleanupPromise;
};

app.whenReady().then(async () => {
  if (isMcpHelperMode) {
    redirectConsoleToStderr();
    await startBitterlessMcpStdioServer();
    return;
  }

  installE2ENetworkGuard();
  electronApp.setAppUserModelId('com.electron');
  if (process.platform === 'darwin') {
    app.dock.setBadge('');
  }
  initXpc();

  packageMainHelper.init();
  pathMainHelper.init();
  initDirectory();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 先启动 SQLite 进程并等待其准备就绪
  const sqliteWindow = sqliteWindowHelper.create();
  await new Promise<void>((resolve) => {
    sqliteWindow.webContents.on('did-finish-load', () => {
      resolve();
    });
  });

  try {
    await mcpBridgeServer.start();
  } catch (err) {
    console.warn('[app] MCP bridge failed to start:', err);
  }

  // SQLite 进程准备就绪后，再启动主窗口和其他窗口
  // llamaWindowHelper.create();
  mainWindowHelper.create();
  // connectorWindowHelper.create();

  // 初始化系统托盘 (仅 Windows)
  trayHelper.init(mainWindowHelper);

  app.on('activate', () => {
    // macOS: 点击 dock 图标显示主窗口
    mainWindowHelper.show();
  });
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();

  if (isMcpHelperMode) {
    isQuitting = true;
    app.quit();
    return;
  }

  if (isE2E) {
    await cleanupResources();
    isQuitting = true;
    app.quit();
    return;
  }

  if (updateService.isUpdating) {
    await cleanupResources();
    isQuitting = true;
    updateService.installAfterCleanup();
    return;
  }

  if (process.platform === 'darwin' && !hasShownQuitDialog) {
    hasShownQuitDialog = true;

    const shouldQuit = await dialogHelper.showQuitConfirmDialog();
    if (shouldQuit) {
      await cleanupResources();
      isQuitting = true;
      app.quit();
    } else {
      hasShownQuitDialog = false;
    }
    return;
  }

  await cleanupResources();
  isQuitting = true;
  app.quit();
});

app.on('will-quit', () => {
  // 更新和正常退出均不干预，让系统正常退出
});

app.on('window-all-closed', () => {
  // 不自动退出，保留 tray 功能，由用户主动触发退出
});
