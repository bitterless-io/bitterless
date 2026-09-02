import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5_000;

export interface ClaudeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const runClaudeCommand = (
  executable: string,
  args: readonly string[],
  options: { timeoutMs?: number; maxOutputBytes?: number; configDirectory?: string | null } = {}
): Promise<ClaudeCommandResult> => new Promise((resolve, reject) => {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  // A target configDirectory scopes this one Claude CLI invocation to that environment's
  // CLAUDE_CONFIG_DIR; omitting it (every pre-086 caller) reproduces today's exact ambient
  // environment unchanged.
  const env = options.configDirectory
    ? { ...process.env, CLAUDE_CONFIG_DIR: options.configDirectory }
    : process.env;
  const child = spawn(executable, [...args], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  let terminatingError: Error | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  const timer = setTimeout(() => {
    terminate(new Error('Claude command timed out'));
  }, timeoutMs);
  const finish = (error?: Error, exitCode?: number): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.stdout.destroy();
    child.stderr.destroy();
    if (error) reject(error);
    else resolve({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      exitCode: exitCode ?? -1
    });
  };
  const terminate = (error: Error): void => {
    if (settled || terminatingError) return;
    terminatingError = error;
    child.stdout.removeAllListeners('data');
    child.stderr.removeAllListeners('data');
    child.kill();
    killTimer = setTimeout(() => {
      if (!settled && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1_000);
  };
  const collect = (target: Buffer[]) => (chunk: Buffer | string): void => {
    if (settled || terminatingError) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxOutputBytes) {
      terminate(new Error('Claude command output exceeded its size limit'));
      return;
    }
    target.push(buffer);
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.once('error', () => finish(new Error('Unable to start Claude command')));
  child.once('close', (code) => finish(terminatingError ?? undefined, code ?? -1));
});
