import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type {
  CodingAgentDiscoveryIssue,
  CodingAgentDiscoveryResult,
  CodingAgentSessionDraft
} from '@shared/codingAgent/codingAgentSession.type';
import {
  isPlainRecord,
  normalizeClaudeBackgroundState,
  parseClaudeJobId,
  parseNullableText,
  parsePathText,
  parseUuid
} from '@shared/codingAgent/codingAgentSession.contract';
import { CommandFailure, runCommand, type RunCommandResult } from './commandRunner';
import {
  ClaudeExecutableUnavailableError,
  unavailableClaudeExecutableProvider,
  type ClaudeExecutableProvider
} from './claudeExecutable.resolver';

interface CommandInvocation {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

type CommandExecutor = (params: CommandInvocation) => Promise<RunCommandResult>;

export interface ClaudeDiscoveryOptions {
  executableProvider?: ClaudeExecutableProvider;
  timeoutMs?: number;
  maxOutputBytes?: number;
  freshnessMs?: number;
  execute?: CommandExecutor;
  now?: () => number;
  idFactory?: () => string;
}

const issueFromCommand = (error: unknown): CodingAgentDiscoveryIssue => {
  const unavailable =
    error instanceof ClaudeExecutableUnavailableError ||
    (error instanceof CommandFailure && error.code === 'spawn_failed');
  return {
    provider: 'claude',
    code: unavailable ? 'cli-unavailable' : 'command-failed',
    message: error instanceof Error ? error.message : String(error)
  };
};

const hasAllFlag = (help: string): boolean => {
  return /(^|\s)--all(?:\s|,|$)/m.test(help);
};

const parsePid = (value: unknown): boolean | null => {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1) return null;
  return true;
};

const isForegroundInteractiveKind = (kind: unknown): kind is 'interactive' | 'foreground' => {
  // Current Agent View JSON uses `interactive`; older preview builds used `foreground`.
  return kind === 'interactive' || kind === 'foreground';
};

export class ClaudeDiscoveryAdapter {
  private readonly executableProvider: ClaudeExecutableProvider;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly freshnessMs: number;
  private readonly execute: CommandExecutor;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: ClaudeDiscoveryOptions = {}) {
    this.executableProvider = options.executableProvider ?? unavailableClaudeExecutableProvider;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    this.freshnessMs = options.freshnessMs ?? 15_000;
    this.execute = options.execute ?? runCommand;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private invocation(args: readonly string[]): CommandInvocation {
    return {
      executable: this.executableProvider.resolve(),
      args,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes
    };
  }

  async discover(): Promise<CodingAgentDiscoveryResult> {
    let help: RunCommandResult;
    try {
      help = await this.execute(this.invocation(['agents', '--help']));
    } catch (error) {
      return {
        provider: 'claude',
        sessions: [],
        issues: [issueFromCommand(error)],
        snapshot: { status: 'failed' }
      };
    }
    if (!/(^|\s)--json(?:\s|,|$)/m.test(help.stdout)) {
      return {
        provider: 'claude',
        sessions: [],
        issues: [
          {
            provider: 'claude',
            code: 'unsupported-entry',
            message: 'Installed Claude Code CLI does not advertise agents --json'
          }
        ],
        snapshot: { status: 'failed' },
        supportsCompletedSessions: false
      };
    }
    const supportsCompletedSessions = hasAllFlag(help.stdout);
    const args = ['agents', '--json', ...(supportsCompletedSessions ? ['--all'] : [])];
    let output: RunCommandResult;
    try {
      output = await this.execute(this.invocation(args));
    } catch (error) {
      return {
        provider: 'claude',
        sessions: [],
        issues: [issueFromCommand(error)],
        snapshot: { status: 'failed' },
        supportsCompletedSessions
      };
    }

    let entries: unknown;
    try {
      entries = JSON.parse(output.stdout);
    } catch {
      return {
        provider: 'claude',
        sessions: [],
        issues: [
          {
            provider: 'claude',
            code: 'invalid-output',
            message: 'claude agents --json returned invalid JSON'
          }
        ],
        snapshot: { status: 'failed' },
        supportsCompletedSessions
      };
    }
    if (!Array.isArray(entries)) {
      return {
        provider: 'claude',
        sessions: [],
        issues: [
          {
            provider: 'claude',
            code: 'invalid-output',
            message: 'claude agents --json must return a JSON array'
          }
        ],
        snapshot: { status: 'failed' },
        supportsCompletedSessions
      };
    }

    const sessions: CodingAgentSessionDraft[] = [];
    const issues: CodingAgentDiscoveryIssue[] = [];
    const observedAt = this.now();
    for (const [entryIndex, entry] of entries.entries()) {
      if (
        !isPlainRecord(entry) ||
        (!isForegroundInteractiveKind(entry.kind) && entry.kind !== 'background')
      ) {
        issues.push({
          provider: 'claude',
          code: 'unsupported-entry',
          message: 'Claude agents entry has an unsupported kind',
          entryIndex
        });
        continue;
      }
      if (!Number.isFinite(entry.startedAt) || (entry.startedAt as number) < 0) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: 'Claude agents entry has an invalid startedAt timestamp',
          entryIndex
        });
        continue;
      }
      let externalSessionId: string;
      try {
        externalSessionId = parseUuid(entry.sessionId, 'Claude sessionId');
      } catch {
        issues.push({
          provider: 'claude',
          code: 'missing-session-id',
          message: 'Claude agents entry has no valid conversation sessionId',
          entryIndex
        });
        continue;
      }
      let cwd: string | null;
      try {
        cwd = parsePathText(entry.cwd);
      } catch (error) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error),
          entryIndex
        });
        continue;
      }
      if (cwd === null) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: 'Claude agents entry is missing cwd',
          entryIndex
        });
        continue;
      }
      if (!isAbsolute(cwd)) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: 'Claude agents cwd must be an absolute path',
          entryIndex
        });
        continue;
      }
      let title: string | null;
      try {
        title = parseNullableText(entry.name, 'Claude agent name', 300);
      } catch (error) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error),
          entryIndex
        });
        continue;
      }
      const isInteractive = isForegroundInteractiveKind(entry.kind);
      const isProcessAlive = parsePid(entry.pid);
      const hasBackgroundPid = entry.pid !== undefined && entry.pid !== null;
      if (isProcessAlive === null && (isInteractive || hasBackgroundPid)) {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: isInteractive
            ? 'Claude interactive agents entry is missing a valid live pid'
            : 'Claude agents entry has an invalid pid',
          entryIndex
        });
      }
      if (isInteractive) {
        sessions.push({
          id: this.idFactory(),
          provider: 'claude',
          surface: 'claude-code-cli',
          externalSessionId,
          runtimeJobId: null,
          title,
          titleIsCustom: false,
          cwd,
          state: 'unknown',
          lastTurnState: 'unknown',
          providerState: entry.kind,
          statusSource: 'none',
          statusObservedAt: null,
          statusFreshUntil: null,
          isProcessAlive
        });
        continue;
      }

      let runtimeJobId: string | null = null;
      if (entry.id !== undefined && entry.id !== null) {
        try {
          runtimeJobId = parseClaudeJobId(entry.id);
        } catch (error) {
          issues.push({
            provider: 'claude',
            code: 'invalid-entry',
            message: error instanceof Error ? error.message : String(error),
            entryIndex
          });
        }
      } else {
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: 'Claude background entry is missing its attach job id',
          entryIndex
        });
      }
      const normalized = normalizeClaudeBackgroundState(entry.state, entry.waitingFor);
      if (!normalized.recognized) {
        issues.push({
          provider: 'claude',
          code: 'unsupported-entry',
          message: `Claude background state is unsupported: ${String(entry.state)}`,
          entryIndex
        });
      }
      const backgroundProcessAlive =
        entry.pid === undefined || entry.pid === null ? false : parsePid(entry.pid);
      sessions.push({
        id: this.idFactory(),
        provider: 'claude',
        surface: 'claude-code-background',
        externalSessionId,
        runtimeJobId,
        title,
        titleIsCustom: false,
        cwd,
        state: normalized.state,
        lastTurnState: normalized.lastTurnState,
        providerState: normalized.providerState,
        statusSource: 'claude-agents-cli',
        statusObservedAt: observedAt,
        statusFreshUntil: observedAt + this.freshnessMs,
        isProcessAlive: backgroundProcessAlive
      });
    }
    return {
      provider: 'claude',
      sessions,
      issues,
      snapshot:
        issues.length === 0
          ? { status: 'success', observedAt, freshUntil: observedAt + this.freshnessMs }
          : { status: 'failed' },
      supportsCompletedSessions
    };
  }
}
