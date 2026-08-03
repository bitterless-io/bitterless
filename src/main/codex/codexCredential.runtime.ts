import { execFile } from 'node:child_process';
import { app, shell } from 'electron';
import { createCodexBrowserCallbackCapture } from './codexCallbackCapture';
import {
  CodexCredentialService,
  type PiAuthModule
} from './codexCredential.service';
import { codexAuthPath, codexModelsPath } from './codexPaths';

const MACOS_OPEN_PATH = '/usr/bin/open';
const MACOS_BROWSER_LAUNCH_TIMEOUT_MS = 10_000;
const MACOS_BROWSER_CANDIDATES = [
  { name: 'chrome', bundleId: 'com.google.Chrome' },
  { name: 'safari', bundleId: 'com.apple.Safari' }
] as const;

const launchMacosBrowser = async (bundleId: string, url: string): Promise<boolean> =>
  await new Promise<boolean>((resolve) => {
    execFile(
      MACOS_OPEN_PATH,
      ['-b', bundleId, url],
      { timeout: MACOS_BROWSER_LAUNCH_TIMEOUT_MS },
      (error) => resolve(!error)
    );
  });

const openCodexExternalUrl = async (url: string): Promise<void> => {
  if (process.platform === 'darwin') {
    console.info(
      '[codex-login] attempt=runtime stage=browser-launch-started platform=darwin'
    );
    for (const browser of MACOS_BROWSER_CANDIDATES) {
      if (await launchMacosBrowser(browser.bundleId, url)) {
        console.info(
          `[codex-login] attempt=runtime stage=browser-launch-succeeded browser=${browser.name}`
        );
        return;
      }
      console.info(
        `[codex-login] attempt=runtime stage=browser-launch-unavailable browser=${browser.name}`
      );
    }
    console.info(
      '[codex-login] attempt=runtime stage=browser-launch-fallback launcher=electron'
    );
  }
  await shell.openExternal(url);
};

const loadPiAuthModule = async (): Promise<PiAuthModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule;

export const codexCredentialService = new CodexCredentialService({
  authPath: () => codexAuthPath(app.getPath('userData')),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  loadPiAuthModule,
  openExternal: openCodexExternalUrl,
  createBrowserCallbackCapture: async () =>
    await createCodexBrowserCallbackCapture({
      onUnavailable: (message) => {
        console.info('[codex auth] IPv6 callback capture unavailable:', message);
      }
    })
});
