import { shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import type {
  DomainMcpDaoApi,
  McpDomainRow,
  McpSubTodoRow,
  McpTodoEventListResult,
  McpTodoRow,
  McpTodoStatusByIdsResult,
  RestoreDomainResult,
  SubTodoMcpDaoApi,
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
import { todoistSyncSession } from '@main/todoistSync/todoistSync.session';

export class TodoistSyncSessionHandler extends XpcMainHandler implements TodoistSyncSessionApi {
  async activate(params: TodoistSyncActivateParams): Promise<TodoistSyncActivationResult> {
    return await todoistSyncSession.activate(params);
  }

  async deactivate(): Promise<void> {
    await todoistSyncSession.deactivate();
  }
}

export class TodoistSyncDomainHandler extends XpcMainHandler implements DomainMcpDaoApi {
  async create(params: { title?: string; description?: string }): Promise<McpDomainRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).createDomain(params); }
  async getAll(): Promise<McpDomainRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getDomains(); }
  async getById(params: { id: TodoEntityId }): Promise<McpDomainRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getDomainById(params); }
  async updateTitle(params: { id: TodoEntityId; title: string }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).updateDomainTitle(params); }
  async updateDescription(params: { id: TodoEntityId; description: string }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).updateDomainDescription(params); }
  async hardDelete(params: { id: TodoEntityId }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).deleteDomain(params); }
  async setArchived(params: { id: TodoEntityId; archived: number }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).setDomainArchived(params); }
  async restore(params: { id: TodoEntityId }): Promise<RestoreDomainResult> { return await (await todoistSyncSession.getRepositoryAsync()).restoreDomain(params); }
}

export class TodoistSyncTodoHandler extends XpcMainHandler implements TodoMcpDaoApi {
  async create(params: Parameters<TodoMcpDaoApi['create']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).createTodo(params); }
  async getByDomainId(params: Parameters<TodoMcpDaoApi['getByDomainId']>[0]): Promise<McpTodoRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getTodosByDomain(params); }
  async getById(params: { id: TodoEntityId }): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getTodoById(params); }
  async getStatusByIds(params: { ids: TodoEntityId[] }): Promise<McpTodoStatusByIdsResult> { return await (await todoistSyncSession.getRepositoryAsync()).getStatusByIds(params); }
  async update(params: Parameters<TodoMcpDaoApi['update']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).updateTodo(params); }
  async updateRepeatType(params: Parameters<TodoMcpDaoApi['updateRepeatType']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).updateRepeatType(params); }
  async updateRepeatInterval(params: Parameters<TodoMcpDaoApi['updateRepeatInterval']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).updateRepeatInterval(params); }
  async completeTodo(params: Parameters<TodoMcpDaoApi['completeTodo']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).completeTodo(params); }
  async uncompleteTodo(params: Parameters<TodoMcpDaoApi['uncompleteTodo']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).uncompleteTodo(params); }
  async toggleImportant(params: Parameters<TodoMcpDaoApi['toggleImportant']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).toggleImportant(params); }
  async hardDelete(params: Parameters<TodoMcpDaoApi['hardDelete']>[0]): Promise<boolean> { return await (await todoistSyncSession.getRepositoryAsync()).deleteTodo(params.id, params.actor); }
  async moveToDomain(params: Parameters<TodoMcpDaoApi['moveToDomain']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).moveToDomain(params); }
  async getSortOrder(params: { key: string }): Promise<TodoEntityId[]> { return await (await todoistSyncSession.getRepositoryAsync()).getSortOrder(params); }
  async setSortOrder(params: { key: string; order: TodoEntityId[] }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).setSortOrder(params); }
  async skipToCurrent(params: Parameters<TodoMcpDaoApi['skipToCurrent']>[0]): Promise<McpTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).skipToCurrent(params); }
}

export class TodoistSyncSubTodoHandler extends XpcMainHandler implements SubTodoMcpDaoApi {
  async create(params: Parameters<SubTodoMcpDaoApi['create']>[0]): Promise<McpSubTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).createSubTodo(params); }
  async getByTodoId(params: { todoId: TodoEntityId }): Promise<McpSubTodoRow[]> { return await (await todoistSyncSession.getRepositoryAsync()).getSubTodosByTodoId(params); }
  async getById(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).getSubTodoById(params); }
  async updateTitle(params: { id: TodoEntityId; title: string }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).updateSubTodoTitle(params); }
  async toggleStatus(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined> { return await (await todoistSyncSession.getRepositoryAsync()).toggleSubTodoStatus(params); }
  async getCountByTodoId(params: { todoId: TodoEntityId }): Promise<{ total: number; done: number }> { return await (await todoistSyncSession.getRepositoryAsync()).getCountByTodoId(params); }
  async getCountsByTodoIds(params: { todoIds: TodoEntityId[] }): Promise<Record<TodoEntityId, { total: number; done: number }>> { return await (await todoistSyncSession.getRepositoryAsync()).getCountsByTodoIds(params); }
  async hardDelete(params: { id: TodoEntityId }): Promise<void> { await (await todoistSyncSession.getRepositoryAsync()).deleteSubTodo(params); }
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
