import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoDao } from '@preload/sqlite/dao/todo.dao';

export const todoEmitter = createXpcRendererEmitter<TodoDao>('TodoDao');
