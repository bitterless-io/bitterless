import { spawn, type ChildProcess } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';
import type { ZellijChildProcessOptions, ZellijOwnedProcess } from './zellijRuntime.type';

const STDERR_LIMIT = 16 * 1024;

// Keep one bounded prefix, then sanitize the complete diagnostic before exposing it. If the
// prefix ends inside a line, omit that line instead of exposing a cut credential.
const captureStderr = (): {
  append(data: Buffer): void;
  text(): string;
  matches(expected: string): boolean;
} => {
  let bytes = Buffer.alloc(0);
  let truncated = false;
  return {
    append: (data) => {
      if (truncated) return;
      const available = STDERR_LIMIT - bytes.length;
      bytes = Buffer.concat([bytes, data.subarray(0, available)]);
      truncated = data.length > available;
    },
    matches: (expected) =>
      !truncated && stripVTControlCharacters(bytes.toString('utf8')).trim() === expected,
    text: () => {
      const value = bytes.toString('utf8');
      const complete = truncated ? value.slice(0, Math.max(0, value.lastIndexOf('\n'))) : value;
      return (
        sanitizeDiagnostic(stripVTControlCharacters(complete)) ||
        (truncated ? '[stderr truncated]' : '[empty]')
      );
    }
  };
};

const spawnErrorFields = (error: unknown): string => {
  const failure = error as NodeJS.ErrnoException;
  return `osError=${sanitizeDiagnostic(failure?.code, 64) || 'unknown'} syscall=${sanitizeDiagnostic(failure?.syscall, 100) || 'unknown'}`;
};

const launchFields = (binary: string, args: string[]): string[] => {
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');
  return [
    `binary=${sanitizeDiagnostic(binary)}`,
    `config=${configIndex >= 0 ? sanitizeDiagnostic(args[configIndex + 1]) : 'default'}`,
    `port=${portIndex >= 0 ? sanitizeDiagnostic(args[portIndex + 1], 8) : 'default'}`
  ];
};

type ZellijCliFailureReason =
  | 'spawn-error'
  | 'timeout'
  | 'stdout-limit'
  | 'close-timeout'
  | 'exit'
  | 'no-sessions';

/** Safe metadata only: stdout can contain authentication tokens and must stay private. */
export class ZellijCliError extends Error {
  readonly name = 'ZellijCliError';

  constructor(
    readonly operation: string,
    readonly reason: ZellijCliFailureReason,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly osErrorCode: string | null,
    readonly requestedSignal: NodeJS.Signals | null,
    readonly terminationObserved: boolean
  ) {
    super('operation-failed');
  }
}

export const isZellijNoSessionsError = (error: unknown): boolean =>
  error instanceof ZellijCliError && error.reason === 'no-sessions';

const cliOperation = (args: string[]): string => {
  const valueOptions = new Set([
    '--config',
    '-c',
    '--config-dir',
    '--data-dir',
    '--layout',
    '-l',
    '--session',
    '-s',
    '--max-panes'
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueOptions.has(argument)) {
      index += 1;
      continue;
    }
    if (argument === '--version' || argument === '-V') return 'version';
    if (argument === '--server') return 'session-bootstrap';
    if (argument.startsWith('-')) continue;
    const tail = args.slice(index + 1);
    switch (argument) {
      case 'setup':
        return tail.includes('--check') ? 'config-check' : 'setup';
      case 'web':
        return tail.includes('--create-token') ? 'create-token' : 'web';
      case 'list-sessions':
        return 'session-list';
      case 'attach':
        return 'session-prepare';
      case 'action':
        return ['list-panes', 'current-tab-info'].includes(tail[0])
          ? 'pane-metadata'
          : 'session-action';
      case 'kill-session':
        return 'session-kill';
      case 'delete-session':
        return 'session-delete';
      default:
        return 'unknown';
    }
  }
  return 'unknown';
};

export const runZellijCli = (
  binary: string,
  options: ZellijChildProcessOptions & { timeoutMs?: number }
): Promise<string> =>
  new Promise((resolve, reject) => {
    const { args, env, cwd } = options;
    const operation = cliOperation(args);
    const stderr = captureStderr();
    let child: ChildProcess;
    let stdout = '';
    let failure: ZellijCliFailureReason | null = null;
    let osError: unknown;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let requestedSignal: NodeJS.Signals | null = null;
    let terminationObserved = false;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      const diagnostic = stderr.text();
      if (failure || exitCode !== 0) {
        const reason =
          failure ||
          (operation === 'session-list' &&
          exitCode === 1 &&
          !exitSignal &&
          stdout === '' &&
          stderr.matches('No active zellij sessions found.')
            ? 'no-sessions'
            : 'exit');
        const osErrorCode =
          sanitizeDiagnostic((osError as NodeJS.ErrnoException)?.code, 64) || null;
        console.error(
          `[zellij] cli failed operation=${operation} reason=${reason}`,
          `exitCode=${exitCode} signal=${exitSignal || (terminationObserved ? 'none' : 'unknown')}`,
          `requestedSignal=${requestedSignal || 'none'} terminationObserved=${terminationObserved}`,
          osError ? spawnErrorFields(osError) : 'osError=none',
          `stderr=${diagnostic}`
        );
        reject(
          new ZellijCliError(
            operation,
            reason,
            exitCode,
            exitSignal,
            osErrorCode,
            requestedSignal,
            terminationObserved
          )
        );
      } else resolve(stdout);
    };
    // Usually close arrives immediately after exit/SIGKILL. A descendant may retain a pipe:
    // without close, neither successful stdout nor an empty-inventory stderr prefix is complete.
    const awaitClose = (): void => {
      if (closeTimer || settled) return;
      closeTimer = setTimeout(() => {
        failure ??= 'close-timeout';
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish();
      }, 1_000);
    };
    const terminate = (reason: ZellijCliFailureReason): void => {
      if (settled || failure) return;
      failure = reason;
      requestedSignal = 'SIGKILL';
      try {
        child.kill(requestedSignal);
      } catch (error) {
        osError = error;
      }
      awaitClose();
    };
    const timer = setTimeout(() => terminate('timeout'), options.timeoutMs ?? 15_000);
    try {
      child = spawn(binary, args, {
        shell: false,
        windowsHide: true,
        env,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      osError = error;
      failure = 'spawn-error';
      finish();
      return;
    }
    child.stdout?.on('data', (data: Buffer) => {
      if (settled || failure) return;
      stdout += data.toString('utf8');
      if (stdout.length > 64 * 1024) {
        stdout = '';
        terminate('stdout-limit');
      }
    });
    child.stderr?.on('data', stderr.append);
    child.once('error', (error) => {
      osError = error;
      if (!failure) failure = 'spawn-error';
      awaitClose();
    });
    child.once('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      terminationObserved = true;
      awaitClose();
    });
    // close follows exit/error and drained stderr. stdout may contain an auth token: never log it.
    child.once('close', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      terminationObserved = true;
      finish();
    });
  });

export const spawnZellijServer = (
  binary: string,
  options: ZellijChildProcessOptions
): ZellijOwnedProcess => {
  const { args, env, cwd } = options;
  const stderr = captureStderr();
  const child = spawn(binary, args, {
    shell: false,
    windowsHide: true,
    env,
    cwd,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let ended = false;
  let stopped = false;
  let stopping: Promise<void> | null = null;
  let closeReceived = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let osError: unknown;
  const callbacks = new Set<() => void>();
  const exited = (): void => {
    if (ended) return;
    ended = true;
    if (!closeReceived) {
      drainTimer = setTimeout(() => {
        child.stderr.destroy();
        child.unref();
      }, 1_000);
    }
    for (const callback of callbacks) callback();
  };
  child.stderr.on('data', stderr.append);
  child.once('spawn', () => {
    console.info(`[zellij] server spawned pid=${child.pid}`, ...launchFields(binary, args));
  });
  child.once('exit', exited);
  child.on('error', (error) => {
    osError = error;
    // A failed spawn has no process. A signal-delivery error for an existing PID is not death.
    if (child.pid === undefined) exited();
  });
  child.once('close', (code, signal) => {
    closeReceived = true;
    clearTimeout(drainTimer);
    exited();
    const event = stopped ? 'requested-stop' : osError ? 'spawn-error' : 'unexpected-exit';
    const log = stopped ? console.info : console.error;
    log(
      `[zellij] server ${event} pid=${child.pid ?? 'none'} exitCode=${code} signal=${signal || 'none'}`,
      osError ? spawnErrorFields(osError) : 'osError=none',
      `stderr=${stderr.text()}`,
      ...launchFields(binary, args)
    );
  });
  return {
    exited: () => ended,
    onExit: (callback) => {
      callbacks.add(callback);
      if (ended) callback();
    },
    stop: () => {
      if (stopping) return stopping;
      if (ended) return Promise.resolve();
      stopped = true;
      let resolveStop!: () => void;
      let rejectStop!: (error: Error) => void;
      const pending = new Promise<void>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
      });
      stopping = pending;
      let timer: ReturnType<typeof setTimeout>;
      let finished = false;
      const finish = (error?: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        callbacks.delete(done);
        stopping = null;
        if (error) rejectStop(error);
        else resolveStop();
      };
      const done = (): void => finish();
      const signal = (value: NodeJS.Signals): void => {
        try {
          child.kill(value);
        } catch (error) {
          osError = error;
        }
      };
      callbacks.add(done);
      timer = setTimeout(() => {
        if (ended) return done();
        timer = setTimeout(() => {
          if (ended) return done();
          console.error(
            `[zellij] server stop-failed pid=${child.pid ?? 'none'} reason=exit-unobserved requestedSignal=SIGKILL`,
            osError ? spawnErrorFields(osError) : 'osError=none',
            `stderr=${stderr.text()}`
          );
          child.stderr.destroy();
          child.unref();
          finish(new Error('operation-failed'));
        }, 2_000);
        signal('SIGKILL');
      }, 2_000);
      signal('SIGTERM');
      return pending;
    }
  };
};
