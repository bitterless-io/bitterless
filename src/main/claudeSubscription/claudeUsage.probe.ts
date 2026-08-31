import type { ClaudeAccountExecutionContext } from './claudeAccount.repository';
import { buildClaudeSubscriptionEnvironment } from './claudeSubscription.environment';

/**
 * Reads an account's remaining subscription quota.
 *
 * The quota percentage is **not** in `rate_limit_event` — that carries a window, a
 * status and a reset time and nothing else, which is why the panel could only show a
 * window until now. It comes from the CLI's own `/usage` report instead.
 *
 * Running `claude -p '/usage'` rather than calling `GET /api/oauth/usage` directly is
 * the point: the endpoint would require Bitterless to read the OAuth token, and the
 * whole account design rests on the CLI owning that credential. The report costs
 * nothing — a probe returns `num_turns: 0`, zero tokens and `total_cost_usd: 0`, so it
 * is safe to poll.
 */
export interface ClaudeUsageWindow {
  /** Anthropic's own label, e.g. `session`, `week (all models)`. */
  label: string;
  usedPercent: number;
  resetsAt?: string;
}

export interface ClaudeUsageReport {
  windows: ClaudeUsageWindow[];
  /** `Current session` — the five-hour window. */
  sessionUsedPercent?: number;
  /** `Current week (all models)` — the one the switching policy watches. */
  weekUsedPercent?: number;
  sessionResetsAt?: string;
  weekResetsAt?: string;
  observedAt: number;
}

const USAGE_LINE =
  /^Current\s+([^:]+):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/gimu;

/**
 * Parses the human-readable report. It is prose, not an API, so every field is
 * optional and an unparsed line is dropped rather than guessed at — a wrong quota
 * number would silently mis-route every request that follows.
 */
export const parseClaudeUsageReport = (text: string, now: number): ClaudeUsageReport => {
  const windows: ClaudeUsageWindow[] = [];
  USAGE_LINE.lastIndex = 0;
  for (const match of text.matchAll(USAGE_LINE)) {
    const label = match[1]?.trim().toLowerCase();
    const percent = Number(match[2]);
    if (!label || !Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    windows.push({
      label,
      usedPercent: percent,
      ...(match[3] ? { resetsAt: match[3].trim() } : {})
    });
  }
  const session = windows.find((window) => window.label.startsWith('session'));
  // "week (all models)" on some plans, "week" on others; a per-model week line may
  // also appear, and the all-models one is the limit that stops every request.
  const week =
    windows.find((window) => window.label.startsWith('week (all')) ??
    windows.find((window) => window.label.startsWith('week'));
  return {
    windows,
    ...(session ? { sessionUsedPercent: session.usedPercent } : {}),
    ...(session?.resetsAt ? { sessionResetsAt: session.resetsAt } : {}),
    ...(week ? { weekUsedPercent: week.usedPercent } : {}),
    ...(week?.resetsAt ? { weekResetsAt: week.resetsAt } : {}),
    observedAt: now
  };
};

export interface ClaudeUsageProbeProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ClaudeUsageProbeOptions {
  claudeExecutable: string;
  spawnProcess: (
    command: string,
    arguments_: readonly string[],
    environment: Readonly<Record<string, string>>,
    cwd: string
  ) => ClaudeUsageProbeProcess;
  parentEnvironment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  now?: () => number;
}

export interface ClaudeUsageProbe {
  probe(context: ClaudeAccountExecutionContext): Promise<ClaudeUsageReport | null>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ClaudeCliUsageProbe implements ClaudeUsageProbe {
  readonly #options: ClaudeUsageProbeOptions;

  constructor(options: ClaudeUsageProbeOptions) {
    this.#options = options;
  }

  /**
   * Returns `null` rather than throwing on any failure. A quota reading is an
   * optimisation for routing; losing it must never fail a request or hide an account.
   */
  async probe(context: ClaudeAccountExecutionContext): Promise<ClaudeUsageReport | null> {
    const now = this.#options.now ?? Date.now;
    const environment = buildClaudeSubscriptionEnvironment(
      this.#options.parentEnvironment ?? process.env,
      context
    );
    return await new Promise<ClaudeUsageReport | null>((resolve) => {
      let settled = false;
      let stdout = '';
      const finish = (value: ClaudeUsageReport | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill('SIGKILL');
        } catch {
          // The child has already exited.
        }
        resolve(value);
      };
      const child = this.#options.spawnProcess(
        this.#options.claudeExecutable,
        ['-p', '/usage', '--output-format', 'json'],
        environment,
        context.configDirectory
      );
      const timer = setTimeout(
        () => finish(null),
        this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );
      timer.unref?.();
      child.stdout?.on('data', (chunk) => {
        // Bounded: the report is prose and short, and an unbounded child must not be
        // able to grow this process's memory.
        if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8');
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (code !== 0) {
          finish(null);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout);
          const result =
            typeof parsed === 'object' && parsed !== null
              ? (parsed as { result?: unknown }).result
              : undefined;
          if (typeof result !== 'string') {
            finish(null);
            return;
          }
          const report = parseClaudeUsageReport(result, now());
          finish(report.windows.length > 0 ? report : null);
        } catch {
          finish(null);
        }
      });
    });
  }
}
