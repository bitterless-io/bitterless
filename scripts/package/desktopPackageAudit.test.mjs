import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const { parse: parseYaml } = require('yaml');
const afterPack = require('./desktopPackage.audit.cjs');
const {
  BANNED_PACKAGES,
  auditDesktopPackage,
  getPathSize,
  packageIsPresent,
} = afterPack;

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const temporaryRoots = [];
const ELECTRON_LANGUAGES = ['zh_CN', 'zh_TW', 'ja', 'en', 'id', 'ko', 'fr'];
const ONLY_PREVIEW_AGENT_SKILL_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/mcp-setup.md',
  'references/tools.md',
];
const TRENCH_AGENT_SKILL_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/mcp-setup.md',
  'references/schemas.md',
  'references/tools.md',
];

const readProjectFile = (filePath) => {
  return readFileSync(path.join(projectRoot, filePath), 'utf-8');
};

const writeFixtureFiles = (root, files) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
};

const createMachO64Binary = (arch) => {
  const cpuTypes = { arm64: 0x0100000c, x64: 0x01000007 };
  const binary = Buffer.alloc(64);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(cpuTypes[arch], 4);
  binary.writeUInt32LE(0, 8);
  binary.writeUInt32LE(8, 12);
  return binary;
};

const createPe64Binary = (arch) => {
  const machineTypes = { arm64: 0xaa64, x64: 0x8664 };
  const binary = Buffer.alloc(512);
  binary.write('MZ', 0, 'ascii');
  binary.writeUInt32LE(0x80, 0x3c);
  binary.write('PE\0\0', 0x80, 'binary');
  binary.writeUInt16LE(machineTypes[arch], 0x84);
  binary.writeUInt16LE(0xf0, 0x94);
  binary.writeUInt16LE(0x20b, 0x98);
  return binary;
};

const createSyntheticApplication = async ({
  platform = 'mac',
  arch,
  archiveFiles = {},
  appFiles = {},
  includeBetterSqlite3Binary = true,
  betterSqlite3Arch,
  includeMacIcon = true,
  includeOnlyPreviewAgentSkill = true,
  includeTrenchAgentSkill = true,
} = {}) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'bitterless-desktop-package-'));
  temporaryRoots.push(fixtureRoot);
  const archiveSource = path.join(fixtureRoot, 'archive-source');
  mkdirSync(archiveSource, { recursive: true });
  writeFixtureFiles(archiveSource, {
    'package.json': '{"name":"synthetic-app"}\n',
    'out/main/app.main.js': 'module.exports = {};\n',
    'out/.bitterless-runtime-profile.json': JSON.stringify({
      schemaVersion: 1,
      profileName: 'release_prod',
      viteEnv: 'prod',
      viteMode: 'release',
    }),
    ...archiveFiles,
  });

  const applicationPath = platform === 'mac'
    ? path.join(fixtureRoot, 'output', 'Synthetic.app')
    : path.join(fixtureRoot, 'output', 'win-unpacked');
  const resourcesPath = platform === 'mac'
    ? path.join(applicationPath, 'Contents', 'Resources')
    : path.join(applicationPath, 'resources');
  const targetArch = arch ?? (platform === 'mac' ? 'arm64' : 'x64');
  const createBinary = platform === 'mac' ? createMachO64Binary : createPe64Binary;
  const executablePath = platform === 'mac'
    ? 'Contents/MacOS/Synthetic'
    : 'Synthetic.exe';
  const nativeBinaryPath = platform === 'mac'
    ? 'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node'
    : 'resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node';
  const resourcesPrefix = platform === 'mac' ? 'Contents/Resources' : 'resources';
  const previewSkillFiles = includeOnlyPreviewAgentSkill
    ? Object.fromEntries(
        ONLY_PREVIEW_AGENT_SKILL_FILES.map((relativePath) => [
          `${resourcesPrefix}/agent-skills/bitterless-preview/${relativePath}`,
          `${relativePath}\n`,
        ]),
      )
    : {};
  const trenchSkillFiles = includeTrenchAgentSkill
    ? Object.fromEntries(
        TRENCH_AGENT_SKILL_FILES.map((relativePath) => [
          `${resourcesPrefix}/agent-skills/bitterless-trench/${relativePath}`,
          `${relativePath}\n`,
        ]),
      )
    : {};
  mkdirSync(resourcesPath, { recursive: true });
  await createPackage(archiveSource, path.join(resourcesPath, 'app.asar'));
  writeFixtureFiles(applicationPath, {
    [executablePath]: createBinary(targetArch),
    ...(includeBetterSqlite3Binary
      ? { [nativeBinaryPath]: createBinary(betterSqlite3Arch ?? targetArch) }
      : {}),
    ...(platform === 'mac' && includeMacIcon
      ? {
          'Contents/Resources/icon.icns': readFileSync(path.join(projectRoot, 'build/icon.icns')),
        }
      : {}),
    ...previewSkillFiles,
    ...trenchSkillFiles,
    ...appFiles,
  });

  return {
    applicationPath,
    outputPath: path.dirname(applicationPath),
    asarPath: path.join(resourcesPath, 'app.asar'),
    resourcesPath,
  };
};

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test('synthetic app.asar passes the desktop package audit', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'out/main/app.main.js': [
        '// require("comment-only-package")',
        'const example = \'import("string-only-package")\';',
        'module.exports = { example };',
        '',
      ].join('\n'),
    },
  });

  const result = auditDesktopPackage(fixture.outputPath);
  assert.equal(result.applicationPath, fixture.applicationPath);
  assert.equal(result.asarPath, fixture.asarPath);
  assert(result.asarBytes > 0);
  assert(result.appBytes >= result.asarBytes);
  assert.equal(result.targetPlatform, 'darwin');
  assert.equal(result.targetArch, 'arm64');
  assert.equal(result.packagedRuntimeProfile.profileName, 'release_prod');
  assert(result.applicationIconPaths.bundleIcnsPath.endsWith('icon.icns'));
  assert.equal(result.onlyPreviewAgentSkill.files.length, 4);
  assert.equal(result.trenchAgentSkill.files.length, 5);
  await afterPack({ appOutDir: fixture.outputPath, electronPlatformName: 'darwin', arch: 3 });
});

test('packaged runtime profile gate rejects debug and missing markers', async () => {
  const debug = await createSyntheticApplication({
    archiveFiles: {
      'out/.bitterless-runtime-profile.json': JSON.stringify({
        schemaVersion: 1,
        profileName: 'debug_dev',
        viteEnv: 'dev',
        viteMode: 'debug',
      }),
    },
  });
  assert.throws(() => auditDesktopPackage(debug.applicationPath), /runtime profile gate failed/);

  const missing = await createSyntheticApplication();
  const missingSource = path.join(path.dirname(missing.asarPath), 'missing-marker-source');
  mkdirSync(missingSource, { recursive: true });
  writeFixtureFiles(missingSource, {
    'package.json': '{"name":"synthetic-app"}\n',
    'out/main/app.main.js': 'module.exports = {};\n',
  });
  await createPackage(missingSource, missing.asarPath);
  assert.throws(() => auditDesktopPackage(missing.applicationPath), /runtime profile gate failed/);
});

test('packaged Preview skill gate rejects missing files and symlinks', async () => {
  const missing = await createSyntheticApplication();
  unlinkSync(path.join(missing.resourcesPath, 'agent-skills/bitterless-preview/references/tools.md'));
  assert.throws(
    () => auditDesktopPackage(missing.applicationPath),
    /Preview agent skill gate failed/,
  );

  const fileSymlink = await createSyntheticApplication();
  const toolsPath = path.join(
    fileSymlink.resourcesPath,
    'agent-skills/bitterless-preview/references/tools.md',
  );
  unlinkSync(toolsPath);
  symlinkSync('mcp-setup.md', toolsPath);
  assert.throws(
    () => auditDesktopPackage(fileSymlink.applicationPath),
    /Preview skill file must be a non-empty real file/,
  );

  const emptyFile = await createSyntheticApplication();
  writeFileSync(
    path.join(emptyFile.resourcesPath, 'agent-skills/bitterless-preview/agents/openai.yaml'),
    '',
  );
  assert.throws(
    () => auditDesktopPackage(emptyFile.applicationPath),
    /Preview skill file must be a non-empty real file/,
  );

  const directorySymlink = await createSyntheticApplication();
  const skillPath = path.join(
    directorySymlink.resourcesPath,
    'agent-skills/bitterless-preview',
  );
  const referencesPath = path.join(skillPath, 'references');
  const movedReferencesPath = `${referencesPath}-real`;
  renameSync(referencesPath, movedReferencesPath);
  symlinkSync(movedReferencesPath, referencesPath, 'dir');
  assert.throws(
    () => auditDesktopPackage(directorySymlink.applicationPath),
    /Preview skill directory must be a real directory/,
  );
});

test('packaged Trench skill gate rejects missing files and symlinks', async () => {
  const missing = await createSyntheticApplication();
  unlinkSync(path.join(missing.resourcesPath, 'agent-skills/bitterless-trench/references/schemas.md'));
  assert.throws(
    () => auditDesktopPackage(missing.applicationPath),
    /Trench agent skill gate failed/,
  );

  const fileSymlink = await createSyntheticApplication();
  const toolsPath = path.join(
    fileSymlink.resourcesPath,
    'agent-skills/bitterless-trench/references/tools.md',
  );
  unlinkSync(toolsPath);
  symlinkSync('schemas.md', toolsPath);
  assert.throws(
    () => auditDesktopPackage(fileSymlink.applicationPath),
    /Trench skill file must be a non-empty real file/,
  );

  const directorySymlink = await createSyntheticApplication();
  const skillPath = path.join(
    directorySymlink.resourcesPath,
    'agent-skills/bitterless-trench',
  );
  const referencesPath = path.join(skillPath, 'references');
  const movedReferencesPath = `${referencesPath}-real`;
  renameSync(referencesPath, movedReferencesPath);
  symlinkSync(movedReferencesPath, referencesPath, 'dir');
  assert.throws(
    () => auditDesktopPackage(directorySymlink.applicationPath),
    /Trench skill directory must be a real directory/,
  );
});

test('macOS application icon gate rejects a missing or empty packaged ICNS', async () => {
  const missing = await createSyntheticApplication({ includeMacIcon: false });
  assert.throws(
    () => auditDesktopPackage(missing.applicationPath),
    /application icon gate failed:.*icon\.icns/,
  );

  const emptyBundleIcns = await createSyntheticApplication({
    appFiles: { 'Contents/Resources/icon.icns': Buffer.alloc(0) },
  });
  assert.throws(
    () => auditDesktopPackage(emptyBundleIcns.applicationPath),
    /bundle ICNS must be a non-empty real file/,
  );
});

test('native runtime gate accepts macOS x64 and Windows x64 fixtures', async () => {
  const cases = [
    { platform: 'mac', arch: 'x64', expectedPlatform: 'darwin' },
    { platform: 'windows', arch: 'x64', expectedPlatform: 'win32' },
  ];
  for (const fixtureCase of cases) {
    const fixture = await createSyntheticApplication(fixtureCase);
    const result = auditDesktopPackage(fixture.applicationPath);
    assert.equal(result.targetPlatform, fixtureCase.expectedPlatform);
    assert.equal(result.targetArch, fixtureCase.arch);
    assert(result.betterSqlite3BinaryPath.endsWith('better_sqlite3.node'));
  }
});

test('native runtime gate fails when unpacked better_sqlite3.node is missing', async () => {
  const fixture = await createSyntheticApplication({ includeBetterSqlite3Binary: false });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /required unpacked better_sqlite3\.node is invalid/,
  );
});

test('native runtime gate fails when better_sqlite3.node has the wrong architecture', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'mac',
    arch: 'arm64',
    betterSqlite3Arch: 'x64',
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /better_sqlite3\.node targets darwin\/x64, expected darwin\/arm64/,
  );
});

test('synthetic app.asar above the configured archive limit fails', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'windows',
    archiveFiles: { 'out/main/large.js': 'x'.repeat(8 * 1024) },
  });
  const asarBytes = lstatSync(fixture.asarPath).size;

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath, {
      maxAsarBytes: asarBytes - 1,
      maxAppBytes: Number.MAX_SAFE_INTEGER,
    }),
    /app\.asar is .* above the .* limit/,
  );
});

test('synthetic unpacked application above the configured app limit fails', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: { 'out/main/app.main.js': 'module.exports = {};\n' },
    appFiles: { 'Contents/Frameworks/padding.bin': Buffer.alloc(16 * 1024) },
  });
  const appBytes = getPathSize(fixture.applicationPath);

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath, {
      maxAsarBytes: Number.MAX_SAFE_INTEGER,
      maxAppBytes: appBytes - 1,
    }),
    /application is .* above the .* limit/,
  );
});

test('synthetic app.asar containing a banned package root fails', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'node_modules/@arco-design/web-vue/package.json': '{"name":"@arco-design/web-vue"}\n',
      'node_modules/@arco-design/web-vue-extra/package.json': '{"name":"@arco-design/web-vue-extra"}\n',
    },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /banned package roots: @arco-design\/web-vue/,
  );
  assert.equal(
    packageIsPresent(['/node_modules/@arco-design/web-vue-extra/package.json'], '@arco-design/web-vue'),
    false,
  );
});

test('synthetic app.asar missing an external runtime package root fails', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'out/main/app.main.js': 'module.exports = require("missing-runtime/subpath");\n',
    },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /missing external package roots: missing-runtime \(required by \/out\/main\/app\.main\.js\)/,
  );
});

test('synthetic package subpath imports pass when their package root is present', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'out/preload/connector.js': [
        'import fs from "node:fs";',
        'import electron from "electron";',
        'import protobuf from "protobufjs/minimal";',
        'const path = require("path");',
        'const local = require("./local");',
        'void import("protobufjs/light");',
        'export default { electron, fs, local, path, protobuf };',
        '',
      ].join('\n'),
      'node_modules/protobufjs/package.json': '{"name":"protobufjs"}\n',
    },
  });

  const result = auditDesktopPackage(fixture.applicationPath);
  assert.deepEqual(result.externalPackageRoots, ['protobufjs']);
});

test('dependency classification keeps external runtime roots and bundles selected pure JavaScript packages', () => {
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const externalRuntimeDependencies = [
    '@earendil-works/pi-coding-agent',
    '@electron-toolkit/utils',
    '@sapphire/snowflake',
    '@seald-io/nedb',
    'better-sqlite3-multiple-ciphers',
    'compare-versions',
    'dingtalk-stream',
    'dompurify',
    'electron-log',
    'electron-updater',
    'electron-xpc',
    'es-toolkit',
    'fs-extra',
    'https-proxy-agent',
    'inversify',
    'marked',
    'moment',
    'node-fetch',
    'node-llama-cpp',
    'playwright',
    'postman-request',
    'protobufjs',
    'reflect-metadata',
    'undici',
    'yaml',
    'zod',
  ];
  const bundledRuntimeDependencies = [
    '@langchain/anthropic',
    '@langchain/core',
    '@langchain/google-genai',
    '@langchain/langgraph',
    '@langchain/openai',
    '@larksuiteoapi/node-sdk',
    '@mozilla/readability',
    'docx',
    'exceljs',
    'linkedom',
    'mammoth',
    'typebox',
    'unpdf',
  ];
  const movedToDev = [
    '@arco-design/web-vue',
    '@earendil-works/pi-ai',
    '@electron-toolkit/preload',
    '@qdrant/js-client-rest',
    '@rig-lib/semaphore',
    '@silurus/ooxml',
    '@tabler/icons-vue',
    '@vueuse/core',
    'adm-zip',
    'axios',
    'chalk',
    'cli-progress',
    'commander',
    'dayjs',
    'diff-match-patch-es',
    'eventsource',
    'fast-glob',
    'gpt-tokenizer',
    'highlight.js',
    'jsdom',
    'jsonc-parser',
    'katex',
    'markstream-vue',
    'monaco-editor',
    'nanoid',
    'node-pty',
    'pdf-parse',
    'quill',
    'shiki',
    'simple-git',
    'splitpanes',
    'stream-markdown',
    'stream-monaco',
    'tar',
    'vue-i18n',
    'vue-router',
    'vuedraggable',
    'xterm',
    'youtube-dl-exec',
  ];

  assert.deepEqual(Object.keys(packageJson.dependencies), externalRuntimeDependencies);
  assert.equal(packageJson.dependencies.protobufjs, '^7.2.6');
  assert.equal(packageJson.devDependencies.acorn, '^8.15.0');
  for (const packageName of movedToDev) {
    assert(packageJson.devDependencies[packageName], `${packageName} must be a devDependency`);
  }
  for (const packageName of bundledRuntimeDependencies) {
    assert(packageJson.devDependencies[packageName], `${packageName} must be bundled from devDependencies`);
  }
  for (const packageName of externalRuntimeDependencies) {
    assert(!BANNED_PACKAGES.includes(packageName), `${packageName} is required at runtime`);
  }
  for (const packageName of [
    '@earendil-works/pi-ai',
    '@rig-lib/semaphore',
    'axios',
    'chalk',
    'commander',
    'dayjs',
    'highlight.js',
    'nanoid',
    'simple-git',
    'tar',
  ]) {
    assert(!BANNED_PACKAGES.includes(packageName), `${packageName} may be a runtime transitive root`);
  }

  const viteConfig = readProjectFile('electron.vite.config.ts');
  assert.equal(
    [...viteConfig.matchAll(/externalizeDeps: \{ exclude: bundledRuntimeDependencies \}/g)].length,
    2,
  );
  assert.doesNotMatch(viteConfig, /\/tiktoken\//);
  assert.doesNotMatch(viteConfig, /\/js-tiktoken\//);
});

test('Electron Builder registers the audit and excludes non-runtime roots', () => {
  const builder = readProjectFile('electron-builder.tmp.yml');
  assert.match(builder, /^afterPack: scripts\/package\/desktopPackage\.audit\.cjs$/m);
  assert.match(builder, /^\s+- '!tests\/\*\*'$/m);
  assert.match(builder, /^\s+- '!output\/\*\*'$/m);
  assert.match(builder, /^\s+- '!node_modules\/@micromeet\/cli\{,\/\*\*\}'$/m);
  assert.match(builder, /^\s+- '!node_modules\/\*\*\/\*\.map'$/m);
  const config = parseYaml(builder);
  assert(
    config.extraResources?.some(
      (resource) =>
        resource.from === 'skills/bitterless-preview'
        && resource.to === 'agent-skills/bitterless-preview',
    ),
    'Electron Builder must copy the complete Bitterless Preview skill directory',
  );
  assert(
    config.extraResources?.some(
      (resource) =>
        resource.from === 'skills/bitterless-trench'
        && resource.to === 'agent-skills/bitterless-trench',
    ),
    'Electron Builder must copy the complete Bitterless Trench skill directory',
  );
});

test('Electron Builder locale allowlist is exact in the template and optional generated config', () => {
  const assertExactElectronLanguages = (actual, label) => {
    assert.deepEqual(
      actual,
      ELECTRON_LANGUAGES,
      `${label} must contain the exact ordered Electron locale allowlist`,
    );
  };

  const templatePath = 'electron-builder.tmp.yml';
  const template = parseYaml(readProjectFile(templatePath));
  assertExactElectronLanguages(template.electronLanguages, templatePath);

  const generator = readProjectFile('scripts/before.js');
  assert.match(generator, /const builderTmpPath = path\.join\(rootDir, 'electron-builder\.tmp\.yml'\);/);
  assert.match(generator, /const builderOutPath = path\.join\(rootDir, 'electron-builder\.yml'\);/);
  assert.match(generator, /fs\.readFileSync\(builderTmpPath, 'utf-8'\)/);
  assert.match(generator, /fs\.writeFileSync\(builderOutPath, builderContent, 'utf-8'\)/);

  const generatedPath = 'electron-builder.yml';
  if (existsSync(path.join(projectRoot, generatedPath))) {
    const generated = parseYaml(readProjectFile(generatedPath));
    assertExactElectronLanguages(generated.electronLanguages, generatedPath);
  }

  const invalidLists = {
    missing: ELECTRON_LANGUAGES.slice(0, -1),
    extra: [...ELECTRON_LANGUAGES, 'de'],
    duplicated: [...ELECTRON_LANGUAGES, 'fr'],
    reordered: [ELECTRON_LANGUAGES[1], ELECTRON_LANGUAGES[0], ...ELECTRON_LANGUAGES.slice(2)],
  };
  for (const [variant, languages] of Object.entries(invalidLists)) {
    assert.throws(
      () => assertExactElectronLanguages(languages, variant),
      /must contain the exact ordered Electron locale allowlist/,
    );
  }
});

test('publish audits an existing packaged app before DMG finalization or upload', () => {
  const source = readProjectFile('scripts/publish.js');
  const mainSource = source.slice(source.indexOf('const main = async () =>'));
  const buildIndex = mainSource.indexOf('runBuild(options)');
  const auditIndex = mainSource.indexOf('auditPackagedApplication(options.platform)');
  const finalizeIndex = mainSource.indexOf('finalizeMacDmg(options.platform)');
  const uploadIndex = mainSource.indexOf('await publishRelease({');

  assert(buildIndex >= 0);
  assert(auditIndex > buildIndex);
  assert(finalizeIndex > auditIndex);
  assert(uploadIndex > auditIndex);
});

test('signedBuild strips generic Apple certificate variables for a Windows target', () => {
  const source = readProjectFile('scripts/signedBuild.js');

  assert.match(source, /const targetsWindows = args\.some/);
  assert.match(source, /if \(targetsWindows\) \{\s+delete env\.CSC_LINK;\s+delete env\.CSC_KEY_PASSWORD;/);
  assert.doesNotMatch(source, /delete env\.WIN_CSC_(?:LINK|KEY_PASSWORD)/);
});
