import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

export type TodoEventActor = 'human' | 'ai' | 'system';

export type TodoEventType =
  | 'todo.created'
  | 'todo.updated'
  | 'todo.completed'
  | 'todo.uncompleted'
  | 'todo.deleted'
  | 'todo.moved'
  | 'todo.starred'
  | 'todo.unstarred';

export interface TodoEventRow {
  id: number;
  type: TodoEventType;
  todo_id: number | null;
  domain_id: number | null;
  actor: TodoEventActor;
  payload: string;
  created_at: number;
}

export interface TodoEventItem {
  id: number;
  type: TodoEventType;
  todo_id: number | null;
  domain_id: number | null;
  actor: TodoEventActor;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface TodoEventCreateParams {
  type: TodoEventType;
  todoId?: number | null;
  domainId?: number | null;
  actor?: TodoEventActor;
  payload?: Record<string, unknown>;
}

export interface TodoEventListParams {
  afterEventId?: number;
  limit?: number;
}

export interface TodoEventListResult {
  events: TodoEventItem[];
  latestEventId: number;
  hasMore: boolean;
}

const normalizeActor = (actor: TodoEventActor | undefined): TodoEventActor => {
  if (actor === undefined) return 'human';
  if (actor === 'human' || actor === 'ai' || actor === 'system') return actor;
  throw new Error('actor must be human, ai, or system');
};

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(100, Math.floor(limit)));
};

const parsePayload = (payload: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

const toEventItem = (row: TodoEventRow): TodoEventItem => {
  return {
    id: row.id,
    type: row.type,
    todo_id: row.todo_id,
    domain_id: row.domain_id,
    actor: row.actor,
    payload: parsePayload(row.payload),
    created_at: row.created_at,
  };
};

export const recordTodoEvent = async (params: TodoEventCreateParams): Promise<TodoEventItem | undefined> => {
  const now = Date.now();
  const actor = normalizeActor(params.actor);
  const payload = JSON.stringify(params.payload ?? {});
  const result = await sqliteHelper.safeRun(
    'INSERT INTO todo_events (type, todo_id, domain_id, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [params.type, params.todoId ?? null, params.domainId ?? null, actor, payload, now],
  );
  const row = await sqliteHelper.safeGet<TodoEventRow>(
    'SELECT * FROM todo_events WHERE id = ?',
    [result.lastInsertRowid],
  );
  return row ? toEventItem(row) : undefined;
};

export class TodoEventDao extends BaseDao {
  async create(params: TodoEventCreateParams): Promise<TodoEventItem | undefined> {
    return recordTodoEvent(params);
  }

  async listAfter(params: TodoEventListParams): Promise<TodoEventListResult> {
    const afterEventId = Math.max(0, Math.floor(params.afterEventId ?? 0));
    const limit = normalizeLimit(params.limit);
    const rows = await sqliteHelper.safeAll<TodoEventRow>(
      'SELECT * FROM todo_events WHERE id > ? ORDER BY id ASC LIMIT ?',
      [afterEventId, limit + 1],
    );
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const latestEventId = visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].id
      : afterEventId;
    return {
      events: visibleRows.map(toEventItem),
      latestEventId,
      hasMore,
    };
  }

  async getLatestId(): Promise<number> {
    const row = await sqliteHelper.safeGet<{ latestEventId: number | null }>(
      'SELECT MAX(id) as latestEventId FROM todo_events',
      [],
    );
    return row?.latestEventId ?? 0;
  }
}

export const todoEventDao = new TodoEventDao();
