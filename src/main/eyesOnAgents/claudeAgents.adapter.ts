import type { EyesOnAgentsClaudeAgentState, EyesOnAgentsRuntimeState } from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  isEyesOnAgentsRecord,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsText,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { runClaudeCommand, type ClaudeCommandResult } from './claudeCommand.runner';

type Runner = (executable: string, args: readonly string[]) => Promise<ClaudeCommandResult>;

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const result = Math.floor(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isSafeInteger(result) ? result : null;
  }
  if (typeof value === 'string') {
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  }
  return null;
};

const stateFromAgent = (record: Record<string, unknown>): EyesOnAgentsRuntimeState => {
  const mode = record.type ?? record.mode ?? record.kind;
  const state = record.state ?? record.status;
  const background = mode === 'background' || mode === 'bg' || record.background === true;
  if (!background && (state === undefined || state === null)) return 'unknown';
  if (background && (state === undefined || state === null)) return 'working';
  if (state === 'working' || state === 'running' || state === 'active') return 'working';
  if (state === 'blocked' || state === 'waiting') return 'waiting_input';
  if (state === 'done' || state === 'completed') return 'idle';
  if (state === 'failed' || state === 'error') return 'failed';
  if (state === 'stopped' || state === 'ended') return 'ended';
  return 'unknown';
};

const optionalText = (value: unknown): string | null => {
  try { return parseEyesOnAgentsText(value, 'Claude agent name', 300); } catch { return null; }
};

const optionalPath = (value: unknown): string | null => {
  try { return parseEyesOnAgentsPath(value); } catch { return null; }
};

export const parseClaudeAgentsJson = (
  value: unknown,
  observedAt: number
): EyesOnAgentsClaudeAgentState[] => {
  const list = Array.isArray(value)
    ? value
    : isEyesOnAgentsRecord(value) && Array.isArray(value.agents)
      ? value.agents
      : null;
  if (list === null || list.length > 10_000) throw new Error('Claude agents JSON is invalid');
  const rows: EyesOnAgentsClaudeAgentState[] = [];
  for (const item of list) {
    if (!isEyesOnAgentsRecord(item)) continue;
    try {
      rows.push({
        threadId: parseEyesOnAgentsUuid(
          item.sessionId ?? item.session_id ?? item.cliSessionId,
          'Claude Agent View session ID'
        ),
        runtimeState: stateFromAgent(item),
        title: optionalText(item.name ?? item.title),
        cwd: optionalPath(item.cwd),
        startedAt: (() => {
          const value = parseTimestamp(item.startedAt ?? item.started_at);
          return value !== null && value <= observedAt ? value : null;
        })(),
        observedAt
      });
    } catch {
      // Ignore one malformed provider row.
    }
  }
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.threadId, (counts.get(row.threadId) ?? 0) + 1);
  return rows.filter((row) => counts.get(row.threadId) === 1);
};

export class ClaudeAgentsAdapter {
  private supportsAgents: boolean | null = null;
  private supportsAll = false;
  private executable: string | null = null;

  constructor(
    private readonly executableCandidates: string | readonly string[] | null,
    private readonly runner: Runner = runClaudeCommand
  ) {}

  async poll(observedAt = Date.now()): Promise<{
    agents: EyesOnAgentsClaudeAgentState[];
    completeSnapshot: boolean;
    observedAt: number;
  } | null> {
    const candidates = this.executableCandidates === null
      ? []
      : typeof this.executableCandidates === 'string'
        ? [this.executableCandidates]
        : [...this.executableCandidates];
    if (candidates.length === 0) return null;
    if (this.supportsAgents === null) {
      this.supportsAgents = false;
      for (const candidate of candidates) {
        try {
          const probe = await this.runner(candidate, ['agents', '--help']);
          if (probe.exitCode !== 0 || !/--json\b/.test(probe.stdout + probe.stderr)) continue;
          this.executable = candidate;
          this.supportsAgents = true;
          this.supportsAll = /--all\b/.test(probe.stdout + probe.stderr);
          break;
        } catch {
          // Probe the next allowlisted Claude installation.
        }
      }
    }
    if (!this.supportsAgents || this.executable === null) return null;
    try {
      const result = await this.runner(
        this.executable,
        this.supportsAll ? ['agents', '--json', '--all'] : ['agents', '--json']
      );
      if (result.exitCode !== 0) throw new Error('Claude Agent View command failed');
      return {
        agents: parseClaudeAgentsJson(JSON.parse(result.stdout) as unknown, observedAt),
        completeSnapshot: this.supportsAll,
        observedAt
      };
    } catch (error) {
      this.supportsAgents = null;
      this.supportsAll = false;
      this.executable = null;
      throw error;
    }
  }
}
