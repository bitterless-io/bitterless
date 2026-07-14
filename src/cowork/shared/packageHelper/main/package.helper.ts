import { app } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { XpcMainHandler } from 'electron-xpc/main';
import type { PackageInfo } from '../shared/packageHelper.type';

const ALLOWED_FIELDS: (keyof PackageInfo)[] = [
  'name',
  'version',
  'versionCode',
  'description',
  'repository',
  'author',
  'license',
  'homepage',
];

const DEFAULTS: Record<keyof PackageInfo, any> = {
  name: '',
  version: '',
  versionCode: 0,
  description: '',
  repository: '',
  author: '',
  license: '',
  homepage: '',
};

class PackageMainHelper extends XpcMainHandler {
  private _cached: PackageInfo | null = null;

  init(): void {
    // XpcMainHandler auto-registers methods on instantiation
    // This init() is kept for compatibility with existing code
  }

  private _pickFields(raw: Record<string, any>): PackageInfo {
    const result: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      result[key] = raw[key] ?? DEFAULTS[key];
    }
    return result as PackageInfo;
  }

  /**
   * Read package.json from app.getAppPath(), cache after first read.
   * Returns only the allowed fields.
   */
  async getPackageInfo(): Promise<PackageInfo> {
    if (this._cached) return this._cached;

    const appPath = app.getAppPath();
    const packagePath = join(appPath, 'package.json');
    const raw = JSON.parse(await readFile(packagePath, 'utf-8'));
    this._cached = this._pickFields(raw);
    return this._cached;
  }
}

export const packageMainHelper = new PackageMainHelper();
