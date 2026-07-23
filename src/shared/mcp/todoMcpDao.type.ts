export type TodoEntityId = string;

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
  id: TodoEntityId;
  customer_id: string;
  title: string;
  description: string;
  is_deleted: 0;
  archived: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface McpTodoRow {
  id: TodoEntityId;
  customer_id: string;
  domain_id: TodoEntityId;
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
  is_deleted: 0;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface McpSubTodoRow {
  id: TodoEntityId;
  customer_id: string;
  todo_id: TodoEntityId;
  title: string;
  status: number;
  is_deleted: 0;
  position: number;
  created_at: number;
  updated_at: number;
}

export type McpTodoLookupState = 'active' | 'completed' | 'deleted' | 'missing';

export interface McpTodoStatusItem {
  id: TodoEntityId;
  state: McpTodoLookupState;
  exists: boolean;
  completed: boolean;
  deleted: boolean;
  title: string | null;
  domain_id: TodoEntityId | null;
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
  todo_id: TodoEntityId | null;
  domain_id: TodoEntityId | null;
  actor: McpTodoEventActor;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface McpTodoEventListResult {
  events: McpTodoEventItem[];
  latestEventId: number;
  hasMore: boolean;
}

export type RestoreDomainResult =
  | 'restored'
  | 'already_active'
  | 'limit_reached'
  | 'not_found';

export interface DomainMcpDaoApi {
  create(params: {
    title?: string;
    description?: string;
  }): Promise<McpDomainRow | undefined>;
  getAll(): Promise<McpDomainRow[]>;
  getById(params: { id: TodoEntityId }): Promise<McpDomainRow | undefined>;
  updateTitle(params: { id: TodoEntityId; title: string }): Promise<void>;
  updateDescription(params: { id: TodoEntityId; description: string }): Promise<void>;
  hardDelete(params: { id: TodoEntityId }): Promise<void>;
  setArchived(params: { id: TodoEntityId; archived: number }): Promise<void>;
  restore(params: { id: TodoEntityId }): Promise<RestoreDomainResult>;
}

export interface TodoMcpDaoApi {
  create(params: {
    domainId: TodoEntityId;
    title: string;
    source?: McpTodoSource;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  getByDomainId(params: {
    domainId: TodoEntityId;
    status?: number;
  }): Promise<McpTodoRow[]>;
  getById(params: { id: TodoEntityId }): Promise<McpTodoRow | undefined>;
  getStatusByIds(params: { ids: TodoEntityId[] }): Promise<McpTodoStatusByIdsResult>;
  update(params: {
    id: TodoEntityId;
    title?: string;
    due_at?: number | null;
    remind_at?: number | null;
    important?: number;
    note?: string | null;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  updateRepeatType(params: {
    id: TodoEntityId;
    repeatType: string | null;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  updateRepeatInterval(params: {
    id: TodoEntityId;
    interval: number;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  completeTodo(params: {
    id: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  uncompleteTodo(params: {
    id: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  toggleImportant(params: {
    id: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  hardDelete(params: {
    id: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<boolean>;
  moveToDomain(params: {
    id: TodoEntityId;
    domainId: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
  getSortOrder(params: { key: string }): Promise<TodoEntityId[]>;
  setSortOrder(params: { key: string; order: TodoEntityId[] }): Promise<void>;
  skipToCurrent(params: {
    id: TodoEntityId;
    actor?: McpTodoEventActor;
  }): Promise<McpTodoRow | undefined>;
}

export interface SubTodoMcpDaoApi {
  create(params: {
    todoId: TodoEntityId;
    title: string;
  }): Promise<McpSubTodoRow | undefined>;
  getByTodoId(params: { todoId: TodoEntityId }): Promise<McpSubTodoRow[]>;
  getById(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined>;
  updateTitle(params: { id: TodoEntityId; title: string }): Promise<void>;
  setStatus(params: {
    id: TodoEntityId;
    status: 0 | 1;
  }): Promise<McpSubTodoRow | undefined>;
  toggleStatus(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined>;
  getCountByTodoId(params: {
    todoId: TodoEntityId;
  }): Promise<{ total: number; done: number }>;
  getCountsByTodoIds(params: {
    todoIds: TodoEntityId[];
  }): Promise<Record<TodoEntityId, { total: number; done: number }>>;
  hardDelete(params: { id: TodoEntityId }): Promise<void>;
}

export interface TodoEventMcpDaoApi {
  listAfter(params: {
    afterEventId?: number;
    limit?: number;
  }): Promise<McpTodoEventListResult>;
}
