import path from 'node:path';
import type { ClaudeAccountExecutionContext } from './claudeAccount.repository';
import {
  assertClaudeSubscriptionPreflight,
  assertClaudeCredentialStorageIsIsolated,
  buildClaudeAuthStatusArguments,
  buildClaudeIsolationArguments,
  runClaudeProcess,
  type ClaudeProcessResult,
  type ClaudeProcessSpawner,
  type ClaudeSubscriptionAuthStatus
} from './claudeCli.executor';
import { buildClaudeSubscriptionEnvironment } from './claudeSubscription.environment';
import { ClaudeRequestAbortedError } from './claudeSubscription.errors';

const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;

export interface ClaudeAccountAuthCli {
  verify(
    context: ClaudeAccountExecutionContext,
    options?: { signal?: AbortSignal }
  ): Promise<ClaudeSubscriptionAuthStatus>;
  logout(
    context: ClaudeAccountExecutionContext,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

export class ClaudeLogoutError extends Error {
  constructor(options?: ErrorOptions) {
    super('Claude CLI could not confirm isolated account logout.', options);
    this.name = 'ClaudeLogoutError';
  }
}

export interface ClaudeCliAccountAuthOptions {
  claudeExecutable: string;
  commandPrefixArguments?: readonly string[];
  timeoutMs?: number;
  parentEnvironment?: NodeJS.ProcessEnv;
  spawnProcess: ClaudeProcessSpawner;
}

export const buildClaudeAuthLogoutArguments = (): string[] => [
  ...buildClaudeIsolationArguments(),
  'auth',
  'logout'
];

export class ClaudeCliAccountAuth implements ClaudeAccountAuthCli {
  readonly #claudeExecutable: string;
  readonly #commandPrefixArguments: readonly string[];
  readonly #timeoutMs: number;
  readonly #parentEnvironment: NodeJS.ProcessEnv;
  readonly #spawnProcess: ClaudeProcessSpawner;

  constructor(options: ClaudeCliAccountAuthOptions) {
    if (!path.isAbsolute(options.claudeExecutable)) {
      throw new Error('Claude CLI executable must be an absolute path.');
    }
    this.#claudeExecutable = options.claudeExecutable;
    this.#commandPrefixArguments = options.commandPrefixArguments ?? [];
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error('Claude account command timeout must be a positive integer.');
    }
    this.#parentEnvironment = options.parentEnvironment ?? process.env;
    this.#spawnProcess = options.spawnProcess;
  }

  async verify(
    context: ClaudeAccountExecutionContext,
    options: { signal?: AbortSignal } = {}
  ): Promise<ClaudeSubscriptionAuthStatus> {
    await assertClaudeCredentialStorageIsIsolated(context);
    const result = await this.#run(buildClaudeAuthStatusArguments(), context, options.signal);
    const status = assertClaudeSubscriptionPreflight(result);
    await assertClaudeCredentialStorageIsIsolated(context);
    return status;
  }

  async logout(
    context: ClaudeAccountExecutionContext,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    try {
      const logout = await this.#run(buildClaudeAuthLogoutArguments(), context, options.signal);
      if (logout.exitCode !== 0) throw new ClaudeLogoutError();
      const status = await this.#run(buildClaudeAuthStatusArguments(), context, options.signal);
      if (status.exitCode !== 1 || !isLoggedOutStatus(status.stdout)) throw new ClaudeLogoutError();
      await assertClaudeCredentialStorageIsIsolated(context);
    } catch (error) {
      if (error instanceof ClaudeRequestAbortedError) throw error;
      if (error instanceof ClaudeLogoutError) throw error;
      throw new ClaudeLogoutError({ cause: error });
    }
  }

  async #run(
    arguments_: readonly string[],
    context: ClaudeAccountExecutionContext,
    signal?: AbortSignal
  ): Promise<ClaudeProcessResult> {
    await assertClaudeCredentialStorageIsIsolated(context);
    try {
      return await runClaudeProcess({
        command: this.#claudeExecutable,
        arguments_: [...this.#commandPrefixArguments, ...arguments_],
        environment: buildClaudeSubscriptionEnvironment(this.#parentEnvironment, context),
        cwd: context.configDirectory,
        stdin: '',
        timeoutMs: this.#timeoutMs,
        stdoutLimitBytes: OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: OUTPUT_LIMIT_BYTES,
        ...(signal ? { signal } : {}),
        spawnProcess: this.#spawnProcess
      });
    } finally {
      await assertClaudeCredentialStorageIsIsolated(context);
    }
  }
}

const isLoggedOutStatus = (stdout: string): boolean => {
  try {
    const value: unknown = JSON.parse(stdout.trim());
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const status = value as Record<string, unknown>;
    const keys = Object.keys(status).sort();
    return (
      keys.length === 3 &&
      keys[0] === 'apiProvider' &&
      keys[1] === 'authMethod' &&
      keys[2] === 'loggedIn' &&
      status.loggedIn === false &&
      status.authMethod === 'none' &&
      status.apiProvider === 'firstParty'
    );
  } catch {
    return false;
  }
};
