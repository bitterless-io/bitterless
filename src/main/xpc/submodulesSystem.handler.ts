// The two OS capabilities the Submodules mini app cannot own itself: the native directory dialog,
// and handing a submodule directory to the WebStorm instance the owner already has running.
import { BrowserWindow, dialog } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { execFile, execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SubmodulesOpenResult, SubmodulesSystemApi } from '@shared/submodules/submodules.type';

const WEBSTORM_PROCESS_PATTERN = /(\/.*?WebStorm\.app)\/Contents\/MacOS\/webstorm/;
const WINDOWS_LAUNCHERS = ['webstorm64.exe', 'webstorm.exe'] as const;

const failure = (
  errorCode: NonNullable<SubmodulesOpenResult['errorCode']>
): SubmodulesOpenResult => ({ ok: false, via: null, errorCode });

const success = (via: NonNullable<SubmodulesOpenResult['via']>): SubmodulesOpenResult => ({
  ok: true,
  via,
  errorCode: null
});

/**
 * The launcher of the *running* installation is the only route that reuses the open IDE: a Toolbox
 * shell script runs `open -na` (forced new instance) and can even point at another version, and
 * plain `open -a` goes through LaunchServices, which also opens a second window.
 */
const resolveRunningWebStormLauncher = (): string | null => {
  if (process.platform !== 'darwin') return null;
  let processList = '';
  try {
    processList = execFileSync('ps', ['-Ao', 'command='], { encoding: 'utf8' });
  } catch {
    return null;
  }
  for (const line of processList.split('\n')) {
    const match = WEBSTORM_PROCESS_PATTERN.exec(line);
    if (match) return `${match[1]}/Contents/MacOS/webstorm`;
  }
  return null;
};

const runLauncher = (command: string, args: readonly string[]): Promise<boolean> =>
  new Promise((resolveLaunch) => {
    execFile(command, [...args], (error) => resolveLaunch(!error));
  });

class SubmodulesSystemHandler extends XpcMainHandler implements SubmodulesSystemApi {
  async chooseDirectory(): Promise<{ path: string | null }> {
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      title: 'Open a directory that declares Git submodules',
      properties: ['openDirectory' as const]
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return { path: null };
    return { path: result.filePaths[0] ?? null };
  }

  async openInWebStorm(params: { path: string }): Promise<SubmodulesOpenResult> {
    const target = params?.path;
    if (typeof target !== 'string' || !target.trim() || !isAbsolute(target)) {
      return failure('path-invalid');
    }
    try {
      if (!statSync(target).isDirectory()) return failure('path-missing');
    } catch {
      return failure('path-missing');
    }

    if (process.platform === 'darwin') {
      const launcher = resolveRunningWebStormLauncher();
      if (launcher && (await runLauncher(launcher, [target]))) return success('running-instance');
      if (await runLauncher('open', ['-a', 'WebStorm', target])) return success('launch-services');
      return failure('ide-not-found');
    }

    for (const launcher of WINDOWS_LAUNCHERS) {
      if (await runLauncher(launcher, [target])) return success('path-launcher');
    }
    return failure('ide-not-found');
  }
}

export const submodulesSystemHandler = new SubmodulesSystemHandler();
export type { SubmodulesSystemHandler };
