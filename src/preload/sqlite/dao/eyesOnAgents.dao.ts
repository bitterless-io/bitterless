import { randomUUID } from 'node:crypto';
import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import { sqliteManager } from '../sqliteHelper/sqlite.manager';
import type {
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsDomain,
  EyesOnAgentsHookLastUserPromptCandidate,
  EyesOnAgentsLastUserPrompt,
  EyesOnAgentsProjectMetadata,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRepositoryMutationResult,
  EyesOnAgentsRuntimeDeliveryPersistenceResult,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsRuntimePersistenceResult,
  EyesOnAgentsRuntimeState,
  EyesOnAgentsSnapshot,
  EyesOnAgentsStatusSource,
  EyesOnAgentsThread,
  EyesOnAgentsThreadRefreshCandidate,
  EyesOnAgentsThreadRefreshPages,
  EyesOnAgentsThreadRefreshPatch,
  EyesOnAgentsThreadSnapshot
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  isEyesOnAgentsFocused,
  isEyesOnAgentsRecord,
  normalizeEyesOnAgentsProviderThreadTitle,
  parseEyesOnAgentsActiveFlags,
  parseEyesOnAgentsHookLastUserPromptCandidate,
  parseEyesOnAgentsLastUserPromptPreview,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsProjectMetadata,
  parseEyesOnAgentsRuntimeEvent,
  parseEyesOnAgentsRuntimeState,
  parseEyesOnAgentsText,
  parseEyesOnAgentsThreadRefreshPatch,
  parseEyesOnAgentsTimestamp,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';

interface DomainRow {
  id: number;
  domain_key: string;
  title: string;
  sort_index: number;
  is_system: number;
}

interface ThreadRow {
  thread_id: string;
  domain_id: number;
  title: string | null;
  cwd: string | null;
  project_key: string | null;
  project_root: string | null;
  project_name: string | null;
  runtime_state: string;
  active_flags_json: string;
  active_turn_id: string | null;
  last_completed_turn_id: string | null;
  last_completed_at: number | null;
  last_opened_turn_id: string | null;
  last_opened_at: number | null;
  is_unread: number;
  status_source: string;
  status_observed_at: number | null;
  last_activity_at: number | null;
  last_user_prompt_preview: string | null;
  last_user_prompt_turn_id: string | null;
  last_user_prompt_at: number | null;
  last_user_prompt_truncated: number;
  last_user_prompt_source: string | null;
  last_user_prompt_checked_at: number | null;
}

interface ThreadRefreshPersistenceRow {
  title: string | null;
  last_activity_at: number | null;
  last_user_prompt_preview: string | null;
  last_user_prompt_turn_id: string | null;
  last_user_prompt_at: number | null;
  last_user_prompt_truncated: number;
  last_user_prompt_source: string | null;
  last_user_prompt_checked_at: number | null;
}

const MAX_ARCHIVED_THREAD_IDS = 10_000;
const MAX_THREAD_SNAPSHOTS = 20_000;
const THREAD_REFRESH_PAGE_SIZE = 40;
type ThreadRefreshColumnValue = string | number | null;

const parsePositiveId = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
};

const toIso = (value: number | null): string | null => {
  return value === null ? null : new Date(value).toISOString();
};

const toDomain = (row: DomainRow): EyesOnAgentsDomain => ({
  id: parsePositiveId(row.id, 'domain id'),
  domainKey: row.domain_key,
  title: parseEyesOnAgentsText(row.title, 'domain title', 80, false) as string,
  sortIndex: row.sort_index,
  isSystem: row.is_system === 1
});

const parseStatusSource = (value: unknown): EyesOnAgentsStatusSource => {
  if (value === 'app_server' || value === 'codex_hook' || value === 'discovery') return value;
  throw new Error('status source is unsupported');
};

const parseTurnId = (value: unknown, label: string): string | null => {
  return parseEyesOnAgentsText(value, label, 200);
};

const parseLastUserPromptSource = (value: unknown): 'app_server' | 'codex_hook' | null => {
  if (value === null) return null;
  if (value === 'app_server' || value === 'codex_hook') return value;
  throw new Error('last user prompt source is unsupported');
};

const toLastUserPrompt = (row: ThreadRow): EyesOnAgentsLastUserPrompt => {
  const preview = parseEyesOnAgentsLastUserPromptPreview(row.last_user_prompt_preview);
  const turnId = parseTurnId(row.last_user_prompt_turn_id, 'last_user_prompt_turn_id');
  const observedAt = parseEyesOnAgentsTimestamp(
    row.last_user_prompt_at,
    'last_user_prompt_at'
  );
  const checkedAt = parseEyesOnAgentsTimestamp(
    row.last_user_prompt_checked_at,
    'last_user_prompt_checked_at'
  );
  if (row.last_user_prompt_truncated !== 0 && row.last_user_prompt_truncated !== 1) {
    throw new Error('last_user_prompt_truncated is invalid');
  }
  parseLastUserPromptSource(row.last_user_prompt_source);
  return {
    state: preview !== null
      ? 'available'
      : turnId !== null || observedAt !== null
        ? 'pending'
        : 'unavailable',
    preview,
    turnId,
    observedAt: toIso(observedAt),
    checkedAt: toIso(checkedAt),
    truncated: row.last_user_prompt_truncated === 1
  };
};

const canApplyAppServerPrompt = (
  row: ThreadRefreshPersistenceRow,
  patch: NonNullable<EyesOnAgentsThreadRefreshPatch['lastUserPrompt']>
): boolean => {
  const existingSource = parseLastUserPromptSource(row.last_user_prompt_source);
  const existingUnavailable = row.last_user_prompt_preview === null
    && row.last_user_prompt_turn_id === null
    && row.last_user_prompt_at === null;
  const sameTurn = patch.turnId !== null && patch.turnId === row.last_user_prompt_turn_id;
  const existingPending = row.last_user_prompt_preview === null && !existingUnavailable;
  const canFillPending = sameTurn && existingPending && patch.preview !== null;
  const canRefreshAppServerTurn = existingSource === 'app_server'
    && sameTurn
    && row.last_user_prompt_preview !== null
    && patch.preview !== null
    && row.last_user_prompt_checked_at !== null
    && patch.checkedAt > row.last_user_prompt_checked_at;
  const protectsAvailableHookPrompt = existingSource === 'codex_hook'
    && sameTurn
    && row.last_user_prompt_preview !== null;
  if (protectsAvailableHookPrompt) return false;
  if (patch.observedAt === null) return canFillPending;
  if (row.last_user_prompt_at === null) {
    return existingUnavailable || canFillPending;
  }
  if (patch.observedAt > row.last_user_prompt_at) return true;
  if (patch.observedAt < row.last_user_prompt_at) return false;
  return canFillPending || canRefreshAppServerTurn;
};

const shouldReplaceWithAppServerPrompt = (
  row: ThreadRefreshPersistenceRow,
  patch: NonNullable<EyesOnAgentsThreadRefreshPatch['lastUserPrompt']>
): boolean => {
  if (patch.observedAt === null) return false;
  const existingUnavailable = row.last_user_prompt_preview === null
    && row.last_user_prompt_turn_id === null
    && row.last_user_prompt_at === null;
  return existingUnavailable || (
    row.last_user_prompt_at !== null
    && patch.observedAt > row.last_user_prompt_at
  );
};

const projectFromRow = (row: ThreadRow): EyesOnAgentsProjectMetadata | null => {
  if (row.project_key === null && row.project_root === null && row.project_name === null) {
    return null;
  }
  if (row.project_key === null || row.project_root === null || row.project_name === null) {
    throw new Error('Project metadata is incomplete');
  }
  return parseEyesOnAgentsProjectMetadata({
    projectKey: row.project_key,
    projectRoot: row.project_root,
    projectName: row.project_name
  });
};

const projectColumns = (
  project: EyesOnAgentsProjectMetadata | null | undefined
): [string | null, string | null, string | null] => {
  if (!project) return [null, null, null];
  return [project.projectKey, project.projectRoot, project.projectName];
};

const toThread = (row: ThreadRow): EyesOnAgentsThread => {
  const runtimeState = parseEyesOnAgentsRuntimeState(row.runtime_state);
  const lastCompletedAt = parseEyesOnAgentsTimestamp(
    row.last_completed_at,
    'last_completed_at'
  );
  const lastOpenedAt = parseEyesOnAgentsTimestamp(row.last_opened_at, 'last_opened_at');
  let activeFlags: string[];
  try {
    activeFlags = parseEyesOnAgentsActiveFlags(JSON.parse(row.active_flags_json) as unknown);
  } catch {
    activeFlags = [];
  }
  const lastCompletedTurnId = parseTurnId(
    row.last_completed_turn_id,
    'last_completed_turn_id'
  );
  const lastOpenedTurnId = parseTurnId(row.last_opened_turn_id, 'last_opened_turn_id');
  if (row.is_unread !== 0 && row.is_unread !== 1) throw new Error('is_unread is invalid');
  const isUnread = row.is_unread === 1;
  const statusObservedAt = parseEyesOnAgentsTimestamp(
    row.status_observed_at,
    'status_observed_at'
  );
  const project = projectFromRow(row);
  return {
    threadId: parseEyesOnAgentsUuid(row.thread_id),
    domainId: parsePositiveId(row.domain_id, 'domain id'),
    title: parseEyesOnAgentsText(row.title, 'thread title', 300),
    cwd: parseEyesOnAgentsPath(row.cwd),
    projectKey: project?.projectKey ?? null,
    projectRoot: project?.projectRoot ?? null,
    projectName: project?.projectName ?? null,
    runtimeState,
    activeFlags,
    activeTurnId: parseTurnId(row.active_turn_id, 'active_turn_id'),
    lastCompletedTurnId,
    lastCompletedAt: toIso(lastCompletedAt),
    lastOpenedTurnId,
    lastOpenedAt: toIso(lastOpenedAt),
    statusSource: parseStatusSource(row.status_source),
    statusObservedAt: toIso(statusObservedAt),
    lastActivityAt: toIso(
      parseEyesOnAgentsTimestamp(row.last_activity_at, 'last_activity_at')
    ),
    isUnread,
    isFocused: isEyesOnAgentsFocused(
      runtimeState,
      isUnread,
      statusObservedAt,
      lastOpenedAt
    ),
    lastUserPrompt: toLastUserPrompt(row)
  };
};

const defaultDomainId = (): number => {
  const row = sqliteManager.db.prepare(
    `SELECT id FROM eyes_on_agents_domain
     WHERE domain_key = 'uncategorized' AND is_deleted = 0 AND delete_flag = '0'
     ORDER BY id ASC LIMIT 1`
  ).get() as { id: number } | undefined;
  if (!row) throw new Error('Uncategorized Domain is unavailable');
  return parsePositiveId(row.id, 'Uncategorized Domain id');
};

const normalizeDiscoveredThread = (
  value: EyesOnAgentsDiscoveredThread
): EyesOnAgentsDiscoveredThread => {
  const project = value.project === undefined
    ? undefined
    : parseEyesOnAgentsProjectMetadata(value.project);
  return {
    threadId: parseEyesOnAgentsUuid(value.threadId),
    title: parseEyesOnAgentsText(value.title, 'thread title', 300),
    cwd: parseEyesOnAgentsPath(value.cwd),
    ...(project === undefined ? {} : { project }),
    runtimeState: parseEyesOnAgentsRuntimeState(value.runtimeState),
    activeFlags: parseEyesOnAgentsActiveFlags(value.activeFlags),
    statusSource: value.statusSource === 'app_server' ? 'app_server' : 'discovery',
    statusObservedAt: parseEyesOnAgentsTimestamp(value.statusObservedAt, 'statusObservedAt'),
    lastActivityAt: parseEyesOnAgentsTimestamp(value.lastActivityAt, 'lastActivityAt')
  };
};

const normalizeThreadSnapshot = (
  value: EyesOnAgentsThreadSnapshot
): EyesOnAgentsThreadSnapshot => {
  const threadId = parseEyesOnAgentsUuid(value?.threadId);
  if (typeof value?.payloadJson !== 'string') throw new Error('payloadJson must be a string');
  let payload: unknown;
  try {
    payload = JSON.parse(value.payloadJson) as unknown;
  } catch {
    throw new Error('payloadJson must contain valid JSON');
  }
  if (!isEyesOnAgentsRecord(payload)) throw new Error('payloadJson must contain an object');
  if (parseEyesOnAgentsUuid(payload.id, 'snapshot payload id') !== threadId) {
    throw new Error('snapshot payload id must match threadId');
  }
  if (typeof value.archived !== 'boolean') throw new Error('archived must be a boolean');
  return {
    threadId,
    payloadJson: JSON.stringify(payload),
    archived: value.archived,
    syncedAt: parseEyesOnAgentsTimestamp(value.syncedAt, 'syncedAt', false) as number
  };
};

const requireActiveDomain = (domainId: number): DomainRow => {
  const row = sqliteManager.db.prepare(
    `SELECT id, domain_key, title, sort_index, is_system
     FROM eyes_on_agents_domain WHERE id = ? AND is_deleted = 0`
  ).get(domainId) as DomainRow | undefined;
  if (!row) throw new Error('Domain was not found');
  return row;
};

const ensureUniqueDomainTitle = (title: string, excludedId?: number): void => {
  const row = sqliteManager.db.prepare(
    `SELECT id FROM eyes_on_agents_domain
     WHERE is_deleted = 0 AND lower(title) = lower(?)
       AND (? IS NULL OR id <> ?)
     LIMIT 1`
  ).get(title, excludedId ?? null, excludedId ?? null) as { id: number } | undefined;
  if (row) throw new Error('A Domain with that title already exists');
};

const eventState = (event: EyesOnAgentsRuntimeEvent): EyesOnAgentsRuntimeState => {
  if (event.type === 'thread_status') return event.runtimeState;
  if (event.type === 'turn_started') return 'working';
  if (event.outcome === 'failed') return 'failed';
  if (event.outcome === 'interrupted') return 'ended';
  return 'idle';
};

const titleFromStoredThreadSnapshot = (threadId: string): string | null => {
  const row = sqliteManager.db.prepare(
    `SELECT payload_json FROM eyes_on_agents_thread_snapshot
     WHERE thread_id = ?`
  ).get(threadId) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    const value = JSON.parse(row.payload_json) as unknown;
    if (!isEyesOnAgentsRecord(value)) return null;
    if (parseEyesOnAgentsUuid(value.id, 'snapshot thread id') !== threadId) return null;
    return normalizeEyesOnAgentsProviderThreadTitle(value);
  } catch {
    return null;
  }
};

const runtimePersistenceResult = (
  threadId: string,
  created: boolean
): EyesOnAgentsRuntimePersistenceResult => {
  const row = sqliteManager.db.prepare(
    `SELECT title, is_archived FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(threadId) as { title: string | null; is_archived: number };
  return {
    created,
    titleMissing: row.is_archived === 0 && row.title === null
  };
};

const applyRuntimeEventInTransaction = (
  event: EyesOnAgentsRuntimeEvent,
  hasCurrentListenerReplayAuthority = false
): EyesOnAgentsRuntimePersistenceResult => {
  const now = Date.now();
  const domainId = defaultDomainId();
  const state = eventState(event);
  const activeFlags = event.type === 'thread_status' ? event.activeFlags : [];
  const project = projectColumns(event.project);
  const snapshotTitle = titleFromStoredThreadSnapshot(event.threadId);
  const startedTurnId = event.type === 'turn_started'
    ? event.turnId ?? (event.source === 'codex_hook' ? `hook-${event.observedAt}` : null)
    : event.type === 'thread_status'
      ? event.turnId ?? null
      : null;
  const inserted = sqliteManager.db.prepare(
    `INSERT OR IGNORE INTO eyes_on_agents_thread (
      thread_id, domain_id, title, cwd, project_key, project_root, project_name,
      runtime_state, active_flags_json,
      active_turn_id, last_completed_turn_id, last_completed_at,
      last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
      last_activity_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.threadId,
    domainId,
    snapshotTitle,
    event.cwd ?? null,
    ...project,
    state,
    JSON.stringify(activeFlags),
    startedTurnId,
    state === 'working' || state === 'waiting_approval' || state === 'waiting_input'
      || event.type === 'turn_completed' ? 1 : 0,
    event.source,
    event.observedAt,
    event.observedAt,
    now,
    now
  );

  if (snapshotTitle !== null) {
    sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET title = ?, updated_at = ?
       WHERE thread_id = ? AND title IS NULL`
    ).run(snapshotTitle, now, event.threadId);
  }
  const created = Number(inserted.changes) === 1;

  const existing = sqliteManager.db.prepare(
    `SELECT runtime_state, status_source, status_observed_at, active_turn_id,
      last_completed_turn_id
     FROM eyes_on_agents_thread WHERE thread_id = ?`
  ).get(event.threadId) as {
    runtime_state: string;
    status_source: string;
    status_observed_at: number | null;
    active_turn_id: string | null;
    last_completed_turn_id: string | null;
  };
  const mayRestoreUnknownDiscovery = hasCurrentListenerReplayAuthority
    && event.source === 'codex_hook'
    && existing.status_source === 'discovery'
    && parseEyesOnAgentsRuntimeState(existing.runtime_state) === 'unknown';
  if (
    !mayRestoreUnknownDiscovery
    && existing.status_observed_at !== null
    && existing.status_observed_at > event.observedAt
  ) {
    return runtimePersistenceResult(event.threadId, created);
  }
  if (
    (state === 'working' || state === 'waiting_approval' || state === 'waiting_input')
    && event.turnId !== null
    && event.turnId !== undefined
    && existing.last_completed_turn_id === event.turnId
  ) {
    return runtimePersistenceResult(event.threadId, created);
  }
  if (event.project !== undefined) {
    sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET
        project_key = ?, project_root = ?, project_name = ?
       WHERE thread_id = ?`
    ).run(...project, event.threadId);
  }

  if (event.type === 'turn_completed') {
    sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET
        cwd = COALESCE(?, cwd),
        runtime_state = ?,
        active_flags_json = '[]',
        active_turn_id = NULL,
        last_completed_turn_id = ?,
        last_completed_at = ?,
        is_unread = 1,
        status_source = ?,
        status_observed_at = ?,
        last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
        updated_at = ?
       WHERE thread_id = ?`
    ).run(
      event.cwd ?? null,
      state,
      event.turnId ?? existing.active_turn_id,
      event.observedAt,
      event.source,
      event.observedAt,
      event.observedAt,
      now,
      event.threadId
    );
    return runtimePersistenceResult(event.threadId, created);
  }

  sqliteManager.db.prepare(
    `UPDATE eyes_on_agents_thread SET
      cwd = COALESCE(?, cwd),
      runtime_state = ?,
      active_flags_json = ?,
      active_turn_id = CASE
        WHEN ? IN ('working', 'waiting_approval', 'waiting_input')
          THEN COALESCE(?, active_turn_id)
        ELSE NULL
      END,
      is_unread = CASE
        WHEN ? IN ('working', 'waiting_approval', 'waiting_input') THEN 1
        ELSE is_unread
      END,
      status_source = ?,
      status_observed_at = ?,
      last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
      updated_at = ?
     WHERE thread_id = ?`
  ).run(
    event.cwd ?? null,
    state,
    JSON.stringify(activeFlags),
    state,
    startedTurnId,
    state,
    event.source,
    event.observedAt,
    event.observedAt,
    now,
    event.threadId
  );
  return runtimePersistenceResult(event.threadId, created);
};

const normalizeHookLastUserPromptCandidate = (
  event: EyesOnAgentsRuntimeEvent,
  value: EyesOnAgentsHookLastUserPromptCandidate | undefined
): EyesOnAgentsHookLastUserPromptCandidate | undefined => {
  if (value === undefined) return undefined;
  if (event.type !== 'turn_started' || event.source !== 'codex_hook') {
    throw new Error('hook last user prompt requires a codex_hook turn_started event');
  }
  return parseEyesOnAgentsHookLastUserPromptCandidate(value);
};

const applyHookLastUserPromptInTransaction = (
  event: Extract<EyesOnAgentsRuntimeEvent, { type: 'turn_started' }>,
  candidate: EyesOnAgentsHookLastUserPromptCandidate
): void => {
  sqliteManager.db.prepare(
    `UPDATE eyes_on_agents_thread SET
      last_user_prompt_preview = ?,
      last_user_prompt_turn_id = ?,
      last_user_prompt_at = ?,
      last_user_prompt_truncated = ?,
      last_user_prompt_source = 'codex_hook',
      last_user_prompt_checked_at = NULL,
      updated_at = ?
     WHERE thread_id = ?
       AND (last_user_prompt_at IS NULL OR last_user_prompt_at < ?)`
  ).run(
    candidate.preview,
    event.turnId,
    event.observedAt,
    candidate.truncated ? 1 : 0,
    Date.now(),
    event.threadId,
    event.observedAt
  );
};

export class EyesOnAgentsRepositoryDao extends BaseDao implements EyesOnAgentsRepositoryApi {
  async getSnapshot(): Promise<Pick<EyesOnAgentsSnapshot, 'domains' | 'threads'>> {
    const domains = await sqliteHelper.safeAll<DomainRow>(
      `SELECT id, domain_key, title, sort_index, is_system
       FROM eyes_on_agents_domain
       WHERE is_deleted = 0
       ORDER BY is_system DESC, sort_index ASC, created_at ASC`,
      []
    );
    const rows = await sqliteHelper.safeAll<ThreadRow>(
      `SELECT thread_id, domain_id, title, cwd, project_key, project_root, project_name,
        runtime_state, active_flags_json,
        active_turn_id, last_completed_turn_id, last_completed_at,
        last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
        last_activity_at, last_user_prompt_preview, last_user_prompt_turn_id,
        last_user_prompt_at, last_user_prompt_truncated, last_user_prompt_source,
        last_user_prompt_checked_at
       FROM eyes_on_agents_thread
       WHERE is_archived = 0
       ORDER BY COALESCE(last_activity_at, updated_at) DESC, updated_at DESC, thread_id ASC`,
      []
    );
    return { domains: domains.map(toDomain), threads: rows.map(toThread) };
  }

  async getThreadRefreshPages(params: {
    coldPage: number;
    previousPageCount: number | null;
  }): Promise<EyesOnAgentsThreadRefreshPages> {
    if (
      !params ||
      !Number.isSafeInteger(params.coldPage) ||
      params.coldPage < 2 ||
      (
        params.previousPageCount !== null &&
        (
          !Number.isSafeInteger(params.previousPageCount) ||
          params.previousPageCount < 0
        )
      )
    ) {
      throw new Error('thread refresh pagination is invalid');
    }
    const transaction = sqliteManager.db.transaction((): EyesOnAgentsThreadRefreshPages => {
      const countRow = sqliteManager.db.prepare(
        `SELECT COUNT(*) AS count
         FROM eyes_on_agents_thread
         WHERE is_archived = 0`
      ).get() as { count: number };
      const count = Number(countRow.count);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('thread refresh page count is invalid');
      }
      const pageCount = Math.ceil(count / THREAD_REFRESH_PAGE_SIZE);
      const pageCountShrank = params.previousPageCount !== null &&
        pageCount < params.previousPageCount;
      const coldPage = pageCount <= 1
        ? null
        : pageCountShrank || params.coldPage > pageCount
          ? 2
          : params.coldPage;
      const selectPage = sqliteManager.db.prepare(
        `SELECT thread_id, runtime_state, active_turn_id, status_source, status_observed_at,
          last_user_prompt_checked_at
         FROM eyes_on_agents_thread
         WHERE is_archived = 0
         ORDER BY COALESCE(last_activity_at, updated_at) DESC,
           updated_at DESC, thread_id ASC
         LIMIT ? OFFSET ?`
      );
      const toCandidate = (
        row: {
          thread_id: string;
          runtime_state: string;
          active_turn_id: string | null;
          status_source: string;
          status_observed_at: number | null;
          last_user_prompt_checked_at: number | null;
        }
      ): EyesOnAgentsThreadRefreshCandidate => {
        const runtimeState = parseEyesOnAgentsRuntimeState(row.runtime_state);
        const statusSource = parseStatusSource(row.status_source);
        const activeTurnId = parseTurnId(row.active_turn_id, 'active_turn_id');
        const statusObservedAt = parseEyesOnAgentsTimestamp(
          row.status_observed_at,
          'status_observed_at'
        );
        const hookActiveTurn = statusSource === 'codex_hook' &&
          ['working', 'waiting_approval', 'waiting_input'].includes(runtimeState) &&
          activeTurnId !== null &&
          statusObservedAt !== null &&
          activeTurnId !== `hook-${statusObservedAt}`
          ? { turnId: activeTurnId, statusObservedAt }
          : null;
        return {
          threadId: parseEyesOnAgentsUuid(row.thread_id),
          lastUserPromptCheckedAt: parseEyesOnAgentsTimestamp(
            row.last_user_prompt_checked_at,
            'last_user_prompt_checked_at'
          ),
          hookActiveTurn
        };
      };
      const hotRows = selectPage.all(
        THREAD_REFRESH_PAGE_SIZE,
        0
      ) as Array<{
        thread_id: string;
        runtime_state: string;
        active_turn_id: string | null;
        status_source: string;
        status_observed_at: number | null;
        last_user_prompt_checked_at: number | null;
      }>;
      const coldRows = coldPage === null
        ? []
        : selectPage.all(
            THREAD_REFRESH_PAGE_SIZE,
            (coldPage - 1) * THREAD_REFRESH_PAGE_SIZE
          ) as Array<{
            thread_id: string;
            runtime_state: string;
            active_turn_id: string | null;
            status_source: string;
            status_observed_at: number | null;
            last_user_prompt_checked_at: number | null;
          }>;
      return {
        hot: hotRows.map(toCandidate),
        cold: coldRows.map(toCandidate),
        pageCount,
        coldPage
      };
    });
    return transaction();
  }

  async refreshThreadPage(params: {
    threads: EyesOnAgentsThreadRefreshPatch[];
  }): Promise<{ changed: boolean }> {
    if (!params || !Array.isArray(params.threads)) throw new Error('threads must be an array');
    if (params.threads.length > THREAD_REFRESH_PAGE_SIZE) {
      throw new Error(`threads must not exceed ${THREAD_REFRESH_PAGE_SIZE} entries`);
    }
    const threads = params.threads.map(parseEyesOnAgentsThreadRefreshPatch);
    if (new Set(threads.map((thread) => thread.threadId)).size !== threads.length) {
      throw new Error('thread refresh patches must have unique threadIds');
    }
    const transaction = sqliteManager.db.transaction((): { changed: boolean } => {
      const select = sqliteManager.db.prepare(
        `SELECT title, last_activity_at,
          last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
          last_user_prompt_truncated, last_user_prompt_source, last_user_prompt_checked_at
         FROM eyes_on_agents_thread WHERE thread_id = ? AND is_archived = 0`
      );
      const now = Date.now();
      let changed = false;
      for (const thread of threads) {
        const row = select.get(thread.threadId) as ThreadRefreshPersistenceRow | undefined;
        if (!row) continue;
        const updates = new Map<string, ThreadRefreshColumnValue>();
        const setIfDifferent = (
          column: string,
          current: ThreadRefreshColumnValue,
          next: ThreadRefreshColumnValue
        ): void => {
          if (current !== next) updates.set(column, next);
        };

        if (thread.title !== undefined) {
          setIfDifferent('title', row.title, thread.title);
        }
        if (
          thread.lastActivityAt !== undefined
          && (
            row.last_activity_at === null
            || thread.lastActivityAt > row.last_activity_at
          )
        ) {
          updates.set('last_activity_at', thread.lastActivityAt);
        }

        if (thread.lastUserPrompt !== undefined) {
          const existingPreview = parseEyesOnAgentsLastUserPromptPreview(
            row.last_user_prompt_preview
          );
          const existingTurnId = parseTurnId(
            row.last_user_prompt_turn_id,
            'last_user_prompt_turn_id'
          );
          const existingObservedAt = parseEyesOnAgentsTimestamp(
            row.last_user_prompt_at,
            'last_user_prompt_at'
          );
          const existingCheckedAt = parseEyesOnAgentsTimestamp(
            row.last_user_prompt_checked_at,
            'last_user_prompt_checked_at'
          );
          if (row.last_user_prompt_truncated !== 0 && row.last_user_prompt_truncated !== 1) {
            throw new Error('last_user_prompt_truncated is invalid');
          }
          const existingSource = parseLastUserPromptSource(row.last_user_prompt_source);
          if (canApplyAppServerPrompt(row, thread.lastUserPrompt)) {
            setIfDifferent(
              'last_user_prompt_preview',
              existingPreview,
              thread.lastUserPrompt.preview
            );
            setIfDifferent(
              'last_user_prompt_truncated',
              row.last_user_prompt_truncated,
              thread.lastUserPrompt.truncated ? 1 : 0
            );
            setIfDifferent(
              'last_user_prompt_source',
              existingSource,
              thread.lastUserPrompt.source
            );
            if (shouldReplaceWithAppServerPrompt(row, thread.lastUserPrompt)) {
              setIfDifferent(
                'last_user_prompt_turn_id',
                existingTurnId,
                thread.lastUserPrompt.turnId
              );
              setIfDifferent(
                'last_user_prompt_at',
                existingObservedAt,
                thread.lastUserPrompt.observedAt
              );
            }
          }
          if (
            existingCheckedAt === null
            || thread.lastUserPrompt.checkedAt > existingCheckedAt
          ) {
            updates.set('last_user_prompt_checked_at', thread.lastUserPrompt.checkedAt);
          }
        }

        if (updates.size > 0) {
          updates.set('updated_at', now);
          const columns = [...updates.keys()];
          const result = sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET ${columns.map((column) => `${column} = ?`).join(', ')}
             WHERE thread_id = ? AND is_archived = 0`
          ).run(...updates.values(), thread.threadId);
          if (Number(result.changes) === 1) changed = true;
        }

        if (thread.terminalTurn !== undefined) {
          const runtimeState = thread.terminalTurn.outcome === 'completed'
            ? 'idle'
            : thread.terminalTurn.outcome === 'interrupted'
              ? 'ended'
              : 'failed';
          const result = sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET
              runtime_state = ?,
              active_flags_json = '[]',
              active_turn_id = NULL,
              last_completed_turn_id = ?,
              last_completed_at = ?,
              is_unread = 1,
              status_source = 'app_server',
              last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
              updated_at = ?
             WHERE thread_id = ?
               AND is_archived = 0
               AND status_source = 'codex_hook'
               AND runtime_state IN ('working', 'waiting_approval', 'waiting_input')
               AND active_turn_id = ?
               AND status_observed_at = ?`
          ).run(
            runtimeState,
            thread.terminalTurn.turnId,
            thread.terminalTurn.completedAt,
            thread.terminalTurn.completedAt,
            now,
            thread.threadId,
            thread.terminalTurn.expectedActiveTurnId,
            thread.terminalTurn.expectedStatusObservedAt
          );
          if (Number(result.changes) === 1) changed = true;
        }
      }
      return { changed };
    });
    return transaction();
  }

  async clearLastUserPrompts(): Promise<{ changed: boolean }> {
    const result = sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET
        last_user_prompt_preview = NULL,
        last_user_prompt_turn_id = NULL,
        last_user_prompt_at = NULL,
        last_user_prompt_truncated = 0,
        last_user_prompt_source = NULL,
        last_user_prompt_checked_at = NULL,
        updated_at = ?
       WHERE last_user_prompt_preview IS NOT NULL
          OR last_user_prompt_turn_id IS NOT NULL
          OR last_user_prompt_at IS NOT NULL
          OR last_user_prompt_truncated <> 0
          OR last_user_prompt_source IS NOT NULL
          OR last_user_prompt_checked_at IS NOT NULL`
    ).run(Date.now());
    return { changed: Number(result.changes) > 0 };
  }

  async invalidateAppServerStatuses(params: { observedAt: number }): Promise<void> {
    const observedAt = parseEyesOnAgentsTimestamp(
      params?.observedAt,
      'observedAt',
      false
    ) as number;
    await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET
        runtime_state = 'unknown',
        active_flags_json = '[]',
        active_turn_id = NULL,
        status_source = 'discovery',
        status_observed_at = ?,
        updated_at = ?
       WHERE status_source = 'app_server'`,
      [observedAt, Date.now()]
    );
  }

  async invalidateCodexHookStatuses(params: { observedAt: number }): Promise<void> {
    const observedAt = parseEyesOnAgentsTimestamp(
      params?.observedAt,
      'observedAt',
      false
    ) as number;
    await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET
        runtime_state = 'unknown',
        active_flags_json = '[]',
        active_turn_id = NULL,
        status_source = 'discovery',
        status_observed_at = ?,
        updated_at = ?
       WHERE status_source = 'codex_hook'
         AND runtime_state IN ('working', 'waiting_approval', 'waiting_input')`,
      [observedAt, Date.now()]
    );
  }

  async upsertDiscoveredThreads(params: {
    threads: EyesOnAgentsDiscoveredThread[];
  }): Promise<void> {
    if (!params || !Array.isArray(params.threads)) throw new Error('threads must be an array');
    const threads = params.threads.map(normalizeDiscoveredThread);
    const transaction = sqliteManager.db.transaction(() => {
      const domainId = defaultDomainId();
      const now = Date.now();
      const statement = sqliteManager.db.prepare(
        `INSERT INTO eyes_on_agents_thread (
          thread_id, domain_id, title, cwd, project_key, project_root, project_name,
          runtime_state, active_flags_json,
          active_turn_id, last_completed_turn_id, last_completed_at,
          last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
          last_activity_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          title = COALESCE(excluded.title, eyes_on_agents_thread.title),
          cwd = COALESCE(excluded.cwd, eyes_on_agents_thread.cwd),
          is_archived = 0,
          runtime_state = CASE
            WHEN excluded.status_source = 'discovery'
              AND eyes_on_agents_thread.status_source IN ('app_server', 'discovery')
              AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.runtime_state
            WHEN excluded.status_source = 'discovery' THEN eyes_on_agents_thread.runtime_state
            WHEN COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.runtime_state
            ELSE eyes_on_agents_thread.runtime_state
          END,
          active_flags_json = CASE
            WHEN excluded.status_source = 'discovery'
              AND eyes_on_agents_thread.status_source IN ('app_server', 'discovery')
              AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.active_flags_json
            WHEN excluded.status_source = 'discovery' THEN eyes_on_agents_thread.active_flags_json
            WHEN COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.active_flags_json
            ELSE eyes_on_agents_thread.active_flags_json
          END,
          active_turn_id = CASE
            WHEN excluded.status_source = 'discovery'
              AND eyes_on_agents_thread.status_source IN ('app_server', 'discovery')
              AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN NULL
            ELSE eyes_on_agents_thread.active_turn_id
          END,
          is_unread = CASE
            WHEN excluded.runtime_state IN ('working', 'waiting_approval', 'waiting_input') THEN 1
            ELSE eyes_on_agents_thread.is_unread
          END,
          status_source = CASE
            WHEN excluded.status_source = 'discovery'
              AND eyes_on_agents_thread.status_source IN ('app_server', 'discovery')
              AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.status_source
            WHEN excluded.status_source = 'discovery' THEN eyes_on_agents_thread.status_source
            WHEN COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.status_source
            ELSE eyes_on_agents_thread.status_source
          END,
          status_observed_at = CASE
            WHEN excluded.status_source = 'discovery'
              AND eyes_on_agents_thread.status_source IN ('app_server', 'discovery')
              AND COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.status_observed_at
            WHEN excluded.status_source = 'discovery' THEN eyes_on_agents_thread.status_observed_at
            WHEN COALESCE(excluded.status_observed_at, 0) >= COALESCE(eyes_on_agents_thread.status_observed_at, 0)
              THEN excluded.status_observed_at
            ELSE eyes_on_agents_thread.status_observed_at
          END,
          last_activity_at = CASE
            WHEN excluded.last_activity_at IS NULL THEN eyes_on_agents_thread.last_activity_at
            ELSE MAX(COALESCE(eyes_on_agents_thread.last_activity_at, 0), excluded.last_activity_at)
          END,
          updated_at = excluded.updated_at`
      );
      for (const thread of threads) {
        const project = projectColumns(thread.project);
        statement.run(
          thread.threadId,
          domainId,
          thread.title,
          thread.cwd,
          ...project,
          thread.runtimeState,
          JSON.stringify(thread.activeFlags),
          ['working', 'waiting_approval', 'waiting_input'].includes(thread.runtimeState) ? 1 : 0,
          thread.statusSource,
          thread.statusObservedAt,
          thread.lastActivityAt,
          now,
          now
        );
        if (thread.project !== undefined) {
          sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET
              project_key = ?, project_root = ?, project_name = ?
             WHERE thread_id = ?`
          ).run(...project, thread.threadId);
        }
      }
    });
    transaction();
  }

  async upsertThreadSnapshots(params: {
    snapshots: EyesOnAgentsThreadSnapshot[];
  }): Promise<void> {
    if (!params || !Array.isArray(params.snapshots)) {
      throw new Error('snapshots must be an array');
    }
    if (params.snapshots.length > MAX_THREAD_SNAPSHOTS) {
      throw new Error(`snapshots must not exceed ${MAX_THREAD_SNAPSHOTS} entries`);
    }
    const snapshots = params.snapshots.map(normalizeThreadSnapshot);
    const transaction = sqliteManager.db.transaction(() => {
      const now = Date.now();
      const statement = sqliteManager.db.prepare(
        `INSERT INTO eyes_on_agents_thread_snapshot (
          thread_id, payload_json, is_archived, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          is_archived = excluded.is_archived,
          synced_at = excluded.synced_at,
          updated_at = excluded.updated_at`
      );
      for (const snapshot of snapshots) {
        statement.run(
          snapshot.threadId,
          snapshot.payloadJson,
          snapshot.archived ? 1 : 0,
          snapshot.syncedAt,
          now,
          now
        );
      }
    });
    transaction();
  }

  async setThreadArchived(params: {
    threadId: string;
    archived: boolean;
    observedAt: number;
  }): Promise<void> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    if (typeof params?.archived !== 'boolean') throw new Error('archived must be a boolean');
    const observedAt = parseEyesOnAgentsTimestamp(
      params.observedAt,
      'observedAt',
      false
    ) as number;
    const transaction = sqliteManager.db.transaction(() => {
      const now = Date.now();
      sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread SET
          is_archived = ?,
          runtime_state = 'unknown',
          active_flags_json = '[]',
          active_turn_id = NULL,
          status_source = 'discovery',
          status_observed_at = ?,
          updated_at = ?
         WHERE thread_id = ?`
      ).run(params.archived ? 1 : 0, observedAt, now, threadId);
      sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread_snapshot SET
          is_archived = ?, updated_at = ?
         WHERE thread_id = ?`
      ).run(params.archived ? 1 : 0, now, threadId);
    });
    transaction();
  }

  async markThreadsArchived(params: {
    threadIds: string[];
    observedAt: number;
  }): Promise<void> {
    if (!params || !Array.isArray(params.threadIds)) {
      throw new Error('threadIds must be an array');
    }
    if (params.threadIds.length > MAX_ARCHIVED_THREAD_IDS) {
      throw new Error(`threadIds must not exceed ${MAX_ARCHIVED_THREAD_IDS} entries`);
    }
    const threadIds = [...new Set(params.threadIds.map((threadId) => (
      parseEyesOnAgentsUuid(threadId)
    )))];
    const observedAt = parseEyesOnAgentsTimestamp(
      params.observedAt,
      'observedAt',
      false
    ) as number;
    const transaction = sqliteManager.db.transaction(() => {
      const now = Date.now();
      const statement = sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread SET
          is_archived = 1,
          runtime_state = 'unknown',
          active_flags_json = '[]',
          active_turn_id = NULL,
          status_source = 'discovery',
          status_observed_at = ?,
          updated_at = ?
         WHERE thread_id = ?`
      );
      const snapshotStatement = sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread_snapshot SET
          is_archived = 1, updated_at = ?
         WHERE thread_id = ?`
      );
      for (const threadId of threadIds) {
        statement.run(observedAt, now, threadId);
        snapshotStatement.run(now, threadId);
      }
    });
    transaction();
  }

  async applyRuntimeEvent(params: {
    event: EyesOnAgentsRuntimeEvent;
    hookLastUserPrompt?: EyesOnAgentsHookLastUserPromptCandidate;
  }): Promise<EyesOnAgentsRuntimePersistenceResult> {
    if (!params) throw new Error('event params are required');
    const event = parseEyesOnAgentsRuntimeEvent(params.event);
    const hookLastUserPrompt = normalizeHookLastUserPromptCandidate(
      event,
      params.hookLastUserPrompt
    );
    const transaction = sqliteManager.db.transaction(
      (): EyesOnAgentsRuntimePersistenceResult => {
        const result = applyRuntimeEventInTransaction(event);
        if (hookLastUserPrompt !== undefined && event.type === 'turn_started') {
          applyHookLastUserPromptInTransaction(event, hookLastUserPrompt);
        }
        return result;
      }
    );
    return transaction();
  }

  async applyRuntimeEventDelivery(params: {
    deliveryId: string;
    event: EyesOnAgentsRuntimeEvent;
    replayAuthority?: 'current_listener';
    hookLastUserPrompt?: EyesOnAgentsHookLastUserPromptCandidate;
  }): Promise<EyesOnAgentsRuntimeDeliveryPersistenceResult> {
    if (!params) throw new Error('delivery params are required');
    const deliveryId = parseEyesOnAgentsUuid(params.deliveryId, 'deliveryId');
    const event = parseEyesOnAgentsRuntimeEvent(params.event);
    if (event.source !== 'codex_hook') {
      throw new Error('delivery event source must be codex_hook');
    }
    if (
      params.replayAuthority !== undefined
      && params.replayAuthority !== 'current_listener'
    ) {
      throw new Error('delivery replay authority is unsupported');
    }
    const hookLastUserPrompt = normalizeHookLastUserPromptCandidate(
      event,
      params.hookLastUserPrompt
    );
    const transaction = sqliteManager.db.transaction(
      (): EyesOnAgentsRuntimeDeliveryPersistenceResult => {
        const result = sqliteManager.db.prepare(
          `INSERT INTO eyes_on_agents_hook_delivery_receipt (
            delivery_id, thread_id, observed_at, committed_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(delivery_id) DO NOTHING`
        ).run(deliveryId, event.threadId, event.observedAt, Date.now());
        if (Number(result.changes) === 0) {
          return { duplicate: true, created: false, titleMissing: false };
        }
        const persistence = applyRuntimeEventInTransaction(
          event,
          params.replayAuthority === 'current_listener'
        );
        if (hookLastUserPrompt !== undefined && event.type === 'turn_started') {
          applyHookLastUserPromptInTransaction(event, hookLastUserPrompt);
        }
        return { duplicate: false, ...persistence };
      }
    );
    return transaction();
  }

  async enrichMissingThreadTitle(params: {
    threadId: string;
    title: string;
  }): Promise<{ changed: boolean }> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const title = parseEyesOnAgentsText(params?.title, 'thread title', 300, false) as string;
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET title = ?, updated_at = ?
       WHERE thread_id = ? AND is_archived = 0 AND title IS NULL`,
      [title, Date.now(), threadId]
    );
    return { changed: Number(result.changes) === 1 };
  }

  async markOpened(params: { threadId: string; openedAt: number }): Promise<void> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const openedAt = parseEyesOnAgentsTimestamp(params?.openedAt, 'openedAt', false) as number;
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET
        last_opened_turn_id = COALESCE(active_turn_id, last_completed_turn_id),
        last_opened_at = ?,
        is_unread = 0,
        updated_at = ?
       WHERE thread_id = ?`,
      [openedAt, Date.now(), threadId]
    );
    if (Number(result.changes) === 0) throw new Error('Thread was not found');
  }

  async markAllRead(): Promise<EyesOnAgentsRepositoryMutationResult> {
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET is_unread = 0
       WHERE is_archived = 0
         AND is_unread = 1
         AND runtime_state NOT IN ('working', 'waiting_approval', 'waiting_input')`,
      []
    );
    return { changed: Number(result.changes) > 0 };
  }

  async createDomain(params: { title: string }): Promise<void> {
    const title = parseEyesOnAgentsText(params?.title, 'Domain title', 80, false) as string;
    const transaction = sqliteManager.db.transaction(() => {
      ensureUniqueDomainTitle(title);
      const row = sqliteManager.db.prepare(
        `SELECT COALESCE(MAX(sort_index), 0) AS max_sort
         FROM eyes_on_agents_domain WHERE is_deleted = 0`
      ).get() as { max_sort: number };
      const now = Date.now();
      sqliteManager.db.prepare(
        `INSERT INTO eyes_on_agents_domain (
          domain_key, title, sort_index, is_system, is_deleted, delete_flag,
          deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 0, '0', NULL, ?, ?)`
      ).run(`domain-${randomUUID()}`, title, row.max_sort + 1, now, now);
    });
    transaction();
  }

  async renameDomain(params: { domainId: number; title: string }): Promise<void> {
    const domainId = parsePositiveId(params?.domainId, 'domainId');
    const title = parseEyesOnAgentsText(params?.title, 'Domain title', 80, false) as string;
    const transaction = sqliteManager.db.transaction(() => {
      const domain = requireActiveDomain(domainId);
      if (domain.is_system === 1) throw new Error('System Domains cannot be renamed');
      ensureUniqueDomainTitle(title, domainId);
      sqliteManager.db.prepare(
        'UPDATE eyes_on_agents_domain SET title = ?, updated_at = ? WHERE id = ?'
      ).run(title, Date.now(), domainId);
    });
    transaction();
  }

  async deleteDomain(params: { domainId: number }): Promise<void> {
    const domainId = parsePositiveId(params?.domainId, 'domainId');
    const transaction = sqliteManager.db.transaction(() => {
      const domain = requireActiveDomain(domainId);
      if (domain.is_system === 1) throw new Error('System Domains cannot be deleted');
      const now = Date.now();
      sqliteManager.db.prepare(
        'UPDATE eyes_on_agents_thread SET domain_id = ?, updated_at = ? WHERE domain_id = ?'
      ).run(defaultDomainId(), now, domainId);
      sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_domain SET
          is_deleted = 1, delete_flag = ?, deleted_at = ?, updated_at = ?
         WHERE id = ? AND is_deleted = 0`
      ).run(`${now}-${randomUUID()}`, now, now, domainId);
    });
    transaction();
  }

  async reorderDomains(params: { domainIds: number[] }): Promise<void> {
    if (!params || !Array.isArray(params.domainIds)) throw new Error('domainIds must be an array');
    const requested = params.domainIds.map((id) => parsePositiveId(id, 'domainId'));
    if (new Set(requested).size !== requested.length) throw new Error('domainIds must be unique');
    const transaction = sqliteManager.db.transaction(() => {
      const rows = sqliteManager.db.prepare(
        `SELECT id FROM eyes_on_agents_domain
         WHERE is_deleted = 0 AND is_system = 0 ORDER BY sort_index ASC`
      ).all() as Array<{ id: number }>;
      const customIds = rows.map((row) => row.id);
      const withoutSystem = requested.filter((id) => requireActiveDomain(id).is_system !== 1);
      if (
        withoutSystem.length !== customIds.length ||
        !withoutSystem.every((id) => customIds.includes(id))
      ) {
        throw new Error('domainIds must include every active custom Domain');
      }
      const update = sqliteManager.db.prepare(
        'UPDATE eyes_on_agents_domain SET sort_index = ?, updated_at = ? WHERE id = ?'
      );
      const now = Date.now();
      withoutSystem.forEach((id, index) => update.run(index + 1, now, id));
    });
    transaction();
  }

  async moveThread(params: { threadId: string; domainId: number }): Promise<void> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const domainId = parsePositiveId(params?.domainId, 'domainId');
    requireActiveDomain(domainId);
    const result = await sqliteHelper.safeRun(
      'UPDATE eyes_on_agents_thread SET domain_id = ?, updated_at = ? WHERE thread_id = ?',
      [domainId, Date.now(), threadId]
    );
    if (Number(result.changes) === 0) throw new Error('Thread was not found');
  }
}

export const eyesOnAgentsRepositoryDao = new EyesOnAgentsRepositoryDao();
