import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import { setUpdateRestart } from '../app.main';
import { xpcMain } from 'electron-xpc/main';
import * as fs from 'fs';
import * as path from 'path';
import type { UpdateInfo, ManifestData, PlatformType } from './update.type';

class UpdateService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentVersionCode: number;
  private platform: PlatformType;
  private viteEnv: string;
  private viteMode: string;
  private isDownloading = false;
  private updateAvailable = false;

  constructor() {
    this.currentVersionCode = this.getCurrentVersionCode();
    this.platform = this.detectPlatform();
    this.viteEnv = import.meta.env.VITE_ENV || 'dev';
    this.viteMode = import.meta.env.VITE_MODE || 'debug';

    this.setupAutoUpdater();
  }

  private getCurrentVersionCode(): number {
    const appPath = app.getAppPath();
    const packagePath = path.join(appPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return packageJson.versionCode || 0;
  }

  private detectPlatform(): PlatformType {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin') {
      return arch === 'arm64' ? 'mac_arm' : 'mac_intel';
    } else if (platform === 'win32') {
      return 'win64';
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  private getManifestUrl(): string {
    const baseUrl = 'https://assets.terncloud.com/bitterless/distro';
    return `${baseUrl}/${this.viteEnv}/${this.platform}/manifest.json`;
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('error', (error) => {
      console.error('[UpdateService] Error:', error);
    });

    autoUpdater.on('checking-for-update', () => {
      console.log('[UpdateService] Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[UpdateService] Update available:', info);
      this.updateAvailable = true;
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[UpdateService] Update not available:', info);
      this.updateAvailable = false;
    });

    autoUpdater.on('download-progress', (progressObj) => {
      console.log(`[UpdateService] Download progress: ${progressObj.percent}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[UpdateService] Update downloaded:', info);
      this.isDownloading = false;

      this.notifyUpdateReady({
        version: info.version,
        versionCode: 0,
        releaseNotes: info.releaseNotes as string || '',
        downloadUrl: ''
      });
    });
  }

  private async fetchManifest(): Promise<ManifestData | null> {
    try {
      const manifestUrl = this.getManifestUrl();
      console.log('[UpdateService] Fetching manifest from:', manifestUrl);

      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.error('[UpdateService] Failed to fetch manifest:', response.status);
        return null;
      }

      const manifest: ManifestData = await response.json();
      return manifest;
    } catch (error) {
      console.error('[UpdateService] Error fetching manifest:', error);
      return null;
    }
  }

  private constructUpdateEndpoint(downloadUrl: string): string {
    if (this.platform === 'mac_arm' || this.platform === 'mac_intel') {
      return `${downloadUrl}/latest-mac.yml`;
    } else if (this.platform === 'win64') {
      return `${downloadUrl}/latest.yml`;
    }
    return downloadUrl;
  }

  private async checkAndDownloadUpdate(): Promise<void> {
    if (this.isDownloading) {
      console.log('[UpdateService] Already downloading update, skipping...');
      return;
    }

    const manifest = await this.fetchManifest();
    if (!manifest) {
      return;
    }

    console.log('[UpdateService] Current versionCode:', this.currentVersionCode);
    console.log('[UpdateService] Manifest versionCode:', manifest.versionCode);

    if (manifest.versionCode > this.currentVersionCode) {
      console.log('[UpdateService] Update available, downloading...');

      const updateEndpoint = this.constructUpdateEndpoint(manifest.downloadUrl);
      console.log('[UpdateService] Update endpoint:', updateEndpoint);
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: manifest.downloadUrl
      });

      this.isDownloading = true;

      try {
        await autoUpdater.checkForUpdates();
        if (this.updateAvailable) {
          await autoUpdater.downloadUpdate();
        }
      } catch (error) {
        console.error('[UpdateService] Error during update check/download:', error);
        this.isDownloading = false;
      }
    } else {
      console.log('[UpdateService] No update available');
    }
  }

  private notifyUpdateReady(updateInfo: UpdateInfo): void {
    console.log('[UpdateService] Notifying update ready:', updateInfo);
    xpcMain.broadcast('app/updated', updateInfo);
  }

  public startPolling(): void {
    // if (this.viteMode !== 'release') {
    //   console.log('[UpdateService] Not in release mode, skipping auto-update polling');
    //   return;
    // }

    console.log('[UpdateService] Starting update polling (every 60 seconds)...');
    console.log('[UpdateService] Platform:', this.platform);
    console.log('[UpdateService] Environment:', this.viteEnv);
    console.log('[UpdateService] Mode:', this.viteMode);

    this.checkAndDownloadUpdate();

    this.pollingInterval = setInterval(() => {
      this.checkAndDownloadUpdate();
    }, 60000);
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[UpdateService] Stopped update polling');
    }
  }

  public async manualCheck(): Promise<void> {
    console.log('[UpdateService] Manual update check triggered');
    await this.checkAndDownloadUpdate();
  }

  public quitAndInstall(): void {
    console.log('[UpdateService] Quitting and installing update...');
    setUpdateRestart();
    autoUpdater.quitAndInstall(true, true);
  }
}

export const updateService = new UpdateService();
