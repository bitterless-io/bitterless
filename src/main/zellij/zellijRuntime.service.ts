import { app, session } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { parse } from '@bgotink/kdl/v1-compat';
import { xpcMain } from 'electron-xpc/main';
import { mainSafeStorage } from '@main/security/safeStorage.runtime';
import { ZELLIJ_STATE_EVENT, type ZellijSnapshot } from '@shared/zellij/zellij.type';
import { ZellijConfigService, resolveZellijConfigFile } from './zellijConfig.service';
import { ZellijProcessService } from './zellijProcess.service';
import { ZellijTokenService } from './zellijToken.service';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { resolveZellijPort, zellijOriginForPort } from './zellijPort.service';
import { resolveZellijSessionName, zellijSessionUrl } from './zellijSession.service';
import type { ZellijOwnedProcess } from './zellijRuntime.type';
import { runZellijCli, spawnZellijServer } from './zellijChildProcess.service';
import {
  prepareZellijChildEnvironment,
  resolveZellijSessionEnvironment,
  resolveZellijShellAssetDirectory
} from './zellijEnvironment.service';
import { ensureZellijShellIntegration } from './zellijShellIntegration.service';
import { ZellijDirectoryService } from './zellijDirectory.service';
import { ZellijNativeSessionService } from './zellijNativeSession.service';
import { ZellijWebBridgeService } from './zellijWebBridge.service';
import { ZellijNativeIpcService } from './zellijNativeIpc.service';

/**
 * Resolved once per process, not per call: the profile is fixed for the process lifetime, and a
 * value that could drift mid-run would let the navigation allowlist and the loaded URL disagree.
 * Memoized rather than computed at module load so an invalid override throws where a caller can
 * report it, not during import.
 */
let resolvedPort: number | null = null;

export const zellijPort = (): number => {
  if (resolvedPort === null) resolvedPort = resolveZellijPort(getRuntimeProfile().id);
  return resolvedPort;
};

export const zellijOrigin = (): string => zellijOriginForPort(zellijPort());

/**
 * The URL a terminal view loads: the origin PLUS this SURFACE's session name.
 *
 * Loading the bare origin is what made the web client ask for a session name on every open — it
 * picks the session from the path, and an empty path means "none chosen yet". Keying the name on the
 * surface rather than the profile is what makes a second terminal a second session instead of a
 * second view onto the first one's panes.
 */
export const zellijTerminalUrl = (surfaceId: string): string =>
  zellijSessionUrl(zellijOrigin(), resolveZellijSessionName(getRuntimeProfile().id, surfaceId));

export const ZELLIJ_PARTITION = 'persist:bitterless-zellij';

const binaryPath = (): string => {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('unsupported-platform');
  const binary = process.platform === 'win32' ? 'zellij.exe' : 'zellij';
  const file = app.isPackaged
    ? join(process.resourcesPath, 'maestro-tools', binary)
    : join(app.getAppPath(), 'build', 'maestro-tools', binary);
  if (!existsSync(file)) throw new Error('binary-missing');
  return file;
};

const childEnvironment = (configFile?: string): NodeJS.ProcessEnv => {
  let env = prepareZellijChildEnvironment(getRuntimeProfile().id);
  // Native validation may be replacing an invalid old file. Inspect configuration only when
  // creating a session, after ensure completed, never while checking a temporary KDL candidate.
  if (process.platform === 'darwin' && configFile) {
    const configured = resolveZellijSessionEnvironment(env, readFileSync(configFile, 'utf8'));
    env = configured.env;
    // Finder can omit SHELL. Keep native shell selection and the startup shim on the same OS default.
    env.SHELL ??= userInfo().shell ?? undefined;
    if (!configured.explicitZdotdir) {
      env = ensureZellijShellIntegration({
        profileDirectory: join(app.getPath('userData'), 'zellij'),
        assetDirectory: resolveZellijShellAssetDirectory({
          packaged: app.isPackaged,
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath
        }),
        selectedShell: env.SHELL ?? '',
        explicitDefaultShell: configured.explicitDefaultShell,
        env
      });
    }
  }
  return env;
};

const runCli = (args: string[], cwd = homedir()): Promise<string> => {
  return runZellijCli(binaryPath(), {
    args,
    cwd,
    env: childEnvironment(args[2] === 'attach' ? args[1] : undefined)
  });
};

let webProcess: ZellijOwnedProcess | null = null;
const spawnServer = (args: string[]): ZellijOwnedProcess => {
  webProcess = spawnZellijServer(binaryPath(), {
    args,
    cwd: homedir(),
    env: {
      ...prepareZellijChildEnvironment(getRuntimeProfile().id),
      ...(process.platform === 'darwin' ? { ZELLIJ_SOCKET_DIR: getWebBridge().directory } : {})
    }
  });
  return webProcess;
};

export const zellijTerminalSession = (): Electron.Session =>
  session.fromPartition(ZELLIJ_PARTITION);

let runtime: ZellijProcessService | null = null;
let directoryService: ZellijDirectoryService | null = null;
let runtimeConfig: ZellijConfigService | null = null;
let nativeSessions: ZellijNativeSessionService | null = null;
let webBridge: ZellijWebBridgeService | null = null;
let bridgeCleanup: Promise<void> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let healthPending = false;
const preparedSurfaces = new Map<string, string>();
const failureListeners = new Set<(surfaceId: string) => void>();
let runtimeGeneration = 0;
let runtimeStopping: Promise<void> | null = null;
const surfaceGenerations = new Map<string, number>();

const sessionName = (surfaceId: string): string =>
  resolveZellijSessionName(getRuntimeProfile().id, surfaceId);

export const subscribeZellijTerminalFailure = (
  listener: (surfaceId: string) => void
): (() => void) => {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
};

const failedSession = (session: string): void => {
  for (const [surfaceId, name] of preparedSurfaces) {
    if (name !== session) continue;
    surfaceGenerations.set(surfaceId, (surfaceGenerations.get(surfaceId) ?? 0) + 1);
    preparedSurfaces.delete(surfaceId);
    directoryService?.deactivate(session);
    for (const listener of [...failureListeners]) listener(surfaceId);
  }
};

const getWebBridge = (): ZellijWebBridgeService => {
  if (!webBridge) webBridge = new ZellijWebBridgeService(failedSession);
  return webBridge;
};

const getNativeSessions = (): ZellijNativeSessionService => {
  if (nativeSessions) return nativeSessions;
  const configFile = runtimeConfig!.file;
  const env = childEnvironment(configFile);
  const socketDirectory = resolve(homedir(), env.ZELLIJ_SOCKET_DIR!);
  nativeSessions = new ZellijNativeSessionService({
    socketDirectory,
    configFile,
    cacheDirectory: join(
      homedir(),
      'Library',
      'Caches',
      'org.Zellij-Contributors.Zellij',
      'contract_version_1',
      'session_info'
    ),
    ownershipFile: join(app.getPath('userData'), 'zellij', 'native-sessions.json'),
    binary: binaryPath(),
    spawn: async (socket, session, cwd) => {
      await runZellijCli(binaryPath(), {
        args: ['--server', socket],
        timeoutMs: 5_000,
        cwd,
        env: {
          ...childEnvironment(configFile),
          ZELLIJ: '0',
          ZELLIJ_SESSION_NAME: session,
          ZELLIJ_SOCKET_DIR: socketDirectory
        }
      });
    }
  });
  return nativeSessions;
};

const startSessionHealthChecks = (): void => {
  if (healthTimer || process.platform !== 'darwin') return;
  healthTimer = setInterval(() => {
    if (healthPending) return;
    healthPending = true;
    const generation = runtimeGeneration;
    void Promise.allSettled(
      [...preparedSurfaces.entries()].map(async ([surface, name]) => {
        const surfaceGeneration = surfaceGenerations.get(surface) ?? 0;
        try {
          if (
            (await new ZellijNativeIpcService(getNativeSessions().socket(name)).probe()) === 'ready'
          )
            return;
        } catch {
          /* A failed exact target cannot poison sibling surfaces. */
        }
        if (
          generation !== runtimeGeneration ||
          preparedSurfaces.get(surface) !== name ||
          surfaceGeneration !== (surfaceGenerations.get(surface) ?? 0)
        )
          return;
        webBridge?.retire(name);
        failedSession(name);
      })
    ).finally(() => {
      healthPending = false;
    });
  }, 2_000);
  healthTimer.unref?.();
};

export const getZellijDirectories = (): ZellijDirectoryService => {
  getZellijRuntime();
  return directoryService!;
};

export const prepareZellijTerminal = async (surfaceId: string): Promise<string> => {
  const surfaceGeneration = surfaceGenerations.get(surfaceId) ?? 0;
  if (runtimeStopping) await runtimeStopping;
  const generation = runtimeGeneration;
  const assertActive = (): void => {
    if (
      generation !== runtimeGeneration ||
      surfaceGeneration !== (surfaceGenerations.get(surfaceId) ?? 0)
    )
      throw new Error('operation-failed');
  };
  assertActive();
  const snapshot = await getZellijRuntime().initialize();
  assertActive();
  if (snapshot.status !== 'ready') throw new Error(snapshot.error ?? 'operation-failed');
  // Ready siblings remain attached while another surface ensures missing config defaults.
  await runtimeConfig!.initialize();
  assertActive();
  const config = parse(readFileSync(runtimeConfig!.file, 'utf8'));
  const sharing = config.nodes.find((node) => node.getName() === 'web_sharing')?.getArguments()[0];
  if (sharing !== 'on') throw new Error('web-sharing-disabled');
  await getZellijDirectories().prepare(sessionName(surfaceId));
  assertActive();
  if (process.platform === 'darwin') {
    await getWebBridge().register(
      sessionName(surfaceId),
      getNativeSessions().socket(sessionName(surfaceId))
    );
    assertActive();
    preparedSurfaces.set(surfaceId, sessionName(surfaceId));
    startSessionHealthChecks();
  }
  return zellijTerminalUrl(surfaceId);
};

export const focusZellijTerminal = (surfaceId: string): void =>
  getZellijDirectories().activate(sessionName(surfaceId));

export const blurZellijTerminal = (surfaceId: string): void =>
  getZellijDirectories().deactivate(sessionName(surfaceId));

export const closeZellijTerminal = async (surfaceId: string): Promise<void> => {
  surfaceGenerations.set(surfaceId, (surfaceGenerations.get(surfaceId) ?? 0) + 1);
  preparedSurfaces.delete(surfaceId);
  webBridge?.retire(sessionName(surfaceId));
  await getZellijDirectories().close(sessionName(surfaceId));
};

export const stopZellijRuntime = (): Promise<void> => {
  if (runtimeStopping) return runtimeStopping;
  const stopping = (async () => {
    runtimeGeneration += 1;
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
    preparedSurfaces.clear();
    await directoryService?.stop();
    try {
      await runtime?.stop();
    } catch (error) {
      const owned = webProcess;
      const retained = webBridge;
      // A timed-out stop retains its live tombstones. Release them only after observed death.
      if (owned && retained)
        owned.onExit(() => {
          if (webProcess !== owned || webBridge !== retained || !owned.exited()) return;
          webProcess = null;
          webBridge = null;
          bridgeCleanup = retained.stop();
          void bridgeCleanup.catch(() => console.error('[zellij] web bridge cleanup failed'));
        });
      throw error;
    }
    if (webProcess && !webProcess.exited()) throw new Error('operation-failed');
    webProcess = null;
    const bridge = webBridge;
    webBridge = null;
    await bridge?.stop();
    await bridgeCleanup;
    bridgeCleanup = null;
  })().finally(async () => {
    // Standalone/Omni hosts may close during the awaited web-server/bridge shutdown stages.
    await directoryService?.waitForClosures();
    if (runtimeStopping === stopping) runtimeStopping = null;
  });
  runtimeStopping = stopping;
  return stopping;
};

/**
 * A Set, not a single slot. This used to be `stateListener = listener`, which meant the SECOND
 * subscriber silently unsubscribed the first — the first surface then never saw another
 * ready/error transition, so it neither built nor tore down its terminal again. That is a
 * silent-corruption failure, not a crash, and it becomes reachable the moment a second surface
 * exists. Returning a disposer is what lets a surface unsubscribe when it is torn down.
 */
const stateListeners = new Set<(snapshot: ZellijSnapshot) => void>();

export const subscribeZellijState = (
  listener: (snapshot: ZellijSnapshot) => void
): (() => void) => {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
};

export const getZellijRuntime = (): ZellijProcessService => {
  if (runtime) return runtime;
  const token = new ZellijTokenService(join(app.getPath('userData'), 'zellij', 'web-token.enc'), {
    persistent: app.isPackaged && import.meta.env.VITE_MODE === 'release',
    available: () => mainSafeStorage.isEncryptionAvailable('zellij'),
    encrypt: (value) => mainSafeStorage.encryptString(value, 'zellij'),
    decrypt: (bytes) => mainSafeStorage.decryptString(bytes, 'zellij')
  });
  const config = new ZellijConfigService(
    resolveZellijConfigFile({ userData: app.getPath('userData') }),
    {
      platform: process.platform,
      validate: async (file) => {
        let output: string;
        try {
          output = await runCli(['--config', file, 'setup', '--check']);
        } catch {
          throw new Error('config-validation-failed');
        }
        if (!output.includes('[CONFIG FILE]: Well defined.'))
          throw new Error('config-validation-failed');
      }
    }
  );
  runtimeConfig = config;
  directoryService = new ZellijDirectoryService({
    file: join(app.getPath('userData'), 'zellij', 'last-directory.json'),
    home: homedir(),
    configFile: config.file,
    run: runCli,
    native:
      process.platform === 'darwin'
        ? {
            exists: (name) => getNativeSessions().exists(name),
            create: (name, cwd) => getNativeSessions().create(name, cwd),
            close: (name) => getNativeSessions().close(name),
            metadata: (name, action) => getNativeSessions().metadata(name, action),
            stop: () => nativeSessions?.stop()
          }
        : undefined
  });
  runtime = new ZellijProcessService({
    config,
    checkBinary: () => {
      binaryPath();
    },
    port: zellijPort,
    run: runCli,
    spawn: spawnServer,
    probe: async () => {
      try {
        const response = await fetch(`${zellijOrigin()}/info/version`, {
          signal: AbortSignal.timeout(900),
          redirect: 'error'
        });
        if (!response.ok) return 'occupied';
        const text = await response.text();
        return text.trim() !== '0.45.1'
          ? 'mismatch'
          : process.platform !== 'darwin' || (webProcess && !webProcess.exited())
            ? 'matching'
            : 'occupied';
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code === 'ECONNREFUSED' ? 'absent' : 'occupied';
      }
    },
    login: async (authToken) => {
      try {
        const response = await zellijTerminalSession().fetch(`${zellijOrigin()}/command/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken, remember_me: true }),
          credentials: 'include',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000)
        });
        if (response.status !== 200) return false;
        const result = (await response.json()) as { success?: boolean };
        return result.success === true;
      } catch {
        return false;
      }
    },
    readToken: () => token.read(),
    writeToken: (value) => token.write(value),
    changed: (snapshot) => {
      if (snapshot.status === 'error') {
        console.error(`[zellij] runtime failed reason=${snapshot.error}`);
      }
      // Copy first: a listener may dispose itself (or a sibling surface) while being notified.
      for (const listener of [...stateListeners]) listener(snapshot);
      xpcMain.broadcast(ZELLIJ_STATE_EVENT, snapshot);
    },
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  });
  return runtime;
};
