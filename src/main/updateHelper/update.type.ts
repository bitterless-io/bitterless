export interface UpdateInfo {
  version: string;
  versionCode: string;
  releaseNotes: string;
  downloadUrl: string;
}

export interface ManifestData {
  version: string;
  versionCode: string;
  uuid: string;
  downloadUrl: string;
  releaseNotes: string;
  updatedAt: string;
  channel?: ReleaseChannel;
  platform?: PlatformType;
  installerName?: string;
  installerUrl?: string;
  installerSize?: number;
  installerSha512?: string;
}

export type UpdateCheckStatus = 'available' | 'latest' | 'disabled' | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersionCode: string;
  info?: UpdateInfo;
  error?: string;
}

export type PlatformType = 'mac_arm' | 'mac_intel' | 'win64';
export type ReleaseChannel = 'dev' | 'prod' | 'preview';
