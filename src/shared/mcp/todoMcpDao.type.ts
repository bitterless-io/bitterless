export type McpTodoSource = 'human' | 'ai';

export type McpTodoEventActor = 'human' | 'ai' | 'system';

export type McpTodoEventType =
  | 'todo.created'
  | 'todo.updated'
  | 'todo.completed'
  | 'todo.uncompleted'
  | 'todo.deleted'
  | 'todo.moved'
  | 'todo.starred'
  | 'todo.unstarred';

export interface McpDomainRow {
  id: number;
  title: string;
  description: string;
  is_deleted: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export interface McpTodoRow {
  id: number;
  domain_id: number;
  title: string;
  status: number;
  important: number;
  due_at: number | null;
  repeat_type: string | null;
  repeat_interval: number;
  remind_at: number | null;
  last_remind_at: number | null;
  last_complete_at: number | null;
  week_day: number | null;
  monthly_day: number | null;
  yearly_day: number | null;
  note: string;
  source: McpTodoSource;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

export type McpTodoLookupState = 'active' | 'completed' | 'deleted' | 'missing';

export interface McpTodoStatusItem {
  id: number;
  state: McpTodoLookupState;
  exists: boolean;
  completed: boolean;
  deleted: boolean;
  title: string | null;
  domain_id: number | null;
  updated_at: number | null;
  completed_at: number | null;
  deleted_at: number | null;
  deleted_event_id: number | null;
}

export interface McpTodoStatusByIdsResult {
  items: McpTodoStatusItem[];
  summary: Record<McpTodoLookupState, number>;
}

export interface McpTodoEventItem {
  id: number;
  type: McpTodoEventType;
  todo_id: number | null;
  domain_id: number | null;
  actor: McpTodoEventActor;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface McpTodoEventListResult {
  events: McpTodoEventItem[];
  latestEventId: number;
  hasMore: boolean;
}

export interface DomainMcpDaoApi {
  create(params: {
    title?: string;
    description?: string;
  }): Promise<McpDomainRow | undefined>;
  getAll(): Promise<McpDomainRow[]>;
}

export interface TodoMcpDaoApi {
  create(params: {
    domainId: number;
    title: string;
    source?: McpTodoSource;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  getByDomainId(params: {
    domainId: number;
    status?: number;
  }): Promise<McpTodoRow[]>;
  getById(params: { id: number }): Promise<McpTodoRow | undefined>;
  getStatusByIds(params: { ids: number[] }): Promise<McpTodoStatusByIdsResult>;
  update(params: {
    id: number;
    title?: string;
    due_at?: number | null;
    remind_at?: number | null;
    important?: number;
    note?: string | null;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  completeTodo(params: {
    id: number;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  uncompleteTodo(params: {
    id: number;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  hardDelete(params: {
    id: number;
    actor?: McpTodoEventActor;
  }): Promise<boolean>;
  moveToDomain(params: {
    id: number;
    domainId: number;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
}

export interface TodoEventMcpDaoApi {
  listAfter(params: {
    afterEventId?: number;
    limit?: number;
  }): Promise<McpTodoEventListResult>;
}
