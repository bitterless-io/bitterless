import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoistSyncSessionApi } from '@shared/todoistSync/todoistSync.type';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

export const todoistSyncSessionEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<TodoistSyncSessionApi>('TodoistSyncSessionHandler'),
  'TodoistSyncSessionHandler',
);
