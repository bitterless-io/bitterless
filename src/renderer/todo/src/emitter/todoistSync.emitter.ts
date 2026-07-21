import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type {
  TodoistSyncClockApi,
  TodoistSyncStatusApi,
} from '@shared/todoistSync/todoistSync.type';

export const todoistSyncClockEmitter =
  createXpcRendererEmitter<TodoistSyncClockApi>('TodoistSyncClockHandler');

export const todoistSyncStatusEmitter =
  createXpcRendererEmitter<TodoistSyncStatusApi>('TodoistSyncStatusHandler');
