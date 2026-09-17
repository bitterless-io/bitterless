import { app, session } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { parse } from '@bgotink/kdl/v1-compat';
import { xpcMain } from 'electron-xpc/main';
import { mainSafeStorage } from '@main/security/safeStorage.runtime';
import { ZELLIJ_STATE_EVENT, type ZellijSnapshot } from '@shared/zellij/zellij.type';
import { ZellijConfigService, resolveZellijConfigFile } from './zellijConfig.service';
import { ZellijProcessService, zellijErrorCode } from './zellijProcess.service';
import { zellijDetail, zellijLog, zellijSessionTag, zellijSurfaceTag } from './zellijLog.service';
import { ZellijTokenService } from './zellijToken.service';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { resolveZellijPort, zellijOriginForPort } from './zellijPort.service';
import {
  resolveZellijSessionName,
  zellijSessionUrl,
  ZELLIJ_SESSION_MAX_LENGTH
} from './zellijSession.service';
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
import { ZellijNativeIpcError, ZellijNativeIpcService } from './zellijNativeIpc.service';

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
  zellijSessionUrl(zellijOrigin(), sessionName(surfaceId));

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
const surfacePreparations = new Map<
  string,
  { session: string; signal?: AbortSignal; promise: Promise<string> }
>();
let recoveredSessions: Map<string, string> | null = null;
let sessionMappingsDirty = false;

const baseSessionName = (surfaceId: string): string =>
  resolveZellijSessionName(getRuntimeProfile().id, surfaceId);

const recoverySessionName = (surfaceId: string, token: string): string =>
  baseSessionName(surfaceId).slice(0, ZELLIJ_SESSION_MAX_LENGTH - 15) + '-r-' + token;

const sessionMappings = (): Map<string, string> => {
  if (recoveredSessions) return recoveredSessions;
  recoveredSessions = new Map();
  try {
    const data = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'zellij', 'surface-sessions.json'), 'utf8')
    );
    if (data.version === 1 && data.sessions && typeof data.sessions === 'object') {
      for (const [surface, name] of Object.entries(data.sessions)) {
        if (typeof name !== 'string') continue;
        const token = name.slice(-12);
        if (/^[a-f0-9]{12}$/u.test(token) && name === recoverySessionName(surface, token))
          recoveredSessions.set(surface, name);
      }
    }
  } catch {
    // Missing/invalid mappings cannot redirect a surface onto an arbitrary native session.
  }
  return recoveredSessions;
};

const persistSessionMappings = (): void => {
  const directory = join(app.getPath('userData'), 'zellij');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'surface-sessions.json');
  const temporary = join(directory, '.surface-sessions-' + randomUUID() + '.json');
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ version: 1, sessions: Object.fromEntries(sessionMappings()) }),
      { flag: 'wx', mode: 0o600 }
    );
    renameSync(temporary, file);
    sessionMappingsDirty = false;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
};

const rememberPreparedSession = (surfaceId: string, name: string): void => {
  if (name !== sessionName(surfaceId)) {
    sessionMappings().set(surfaceId, name);
    sessionMappingsDirty = true;
  }
  if (sessionMappingsDirty) persistSessionMappings();
};

const sessionName = (surfaceId: string): string =>
  sessionMappings().get(surfaceId) ?? baseSessionName(surfaceId);

export const subscribeZellijTerminalFailure = (
  listener: (surfaceId: string) => void
): (() => void) => {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
};

const failedSession = (session: string): void => {
  for (const [surfaceId, name] of preparedSurfaces) {
    if (name !== session) continue;
    // This is the OTHER route to the sentence Ral saw, and it used to be completely silent: it
    // publishes `operation-failed` to a surface without passing through the catch in
    // ZellijTerminalView.initialize() that owns the only existing log line.
    zellijLog.warn('surface-failed', {
      surface: zellijSurfaceTag(surfaceId),
      session: zellijSessionTag(session)
    });
    surfaceGenerations.set(surfaceId, (surfaceGenerations.get(surfaceId) ?? 0) + 1);
    surfacePreparations.delete(surfaceId);
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
        let verdict = 'absent';
        let failure: unknown;
        try {
          if (
            (await new ZellijNativeIpcService(getNativeSessions().socket(name)).probe()) === 'ready'
          )
            return;
        } catch (error) {
          /* A failed exact target cannot poison sibling surfaces. */
          failure = error;
          verdict = error instanceof ZellijNativeIpcError ? error.code : 'error';
        }
        if (
          generation !== runtimeGeneration ||
          preparedSurfaces.get(surface) !== name ||
          surfaceGeneration !== (surfaceGenerations.get(surface) ?? 0)
        )
          return;
        zellijLog.warn(
          'health-retire',
          { surface: zellijSurfaceTag(surface), session: zellijSessionTag(name), verdict },
          zellijDetail(
            failure instanceof ZellijNativeIpcError ? failure.detail || failure.message : failure
          )
        );
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

/**
 * Every stage of this function was invisible. The 2026-09-17 packaged incident left exactly one
 * line — an anonymous `operation-failed` — for a 106-second stall and a broken tab, so which stage
 * was slow and which one broke had to be reconstructed from file mtimes and a backup filename
 * (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md). Now each boundary reports its own
 * `elapsedMs`, successes included: without the successful rows there is no baseline to read a slow
 * row against.
 */
/**
 * Codes that describe the ENDPOINT, not the request: the daemon went away, closed the connection,
 * did not answer in time, or refused while shutting down. All four are states a second attempt can
 * legitimately find resolved — and Ral's own observation is the evidence: after the 2026-09-17
 * update the failing tab recovered as soon as he pressed Retry. Making him press it is the defect.
 * A native failure that survives this bounded retry may use the single fresh-session fallback.
 */
const TRANSIENT_IPC_CODES = new Set(['absent', 'disconnected', 'timeout', 'rejected']);

export const prepareZellijTerminal = (surfaceId: string, signal?: AbortSignal): Promise<string> => {
  const existing = surfacePreparations.get(surfaceId);
  if (existing && !existing.signal?.aborted) return existing.promise;
  const surfaceGeneration = (surfaceGenerations.get(surfaceId) ?? 0) + 1;
  surfaceGenerations.set(surfaceId, surfaceGeneration);
  const preparation = {
    session: sessionName(surfaceId),
    signal,
    promise: null! as Promise<string>
  };
  preparation.promise = (async () => {
    if (runtimeStopping) await runtimeStopping;
    const generation = runtimeGeneration;
    const assertActive = (): void => {
      if (
        signal?.aborted ||
        generation !== runtimeGeneration ||
        surfaceGeneration !== (surfaceGenerations.get(surfaceId) ?? 0)
      )
        throw new Error('superseded');
    };
    assertActive();
    let attempts = 0;
    // Preserve a recoverable shell first. The fresh fallback below is attempted only once.
    for (let originalAttempt = 0; originalAttempt < 2; originalAttempt += 1) {
      const failure = { native: false };
      try {
        return await prepareZellijSurface(
          surfaceId,
          ++attempts,
          preparation.session,
          assertActive,
          failure
        );
      } catch (error) {
        assertActive();
        if (!failure.native) throw error;
        if (
          originalAttempt === 0 &&
          error instanceof ZellijNativeIpcError &&
          TRANSIENT_IPC_CODES.has(error.code)
        ) {
          zellijLog.warn('prepare-retry', {
            surface: zellijSurfaceTag(surfaceId),
            ipcCode: error.code
          });
          await new Promise((resolve) => setTimeout(resolve, 400));
          assertActive();
          continue;
        }
        break;
      }
    }
    assertActive();
    preparedSurfaces.delete(surfaceId);
    webBridge?.retire(preparation.session);
    directoryService?.deactivate(preparation.session);
    preparation.session = recoverySessionName(
      surfaceId,
      randomUUID().replace(/-/gu, '').slice(0, 12)
    );
    zellijLog.warn('session-remint', {
      surface: zellijSurfaceTag(surfaceId),
      session: zellijSessionTag(preparation.session),
      attempt: attempts + 1
    });
    return prepareZellijSurface(surfaceId, ++attempts, preparation.session, assertActive, {
      native: false
    });
  })()
    .catch((error) => {
      throw error instanceof Error && error.message === 'superseded'
        ? new Error('operation-failed')
        : error;
    })
    .finally(() => {
      if (surfacePreparations.get(surfaceId) === preparation) surfacePreparations.delete(surfaceId);
    });
  surfacePreparations.set(surfaceId, preparation);
  return preparation.promise;
};

const prepareZellijSurface = async (
  surfaceId: string,
  attempt: number,
  name: string,
  assertActive: () => void,
  failure: { native: boolean }
): Promise<string> => {
  const surface = zellijSurfaceTag(surfaceId);
  const startedAt = Date.now();
  let stageAt = startedAt;
  let stage = 'await-stop';
  const done = (next: string): void => {
    const now = Date.now();
    zellijLog.info('prepare-stage', {
      surface,
      stage,
      elapsedMs: now - startedAt,
      stageMs: now - stageAt
    });
    stage = next;
    stageAt = now;
  };
  zellijLog.info('prepare-start', {
    surface,
    attempt,
    profile: getRuntimeProfile().id,
    prepared: preparedSurfaces.size,
    stopping: Boolean(runtimeStopping),
    generation: runtimeGeneration
  });
  try {
    assertActive();
    done('runtime-initialize');
    const snapshot = await getZellijRuntime().initialize();
    assertActive();
    if (snapshot.status !== 'ready') throw new Error(snapshot.error ?? 'operation-failed');
    done('config-initialize');
    // Ready siblings remain attached while another surface ensures missing config defaults.
    await runtimeConfig!.initialize();
    assertActive();
    done('web-sharing-check');
    const config = parse(readFileSync(runtimeConfig!.file, 'utf8'));
    const sharing = config.nodes
      .find((node) => node.getName() === 'web_sharing')
      ?.getArguments()[0];
    if (sharing !== 'on') throw new Error('web-sharing-disabled');
    done('directory-prepare');
    await getZellijDirectories().prepare(name);
    assertActive();
    if (process.platform === 'darwin') {
      done('session-persist');
      rememberPreparedSession(surfaceId, name);
      done('bridge-register');
      await getWebBridge().register(name, getNativeSessions().socket(name));
      assertActive();
      preparedSurfaces.set(surfaceId, name);
      startSessionHealthChecks();
    }
    done('ready');
    zellijLog.info('prepare-end', {
      surface,
      attempt,
      outcome: 'success',
      elapsedMs: Date.now() - startedAt
    });
    return zellijTerminalUrl(surfaceId);
  } catch (error) {
    // `superseded` is the one failure that is not a defect: this preparation lost a race with a
    // runtime restart or a surface teardown. It used to be byte-identical to a real breakage
    // because both threw the literal string 'operation-failed'.
    const superseded = error instanceof Error && error.message === 'superseded';
    const reason = superseded ? 'superseded' : zellijErrorCode(error);
    // Only native preparation failures can justify a new session; later bridge/persist failures cannot.
    if (
      !superseded &&
      process.platform === 'darwin' &&
      stage === 'directory-prepare' &&
      reason === 'operation-failed'
    ) {
      assertActive();
      failure.native = true;
    }
    const line = {
      surface,
      attempt,
      outcome: 'failure',
      reason,
      stage,
      elapsedMs: Date.now() - startedAt
    };
    if (superseded) zellijLog.info('prepare-end', line);
    else zellijLog.error('prepare-end', line, zellijDetail(error));
    throw superseded ? new Error('operation-failed') : error;
  }
};

export const focusZellijTerminal = (surfaceId: string): void =>
  getZellijDirectories().activate(sessionName(surfaceId));

export const blurZellijTerminal = (surfaceId: string): void =>
  getZellijDirectories().deactivate(sessionName(surfaceId));

export const copyZellijNativeSelection = (
  surfaceId: string,
  options: { sendMarker(): Promise<boolean>; signal: AbortSignal }
): Promise<string> => {
  const session = preparedSurfaces.get(surfaceId);
  return session && webBridge ? webBridge.copySelection(session, options) : Promise.resolve('');
};

export const closeZellijTerminal = async (surfaceId: string): Promise<void> => {
  const name = surfacePreparations.get(surfaceId)?.session ?? sessionName(surfaceId);
  const generation = (surfaceGenerations.get(surfaceId) ?? 0) + 1;
  surfaceGenerations.set(surfaceId, generation);
  surfacePreparations.delete(surfaceId);
  preparedSurfaces.delete(surfaceId);
  webBridge?.retire(name);
  await getZellijDirectories().close(name);
  if (generation === surfaceGenerations.get(surfaceId) && sessionMappings().delete(surfaceId)) {
    sessionMappingsDirty = true;
    persistSessionMappings();
  }
};

export const stopZellijRuntime = (): Promise<void> => {
  if (runtimeStopping) return runtimeStopping;
  const startedAt = Date.now();
  // Quit deliberately keeps the native sessions and stops only the owned web server (Ral
  // 2026-09-12). That decision stands — but it was never written down anywhere a log could show it,
  // so an update-restart left no record of what was retained.
  zellijLog.info('stop-start', {
    surfaces: preparedSurfaces.size,
    retainedSessions: preparedSurfaces.size,
    healthTimer: healthTimer ? 'on' : 'off',
    generation: runtimeGeneration
  });
  const stopping = (async () => {
    runtimeGeneration += 1;
    surfacePreparations.clear();
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
    zellijLog.info('stop-end', {
      webProcessExited: webProcess === null || webProcess.exited(),
      elapsedMs: Date.now() - startedAt
    });
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
