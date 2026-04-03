import type { ExtraResourceApi } from '@preload/home/home.preload';

export const extraResource = (globalThis as any).extraResource as ExtraResourceApi;
