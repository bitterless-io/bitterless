import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ClaudeBridgePayload,
  ClaudeCliModel,
  ClaudeDecision,
  ClaudeEffort,
  ClaudeNormalizedCodexTool,
  ClaudeUsageEnvelope
} from '@shared/claudeSubscription/claudeSubscription.contract';
import type { ClaudeAccountExecutionContext } from './claudeAccount.repository';
import { buildClaudeSubscriptionEnvironment } from './claudeSubscription.environment';
import {
  ClaudeAuthenticationError,
  ClaudeDecisionError,
  ClaudeExecutionError,
  ClaudeRequestAbortedError,
  ClaudeSubscriptionRequiredError,
  ClaudeTimeoutError,
  ClaudeUsageLimitError
} from './claudeSubscription.errors';

const MEBIBYTE = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_STATUS_TIMEOUT_MS = 15 * 1000;
const AUTH_STATUS_OUTPUT_LIMIT_BYTES = MEBIBYTE;
const TERMINATION_GRACE_MS = 1_000;
const PLAINTEXT_FALLBACK_FILE = '.credentials.json';

export type { ClaudeEffort } from '@shared/claudeSubscription/claudeSubscription.contract';

export interface ClaudeExecutionRequest {
  model: ClaudeCliModel;
  effort: ClaudeEffort;
  payload: ClaudeBridgePayload;
  context: ClaudeAccountExecutionContext;
}

export interface ClaudeExecutionResult {
  decision: ClaudeDecision;
  rawUsage: ClaudeUsageEnvelope;
}

export interface ClaudeExecutor {
  execute(
    request: ClaudeExecutionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ClaudeExecutionResult>;
}

export const CLAUDE_ISOLATED_SETTINGS = {
  apiKeyHelper: null
} as const;

/**
 * `--json-schema` becomes a tool `input_schema` on the wire, so it is bound by
 * Anthropic's tool-schema restrictions rather than by plain JSON Schema. A
 * top-level `oneOf` is rejected outright with
 * `400 … input_schema does not support oneOf, allOf, or anyOf at the top level`,
 * which failed every request before the model was ever reached.
 *
 * The variants are therefore flattened into one object with an enum `action`.
 * Nothing is lost: `validateClaudeDecision` already enforces the per-variant
 * required fields and rejects cross-variant contamination, independently of this
 * schema — see docs/issues/claude-subscription-decision-schema-rejected.md.
 */
export const CLAUDE_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['final', 'tool_call'] },
    text: { type: 'string' },
    tool_name: { type: 'string' },
    arguments: { type: 'string' }
  },
  required: ['action'],
  additionalProperties: false
} as const;

const CLAUDE_SYSTEM_PROMPT = `You are the reasoning model inside OpenAI Codex.
Codex owns every external tool, filesystem operation, approval, and user interaction. You must not execute tools yourself.
You receive a JSON payload containing Codex instructions, the ordered conversation, and the Codex functions available for this turn.

Choose exactly one action:
- final: return the assistant response in the text field when no tool is needed.
- tool_call: request exactly one Codex tool. tool_name must exactly match an available tool's decision_name and arguments must be a JSON-encoded object matching its parameters.

Follow the Codex instruction hierarchy and conversation. Never claim a tool ran unless its function_call_output appears in the conversation. Images are not forwarded; request a listed Codex image tool when inspection is needed. Do not wrap the structured decision in Markdown.`;

export interface ClaudeCliExecutorOptions {
  claudeExecutable: string;
  commandPrefixArguments?: readonly string[];
  timeoutMs?: number;
  authStatusTimeoutMs?: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  parentEnvironment?: NodeJS.ProcessEnv;
  spawnProcess?: ClaudeProcessSpawner;
}

export type ClaudeProcessSpawner = (
  command: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
  cwd: string
) => ChildProcessWithoutNullStreams;

export const buildClaudeIsolationArguments = (): string[] => [
  '--safe-mode',
  '--setting-sources',
  '',
  '--settings',
  JSON.stringify(CLAUDE_ISOLATED_SETTINGS)
];

export const buildClaudeAuthStatusArguments = (): string[] => [
  ...buildClaudeIsolationArguments(),
  'auth',
  'status',
  '--json'
];

export const buildClaudeExecutionArguments = (
  model: ClaudeCliModel,
  effort: ClaudeEffort,
  systemPromptPath: string
): string[] => [
  ...buildClaudeIsolationArguments(),
  '-p',
  '--model',
  model,
  '--effort',
  effort,
  '--no-chrome',
  '--tools',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  JSON.stringify({ mcpServers: {} }),
  '--no-session-persistence',
  '--system-prompt-file',
  systemPromptPath,
  '--output-format',
  'json',
  '--json-schema',
  JSON.stringify(CLAUDE_DECISION_SCHEMA)
];

export class ClaudeCliExecutor implements ClaudeExecutor {
  readonly #claudeExecutable: string;
  readonly #commandPrefixArguments: readonly string[];
  readonly #timeoutMs: number;
  readonly #authStatusTimeoutMs: number;
  readonly #stdoutLimitBytes: number;
  readonly #stderrLimitBytes: number;
  readonly #parentEnvironment: NodeJS.ProcessEnv;
  readonly #spawnProcess: NonNullable<ClaudeCliExecutorOptions['spawnProcess']>;

  constructor(options: ClaudeCliExecutorOptions) {
    if (!path.isAbsolute(options.claudeExecutable)) {
      throw new Error('Claude CLI executable must be an absolute path.');
    }
    this.#claudeExecutable = path.resolve(options.claudeExecutable);
    this.#commandPrefixArguments = options.commandPrefixArguments ?? [];
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#authStatusTimeoutMs = options.authStatusTimeoutMs ?? DEFAULT_AUTH_STATUS_TIMEOUT_MS;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error('Claude execution timeout must be a positive integer.');
    }
    if (!Number.isInteger(this.#authStatusTimeoutMs) || this.#authStatusTimeoutMs <= 0) {
      throw new Error('Claude authentication timeout must be a positive integer.');
    }
    this.#stdoutLimitBytes = options.stdoutLimitBytes ?? 32 * MEBIBYTE;
    this.#stderrLimitBytes = options.stderrLimitBytes ?? 4 * MEBIBYTE;
    this.#parentEnvironment = options.parentEnvironment ?? process.env;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_, environment, cwd) =>
        spawn(command, [...arguments_], {
          cwd,
          env: { ...environment },
          stdio: ['pipe', 'pipe', 'pipe']
        }));
  }

  async execute(
    request: ClaudeExecutionRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<ClaudeExecutionResult> {
    if (options.signal?.aborted) throw new ClaudeRequestAbortedError();

    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'bitterless-claude-subscription-')
    );
    const systemPromptPath = path.join(temporaryDirectory, 'system-prompt.txt');
    try {
      await writeFile(systemPromptPath, CLAUDE_SYSTEM_PROMPT, { mode: 0o600, flag: 'wx' });
      const environment = buildClaudeSubscriptionEnvironment(
        this.#parentEnvironment,
        request.context
      );
      await assertClaudeCredentialStorageIsIsolated(request.context);
      let authStatusResult: ClaudeProcessResult;
      try {
        authStatusResult = await runClaudeProcess({
          command: this.#claudeExecutable,
          arguments_: [...this.#commandPrefixArguments, ...buildClaudeAuthStatusArguments()],
          environment,
          cwd: temporaryDirectory,
          stdin: '',
          timeoutMs: this.#authStatusTimeoutMs,
          stdoutLimitBytes: AUTH_STATUS_OUTPUT_LIMIT_BYTES,
          stderrLimitBytes: AUTH_STATUS_OUTPUT_LIMIT_BYTES,
          ...(options.signal ? { signal: options.signal } : {}),
          spawnProcess: this.#spawnProcess
        });
      } catch (error) {
        if (error instanceof ClaudeRequestAbortedError) throw error;
        throw new ClaudeAuthenticationError(
          'Claude authentication could not be verified. Reconnect the account.'
        );
      } finally {
        await assertClaudeCredentialStorageIsIsolated(request.context);
      }
      assertClaudeSubscriptionPreflight(authStatusResult);

      let processResult: ClaudeProcessResult;
      try {
        processResult = await runClaudeProcess({
          command: this.#claudeExecutable,
          arguments_: [
            ...this.#commandPrefixArguments,
            ...buildClaudeExecutionArguments(request.model, request.effort, systemPromptPath)
          ],
          environment,
          cwd: temporaryDirectory,
          stdin: JSON.stringify(request.payload),
          timeoutMs: this.#timeoutMs,
          stdoutLimitBytes: this.#stdoutLimitBytes,
          stderrLimitBytes: this.#stderrLimitBytes,
          ...(options.signal ? { signal: options.signal } : {}),
          spawnProcess: this.#spawnProcess
        });
      } finally {
        await assertClaudeCredentialStorageIsIsolated(request.context);
      }
      return parseClaudeExecutionResult(processResult, request.payload.available_tools);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export interface ClaudeProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export const assertClaudeCredentialStorageIsIsolated = async (
  context: ClaudeAccountExecutionContext
): Promise<void> => {
  const fallbackPath = path.join(
    context.secureStorageConfigDirectory,
    PLAINTEXT_FALLBACK_FILE
  );
  try {
    await lstat(fallbackPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new ClaudeAuthenticationError(
      'Claude isolated credential storage could not be verified. Reconnect the account.'
    );
  }
  // Remove only the exact managed fallback entry without reading or following it.
  await rm(fallbackPath, { force: true }).catch(() => undefined);
  throw new ClaudeAuthenticationError(
    'Claude CLI used an unsupported plaintext credential fallback. Reconnect the account.'
  );
};

export interface ClaudeSubscriptionAuthStatus {
  loggedIn: true;
  authMethod: 'claude.ai';
  apiProvider: 'firstParty';
  subscriptionType: 'pro' | 'max' | 'team' | 'enterprise';
  email?: string;
}

const PAID_SUBSCRIPTION_TYPES = new Set(['pro', 'max', 'team', 'enterprise']);

export const assertClaudeSubscriptionPreflight = (
  processResult: ClaudeProcessResult
): ClaudeSubscriptionAuthStatus => {
  if (processResult.exitCode !== 0) throw new ClaudeAuthenticationError();

  let status: unknown;
  try {
    status = JSON.parse(processResult.stdout.trim());
  } catch {
    throw new ClaudeAuthenticationError(
      'Claude authentication could not be verified. Reconnect the account.'
    );
  }

  if (
    !isObject(status) ||
    status.loggedIn !== true ||
    status.authMethod !== 'claude.ai' ||
    status.apiProvider !== 'firstParty' ||
    Object.prototype.hasOwnProperty.call(status, 'apiKeySource') ||
    (Object.prototype.hasOwnProperty.call(status, 'forcedLoginMethod') &&
      status.forcedLoginMethod !== 'claudeai')
  ) {
    throw new ClaudeAuthenticationError(
      'Claude subscription OAuth is not the active credential. Remove managed API-key helpers and reconnect the account.'
    );
  }
  if (
    typeof status.subscriptionType !== 'string' ||
    !PAID_SUBSCRIPTION_TYPES.has(status.subscriptionType)
  ) {
    throw new ClaudeSubscriptionRequiredError();
  }
  if (
    status.email !== undefined &&
    status.email !== null &&
    (typeof status.email !== 'string' ||
      status.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+$/u.test(status.email))
  ) {
    throw new ClaudeAuthenticationError(
      'Claude authentication returned invalid account metadata. Reconnect the account.'
    );
  }
  const subscriptionType =
    status.subscriptionType as ClaudeSubscriptionAuthStatus['subscriptionType'];
  return {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    subscriptionType,
    ...(typeof status.email === 'string' && status.email.length > 0 ? { email: status.email } : {})
  };
};

export interface RunClaudeProcessOptions {
  command: string;
  arguments_: readonly string[];
  environment: Readonly<Record<string, string>>;
  cwd: string;
  stdin: string;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  signal?: AbortSignal;
  spawnProcess: ClaudeProcessSpawner;
}

export const runClaudeProcess = (options: RunClaudeProcessOptions): Promise<ClaudeProcessResult> =>
  new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = options.spawnProcess(
        options.command,
        options.arguments_,
        options.environment,
        options.cwd
      );
    } catch (error) {
      reject(new ClaudeExecutionError('Claude CLI could not be started.', { cause: error }));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: Error | undefined;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const timeout = setTimeout(() => {
      terminate(new ClaudeTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
    timeout.unref?.();

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', abort);
    };

    const finishWithError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const terminate = (error: Error): void => {
      if (terminalError || settled) return;
      terminalError = error;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), TERMINATION_GRACE_MS);
      forceKillTimer.unref?.();
    };

    const abort = (): void => {
      terminate(new ClaudeRequestAbortedError());
    };

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    child.stdout.on('data', (chunk: Buffer) => {
      if (terminalError) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.stdoutLimitBytes) {
        terminate(new ClaudeExecutionError('Claude CLI stdout exceeded its output limit.'));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (terminalError) return;
      stderrBytes += chunk.length;
      if (stderrBytes > options.stderrLimitBytes) {
        terminate(new ClaudeExecutionError('Claude CLI stderr exceeded its output limit.'));
        return;
      }
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      finishWithError(
        new ClaudeExecutionError('Claude CLI could not be started.', { cause: error })
      );
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminalError) {
        reject(terminalError);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal
      });
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin);
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonDecision = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ClaudeDecisionError('Claude CLI did not return valid JSON output.', {
      cause: error
    });
  }
};

const usageEnvelope = (value: Record<string, unknown>): ClaudeUsageEnvelope => ({
  ...(isObject(value.usage) ? { usage: value.usage } : {}),
  ...(isObject(value.modelUsage) ? { modelUsage: value.modelUsage } : {})
});

export const parseClaudeExecutionResult = (
  processResult: ClaudeProcessResult,
  availableTools: readonly ClaudeNormalizedCodexTool[]
): ClaudeExecutionResult => {
  let envelope: unknown;
  try {
    envelope = JSON.parse(processResult.stdout.trim());
  } catch {
    throwClassifiedExecutionError(
      `${processResult.stdout}\n${processResult.stderr}`,
      processResult.exitCode
    );
  }
  if (!isObject(envelope)) {
    throw new ClaudeDecisionError('Claude CLI returned an invalid result envelope.');
  }

  const diagnostic = [
    typeof envelope.result === 'string' ? envelope.result : '',
    typeof envelope.subtype === 'string' ? envelope.subtype : '',
    processResult.stderr
  ].join('\n');
  if (envelope.is_error === true || processResult.exitCode !== 0) {
    throwClassifiedExecutionError(diagnostic, processResult.exitCode, envelope);
  }

  let decisionValue = envelope.structured_output;
  if (decisionValue === undefined && typeof envelope.result === 'string') {
    decisionValue = parseJsonDecision(envelope.result);
  }
  return {
    decision: validateClaudeDecision(decisionValue, availableTools),
    rawUsage: usageEnvelope(envelope)
  };
};

const throwClassifiedExecutionError = (
  diagnostic: string,
  exitCode: number | null,
  envelope?: Record<string, unknown>
): never => {
  if (
    /usage[ _-]?limit|out of usage credits|hit (?:your|the) limit|rate_limit_error|resets? at/iu.test(
      diagnostic
    )
  ) {
    throw new ClaudeUsageLimitError(
      'The Claude subscription account has reached its usage limit.',
      extractResetAt(envelope, diagnostic)
    );
  }
  if (
    /failed to authenticate|authentication (?:failed|required)|oauth session expired|not logged in|invalid (?:oauth )?token|token (?:expired|revoked)|unauthorized/iu.test(
      diagnostic
    )
  ) {
    throw new ClaudeAuthenticationError();
  }
  if (exitCode !== 0) throw new ClaudeExecutionError('Claude CLI exited unsuccessfully.');
  throw new ClaudeDecisionError('Claude CLI did not return a usable structured decision.');
};

const extractResetAt = (
  envelope: Record<string, unknown> | undefined,
  diagnostic: string
): number | undefined => {
  const candidates: unknown[] = envelope
    ? [envelope.reset_at, envelope.resetAt, envelope.resets_at, envelope.resetsAt]
    : [];
  const timestampMatch = diagnostic.match(/(?:reset(?:s|_at)?|available)\D{0,20}(\d{10,13})/iu);
  if (timestampMatch?.[1]) candidates.push(timestampMatch[1]);
  const isoMatch = diagnostic.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/u
  );
  if (isoMatch?.[0]) candidates.push(isoMatch[0]);

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate < 10_000_000_000 ? candidate * 1_000 : candidate;
    }
    if (typeof candidate !== 'string') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    }
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

/**
 * Since the schema flattened both variants into one object, a structured-output
 * model may echo the unused variant's fields as empty strings. Those carry no
 * decision and are ignored; a *populated* foreign field means the decision is
 * genuinely ambiguous and is still rejected.
 */
const hasForeignField = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.entries(value).some(([key, entry]) => {
    if (allowed.includes(key)) return false;
    return entry !== undefined && entry !== null && entry !== '';
  });

export const validateClaudeDecision = (
  value: unknown,
  availableTools: readonly ClaudeNormalizedCodexTool[]
): ClaudeDecision => {
  if (!isObject(value))
    throw new ClaudeDecisionError('Claude did not return a structured decision.');
  if (value.action === 'final') {
    if (typeof value.text !== 'string') {
      throw new ClaudeDecisionError('Claude final decisions require text.');
    }
    if (hasForeignField(value, ['action', 'text'])) {
      throw new ClaudeDecisionError('Claude final decisions contain unsupported fields.');
    }
    return { action: 'final', text: value.text };
  }
  if (value.action !== 'tool_call') {
    throw new ClaudeDecisionError('Claude returned an unknown decision action.');
  }
  const selectedTool =
    typeof value.tool_name === 'string'
      ? availableTools.find((tool) => tool.decision_name === value.tool_name)
      : undefined;
  if (!selectedTool) {
    throw new ClaudeDecisionError('Claude requested an unavailable Codex tool.');
  }
  if (typeof value.arguments !== 'string') {
    throw new ClaudeDecisionError('Claude tool arguments must be a JSON string.');
  }
  if (hasForeignField(value, ['action', 'tool_name', 'arguments'])) {
    throw new ClaudeDecisionError('Claude tool decisions contain unsupported fields.');
  }

  const parsedArguments = parseJsonDecision(value.arguments);
  if (!isObject(parsedArguments)) {
    throw new ClaudeDecisionError('Claude tool arguments must encode a JSON object.');
  }
  return {
    action: 'tool_call',
    toolName: selectedTool.name,
    ...(selectedTool.namespace ? { toolNamespace: selectedTool.namespace } : {}),
    argumentsJson: value.arguments
  };
};
