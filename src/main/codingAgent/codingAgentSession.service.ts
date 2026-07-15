import { randomUUID } from 'node:crypto';
import type {
  CodingAgentDiscoveryResult,
  CodingAgentProvider,
  CodingAgentSessionApi,
  CodingAgentSessionDaoApi,
  CodingAgentSessionRecord,
  OpenCodingAgentSessionResult,
  RefreshCodingAgentSessionsResult,
  RegisterCodingAgentSessionParams
} from '@shared/codingAgent/codingAgentSession.type';
import {
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
  private revision = 0;

  constructor(private readonly dependencies: CodingAgentSessionServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.idFactory = dependencies.idFactory ?? randomUUID;
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
    const effectiveRows = rows.map((row) => ({
      ...row,
      state: effectiveRuntimeState(row, now)
    }));
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
    for (const result of results) {
      for (const session of result.sessions) {
        try {
          const row = await this.dependencies.repository.upsert(session);
          changedIds.push(row.id);
          importedCount += 1;
        } catch (error) {
          issues.push({
            provider: result.provider,
            code: 'invalid-entry',
            message: error instanceof Error ? error.message : String(error)
          });
        }
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
    const record = await this.dependencies.repository.getById({ id });
    if (!record) return { kind: 'unavailable', reason: 'Coding-agent session was not found' };

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
    return row;
  }

  async remove(params: { id: string }): Promise<boolean> {
    const { id } = parseCodingAgentIdParams(params);
    const removed = await this.dependencies.repository.softDelete({ id });
    if (removed) this.notify([id]);
    return removed;
  }
}
