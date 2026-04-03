import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { TodoWindowHandler } from '@main/xpc/todoWindow.handler';

export const todoWindowEmitter = createXpcRendererEmitter<TodoWindowHandler>('TodoWindowHandler');
