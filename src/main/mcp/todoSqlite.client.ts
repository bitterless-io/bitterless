import { createXpcMainEmitter } from 'electron-xpc/main';
import type {
  DomainMcpDaoApi,
  McpTodoEventActor,
  SubTodoMcpDaoApi,
  TodoEntityId,
  TodoEventMcpDaoApi,
  TodoMcpDaoApi,
} from '@shared/mcp/todoMcpDao.type';
import type {
  TodoistSyncDomainApi,
  TodoistSyncSubTodoApi,
  TodoistSyncTodoApi,
} from '@shared/todoistSync/todoDataUpdate.shared';

const domainEmitter =
  createXpcMainEmitter<TodoistSyncDomainApi>('TodoistSyncDomainHandler');
const todoEmitter =
  createXpcMainEmitter<TodoistSyncTodoApi>('TodoistSyncTodoHandler');
const subTodoEmitter =
  createXpcMainEmitter<TodoistSyncSubTodoApi>('TodoistSyncSubTodoHandler');
const eventEmitter =
  createXpcMainEmitter<TodoEventMcpDaoApi>('TodoistSyncEventHandler');

const fromMcp = <Params>(params: Params): { originRendererId: null; params: Params } => ({
  originRendererId: null,
  params,
});

export const todoSqliteClient = {
  getDomains: () => domainEmitter.getAll(),
  getDomainById: (params: Parameters<DomainMcpDaoApi['getById']>[0]) =>
    domainEmitter.getById(params),
  createDomain: (params: Parameters<DomainMcpDaoApi['create']>[0]) =>
    domainEmitter.create(fromMcp(params)),
  updateDomainDescription: (
    params: Parameters<DomainMcpDaoApi['updateDescription']>[0],
  ) => domainEmitter.updateDescription(fromMcp(params)),

  getTodosByDomain: (params: Parameters<TodoMcpDaoApi['getByDomainId']>[0]) =>
    todoEmitter.getByDomainId(params),
  getTodoById: (params: Parameters<TodoMcpDaoApi['getById']>[0]) =>
    todoEmitter.getById(params),
  getStatusByIds: (params: Parameters<TodoMcpDaoApi['getStatusByIds']>[0]) =>
    todoEmitter.getStatusByIds(params),
  createTodo: (params: Parameters<TodoMcpDaoApi['create']>[0]) =>
    todoEmitter.create(fromMcp(params)),
  updateTodo: (params: Parameters<TodoMcpDaoApi['update']>[0]) =>
    todoEmitter.update(fromMcp(params)),
  completeTodo: (params: Parameters<TodoMcpDaoApi['completeTodo']>[0]) =>
    todoEmitter.completeTodo(fromMcp(params)),
  uncompleteTodo: (params: Parameters<TodoMcpDaoApi['uncompleteTodo']>[0]) =>
    todoEmitter.uncompleteTodo(fromMcp(params)),
  deleteTodo: (id: TodoEntityId, actor: McpTodoEventActor) =>
    todoEmitter.hardDelete(fromMcp({ id, actor })),
  moveToDomain: (params: Parameters<TodoMcpDaoApi['moveToDomain']>[0]) =>
    todoEmitter.moveToDomain(fromMcp(params)),

  getSubTodosByTodoId: (params: Parameters<SubTodoMcpDaoApi['getByTodoId']>[0]) =>
    subTodoEmitter.getByTodoId(params),
  getSubTodoById: (params: Parameters<SubTodoMcpDaoApi['getById']>[0]) =>
    subTodoEmitter.getById(params),
  createSubTodo: (params: Parameters<SubTodoMcpDaoApi['create']>[0]) =>
    subTodoEmitter.create(fromMcp(params)),
  updateSubTodoTitle: (params: Parameters<SubTodoMcpDaoApi['updateTitle']>[0]) =>
    subTodoEmitter.updateTitle(fromMcp(params)),
  setSubTodoStatus: (params: Parameters<SubTodoMcpDaoApi['setStatus']>[0]) =>
    subTodoEmitter.setStatus(fromMcp(params)),
  deleteSubTodo: (params: Parameters<SubTodoMcpDaoApi['hardDelete']>[0]) =>
    subTodoEmitter.hardDelete(fromMcp(params)),

  listAfter: (params: Parameters<TodoEventMcpDaoApi['listAfter']>[0]) =>
    eventEmitter.listAfter(params),
};
