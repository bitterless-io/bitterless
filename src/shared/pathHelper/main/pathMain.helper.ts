import { app, shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import type { PathName } from '../shared/pathHelper.type';
import * as path from 'path';
import * as fse from 'fs-extra';

export class PathMainHelper extends XpcMainHandler {
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

  /** Open a path in the default file manager */
  async openPath(params: { path: string }): Promise<string> {
    return shell.openPath(params.path);
  }

  /** Get the Chromium executable path based on platform */
  async getChromiumPath(): Promise<string> {
    const userDataPath = app.getPath('userData');
    const platform = process.platform;
    const arch = process.arch;

    console.log('[PathMainHelper] getChromiumPath - platform:', platform, 'arch:', arch);
    console.log('[PathMainHelper] userDataPath:', userDataPath);

    let chromiumPath: string;

    if (platform === 'darwin') {
      const chromeName = arch === 'arm64' ? 'chrome-macarm' : 'chrome-mac';
      chromiumPath = path.join(userDataPath, 'extra', chromeName, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    } else if (platform === 'win32') {
      chromiumPath = path.join(userDataPath, 'extra', 'chrome-win', 'chrome.exe');
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
