import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SubTodoMcpDaoApi } from '@shared/mcp/todoMcpDao.type';
import type { TodoRendererSubTodoApi } from '@shared/todoistSync/todoDataUpdate.shared';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';
import { emitTodoMutation } from './todoMutation.emitter';

const rendererSubTodoEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<TodoRendererSubTodoApi>(
    'TodoistSyncSubTodoHandler',
  ) as TodoRendererSubTodoApi,
  'TodoistSyncSubTodoHandler',
);

export const subTodoEmitter: SubTodoMcpDaoApi = {
  create: (params) => emitTodoMutation(rendererSubTodoEmitter.create, params),
  getByTodoId: (params) => rendererSubTodoEmitter.getByTodoId(params),
  getById: (params) => rendererSubTodoEmitter.getById(params),
  updateTitle: (params) => emitTodoMutation(rendererSubTodoEmitter.updateTitle, params),
  setStatus: (params) => emitTodoMutation(rendererSubTodoEmitter.setStatus, params),
  toggleStatus: (params) => emitTodoMutation(rendererSubTodoEmitter.toggleStatus, params),
  getCountByTodoId: (params) => rendererSubTodoEmitter.getCountByTodoId(params),
  getCountsByTodoIds: (params) => rendererSubTodoEmitter.getCountsByTodoIds(params),
  hardDelete: (params) => emitTodoMutation(rendererSubTodoEmitter.hardDelete, params),
};
