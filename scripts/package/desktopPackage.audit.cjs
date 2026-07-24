#!/usr/bin/env node

'use strict';

const fs = require('fs');
const { builtinModules } = require('module');
const path = require('path');
const { parse } = require('acorn');
const { extractFile, listPackage } = require('@electron/asar');

const MIB = 1024 * 1024;
const DEFAULT_MAX_ASAR_BYTES = 220 * MIB;
const DEFAULT_MAX_APP_BYTES = 650 * MIB;
const BINARY_HEADER_BYTES = 64 * 1024;
const BETTER_SQLITE3_BINARY_PARTS = Object.freeze([
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3-multiple-ciphers',
  'build',
  'Release',
  'better_sqlite3.node',
]);
const ELECTRON_BUILTINS = new Set(['electron', 'original-fs']);
const NODE_BUILTINS = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')));

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

const readBinaryHeader = (filePath) => {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Binary must be a real file: ${filePath}`);
  }

  const header = Buffer.alloc(Math.min(stats.size, BINARY_HEADER_BYTES));
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
};

const readRealFile = (filePath, label) => {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
    throw new Error(`${label} must be a non-empty real file: ${filePath}`);
  }
  return fs.readFileSync(filePath);
};

const inspectIcnsFile = (filePath) => {
  const content = readRealFile(filePath, 'bundle ICNS');
  if (
    content.length < 16
    || content.subarray(0, 4).toString('ascii') !== 'icns'
    || content.readUInt32BE(4) !== content.length
  ) {
    throw new Error(`bundle ICNS header is invalid: ${filePath}`);
  }
  let offset = 8;
  let hasIconRepresentation = false;
  while (offset < content.length) {
    if (offset + 8 > content.length) {
      throw new Error(`bundle ICNS entry is truncated: ${filePath}`);
    }
    const type = content.subarray(offset, offset + 4).toString('ascii');
    const length = content.readUInt32BE(offset + 4);
    if (length <= 8 || offset + length > content.length) {
      throw new Error(`bundle ICNS ${type} entry is invalid: ${filePath}`);
    }
    if (type.startsWith('ic')) hasIconRepresentation = true;
    offset += length;
  }
  if (offset !== content.length || !hasIconRepresentation) {
    throw new Error(`bundle ICNS has no icon representation: ${filePath}`);
  }
  return filePath;
};

const inspectApplicationIcons = (resourcesPath) => {
  const bundleIcnsPath = inspectIcnsFile(path.join(resourcesPath, 'icon.icns'));
  return { bundleIcnsPath };
};

const machArchForCpuType = (cpuType) => {
  if (cpuType === 0x01000007) return 'x64';
  if (cpuType === 0x0100000c) return 'arm64';
  return undefined;
};

const peArchForMachine = (machine) => {
  if (machine === 0x8664) return 'x64';
  if (machine === 0xaa64) return 'arm64';
  return undefined;
};

const parseMachBinary = (header) => {
  if (header.length < 8) return undefined;

  const littleEndianMagic = header.readUInt32LE(0);
  const bigEndianMagic = header.readUInt32BE(0);
  let readUInt32;
  if (littleEndianMagic === 0xfeedfacf) {
    readUInt32 = (offset) => header.readUInt32LE(offset);
  } else if (bigEndianMagic === 0xfeedfacf) {
    readUInt32 = (offset) => header.readUInt32BE(offset);
  }
  if (readUInt32) {
    const arch = machArchForCpuType(readUInt32(4));
    if (!arch) throw new Error('Mach-O binary uses an unsupported CPU type');
    return { platform: 'darwin', arches: [arch], format: 'Mach-O 64-bit' };
  }

  let is64BitFat = false;
  if (bigEndianMagic === 0xcafebabe || bigEndianMagic === 0xcafebabf) {
    readUInt32 = (offset) => header.readUInt32BE(offset);
    is64BitFat = bigEndianMagic === 0xcafebabf;
  } else if (littleEndianMagic === 0xcafebabe || littleEndianMagic === 0xcafebabf) {
    readUInt32 = (offset) => header.readUInt32LE(offset);
    is64BitFat = littleEndianMagic === 0xcafebabf;
  } else {
    return undefined;
  }

  const archCount = readUInt32(4);
  const archEntryBytes = is64BitFat ? 32 : 20;
  if (archCount === 0 || archCount > 64 || 8 + archCount * archEntryBytes > header.length) {
    throw new Error('Mach-O universal binary has an invalid architecture table');
  }

  const arches = new Set();
  for (let index = 0; index < archCount; index++) {
    const cpuType = readUInt32(8 + index * archEntryBytes);
    const arch = machArchForCpuType(cpuType);
    if (!arch) throw new Error('Mach-O universal binary uses an unsupported CPU type');
    arches.add(arch);
  }
  return { platform: 'darwin', arches: [...arches].sort(), format: 'Mach-O universal' };
};

const parsePeBinary = (header) => {
  if (header.length < 0x40 || header[0] !== 0x4d || header[1] !== 0x5a) return undefined;
  const peOffset = header.readUInt32LE(0x3c);
  if (peOffset > header.length - 26) {
    throw new Error('PE binary header is truncated');
  }
  if (
    header[peOffset] !== 0x50
    || header[peOffset + 1] !== 0x45
    || header[peOffset + 2] !== 0
    || header[peOffset + 3] !== 0
  ) {
    throw new Error('PE binary signature is invalid');
  }
  const arch = peArchForMachine(header.readUInt16LE(peOffset + 4));
  if (!arch) throw new Error('PE binary uses an unsupported machine type');
  if (header.readUInt16LE(peOffset + 24) !== 0x20b) {
    throw new Error('PE binary is not PE32+');
  }
  return { platform: 'win32', arches: [arch], format: 'PE32+' };
};

const inspectBinary = (filePath) => {
  const header = readBinaryHeader(filePath);
  const binary = parseMachBinary(header) ?? parsePeBinary(header);
  if (!binary) throw new Error(`Unsupported binary format: ${filePath}`);
  return binary;
};

const findApplicationTarget = (applicationPath, resourcesPath) => {
  const isMacApplication = resourcesPath === path.join(applicationPath, 'Contents', 'Resources');
  const executableDirectory = isMacApplication
    ? path.join(applicationPath, 'Contents', 'MacOS')
    : applicationPath;
  const executableNames = fs.readdirSync(executableDirectory)
    .filter((entry) => isMacApplication || entry.toLowerCase().endsWith('.exe'));
  const candidates = [];

  for (const executableName of executableNames) {
    const executablePath = path.join(executableDirectory, executableName);
    let binary;
    try {
      binary = inspectBinary(executablePath);
    } catch {
      continue;
    }
    if (binary.platform === (isMacApplication ? 'darwin' : 'win32')) {
      candidates.push({ executablePath, ...binary });
    }
  }

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one ${isMacApplication ? 'Mach-O' : 'PE32+'} application executable; found ${candidates.length}`,
    );
  }
  const [target] = candidates;
  if (target.arches.length !== 1) {
    throw new Error(
      `Application executable must identify one target architecture; found ${target.arches.join(', ')}`,
    );
  }
  const arch = target.arches[0];
  if (target.platform === 'win32' && arch !== 'x64') {
    throw new Error(`Unsupported Windows application architecture: ${arch}`);
  }
  return {
    platform: target.platform,
    arch,
    executablePath: target.executablePath,
  };
};

const inspectBetterSqlite3Binary = (resourcesPath, target) => {
  const binaryPath = path.join(resourcesPath, ...BETTER_SQLITE3_BINARY_PARTS);
  let binary;
  try {
    binary = inspectBinary(binaryPath);
  } catch (error) {
    throw new Error(`required unpacked better_sqlite3.node is invalid: ${error.message}`);
  }
  if (binary.platform !== target.platform || !binary.arches.includes(target.arch)) {
    throw new Error(
      `unpacked better_sqlite3.node targets ${binary.platform}/${binary.arches.join('+')}, expected ${target.platform}/${target.arch}`,
    );
  }
  return binaryPath;
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

const getLiteralString = (node) => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
};

const getExternalPackageRoot = (specifier) => {
  if (
    !specifier
    || specifier.startsWith('.')
    || specifier.startsWith('/')
    || specifier.startsWith('\\\\')
    || specifier.startsWith('#')
    || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
  ) {
    return undefined;
  }

  const parts = specifier.split('/');
  const root = specifier.startsWith('@')
    ? parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
    : parts[0];
  if (!root) throw new Error(`Invalid external module specifier: ${specifier}`);
  if (ELECTRON_BUILTINS.has(root) || NODE_BUILTINS.has(root)) return undefined;
  return root;
};

const parseJavaScript = (source, archiveEntry) => {
  const options = {
    allowHashBang: true,
    ecmaVersion: 'latest',
  };
  try {
    return parse(source, { ...options, sourceType: 'script' });
  } catch {
    try {
      return parse(source, { ...options, sourceType: 'module' });
    } catch (error) {
      throw new Error(`Could not parse ${archiveEntry}: ${error.message}`);
    }
  }
};

const walkAst = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit);
    } else if (value && typeof value === 'object') {
      walkAst(value, visit);
    }
  }
};

const collectExternalPackageReferences = (asarPath, archiveEntries) => {
  const javascriptEntries = archiveEntries.filter((entry) => {
    return /^\/out\/(?:main|preload)\/.+\.js$/.test(entry);
  });
  if (javascriptEntries.length === 0) {
    throw new Error('app.asar contains no Main or Preload JavaScript to inspect');
  }

  const references = new Map();
  for (const archiveEntry of javascriptEntries) {
    let source;
    try {
      source = extractFile(asarPath, archiveEntry.slice(1)).toString('utf-8');
    } catch (error) {
      throw new Error(`Could not read ${archiveEntry}: ${error.message}`);
    }
    const ast = parseJavaScript(source, archiveEntry);
    walkAst(ast, (node) => {
      let specifier;
      if (
        node.type === 'CallExpression'
        && node.callee?.type === 'Identifier'
        && node.callee.name === 'require'
        && node.arguments.length === 1
      ) {
        specifier = getLiteralString(node.arguments[0]);
      } else if (node.type === 'ImportExpression') {
        specifier = getLiteralString(node.source);
      } else if (
        node.type === 'ImportDeclaration'
        || node.type === 'ExportAllDeclaration'
        || node.type === 'ExportNamedDeclaration'
      ) {
        specifier = getLiteralString(node.source);
      }

      if (specifier === undefined) return;
      const root = getExternalPackageRoot(specifier);
      if (!root) return;
      if (!references.has(root)) references.set(root, new Set());
      references.get(root).add(archiveEntry);
    });
  }
  return references;
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
  let applicationTarget;
  let betterSqlite3BinaryPath;
  try {
    applicationTarget = findApplicationTarget(applicationPath, resourcesPath);
    betterSqlite3BinaryPath = inspectBetterSqlite3Binary(resourcesPath, applicationTarget);
    console.log(
      `[desktop-package-audit] target ${applicationTarget.platform}/${applicationTarget.arch}; better_sqlite3.node verified`,
    );
  } catch (error) {
    failures.push(`native runtime gate failed: ${error.message}`);
  }
  let applicationIconPaths = null;
  if (applicationTarget?.platform === 'darwin') {
    try {
      applicationIconPaths = inspectApplicationIcons(resourcesPath);
      console.log('[desktop-package-audit] macOS bundle ICNS verified');
    } catch (error) {
      failures.push(`application icon gate failed: ${error.message}`);
    }
  }
  let externalPackageReferences;
  try {
    externalPackageReferences = collectExternalPackageReferences(asarPath, archiveEntries);
  } catch (error) {
    failures.push(`could not inspect packaged runtime imports: ${error.message}`);
  }
  if (externalPackageReferences) {
    const missingExternalPackages = [...externalPackageReferences]
      .filter(([packageName]) => !packageIsPresent(archiveEntries, packageName))
      .sort(([left], [right]) => left.localeCompare(right));
    if (missingExternalPackages.length > 0) {
      const details = missingExternalPackages.map(([packageName, entries]) => {
        return `${packageName} (required by ${[...entries].sort().join(', ')})`;
      });
      failures.push(`app.asar is missing external package roots: ${details.join('; ')}`);
    }
  }
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
    targetPlatform: applicationTarget.platform,
    targetArch: applicationTarget.arch,
    betterSqlite3BinaryPath,
    applicationIconPaths,
    externalPackageRoots: [...externalPackageReferences.keys()].sort(),
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
module.exports.collectExternalPackageReferences = collectExternalPackageReferences;
module.exports.findApplicationTarget = findApplicationTarget;
module.exports.getExternalPackageRoot = getExternalPackageRoot;
module.exports.getPathSize = getPathSize;
module.exports.inspectApplicationIcons = inspectApplicationIcons;
module.exports.inspectBinary = inspectBinary;
module.exports.packageIsPresent = packageIsPresent;
module.exports.resolveApplicationPath = resolveApplicationPath;
