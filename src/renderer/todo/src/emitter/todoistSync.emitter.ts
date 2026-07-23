import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type {
  TodoistSyncClockApi,
  TodoistSyncStatusApi,
} from '@shared/todoistSync/todoistSync.type';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

export const todoistSyncClockEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<TodoistSyncClockApi>('TodoistSyncClockHandler'),
  'TodoistSyncClockHandler',
);

export const todoistSyncStatusEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<TodoistSyncStatusApi>('TodoistSyncStatusHandler'),
  'TodoistSyncStatusHandler',
);
