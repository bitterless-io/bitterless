import { randomUUID } from 'node:crypto';
import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import { sqliteManager } from '../sqliteHelper/sqlite.manager';
import type {
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsDomain,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsRuntimeState,
  EyesOnAgentsSnapshot,
  EyesOnAgentsStatusSource,
  EyesOnAgentsThread
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  isEyesOnAgentsFocused,
  isEyesOnAgentsUnread,
  parseEyesOnAgentsActiveFlags,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsRuntimeEvent,
  parseEyesOnAgentsRuntimeState,
  parseEyesOnAgentsText,
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
  runtime_state: string;
  active_flags_json: string;
  active_turn_id: string | null;
  last_completed_turn_id: string | null;
  last_completed_at: number | null;
  last_opened_turn_id: string | null;
  last_opened_at: number | null;
  status_source: string;
  status_observed_at: number | null;
  last_activity_at: number | null;
}

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
  const isUnread = isEyesOnAgentsUnread({
    lastCompletedTurnId,
    lastCompletedAt,
    lastOpenedTurnId,
    lastOpenedAt
  });
  return {
    threadId: parseEyesOnAgentsUuid(row.thread_id),
    domainId: parsePositiveId(row.domain_id, 'domain id'),
    title: parseEyesOnAgentsText(row.title, 'thread title', 300),
    cwd: parseEyesOnAgentsPath(row.cwd),
    runtimeState,
    activeFlags,
    activeTurnId: parseTurnId(row.active_turn_id, 'active_turn_id'),
    lastCompletedTurnId,
    lastCompletedAt: toIso(lastCompletedAt),
    lastOpenedTurnId,
    lastOpenedAt: toIso(lastOpenedAt),
    statusSource: parseStatusSource(row.status_source),
    statusObservedAt: toIso(
      parseEyesOnAgentsTimestamp(row.status_observed_at, 'status_observed_at')
    ),
    lastActivityAt: toIso(
      parseEyesOnAgentsTimestamp(row.last_activity_at, 'last_activity_at')
    ),
    isUnread,
    isFocused: isEyesOnAgentsFocused(runtimeState, isUnread)
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
): EyesOnAgentsDiscoveredThread => ({
  threadId: parseEyesOnAgentsUuid(value.threadId),
  title: parseEyesOnAgentsText(value.title, 'thread title', 300),
  cwd: parseEyesOnAgentsPath(value.cwd),
  runtimeState: parseEyesOnAgentsRuntimeState(value.runtimeState),
  activeFlags: parseEyesOnAgentsActiveFlags(value.activeFlags),
  statusSource: value.statusSource === 'app_server' ? 'app_server' : 'discovery',
  statusObservedAt: parseEyesOnAgentsTimestamp(value.statusObservedAt, 'statusObservedAt'),
  lastActivityAt: parseEyesOnAgentsTimestamp(value.lastActivityAt, 'lastActivityAt')
});

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
      `SELECT thread_id, domain_id, title, cwd, runtime_state, active_flags_json,
        active_turn_id, last_completed_turn_id, last_completed_at,
        last_opened_turn_id, last_opened_at, status_source, status_observed_at,
        last_activity_at
       FROM eyes_on_agents_thread
       ORDER BY COALESCE(last_activity_at, updated_at) DESC, updated_at DESC`,
      []
    );
    return { domains: domains.map(toDomain), threads: rows.map(toThread) };
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
          thread_id, domain_id, title, cwd, runtime_state, active_flags_json,
          active_turn_id, last_completed_turn_id, last_completed_at,
          last_opened_turn_id, last_opened_at, status_source, status_observed_at,
          last_activity_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          title = COALESCE(excluded.title, eyes_on_agents_thread.title),
          cwd = COALESCE(excluded.cwd, eyes_on_agents_thread.cwd),
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
        statement.run(
          thread.threadId,
          domainId,
          thread.title,
          thread.cwd,
          thread.runtimeState,
          JSON.stringify(thread.activeFlags),
          thread.statusSource,
          thread.statusObservedAt,
          thread.lastActivityAt,
          now,
          now
        );
      }
    });
    transaction();
  }

  async applyRuntimeEvent(params: { event: EyesOnAgentsRuntimeEvent }): Promise<void> {
    if (!params) throw new Error('event params are required');
    const event = parseEyesOnAgentsRuntimeEvent(params.event);
    const transaction = sqliteManager.db.transaction(() => {
      const now = Date.now();
      const domainId = defaultDomainId();
      const state = eventState(event);
      const activeFlags = event.type === 'thread_status' ? event.activeFlags : [];
      const startedTurnId = event.type === 'turn_started'
        ? event.turnId ?? (event.source === 'codex_hook' ? `hook-${event.observedAt}` : null)
        : event.type === 'thread_status'
          ? event.turnId ?? null
          : null;
      sqliteManager.db.prepare(
        `INSERT OR IGNORE INTO eyes_on_agents_thread (
          thread_id, domain_id, title, cwd, runtime_state, active_flags_json,
          active_turn_id, last_completed_turn_id, last_completed_at,
          last_opened_turn_id, last_opened_at, status_source, status_observed_at,
          last_activity_at, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
      ).run(
        event.threadId,
        domainId,
        event.cwd ?? null,
        state,
        JSON.stringify(activeFlags),
        startedTurnId,
        event.source,
        event.observedAt,
        event.observedAt,
        now,
        now
      );

      const existing = sqliteManager.db.prepare(
        `SELECT status_observed_at, active_turn_id
         FROM eyes_on_agents_thread WHERE thread_id = ?`
      ).get(event.threadId) as {
        status_observed_at: number | null;
        active_turn_id: string | null;
      };
      if (existing.status_observed_at !== null && existing.status_observed_at > event.observedAt) {
        return;
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
        return;
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
        event.source,
        event.observedAt,
        event.observedAt,
        now,
        event.threadId
      );
    });
    transaction();
  }

  async markOpened(params: { threadId: string; openedAt: number }): Promise<void> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const openedAt = parseEyesOnAgentsTimestamp(params?.openedAt, 'openedAt', false) as number;
    const result = await sqliteHelper.safeRun(
      `UPDATE eyes_on_agents_thread SET
        last_opened_turn_id = COALESCE(active_turn_id, last_completed_turn_id),
        last_opened_at = ?,
        updated_at = ?
       WHERE thread_id = ?`,
      [openedAt, Date.now(), threadId]
    );
    if (Number(result.changes) === 0) throw new Error('Thread was not found');
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
