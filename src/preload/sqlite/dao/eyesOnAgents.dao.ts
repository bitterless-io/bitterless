import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import { sqliteManager } from '../sqliteHelper/sqlite.manager';
import type {
  EyesOnAgentsCompletionAlertIntent,
  EyesOnAgentsClaudeAgentState,
  EyesOnAgentsClaudeDeletionReconciliation,
  EyesOnAgentsClaudeDeletionTombstone,
  EyesOnAgentsClaudeInventoryThread,
  EyesOnAgentsClaudeOpenTarget,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsDomain,
  EyesOnAgentsHookLastUserPromptCandidate,
  EyesOnAgentsLastUserPrompt,
  EyesOnAgentsProjectMetadata,
  EyesOnAgentsProvider,
  EyesOnAgentsSessionKey,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRepositoryMutationResult,
  EyesOnAgentsRuntimeDeliveryPersistenceResult,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsRuntimePersistenceResult,
  EyesOnAgentsRuntimeState,
  EyesOnAgentsSnapshot,
  EyesOnAgentsStatusSource,
  EyesOnAgentsThread,
  EyesOnAgentsThreadPagePersistenceResult,
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
  parseEyesOnAgentsDesktopSessionId,
  parseEyesOnAgentsIterm2SessionId,
  parseEyesOnAgentsHookLastUserPromptCandidate,
  parseEyesOnAgentsLastUserPromptPreview,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsProjectMetadata,
  parseEyesOnAgentsProvider,
  parseEyesOnAgentsRuntimeEvent,
  parseEyesOnAgentsRuntimeState,
  parseEyesOnAgentsText,
  parseEyesOnAgentsThreadRefreshPatch,
  parseEyesOnAgentsTimestamp,
  parseEyesOnAgentsUuid,
  buildEyesOnAgentsSessionKey,
  parseEyesOnAgentsSessionKey
} from '@shared/eyesOnAgents/eyesOnAgents.contract';

interface DomainRow {
  id: number;
  domain_key: string;
  title: string;
  sort_index: number;
  is_system: number;
}

interface ThreadRow {
  session_key: string;
  provider: string;
  thread_id: string;
  desktop_session_id: string | null;
  iterm2_session_id: string | null;
  transcript_path: string | null;
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
  archive_state: string;
  status_source: string;
  status_observed_at: number | null;
  status_fresh_until: number | null;
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
const MAX_CLAUDE_DELETION_TOMBSTONES = 20_000;
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
  if (
    value === 'app_server'
    || value === 'app_server_turn'
    || value === 'codex_hook'
    || value === 'claude_hook'
    || value === 'claude_agent_view'
    || value === 'discovery'
  ) return value;
  throw new Error('status source is unsupported');
};

const normalizeClaudeTranscriptPath = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const path = parseEyesOnAgentsPath(value);
  if (path === null || !isAbsolute(path)) throw new Error('Claude transcript path must be absolute');
  return path;
};

const normalizeClaudeInventoryThread = (
  value: EyesOnAgentsClaudeInventoryThread
): EyesOnAgentsClaudeInventoryThread => {
  const archiveState = value?.archiveState;
  if (archiveState !== 'active' && archiveState !== 'archived' && archiveState !== 'unknown') {
    throw new Error('Claude archive state is unsupported');
  }
  return {
    threadId: parseEyesOnAgentsUuid(value.threadId),
    desktopSessionId: parseEyesOnAgentsDesktopSessionId(value.desktopSessionId),
    iterm2SessionId: parseEyesOnAgentsIterm2SessionId(value.iterm2SessionId),
    desktopMetadataMtime: parseEyesOnAgentsTimestamp(
      value.desktopMetadataMtime,
      'desktopMetadataMtime'
    ),
    transcriptPath: normalizeClaudeTranscriptPath(value.transcriptPath),
    clearDesktopSessionId: value.clearDesktopSessionId === true,
    clearTranscriptPath: value.clearTranscriptPath === true,
    desktopEvidenceComplete: value.desktopEvidenceComplete === true,
    transcriptEvidenceComplete: value.transcriptEvidenceComplete === true,
    title: parseEyesOnAgentsText(value.title, 'Claude title', 300),
    cwd: parseEyesOnAgentsPath(value.cwd),
    project: value.project === undefined ? undefined : parseEyesOnAgentsProjectMetadata(value.project),
    archiveState,
    transcriptActivityAt: parseEyesOnAgentsTimestamp(
      value.transcriptActivityAt,
      'transcriptActivityAt'
    ),
    lastActivityAt: parseEyesOnAgentsTimestamp(value.lastActivityAt, 'lastActivityAt'),
    observedAt: parseEyesOnAgentsTimestamp(value.observedAt, 'observedAt', false) as number
  };
};

const normalizeClaudeDeletionSourceKey = (value: unknown): string => {
  const sourceKey = parseEyesOnAgentsPath(value);
  if (sourceKey === null || !isAbsolute(sourceKey)) {
    throw new Error('Claude deletion source key must be an absolute path');
  }
  return sourceKey;
};

const normalizeClaudeDeletionTombstone = (
  value: EyesOnAgentsClaudeDeletionTombstone
): EyesOnAgentsClaudeDeletionTombstone => {
  const observedAt = parseEyesOnAgentsTimestamp(
    value?.observedAt,
    'Claude deletion observedAt',
    false
  ) as number;
  const deletedAt = parseEyesOnAgentsTimestamp(
    value?.deletedAt,
    'Claude deletion deletedAt',
    false
  ) as number;
  if (deletedAt > observedAt) throw new Error('Claude deletion time cannot be in the future');
  return {
    sourceKey: normalizeClaudeDeletionSourceKey(value?.sourceKey),
    identityId: parseEyesOnAgentsUuid(value?.identityId, 'Claude deletion identity'),
    deletedAt,
    observedAt
  };
};

const normalizeClaudeDeletionReconciliation = (
  value: EyesOnAgentsClaudeDeletionReconciliation
): EyesOnAgentsClaudeDeletionReconciliation => {
  if (!value || !Array.isArray(value.tombstones) ||
    value.tombstones.length > MAX_CLAUDE_DELETION_TOMBSTONES ||
    !Array.isArray(value.healthyScopeKeys) ||
    value.healthyScopeKeys.length > MAX_CLAUDE_DELETION_TOMBSTONES ||
    typeof value.completeSnapshot !== 'boolean') {
    throw new Error('Claude deletion reconciliation is invalid');
  }
  const observedAt = parseEyesOnAgentsTimestamp(
    value.observedAt,
    'Claude deletion reconciliation observedAt',
    false
  ) as number;
  const healthyScopeKeys = value.healthyScopeKeys.map(normalizeClaudeDeletionSourceKey);
  if (new Set(healthyScopeKeys).size !== healthyScopeKeys.length) {
    throw new Error('Claude deletion source keys must be unique');
  }
  const healthyScopes = new Set(healthyScopeKeys);
  const tombstones = value.tombstones.map(normalizeClaudeDeletionTombstone);
  if (new Set(tombstones.map((item) => `${item.sourceKey}\0${item.identityId}`)).size !==
    tombstones.length || tombstones.some((item) =>
      item.observedAt !== observedAt || !healthyScopes.has(item.sourceKey))) {
    throw new Error('Claude deletion tombstones are inconsistent');
  }
  return { tombstones, healthyScopeKeys, completeSnapshot: value.completeSnapshot, observedAt };
};

const normalizeClaudeAgentState = (
  value: EyesOnAgentsClaudeAgentState
): EyesOnAgentsClaudeAgentState => ({
  threadId: parseEyesOnAgentsUuid(value?.threadId),
  runtimeState: parseEyesOnAgentsRuntimeState(value?.runtimeState),
  title: parseEyesOnAgentsText(value?.title, 'Claude agent title', 300),
  cwd: parseEyesOnAgentsPath(value?.cwd),
  startedAt: parseEyesOnAgentsTimestamp(value?.startedAt, 'startedAt'),
  observedAt: parseEyesOnAgentsTimestamp(value?.observedAt, 'observedAt', false) as number
});

const parseTurnId = (value: unknown, label: string): string | null => {
  return parseEyesOnAgentsText(value, label, 200);
};

const parseLastUserPromptSource = (
  value: unknown
): 'app_server' | 'codex_hook' | 'claude_hook' | null => {
  if (value === null) return null;
  if (value === 'app_server' || value === 'codex_hook' || value === 'claude_hook') return value;
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
  const provider = parseEyesOnAgentsProvider(row.provider);
  const threadId = parseEyesOnAgentsUuid(row.thread_id);
  const sessionKey = parseEyesOnAgentsSessionKey(row.session_key);
  if (sessionKey !== buildEyesOnAgentsSessionKey(provider, threadId)) {
    throw new Error('session identity is inconsistent');
  }
  if (!['active', 'archived', 'unknown'].includes(row.archive_state)) {
    throw new Error('archive state is unsupported');
  }
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
    sessionKey,
    provider,
    threadId,
    archiveState: row.archive_state as 'active' | 'archived' | 'unknown',
    desktopSessionId: parseEyesOnAgentsDesktopSessionId(row.desktop_session_id),
    iterm2SessionId: parseEyesOnAgentsIterm2SessionId(row.iterm2_session_id),
    canCopySessionPath: provider === 'claude' && row.transcript_path !== null,
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
    statusFreshUntil: toIso(
      parseEyesOnAgentsTimestamp(row.status_fresh_until, 'status_fresh_until')
    ),
    lastActivityAt: toIso(
      parseEyesOnAgentsTimestamp(row.last_activity_at, 'last_activity_at')
    ),
    isUnread,
    isFocused: isEyesOnAgentsFocused(runtimeState, isUnread),
    lastUserPrompt: toLastUserPrompt(row)
  };
};

const THREAD_REFRESH_CANDIDATE_COLUMNS =
  `session_key, provider, thread_id, runtime_state, active_turn_id, is_unread, status_source,
    status_observed_at, last_user_prompt_checked_at`;

interface ThreadRefreshCandidateRow {
  session_key: string;
  provider: string;
  thread_id: string;
  runtime_state: string;
  active_turn_id: string | null;
  is_unread: number;
  status_source: string;
  status_observed_at: number | null;
  last_user_prompt_checked_at: number | null;
}

const toRefreshCandidate = (
  row: ThreadRefreshCandidateRow
): EyesOnAgentsThreadRefreshCandidate => {
  const runtimeState = parseEyesOnAgentsRuntimeState(row.runtime_state);
  const statusSource = parseStatusSource(row.status_source);
  const activeTurnId = parseTurnId(row.active_turn_id, 'active_turn_id');
  if (row.is_unread !== 0 && row.is_unread !== 1) throw new Error('is_unread is invalid');
  const statusObservedAt = parseEyesOnAgentsTimestamp(
    row.status_observed_at,
    'status_observed_at'
  );
  const activeTurn = (statusSource === 'codex_hook' || statusSource === 'app_server_turn') &&
    ['working', 'waiting_approval', 'waiting_input'].includes(runtimeState) &&
    activeTurnId !== null &&
    statusObservedAt !== null &&
    activeTurnId !== `hook-${statusObservedAt}`
    ? { turnId: activeTurnId, statusObservedAt, statusSource, runtimeState }
    : null;
  const recoveryCandidate = activeTurn === null &&
    statusSource === 'discovery' &&
    runtimeState === 'unknown' &&
    row.is_unread === 1 &&
    activeTurnId === null &&
    statusObservedAt !== null
    ? { statusObservedAt }
    : null;
  return {
    sessionKey: parseEyesOnAgentsSessionKey(row.session_key),
    provider: parseEyesOnAgentsProvider(row.provider),
    threadId: parseEyesOnAgentsUuid(row.thread_id),
    lastUserPromptCheckedAt: parseEyesOnAgentsTimestamp(
      row.last_user_prompt_checked_at,
      'last_user_prompt_checked_at'
    ),
    activeTurn,
    recoveryCandidate
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

const runtimeEventProvider = (event: EyesOnAgentsRuntimeEvent): EyesOnAgentsProvider => (
  event.source === 'claude_hook' ? 'claude' : 'codex'
);

const claudeDesktopIdentityUuid = (desktopSessionId: string | null): string | null => {
  const parsed = parseEyesOnAgentsDesktopSessionId(desktopSessionId);
  return parsed === null ? null : parsed.slice('local_'.length);
};

const hasActiveClaudeDeletionIdentity = (identityId: string): boolean => Boolean(
  sqliteManager.db.prepare(
    `SELECT 1 FROM eyes_on_agents_claude_deletion_tombstone
     WHERE is_active = 1 AND identity_id = ? LIMIT 1`
  ).get(identityId)
);

const hasActiveClaudeDeletionTombstone = (
  threadId: string,
  desktopSessionId: string | null
): boolean => {
  const desktopIdentityId = claudeDesktopIdentityUuid(desktopSessionId);
  if (hasActiveClaudeDeletionIdentity(threadId)) return true;
  if (desktopIdentityId === null || !hasActiveClaudeDeletionIdentity(desktopIdentityId)) {
    return false;
  }
  const row = sqliteManager.db.prepare(
    `SELECT COUNT(*) AS count FROM eyes_on_agents_thread
     WHERE provider = 'claude' AND desktop_identity_ambiguous = 0
       AND desktop_session_id = ?`
  ).get(desktopSessionId) as { count: number };
  return Number(row.count) === 1;
};

const isClaudeRuntimeIdentityDeleted = (threadId: string): boolean => {
  const row = sqliteManager.db.prepare(
    `SELECT desktop_session_id, is_deleted FROM eyes_on_agents_thread
     WHERE provider = 'claude' AND thread_id = ?`
  ).get(threadId) as { desktop_session_id: string | null; is_deleted: number } | undefined;
  if (hasActiveClaudeDeletionTombstone(threadId, row?.desktop_session_id ?? null)) return true;
  if (row) return row.is_deleted === 1;
  return Boolean(sqliteManager.db.prepare(
    `SELECT 1 FROM eyes_on_agents_claude_deletion_tombstone
     WHERE identity_id = ? LIMIT 1`
  ).get(threadId));
};

const latestClaudeDeletionAt = (
  threadId: string,
  desktopSessionId: string | null,
  rowDeletedAt: number | null
): number | null => {
  const desktopIdentityId = claudeDesktopIdentityUuid(desktopSessionId);
  const row = sqliteManager.db.prepare(
    `SELECT MAX(deleted_at) AS deleted_at
     FROM eyes_on_agents_claude_deletion_tombstone
     WHERE identity_id = ? OR (? IS NOT NULL AND identity_id = ?)`
  ).get(threadId, desktopIdentityId, desktopIdentityId) as { deleted_at: number | null };
  if (row.deleted_at === null) return rowDeletedAt;
  return rowDeletedAt === null ? row.deleted_at : Math.max(rowDeletedAt, row.deleted_at);
};

const reconcileClaudeDeletionTombstonesInTransaction = (
  deletion: EyesOnAgentsClaudeDeletionReconciliation
): boolean => {
  const now = Date.now();
  const upsert = sqliteManager.db.prepare(
    `INSERT INTO eyes_on_agents_claude_deletion_tombstone (
      source_key, identity_id, deleted_at, last_seen_at, is_active, cleared_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)
    ON CONFLICT(source_key, identity_id) DO UPDATE SET
      deleted_at = MAX(eyes_on_agents_claude_deletion_tombstone.deleted_at, excluded.deleted_at),
      last_seen_at = MAX(eyes_on_agents_claude_deletion_tombstone.last_seen_at, excluded.last_seen_at),
      is_active = 1,
      cleared_at = NULL,
      updated_at = excluded.updated_at`
  );
  for (const tombstone of deletion.tombstones) {
    upsert.run(
      tombstone.sourceKey,
      tombstone.identityId,
      tombstone.deletedAt,
      tombstone.observedAt,
      now,
      now
    );
  }

  if (deletion.completeSnapshot && deletion.healthyScopeKeys.length > 0) {
    const healthyPlaceholders = deletion.healthyScopeKeys.map(() => '?').join(', ');
    const activeRows = sqliteManager.db.prepare(
      `SELECT source_key, identity_id
       FROM eyes_on_agents_claude_deletion_tombstone
       WHERE is_active = 1 AND source_key IN (${healthyPlaceholders})`
    ).all(...deletion.healthyScopeKeys) as Array<{ source_key: string; identity_id: string }>;
    const observed = new Set(deletion.tombstones.map(
      (item) => `${item.sourceKey}\0${item.identityId}`
    ));
    const clear = sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_claude_deletion_tombstone SET
        is_active = 0, cleared_at = ?, updated_at = ?
       WHERE source_key = ? AND identity_id = ? AND is_active = 1`
    );
    for (const row of activeRows) {
      if (!observed.has(`${row.source_key}\0${row.identity_id}`)) {
        clear.run(deletion.observedAt, now, row.source_key, row.identity_id);
      }
    }
  }

  const deleted = sqliteManager.db.prepare(
    `UPDATE eyes_on_agents_thread SET
      is_deleted = 1,
      deleted_at = (
        SELECT MAX(tombstone.deleted_at)
        FROM eyes_on_agents_claude_deletion_tombstone AS tombstone
        WHERE tombstone.is_active = 1 AND (
          tombstone.identity_id = eyes_on_agents_thread.thread_id OR
          (eyes_on_agents_thread.desktop_identity_ambiguous = 0 AND
            eyes_on_agents_thread.desktop_session_id = 'local_' || tombstone.identity_id AND
            (SELECT COUNT(*) FROM eyes_on_agents_thread AS desktop_match
             WHERE desktop_match.provider = 'claude'
               AND desktop_match.desktop_identity_ambiguous = 0
               AND desktop_match.desktop_session_id = eyes_on_agents_thread.desktop_session_id) = 1)
        )
      ),
      transcript_path = NULL,
      transcript_identity_ambiguous = 0,
      transcript_activity_at = NULL,
      title = NULL,
      cwd = NULL,
      project_key = NULL,
      project_root = NULL,
      project_name = NULL,
      runtime_state = 'unknown',
      active_flags_json = '[]',
      active_turn_id = NULL,
      last_completed_turn_id = NULL,
      last_completed_at = NULL,
      last_opened_turn_id = NULL,
      last_opened_at = NULL,
      is_unread = 0,
      status_source = 'discovery',
      status_observed_at = NULL,
      status_fresh_until = NULL,
      last_activity_at = NULL,
      last_user_prompt_preview = NULL,
      last_user_prompt_turn_id = NULL,
      last_user_prompt_at = NULL,
      last_user_prompt_truncated = 0,
      last_user_prompt_source = NULL,
      last_user_prompt_checked_at = NULL,
      updated_at = ?
     WHERE provider = 'claude'
       AND EXISTS (
         SELECT 1 FROM eyes_on_agents_claude_deletion_tombstone AS tombstone
         WHERE tombstone.is_active = 1 AND (
           tombstone.identity_id = eyes_on_agents_thread.thread_id OR
           (eyes_on_agents_thread.desktop_identity_ambiguous = 0 AND
             eyes_on_agents_thread.desktop_session_id = 'local_' || tombstone.identity_id AND
             (SELECT COUNT(*) FROM eyes_on_agents_thread AS desktop_match
              WHERE desktop_match.provider = 'claude'
                AND desktop_match.desktop_identity_ambiguous = 0
                AND desktop_match.desktop_session_id = eyes_on_agents_thread.desktop_session_id) = 1)
         )
       )
       AND (
         is_deleted = 0 OR transcript_path IS NOT NULL OR transcript_activity_at IS NOT NULL OR
         title IS NOT NULL OR cwd IS NOT NULL OR project_key IS NOT NULL OR
         project_root IS NOT NULL OR project_name IS NOT NULL OR
         runtime_state <> 'unknown' OR active_flags_json <> '[]' OR active_turn_id IS NOT NULL OR
         last_completed_turn_id IS NOT NULL OR last_completed_at IS NOT NULL OR
         last_opened_turn_id IS NOT NULL OR last_opened_at IS NOT NULL OR is_unread <> 0 OR
         status_source <> 'discovery' OR status_observed_at IS NOT NULL OR
         status_fresh_until IS NOT NULL OR last_activity_at IS NOT NULL OR
         last_user_prompt_preview IS NOT NULL OR last_user_prompt_turn_id IS NOT NULL OR
         last_user_prompt_at IS NOT NULL OR last_user_prompt_truncated <> 0 OR
         last_user_prompt_source IS NOT NULL OR last_user_prompt_checked_at IS NOT NULL OR
         deleted_at <> (
           SELECT MAX(tombstone.deleted_at)
           FROM eyes_on_agents_claude_deletion_tombstone AS tombstone
           WHERE tombstone.is_active = 1 AND (
             tombstone.identity_id = eyes_on_agents_thread.thread_id OR
             (eyes_on_agents_thread.desktop_identity_ambiguous = 0 AND
               eyes_on_agents_thread.desktop_session_id = 'local_' || tombstone.identity_id AND
               (SELECT COUNT(*) FROM eyes_on_agents_thread AS desktop_match
                WHERE desktop_match.provider = 'claude'
                  AND desktop_match.desktop_identity_ambiguous = 0
                  AND desktop_match.desktop_session_id = eyes_on_agents_thread.desktop_session_id) = 1)
           )
         )
       )`
  ).run(now);
  return Number(deleted.changes) > 0;
};

const titleFromStoredThreadSnapshot = (
  provider: EyesOnAgentsProvider,
  threadId: string
): string | null => {
  if (provider !== 'codex') return null;
  const row = sqliteManager.db.prepare(
    `SELECT payload_json FROM eyes_on_agents_thread_snapshot
     WHERE provider = ? AND thread_id = ?`
  ).get(provider, threadId) as { payload_json: string } | undefined;
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
  provider: EyesOnAgentsProvider,
  threadId: string,
  created: boolean,
  completionAlert: EyesOnAgentsCompletionAlertIntent | null = null
): EyesOnAgentsRuntimePersistenceResult => {
  const row = sqliteManager.db.prepare(
    `SELECT title, is_archived FROM eyes_on_agents_thread
     WHERE provider = ? AND thread_id = ?`
  ).get(provider, threadId) as { title: string | null; is_archived: number };
  return {
    created,
    titleMissing: row.is_archived === 0 && row.title === null,
    completionAlert
  };
};

const ignoredRuntimePersistenceResult = (): EyesOnAgentsRuntimePersistenceResult => ({
  created: false,
  titleMissing: false,
  completionAlert: null
});

const claimCompletionAlertInTransaction = (params: {
  provider: EyesOnAgentsProvider;
  threadId: string;
  turnId: string;
  completedAt: number;
  claimedAt: number;
}): EyesOnAgentsCompletionAlertIntent | null => {
  const row = sqliteManager.db.prepare(
    `SELECT title FROM eyes_on_agents_thread
     WHERE provider = ? AND thread_id = ?
       AND is_deleted = 0
       AND is_archived = 0
       AND runtime_state = 'idle'
       AND is_unread = 1
       AND last_completed_turn_id = ?`
  ).get(params.provider, params.threadId, params.turnId) as { title: string | null } | undefined;
  if (!row) return null;
  const claimed = sqliteManager.db.prepare(
    `INSERT INTO eyes_on_agents_completion_alert_receipt (
      session_key, provider, thread_id, turn_id, completed_at, claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key, turn_id) DO NOTHING`
  ).run(
    buildEyesOnAgentsSessionKey(params.provider, params.threadId),
    params.provider,
    params.threadId,
    params.turnId,
    params.completedAt,
    params.claimedAt
  );
  if (Number(claimed.changes) !== 1) return null;
  return {
    sessionKey: buildEyesOnAgentsSessionKey(params.provider, params.threadId),
    provider: params.provider,
    threadId: params.threadId,
    turnId: params.turnId,
    title: normalizeEyesOnAgentsProviderThreadTitle({ name: row.title })
  };
};

const applyRuntimeEventInTransaction = (
  event: EyesOnAgentsRuntimeEvent,
  hasCurrentListenerReplayAuthority = false
): EyesOnAgentsRuntimePersistenceResult => {
  const now = Date.now();
  const provider = runtimeEventProvider(event);
  const domainId = defaultDomainId();
  const state = eventState(event);
  const activeFlags = event.type === 'thread_status' ? event.activeFlags : [];
  const project = projectColumns(event.project);
  const snapshotTitle = titleFromStoredThreadSnapshot(provider, event.threadId);
  const startedTurnId = event.type === 'turn_started'
    ? event.turnId ?? (
      event.source === 'codex_hook' || event.source === 'claude_hook'
        ? provider === 'codex' ? `hook-${event.observedAt}` : `hook-claude-${event.observedAt}`
        : null
    )
    : event.type === 'thread_status'
      ? event.turnId ?? null
      : null;
  const inserted = sqliteManager.db.prepare(
    `INSERT OR IGNORE INTO eyes_on_agents_thread (
      session_key, provider, thread_id, domain_id, title, cwd,
      project_key, project_root, project_name, archive_state,
      runtime_state, active_flags_json,
      active_turn_id, last_completed_turn_id, last_completed_at,
      last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
      status_fresh_until, last_activity_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    buildEyesOnAgentsSessionKey(provider, event.threadId),
    provider,
    event.threadId,
    domainId,
    snapshotTitle,
    event.cwd ?? null,
    ...project,
    provider === 'codex' ? 'active' : 'unknown',
    state,
    JSON.stringify(activeFlags),
    startedTurnId,
    state === 'working' || state === 'waiting_approval' || state === 'waiting_input'
      || event.type === 'turn_completed' ? 1 : 0,
    event.source,
    event.observedAt,
    null,
    event.observedAt,
    now,
    now
  );

  if (snapshotTitle !== null) {
    sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET title = ?, updated_at = ?
       WHERE provider = ? AND thread_id = ? AND title IS NULL`
    ).run(snapshotTitle, now, provider, event.threadId);
  }
  const created = Number(inserted.changes) === 1;

  const existing = sqliteManager.db.prepare(
    `SELECT runtime_state, status_source, status_observed_at, active_turn_id,
      last_completed_turn_id
     FROM eyes_on_agents_thread WHERE provider = ? AND thread_id = ?`
  ).get(provider, event.threadId) as {
    runtime_state: string;
    status_source: string;
    status_observed_at: number | null;
    active_turn_id: string | null;
    last_completed_turn_id: string | null;
  };
  const mayRestoreUnknownDiscovery = hasCurrentListenerReplayAuthority
    && (event.source === 'codex_hook' || event.source === 'claude_hook')
    && existing.status_source === 'discovery'
    && parseEyesOnAgentsRuntimeState(existing.runtime_state) === 'unknown';
  if (
    !mayRestoreUnknownDiscovery
    && existing.status_observed_at !== null
    && existing.status_observed_at > event.observedAt
  ) {
    return runtimePersistenceResult(provider, event.threadId, created);
  }
  if (
    (state === 'working' || state === 'waiting_approval' || state === 'waiting_input')
    && event.turnId !== null
    && event.turnId !== undefined
    && existing.last_completed_turn_id === event.turnId
  ) {
    return runtimePersistenceResult(provider, event.threadId, created);
  }
  if (event.project !== undefined) {
    sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET
        project_key = ?, project_root = ?, project_name = ?
       WHERE provider = ? AND thread_id = ?`
    ).run(...project, provider, event.threadId);
  }

  if (event.type === 'turn_completed') {
    const completedTurnId = event.turnId ?? existing.active_turn_id;
    const alertTurnId = event.turnId ?? (
      completedTurnId !== null && !/^hook-\d+$/.test(completedTurnId)
        ? completedTurnId
        : null
    );
    const completed = sqliteManager.db.prepare(
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
        status_fresh_until = NULL,
        last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
        updated_at = ?
       WHERE provider = ? AND thread_id = ?`
    ).run(
      event.cwd ?? null,
      state,
      completedTurnId,
      event.observedAt,
      event.source,
      event.observedAt,
      event.observedAt,
      now,
      provider,
      event.threadId
    );
    const completionAlert = Number(completed.changes) === 1
      && event.outcome === 'completed'
      && alertTurnId !== null
      ? claimCompletionAlertInTransaction({
          threadId: event.threadId,
          provider,
          turnId: alertTurnId,
          completedAt: event.observedAt,
          claimedAt: now
        })
      : null;
    return runtimePersistenceResult(provider, event.threadId, created, completionAlert);
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
      status_fresh_until = ?,
      last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
      updated_at = ?
     WHERE provider = ? AND thread_id = ?`
  ).run(
    event.cwd ?? null,
    state,
    JSON.stringify(activeFlags),
    state,
    startedTurnId,
    state,
    event.source,
    event.observedAt,
    null,
    event.observedAt,
    now,
    provider,
    event.threadId
  );
  return runtimePersistenceResult(provider, event.threadId, created);
};

const normalizeHookLastUserPromptCandidate = (
  event: EyesOnAgentsRuntimeEvent,
  value: EyesOnAgentsHookLastUserPromptCandidate | undefined
): EyesOnAgentsHookLastUserPromptCandidate | undefined => {
  if (value === undefined) return undefined;
  if (
    event.type !== 'turn_started' ||
    (event.source !== 'codex_hook' && event.source !== 'claude_hook')
  ) {
    throw new Error(
      'hook last user prompt requires a codex_hook turn_started event or claude_hook turn_started event'
    );
  }
  return parseEyesOnAgentsHookLastUserPromptCandidate(value);
};

const applyHookLastUserPromptInTransaction = (
  event: Extract<EyesOnAgentsRuntimeEvent, { type: 'turn_started' }>,
  candidate: EyesOnAgentsHookLastUserPromptCandidate
): void => {
  const provider = runtimeEventProvider(event);
  const source = event.source;
  sqliteManager.db.prepare(
    `UPDATE eyes_on_agents_thread SET
      last_user_prompt_preview = ?,
      last_user_prompt_turn_id = ?,
      last_user_prompt_at = ?,
      last_user_prompt_truncated = ?,
      last_user_prompt_source = ?,
      last_user_prompt_checked_at = NULL,
      updated_at = ?
     WHERE provider = ? AND thread_id = ?
       AND is_deleted = 0
       AND (last_user_prompt_at IS NULL OR last_user_prompt_at < ?)`
  ).run(
    candidate.preview,
    event.turnId,
    event.observedAt,
    candidate.truncated ? 1 : 0,
    source,
    Date.now(),
    provider,
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
      `SELECT session_key, provider, thread_id, desktop_session_id, iterm2_session_id,
        transcript_path,
        domain_id, title, cwd,
        project_key, project_root, project_name, archive_state,
        runtime_state, active_flags_json,
        active_turn_id, last_completed_turn_id, last_completed_at,
        last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
        status_fresh_until,
        last_activity_at, last_user_prompt_preview, last_user_prompt_turn_id,
        last_user_prompt_at, last_user_prompt_truncated, last_user_prompt_source,
        last_user_prompt_checked_at
       FROM eyes_on_agents_thread
       WHERE archive_state <> 'archived' AND is_deleted = 0
       ORDER BY COALESCE(last_activity_at, updated_at) DESC,
         updated_at DESC, session_key ASC`,
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
         WHERE provider = 'codex' AND archive_state = 'active'`
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
        `SELECT ${THREAD_REFRESH_CANDIDATE_COLUMNS}
         FROM eyes_on_agents_thread
         WHERE provider = 'codex' AND archive_state = 'active'
         ORDER BY COALESCE(last_activity_at, updated_at) DESC,
           updated_at DESC, thread_id ASC
         LIMIT ? OFFSET ?`
      );
      const hotRows = selectPage.all(
        THREAD_REFRESH_PAGE_SIZE,
        0
      ) as ThreadRefreshCandidateRow[];
      const coldRows = coldPage === null
        ? []
        : selectPage.all(
            THREAD_REFRESH_PAGE_SIZE,
            (coldPage - 1) * THREAD_REFRESH_PAGE_SIZE
          ) as ThreadRefreshCandidateRow[];
      return {
        hot: hotRows.map(toRefreshCandidate),
        cold: coldRows.map(toRefreshCandidate),
        pageCount,
        coldPage
      };
    });
    return transaction();
  }

  async getThreadRefreshCandidate(params: {
    threadId: string;
  }): Promise<EyesOnAgentsThreadRefreshCandidate | null> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const row = await sqliteHelper.safeGet<ThreadRefreshCandidateRow>(
      `SELECT ${THREAD_REFRESH_CANDIDATE_COLUMNS}
       FROM eyes_on_agents_thread
       WHERE provider = 'codex' AND thread_id = ? AND archive_state = 'active'`,
      [threadId]
    );
    return row ? toRefreshCandidate(row) : null;
  }

  async refreshThreadPage(params: {
    threads: EyesOnAgentsThreadRefreshPatch[];
  }): Promise<EyesOnAgentsThreadPagePersistenceResult> {
    if (!params || !Array.isArray(params.threads)) throw new Error('threads must be an array');
    if (params.threads.length > THREAD_REFRESH_PAGE_SIZE) {
      throw new Error(`threads must not exceed ${THREAD_REFRESH_PAGE_SIZE} entries`);
    }
    const threads = params.threads.map(parseEyesOnAgentsThreadRefreshPatch);
    if (new Set(threads.map((thread) => thread.threadId)).size !== threads.length) {
      throw new Error('thread refresh patches must have unique threadIds');
    }
    const transaction = sqliteManager.db.transaction((): EyesOnAgentsThreadPagePersistenceResult => {
      const select = sqliteManager.db.prepare(
        `SELECT title, last_activity_at,
          last_user_prompt_preview, last_user_prompt_turn_id, last_user_prompt_at,
          last_user_prompt_truncated, last_user_prompt_source, last_user_prompt_checked_at
         FROM eyes_on_agents_thread
         WHERE provider = 'codex' AND thread_id = ? AND archive_state = 'active'`
      );
      const now = Date.now();
      let changed = false;
      const completionAlerts: EyesOnAgentsCompletionAlertIntent[] = [];
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
             WHERE provider = 'codex' AND thread_id = ? AND archive_state = 'active'`
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
             WHERE provider = 'codex' AND thread_id = ?
               AND archive_state = 'active'
               AND status_source = ?
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
            thread.terminalTurn.expectedStatusSource,
            thread.terminalTurn.expectedActiveTurnId,
            thread.terminalTurn.expectedStatusObservedAt
          );
          if (Number(result.changes) === 1) {
            changed = true;
            if (thread.terminalTurn.outcome === 'completed') {
              const completionAlert = claimCompletionAlertInTransaction({
                provider: 'codex',
                threadId: thread.threadId,
                turnId: thread.terminalTurn.turnId,
                completedAt: thread.terminalTurn.completedAt,
                claimedAt: now
              });
              if (completionAlert) completionAlerts.push(completionAlert);
            }
          }
        }

        if (thread.settledTurn !== undefined) {
          const runtimeState = thread.settledTurn.outcome === 'completed'
            ? 'idle'
            : thread.settledTurn.outcome === 'interrupted'
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
             WHERE provider = 'codex' AND thread_id = ?
               AND archive_state = 'active'
               AND is_unread = 1
               AND status_source = 'discovery'
               AND runtime_state = 'unknown'
               AND active_turn_id IS NULL
               AND status_observed_at = ?`
          ).run(
            runtimeState,
            thread.settledTurn.turnId,
            thread.settledTurn.completedAt,
            thread.settledTurn.completedAt,
            now,
            thread.threadId,
            thread.settledTurn.expectedStatusObservedAt
          );
          if (Number(result.changes) === 1) {
            changed = true;
            if (thread.settledTurn.outcome === 'completed') {
              const completionAlert = claimCompletionAlertInTransaction({
                provider: 'codex',
                threadId: thread.threadId,
                turnId: thread.settledTurn.turnId,
                completedAt: thread.settledTurn.completedAt,
                claimedAt: now
              });
              if (completionAlert) completionAlerts.push(completionAlert);
            }
          }
        }

        if (thread.recoveredTurn !== undefined) {
          const result = sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET
              runtime_state = 'working',
              active_flags_json = '[]',
              active_turn_id = ?,
              is_unread = 1,
              status_source = 'app_server_turn',
              status_observed_at = ?,
              last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
              updated_at = ?
             WHERE provider = 'codex' AND thread_id = ?
               AND archive_state = 'active'
               AND is_unread = 1
               AND status_source = 'discovery'
               AND runtime_state = 'unknown'
               AND active_turn_id IS NULL
               AND status_observed_at = ?
               AND COALESCE(last_completed_turn_id, '') <> ?`
          ).run(
            thread.recoveredTurn.turnId,
            thread.recoveredTurn.startedAt,
            thread.recoveredTurn.startedAt,
            now,
            thread.threadId,
            thread.recoveredTurn.expectedStatusObservedAt,
            thread.recoveredTurn.turnId
          );
          if (Number(result.changes) === 1) changed = true;
        }

        if (thread.reclaimedTurn !== undefined) {
          const result = sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET
              status_source = 'app_server_turn',
              status_observed_at = ?,
              last_activity_at = MAX(COALESCE(last_activity_at, 0), ?),
              updated_at = ?
             WHERE provider = 'codex' AND thread_id = ?
               AND archive_state = 'active'
               AND status_source = ?
               AND runtime_state IN ('working', 'waiting_approval', 'waiting_input')
               AND active_turn_id = ?
               AND status_observed_at = ?
               AND COALESCE(last_completed_turn_id, '') <> ?`
          ).run(
            thread.reclaimedTurn.startedAt,
            thread.reclaimedTurn.startedAt,
            now,
            thread.threadId,
            thread.reclaimedTurn.expectedStatusSource,
            thread.reclaimedTurn.expectedActiveTurnId,
            thread.reclaimedTurn.expectedStatusObservedAt,
            thread.reclaimedTurn.turnId
          );
          if (Number(result.changes) === 1) changed = true;
        }
      }
      return completionAlerts.length === 0
        ? { changed }
        : { changed, completionAlerts };
    });
    return transaction();
  }

  async clearLastUserPrompts(params: {
    providers: EyesOnAgentsProvider[];
  }): Promise<{ changed: boolean }> {
    if (!params || !Array.isArray(params.providers) || params.providers.length < 1) {
      throw new Error('prompt clear providers are required');
    }
    const providers = [...new Set(params.providers.map(parseEyesOnAgentsProvider))];
    const placeholders = providers.map(() => '?').join(', ');
    const result = sqliteManager.db.prepare(
      `UPDATE eyes_on_agents_thread SET
        last_user_prompt_preview = NULL,
        last_user_prompt_turn_id = NULL,
        last_user_prompt_at = NULL,
        last_user_prompt_truncated = 0,
        last_user_prompt_source = NULL,
        last_user_prompt_checked_at = NULL,
        updated_at = ?
       WHERE provider IN (${placeholders})
         AND (
           last_user_prompt_preview IS NOT NULL
           OR last_user_prompt_turn_id IS NOT NULL
           OR last_user_prompt_at IS NOT NULL
           OR last_user_prompt_truncated <> 0
           OR last_user_prompt_source IS NOT NULL
           OR last_user_prompt_checked_at IS NOT NULL
         )`
    ).run(Date.now(), ...providers);
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
       WHERE provider = 'codex' AND status_source = 'app_server'`,
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
       WHERE provider = 'codex' AND status_source = 'codex_hook'
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
          session_key, provider, thread_id, domain_id, title, cwd,
          project_key, project_root, project_name, archive_state,
          runtime_state, active_flags_json,
          active_turn_id, last_completed_turn_id, last_completed_at,
          last_opened_turn_id, last_opened_at, is_unread, status_source, status_observed_at,
          last_activity_at, created_at, updated_at
        ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, thread_id) DO UPDATE SET
          title = COALESCE(excluded.title, eyes_on_agents_thread.title),
          cwd = COALESCE(excluded.cwd, eyes_on_agents_thread.cwd),
          is_archived = 0,
          archive_state = 'active',
          runtime_state = CASE
            WHEN eyes_on_agents_thread.status_source = 'app_server_turn'
              THEN eyes_on_agents_thread.runtime_state
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
            WHEN eyes_on_agents_thread.status_source = 'app_server_turn'
              THEN eyes_on_agents_thread.active_flags_json
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
            WHEN eyes_on_agents_thread.status_source = 'app_server_turn'
              THEN eyes_on_agents_thread.active_turn_id
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
            WHEN eyes_on_agents_thread.status_source = 'app_server_turn'
              THEN eyes_on_agents_thread.status_source
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
            WHEN eyes_on_agents_thread.status_source = 'app_server_turn'
              THEN eyes_on_agents_thread.status_observed_at
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
          buildEyesOnAgentsSessionKey('codex', thread.threadId),
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
             WHERE provider = 'codex' AND thread_id = ?`
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
          session_key, provider, thread_id, payload_json, is_archived,
          synced_at, created_at, updated_at
        ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, thread_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          is_archived = excluded.is_archived,
          synced_at = excluded.synced_at,
          updated_at = excluded.updated_at`
      );
      for (const snapshot of snapshots) {
        statement.run(
          buildEyesOnAgentsSessionKey('codex', snapshot.threadId),
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
          archive_state = ?,
          runtime_state = 'unknown',
          active_flags_json = '[]',
          active_turn_id = NULL,
          status_source = 'discovery',
          status_observed_at = ?,
          updated_at = ?
         WHERE provider = 'codex' AND thread_id = ?`
      ).run(
        params.archived ? 1 : 0,
        params.archived ? 'archived' : 'active',
        observedAt,
        now,
        threadId
      );
      sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread_snapshot SET
          is_archived = ?, updated_at = ?
         WHERE provider = 'codex' AND thread_id = ?`
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
          archive_state = 'archived',
          runtime_state = 'unknown',
          active_flags_json = '[]',
          active_turn_id = NULL,
          status_source = 'discovery',
          status_observed_at = ?,
          updated_at = ?
         WHERE provider = 'codex' AND thread_id = ?`
      );
      const snapshotStatement = sqliteManager.db.prepare(
        `UPDATE eyes_on_agents_thread_snapshot SET
          is_archived = 1, updated_at = ?
         WHERE provider = 'codex' AND thread_id = ?`
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
        if (
          runtimeEventProvider(event) === 'claude' &&
          isClaudeRuntimeIdentityDeleted(event.threadId)
        ) {
          return ignoredRuntimePersistenceResult();
        }
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
    if (event.source !== 'codex_hook' && event.source !== 'claude_hook') {
      throw new Error('delivery event source must be a supported hook source');
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
        const provider = runtimeEventProvider(event);
        const result = sqliteManager.db.prepare(
          `INSERT INTO eyes_on_agents_hook_delivery_receipt (
            delivery_id, session_key, provider, thread_id, observed_at, committed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(delivery_id) DO NOTHING`
        ).run(
          deliveryId,
          buildEyesOnAgentsSessionKey(provider, event.threadId),
          provider,
          event.threadId,
          event.observedAt,
          Date.now()
        );
        if (Number(result.changes) === 0) {
          return {
            duplicate: true,
            created: false,
            titleMissing: false,
            completionAlert: null
          };
        }
        if (provider === 'claude' && isClaudeRuntimeIdentityDeleted(event.threadId)) {
          sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_hook_delivery_receipt
             SET is_observation_eligible = 0 WHERE delivery_id = ?`
          ).run(deliveryId);
          return {
            duplicate: true,
            ...ignoredRuntimePersistenceResult()
          };
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
       WHERE provider = 'codex' AND thread_id = ?
         AND archive_state = 'active' AND title IS NULL`,
      [title, Date.now(), threadId]
    );
    return { changed: Number(result.changes) === 1 };
  }

  async markOpened(params: {
    sessionKey: EyesOnAgentsSessionKey;
    openedAt: number;
  }): Promise<void> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    const openedAt = parseEyesOnAgentsTimestamp(params?.openedAt, 'openedAt', false) as number;
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET
        last_opened_turn_id = COALESCE(active_turn_id, last_completed_turn_id),
        last_opened_at = ?,
        is_unread = CASE
          WHEN runtime_state IN ('idle', 'failed', 'ended') THEN 0
          ELSE is_unread
        END,
        updated_at = ?
       WHERE session_key = ? AND is_deleted = 0`,
      [openedAt, Date.now(), sessionKey]
    );
    if (Number(result.changes) === 0) throw new Error('Thread was not found');
  }

  async markAllRead(params: {
    providers: EyesOnAgentsProvider[];
  }): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!params || Object.keys(params).sort().join(',') !== 'providers' ||
      !Array.isArray(params.providers) || params.providers.length < 1 ||
      params.providers.length > 2) {
      throw new Error('Read all providers are invalid');
    }
    const providers = params.providers.map(parseEyesOnAgentsProvider);
    if (new Set(providers).size !== providers.length) {
      throw new Error('Read all providers must be unique');
    }
    const placeholders = providers.map(() => '?').join(', ');
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET is_unread = 0
       WHERE archive_state <> 'archived' AND is_deleted = 0
         AND is_unread = 1
         AND runtime_state IN ('idle', 'failed', 'ended')
         AND provider IN (${placeholders})`,
      providers
    );
    return { changed: Number(result.changes) > 0 };
  }

  // Manual acknowledgement, not a deep-link receipt: this writes only is_unread. It leaves
  // last_opened_*, runtime evidence, and updated_at alone, so it cannot forge an Open or
  // disturb the COALESCE(last_activity_at, updated_at) refresh ordering.
  async setThreadUnread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    isUnread: boolean;
  }): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!params || Object.keys(params).sort().join(',') !== 'isUnread,sessionKey' ||
      typeof params.isUnread !== 'boolean') {
      throw new Error('Thread read state params are invalid');
    }
    const sessionKey = parseEyesOnAgentsSessionKey(params.sessionKey);
    const nextValue = params.isUnread ? 1 : 0;
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET is_unread = ?
       WHERE session_key = ? AND is_deleted = 0
         AND archive_state <> 'archived'
         AND is_unread <> ?`,
      [nextValue, sessionKey, nextValue]
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

  async moveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    domainId: number;
  }): Promise<void> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    const domainId = parsePositiveId(params?.domainId, 'domainId');
    requireActiveDomain(domainId);
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET domain_id = ?, updated_at = ?
       WHERE session_key = ? AND is_deleted = 0`,
      [domainId, Date.now(), sessionKey]
    );
    if (Number(result.changes) === 0) throw new Error('Thread was not found');
  }

  async upsertClaudeInventory(params: {
    threads: EyesOnAgentsClaudeInventoryThread[];
    deletion?: EyesOnAgentsClaudeDeletionReconciliation;
  }): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!params || !Array.isArray(params.threads) || params.threads.length > 40_000) {
      throw new Error('Claude inventory threads are invalid');
    }
    const threads = params.threads.map(normalizeClaudeInventoryThread);
    const deletion = params.deletion === undefined
      ? undefined
      : normalizeClaudeDeletionReconciliation(params.deletion);
    if (new Set(threads.map((thread) => thread.threadId)).size !== threads.length) {
      throw new Error('Claude inventory thread IDs must be unique');
    }
    const transaction = sqliteManager.db.transaction((): EyesOnAgentsRepositoryMutationResult => {
      const domainId = defaultDomainId();
      const now = Date.now();
      let changed = deletion === undefined
        ? false
        : reconcileClaudeDeletionTombstonesInTransaction(deletion);
      const select = sqliteManager.db.prepare(
        `SELECT desktop_session_id, desktop_identity_ambiguous, iterm2_session_id, transcript_path,
          transcript_identity_ambiguous, title, cwd,
          project_key, project_root, project_name, archive_state, last_activity_at,
          transcript_activity_at, runtime_state, status_source, status_fresh_until,
          is_deleted, deleted_at
         FROM eyes_on_agents_thread WHERE provider = 'claude' AND thread_id = ?`
      );
      for (const thread of threads) {
        const row = select.get(thread.threadId) as {
          desktop_session_id: string | null; desktop_identity_ambiguous: number;
          iterm2_session_id: string | null;
          transcript_path: string | null; transcript_identity_ambiguous: number;
          title: string | null; cwd: string | null; project_key: string | null;
          project_root: string | null; project_name: string | null;
          archive_state: string; last_activity_at: number | null;
          transcript_activity_at: number | null; runtime_state: string;
          status_source: string; status_fresh_until: number | null;
          is_deleted: number; deleted_at: number | null;
        } | undefined;
        const deletionAt = latestClaudeDeletionAt(
          thread.threadId,
          thread.desktopSessionId ?? row?.desktop_session_id ?? null,
          row?.deleted_at ?? null
        );
        const incomingDesktopIdentity = claudeDesktopIdentityUuid(thread.desktopSessionId);
        const activeThreadTombstone = hasActiveClaudeDeletionIdentity(thread.threadId);
        const activeDesktopTombstone = incomingDesktopIdentity !== null &&
          hasActiveClaudeDeletionIdentity(incomingDesktopIdentity);
        const activeTombstone = activeThreadTombstone || activeDesktopTombstone ||
          hasActiveClaudeDeletionTombstone(thread.threadId, row?.desktop_session_id ?? null);
        if (activeTombstone) {
          const desktopIdentityCollision = thread.desktopSessionId === null ? false : Boolean(
            sqliteManager.db.prepare(
              `SELECT 1 FROM eyes_on_agents_thread
               WHERE provider = 'claude' AND thread_id <> ? AND desktop_session_id = ? LIMIT 1`
            ).get(thread.threadId, thread.desktopSessionId)
          );
          const safeDesktopPair = thread.desktopEvidenceComplete === true &&
            thread.clearDesktopSessionId !== true &&
            thread.desktopSessionId !== null &&
            !desktopIdentityCollision;
          if (!row && deletionAt !== null && (activeThreadTombstone ||
            (activeDesktopTombstone && safeDesktopPair))) {
            sqliteManager.db.prepare(
              `INSERT OR IGNORE INTO eyes_on_agents_thread (
                session_key, provider, thread_id, desktop_session_id, domain_id,
                archive_state, is_deleted, deleted_at, created_at, updated_at
              ) VALUES (?, 'claude', ?, ?, ?, 'unknown', 1, ?, ?, ?)`
            ).run(
              buildEyesOnAgentsSessionKey('claude', thread.threadId),
              thread.threadId,
              safeDesktopPair ? thread.desktopSessionId : null,
              domainId,
              deletionAt,
              now,
              now
            );
          } else if (row?.is_deleted === 1 && row.desktop_session_id === null && safeDesktopPair) {
            sqliteManager.db.prepare(
              `UPDATE eyes_on_agents_thread SET desktop_session_id = ?,
                desktop_identity_ambiguous = 0, updated_at = ?
               WHERE provider = 'claude' AND thread_id = ? AND is_deleted = 1`
            ).run(thread.desktopSessionId, now, thread.threadId);
          }
          continue;
        }
        const matchesPersistedDesktopIdentity = row?.desktop_session_id === null ||
          row?.desktop_session_id === undefined ||
          row.desktop_session_id === thread.desktopSessionId;
        const isVerifiedRestore = deletionAt !== null &&
          thread.desktopEvidenceComplete === true &&
          thread.clearDesktopSessionId !== true &&
          thread.desktopSessionId !== null &&
          thread.desktopMetadataMtime !== null &&
          thread.desktopMetadataMtime !== undefined &&
          thread.desktopMetadataMtime > deletionAt &&
          matchesPersistedDesktopIdentity;
        const requiresVerifiedRestore = row?.is_deleted === 1 ||
          (row === undefined && deletionAt !== null);
        if (requiresVerifiedRestore && !isVerifiedRestore) continue;
        const restoresDeletedRow = requiresVerifiedRestore && isVerifiedRestore;

        const collision = thread.desktopSessionId === null ? false : Boolean(
          sqliteManager.db.prepare(
            `SELECT 1 FROM eyes_on_agents_thread
             WHERE provider = 'claude' AND thread_id <> ? AND desktop_session_id = ? LIMIT 1`
          ).get(thread.threadId, thread.desktopSessionId)
        );
        if (restoresDeletedRow && collision) continue;
        if (collision && thread.desktopSessionId !== null) {
          const cleared = sqliteManager.db.prepare(
            `UPDATE eyes_on_agents_thread SET desktop_session_id = NULL,
              desktop_identity_ambiguous = 1, updated_at = ?
             WHERE provider = 'claude' AND desktop_session_id = ?`
          ).run(now, thread.desktopSessionId);
          if (Number(cleared.changes) > 0) changed = true;
        }
        const project = projectColumns(thread.project);
        if (!row) {
          sqliteManager.db.prepare(
            `INSERT INTO eyes_on_agents_thread (
              session_key, provider, thread_id, desktop_session_id,
              desktop_identity_ambiguous, iterm2_session_id, transcript_path,
              transcript_identity_ambiguous,
              domain_id, title, cwd, project_key, project_root, project_name,
              is_archived, archive_state, runtime_state, active_flags_json,
              is_unread, status_source, status_observed_at, last_activity_at,
              transcript_activity_at, created_at, updated_at
            ) VALUES (?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '[]',
              0, 'discovery', ?, ?, ?, ?, ?)`
          ).run(
            buildEyesOnAgentsSessionKey('claude', thread.threadId), thread.threadId,
            collision || thread.clearDesktopSessionId ? null : thread.desktopSessionId,
            collision || thread.clearDesktopSessionId ? 1 : 0,
            thread.iterm2SessionId ?? null,
            thread.clearTranscriptPath ? null : thread.transcriptPath,
            thread.clearTranscriptPath ? 1 : 0,
            domainId, thread.title,
            thread.cwd, ...project, thread.archiveState === 'archived' ? 1 : 0,
            thread.archiveState, thread.observedAt, thread.lastActivityAt,
            thread.transcriptActivityAt, now, now
          );
          changed = true;
          continue;
        }
        const desktopIdentityChanged = thread.desktopSessionId !== null &&
          row.desktop_session_id !== null && thread.desktopSessionId !== row.desktop_session_id;
        const transcriptIdentityChanged = thread.transcriptPath !== null &&
          row.transcript_path !== null && thread.transcriptPath !== row.transcript_path;
        const archiveState = thread.archiveState === 'unknown' ? row.archive_state : thread.archiveState;
        const desktopAmbiguous = collision || thread.clearDesktopSessionId ||
          (desktopIdentityChanged && !thread.desktopEvidenceComplete) ||
          (row.desktop_identity_ambiguous === 1 && !thread.desktopEvidenceComplete);
        const transcriptAmbiguous = thread.clearTranscriptPath ||
          (transcriptIdentityChanged && !thread.transcriptEvidenceComplete) ||
          (row.transcript_identity_ambiguous === 1 && !thread.transcriptEvidenceComplete);
        const next = {
          desktopSessionId: desktopAmbiguous
            ? null
            : thread.desktopSessionId ?? row.desktop_session_id,
          desktopIdentityAmbiguous: desktopAmbiguous ? 1 : 0,
          // Independent COALESCE-preserve rule: no ambiguity/collision check to port, unlike
          // desktop_session_id above (see docs/features/eyes-on-agents-iterm2-open.md).
          iterm2SessionId: thread.iterm2SessionId ?? row.iterm2_session_id,
          transcriptPath: transcriptAmbiguous
            ? null
            : thread.transcriptPath ?? row.transcript_path,
          transcriptIdentityAmbiguous: transcriptAmbiguous ? 1 : 0,
          title: thread.title ?? row.title,
          cwd: thread.cwd ?? row.cwd,
          projectKey: thread.project === undefined ? row.project_key : project[0],
          projectRoot: thread.project === undefined ? row.project_root : project[1],
          projectName: thread.project === undefined ? row.project_name : project[2],
          archiveState,
          lastActivityAt: thread.lastActivityAt === null
            ? row.last_activity_at
            : Math.max(row.last_activity_at ?? 0, thread.lastActivityAt),
          transcriptActivityAt: thread.transcriptActivityAt === null
            ? row.transcript_activity_at
            : Math.max(row.transcript_activity_at ?? 0, thread.transcriptActivityAt),
          statusFreshUntil: row.status_fresh_until,
          isDeleted: restoresDeletedRow ? 0 : row.is_deleted,
          deletedAt: restoresDeletedRow ? null : row.deleted_at
        };
        if (next.desktopSessionId === row.desktop_session_id &&
          next.desktopIdentityAmbiguous === row.desktop_identity_ambiguous &&
          next.iterm2SessionId === row.iterm2_session_id &&
          next.transcriptPath === row.transcript_path &&
          next.transcriptIdentityAmbiguous === row.transcript_identity_ambiguous &&
          next.title === row.title &&
          next.cwd === row.cwd && next.projectKey === row.project_key &&
          next.projectRoot === row.project_root && next.projectName === row.project_name &&
          next.archiveState === row.archive_state && next.lastActivityAt === row.last_activity_at &&
          next.transcriptActivityAt === row.transcript_activity_at &&
          next.statusFreshUntil === row.status_fresh_until &&
          next.isDeleted === row.is_deleted && next.deletedAt === row.deleted_at) continue;
        sqliteManager.db.prepare(
          `UPDATE eyes_on_agents_thread SET desktop_session_id = ?, desktop_identity_ambiguous = ?,
            iterm2_session_id = ?,
            transcript_path = ?, transcript_identity_ambiguous = ?,
            title = ?, cwd = ?, project_key = ?, project_root = ?, project_name = ?,
            is_archived = ?, archive_state = ?, last_activity_at = ?,
            transcript_activity_at = ?, status_fresh_until = ?,
            is_deleted = ?, deleted_at = ?,
            is_unread = CASE WHEN ? = 1 THEN 0 ELSE is_unread END,
            updated_at = ?
           WHERE provider = 'claude' AND thread_id = ?`
        ).run(
          next.desktopSessionId, next.desktopIdentityAmbiguous, next.iterm2SessionId,
          next.transcriptPath,
          next.transcriptIdentityAmbiguous, next.title, next.cwd,
          next.projectKey, next.projectRoot, next.projectName,
          next.archiveState === 'archived' ? 1 : 0, next.archiveState,
          next.lastActivityAt, next.transcriptActivityAt, next.statusFreshUntil,
          next.isDeleted, next.deletedAt, restoresDeletedRow ? 1 : 0,
          now, thread.threadId
        );
        changed = true;
      }
      return { changed };
    });
    return transaction();
  }

  async reconcileClaudeAgentStates(params: {
    agents: EyesOnAgentsClaudeAgentState[];
    completeSnapshot: boolean;
    observedAt: number;
  }): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!params || !Array.isArray(params.agents) || params.agents.length > 10_000) {
      throw new Error('Claude Agent View rows are invalid');
    }
    const agents = params.agents.map(normalizeClaudeAgentState);
    if (typeof params.completeSnapshot !== 'boolean') throw new Error('Claude snapshot completeness is invalid');
    const snapshotObservedAt = parseEyesOnAgentsTimestamp(
      params.observedAt,
      'Claude snapshot observedAt',
      false
    ) as number;
    const transaction = sqliteManager.db.transaction((): EyesOnAgentsRepositoryMutationResult => {
      const now = Date.now();
      let changed = false;
      for (const agent of agents) {
        if (agent.runtimeState === 'unknown') continue;
        const row = sqliteManager.db.prepare(
          `SELECT runtime_state, status_source, status_observed_at, status_fresh_until,
            title, cwd, active_turn_id,
            last_activity_at
           FROM eyes_on_agents_thread WHERE provider = 'claude' AND thread_id = ?`
        ).get(agent.threadId) as {
          runtime_state: string; status_source: string; status_observed_at: number | null;
          status_fresh_until: number | null; title: string | null;
          cwd: string | null; active_turn_id: string | null; last_activity_at: number | null;
        } | undefined;
        if (
          !row ||
          isClaudeRuntimeIdentityDeleted(agent.threadId) ||
          (row.status_observed_at !== null && row.status_observed_at > agent.observedAt) ||
          (
            row.status_source === 'claude_hook' &&
            ['working', 'waiting_approval', 'waiting_input'].includes(row.runtime_state)
          )
        ) continue;
        const wasActive = ['working', 'waiting_approval', 'waiting_input'].includes(row.runtime_state);
        const isActive = ['working', 'waiting_approval', 'waiting_input'].includes(agent.runtimeState);
        const startedTurnId = agent.startedAt === null ? null : `claude-agent-${agent.startedAt}`;
        const newActiveRun = isActive && wasActive && startedTurnId !== null &&
          row.active_turn_id !== startedTurnId;
        const activeTurnId = isActive
          ? newActiveRun
            ? startedTurnId
            : row.active_turn_id ?? `claude-agent-${agent.startedAt ?? agent.observedAt}`
          : null;
        const title = row.title ?? agent.title;
        const cwd = agent.cwd ?? row.cwd;
        const terminalTransition = wasActive && !isActive;
        const activeTransitionObservedAt = isActive && agent.startedAt !== null && agent.startedAt <= agent.observedAt
          ? agent.startedAt
          : agent.observedAt;
        const statusObservedAt = row.runtime_state === agent.runtimeState && !newActiveRun
          ? row.status_observed_at ?? agent.observedAt
          : activeTransitionObservedAt;
        const statusFreshUntil = isActive ? agent.observedAt + 30_000 : null;
        const lastActivityAt = isActive || row.runtime_state !== agent.runtimeState
          ? agent.observedAt
          : row.last_activity_at;
        const result = sqliteManager.db.prepare(
          `UPDATE eyes_on_agents_thread SET title = ?, cwd = ?, runtime_state = ?,
            active_flags_json = '[]',
            last_completed_turn_id = CASE WHEN ? THEN active_turn_id ELSE last_completed_turn_id END,
            last_completed_at = CASE WHEN ? THEN ? ELSE last_completed_at END,
            active_turn_id = ?, is_unread = CASE WHEN ? OR ? THEN 1 ELSE is_unread END,
            status_source = 'claude_agent_view', status_observed_at = ?,
            status_fresh_until = ?, last_activity_at = ?,
            updated_at = ?
           WHERE provider = 'claude' AND thread_id = ? AND is_deleted = 0 AND (
             runtime_state <> ? OR COALESCE(status_observed_at, -1) <> ? OR
             COALESCE(status_fresh_until, -1) <> ? OR
             COALESCE(title, '') <> COALESCE(?, '') OR COALESCE(cwd, '') <> COALESCE(?, '') OR
             COALESCE(active_turn_id, '') <> COALESCE(?, '') OR
             COALESCE(last_activity_at, -1) <> COALESCE(?, -1)
           )`
        ).run(
          title, cwd, agent.runtimeState, terminalTransition ? 1 : 0,
          terminalTransition ? 1 : 0, agent.observedAt, activeTurnId,
          isActive ? 1 : 0, terminalTransition ? 1 : 0, statusObservedAt,
          statusFreshUntil, lastActivityAt, now, agent.threadId,
          agent.runtimeState, statusObservedAt, statusFreshUntil, title, cwd, activeTurnId,
          lastActivityAt
        );
        if (Number(result.changes) === 1) changed = true;
      }
      if (params.completeSnapshot) {
        const present = agents.map((agent) => agent.threadId);
        const placeholders = present.map(() => '?').join(', ');
        const sql = `UPDATE eyes_on_agents_thread SET runtime_state = 'unknown',
          active_flags_json = '[]', active_turn_id = NULL, status_source = 'discovery',
          status_observed_at = ?, status_fresh_until = NULL, updated_at = ?
          WHERE provider = 'claude' AND is_deleted = 0
            AND status_source = 'claude_agent_view'
            AND runtime_state IN ('working', 'waiting_approval', 'waiting_input')
            AND COALESCE(status_fresh_until, 0) <= ?
            ${present.length === 0 ? '' : `AND thread_id NOT IN (${placeholders})`}`;
        const expired = sqliteManager.db.prepare(sql).run(
          snapshotObservedAt, now, snapshotObservedAt, ...present
        );
        if (Number(expired.changes) > 0) changed = true;
      }
      return { changed };
    });
    return transaction();
  }

  async clearClaudeTranscriptCapabilities(): Promise<EyesOnAgentsRepositoryMutationResult> {
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread
       SET transcript_path = NULL, transcript_identity_ambiguous = 0,
         transcript_activity_at = NULL, updated_at = ?
       WHERE provider = 'claude' AND (
         transcript_path IS NOT NULL OR transcript_identity_ambiguous <> 0 OR
         transcript_activity_at IS NOT NULL
       )`,
      [Date.now()]
    );
    return { changed: Number(result.changes) > 0 };
  }

  async expireClaudeAgentStates(params: {
    observedAt: number;
    statusSources?: Array<'claude_agent_view' | 'claude_hook'>;
    force?: boolean;
  }): Promise<EyesOnAgentsRepositoryMutationResult> {
    const observedAt = parseEyesOnAgentsTimestamp(
      params?.observedAt,
      'Claude expiry observedAt',
      false
    ) as number;
    const sources = params.statusSources ?? ['claude_agent_view', 'claude_hook'];
    if (!Array.isArray(sources) || sources.length === 0 ||
      sources.some((source) => !['claude_agent_view', 'claude_hook'].includes(source))) {
      throw new Error('Claude expiry sources are invalid');
    }
    const placeholders = sources.map(() => '?').join(', ');
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET runtime_state = 'unknown', active_flags_json = '[]',
        active_turn_id = NULL, status_source = 'discovery', status_observed_at = ?,
        status_fresh_until = NULL, updated_at = ?
       WHERE provider = 'claude' AND is_deleted = 0
         AND status_source IN (${placeholders})
         AND runtime_state IN ('working', 'waiting_approval', 'waiting_input')
         ${params.force === true ? '' : "AND status_source <> 'claude_hook'"}
         ${params.force === true ? '' : 'AND COALESCE(status_fresh_until, 0) <= ?'}`,
      params.force === true
        ? [observedAt, Date.now(), ...sources]
        : [observedAt, Date.now(), ...sources, observedAt]
    );
    return { changed: Number(result.changes) > 0 };
  }

  async getRuntimeReceiptSummary(params: {
    provider: EyesOnAgentsProvider;
  }): Promise<{ firstReceivedAt: number | null; lastReceivedAt: number | null }> {
    const provider = parseEyesOnAgentsProvider(params?.provider);
    const row = await sqliteHelper.safeGet<{
      first_received_at: number | null;
      last_received_at: number | null;
    }>(
      `SELECT MIN(committed_at) AS first_received_at, MAX(committed_at) AS last_received_at
       FROM eyes_on_agents_hook_delivery_receipt
       WHERE provider = ? AND is_observation_eligible = 1`,
      [provider]
    );
    const normalize = (value: number | null | undefined): number | null => (
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
    );
    return {
      firstReceivedAt: normalize(row?.first_received_at),
      lastReceivedAt: normalize(row?.last_received_at)
    };
  }

  async getClaudeOpenTarget(params: {
    sessionKey: EyesOnAgentsSessionKey;
  }): Promise<EyesOnAgentsClaudeOpenTarget | null> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (!sessionKey.startsWith('claude:')) throw new Error('Claude session key is required');
    const row = await sqliteHelper.safeGet<{
      desktop_session_id: string | null; iterm2_session_id: string | null;
      transcript_path: string | null; runtime_state: string;
    }>(
      `SELECT desktop_session_id, iterm2_session_id, transcript_path, runtime_state
       FROM eyes_on_agents_thread
       WHERE session_key = ? AND provider = 'claude' AND is_deleted = 0`,
      [sessionKey]
    );
    if (!row) return null;
    return {
      sessionKey,
      desktopSessionId: parseEyesOnAgentsDesktopSessionId(row.desktop_session_id),
      iterm2SessionId: parseEyesOnAgentsIterm2SessionId(row.iterm2_session_id),
      transcriptPath: normalizeClaudeTranscriptPath(row.transcript_path),
      runtimeState: parseEyesOnAgentsRuntimeState(row.runtime_state)
    };
  }
}

export const eyesOnAgentsRepositoryDao = new EyesOnAgentsRepositoryDao();
