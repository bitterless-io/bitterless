import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
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

      if (process.platform === 'win32') {
        console.log('[ExtraResourceHelper] Windows platform - chromium is pre-extracted in asar_unpacked, skipping check');
        return false;
      }

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

      if (process.platform === 'win32') {
        console.log('[ExtraResourceHelper] Windows platform - chromium is pre-extracted in asar_unpacked, skipping extraction');
        return;
      }

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
    const zipFileName = `${resourceName}.zip`;

    const isRelease = import.meta.env.VITE_MODE === 'release';

    let zipFilePath: string;

    if (isRelease) {
      zipFilePath = path.join(process.resourcesPath, 'app.asar.unpacked', zipFileName);
      console.log(`[ExtraResourceHelper] Production mode - using packaged zip file`);
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

      zipFilePath = path.join(appPath, 'external_resources', 'chromium', platformDir, zipFileName);
      console.log(`[ExtraResourceHelper] Development mode - platform: ${platform}, arch: ${arch}, platformDir: ${platformDir}`);
    }

    const resourcePath = path.join(extraDir, resourceName);

    console.log(`[ExtraResourceHelper] Mode: ${isRelease ? 'production' : 'development'}`);
    console.log(`[ExtraResourceHelper] Zip file path: ${zipFilePath}`);
    console.log(`[ExtraResourceHelper] Extract to directory: ${extraDir}`);
    console.log(`[ExtraResourceHelper] Expected resource path: ${resourcePath}`);

    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`Zip file not found: ${zipFilePath}`);
    }

    if (fs.existsSync(resourcePath)) {
      console.log(`[ExtraResourceHelper] Removing existing directory: ${resourcePath}`);
      fs.rmSync(resourcePath, { recursive: true, force: true });
    }

    console.log(`[ExtraResourceHelper] Extracting ${zipFileName} to ${extraDir}...`);
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(extraDir, true, true, 'Qqaazzxxcc!2');

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
