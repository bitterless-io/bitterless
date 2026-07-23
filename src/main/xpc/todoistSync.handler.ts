import { shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
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
  type TodoMutationContext,
  type TodoRendererDomainApi,
  type TodoRendererMutationRequest,
  type TodoRendererSubTodoApi,
  type TodoRendererTodoApi,
} from '@shared/todoistSync/todoDataUpdate.shared';
import { todoistSyncSession } from '@main/todoistSync/todoistSync.session';

const requireRendererMutation = <Params>(
  request: TodoRendererMutationRequest<Params>,
): { params: Params; context: TodoMutationContext } => {
  if (!request || typeof request !== 'object') {
    throw new Error('[todo] renderer mutation request is invalid');
  }
  if (!isTodoRendererOriginId(request.originRendererId)) {
    throw new Error('[todo] renderer mutation origin is invalid');
  }
  if (!Object.prototype.hasOwnProperty.call(request, 'params')) {
    throw new Error('[todo] renderer mutation params are missing');
  }
  return {
    params: request.params,
    context: { originRendererId: request.originRendererId },
  };
};

export class TodoistSyncSessionHandler extends XpcMainHandler implements TodoistSyncSessionApi {
  async activate(params: TodoistSyncActivateParams): Promise<TodoistSyncActivationResult> {
    return await todoistSyncSession.activate(params);
  }

  async deactivate(): Promise<void> {
    await todoistSyncSession.deactivate();
  }
}

export class TodoistSyncDomainHandler extends XpcMainHandler implements TodoRendererDomainApi {
  async create(request: Parameters<TodoRendererDomainApi['create']>[0]): Promise<McpDomainRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).createDomain(params, context);
  }
  async getAll(): Promise<McpDomainRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getDomains(); }
  async getById(params: { id: TodoEntityId }): Promise<McpDomainRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getDomainById(params); }
  async updateTitle(request: Parameters<TodoRendererDomainApi['updateTitle']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).updateDomainTitle(params, context);
  }
  async updateDescription(request: Parameters<TodoRendererDomainApi['updateDescription']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).updateDomainDescription(params, context);
  }
  async hardDelete(request: Parameters<TodoRendererDomainApi['hardDelete']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).deleteDomain(params, context);
  }
  async setArchived(request: Parameters<TodoRendererDomainApi['setArchived']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).setDomainArchived(params, context);
  }
  async restore(request: Parameters<TodoRendererDomainApi['restore']>[0]): Promise<RestoreDomainResult> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).restoreDomain(params, context);
  }
}

export class TodoistSyncTodoHandler extends XpcMainHandler implements TodoRendererTodoApi {
  async create(request: Parameters<TodoRendererTodoApi['create']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).createTodo(params, context);
  }
  async getByDomainId(params: Parameters<TodoMcpDaoApi['getByDomainId']>[0]): Promise<McpTodoRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getTodosByDomain(params); }
  async getById(params: { id: TodoEntityId }): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getTodoById(params); }
  async getStatusByIds(params: { ids: TodoEntityId[] }): Promise<McpTodoStatusByIdsResult> { return await (await todoistSyncSession.getRepositoryAsync()).getStatusByIds(params); }
  async update(request: Parameters<TodoRendererTodoApi['update']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).updateTodo(params, context);
  }
  async updateRepeatType(request: Parameters<TodoRendererTodoApi['updateRepeatType']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).updateRepeatType(params, context);
  }
  async updateRepeatInterval(request: Parameters<TodoRendererTodoApi['updateRepeatInterval']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).updateRepeatInterval(params, context);
  }
  async completeTodo(request: Parameters<TodoRendererTodoApi['completeTodo']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).completeTodo(params, context);
  }
  async uncompleteTodo(request: Parameters<TodoRendererTodoApi['uncompleteTodo']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).uncompleteTodo(params, context);
  }
  async toggleImportant(request: Parameters<TodoRendererTodoApi['toggleImportant']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).toggleImportant(params, context);
  }
  async hardDelete(request: Parameters<TodoRendererTodoApi['hardDelete']>[0]): Promise<boolean> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).deleteTodo(params.id, {
      actor: params.actor,
      context,
    });
  }
  async moveToDomain(request: Parameters<TodoRendererTodoApi['moveToDomain']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).moveToDomain(params, context);
  }
  async getSortOrder(params: { key: string }): Promise<TodoEntityId[]> { return await (await todoistSyncSession.getRepositoryAsync()).getSortOrder(params); }
  async setSortOrder(request: Parameters<TodoRendererTodoApi['setSortOrder']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).setSortOrder(params, context);
  }
  async skipToCurrent(request: Parameters<TodoRendererTodoApi['skipToCurrent']>[0]): Promise<McpTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).skipToCurrent(params, context);
  }
}

export class TodoistSyncSubTodoHandler extends XpcMainHandler implements TodoRendererSubTodoApi {
  async create(request: Parameters<TodoRendererSubTodoApi['create']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).createSubTodo(params, context);
  }
  async getByTodoId(params: { todoId: TodoEntityId }): Promise<McpSubTodoRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getSubTodosByTodoId(params); }
  async getById(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getSubTodoById(params); }
  async updateTitle(request: Parameters<TodoRendererSubTodoApi['updateTitle']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).updateSubTodoTitle(params, context);
  }
  async setStatus(request: Parameters<TodoRendererSubTodoApi['setStatus']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).setSubTodoStatus(params, context);
  }
  async toggleStatus(request: Parameters<TodoRendererSubTodoApi['toggleStatus']>[0]): Promise<McpSubTodoRow | undefined> {
    const { params, context } = requireRendererMutation(request);
    return await (await todoistSyncSession.getRepositoryAsync()).toggleSubTodoStatus(params, context);
  }
  async getCountByTodoId(params: { todoId: TodoEntityId }): Promise<{ total: number; done: number }> { return await (await todoistSyncSession.getRepositoryAsync()).getCountByTodoId(params); }
  async getCountsByTodoIds(params: { todoIds: TodoEntityId[] }): Promise<Record<TodoEntityId, { total: number; done: number }>> { return await (await todoistSyncSession.getRepositoryAsync()).getCountsByTodoIds(params); }
  async hardDelete(request: Parameters<TodoRendererSubTodoApi['hardDelete']>[0]): Promise<void> {
    const { params, context } = requireRendererMutation(request);
    await (await todoistSyncSession.getRepositoryAsync()).deleteSubTodo(params, context);
  }
}

export class TodoistSyncEventHandler extends XpcMainHandler implements TodoEventMcpDaoApi {
  async listAfter(params: Parameters<TodoEventMcpDaoApi['listAfter']>[0]): Promise<McpTodoEventListResult> { return await (await todoistSyncSession.getRepositoryAsync()).listAfter(params); }
}

export class TodoistSyncClockHandler extends XpcMainHandler implements TodoistSyncClockApi {
  async getContext(): Promise<TodoistSyncClockContext> { return todoistSyncSession.getClockContext(); }
  async check(params: TodoistSyncClockCheckParams): Promise<TodoistSyncClockCheckResult> { return await todoistSyncSession.checkClock(params); }
  async openDateTimeSettings(): Promise<void> {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.Date-Time-Settings.extension');
      return;
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:dateandtime');
      return;
    }
    throw new Error('Date & Time settings are supported only on macOS and Windows');
  }
}

export class TodoistSyncStatusHandler extends XpcMainHandler implements TodoistSyncStatusApi {
  async getStatus(): Promise<TodoistSyncStatus> { return await todoistSyncSession.getStatus(); }
  async getFailures(): Promise<TodoistSyncFailure[]> { return await (await todoistSyncSession.getRepositoryAsync()).getFailures(); }
  async requestSync(): Promise<void> { todoistSyncSession.requestSync(); }
  async retryFailed(params: { uuid: string }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).retryFailed(params.uuid); }
  async discardFailed(params: { uuid: string }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).discardFailed(params.uuid); }
}

export const todoistSyncSessionHandler = new TodoistSyncSessionHandler();
export const todoistSyncDomainHandler = new TodoistSyncDomainHandler();
export const todoistSyncTodoHandler = new TodoistSyncTodoHandler();
export const todoistSyncSubTodoHandler = new TodoistSyncSubTodoHandler();
export const todoistSyncEventHandler = new TodoistSyncEventHandler();
export const todoistSyncClockHandler = new TodoistSyncClockHandler();
export const todoistSyncStatusHandler = new TodoistSyncStatusHandler();
