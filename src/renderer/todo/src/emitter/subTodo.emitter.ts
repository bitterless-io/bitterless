import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SubTodoMcpDaoApi } from '@shared/mcp/todoMcpDao.type';

export const subTodoEmitter =
  createXpcRendererEmitter<SubTodoMcpDaoApi>('TodoistSyncSubTodoHandler');
