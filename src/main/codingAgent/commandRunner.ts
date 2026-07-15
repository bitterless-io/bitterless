import { spawn } from 'node:child_process';

export type CommandFailureCode = 'spawn_failed' | 'timeout' | 'output_limit' | 'non_zero_exit';

export class CommandFailure extends Error {
  constructor(
    readonly code: CommandFailureCode,
    message: string,
    readonly stderr = ''
  ) {
    super(message);
    this.name = 'CommandFailure';
  }
}

export interface RunCommandParams {
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

const assertPositiveLimit = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

export const runCommand = (params: RunCommandParams): Promise<RunCommandResult> => {
  const timeoutMs = assertPositiveLimit(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const maxOutputBytes = assertPositiveLimit(
    params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxOutputBytes'
  );
  if (!params.executable.trim()) throw new Error('executable is required');

  return new Promise((resolve, reject) => {
    const child = spawn(params.executable, [...params.args], {
      cwd: params.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const stop = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 250);
      forceKill.unref();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      reject(error);
    };
    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        fail(
          new CommandFailure(
            'output_limit',
            `Command output exceeded ${maxOutputBytes} bytes`,
            Buffer.concat(stderr).toString('utf8')
          )
        );
        return;
      }
      target.push(Buffer.from(chunk));
    };

    const timeout = setTimeout(() => {
      fail(
        new CommandFailure(
          'timeout',
          `Command timed out after ${timeoutMs}ms`,
          Buffer.concat(stderr).toString('utf8')
        )
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.once('error', (error) => {
      fail(new CommandFailure('spawn_failed', `Unable to start command: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(
          new CommandFailure(
            'non_zero_exit',
            `Command exited with ${code ?? signal ?? 'unknown status'}`,
            stderrText
          )
        );
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
};
