import type { HomeEnvApi } from '@preload/home/home.preload';

export const homeEnv = (globalThis as any).homeEnv as HomeEnvApi;
