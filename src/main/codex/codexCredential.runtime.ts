import { app, shell } from 'electron';
import { createCodexBrowserCallbackCapture } from './codexCallbackCapture';
import {
  CodexCredentialService,
  type PiAuthModule,
} from './codexCredential.service';
import { codexAuthPath, codexModelsPath } from './codexPaths';

const loadPiAuthModule = async (): Promise<PiAuthModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule;

export const codexCredentialService = new CodexCredentialService({
  authPath: () => codexAuthPath(app.getPath('userData')),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  loadPiAuthModule,
  openExternal: async (url) => await shell.openExternal(url),
  createBrowserCallbackCapture: async () =>
    await createCodexBrowserCallbackCapture({
      onUnavailable: (message) => {
        console.info('[codex auth] IPv6 callback capture unavailable:', message);
      },
    }),
});
