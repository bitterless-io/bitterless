import {
  XpcPreloadHandler,
} from 'electron-xpc/preload';
import type {
  McpDomainRow,
  McpSubTodoRow,
  McpTodoEventListResult,
  McpTodoRow,
  McpTodoStatusByIdsResult,
  RestoreDomainResult,
  TodoEntityId,
  TodoEventMcpDaoApi,
  TodoMcpDaoApi,
} from '@shared/mcp/todoMcpDao.type';
import type {
  TodoistSyncActivateParams,
  TodoistSyncActivationResult,
  TodoistSyncClockApi,
  TodoistSyncClockCheckParams,
  TodoistSyncClockCheckResult,
  TodoistSyncClockContext,
  TodoistSyncFailure,
  TodoistSyncSessionApi,
  TodoistSyncStatus,
  TodoistSyncStatusApi,
} from '@shared/todoistSync/todoistSync.type';
import {
  isTodoRendererOriginId,
  type TodoistSyncDomainApi,
  type TodoistSyncSubTodoApi,
  type TodoistSyncTodoApi,
  type TodoMutationContext,
  type TodoMutationRequest,
} from '@shared/todoistSync/todoDataUpdate.shared';
import type { TodoistSyncSessionService } from './todoistSync.session';

export interface TodoistSyncHandlerRuntime {
  getSession(): Promise<TodoistSyncSessionService>;
  openDateTimeSettings(): Promise<void>;
}

const requireMutation = <Params>(
  request: TodoMutationRequest<Params>,
): { params: Params; context: TodoMutationContext } => {
  if (!request || typeof request !== 'object') {
    throw new Error('[todo] mutation request is invalid');
  }
  if (request.originRendererId !== null && !isTodoRendererOriginId(request.originRendererId)) {
    throw new Error('[todo] mutation origin is invalid');
  }
  if (!Object.prototype.hasOwnProperty.call(request, 'params')) {
    throw new Error('[todo] mutation params are missing');
  }
  return {
    params: request.params,
    context: { originRendererId: request.originRendererId },
  };
};

export class TodoistSyncSessionHandler extends XpcPreloadHandler implements TodoistSyncSessionApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async activate(params: TodoistSyncActivateParams): Promise<TodoistSyncActivationResult> {
    return await (await this.runtime.getSession()).activate(params);
  }

  async deactivate(): Promise<void> {
    await (await this.runtime.getSession()).deactivate();
  }
}

export class TodoistSyncDomainHandler extends XpcPreloadHandler implements TodoistSyncDomainApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async create(request: Parameters<TodoistSyncDomainApi['create']>[0]): Promise<McpDomainRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).createDomain(params, context);
  }

  async getAll(): Promise<McpDomainRow[]> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getDomains();
  }

  async getById(params: { id: TodoEntityId }): Promise<McpDomainRow | undefined> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getDomainById(params);
  }

  async updateTitle(request: Parameters<TodoistSyncDomainApi['updateTitle']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).updateDomainTitle(params, context);
  }

  async updateDescription(request: Parameters<TodoistSyncDomainApi['updateDescription']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).updateDomainDescription(params, context);
  }

  async hardDelete(request: Parameters<TodoistSyncDomainApi['hardDelete']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).deleteDomain(params, context);
  }

  async setArchived(request: Parameters<TodoistSyncDomainApi['setArchived']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).setDomainArchived(params, context);
  }

  async restore(request: Parameters<TodoistSyncDomainApi['restore']>[0]): Promise<RestoreDomainResult> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).restoreDomain(params, context);
  }
}

export class TodoistSyncTodoHandler extends XpcPreloadHandler implements TodoistSyncTodoApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async create(request: Parameters<TodoistSyncTodoApi['create']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).createTodo(params, context);
  }

  async getByDomainId(params: Parameters<TodoMcpDaoApi['getByDomainId']>[0]): Promise<McpTodoRow[]> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getTodosByDomain(params);
  }

  async getById(params: { id: TodoEntityId }): Promise<McpTodoRow | undefined> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getTodoById(params);
  }

  async getStatusByIds(params: { ids: TodoEntityId[] }): Promise<McpTodoStatusByIdsResult> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getStatusByIds(params);
  }

  async update(request: Parameters<TodoistSyncTodoApi['update']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).updateTodo(params, context);
  }

  async updateRepeatType(request: Parameters<TodoistSyncTodoApi['updateRepeatType']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).updateRepeatType(params, context);
  }

  async updateRepeatInterval(request: Parameters<TodoistSyncTodoApi['updateRepeatInterval']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).updateRepeatInterval(params, context);
  }

  async completeTodo(request: Parameters<TodoistSyncTodoApi['completeTodo']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).completeTodo(params, context);
  }

  async uncompleteTodo(request: Parameters<TodoistSyncTodoApi['uncompleteTodo']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).uncompleteTodo(params, context);
  }

  async toggleImportant(request: Parameters<TodoistSyncTodoApi['toggleImportant']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).toggleImportant(params, context);
  }

  async hardDelete(request: Parameters<TodoistSyncTodoApi['hardDelete']>[0]): Promise<boolean> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).deleteTodo(params.id, {
      actor: params.actor,
      context,
    });
  }

  async moveToDomain(request: Parameters<TodoistSyncTodoApi['moveToDomain']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).moveToDomain(params, context);
  }

  async getSortOrder(params: { key: string }): Promise<TodoEntityId[]> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getSortOrder(params);
  }

  async setSortOrder(request: Parameters<TodoistSyncTodoApi['setSortOrder']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).setSortOrder(params, context);
  }

  async skipToCurrent(request: Parameters<TodoistSyncTodoApi['skipToCurrent']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).skipToCurrent(params, context);
  }
}

export class TodoistSyncSubTodoHandler extends XpcPreloadHandler implements TodoistSyncSubTodoApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async create(request: Parameters<TodoistSyncSubTodoApi['create']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).createSubTodo(params, context);
  }

  async getByTodoId(params: { todoId: TodoEntityId }): Promise<McpSubTodoRow[]> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getSubTodosByTodoId(params);
  }

  async getById(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getSubTodoById(params);
  }

  async updateTitle(request: Parameters<TodoistSyncSubTodoApi['updateTitle']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).updateSubTodoTitle(params, context);
  }

  async setStatus(request: Parameters<TodoistSyncSubTodoApi['setStatus']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).setSubTodoStatus(params, context);
  }

  async toggleStatus(request: Parameters<TodoistSyncSubTodoApi['toggleStatus']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireMutation(request);
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).toggleSubTodoStatus(params, context);
  }

  async getCountByTodoId(params: { todoId: TodoEntityId }): Promise<{ total: number; done: number }> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getCountByTodoId(params);
  }

  async getCountsByTodoIds(
    params: { todoIds: TodoEntityId[] },
  ): Promise<Record<TodoEntityId, { total: number; done: number }>> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getCountsByTodoIds(params);
  }

  async hardDelete(request: Parameters<TodoistSyncSubTodoApi['hardDelete']>[0]): Promise<void> {
    const { params, context } = requireMutation(request);
    await (await (await this.runtime.getSession()).getRepositoryAsync()).deleteSubTodo(params, context);
  }
}

export class TodoistSyncEventHandler extends XpcPreloadHandler implements TodoEventMcpDaoApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async listAfter(params: Parameters<TodoEventMcpDaoApi['listAfter']>[0]): Promise<McpTodoEventListResult> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).listAfter(params);
  }
}

export class TodoistSyncClockHandler extends XpcPreloadHandler implements TodoistSyncClockApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async getContext(): Promise<TodoistSyncClockContext> {
    return (await this.runtime.getSession()).getClockContext();
  }

  async check(params: TodoistSyncClockCheckParams): Promise<TodoistSyncClockCheckResult> {
    return await (await this.runtime.getSession()).checkClock(params);
  }

  async openDateTimeSettings(): Promise<void> {
    await this.runtime.openDateTimeSettings();
  }
}

export class TodoistSyncStatusHandler extends XpcPreloadHandler implements TodoistSyncStatusApi {
  constructor(private readonly runtime: TodoistSyncHandlerRuntime) {
    super();
  }

  async getStatus(): Promise<TodoistSyncStatus> {
    return await (await this.runtime.getSession()).getStatus();
  }

  async getFailures(): Promise<TodoistSyncFailure[]> {
    return await (await (await this.runtime.getSession()).getRepositoryAsync()).getFailures();
  }

  async requestSync(): Promise<void> {
    (await this.runtime.getSession()).requestSync();
  }

  async retryFailed(params: { uuid: string }): Promise<void> {
    await (await (await this.runtime.getSession()).getRepositoryAsync()).retryFailed(params.uuid);
  }

  async discardFailed(params: { uuid: string }): Promise<void> {
    await (await (await this.runtime.getSession()).getRepositoryAsync()).discardFailed(params.uuid);
  }
}

export interface TodoistSyncHandlers {
  session: TodoistSyncSessionHandler;
  domain: TodoistSyncDomainHandler;
  todo: TodoistSyncTodoHandler;
  subTodo: TodoistSyncSubTodoHandler;
  event: TodoistSyncEventHandler;
  clock: TodoistSyncClockHandler;
  status: TodoistSyncStatusHandler;
}

export const registerTodoistSyncHandlers = (
  runtime: TodoistSyncHandlerRuntime,
): TodoistSyncHandlers => ({
  session: new TodoistSyncSessionHandler(runtime),
  domain: new TodoistSyncDomainHandler(runtime),
  todo: new TodoistSyncTodoHandler(runtime),
  subTodo: new TodoistSyncSubTodoHandler(runtime),
  event: new TodoistSyncEventHandler(runtime),
  clock: new TodoistSyncClockHandler(runtime),
  status: new TodoistSyncStatusHandler(runtime),
});
