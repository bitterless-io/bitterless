// The two OS capabilities the Submodules mini app cannot own itself: the native directory dialog,
// and revealing a submodule inside the WebStorm instance the owner already has running.
import { BaseWindow, dialog } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { planIdeReveal } from '@main/submodules/ideReveal.service';
import type { SubmodulesOpenResult, SubmodulesSystemApi } from '@shared/submodules/submodules.type';

const WEBSTORM_PROCESS_PATTERN = /(\/.*?WebStorm\.app)\/Contents\/MacOS\/webstorm/;
const MACOS_DEFAULT_LAUNCHER = '/Applications/WebStorm.app/Contents/MacOS/webstorm';
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

/**
 * Nothing running means a cold start, and the launcher is still the right route there: only it
 * accepts the `<project> <file>` pair, so the workspace opens *and* the submodule is revealed in one
 * step. LaunchServices cannot carry the file and is the last resort.
 */
const resolveWebStormLauncher = (): string | null =>
  resolveRunningWebStormLauncher() ??
  (existsSync(MACOS_DEFAULT_LAUNCHER) ? MACOS_DEFAULT_LAUNCHER : null);

const isAbsolutePath = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && isAbsolute(value);

const isExistingDirectory = (value: string): boolean => {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const runLauncher = (command: string, args: readonly string[]): Promise<boolean> =>
  new Promise((resolveLaunch) => {
    execFile(command, [...args], (error) => resolveLaunch(!error));
  });

class SubmodulesSystemHandler extends XpcMainHandler implements SubmodulesSystemApi {
  async chooseDirectory(): Promise<{ path: string | null }> {
    // Omni is a BaseWindow, so resolving the focused window as a BrowserWindow would drop the
    // parent and open an unattached dialog for an embedded Submodules cell.
    const parent = BaseWindow.getFocusedWindow();
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

  /**
   * Reveal, never open: the workspace root is the only project the IDE is asked to own, and the
   * submodule is located inside it by opening one of its files (see `ideReveal.service.ts`). Passing
   * the submodule directory instead is what made the IDE spawn a second project window.
   */
  async openInWebStorm(params: { rootPath: string; path: string }): Promise<SubmodulesOpenResult> {
    const rootPath = params?.rootPath;
    const target = params?.path;
    if (!isAbsolutePath(rootPath) || !isAbsolutePath(target)) return failure('path-invalid');
    if (!isExistingDirectory(rootPath) || !isExistingDirectory(target)) {
      return failure('path-missing');
    }

    const plan = planIdeReveal({ rootPath, submodulePath: target });
    const via = plan.anchorPath ? 'reveal-in-project' : 'root-project';

    if (process.platform === 'darwin') {
      const launcher = resolveWebStormLauncher();
      if (launcher && (await runLauncher(launcher, plan.args))) return success(via);
      // A Toolbox-only install has no usable launcher, and LaunchServices cannot carry the anchor
      // file — so the workspace root is focused without the reveal, still never the submodule.
      if (await runLauncher('open', ['-a', 'WebStorm', rootPath]))
        return success('launch-services');
      return failure('ide-not-found');
    }

    for (const launcher of WINDOWS_LAUNCHERS) {
      if (await runLauncher(launcher, plan.args)) return success(via);
    }
    return failure('ide-not-found');
  }
}

export const submodulesSystemHandler = new SubmodulesSystemHandler();
export type { SubmodulesSystemHandler };
