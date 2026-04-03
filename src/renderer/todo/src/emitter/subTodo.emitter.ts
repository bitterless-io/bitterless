import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SubTodoDao } from '@preload/sqlite/dao/subTodo.dao';

export const subTodoEmitter = createXpcRendererEmitter<SubTodoDao>('SubTodoDao');
