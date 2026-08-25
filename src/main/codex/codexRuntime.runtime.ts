import { app } from 'electron';
import { codexAuthPath, codexModelsPath, codexSettingsPath } from './codexPaths';
import { ensureCodexProxyDispatcher } from './codexProxy.service';
import {
  CodexRuntimeService,
  type CodexRuntimePiModule,
} from './codexRuntime.service';

const loadPiModule = async (): Promise<CodexRuntimePiModule> => {
  await ensureCodexProxyDispatcher(codexSettingsPath(app.getPath('userData')));
  return (await import('@earendil-works/pi-coding-agent')) as unknown as CodexRuntimePiModule;
};

export const codexRuntimeService = new CodexRuntimeService({
  authPath: () => codexAuthPath(app.getPath('userData')),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  loadPiModule,
});
