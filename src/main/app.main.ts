import { app, net, session } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import { packageMainHelper } from '../shared/packageHelper/main/package.helper';
import { pathMainHelper } from '../shared/pathHelper/main/pathMain.helper';
import { mainWindowHelper } from './windows/mainWindow.helper';
import { sqliteWindowHelper } from './windows/sqliteWindow.helper';
import { connectorWindowHelper } from './windows/connectorWindow.helper';
import { initDirectory } from './directoryHelper/directory.helper';
import { llamaWindowHelper } from './windows/llamaWindow.helper';
import { omniWindowHelper } from './windows/omniWindow.helper';
import { trayHelper } from './tray/tray.helper';
import { dialogHelper } from './dialog/dialog.helper';
import './xpc/app.handler';
import { updateService } from '@main/updateHelper/update.service';
import { mcpBridgeServer } from './mcp/mcpBridge.server';
import { startBitterlessMcpStdioServer } from './mcp/mcpStdio.helper';
import {
  OptionalStartupLifecycle,
  type OptionalStartupStageGuard,
} from './mcp/optionalStartupLifecycle.service';
import { mcpHandler } from './xpc/mcp.handler';
import { coinWindowHandler } from './xpc/coinWindow.handler';
import { maestroWindowHandler } from './xpc/maestroWindow.handler';
import { eyesOnAgentsWindowHandler } from './xpc/eyesOnAgentsWindow.handler';
import { todoWindowHandler } from './xpc/todoWindow.handler';
import { todoistSyncSession } from './todoistSync/todoistSync.session';
import { pluginTestHandler } from './xpc/pluginTest.handler';
import { applicationLanguageService } from './i18n/applicationLanguage.service';
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot';
import {
  CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT,
  MCP_BRIDGE_PATH_ARG,
  parseMcpBridgeEndpointArg,
  type CoreSqliteBootApi,
  type CoreSqliteTargetPreloadRegistration,
} from '@shared/mcp/mcpBridge.shared';
import { runSqliteFirstGuiStartup } from './startup/guiStartup.service';
import { startupDiagnosticsService } from './startup/startupDiagnostics.service';
import type { StartupDiagnosticStage } from '@shared/startup/startupDiagnostics';

const isMcpHelperMode = process.argv.includes('--mcp-helper');
const isLegacyCodingAgentHookHelperMode = process.argv.includes('--coding-agent-hook-helper');
const isHelperMode = isMcpHelperMode || isLegacyCodingAgentHookHelperMode;
const isE2E = process.env.BITTERLESS_E2E === '1';
const coreSqliteBoot = createXpcMainEmitter<CoreSqliteBootApi>('CoreSqliteBootDao');

if (isHelperMode && process.platform === 'darwin') {
  app.setActivationPolicy('prohibited');
}

interface CoreSqliteTargetRegistrationWaiter {
  promise: Promise<string>;
  guardCoreReady<T>(operation: Promise<T>): Promise<T>;
  observeWindow(window: Electron.BrowserWindow): void;
  dispose(): void;
}

const createCoreSqliteTargetRegistrationWaiter = (): CoreSqliteTargetRegistrationWaiter => {
  let resolveRegistration: ((targetId: string) => void) | null = null;
  let rejectRegistration: ((err: Error) => void) | null = null;
  let rejectInvalidation: ((err: Error) => void) | null = null;
  let invalidationError: Error | null = null;
  let observedWindow: Electron.BrowserWindow | null = null;
  let registeredTargetId: string | null = null;
  let isDisposed = false;

  const cleanup = (): void => {
    if (!observedWindow) return;
    observedWindow.webContents.removeListener('did-fail-load', onFailedLoad);
    observedWindow.webContents.removeListener('preload-error', onPreloadError);
    observedWindow.webContents.removeListener('render-process-gone', onRenderProcessGone);
    observedWindow.webContents.removeListener('destroyed', onDestroyed);
    observedWindow.webContents.removeListener('did-start-navigation', onStartedNavigation);
    observedWindow.removeListener('closed', onClosed);
    observedWindow = null;
  };
  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    cleanup();
  };
  const fail = (err: Error): void => {
    if (isDisposed) return;
    dispose();
    if (!registeredTargetId) {
      rejectRegistration?.(err);
    } else if (rejectInvalidation) {
      rejectInvalidation(err);
    } else {
      invalidationError = err;
    }
  };
  const resolve = (payload: { params?: unknown }): void => {
    if (isDisposed || registeredTargetId) return;
    const registration = payload.params as Partial<CoreSqliteTargetPreloadRegistration> | undefined;
    const targetId = registration?.targetId;
    if (typeof targetId !== 'string' || !targetId.trim()) {
      fail(new Error('[sqlite] target preload registration has no targetId'));
      return;
    }
    registeredTargetId = targetId;
    console.log(`[app] Core SQLite target preload registered: ${registeredTargetId}`);
    resolveRegistration?.(registeredTargetId);
  };
  const onFailedLoad = (
    _event: Electron.Event,
    code: number,
    description: string,
    _url: string,
    isMainFrame: boolean,
  ): void => {
    if (isMainFrame) fail(new Error(`[sqlite] hidden window failed to load: ${code} ${description}`));
  };
  const onRenderProcessGone = (
    _event: Electron.Event,
    details: Electron.RenderProcessGoneDetails,
  ): void => {
    fail(new Error(`[sqlite] hidden renderer exited: ${details.reason}`));
  };
  const onPreloadError = (
    _event: Electron.Event,
    preloadPath: string,
    error: Error,
  ): void => {
    fail(new Error(`[sqlite] preload error in ${preloadPath}: ${error.message}`));
  };
  const onDestroyed = (): void => {
    fail(new Error('[sqlite] hidden webContents destroyed during Core SQLite startup'));
  };
  const onClosed = (): void => {
    fail(new Error('[sqlite] hidden window closed during Core SQLite startup'));
  };
  const onStartedNavigation = (
    _event: Electron.Event,
    url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ): void => {
    if (registeredTargetId && isMainFrame && !isInPlace) {
      fail(new Error(`[sqlite] hidden window navigated during Core SQLite startup: ${url}`));
    }
  };

  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveRegistration = resolvePromise;
    rejectRegistration = rejectPromise;
  });
  xpcMain.subscribe(CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT, resolve);

  return {
    promise,
    guardCoreReady: async (operation) => {
      if (invalidationError) throw invalidationError;
      const invalidationPromise = new Promise<never>((_resolve, rejectPromise) => {
        rejectInvalidation = rejectPromise;
      });
      return await Promise.race([operation, invalidationPromise]);
    },
    observeWindow: (window) => {
      if (isDisposed) return;
      observedWindow = window;
      window.webContents.on('did-fail-load', onFailedLoad);
      window.webContents.once('preload-error', onPreloadError);
      window.webContents.once('render-process-gone', onRenderProcessGone);
      window.webContents.once('destroyed', onDestroyed);
      window.webContents.on('did-start-navigation', onStartedNavigation);
      window.once('closed', onClosed);
    },
    dispose,
  };
};

const configureE2EUserData = (): void => {
  if (isHelperMode) return;
  if (!isE2E) return;
  if (app.isPackaged) {
    throw new Error('BITTERLESS_E2E is unavailable in packaged builds');
  }
  const userDataPath = process.env.BITTERLESS_E2E_USER_DATA_DIR?.trim();
  if (!userDataPath) {
    throw new Error('BITTERLESS_E2E_USER_DATA_DIR is required when BITTERLESS_E2E=1');
  }
  const homePath = process.env.BITTERLESS_E2E_HOME_DIR?.trim();
  if (!homePath) {
    throw new Error('BITTERLESS_E2E_HOME_DIR is required when BITTERLESS_E2E=1');
  }
  mkdirSync(homePath, { recursive: true });
  app.setPath('home', homePath);
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
};

configureE2EUserData();

const hasSingleInstanceLock = isHelperMode || app.requestSingleInstanceLock();

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
  const authOrigins = new Set([
    'https://bl-test-api.terncloud.com',
    'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run',
  ]);

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

  const maestroHandler = async (request: Request): Promise<Response> => {
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
    session.fromPartition(MAESTRO_PARTITION).protocol.handle(scheme, maestroHandler);
  }
};

let isQuitting = false;
let hasShownQuitDialog = false;
let isShutdownStarted = false;
let cleanupPromise: Promise<void> | null = null;
let stopEyesOnAgentsRuntime: (() => Promise<void>) | null = null;
const optionalIntegrationsLifecycle = new OptionalStartupLifecycle();

const initializeApplicationLanguageFallback = (): void => {
  const systemLocale = app.isReady()
    ? app.getPreferredSystemLanguages()[0]
    : 'en';
  applicationLanguageService.initializeFallback(systemLocale);
};

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
  isShutdownStarted = true;
  cleanupPromise = (async () => {
    try { console.log('[app] Cleaning up resources...'); } catch {}

    try { await optionalIntegrationsLifecycle.fenceAndJoin(); } catch {
      // Startup errors are logged at their source; cleanup still owns every initialized resource.
    }
    try { await stopEyesOnAgentsRuntime?.(); } catch {
      // Best-effort shutdown: the remaining application resources must still be released.
    }
    try { await mcpBridgeServer.stop(); } catch {}
    try { await todoistSyncSession.deactivate(); } catch {}
    try { await coinWindowHandler.destroyForHostQuit(); } catch {}
    try { await maestroWindowHandler.destroyForHostQuit(); } catch {}
    try { await eyesOnAgentsWindowHandler.destroyForHostQuit(); } catch {}
    try { await todoWindowHandler.destroyForHostQuit(); } catch {}
    try { await pluginTestHandler.destroyForHostQuit(); } catch {}
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

const runLegacyMcpHelper = async (): Promise<void> => {
  redirectConsoleToStderr();
  try {
    const endpoint = parseMcpBridgeEndpointArg(process.argv);
    if (!endpoint) throw new Error(`${MCP_BRIDGE_PATH_ARG} is required`);
    await startBitterlessMcpStdioServer(endpoint);
    app.exit(0);
  } catch (err) {
    console.error(`[bitterless-mcp] invalid ${MCP_BRIDGE_PATH_ARG}:`, err);
    app.exit(2);
  }
};

const runDiagnosedStartupStage = async (
  stage: StartupDiagnosticStage,
  operation: () => Promise<void> | void,
): Promise<void> => {
  try {
    await operation();
    startupDiagnosticsService.clear(stage);
  } catch (err) {
    startupDiagnosticsService.report(stage, err);
    console.warn(`[app] ${stage} startup failed:`, err);
  }
};

const startCoreSqliteRenderer = (): Promise<{ ok: boolean; error?: string }> => {
  const registration = createCoreSqliteTargetRegistrationWaiter();
  try {
    sqliteWindowHelper.create((window) => {
      registration.observeWindow(window);
    });
  } catch (err) {
    registration.dispose();
    return Promise.reject(err);
  }

  return registration.promise
    .then(async (targetId) => {
      const result = await registration.guardCoreReady(coreSqliteBoot.ready({ targetId }));
      if (result?.ok) console.log(`[app] Core SQLite ready: ${targetId}`);
      return result;
    })
    .finally(() => registration.dispose());
};

const startGui = async (): Promise<void> => {
  await runSqliteFirstGuiStartup({
    initializeCorePrerequisites: async () => {
      const { initXpc } = await import('./xpc/xpc.helper');
      if (isShutdownStarted) return;
      initXpc();
      packageMainHelper.init();
      pathMainHelper.init();
      initDirectory();
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window);
      });
    },
    startCoreSqlite: () => startCoreSqliteRenderer(),
    initializeLanguageFallback: () => {
      initializeApplicationLanguageFallback();
    },
    initializeForegroundRuntime: () => {
      installE2ENetworkGuard();
      electronApp.setAppUserModelId('com.electron');
      if (process.platform === 'darwin') app.dock.setBadge('');
    },
    createHome: () => {
      mainWindowHelper.create({ canCreate: () => !isShutdownStarted });
    },
    refreshMcpShim: async () => {
      await runDiagnosedStartupStage('mcp-shim', async () => {
        await mcpHandler.ensureShim();
      });
    },
    initializeTray: async () => {
      await runDiagnosedStartupStage('tray', () => {
        trayHelper.init(mainWindowHelper);
        app.on('activate', () => {
          mainWindowHelper.show();
        });
      });
    },
    handleCoreSqliteReady: () => {
      startupDiagnosticsService.clear('core-sqlite');
      void runDiagnosedStartupStage('application-language', async () => {
        await applicationLanguageService.initialize();
      });
      void runDiagnosedStartupStage('window-layout', async () => {
        await mainWindowHelper.hydratePersistedLayout();
      });
      void optionalIntegrationsLifecycle.start((canStartNextStage) =>
        startOptionalIntegrations(canStartNextStage)
      ).catch((err: unknown) => {
        console.warn('[app] Optional integrations disabled:', err);
      });
    },
    handleCoreSqliteFailure: (err) => {
      startupDiagnosticsService.report('core-sqlite', err);
      console.warn('[app] Core SQLite unavailable; continuing foreground startup:', err);
    },
    shouldStop: () => isShutdownStarted,
  });
};

const startOptionalIntegrations = async (
  canStartNextStage: OptionalStartupStageGuard,
): Promise<void> => {
  if (!canStartNextStage()) return;

  await runDiagnosedStartupStage('mcp-bridge', async () => {
    await mcpBridgeServer.start();
  });
  if (!canStartNextStage()) return;

  await runDiagnosedStartupStage('eyes-on-agents', async () => {
    const eyesOnAgentsRuntime = await import('./xpc/eyesOnAgents.handler');
    if (!canStartNextStage()) return;
    stopEyesOnAgentsRuntime = eyesOnAgentsRuntime.stopEyesOnAgentsRuntime;
    await eyesOnAgentsRuntime.startEyesOnAgentsRuntime();
  });
};

if (isLegacyCodingAgentHookHelperMode) {
  process.stderr.write(
    '[bitterless] legacy Codex hook helper is no longer supported; restart Bitterless to refresh it\n',
  );
  app.exit(2);
} else if (isMcpHelperMode) {
  void app.whenReady().then(runLegacyMcpHelper).catch((err: unknown) => {
    console.error('[bitterless-mcp] legacy helper startup failed:', err);
    app.exit(2);
  });
} else if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    mainWindowHelper.show();
  });
  void app.whenReady().then(startGui).catch((err: unknown) => {
    console.error('[app] GUI startup failed:', err);
  });
}

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();

  if (isHelperMode) {
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
    initializeApplicationLanguageFallback();
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
