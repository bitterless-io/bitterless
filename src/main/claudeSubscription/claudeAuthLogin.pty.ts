import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { ClaudeAccountExecutionContext } from './claudeAccount.repository';
import { buildClaudeSubscriptionEnvironment } from './claudeSubscription.environment';

export interface ClaudeAuthLoginPtySpawnOptions {
  context: ClaudeAccountExecutionContext;
}

export interface ClaudeAuthLoginPtyExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface ClaudeAuthLoginPty {
  writeLine(value: string): void;
  kill(): Promise<void>;
  onData(listener: (data: Buffer) => void): () => void;
  onExit(listener: (result: ClaudeAuthLoginPtyExit) => void): () => void;
}

export interface ClaudeAuthLoginPtyFactory {
  spawn(options: ClaudeAuthLoginPtySpawnOptions): ClaudeAuthLoginPty;
}

export interface ScriptClaudeAuthLoginPtyFactoryOptions {
  claudeExecutable: string;
  parentEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
}

const SCRIPT_EXECUTABLE = '/usr/bin/script';
const EXPECT_EXECUTABLE = '/usr/bin/expect';
const EXPECT_CLAUDE_EXECUTABLE_VARIABLE = 'BITTERLESS_CLAUDE_AUTH_EXECUTABLE';
const EXPECT_PROGRAM = [
  'set timeout -1',
  `set claude_executable $env(${EXPECT_CLAUDE_EXECUTABLE_VARIABLE})`,
  `unset env(${EXPECT_CLAUDE_EXECUTABLE_VARIABLE})`,
  `spawn -noecho ${SCRIPT_EXECUTABLE} -q /dev/null $claude_executable auth login --claudeai`,
  'interact',
  'set wait_failed [catch {wait} result]',
  'if {$wait_failed != 0 || [llength $result] != 4} { exit 1 }',
  'if {[lindex $result 2] != 0} { exit 1 }',
  'exit [lindex $result 3]'
].join('\n');
const BROWSER_HELPER = '/usr/bin/true';
const TERMINATION_GRACE_MS = 1_000;
const TERMINATION_SETTLE_MS = 2_000;

export const buildClaudeAuthLoginEnvironment = (
  parentEnvironment: NodeJS.ProcessEnv,
  context: ClaudeAccountExecutionContext
): Record<string, string> => ({
  ...buildClaudeSubscriptionEnvironment(parentEnvironment, context),
  TERM: 'xterm-256color',
  BROWSER: BROWSER_HELPER
});

class ScriptClaudeAuthLoginPty implements ClaudeAuthLoginPty {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exitListeners = new Set<(result: ClaudeAuthLoginPtyExit) => void>();
  #forceKillTimer: NodeJS.Timeout | null = null;
  #closed = false;
  #exitResult: ClaudeAuthLoginPtyExit | null = null;
  #terminationStarted = false;
  readonly #closedPromise: Promise<void>;
  readonly #resolveClosed: () => void;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    let resolveClosed!: () => void;
    this.#closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
    child.once('close', (exitCode, signal) => {
      this.#closed = true;
      if (this.#forceKillTimer) clearTimeout(this.#forceKillTimer);
      this.#forceKillTimer = null;
      this.#resolveClosed();
      this.#recordExit({ exitCode, signal });
    });
    child.once('error', (error) => {
      this.#resolveClosed();
      this.#recordExit({ exitCode: null, signal: null, error });
    });
  }

  writeLine(value: string): void {
    if (this.#child.killed || !this.#child.stdin.writable) {
      throw new Error('Claude auth login is no longer accepting input.');
    }
    this.#child.stdin.write(`${value}\n`);
  }

  async kill(): Promise<void> {
    if (!this.#closed && !this.#terminationStarted) {
      this.#terminationStarted = true;
      this.#killProcessGroup('SIGTERM');
      this.#forceKillTimer = setTimeout(
        () => this.#killProcessGroup('SIGKILL'),
        TERMINATION_GRACE_MS
      );
      this.#forceKillTimer.unref?.();
    }
    if (this.#closed) return;
    let settleTimer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        this.#closedPromise,
        new Promise<never>((_resolve, reject) => {
          settleTimer = setTimeout(
            () => reject(new Error('Claude auth login process group did not exit.')),
            TERMINATION_SETTLE_MS
          );
          settleTimer.unref?.();
        })
      ]);
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
    }
  }

  #killProcessGroup(signal: NodeJS.Signals): void {
    const processId = this.#child.pid;
    if (processId) {
      try {
        process.kill(-processId, signal);
        return;
      } catch {
        // Fall through when the process group has already exited.
      }
    }
    this.#child.kill(signal);
  }

  onData(listener: (data: Buffer) => void): () => void {
    this.#child.stdout.on('data', listener);
    this.#child.stderr.on('data', listener);
    return () => {
      this.#child.stdout.off('data', listener);
      this.#child.stderr.off('data', listener);
    };
  }

  onExit(listener: (result: ClaudeAuthLoginPtyExit) => void): () => void {
    const existing = this.#exitResult;
    if (existing) {
      let subscribed = true;
      queueMicrotask(() => {
        if (subscribed) listener(existing);
      });
      return () => {
        subscribed = false;
      };
    }
    this.#exitListeners.add(listener);
    return () => {
      this.#exitListeners.delete(listener);
    };
  }

  #recordExit(result: ClaudeAuthLoginPtyExit): void {
    if (this.#exitResult) return;
    this.#exitResult = result;
    for (const listener of this.#exitListeners) listener(result);
    this.#exitListeners.clear();
  }
}

export class ScriptClaudeAuthLoginPtyFactory implements ClaudeAuthLoginPtyFactory {
  readonly #claudeExecutable: string;
  readonly #parentEnvironment: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #spawnProcess: typeof spawn;

  constructor(options: ScriptClaudeAuthLoginPtyFactoryOptions) {
    if (!path.isAbsolute(options.claudeExecutable)) {
      throw new Error('Claude CLI executable must be absolute.');
    }
    this.#claudeExecutable = options.claudeExecutable;
    this.#parentEnvironment = options.parentEnvironment ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#spawnProcess = options.spawnProcess ?? spawn;
  }

  spawn(options: ClaudeAuthLoginPtySpawnOptions): ClaudeAuthLoginPty {
    if (this.#platform !== 'darwin') {
      throw new Error('Claude auth login currently requires macOS.');
    }
    const environment = buildClaudeAuthLoginEnvironment(
      this.#parentEnvironment,
      options.context
    );
    const child = this.#spawnProcess(EXPECT_EXECUTABLE, ['-c', EXPECT_PROGRAM], {
      cwd: options.context.configDirectory,
      env: {
        ...environment,
        [EXPECT_CLAUDE_EXECUTABLE_VARIABLE]: this.#claudeExecutable
      },
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams;
    return new ScriptClaudeAuthLoginPty(child);
  }
}
