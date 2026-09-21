import { runtimeProfile } from '@main/environment/runtimeProfile.bootstrap';
import { assertAuthE2EProfile, isAllowedAuthE2ERequest } from '@shared/auth/authE2E.contract';
import { ensureDefaultWorkspace } from '@maestro-main/files/defaultWorkspace';
import { ensureWorkflowsRoot } from '@main/workflowLibrary/workflowsRoot';
import { ensureAppData } from '@main/paths/appData';
import { startWorkflowLibrary } from '@main/xpc/workflowLibrary.handler';
import { app, net, session } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { optimizer } from '@electron-toolkit/utils';
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
import {
  startEyesOnAgentsRuntime,
  stopEyesOnAgentsRuntime as stopEyesOnAgentsRuntimeImpl,
} from './xpc/eyesOnAgents.handler';
import { configureMaestroPiAgentDir } from '@maestro-main/llm/llmPaths';
import { setModelIoRoot } from '@main/agent/runtime/modelIoLog';
import { submodulesWindowHandler } from './xpc/submodulesWindow.handler';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';
import { todoWindowHandler } from './xpc/todoWindow.handler';
import { pluginTestHandler } from './xpc/pluginTest.handler';
import { applicationLanguageService } from './i18n/applicationLanguage.service';
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot';
import {
  MCP_BRIDGE_PATH_ARG,
  parseMcpBridgeEndpointArg,
  type CoreSqliteBootApi,
  type CoreSqliteTargetPreloadRegistration,
} from '@shared/mcp/mcpBridge.shared';
import { CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT } from '@shared/sqlite/coreSqliteRuntime.shared';
import { runSqliteFirstGuiStartup } from './startup/guiStartup.service';
import { startupDiagnosticsService } from './startup/startupDiagnostics.service';
import { reloadCoreSqliteRuntime } from './startup/coreSqliteRuntimeRecovery.service';
import type { StartupDiagnosticStage } from '@shared/startup/startupDiagnostics';
import type { TodoistSyncSessionApi } from '@shared/todoistSync/todoistSync.type';
import {
  createBoundedTodoXpcClient,
  withTodoXpcTimeout,
} from '@shared/todoistSync/todoXpcCall.shared';
import { initializeApplicationLogging } from '@main/logging/log.setup';
import { startMainHealthMonitor } from '@main/logging/mainHealth.service';
import { installRemoteDebugging } from '@main/diagnostics/remoteDebugging';
import { installApplicationFindMenu } from '@main/menu/applicationFindMenu.service';
import {
  installOnlyPreviewProtocol,
  registerOnlyPreviewScheme,
  uninstallOnlyPreviewProtocol,
} from '@main/miniapps/onlypreview/onlyPreviewProtocol.service';
import { registerOnlyPreviewCoworkTab } from '@main/windows/onlyPreviewCoworkTab';
import { setOnlyPreviewShuttingDown } from '@main/windows/onlyPreviewWindow.helper';
import { registerTrenchCoworkTab } from '@main/windows/trenchCoworkTab';
import { registerZellijCoworkTab } from '@main/windows/zellijCoworkTab';
import { openOnlyPreviewOsTarget, registerOnlyPreviewMaestroOpener } from '@main/windows/onlyPreviewMaestroOpener';
import {
  OnlyPreviewOpenQueue,
  resolveOnlyPreviewOpenTargets,
} from '@main/miniapps/onlypreview/onlyPreviewOpenRouter.service';
import {
  destroyOnlyPreviewForHostQuit,
  openOnlyPreviewAbsoluteTarget,
} from './xpc/onlyPreview.handler';
import { onlyPreviewSettingsService } from './miniapps/onlypreview/onlyPreviewSettings.service';
import { hydrateOnlyPreviewHostMount } from './miniapps/onlypreview/onlyPreviewHostMount.service';
import { onlyPreviewRecentDirectoryService } from './miniapps/onlypreview/onlyPreviewRecentDirectory.service';
import { onlyPreviewRecentsService } from './miniapps/onlypreview/onlyPreviewRecents.runtime';
import { onlyPreviewBookmarksService } from './miniapps/onlypreview/onlyPreviewBookmarks.runtime';
import { trenchIoWindowService } from './trench/trenchIoWindow.service';
import { registerTrenchGmgnIpc } from './coin/coinIpc.service';
import { coinResourceService } from './coin/resources/coinResource.runtime';
import { registerSnipingIpc } from './sniping/snipingIpc.service';
import { snipingSessionService } from './sniping/snipingSession.service';
import { registerMonitoringIpc } from './monitoring/monitoringIpc.service';

const isMcpHelperMode = process.argv.includes('--mcp-helper');
const isLegacyCodingAgentHookHelperMode = process.argv.includes('--coding-agent-hook-helper');
const isHelperMode = isMcpHelperMode || isLegacyCodingAgentHookHelperMode;
const isE2E = process.env.BITTERLESS_E2E === '1';
const isAuthOnlyE2E = isE2E && process.env.BITTERLESS_AUTH_E2E === '1';
if (isAuthOnlyE2E) assertAuthE2EProfile({
  packaged: app.isPackaged,
  mode: import.meta.env.VITE_MODE,
  env: import.meta.env.VITE_ENV,
  coreOrigin: import.meta.env.VITE_BITTERLESS_CORE_URL || '',
  userData: process.env.BITTERLESS_E2E_USER_DATA_DIR
});

const assertE2EKeychainIsolation = (): void => {
  if (isHelperMode || !isE2E || app.isPackaged || process.platform !== 'darwin') return;
  if (!app.commandLine.hasSwitch('use-mock-keychain')) {
    throw new Error('BITTERLESS_E2E on macOS requires --use-mock-keychain');
  }
};

assertE2EKeychainIsolation();
registerOnlyPreviewScheme();
const onlyPreviewOpenQueue = new OnlyPreviewOpenQueue(openOnlyPreviewOsTarget);
mcpBridgeServer.configurePreviewOpener((target) =>
  openOnlyPreviewAbsoluteTarget(target, { preserveTreeSelection: true })
);
const CORE_SQLITE_STARTUP_TIMEOUT_MS = 60_000;
const coreSqliteBoot = createBoundedTodoXpcClient(
  createXpcMainEmitter<CoreSqliteBootApi>('CoreSqliteBootDao'),
  'CoreSqliteBootDao',
  CORE_SQLITE_STARTUP_TIMEOUT_MS,
);
const todoistSyncSessionClient =
  createXpcMainEmitter<TodoistSyncSessionApi>('TodoistSyncSessionHandler');
const TODOIST_SYNC_DEACTIVATE_TIMEOUT_MS = 2_000;

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
  if (!isE2E) return;
  if (app.isPackaged) {
    throw new Error('BITTERLESS_E2E is unavailable in packaged builds');
  }
  if (isHelperMode) return;
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
  app.setPath('sessionData', userDataPath);
};

configureE2EUserData();
setModelIoRoot(() => join(app.getPath('userData'), 'agent-io'));

if (!isHelperMode) {
  // The shared default workspace exists from boot, not from the first write: it is where every file
  // tool works when no directory is bound (docs/features/maestro-default-workspace.md), so the owner
  // can open it before the agent has put anything there. After configureE2EUserData() — that call
  // redirects the home path under E2E.
  // One call creates the home data root and every directory under it — default_workspace, workflows,
  // skills — and moves anything still sitting in a pre-unification location. The owner opens that
  // root expecting to see what the app keeps there, so none of it may wait for its feature's first
  // write (Ral 2026-09-20:「首先这些目录都需要 ensure 的」).
  ensureAppData();
  ensureDefaultWorkspace();
  ensureWorkflowsRoot();
  // First scan here, not on first use: it installs the directory watcher and fills the snapshot the
  // system-prompt workflow catalog is built from (docs/features/workflow-catalog-in-prompt.md).
  // Fire-and-forget: it awaits an ESM-only module load, and boot must not block on it.
  void startWorkflowLibrary();
  registerTrenchGmgnIpc(coinResourceService);
  registerSnipingIpc();
  registerMonitoringIpc();
}
initializeApplicationLogging(runtimeProfile);

if (!isHelperMode) {
  for (const target of resolveOnlyPreviewOpenTargets(process.argv, {
    packaged: app.isPackaged,
    platform: process.platform,
    workingDirectory: process.cwd(),
  })) {
    onlyPreviewOpenQueue.enqueue(target);
  }
}

app.on('open-file', (event, target) => {
  if (isHelperMode) return;
  event.preventDefault();
  onlyPreviewOpenQueue.enqueue(target);
});

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
  const mockOrigin = isAuthOnlyE2E ? '' : e2eMockOrigin();
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
    if (isAuthOnlyE2E) {
      if (!isAllowedAuthE2ERequest(request.url, request.method)) return Response.error();
      return await net.fetch(request, { bypassCustomProtocolHandlers: true, redirect: 'error' });
    }
    if (
      url.protocol === 'http:' &&
      url.origin === mockOrigin &&
      !url.username &&
      !url.password &&
      url.pathname === '/todo/sync' &&
      !url.search &&
      ['POST', 'OPTIONS'].includes(request.method)
    ) {
      return await mockResponse('/todo/sync', request);
    }
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

  // Maestro 分区在 E2E 下没有任何被放行的远端来源 —— AI-CRMS 那条 mock 随 provider 于 2026-09
  // 一并退役。保留独立 handler 是为了「这个分区默认拒绝」这件事在代码里有个明确的落点。
  const maestroHandler = async (request: Request): Promise<Response> => deniedResponse(request);

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
  omniWindowHelper.setHostQuitting(true);
  cleanupPromise = (async () => {
    try { console.log('[app] Cleaning up resources...'); } catch {}
    // Keep windows, SQLite and bridges alive if workflow ownership cannot be released.
    await maestroWindowHandler.destroyForHostQuit();
    try { snipingSessionService.clearCurrent(); } catch {}

    try { await optionalIntegrationsLifecycle.fenceAndJoin(); } catch {
      // Startup errors are logged at their source; cleanup still owns every initialized resource.
    }
    try { await stopEyesOnAgentsRuntime?.(); } catch {
      // Best-effort shutdown: the remaining application resources must still be released.
    }
    try { await mcpBridgeServer.stop(); } catch {}
    try {
      await withTodoXpcTimeout(
        todoistSyncSessionClient.deactivate(),
        'Todo SQLite session deactivation',
        TODOIST_SYNC_DEACTIVATE_TIMEOUT_MS,
      );
    } catch {}
    try { await coinWindowHandler.destroyForHostQuit(); } catch {}
    try { await eyesOnAgentsWindowHandler.destroyForHostQuit(); } catch {}
    try { await submodulesWindowHandler.destroyForHostQuit(); } catch {}
    try { omniWindowHelper.destroy(); } catch {}
    try { await zellijWindowService.destroy(); } catch {}
    try { await todoWindowHandler.destroyForHostQuit(); } catch {}
    try { await pluginTestHandler.destroyForHostQuit(); } catch {}
    try { mainWindowHelper.destroy(); } catch {}
    try { sqliteWindowHelper.destroy(); } catch {}
    try { llamaWindowHelper.destroy(); } catch {}
    try { connectorWindowHelper.destroy(); } catch {}
    try { trenchIoWindowService.stop(); } catch {}
    try { destroyOnlyPreviewForHostQuit(); } catch {
      // Continue shutdown if Electron has already torn down OnlyPreview windows.
    }
    try { uninstallOnlyPreviewProtocol(); } catch {
      // Continue shutdown if the protocol session is no longer available.
    }
    try { trayHelper.destroy(); } catch {}

    try { console.log('[app] Cleanup complete'); } catch {}
  })().catch((error) => {
    cleanupPromise = null;
    isShutdownStarted = false;
    omniWindowHelper.setHostQuitting(false);
    throw error;
  });
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
  let sqliteWindow: Electron.BrowserWindow | null = null;
  try {
    sqliteWindowHelper.create((window) => {
      sqliteWindow = window;
      registration.observeWindow(window);
    });
  } catch (err) {
    registration.dispose();
    return Promise.reject(err);
  }

  return withTodoXpcTimeout(
    registration.promise,
    'Core SQLite target registration',
    CORE_SQLITE_STARTUP_TIMEOUT_MS,
  )
    .then(async (targetId) => {
      const result = await registration.guardCoreReady(coreSqliteBoot.ready({ targetId }));
      if (result?.ok) {
        console.log(`[app] Core SQLite ready: ${targetId}`);
        sqliteWindow?.webContents.on('render-process-gone', (_event, details) => {
          const reloaded = sqliteWindow
            ? reloadCoreSqliteRuntime(sqliteWindow, isShutdownStarted)
            : false;
          if (reloaded) {
            console.warn(`[app] Core SQLite renderer exited (${details.reason}); reloading runtime`);
          }
        });
      }
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
      // This CALL must precede the first `await import('@earendil-works/pi-coding-agent')`: pi
      // freezes TOOLS_DIR at import time, and without PI_CODING_AGENT_DIR every pi agent-dir read
      // falls back to the user's own ~/.pi/agent (see docs/issues/pi-agent-dir-uses-global-home.md).
      // It is the statement position that carries the constraint — llmPaths is imported statically
      // (it holds no module-level side effects, and pi is only ever imported inside functions).
      console.log(`[maestro] pi agentDir=${configureMaestroPiAgentDir()}`);
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window);
      });
    },
    startCoreSqlite: () => startCoreSqliteRenderer(),
    initializeLanguageFallback: () => {
      initializeApplicationLanguageFallback();
    },
    initializeForegroundRuntime: async () => {
      installE2ENetworkGuard();
      if (process.platform === 'darwin') app.dock.setBadge('');
      await runDiagnosedStartupStage('trench-io', async () => {
        await trenchIoWindowService.start();
      });
    },
    createHome: async () => {
      mainWindowHelper.create({ canCreate: () => !isShutdownStarted });
      await maestroWindowHandler.openMaestroWindow().catch((err: unknown) => {
        console.warn('[app] Failed to open Maestro during startup:', err);
      });
    },
    refreshMcpShim: async () => {
      await runDiagnosedStartupStage('mcp-shim', async () => {
        await mcpHandler.ensureShim();
      });
    },
    initializeTray: async () => {
      await runDiagnosedStartupStage('tray', () => {
        trayHelper.init({
          show: () => {
            void maestroWindowHandler.openMaestroWindow().catch((err: unknown) => {
              console.warn('[app] Failed to show Maestro from tray:', err);
            });
          },
        });
        app.on('activate', () => {
          void maestroWindowHandler.openMaestroWindow().catch((err: unknown) => {
            console.warn('[app] Failed to show Maestro on activation:', err);
          });
        });
      });
    },
    handleCoreSqliteReady: () => {
      startupDiagnosticsService.clear('core-sqlite');
      void omniWindowHelper.restoreSession().catch((err: unknown) => {
        console.warn('[app] Failed to restore Omni Browser session:', err);
      });
      onlyPreviewRecentDirectoryService.markStorageReady();
      onlyPreviewRecentsService.markStorageReady();
      onlyPreviewBookmarksService.markStorageReady();
      void runDiagnosedStartupStage('application-language', async () => {
        await applicationLanguageService.initialize();
      });
      void runDiagnosedStartupStage('window-layout', async () => {
        await mainWindowHelper.hydratePersistedLayout();
      });
      // 承载偏好(tab / 窗口)也在这里预热 —— 同一个存储、同一个时机。预热之后打开路径读的是
      // 内存那一份,不必 await(`onlyPreviewHostMount.service.ts` 里说明了为什么)。
      void hydrateOnlyPreviewHostMount().catch(() => undefined);
      void onlyPreviewSettingsService.hydrateFromStorage().catch((err: unknown) => {
        console.warn('[app] OnlyPreview settings hydration failed:', err);
      });
      void optionalIntegrationsLifecycle.start((canStartNextStage) =>
        startOptionalIntegrations(canStartNextStage)
      ).catch((err: unknown) => {
        console.warn('[app] Optional integrations disabled:', err);
      });
    },
    handleCoreSqliteFailure: (err) => {
      onlyPreviewRecentDirectoryService.markStorageFailed();
      onlyPreviewRecentsService.markStorageFailed();
      onlyPreviewBookmarksService.markStorageFailed();
      startupDiagnosticsService.report('core-sqlite', err);
      console.warn('[app] Core SQLite unavailable; continuing foreground startup:', err);
    },
    shouldStop: () => isShutdownStarted,
  });
};

const startOptionalIntegrations = async (
  canStartNextStage: OptionalStartupStageGuard,
): Promise<void> => {
  if (isAuthOnlyE2E) return;
  if (!canStartNextStage()) return;

  await runDiagnosedStartupStage('mcp-bridge', async () => {
    await mcpBridgeServer.start();
  });
  if (!canStartNextStage()) return;

  await runDiagnosedStartupStage('eyes-on-agents', async () => {
    if (!canStartNextStage()) return;
    // Assigned only once the runtime actually starts — the shutdown path reads it as
    // `await stopEyesOnAgentsRuntime?.()` to tell "started" from "never started".
    stopEyesOnAgentsRuntime = stopEyesOnAgentsRuntimeImpl;
    await startEyesOnAgentsRuntime();
  });
};

if (isLegacyCodingAgentHookHelperMode) {
  process.stderr.write(
    '[bitterless] legacy Codex hook helper is no longer supported; restart Bitterless to refresh it\n',
  );
  app.exit(2);
} else if (isMcpHelperMode) {
  // Must run before ready: Chromium reads its switches at startup.
  installRemoteDebugging();
  void app.whenReady().then(runLegacyMcpHelper).catch((err: unknown) => {
    console.error('[bitterless-mcp] legacy helper startup failed:', err);
    app.exit(2);
  });
} else if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    const targets = resolveOnlyPreviewOpenTargets(commandLine, {
      packaged: app.isPackaged,
      platform: process.platform,
      workingDirectory,
    });
    if (targets.length) {
      for (const target of targets) onlyPreviewOpenQueue.enqueue(target);
    } else {
      void maestroWindowHandler.openMaestroWindow().catch((err: unknown) => {
        console.warn('[app] Failed to show Maestro for second instance:', err);
      });
    }
  });
  void app.whenReady().then(async () => {
    // Before anything slow runs, so a stall during boot is measured too.
    startMainHealthMonitor();
    installOnlyPreviewProtocol();
    // Teach Cowork that OnlyPreview can be one of its tabs. Registered from here rather than from
    // Maestro because only the host side may know both halves — see `check:maestro`'s alias
    // boundary — and before `startGui()` so a Cowork window opened during startup already has it.
    registerOnlyPreviewCoworkTab();
    registerTrenchCoworkTab();
    registerZellijCoworkTab();
    // ...and make it the application Cowork's workspace tools show files in, instead of Finder.
    registerOnlyPreviewMaestroOpener();
    installApplicationFindMenu();
    await startGui();
    onlyPreviewOpenQueue.markReady();
  }).catch((err: unknown) => {
    console.error('[app] GUI startup failed:', err);
  });
}

const quitAfterCleanup = async (): Promise<void> => {
  try {
    await cleanupResources();
    isQuitting = true;
    // OnlyPreview 的关窗接管从这一刻起闭嘴 —— 退出时每个窗口都会收到 'close'。
    setOnlyPreviewShuttingDown(true);
    if (updateService.isUpdating) updateService.installAfterCleanup();
    else app.quit();
  } catch (error) {
    isQuitting = false;
    // 退出没成 —— 关窗接管必须恢复,否则这一发失败会把它永久关掉。
    setOnlyPreviewShuttingDown(false);
    hasShownQuitDialog = false;
    updateService.isUpdating = false;
    console.error('[app] Quit blocked: resource cleanup was not confirmed', error);
    await dialogHelper.showQuitCleanupFailedDialog().catch(() => undefined);
  }
};

let quitAttempt: Promise<void> | null = null;

/**
 * How long a quit may sit in cleanup before the process leaves anyway.
 *
 * `quitAttempt` is cleared in `.finally`, so a cleanup that REJECTS stays retryable. One that never
 * settles does not: the flag stays set and `if (quitAttempt) return` turns every later quit into a
 * no-op — menu, Cmd-Q, tray, and a second Ctrl-C alike — leaving a process that can only be killed
 * from outside. See micromeet-cowork docs/issues/ctrl-c-leaves-electron-running-and-teardown-xpc-noise.md,
 * where the same shape was traced to an unbounded `net.Server#close`.
 */
const QUIT_CLEANUP_TIMEOUT_MS = 8_000;

/** Leave now, without another lifecycle pass — `app.quit()` would re-enter the handler we are escaping. */
const forceExit = (reason: string): void => {
  console.warn(`[app] forcing exit: ${reason}`);
  isQuitting = true;
  setOnlyPreviewShuttingDown(true);
  app.exit(0);
};

/**
 * Terminal signals get a defined path instead of Electron's default.
 *
 * `Ctrl-C` on `yarn dev` signals the whole foreground process group. With no handler it reached
 * Electron's default, which calls `app.quit()` — and if cleanup was wedged, a second `Ctrl-C` could
 * not mean anything different. Now the first asks for a clean quit and the second leaves at once.
 */
let signalled = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (signalled) { forceExit(`${signal} received twice`); return; }
    signalled = true;
    console.info(`[app] ${signal} — quitting; press again to exit immediately.`);
    app.quit();
  });
}

/**
 * Dev watchdog: leave when the process that started us does.
 *
 * The signal handlers above are not enough, and the reason is visible in the symptom Ral reported
 * (2026-09-21): after `Ctrl-C` the shell prompt comes straight back, the renderer keeps logging
 * `[vite] server connection lost. Polling for restart…`, and **no** `[app] SIGINT` line is
 * ever printed. The handler is in the bundle; it simply never ran. `Ctrl-C` killed electron-vite,
 * and this process was re-parented instead of being signalled — the `task_policy_set … invalid
 * argument` pair Chromium logs at that moment is that re-parenting.
 *
 * So do not rely on the signal arriving. `electron-vite` starts us with `spawn(electronPath, …,
 * { stdio: 'inherit' })` and no `detached`, which makes electron-vite our parent. When it dies we
 * are re-parented to launchd/init and `process.ppid` changes — that is an observable fact needing no
 * cooperation from anyone.
 *
 * **Dev only.** A packaged app is launched by the OS and must never exit because its parent did.
 */
if (!app.isPackaged && !isE2E) {
  const startedUnder = process.ppid
  const watchdog = setInterval(() => {
    // `1` covers the macOS/Linux re-parent; the inequality covers anything else taking over.
    if (process.ppid === startedUnder && process.ppid !== 1) return
    clearInterval(watchdog)
    console.info(`[app] dev parent ${startedUnder} is gone (now ${process.ppid}) — quitting.`)
    // Ask nicely first so a chat mid-write still lands, then leave regardless. The dev server is
    // already gone at this point, so there is nothing to stay alive for.
    app.quit()
    const grace = setTimeout(() => forceExit('the dev parent is gone and the clean quit did not finish'), 2_000)
    grace.unref?.()
  }, 1_000)
  // Never hold the event loop open on its own account.
  watchdog.unref?.()
}

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  // A second attempt while one is pending means the owner has asked twice. Before this, that was
  // simply ignored.
  if (quitAttempt) { forceExit('a second quit arrived while cleanup was still pending'); return; }
  quitAttempt = (async () => {
    if (isHelperMode) {
      isQuitting = true;
      setOnlyPreviewShuttingDown(true);
      app.quit();
      return;
    }
    if (!isE2E && !updateService.isUpdating && process.platform === 'darwin' && !hasShownQuitDialog) {
      initializeApplicationLanguageFallback();
      hasShownQuitDialog = true;
      if (!await dialogHelper.showQuitConfirmDialog()) {
        hasShownQuitDialog = false;
        return;
      }
    }
    // Bounded: a cleanup that will not finish must not be able to keep the app alive.
    let settled = false;
    const timer = setTimeout(() => { if (!settled) forceExit(`cleanup did not finish within ${QUIT_CLEANUP_TIMEOUT_MS}ms`); }, QUIT_CLEANUP_TIMEOUT_MS);
    timer.unref?.();
    try { await quitAfterCleanup(); } finally { settled = true; clearTimeout(timer); }
  })().catch((error) => {
    hasShownQuitDialog = false;
    console.error('[app] Quit request failed', error);
  }).finally(() => { quitAttempt = null; });
});

app.on('will-quit', () => {
  // 更新和正常退出均不干预，让系统正常退出
});

app.on('window-all-closed', () => {
  // 不自动退出，保留 tray 功能，由用户主动触发退出
});
