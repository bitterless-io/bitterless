import type { ManifestData, PlatformType, ReleaseChannel } from './update.type';

const RELEASE_BASE_URL = 'https://assets.terncloud.com/bitterless/distro';

export const resolveUpdateDirectory = (
  releaseChannel: ReleaseChannel,
  platform: PlatformType
): string => `${RELEASE_BASE_URL}/${releaseChannel}/${platform}`;

const assertInstallerUrl = (installerUrl: string, expectedDirectory: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(installerUrl);
  } catch {
    throw new Error('Update manifest installerUrl is invalid');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !installerUrl.startsWith(`${expectedDirectory}/`) ||
    installerUrl.slice(expectedDirectory.length + 1).includes('/')
  ) {
    throw new Error('Update manifest installerUrl is outside the selected release channel');
  }
};

export const assertManifestReleaseChannel = (
  manifest: ManifestData,
  releaseChannel: ReleaseChannel,
  platform: PlatformType
): void => {
  const expectedDirectory = resolveUpdateDirectory(releaseChannel, platform);
  if (manifest.downloadUrl !== expectedDirectory) {
    throw new Error(
      `Update manifest downloadUrl must equal the selected ${releaseChannel}/${platform} directory`
    );
  }
  if (manifest.channel !== undefined && manifest.channel !== releaseChannel) {
    throw new Error('Update manifest channel does not match the running application');
  }
  if (manifest.platform !== undefined && manifest.platform !== platform) {
    throw new Error('Update manifest platform does not match the running application');
  }

  if (releaseChannel === 'preview') {
    if (manifest.channel !== releaseChannel || manifest.platform !== platform) {
      throw new Error('Preview update manifest must declare its exact channel and platform');
    }
    if (typeof manifest.installerUrl !== 'string') {
      throw new Error('Preview update manifest must declare installerUrl');
    }
  }
  if (manifest.installerUrl !== undefined) {
    assertInstallerUrl(manifest.installerUrl, expectedDirectory);
  }
};
