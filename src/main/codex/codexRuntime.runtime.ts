import { app } from 'electron';
import { codexAuthPath, codexModelsPath } from './codexPaths';
import {
  CodexRuntimeService,
  type CodexRuntimePiModule,
} from './codexRuntime.service';

const loadPiModule = async (): Promise<CodexRuntimePiModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as CodexRuntimePiModule;

export const codexRuntimeService = new CodexRuntimeService({
  authPath: () => codexAuthPath(app.getPath('userData')),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  loadPiModule,
});
