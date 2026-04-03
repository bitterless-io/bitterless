import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { SettingDao } from '../sqlite/dao/setting.dao';
import type { PathMainHelper } from '../../shared/pathHelper/main/pathMain.helper';

const requiredExtraResources = {
  'chrome-macarm': '2026032803',
  'chrome-mac': '2026032803',
  'chrome-win': '2026032803'
};

interface ExtraResourceManifest {
  [key: string]: string;
}

class ExtraResourceHelper {
  private settingDaoEmitter = createXpcPreloadEmitter<SettingDao>('SettingDao');
  private pathMainHelperEmitter = createXpcPreloadEmitter<PathMainHelper>('PathMainHelper');

  async checkNeedsExtract(): Promise<boolean> {
    try {
      console.log('[ExtraResourceHelper] Checking if extraction is needed...');

      const userDataPath = await this.pathMainHelperEmitter.getUserDataPath();
      const extraDir = path.join(userDataPath, 'extra');

      if (!fs.existsSync(extraDir)) {
        console.log('[ExtraResourceHelper] Extra directory does not exist, extraction needed');
        return true;
      }

      const platform = process.platform;
      const arch = process.arch;

      for (const resourceName of Object.keys(requiredExtraResources)) {
        if (platform === 'darwin') {
          const expectedResource = arch === 'arm64' ? 'chrome-macarm' : 'chrome-mac';
          if (resourceName !== expectedResource) continue;
        }
        if (platform === 'win32' && resourceName !== 'chrome-win') continue;

        const resourcePath = path.join(extraDir, resourceName);

        if (!fs.existsSync(resourcePath)) {
          console.log(`[ExtraResourceHelper] ${resourceName} does not exist in extra directory, extraction needed`);
          return true;
        }
      }

      const manifest = await this.settingDaoEmitter.get<ExtraResourceManifest>({
        key: 'extra_resource_manifest'
      });

      console.log('[ExtraResourceHelper] Current manifest:', manifest);

      for (const [resourceName, requiredVersion] of Object.entries(requiredExtraResources)) {
        const currentVersion = manifest?.[resourceName];

        if (!currentVersion || currentVersion < requiredVersion) {
          console.log(`[ExtraResourceHelper] ${resourceName} needs update: ${currentVersion || 'none'} -> ${requiredVersion}`);
          return true;
        }
      }

      console.log('[ExtraResourceHelper] All resources are up to date');
      return false;
    } catch (err) {
      console.error('[ExtraResourceHelper] Error checking resources:', err);
      return true;
    }
  }

  async startExtract(): Promise<void> {
    try {
      console.log('[ExtraResourceHelper] Starting extraction...');

      const userDataPath = await this.pathMainHelperEmitter.getUserDataPath();
      const extraDir = path.join(userDataPath, 'extra');

      if (!fs.existsSync(extraDir)) {
        fs.mkdirSync(extraDir, { recursive: true });
        console.log(`[ExtraResourceHelper] Created directory: ${extraDir}`);
      }

      const manifest = await this.settingDaoEmitter.get<ExtraResourceManifest>({
        key: 'extra_resource_manifest'
      }) || {};

      let updated = false;

      const platform = process.platform;
      const arch = process.arch;

      for (const [resourceName, requiredVersion] of Object.entries(requiredExtraResources)) {
        if (platform === 'darwin') {
          const expectedResource = arch === 'arm64' ? 'chrome-macarm' : 'chrome-mac';
          if (resourceName !== expectedResource) continue;
        }
        if (platform === 'win32' && resourceName !== 'chrome-win') continue;

        const currentVersion = manifest[resourceName];

        if (!currentVersion || currentVersion < requiredVersion) {
          console.log(`[ExtraResourceHelper] Extracting ${resourceName}...`);
          await this.extractResource(resourceName, requiredVersion, extraDir);
          manifest[resourceName] = requiredVersion;
          updated = true;
        }
      }

      if (updated) {
        await this.updateManifest(manifest);
        console.log('[ExtraResourceHelper] Extraction completed and manifest updated');
      } else {
        console.log('[ExtraResourceHelper] No extraction needed');
      }
    } catch (err) {
      console.error('[ExtraResourceHelper] Error during extraction:', err);
      throw err;
    }
  }

  private async extractResource(resourceName: string, version: string, extraDir: string): Promise<void> {
    const tarFileName = `${resourceName}.tar`;
    let tarFilePath: string;

    const isRelease = import.meta.env.VITE_MODE === 'release';

    if (isRelease) {
      tarFilePath = path.join(process.resourcesPath, 'app.asar.unpacked', tarFileName);
      console.log(`[ExtraResourceHelper] Production mode - using packaged tar file`);
    } else {
      const appPath = await this.pathMainHelperEmitter.getAppPath();
      const platform = process.platform;
      const arch = process.arch;

      let platformDir = '';
      if (platform === 'darwin') {
        platformDir = arch === 'arm64' ? 'mac_arm' : 'mac_x64';
      } else if (platform === 'win32') {
        platformDir = 'win';
      }

      if (!platformDir) {
        throw new Error(`Unsupported platform: ${platform} ${arch}`);
      }

      tarFilePath = path.join(appPath, 'external_resources', 'chromium', platformDir, tarFileName);
      console.log(`[ExtraResourceHelper] Development mode - platform: ${platform}, arch: ${arch}, platformDir: ${platformDir}`);
    }

    const resourcePath = path.join(extraDir, resourceName);

    console.log(`[ExtraResourceHelper] Mode: ${isRelease ? 'production' : 'development'}`);
    console.log(`[ExtraResourceHelper] Tar file path: ${tarFilePath}`);
    console.log(`[ExtraResourceHelper] Extract to directory: ${extraDir}`);
    console.log(`[ExtraResourceHelper] Expected resource path: ${resourcePath}`);

    if (!fs.existsSync(tarFilePath)) {
      throw new Error(`Tar file not found: ${tarFilePath}`);
    }

    if (fs.existsSync(resourcePath)) {
      console.log(`[ExtraResourceHelper] Removing existing directory: ${resourcePath}`);
      fs.rmSync(resourcePath, { recursive: true, force: true });
    }

    console.log(`[ExtraResourceHelper] Extracting ${tarFileName} to ${extraDir}...`);
    await tar.extract({
      file: tarFilePath,
      cwd: extraDir,
    });

    console.log(`[ExtraResourceHelper] Successfully extracted ${resourceName}`);
  }

  private async updateManifest(manifest: ExtraResourceManifest): Promise<void> {
    await this.settingDaoEmitter.upsert({
      key: 'extra_resource_manifest',
      value: manifest
    });
    console.log('[ExtraResourceHelper] Manifest updated:', manifest);
  }
}

export const extraResourceHelper = new ExtraResourceHelper();
