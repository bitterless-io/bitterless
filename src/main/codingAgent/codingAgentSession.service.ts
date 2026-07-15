import { randomUUID } from 'node:crypto';
import type {
  CodingAgentDiscoveryIssue,
  CodingAgentDiscoveryResult,
  CodingAgentIntegrationStatus,
  CodingAgentProvider,
  CodingAgentSessionApi,
  CodingAgentSessionDaoApi,
  CodingAgentSessionRecord,
  CodingAgentStatusSource,
  OpenCodingAgentSessionResult,
  RefreshCodingAgentSessionsResult,
  RegisterCodingAgentSessionParams
} from '@shared/codingAgent/codingAgentSession.type';
import type { CodingAgentHookEvent } from '@shared/codingAgent/codingAgentHookBridge.type';
import { normalizeCodingAgentHookEvent } from '@shared/codingAgent/codingAgentHookBridge.contract';
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

interface ProviderRefreshOutcome {
  discoveredCount: number;
  importedCount: number;
  issues: CodingAgentDiscoveryIssue[];
}

export interface CodingAgentSessionServiceDependencies {
  repository: CodingAgentSessionDaoApi;
  codexDiscovery: DiscoveryAdapter;
  claudeDiscovery: DiscoveryAdapter;
  openExternal: (url: string) => Promise<void>;
  broadcastChanged?: (ids: string[], revision: number) => void;
  now?: () => number;
  idFactory?: () => string;
  integration?: {
    getStatus(provider: CodingAgentProvider): CodingAgentIntegrationStatus;
    install(provider: CodingAgentProvider): CodingAgentIntegrationStatus;
    remove(provider: CodingAgentProvider): CodingAgentIntegrationStatus;
  };
}

const HOOK_FRESHNESS_MS = 60_000;

const statusSourceRank = (source: CodingAgentStatusSource): number => {
  if (source === 'codex-app-server' || source === 'claude-agents-cli') return 3;
  if (source === 'codex-hook' || source === 'claude-hook') return 2;
  if (source === 'manual') return 1;
  return 0;
};

export class CodingAgentSessionService implements CodingAgentSessionApi {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly startedAt: number;
  private claudeCliLiveness = new Map<string, ClaudeCliLivenessEvidence>();
  private readonly currentRuntimeObservations = new Map<string, RuntimeObservationEvidence>();
  private readonly providerRefreshes = new Map<
    CodingAgentProvider,
    Promise<ProviderRefreshOutcome>
  >();
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

  private async performProviderRefresh(
    provider: CodingAgentProvider
  ): Promise<ProviderRefreshOutcome> {
    const result = await (provider === 'codex'
      ? this.dependencies.codexDiscovery.discover()
      : this.dependencies.claudeDiscovery.discover());
    if (result.provider !== provider) {
      throw new Error(`Coding-agent ${provider} discovery returned ${result.provider}`);
    }

    let importedCount = 0;
    let importFailed = false;
    const changedIds: string[] = [];
    const issues = [...result.issues];
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
        importFailed = true;
        issues.push({
          provider,
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (provider === 'claude') {
      if (importFailed) {
        this.claudeCliLiveness.clear();
      } else {
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
    }

    this.notify(changedIds);
    return {
      discoveredCount: result.sessions.length,
      importedCount,
      issues
    };
  }

  private refreshProvider(provider: CodingAgentProvider): Promise<ProviderRefreshOutcome> {
    const active = this.providerRefreshes.get(provider);
    if (active) return active;

    const operation = this.performProviderRefresh(provider);
    this.providerRefreshes.set(provider, operation);
    const clear = (): void => {
      if (this.providerRefreshes.get(provider) === operation) {
        this.providerRefreshes.delete(provider);
      }
    };
    void operation.then(clear, clear);
    return operation;
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
    const outcomes = await Promise.all(providers.map((provider) => this.refreshProvider(provider)));
    return {
      providers,
      discoveredCount: outcomes.reduce((count, result) => count + result.discoveredCount, 0),
      importedCount: outcomes.reduce((count, result) => count + result.importedCount, 0),
      issues: outcomes.flatMap((result) => result.issues)
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

  async applyHookEvent(event: CodingAgentHookEvent): Promise<CodingAgentSessionRecord> {
    const evidence = normalizeCodingAgentHookEvent(event);
    const rows = await this.dependencies.repository.list({ includeUnknown: true });
    const surface = evidence.provider === 'codex' ? 'codex-desktop' : 'claude-code-cli';
    const existing = rows.find(
      (row) => row.provider === evidence.provider &&
        row.surface === surface &&
        row.externalSessionId === evidence.externalSessionId
    );
    const now = this.now();
    const higherRankIsCurrent = existing !== undefined &&
      statusSourceRank(existing.statusSource) > statusSourceRank(evidence.statusSource) &&
      this.hasCurrentRuntimeObservation(existing) &&
      existing.statusFreshUntil !== null &&
      now <= existing.statusFreshUntil;
    const observationIsOlder = existing?.statusObservedAt !== null &&
      existing?.statusObservedAt !== undefined &&
      existing.statusObservedAt > evidence.observedAt;
    if (
      existing &&
      (
        higherRankIsCurrent ||
        observationIsOlder
      )
    ) {
      return this.effectiveRecord(existing);
    }

    const status = {
      state: evidence.state,
      lastTurnState: evidence.lastTurnState ?? existing?.lastTurnState ?? 'unknown',
      providerState: evidence.providerState,
      statusSource: evidence.statusSource,
      statusObservedAt: evidence.observedAt,
      statusFreshUntil: evidence.state === 'failed' || evidence.state === 'ended'
        ? null
        : evidence.observedAt + HOOK_FRESHNESS_MS,
      isProcessAlive: null
    } as const;
    const row = existing
      ? await this.dependencies.repository.updateStatus({ id: existing.id, ...status })
      : await this.dependencies.repository.upsert({
          id: this.idFactory(),
          provider: evidence.provider,
          surface,
          externalSessionId: evidence.externalSessionId,
          runtimeJobId: null,
          title: null,
          titleIsCustom: false,
          cwd: evidence.cwd,
          ...status
        });
    if (
      row.statusSource === evidence.statusSource &&
      row.statusObservedAt === evidence.observedAt
    ) {
      this.currentRuntimeObservations.set(row.id, {
        statusSource: row.statusSource,
        observedAt: evidence.observedAt
      });
      this.notify([row.id]);
    }
    return this.effectiveRecord(row);
  }

  async getIntegrationStatus(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    const provider = parseCodingAgentRefreshParams(params).provider;
    if (!provider || !this.dependencies.integration) {
      throw new Error('Coding-agent status bridge is unavailable');
    }
    return this.dependencies.integration.getStatus(provider);
  }

  async installStatusBridge(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    const provider = parseCodingAgentRefreshParams(params).provider;
    if (!provider || !this.dependencies.integration) {
      throw new Error('Coding-agent status bridge is unavailable');
    }
    return this.dependencies.integration.install(provider);
  }

  async removeStatusBridge(params: {
    provider: CodingAgentProvider;
  }): Promise<CodingAgentIntegrationStatus> {
    const provider = parseCodingAgentRefreshParams(params).provider;
    if (!provider || !this.dependencies.integration) {
      throw new Error('Coding-agent status bridge is unavailable');
    }
    return this.dependencies.integration.remove(provider);
  }
}
