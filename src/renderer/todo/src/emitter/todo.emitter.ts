import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoMcpDaoApi } from '@shared/mcp/todoMcpDao.type';

export const todoEmitter =
  createXpcRendererEmitter<TodoMcpDaoApi>('TodoistSyncTodoHandler');
