#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { listPackage } = require('@electron/asar');

const MIB = 1024 * 1024;
const DEFAULT_MAX_ASAR_BYTES = 220 * MIB;
const DEFAULT_MAX_APP_BYTES = 650 * MIB;

const BANNED_PACKAGES = Object.freeze([
  '@arco-design/web-vue',
  '@electron/asar',
  '@micromeet/cli',
  '@tabler/icons-vue',
  '@vueuse/core',
  'gpt-tokenizer',
  'jsdom',
  'jsonc-parser',
  'katex',
  'markstream-vue',
  'monaco-editor',
  'quill',
  'shiki',
  'splitpanes',
  'stream-markdown',
  'stream-monaco',
  'vue-i18n',
  'vue-router',
  'vuedraggable',
  'xterm',
  'youtube-dl-exec',
]);

const formatMiB = (bytes) => (bytes / MIB).toFixed(2);

const getPathSize = (targetPath) => {
  const stats = fs.lstatSync(targetPath);
  let totalBytes = stats.size;
  if (stats.isSymbolicLink() || !stats.isDirectory()) return totalBytes;

  for (const entry of fs.readdirSync(targetPath)) {
    totalBytes += getPathSize(path.join(targetPath, entry));
  }
  return totalBytes;
};

const getResourcesPath = (applicationPath) => {
  const candidates = [
    path.join(applicationPath, 'Contents', 'Resources'),
    path.join(applicationPath, 'resources'),
  ].filter((candidate) => {
    try {
      return fs.lstatSync(path.join(candidate, 'app.asar')).isFile();
    } catch {
      return false;
    }
  });

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one Resources directory containing app.asar under ${applicationPath}; found ${candidates.length}`,
    );
  }
  return candidates[0];
};

const hasPackagedResources = (candidate) => {
  try {
    getResourcesPath(candidate);
    return true;
  } catch {
    return false;
  }
};

const resolveApplicationPath = (inputPath) => {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('A packaged application path is required');
  }

  const resolved = path.resolve(inputPath);
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Packaged application path must be a real directory: ${resolved}`);
  }
  if (hasPackagedResources(resolved)) return resolved;

  const applications = fs.readdirSync(resolved)
    .filter((entry) => entry.endsWith('.app'))
    .map((entry) => path.join(resolved, entry))
    .filter((candidate) => {
      const candidateStats = fs.lstatSync(candidate);
      return !candidateStats.isSymbolicLink()
        && candidateStats.isDirectory()
        && hasPackagedResources(candidate);
    });

  if (applications.length !== 1) {
    throw new Error(
      `Expected exactly one packaged application under ${resolved}; found ${applications.length}`,
    );
  }
  return applications[0];
};

const validateLimit = (name, value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const packageRoot = (packageName) => `/node_modules/${packageName}`;

const packageIsPresent = (entries, packageName) => {
  const root = packageRoot(packageName);
  return entries.some((entry) => entry === root || entry.startsWith(`${root}/`));
};

const auditDesktopPackage = (inputPath, options = {}) => {
  const maxAsarBytes = options.maxAsarBytes ?? DEFAULT_MAX_ASAR_BYTES;
  const maxAppBytes = options.maxAppBytes ?? DEFAULT_MAX_APP_BYTES;
  validateLimit('maxAsarBytes', maxAsarBytes);
  validateLimit('maxAppBytes', maxAppBytes);

  const applicationPath = resolveApplicationPath(inputPath);
  const resourcesPath = getResourcesPath(applicationPath);
  const asarPath = path.join(resourcesPath, 'app.asar');
  const asarStats = fs.lstatSync(asarPath);
  if (asarStats.isSymbolicLink() || !asarStats.isFile()) {
    throw new Error(`app.asar must be a real file: ${asarPath}`);
  }

  const asarBytes = asarStats.size;
  const appBytes = getPathSize(applicationPath);
  console.log(
    `[desktop-package-audit] app.asar ${formatMiB(asarBytes)} MiB (${asarBytes} bytes; limit ${formatMiB(maxAsarBytes)} MiB)`,
  );
  console.log(
    `[desktop-package-audit] application ${formatMiB(appBytes)} MiB (${appBytes} bytes; limit ${formatMiB(maxAppBytes)} MiB)`,
  );

  let archiveEntries;
  try {
    archiveEntries = listPackage(asarPath);
  } catch (error) {
    throw new Error(`Could not inspect app.asar: ${error.message}`);
  }
  if (!Array.isArray(archiveEntries)) {
    throw new Error('Could not inspect app.asar: @electron/asar returned a non-array entry list');
  }

  const presentBannedPackages = BANNED_PACKAGES.filter((packageName) => {
    return packageIsPresent(archiveEntries, packageName);
  });
  const failures = [];
  if (asarBytes > maxAsarBytes) {
    failures.push(
      `app.asar is ${formatMiB(asarBytes)} MiB, above the ${formatMiB(maxAsarBytes)} MiB limit`,
    );
  }
  if (appBytes > maxAppBytes) {
    failures.push(
      `application is ${formatMiB(appBytes)} MiB, above the ${formatMiB(maxAppBytes)} MiB limit`,
    );
  }
  if (presentBannedPackages.length > 0) {
    failures.push(`app.asar contains banned package roots: ${presentBannedPackages.join(', ')}`);
  }
  if (failures.length > 0) {
    throw new Error(`[desktop-package-audit] FAILED\n- ${failures.join('\n- ')}`);
  }

  console.log('[desktop-package-audit] PASS');
  return {
    applicationPath,
    asarPath,
    asarBytes,
    appBytes,
  };
};

const parseCliAppPath = (args) => {
  let appPath;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg !== '--app') throw new Error(`Unknown argument: ${arg}`);
    if (appPath !== undefined) throw new Error('--app may only be provided once');
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('--app requires a path');
    appPath = value;
  }
  if (!appPath) {
    throw new Error('Usage: node scripts/package/desktopPackage.audit.cjs --app <application-path>');
  }
  return appPath;
};

const afterPack = async (context) => {
  if (!context || typeof context.appOutDir !== 'string') {
    throw new Error('[desktop-package-audit] Electron Builder context is missing appOutDir');
  }
  auditDesktopPackage(context.appOutDir);
};

if (require.main === module) {
  try {
    auditDesktopPackage(parseCliAppPath(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = afterPack;
module.exports.BANNED_PACKAGES = BANNED_PACKAGES;
module.exports.DEFAULT_MAX_APP_BYTES = DEFAULT_MAX_APP_BYTES;
module.exports.DEFAULT_MAX_ASAR_BYTES = DEFAULT_MAX_ASAR_BYTES;
module.exports.auditDesktopPackage = auditDesktopPackage;
module.exports.getPathSize = getPathSize;
module.exports.packageIsPresent = packageIsPresent;
module.exports.resolveApplicationPath = resolveApplicationPath;
