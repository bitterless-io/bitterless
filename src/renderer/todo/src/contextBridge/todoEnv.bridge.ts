import type { TodoEnvApi } from '@preload/todo/todo.preload';

export const todoEnv = (globalThis as any).todoEnv as TodoEnvApi;
