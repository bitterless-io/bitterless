import type {
  CodingAgentSessionDraft,
  CodingAgentSessionRecord,
  CodingAgentStatusUpdate
} from '@shared/codingAgent/codingAgentSession.type';
import {
  assertProviderSurface,
  parseClaudeJobId,
  parseNullableText,
  parsePathText,
  parseProvider,
  parseRuntimeState,
  parseStatusSource,
  parseSurface,
  parseTurnState,
  parseUuid
} from '@shared/codingAgent/codingAgentSession.contract';

interface CodingAgentSessionRow {
  id: string;
  provider: string;
  surface: string;
  external_session_id: string;
  runtime_job_id: string | null;
  title: string | null;
  provider_title: string | null;
  custom_title: number;
  cwd: string | null;
  state: string;
  last_turn_state: string;
  provider_state: string | null;
  status_source: string;
  status_observed_at: number | null;
  status_fresh_until: number | null;
  is_process_alive: number | null;
  created_at: number;
  updated_at: number;
}

export interface CodingAgentSessionSqlStore {
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number | bigint }>;
}

const parseRequiredTimestamp = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
};

const parseNullableTimestamp = (value: unknown, label: string): number | null => {
  if (value === null) return null;
  return parseRequiredTimestamp(value, label);
};

const parseNullableBoolean = (value: unknown, label: string): boolean | null => {
  if (value === null) return null;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error(`${label} must be a boolean or null`);
};

const parseBoolean = (value: unknown, label: string): boolean => {
  const parsed = parseNullableBoolean(value, label);
  if (parsed === null) throw new Error(`${label} must be a boolean`);
  return parsed;
};

const validateStatusTimes = (observedAt: number | null, freshUntil: number | null): void => {
  if (freshUntil !== null && observedAt === null) {
    throw new Error('statusFreshUntil requires statusObservedAt');
  }
  if (freshUntil !== null && observedAt !== null && freshUntil < observedAt) {
    throw new Error('statusFreshUntil cannot precede statusObservedAt');
  }
};

const normalizeDraft = (draft: CodingAgentSessionDraft): CodingAgentSessionDraft => {
  const provider = parseProvider(draft.provider);
  const surface = parseSurface(draft.surface);
  assertProviderSurface(provider, surface);
  const runtimeJobId = draft.runtimeJobId === null ? null : parseClaudeJobId(draft.runtimeJobId);
  if (runtimeJobId !== null && surface !== 'claude-code-background') {
    throw new Error('runtimeJobId is only valid for Claude background sessions');
  }
  const statusObservedAt = parseNullableTimestamp(draft.statusObservedAt, 'statusObservedAt');
  const statusFreshUntil = parseNullableTimestamp(draft.statusFreshUntil, 'statusFreshUntil');
  validateStatusTimes(statusObservedAt, statusFreshUntil);
  return {
    id: parseUuid(draft.id, 'id'),
    provider,
    surface,
    externalSessionId: parseUuid(draft.externalSessionId, 'externalSessionId'),
    runtimeJobId,
    title: parseNullableText(draft.title, 'title', 300),
    titleIsCustom: parseBoolean(draft.titleIsCustom, 'titleIsCustom'),
    cwd: parsePathText(draft.cwd),
    state: parseRuntimeState(draft.state),
    lastTurnState: parseTurnState(draft.lastTurnState),
    providerState: parseNullableText(draft.providerState, 'providerState', 200),
    statusSource: parseStatusSource(draft.statusSource),
    statusObservedAt,
    statusFreshUntil,
    isProcessAlive: parseNullableBoolean(draft.isProcessAlive, 'isProcessAlive')
  };
};

const toRecord = (row: CodingAgentSessionRow): CodingAgentSessionRecord => {
  const provider = parseProvider(row.provider);
  const surface = parseSurface(row.surface);
  assertProviderSurface(provider, surface);
  const statusObservedAt = parseNullableTimestamp(row.status_observed_at, 'status_observed_at');
  const statusFreshUntil = parseNullableTimestamp(row.status_fresh_until, 'status_fresh_until');
  validateStatusTimes(statusObservedAt, statusFreshUntil);
  return {
    id: parseUuid(row.id, 'id'),
    provider,
    surface,
    externalSessionId: parseUuid(row.external_session_id, 'external_session_id'),
    runtimeJobId: row.runtime_job_id === null ? null : parseClaudeJobId(row.runtime_job_id),
    title: parseNullableText(row.title, 'title', 300),
    titleIsCustom: parseBoolean(row.custom_title, 'custom_title'),
    cwd: parsePathText(row.cwd),
    state: parseRuntimeState(row.state),
    lastTurnState: parseTurnState(row.last_turn_state),
    providerState: parseNullableText(row.provider_state, 'provider_state', 200),
    statusSource: parseStatusSource(row.status_source),
    statusObservedAt,
    statusFreshUntil,
    isProcessAlive: parseNullableBoolean(row.is_process_alive, 'is_process_alive'),
    createdAt: parseRequiredTimestamp(row.created_at, 'created_at'),
    updatedAt: parseRequiredTimestamp(row.updated_at, 'updated_at')
  };
};

const requireRecord = (
  row: CodingAgentSessionRow | undefined,
  context: string
): CodingAgentSessionRecord => {
  if (!row) throw new Error(`Coding-agent session ${context} was not found`);
  return toRecord(row);
};

export class CodingAgentSessionStore {
  constructor(
    private readonly sql: CodingAgentSessionSqlStore,
    private readonly now: () => number = Date.now
  ) {}

  async upsert(draft: CodingAgentSessionDraft): Promise<CodingAgentSessionRecord> {
    const value = normalizeDraft(draft);
    const now = this.now();
    const providerTitle = value.titleIsCustom ? null : value.title;
    const sourceRank = (source: string): string => `CASE ${source}
      WHEN 'codex-app-server' THEN 3
      WHEN 'claude-agents-cli' THEN 3
      WHEN 'codex-hook' THEN 2
      WHEN 'claude-hook' THEN 2
      WHEN 'manual' THEN 1
      ELSE 0 END`;
    const acceptIncomingStatus = `(${sourceRank('excluded.status_source')} > ${sourceRank('coding_agent_session.status_source')}
      OR (${sourceRank('excluded.status_source')} = ${sourceRank('coding_agent_session.status_source')}
        AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(coding_agent_session.status_observed_at, 0)))`;
    await this.sql.run(
      `INSERT INTO coding_agent_session (
        id, provider, surface, external_session_id, runtime_job_id, title,
        provider_title, custom_title, cwd, state, last_turn_state, provider_state,
        status_source, status_observed_at, status_fresh_until, is_process_alive,
        is_deleted, delete_flag, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '0', NULL, ?, ?)
      ON CONFLICT(provider, surface, external_session_id, delete_flag) DO UPDATE SET
        runtime_job_id = excluded.runtime_job_id,
        provider_title = CASE
          WHEN excluded.custom_title = 0 AND excluded.status_source <> 'manual'
            THEN excluded.provider_title
          ELSE coding_agent_session.provider_title
        END,
        title = CASE
          WHEN coding_agent_session.custom_title = 1 THEN coding_agent_session.title
          WHEN excluded.custom_title = 1 THEN excluded.title
          WHEN excluded.status_source = 'manual' THEN coding_agent_session.title
          ELSE excluded.provider_title
        END,
        custom_title = CASE
          WHEN coding_agent_session.custom_title = 1 OR excluded.custom_title = 1 THEN 1
          ELSE 0
        END,
        cwd = excluded.cwd,
        state = CASE WHEN ${acceptIncomingStatus} THEN excluded.state ELSE coding_agent_session.state END,
        last_turn_state = CASE WHEN ${acceptIncomingStatus} THEN excluded.last_turn_state ELSE coding_agent_session.last_turn_state END,
        provider_state = CASE WHEN ${acceptIncomingStatus} THEN excluded.provider_state ELSE coding_agent_session.provider_state END,
        status_source = CASE WHEN ${acceptIncomingStatus} THEN excluded.status_source ELSE coding_agent_session.status_source END,
        status_observed_at = CASE WHEN ${acceptIncomingStatus} THEN excluded.status_observed_at ELSE coding_agent_session.status_observed_at END,
        status_fresh_until = CASE WHEN ${acceptIncomingStatus} THEN excluded.status_fresh_until ELSE coding_agent_session.status_fresh_until END,
        is_process_alive = CASE WHEN ${acceptIncomingStatus} THEN excluded.is_process_alive ELSE coding_agent_session.is_process_alive END,
        updated_at = excluded.updated_at
      WHERE coding_agent_session.is_deleted = 0`,
      [
        value.id,
        value.provider,
        value.surface,
        value.externalSessionId,
        value.runtimeJobId,
        value.title,
        providerTitle,
        Number(value.titleIsCustom),
        value.cwd,
        value.state,
        value.lastTurnState,
        value.providerState,
        value.statusSource,
        value.statusObservedAt,
        value.statusFreshUntil,
        value.isProcessAlive === null ? null : Number(value.isProcessAlive),
        now,
        now
      ]
    );
    const row = await this.sql.get<CodingAgentSessionRow>(
      `SELECT * FROM coding_agent_session
       WHERE provider = ? AND surface = ? AND external_session_id = ?
         AND delete_flag = '0' AND is_deleted = 0`,
      [value.provider, value.surface, value.externalSessionId]
    );
    return requireRecord(row, 'upsert result');
  }

  async list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]> {
    const includeUnknown = params?.includeUnknown !== false;
    const rows = await this.sql.all<CodingAgentSessionRow>(
      `SELECT * FROM coding_agent_session
       WHERE is_deleted = 0${includeUnknown ? '' : " AND state <> 'unknown'"}
       ORDER BY updated_at DESC, created_at DESC`,
      []
    );
    return rows.map(toRecord);
  }

  async getById(params: { id: string }): Promise<CodingAgentSessionRecord | undefined> {
    const id = parseUuid(params.id, 'id');
    const row = await this.sql.get<CodingAgentSessionRow>(
      'SELECT * FROM coding_agent_session WHERE id = ? AND is_deleted = 0',
      [id]
    );
    return row ? toRecord(row) : undefined;
  }

  async rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord> {
    const id = parseUuid(params.id, 'id');
    const title = parseNullableText(params.title, 'title', 300);
    await this.sql.run(
      `UPDATE coding_agent_session
       SET title = ?, custom_title = 1, updated_at = ?
       WHERE id = ? AND is_deleted = 0`,
      [title, this.now(), id]
    );
    return requireRecord(
      await this.sql.get<CodingAgentSessionRow>(
        'SELECT * FROM coding_agent_session WHERE id = ? AND is_deleted = 0',
        [id]
      ),
      id
    );
  }

  async updateStatus(params: CodingAgentStatusUpdate): Promise<CodingAgentSessionRecord> {
    const id = parseUuid(params.id, 'id');
    const statusObservedAt = parseNullableTimestamp(params.statusObservedAt, 'statusObservedAt');
    const statusFreshUntil = parseNullableTimestamp(params.statusFreshUntil, 'statusFreshUntil');
    validateStatusTimes(statusObservedAt, statusFreshUntil);
    await this.sql.run(
      `UPDATE coding_agent_session SET
        state = ?, last_turn_state = ?, provider_state = ?, status_source = ?,
        status_observed_at = ?, status_fresh_until = ?, is_process_alive = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`,
      [
        parseRuntimeState(params.state),
        parseTurnState(params.lastTurnState),
        parseNullableText(params.providerState, 'providerState', 200),
        parseStatusSource(params.statusSource),
        statusObservedAt,
        statusFreshUntil,
        parseNullableBoolean(params.isProcessAlive, 'isProcessAlive') === null
          ? null
          : Number(params.isProcessAlive),
        this.now(),
        id
      ]
    );
    return requireRecord(
      await this.sql.get<CodingAgentSessionRow>(
        'SELECT * FROM coding_agent_session WHERE id = ? AND is_deleted = 0',
        [id]
      ),
      id
    );
  }

  async softDelete(params: { id: string }): Promise<boolean> {
    const id = parseUuid(params.id, 'id');
    const now = this.now();
    const result = await this.sql.run(
      `UPDATE coding_agent_session
       SET is_deleted = 1, deleted_at = ?, delete_flag = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`,
      [now, String(now), now, id]
    );
    return Number(result.changes) > 0;
  }
}
