import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import type { CodingAgentSessionApi } from '@shared/codingAgent/codingAgentSession.type';

export const codingAgentSessionEmitter = createXpcRendererEmitter<CodingAgentSessionApi>(
  'CodingAgentSessionXpcHandler'
) as CodingAgentSessionApi;

export const subscribeCodingAgentSessionChanges = (listener: (payload: unknown) => void): void => {
  xpcRenderer.subscribe('coding-agent-session/changed', (payload) => {
    listener(payload.params);
  });
};
