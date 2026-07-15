import { randomUUID } from 'node:crypto';
import type {
  CodingAgentDiscoveryResult,
  CodingAgentProvider,
  CodingAgentSessionApi,
  CodingAgentSessionDaoApi,
  CodingAgentSessionRecord,
  CodingAgentStatusSource,
  OpenCodingAgentSessionResult,
  RefreshCodingAgentSessionsResult,
  RegisterCodingAgentSessionParams
} from '@shared/codingAgent/codingAgentSession.type';
import {
  effectiveProcessLiveness,
  effectiveRuntimeState,
  parseCodingAgentIdParams,
  parseCodingAgentListParams,
  parseCodingAgentRefreshParams,
  parseCodingAgentRenameParams,
  parseRegisterCodingAgentSessionParams,
  parseUuid
} from '@shared/codingAgent/codingAgentSession.contract';
import {
  buildClaudeCommandTarget,
  buildCodexThreadDeepLink,
  requireExistingAbsoluteDirectory
} from './codingAgentTarget';

interface DiscoveryAdapter {
  discover(): Promise<CodingAgentDiscoveryResult>;
}

interface ClaudeCliLivenessEvidence {
  isProcessAlive: boolean;
  observedAt: number;
  freshUntil: number;
}

interface RuntimeObservationEvidence {
  statusSource: CodingAgentStatusSource;
  observedAt: number;
}

export interface CodingAgentSessionServiceDependencies {
  repository: CodingAgentSessionDaoApi;
  codexDiscovery: DiscoveryAdapter;
  claudeDiscovery: DiscoveryAdapter;
  openExternal: (url: string) => Promise<void>;
  broadcastChanged?: (ids: string[], revision: number) => void;
  now?: () => number;
  idFactory?: () => string;
}

export class CodingAgentSessionService implements CodingAgentSessionApi {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly startedAt: number;
  private claudeCliLiveness = new Map<string, ClaudeCliLivenessEvidence>();
  private readonly currentRuntimeObservations = new Map<string, RuntimeObservationEvidence>();
  private revision = 0;

  constructor(private readonly dependencies: CodingAgentSessionServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    this.startedAt = this.now();
  }

  private hasCurrentRuntimeObservation(record: CodingAgentSessionRecord): boolean {
    const evidence = this.currentRuntimeObservations.get(record.id);
    return (
      (evidence !== undefined &&
        evidence.statusSource === record.statusSource &&
        evidence.observedAt === record.statusObservedAt) ||
      (record.statusObservedAt !== null && record.statusObservedAt > this.startedAt)
    );
  }

  private effectiveRecord(
    record: CodingAgentSessionRecord,
    now = this.now()
  ): CodingAgentSessionRecord {
    const observedInCurrentProcess = this.hasCurrentRuntimeObservation(record);
    let isProcessAlive: boolean | null;
    if (record.surface === 'claude-code-cli') {
      const evidence = this.claudeCliLiveness.get(record.externalSessionId);
      isProcessAlive =
        evidence !== undefined &&
        evidence.observedAt >= this.startedAt &&
        now <= evidence.freshUntil
          ? evidence.isProcessAlive
          : null;
    } else {
      isProcessAlive = effectiveProcessLiveness(
        record,
        now,
        this.startedAt,
        observedInCurrentProcess
      );
    }
    return {
      ...record,
      state: effectiveRuntimeState(record, now, this.startedAt, observedInCurrentProcess),
      isProcessAlive
    };
  }

  private async reconcileClaudeCliLiveness(result: CodingAgentDiscoveryResult): Promise<void> {
    if (result.provider !== 'claude') return;
    if (result.snapshot.status !== 'success') {
      this.claudeCliLiveness.clear();
      return;
    }

    const liveSessionIds = new Set(
      result.sessions
        .filter(
          (session) => session.surface === 'claude-code-cli' && session.isProcessAlive === true
        )
        .map((session) => session.externalSessionId)
    );
    const rows = await this.dependencies.repository.list({ includeUnknown: true });
    const nextLiveness = new Map<string, ClaudeCliLivenessEvidence>();
    for (const row of rows) {
      if (row.provider !== 'claude' || row.surface !== 'claude-code-cli') continue;
      nextLiveness.set(row.externalSessionId, {
        isProcessAlive: liveSessionIds.has(row.externalSessionId),
        observedAt: result.snapshot.observedAt,
        freshUntil: result.snapshot.freshUntil
      });
    }
    this.claudeCliLiveness = nextLiveness;
  }

  private notify(ids: string[]): void {
    if (ids.length === 0 || !this.dependencies.broadcastChanged) return;
    this.revision += 1;
    this.dependencies.broadcastChanged([...new Set(ids)], this.revision);
  }

  async list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]> {
    const value = parseCodingAgentListParams(params);
    const rows = await this.dependencies.repository.list({ includeUnknown: true });
    const now = this.now();
    const effectiveRows = rows.map((row) => this.effectiveRecord(row, now));
    return value.includeUnknown === false
      ? effectiveRows.filter((row) => row.state !== 'unknown')
      : effectiveRows;
  }

  async register(params: RegisterCodingAgentSessionParams): Promise<CodingAgentSessionRecord> {
    const value = parseRegisterCodingAgentSessionParams(params);
    const cwdValue = value.cwd ?? null;
    const cwd = cwdValue === null ? null : requireExistingAbsoluteDirectory(cwdValue);
    const row = await this.dependencies.repository.upsert({
      id: this.idFactory(),
      provider: value.provider,
      surface: value.surface,
      externalSessionId: value.externalSessionId,
      runtimeJobId: null,
      title: value.title ?? null,
      titleIsCustom: Object.prototype.hasOwnProperty.call(params, 'title'),
      cwd,
      state: 'unknown',
      lastTurnState: 'unknown',
      providerState: null,
      statusSource: 'manual',
      statusObservedAt: null,
      statusFreshUntil: null,
      isProcessAlive: null
    });
    this.notify([row.id]);
    return row;
  }

  async refresh(params?: {
    provider?: CodingAgentProvider;
  }): Promise<RefreshCodingAgentSessionsResult> {
    const value = parseCodingAgentRefreshParams(params);
    const providers =
      value.provider === undefined
        ? (['codex', 'claude'] as CodingAgentProvider[])
        : [value.provider];
    const results: CodingAgentDiscoveryResult[] = [];
    for (const provider of providers) {
      results.push(
        await (provider === 'codex'
          ? this.dependencies.codexDiscovery.discover()
          : this.dependencies.claudeDiscovery.discover())
      );
    }

    let importedCount = 0;
    const changedIds: string[] = [];
    const issues = results.flatMap((result) => result.issues);
    const failedProviders = new Set<CodingAgentProvider>();
    for (const result of results) {
      for (const session of result.sessions) {
        try {
          const row = await this.dependencies.repository.upsert(session);
          if (
            session.statusObservedAt !== null &&
            row.statusSource === session.statusSource &&
            row.statusObservedAt === session.statusObservedAt
          ) {
            this.currentRuntimeObservations.set(row.id, {
              statusSource: row.statusSource,
              observedAt: session.statusObservedAt
            });
          }
          changedIds.push(row.id);
          importedCount += 1;
        } catch (error) {
          failedProviders.add(result.provider);
          issues.push({
            provider: result.provider,
            code: 'invalid-entry',
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    for (const result of results) {
      if (result.provider !== 'claude') continue;
      if (failedProviders.has('claude')) {
        this.claudeCliLiveness.clear();
        continue;
      }
      try {
        await this.reconcileClaudeCliLiveness(result);
      } catch (error) {
        this.claudeCliLiveness.clear();
        issues.push({
          provider: 'claude',
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.notify(changedIds);
    return {
      providers,
      discoveredCount: results.reduce((count, result) => count + result.sessions.length, 0),
      importedCount,
      issues
    };
  }

  async open(params: { id: string }): Promise<OpenCodingAgentSessionResult> {
    const { id } = parseCodingAgentIdParams(params);
    const persistedRecord = await this.dependencies.repository.getById({ id });
    if (!persistedRecord) {
      return { kind: 'unavailable', reason: 'Coding-agent session was not found' };
    }
    const record = this.effectiveRecord(persistedRecord);

    if (record.provider === 'codex') {
      const url = buildCodexThreadDeepLink(record.externalSessionId);
      await this.dependencies.openExternal(url);
      return { kind: 'opened-url', url };
    }
    if (record.surface === 'claude-desktop-chat') {
      const url = `claude://claude.ai/chat/${parseUuid(record.externalSessionId, 'Claude chat id')}`;
      await this.dependencies.openExternal(url);
      return { kind: 'opened-url', url };
    }
    if (record.surface === 'claude-desktop-code') {
      const url = `https://claude.ai/code/${parseUuid(record.externalSessionId, 'Claude Code id')}`;
      await this.dependencies.openExternal(url);
      return { kind: 'opened-url', url };
    }
    return buildClaudeCommandTarget(record);
  }

  async rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord> {
    const { id, title } = parseCodingAgentRenameParams(params);
    const row = await this.dependencies.repository.rename({ id, title });
    this.notify([id]);
    return this.effectiveRecord(row);
  }

  async remove(params: { id: string }): Promise<boolean> {
    const { id } = parseCodingAgentIdParams(params);
    const removed = await this.dependencies.repository.softDelete({ id });
    if (removed) this.notify([id]);
    return removed;
  }
}
