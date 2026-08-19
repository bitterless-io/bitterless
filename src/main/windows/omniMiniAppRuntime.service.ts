import type { OmniMiniAppId } from '@shared/omni/omni.types';

export interface OmniMiniAppRuntime {
  preloadFile: string;
  rendererName: string;
  sandbox: boolean;
}

export const OMNI_MINI_APP_RUNTIME: Readonly<Record<OmniMiniAppId, OmniMiniAppRuntime>> = {
  todo: { preloadFile: 'todo.js', rendererName: 'todo', sandbox: false },
  eyesOnAgents: {
    preloadFile: 'eyesOnAgents.js',
    rendererName: 'eyesOnAgents',
    sandbox: false,
  },
  translator: { preloadFile: 'translator.js', rendererName: 'translator', sandbox: false },
  motto: { preloadFile: 'motto.js', rendererName: 'motto', sandbox: false },
  trench: { preloadFile: 'trench.js', rendererName: 'coin', sandbox: true },
  submodules: { preloadFile: 'submodules.js', rendererName: 'submodules', sandbox: false },
};
