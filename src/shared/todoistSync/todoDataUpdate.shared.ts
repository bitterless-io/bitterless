import type {
  DomainMcpDaoApi,
  SubTodoMcpDaoApi,
  TodoMcpDaoApi,
} from '@shared/mcp/todoMcpDao.type';

export interface TodoDataUpdatedEvent {
  originRendererId: string | null;
}

export interface TodoMutationContext {
  originRendererId: string | null;
}

export interface TodoMutationRequest<Params, Origin extends string | null = string | null> {
  originRendererId: Origin;
  params: Params;
}

export type TodoRendererMutationRequest<Params> = TodoMutationRequest<Params, string>;

type MutationMethod<Method, Origin extends string | null> = Method extends (
  params: infer Params,
) => infer Result
  ? (request: TodoMutationRequest<Params, Origin>) => Result
  : never;

type DomainMutationName =
  | 'create'
  | 'updateTitle'
  | 'updateDescription'
  | 'hardDelete'
  | 'setArchived'
  | 'restore';

type TodoMutationName =
  | 'create'
  | 'update'
  | 'updateRepeatType'
  | 'updateRepeatInterval'
  | 'completeTodo'
  | 'uncompleteTodo'
  | 'toggleImportant'
  | 'hardDelete'
  | 'moveToDomain'
  | 'setSortOrder'
  | 'skipToCurrent';

type SubTodoMutationName =
  | 'create'
  | 'updateTitle'
  | 'setStatus'
  | 'toggleStatus'
  | 'hardDelete';

export type TodoistSyncDomainApi = Omit<DomainMcpDaoApi, DomainMutationName> & {
  [Key in DomainMutationName]: MutationMethod<DomainMcpDaoApi[Key], string | null>;
};

export type TodoistSyncTodoApi = Omit<TodoMcpDaoApi, TodoMutationName> & {
  [Key in TodoMutationName]: MutationMethod<TodoMcpDaoApi[Key], string | null>;
};

export type TodoistSyncSubTodoApi = Omit<SubTodoMcpDaoApi, SubTodoMutationName> & {
  [Key in SubTodoMutationName]: MutationMethod<SubTodoMcpDaoApi[Key], string | null>;
};

export type TodoRendererDomainApi = Omit<DomainMcpDaoApi, DomainMutationName> & {
  [Key in DomainMutationName]: MutationMethod<DomainMcpDaoApi[Key], string>;
};

export type TodoRendererTodoApi = Omit<TodoMcpDaoApi, TodoMutationName> & {
  [Key in TodoMutationName]: MutationMethod<TodoMcpDaoApi[Key], string>;
};

export type TodoRendererSubTodoApi = Omit<SubTodoMcpDaoApi, SubTodoMutationName> & {
  [Key in SubTodoMutationName]: MutationMethod<SubTodoMcpDaoApi[Key], string>;
};

const TODO_RENDERER_ORIGIN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isTodoRendererOriginId = (value: unknown): value is string => {
  return typeof value === 'string' && TODO_RENDERER_ORIGIN_PATTERN.test(value);
};
