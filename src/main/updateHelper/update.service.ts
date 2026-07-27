import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import * as fs from 'fs';
import * as path from 'path';
import { compareVersions } from 'compare-versions';
import type { UpdateInfo, ManifestData, PlatformType, UpdateCheckResult } from './update.type';
import { UpdatePollingService } from './updatePolling.service';

type UpdaterReleaseNotes =
  | string
  | ReadonlyArray<{ readonly version: string; readonly note: string | null }>
  | null
  | undefined;

const normalizeUpdateReleaseNotes = (releaseNotes: UpdaterReleaseNotes): string => {
  if (typeof releaseNotes === 'string') return releaseNotes;
  if (!releaseNotes) return '';

  return releaseNotes
    .map(({ version, note }) => (note === null ? version : `${version}: ${note}`))
    .join('\n\n');
};

export class UpdateMetadataDisagreementError extends Error {
  constructor(currentVersionCode: string, manifestVersionCode: string) {
    super(
      `Update metadata disagreement: versionCode ${manifestVersionCode} is newer than ${currentVersionCode}, but the platform updater reported no downloadable update`
    );
    this.name = 'UpdateMetadataDisagreementError';
  }
}

class UpdateService {
  private currentVersionCode: string;
  private platform: PlatformType | null;
  private viteEnv: string;
  private viteMode: string;
  private disabledForE2E: boolean;
  private isDownloading = false;
  private readyUpdate: UpdateInfo | null = null;
  private readonly updatePollingService: UpdatePollingService<UpdateCheckResult>;
  isUpdating = false;
  constructor() {
    this.disabledForE2E = process.env.BITTERLESS_E2E === '1';
    this.currentVersionCode = this.disabledForE2E ? '0' : this.getCurrentVersionCode();
    this.platform = this.disabledForE2E ? null : this.detectPlatform();
    this.viteEnv = import.meta.env.VITE_ENV || 'dev';
    this.viteMode = import.meta.env.VITE_MODE || 'debug';

    if (!this.disabledForE2E) this.setupAutoUpdater();

    this.updatePollingService = new UpdatePollingService({
      checkForUpdates: () => this.checkAndDownloadUpdate(),
      onCheckError: (error) => {
        console.error('[UpdateService] Scheduled update check failed:', error);
      }
    });
  }

  private getCurrentVersionCode(): string {
    const appPath = app.getAppPath();
    const packagePath = path.join(appPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return String(packageJson.version_code ?? packageJson.versionCode ?? '0');
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
    return `${baseUrl}/${this.viteEnv}/${this.platform}/version_info.json`;
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
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[UpdateService] Update not available:', info);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      console.log(`[UpdateService] Download progress: ${progressObj.percent}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[UpdateService] Update downloaded:', info);

      this.notifyUpdateReady({
        version: info.version,
        versionCode: '0',
        releaseNotes: normalizeUpdateReleaseNotes(info.releaseNotes),
        downloadUrl: ''
      });
    });
  }

  private async fetchManifest(): Promise<ManifestData | null> {
    try {
      const manifestUrl = this.getManifestUrl();
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.error('[UpdateService] Failed to fetch manifest:', response.status);
        return null;
      }

      const manifest = await response.json() as ManifestData;
      const versionCode = String(manifest.versionCode);
      if (!/^\d+$/.test(versionCode)) {
        throw new Error(`Invalid update manifest versionCode: ${versionCode}`);
      }
      return {
        ...manifest,
        versionCode,
      };
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

  private async checkAndDownloadUpdate(): Promise<UpdateCheckResult> {
    if (this.disabledForE2E) {
      return { status: 'disabled', currentVersionCode: this.currentVersionCode };
    }

    const manifest = await this.fetchManifest();
    if (!manifest) {
      return {
        status: 'error',
        currentVersionCode: this.currentVersionCode,
        error: 'Failed to fetch the Bitterless update manifest'
      };
    }

    console.log('[UpdateService] Current versionCode:', this.currentVersionCode);
    console.log('[UpdateService] Manifest versionCode:', manifest.versionCode);

    if (compareVersions(manifest.versionCode, this.currentVersionCode) > 0) {
      console.log('[UpdateService] Newer release metadata found, checking platform updater...');

      const updateInfo: UpdateInfo = {
        version: manifest.version,
        versionCode: manifest.versionCode,
        releaseNotes: manifest.releaseNotes,
        downloadUrl: manifest.downloadUrl
      };

      try {
        const updateEndpoint = this.constructUpdateEndpoint(manifest.downloadUrl);
        console.log('[UpdateService] Update endpoint:', updateEndpoint);
        autoUpdater.setFeedURL({
          provider: 'generic',
          url: manifest.downloadUrl
        });

        const updateCheck = await autoUpdater.checkForUpdates();
        if (updateCheck?.isUpdateAvailable !== true) {
          throw new UpdateMetadataDisagreementError(this.currentVersionCode, manifest.versionCode);
        }

        xpcMain.broadcast('coach/update-available', updateInfo);
        this.isDownloading = true;
        try {
          await autoUpdater.downloadUpdate();
        } finally {
          this.isDownloading = false;
        }
      } catch (error) {
        console.error('[UpdateService] Error during update check/download:', error);
        return {
          status: 'error',
          currentVersionCode: this.currentVersionCode,
          info: updateInfo,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      return { status: 'available', currentVersionCode: this.currentVersionCode, info: updateInfo };
    } else {
      console.log('[UpdateService] No update available');
      return {
        status: 'latest',
        currentVersionCode: this.currentVersionCode,
        info: {
          version: manifest.version,
          versionCode: manifest.versionCode,
          releaseNotes: manifest.releaseNotes,
          downloadUrl: manifest.downloadUrl
        }
      };
    }
  }

  private notifyUpdateReady(updateInfo: UpdateInfo): void {
    console.log('[UpdateService] Notifying update ready:', updateInfo);
    this.readyUpdate = { ...updateInfo };
    xpcMain.broadcast('app/updated', updateInfo);
    xpcMain.broadcast('coach/update-downloaded', updateInfo);
  }

  public getReadyUpdate(): UpdateInfo | null {
    return this.readyUpdate ? { ...this.readyUpdate } : null;
  }

  public startPolling(): void {
    if (this.disabledForE2E) {
      console.log('[UpdateService] Disabled for isolated E2E');
      return;
    }
    // if (this.viteMode !== 'release') {
    //   console.log('[UpdateService] Not in release mode, skipping auto-update polling');
    //   return;
    // }

    if (!this.updatePollingService.startPolling()) return;

    console.log('[UpdateService] Starting update polling (every 60 seconds)...');
    console.log('[UpdateService] Platform:', this.platform);
    console.log('[UpdateService] Environment:', this.viteEnv);
    console.log('[UpdateService] Mode:', this.viteMode);
  }

  public stopPolling(): void {
    if (this.updatePollingService.stopPolling()) {
      console.log('[UpdateService] Stopped update polling');
    }
  }

  public async manualCheck(): Promise<UpdateCheckResult> {
    if (this.disabledForE2E) {
      return { status: 'disabled', currentVersionCode: this.currentVersionCode };
    }
    console.log('[UpdateService] Manual update check triggered');
    return await this.updatePollingService.checkForUpdates();
  }

  public quitAndInstall(): void {
    if (this.disabledForE2E) {
      console.warn('[UpdateService] Install ignored during isolated E2E');
      return;
    }
    this.isUpdating = true;
    console.log('[UpdateService] Requesting update install after host cleanup...');
    app.quit();
  }

  public installAfterCleanup(): void {
    if (this.disabledForE2E) {
      console.warn('[UpdateService] Post-cleanup install ignored during isolated E2E');
      return;
    }
    console.log('[UpdateService] Host cleanup complete; quitting and installing update...');
    autoUpdater.quitAndInstall(false, true);
    setTimeout(() => {
      app.exit(0);
    }, 3000);
  }
}

export const updateService = new UpdateService();
