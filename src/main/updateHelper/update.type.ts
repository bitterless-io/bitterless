export interface UpdateInfo {
  version: string;
  versionCode: number;
  releaseNotes: string;
  downloadUrl: string;
}

export interface ManifestData {
  version: string;
  versionCode: number;
  uuid: string;
  downloadUrl: string;
  releaseNotes: string;
  updatedAt: string;
}

export type PlatformType = 'mac_arm' | 'mac_intel' | 'win64';
