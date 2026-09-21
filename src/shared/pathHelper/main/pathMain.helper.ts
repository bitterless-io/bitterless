import { app, shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import type { PathMainHelperContract, PathName } from '../shared/pathHelper.type';
import { homeDataRoot } from './homeData';

/** Re-exported so the path helper stays the one place to look for a path. */
export { homeDataRoot, homeDataIn } from './homeData';
import * as path from 'path';
import * as fse from 'fs-extra';

export class PathMainHelper extends XpcMainHandler implements PathMainHelperContract {
  init(): void {
    // XpcMainHandler auto-registers methods on instantiation
    // This init() is kept for compatibility with existing code
  }

  /** Get the app installation path */
  async getAppPath(): Promise<string> {
    return app.getAppPath();
  }

  /** Get a special directory or file path by name */
  async getPath(params: { name: PathName }): Promise<string> {
    return app.getPath(params.name);
  }

  /** Get the user data path (e.g. Application Support on macOS, Roaming on Windows) */
  async getUserDataPath(): Promise<string> {
    return app.getPath('userData');
  }

  /**
   * Get the home-level data root (`~/.bitterless…`) — the owner-facing one, not `userData`.
   * Main-side callers want the synchronous `homeDataRoot()` from `./homeData` instead.
   */
  async getHomeDataPath(): Promise<string> {
    return homeDataRoot();
  }

  /** Open a path in the default file manager */
  async openPath(params: { path: string }): Promise<string> {
    return shell.openPath(params.path);
  }

  /** Get the Chromium executable path based on platform */
  // `| null`:下面有两条 `return null`(平台不支持、文件不存在)。maestro 侧那份同名方法本来就是
  // 这个签名,root 这份漏了 —— 不是行为变化,是把签名对齐到它一直以来的实际返回值。
  async getChromiumPath(): Promise<string | null> {
    const userDataPath = app.getPath('userData');
    const platform = process.platform;
    const arch = process.arch;

    console.log('[PathMainHelper] getChromiumPath - platform:', platform, 'arch:', arch);
    console.log('[PathMainHelper] userDataPath:', userDataPath);

    let chromiumPath: string;
    console.log('platform', platform, 'arch:', arch);
    if (platform === 'darwin') {
      const chromeName = arch === 'arm64' ? 'chrome-macarm' : 'chrome-mac';
      chromiumPath = path.join(userDataPath, 'extra', chromeName, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    } else if (platform === 'win32') {
      const appPath = app.getAppPath();
      console.log('[PathMainHelper] appPath:', appPath);
      const isRelease = import.meta.env.VITE_MODE === 'release';
      if (isRelease) {
        chromiumPath = path.join(appPath, '..', 'app.asar.unpacked', 'chrome-win', 'chrome.exe');
        console.log('[PathMainHelper] chromiumPath:', chromiumPath);
      } else {
        chromiumPath = path.join(appPath, 'asar_unpacked', 'chrome-win', 'chrome.exe');
      }
      console.log('[PathMainHelper] chromiumPath:', chromiumPath);
    } else {
      console.error('[PathMainHelper] Unsupported platform:', platform);
      return null;
    }

    console.log('[PathMainHelper] checking chromium path:', chromiumPath);

    const exists = await fse.pathExists(chromiumPath);
    if (!exists) {
      console.error('[PathMainHelper] Chromium not found at:', chromiumPath);
      const extraDir = path.join(userDataPath, 'extra');
      const extraExists = await fse.pathExists(extraDir);
      console.error('[PathMainHelper] extra directory exists:', extraExists);
      return null;
    }

    console.log('[PathMainHelper] chromium path found:', chromiumPath);
    return chromiumPath;
  }
}

export const pathMainHelper = new PathMainHelper();
