import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import type { EyesOnAgentsApi } from '@shared/eyesOnAgents/eyesOnAgents.type';

export const eyesOnAgentsEmitter = createXpcRendererEmitter<EyesOnAgentsApi>(
  'EyesOnAgentsHandler',
) as EyesOnAgentsApi;

let subscribed = false;

export const subscribeEyesOnAgentsChanges = (listener: () => void): void => {
  if (subscribed) return;
  subscribed = true;
  xpcRenderer.subscribe('eyes-on-agents/changed', () => listener());
};
