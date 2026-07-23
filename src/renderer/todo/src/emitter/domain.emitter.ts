import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { DomainMcpDaoApi } from '@shared/mcp/todoMcpDao.type';
import type { TodoRendererDomainApi } from '@shared/todoistSync/todoDataUpdate.shared';
import { emitTodoMutation } from './todoMutation.emitter';

const rendererDomainEmitter = createXpcRendererEmitter<TodoRendererDomainApi>(
  'TodoistSyncDomainHandler',
) as TodoRendererDomainApi;

export const domainEmitter: DomainMcpDaoApi = {
  create: (params) => emitTodoMutation(rendererDomainEmitter.create, params),
  getAll: () => rendererDomainEmitter.getAll(),
  getById: (params) => rendererDomainEmitter.getById(params),
  updateTitle: (params) => emitTodoMutation(rendererDomainEmitter.updateTitle, params),
  updateDescription: (params) => emitTodoMutation(rendererDomainEmitter.updateDescription, params),
  hardDelete: (params) => emitTodoMutation(rendererDomainEmitter.hardDelete, params),
  setArchived: (params) => emitTodoMutation(rendererDomainEmitter.setArchived, params),
  restore: (params) => emitTodoMutation(rendererDomainEmitter.restore, params),
};
