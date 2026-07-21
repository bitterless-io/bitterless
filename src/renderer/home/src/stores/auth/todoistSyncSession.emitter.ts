import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoistSyncSessionApi } from '@shared/todoistSync/todoistSync.type';

export const todoistSyncSessionEmitter =
  createXpcRendererEmitter<TodoistSyncSessionApi>('TodoistSyncSessionHandler');
