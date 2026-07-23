import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoMcpDaoApi } from '@shared/mcp/todoMcpDao.type';
import type { TodoRendererTodoApi } from '@shared/todoistSync/todoDataUpdate.shared';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';
import { emitTodoMutation } from './todoMutation.emitter';

const rendererTodoEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<TodoRendererTodoApi>(
    'TodoistSyncTodoHandler',
  ) as TodoRendererTodoApi,
  'TodoistSyncTodoHandler',
);

export const todoEmitter: TodoMcpDaoApi = {
  create: (params) => emitTodoMutation(rendererTodoEmitter.create, params),
  getByDomainId: (params) => rendererTodoEmitter.getByDomainId(params),
  getById: (params) => rendererTodoEmitter.getById(params),
  getStatusByIds: (params) => rendererTodoEmitter.getStatusByIds(params),
  update: (params) => emitTodoMutation(rendererTodoEmitter.update, params),
  updateRepeatType: (params) => emitTodoMutation(rendererTodoEmitter.updateRepeatType, params),
  updateRepeatInterval: (params) => emitTodoMutation(rendererTodoEmitter.updateRepeatInterval, params),
  completeTodo: (params) => emitTodoMutation(rendererTodoEmitter.completeTodo, params),
  uncompleteTodo: (params) => emitTodoMutation(rendererTodoEmitter.uncompleteTodo, params),
  toggleImportant: (params) => emitTodoMutation(rendererTodoEmitter.toggleImportant, params),
  hardDelete: (params) => emitTodoMutation(rendererTodoEmitter.hardDelete, params),
  moveToDomain: (params) => emitTodoMutation(rendererTodoEmitter.moveToDomain, params),
  getSortOrder: (params) => rendererTodoEmitter.getSortOrder(params),
  setSortOrder: (params) => emitTodoMutation(rendererTodoEmitter.setSortOrder, params),
  skipToCurrent: (params) => emitTodoMutation(rendererTodoEmitter.skipToCurrent, params),
};
