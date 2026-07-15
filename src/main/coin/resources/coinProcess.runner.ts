import { spawn } from 'node:child_process';

export type CoinProcessErrorCode = 'aborted' | 'output-limit' | 'process-failed' | 'timeout';

export class CoinProcessError extends Error {
  constructor(
    readonly code: CoinProcessErrorCode,
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'CoinProcessError';
  }
}

export interface CoinProcessRequest {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface CoinProcessResult {
  stdout: string;
  stderr: string;
}

export type CoinProcessRunner = (request: CoinProcessRequest) => Promise<CoinProcessResult>;

export const runCoinProcess: CoinProcessRunner = async (request) =>
  await new Promise<CoinProcessResult>((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(new CoinProcessError('aborted', 'Process was cancelled.'));
      return;
    }
    const child = spawn(request.command, [...request.args], {
      env: request.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
    const cleanup = (): void => {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: CoinProcessError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stop();
      reject(error);
    };
    const onAbort = (): void => fail(new CoinProcessError('aborted', 'Process was cancelled.'));
    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > request.maxOutputBytes) {
        fail(
          new CoinProcessError(
            'output-limit',
            'Process output exceeded the configured limit.',
            Buffer.concat(stderr).toString('utf8'),
          ),
        );
        return;
      }
      target.push(Buffer.from(chunk));
    };
    const timeout = setTimeout(
      () =>
        fail(
          new CoinProcessError(
            'timeout',
            'Process timed out.',
            Buffer.concat(stderr).toString('utf8'),
          ),
        ),
      request.timeoutMs,
    );

    request.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.once('error', () => fail(new CoinProcessError('process-failed', 'Process failed to start.')));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new CoinProcessError('process-failed', 'Process exited unsuccessfully.', stderrText));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: stderrText,
      });
    });
  });
