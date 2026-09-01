'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const rootDir = path.resolve(__dirname, '..', '..');
const stableDistDir = path.join(rootDir, 'dist');

const releaseChannelConfigs = Object.freeze({
  dev: Object.freeze({
    appId: 'io.bitterless.desktop_dev',
    appName: 'Bitterless_DEV',
    distDir: stableDistDir,
    icon: 'build/icon.icns',
    productName: 'Bitterless_DEV',
    profileName: 'release_dev'
  }),
  preview: Object.freeze({
    appId: 'io.bitterless.desktop.preview',
    appName: 'Bitterless_PREVIEW',
    distDir: path.join(stableDistDir, 'preview'),
    icon: 'build/icon-preview.icns',
    productName: 'Bitterless Preview',
    profileName: 'release_preview'
  }),
  prod: Object.freeze({
    appId: 'io.bitterless.desktop',
    appName: 'Bitterless',
    distDir: stableDistDir,
    icon: 'build/icon.icns',
    productName: 'Bitterless',
    profileName: 'release_prod'
  })
});

const platformConfigs = Object.freeze({
  mac_arm: Object.freeze({
    buildArgs: ['--mac', '--arm64'],
    appOutputDir: 'mac-arm64',
    artifactExtensions: ['.dmg', '.zip', '.blockmap'],
    updaterFiles: ['latest-mac.yml'],
    requiredUpdaterArtifactExtensions: ['.zip', '.dmg']
  }),
  mac_intel: Object.freeze({
    buildArgs: ['--mac', '--x64'],
    appOutputDir: 'mac',
    artifactExtensions: ['.dmg', '.zip', '.blockmap'],
    updaterFiles: ['latest-mac.yml'],
    requiredUpdaterArtifactExtensions: ['.zip', '.dmg']
  }),
  win64: Object.freeze({
    buildArgs: ['--win', '--x64'],
    appOutputDir: 'win-unpacked',
    artifactExtensions: ['.exe', '.blockmap'],
    updaterFiles: ['latest.yml'],
    requiredUpdaterArtifactExtensions: ['.exe']
  })
});

const listFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => fs.statSync(filePath).isFile());
};

const readDistVersionInfo = (targetDistDir = stableDistDir) => {
  const versionInfoPath = path.join(targetDistDir, 'version_info.json');
  if (!fs.existsSync(versionInfoPath)) {
    throw new Error(
      `version_info.json not found: ${versionInfoPath}. Run scripts/before.js or use --build.`
    );
  }
  return JSON.parse(fs.readFileSync(versionInfoPath, 'utf-8'));
};

const releaseVersionCode = (release) => {
  return String(release.version_code ?? release.versionCode ?? '');
};

const assertLocalReleaseMatchesDist = (localPackage, distVersionInfo, expectedChannel) => {
  const packageVersion = String(localPackage.version ?? '');
  const packageVersionCode = releaseVersionCode(localPackage);
  const distVersion = String(distVersionInfo.version ?? '');
  const distVersionCode = releaseVersionCode(distVersionInfo);
  if (packageVersion !== distVersion || packageVersionCode !== distVersionCode) {
    throw new Error(
      `Stale dist release metadata: package ${packageVersion} (${packageVersionCode}), dist ${distVersion} (${distVersionCode}). Rebuild before publishing.`
    );
  }
  if (expectedChannel && distVersionInfo.channel !== expectedChannel) {
    throw new Error(
      `Stale dist release metadata: expected channel ${expectedChannel}, received ${distVersionInfo.channel ?? 'missing'}. Rebuild before publishing.`
    );
  }
};

const artifactNameMatchesVersion = (name, version) => {
  const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`-${escapedVersion}(?:[.-]|$)`).test(name);
};

const updaterArtifactName = (value) => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (
    name.length === 0 ||
    name !== value ||
    name === '.' ||
    name === '..' ||
    /[\\/?#]/.test(name) ||
    /^[a-z][a-z\d+.-]*:/i.test(name) ||
    path.basename(name) !== name
  ) {
    return null;
  }
  return name;
};

const validateUpdaterArtifacts = (platform, version, artifacts) => {
  const config = platformConfigs[platform];
  const artifactNames = new Set(artifacts.map((filePath) => path.basename(filePath)));

  for (const updaterFile of config.updaterFiles) {
    const updaterPath = artifacts.find((filePath) => path.basename(filePath) === updaterFile);
    if (!updaterPath) {
      throw new Error(`Missing updater metadata in dist: ${updaterFile}`);
    }

    let metadata;
    try {
      metadata = yaml.load(fs.readFileSync(updaterPath, 'utf-8'));
    } catch (error) {
      throw new Error(`Invalid updater metadata ${updaterFile}: ${error.message}`);
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error(`Invalid updater metadata ${updaterFile}: expected an object`);
    }
    if (String(metadata.version ?? '') !== String(version)) {
      throw new Error(
        `Updater metadata version mismatch in ${updaterFile}: expected ${version}, received ${metadata.version ?? 'missing'}`
      );
    }
    if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
      throw new Error(`Updater metadata ${updaterFile} has no files`);
    }

    const rawReferences = [metadata.path, ...metadata.files.map((file) => file?.url)];
    const references = rawReferences.map(updaterArtifactName);
    if (references.some((reference) => !reference)) {
      throw new Error(
        `Updater metadata ${updaterFile} contains an invalid artifact reference; only plain filenames are allowed`
      );
    }

    for (const requiredExtension of config.requiredUpdaterArtifactExtensions) {
      if (!references.some((name) => name.toLowerCase().endsWith(requiredExtension))) {
        throw new Error(
          `Updater metadata ${updaterFile} is missing a ${requiredExtension} artifact reference`
        );
      }
    }

    for (const reference of new Set(references)) {
      if (!artifactNames.has(reference)) {
        throw new Error(
          `Updater metadata ${updaterFile} references missing artifact: ${reference}`
        );
      }
      if (
        config.requiredUpdaterArtifactExtensions.some((extension) => {
          return reference.toLowerCase().endsWith(extension);
        })
      ) {
        const blockmapName = `${reference}.blockmap`;
        if (!artifactNames.has(blockmapName)) {
          throw new Error(
            `Updater artifact ${reference} is missing required blockmap: ${blockmapName}`
          );
        }
      }
    }
  }
};

const findArtifacts = (platform, version, targetDistDir = stableDistDir) => {
  if (!fs.existsSync(targetDistDir)) {
    throw new Error(`dist directory not found: ${targetDistDir}. Run with --build or build first.`);
  }

  const config = platformConfigs[platform];
  const files = listFiles(targetDistDir);
  const artifacts = files.filter((filePath) => {
    const name = path.basename(filePath);
    const ext = path.extname(name);
    return (
      config.updaterFiles.includes(name) ||
      (config.artifactExtensions.includes(ext) && artifactNameMatchesVersion(name, version))
    );
  });

  const missingUpdaterFiles = config.updaterFiles.filter((name) => {
    return !artifacts.some((filePath) => path.basename(filePath) === name);
  });
  if (missingUpdaterFiles.length > 0) {
    throw new Error(`Missing updater metadata in dist: ${missingUpdaterFiles.join(', ')}`);
  }

  validateUpdaterArtifacts(platform, version, artifacts);
  return artifacts.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
};

const sha512Base64 = (filePath) => {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
};

const updateLatestMacYml = (dmgPath, targetDistDir = stableDistDir) => {
  const latestPath = path.join(targetDistDir, 'latest-mac.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error(`latest-mac.yml not found: ${latestPath}`);
  }
  const latest = yaml.load(fs.readFileSync(latestPath, 'utf-8'));
  const dmgName = path.basename(dmgPath);
  const size = fs.statSync(dmgPath).size;
  const sha512 = sha512Base64(dmgPath);
  if (Array.isArray(latest.files)) {
    for (const file of latest.files) {
      if (file.url === dmgName) {
        file.sha512 = sha512;
        file.size = size;
      }
    }
  }
  if (latest.path === dmgName) {
    latest.sha512 = sha512;
  }
  fs.writeFileSync(latestPath, yaml.dump(latest, { lineWidth: 120 }), 'utf-8');
};

const findExactMacDmg = (platform, targetDistDir = stableDistDir) => {
  const versionInfo = readDistVersionInfo(targetDistDir);
  const matches = findArtifacts(platform, versionInfo.version, targetDistDir).filter(
    (filePath) => path.extname(filePath) === '.dmg'
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one DMG artifact for version ${versionInfo.version}, found ${matches.length}`
    );
  }
  return matches[0];
};

const findInstallerArtifact = (platform, artifacts) => {
  const installerExtension = platform === 'win64' ? '.exe' : '.dmg';
  const installers = artifacts.filter((filePath) => {
    return path.extname(filePath).toLowerCase() === installerExtension;
  });
  if (installers.length !== 1) {
    throw new Error(
      `Expected exactly one ${installerExtension} installer artifact, found ${installers.length}`
    );
  }
  return installers[0];
};

const createVersionInfoForUpload = (options, artifacts, targetDistDir = stableDistDir) => {
  const versionInfo = readDistVersionInfo(targetDistDir);
  const downloadUrl = `${options.publicBaseUrl}/${options.prefix}/${options.env}/${options.platform}`;
  const installerPath = findInstallerArtifact(options.platform, artifacts);
  const installerName = path.basename(installerPath);
  const uploadInfo = {
    ...versionInfo,
    channel: options.env,
    downloadUrl,
    installerName,
    installerSha512: sha512Base64(installerPath),
    installerSize: fs.statSync(installerPath).size,
    installerUrl: `${downloadUrl}/${installerName}`,
    platform: options.platform
  };

  const publishDir = path.join(targetDistDir, '.publish', options.env, options.platform);
  fs.mkdirSync(publishDir, { recursive: true });
  const publishVersionInfoPath = path.join(publishDir, 'version_info.json');
  fs.writeFileSync(publishVersionInfoPath, JSON.stringify(uploadInfo, null, 2) + os.EOL, 'utf-8');
  return publishVersionInfoPath;
};

const assertBuildIdentity = (
  releaseChannel,
  platform,
  localPackage,
  distVersionInfo,
  artifacts
) => {
  const channelConfig = releaseChannelConfigs[releaseChannel];
  if (localPackage.name !== channelConfig.appName) {
    throw new Error(
      `Package app identity does not match ${releaseChannel}: expected ${channelConfig.appName}, received ${localPackage.name ?? 'missing'}`
    );
  }
  if (distVersionInfo.channel !== releaseChannel) {
    throw new Error(
      `Dist release channel does not match ${releaseChannel}: ${distVersionInfo.channel ?? 'missing'}`
    );
  }

  const builderPath = path.join(rootDir, 'electron-builder.yml');
  if (!fs.existsSync(builderPath)) {
    throw new Error('Generated electron-builder.yml is missing; rebuild before publishing');
  }
  const builder = yaml.load(fs.readFileSync(builderPath, 'utf8'));
  const expectedOutput = releaseChannel === 'preview' ? 'dist/preview' : 'dist';
  const expectedWindowsIcon = channelConfig.icon.replace(/\.icns$/, '.ico');
  if (
    builder?.appId !== channelConfig.appId ||
    builder?.productName !== channelConfig.productName ||
    builder?.directories?.output !== expectedOutput ||
    builder?.mac?.icon !== channelConfig.icon ||
    builder?.win?.icon !== expectedWindowsIcon ||
    builder?.win?.executableName !== channelConfig.productName
  ) {
    throw new Error(`Generated Electron Builder identity does not match ${releaseChannel}`);
  }

  const installerPath = findInstallerArtifact(platform, artifacts);
  const expectedInstallerPrefix =
    releaseChannel === 'preview' ? 'Bitterless-Preview-' : `${channelConfig.productName}-`;
  if (!path.basename(installerPath).startsWith(expectedInstallerPrefix)) {
    throw new Error(
      `Installer artifact does not match ${releaseChannel}: ${path.basename(installerPath)}`
    );
  }

  const installerScript = fs.readFileSync(path.join(rootDir, 'build', 'installer.nsh'), 'utf8');
  const touchesStableShellRegistration = installerScript.includes(
    'Software\\Classes\\*\\shell\\OnlyPreview'
  );
  if (releaseChannel === 'preview' && touchesStableShellRegistration) {
    throw new Error('Preview installer must not mutate the Stable OnlyPreview shell registration');
  }
};

module.exports = {
  artifactNameMatchesVersion,
  assertBuildIdentity,
  assertLocalReleaseMatchesDist,
  createVersionInfoForUpload,
  findArtifacts,
  findExactMacDmg,
  findInstallerArtifact,
  platformConfigs,
  readDistVersionInfo,
  releaseChannelConfigs,
  releaseVersionCode,
  sha512Base64,
  stableDistDir,
  updateLatestMacYml,
  validateUpdaterArtifacts
};
