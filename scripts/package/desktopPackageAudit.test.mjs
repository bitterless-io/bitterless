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
  LLAMA_BUILD_GUARD_ENTRY,
  auditDesktopPackage,
  getPathSize,
  packageIsPresent,
  setUpdateFeedUrlLine,
  writePackagedUpdateFeed,
} = afterPack;
// The shape node-llama-cpp ships today: build is forced to "never" when running in Electron, which is
// what makes llama/gitRelease.bundle unreachable and therefore excludable.
const LLAMA_BUILD_GUARD_SOURCE = 'const build = runningInElectron ? "never" : options.build;\n';
const {
  resolveUpdateDirectory,
  resolveUpdatePlatform,
} = require('../release/releaseChannel.cjs');
const { payloadSpecsForPlatform } = require('../maestro/externalTools.cjs');
const MAESTRO_TOOLS_MANIFEST = 'external-tools.manifest.json';
// The fixture spells the Windows target both ways (`win` and `windows`), so the store platform is
// derived the way the builder derives the binary format: mac or not-mac.
const maestroStoreFor = (platform, arch) => {
  if (platform !== 'mac') return 'win';
  return arch === 'arm64' ? 'mac_arm' : 'mac_intel';
};
const PLACEHOLDER_UPDATE_FEED_URL = 'https://assets.terncloud.com/bitterless/distro';

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

// The Info.plist a mac fixture ships is the one the associations gate actually reads. Generating it
// from the builder template (rather than a hand-written literal) keeps the fixture honest: if the
// template stops declaring a required document family, the gate fails here too.
const plistXml = (value) => {
  if (Array.isArray(value)) return `<array>${value.map(plistXml).join('')}</array>`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => `<key>${key}</key>${plistXml(item)}`)
      .join('');
    return `<dict>${entries}</dict>`;
  }
  return `<string>${value}</string>`;
};

const syntheticInfoPlist = () => {
  const template = parseYaml(readFileSync(path.join(projectRoot, 'electron-builder.tmp.yml'), 'utf-8'));
  const body = plistXml({ CFBundleDocumentTypes: template.mac.extendInfo.CFBundleDocumentTypes });
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${body}</plist>`;
};

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
  includeInfoPlist = true,
  includeMaestroTools = true,
  maestroToolsStorePlatform,
  maestroManifestPlatform,
  maestroToolsOverrides = {},
  maestroToolsExtraFiles = {},
  includeMacIcon = true,
  includeOnlyPreviewAgentSkill = true,
  includeTrenchAgentSkill = true,
  includeUpdateConfig = true,
  updateFeedUrl,
  runtimeProfile = {
    schemaVersion: 1,
    profileName: 'release_prod',
    releaseChannel: 'prod',
    viteEnv: 'prod',
    viteMode: 'release',
  },
} = {}) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'bitterless-desktop-package-'));
  temporaryRoots.push(fixtureRoot);
  const archiveSource = path.join(fixtureRoot, 'archive-source');
  mkdirSync(archiveSource, { recursive: true });
  writeFixtureFiles(archiveSource, {
    'package.json': '{"name":"synthetic-app"}\n',
    'out/main/app.main.js': 'module.exports = {};\n',
    'out/.bitterless-runtime-profile.json': JSON.stringify(runtimeProfile),
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
  const maestroStorePlatform = maestroToolsStorePlatform ?? maestroStoreFor(platform, targetArch);
  const maestroToolsFiles = includeMaestroTools
    ? Object.fromEntries([
        ...payloadSpecsForPlatform(maestroStorePlatform).map((spec) => [
          `${resourcesPrefix}/maestro-tools/${spec.path}`,
          maestroToolsOverrides[spec.path]
            ?? (spec.executable || spec.path.endsWith('.node')
              ? createBinary(targetArch)
              : `${spec.path}\n`),
        ]),
        [
          `${resourcesPrefix}/maestro-tools/${MAESTRO_TOOLS_MANIFEST}`,
          JSON.stringify({ schemaVersion: 1, platform: maestroManifestPlatform ?? maestroStorePlatform }),
        ],
        ...Object.entries(maestroToolsExtraFiles).map(([relativePath, content]) => [
          `${resourcesPrefix}/maestro-tools/${relativePath}`,
          content,
        ]),
      ])
    : {};
  const updateConfigFiles = includeUpdateConfig
    ? {
        [`${resourcesPrefix}/app-update.yml`]: [
          'provider: generic',
          `url: ${updateFeedUrl ?? resolveUpdateDirectory(
            runtimeProfile.releaseChannel,
            resolveUpdatePlatform(platform === 'mac' ? 'darwin' : 'win32', targetArch),
          )}`,
          'updaterCacheDirName: synthetic-updater',
          '',
        ].join('\n'),
      }
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
    ...(platform === 'mac' && includeInfoPlist
      ? { 'Contents/Info.plist': syntheticInfoPlist() }
      : {}),
    ...maestroToolsFiles,
    ...previewSkillFiles,
    ...trenchSkillFiles,
    ...updateConfigFiles,
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
});

test('afterPack runs the OnlyPreview associations gate on the packaged plist', {
  skip: process.platform !== 'darwin' ? 'plutil is macOS-only' : false,
}, async () => {
  const fixture = await createSyntheticApplication();
  const context = {
    appOutDir: fixture.outputPath,
    electronPlatformName: 'darwin',
    arch: 3,
    packager: { appInfo: { productFilename: 'Synthetic' } },
  };

  await afterPack(context);

  // Reverse lock: not throwing proves nothing (a gate removed from afterPack also does not throw).
  // Break the very plist the gate reads, and afterPack must go red.
  const plistPath = path.join(fixture.applicationPath, 'Contents', 'Info.plist');
  const broken = readFileSync(plistPath, 'utf-8').replace('public.data', 'missing.data');
  writeFileSync(plistPath, broken);

  await assert.rejects(() => afterPack(context), /public\.data/);
});

test('afterPack names the missing context field instead of dereferencing into a TypeError', async () => {
  const fixture = await createSyntheticApplication();

  await assert.rejects(
    () => afterPack({ appOutDir: fixture.outputPath, electronPlatformName: 'darwin', arch: 3 }),
    /Electron Builder context is missing packager\.appInfo\.productFilename/,
  );
});

test('synthetic Preview package requires the dedicated Preview ICNS', async () => {
  const runtimeProfile = {
    schemaVersion: 1,
    profileName: 'release_preview',
    releaseChannel: 'preview',
    viteEnv: 'prod',
    viteMode: 'release',
  };
  const valid = await createSyntheticApplication({
    runtimeProfile,
    appFiles: {
      'Contents/Resources/icon.icns': readFileSync(
        path.join(projectRoot, 'build/icon-preview.icns'),
      ),
    },
  });
  const result = auditDesktopPackage(valid.outputPath);
  assert.equal(result.packagedRuntimeProfile.profileName, 'release_preview');
  assert.equal(result.packagedRuntimeProfile.releaseChannel, 'preview');

  const stableArtwork = await createSyntheticApplication({ runtimeProfile });
  assert.throws(
    () => auditDesktopPackage(stableArtwork.outputPath),
    /bundle ICNS does not match icon-preview\.icns/,
  );
});

test('packaged runtime profile gate rejects debug and missing markers', async () => {
  const debug = await createSyntheticApplication({
    archiveFiles: {
      'out/.bitterless-runtime-profile.json': JSON.stringify({
        schemaVersion: 1,
        profileName: 'debug_dev',
        releaseChannel: 'dev',
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

test('maestro tools gate reports the staged store platform', async () => {
  const fixture = await createSyntheticApplication({ platform: 'mac', arch: 'arm64' });

  const result = auditDesktopPackage(fixture.applicationPath);

  assert.equal(result.maestroTools.storePlatform, 'mac_arm');
  assert.ok(result.maestroTools.files.includes('bun'));
  assert.ok(result.maestroTools.files.includes('zellij'));
  assert.ok(result.maestroTools.files.includes('anydoc/anydoc.node'));
});

test('maestro tools gate fails when a shipped tool belongs to another platform', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'mac',
    arch: 'arm64',
    maestroToolsOverrides: { bun: createPe64Binary('x64') },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /bun targets win32\/x64, expected darwin\/arm64/,
  );
});

test('maestro tools gate rejects missing and wrong-architecture Zellij on every target', async () => {
  for (const { platform, arch, filename, wrongBinary, expectedTarget } of [
    { platform: 'mac', arch: 'arm64', filename: 'zellij', wrongBinary: createMachO64Binary('x64'), expectedTarget: 'darwin/arm64' },
    { platform: 'mac', arch: 'x64', filename: 'zellij', wrongBinary: createPe64Binary('x64'), expectedTarget: 'darwin/x64' },
    { platform: 'win', arch: 'x64', filename: 'zellij.exe', wrongBinary: createMachO64Binary('arm64'), expectedTarget: 'win32/x64' },
  ]) {
    const fixture = await createSyntheticApplication({
      platform,
      arch,
      maestroToolsOverrides: { [filename]: wrongBinary },
    });
    assert.throws(
      () => auditDesktopPackage(fixture.applicationPath),
      (error) => error.message.includes(`${filename} targets`)
        && error.message.includes(`expected ${expectedTarget}`),
    );
    unlinkSync(path.join(fixture.resourcesPath, 'maestro-tools', filename));
    assert.throws(
      () => auditDesktopPackage(fixture.applicationPath),
      (error) => error.message.includes(filename) && /missing/.test(error.message),
    );
  }
});

test('maestro tools gate fails when the packaged tools are the other store entirely', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'win',
    arch: 'x64',
    maestroToolsStorePlatform: 'mac_arm',
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /bun is not part of the win payload; that name belongs to the mac_arm\/mac_intel store/,
  );
});

test('maestro tools gate fails on another platform file name left behind', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'mac',
    arch: 'arm64',
    maestroToolsExtraFiles: { 'bun.exe': createPe64Binary('x64') },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /bun\.exe is not part of the mac_arm payload; that name belongs to the win store/,
  );
});

test('maestro tools gate fails when the staged manifest names another platform', async () => {
  const fixture = await createSyntheticApplication({
    platform: 'mac',
    arch: 'arm64',
    maestroManifestPlatform: 'win',
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /declares platform win, expected mac_arm/,
  );
});

test('maestro tools gate fails when the tools were never staged', async () => {
  const fixture = await createSyntheticApplication({ includeMaestroTools: false });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /Resources\/maestro-tools is missing/,
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

test('an optional external package may be absent, and is still reported as referenced', async () => {
  // linkedom inlines `try { require("canvas") } catch { shim }`; canvas is deliberately not a
  // dependency, so its absence is the intended path rather than a missing runtime package.
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'out/main/app.main.js': 'module.exports = require("canvas");\n',
    },
  });

  const result = auditDesktopPackage(fixture.applicationPath);
  assert.deepEqual(result.externalPackageRoots, ['canvas']);
});

test('the optional allowlist does not excuse any other absent package root', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'out/main/app.main.js': [
        'const canvas = require("canvas");',
        'const other = require("missing-runtime");',
        'module.exports = { canvas, other };',
        '',
      ].join('\n'),
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

test('build-time payloads packed into app.asar fail, naming the template that excludes them', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'node_modules/node-llama-cpp/llama/gitRelease.bundle': 'git bundle\n',
      'node_modules/node-llama-cpp/llama/binariesGithubRelease.json': '"b4589"\n',
      'node_modules/node-llama-cpp/dist/bindings/getLlama.js': LLAMA_BUILD_GUARD_SOURCE,
      'node_modules/@kimchi-dev/kimchi-workflows/node_modules/typescript/lib/tsc.js': 'module.exports = {};\n',
      'node_modules/example/index.d.ts': 'export {};\n',
      'tsconfig.web.tsbuildinfo': '{}\n',
      'docs/design.html': '<p>design</p>\n',
    },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    (error) => {
      assert.match(error.message, /the package ships build-time payloads/);
      for (const label of [
        'llama\\.cpp source bundle',
        'build toolchain',
        'TypeScript declaration file',
        'incremental build state',
        'repository-only directory',
      ]) {
        assert.match(error.message, new RegExp(`${label} in app\\.asar`));
      }
      assert.match(error.message, /electron-builder\.tmp\.yml; electron-builder\.yml is generated/);
      // The sibling files the exclusion must never take with it.
      assert.doesNotMatch(error.message, /binariesGithubRelease\.json/);
      assert.doesNotMatch(error.message, /getLlama\.js/);
      return true;
    },
  );
});

test('build-time payloads reachable only in app.asar.unpacked still fail', async () => {
  // electron-builder auto-unpacks any module carrying a .node, so better-sqlite3's C sources never
  // appear in the archive listing at all; an asar-only gate would never see them return.
  const fixture = await createSyntheticApplication({
    appFiles: {
      'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/deps/sqlite3/sqlite3.c':
        'int main(void) { return 0; }\n',
      'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/binding.gyp':
        '{}\n',
    },
  });

  assert.throws(
    () => auditDesktopPackage(fixture.applicationPath),
    /better-sqlite3 C build input in app\.asar\.unpacked \(2, e\.g\. /,
  );
});

test('a package free of build-time payloads reports the packed and unpacked split', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: {
      'node_modules/node-llama-cpp/llama/binariesGithubRelease.json': '"b4589"\n',
      'node_modules/node-llama-cpp/dist/bindings/getLlama.js': LLAMA_BUILD_GUARD_SOURCE,
    },
  });

  const result = auditDesktopPackage(fixture.applicationPath);
  assert.equal(typeof result.unpackedBytes, 'number');
  assert(
    result.unpackedBytes > 0 && result.unpackedBytes < result.appBytes,
    'the unpacked tree must be measured apart from the application total',
  );
});

test('the llama build premise is pinned to the shipped getLlama.js', async () => {
  const flipped = await createSyntheticApplication({
    archiveFiles: {
      'node_modules/node-llama-cpp/dist/bindings/getLlama.js':
        'const build = options.build ?? "auto";\n',
    },
  });

  assert.throws(
    () => auditDesktopPackage(flipped.applicationPath),
    /llama build premise gate failed: .*getLlama\.js no longer contains runningInElectron and "never"/,
  );

  const excluded = await createSyntheticApplication({
    archiveFiles: { 'node_modules/node-llama-cpp/dist/config.js': 'module.exports = {};\n' },
  });

  assert.throws(
    () => auditDesktopPackage(excluded.applicationPath),
    new RegExp(`${LLAMA_BUILD_GUARD_ENTRY.replace(/[/.]/g, '\\$&')} is missing from app\\.asar`),
  );
});

test('Electron Builder template carries every build-time exclusion the audit enforces', () => {
  const config = parseYaml(readProjectFile('electron-builder.tmp.yml'));
  for (const pattern of [
    '!**/*.tsbuildinfo',
    '!docs/**',
    '!out/tests/**',
    '!skills/**',
    '!.claude/**',
    '!**/node_modules/node-llama-cpp/llama/gitRelease.bundle',
    '!**/node_modules/@earendil-works/pi-coding-agent/docs/**',
    '!**/node_modules/**/*.d.ts',
    '!**/node_modules/**/*.d.mts',
    '!**/node_modules/**/*.d.cts',
    '!**/node_modules/better-sqlite3-multiple-ciphers/deps/**',
    '!**/node_modules/better-sqlite3-multiple-ciphers/src/**',
    '!**/node_modules/better-sqlite3-multiple-ciphers/binding.gyp',
    '!**/node_modules/typescript/**',
    '!**/node_modules/@typescript/**',
    '!**/node_modules/vite/**',
    '!**/node_modules/vitest/**',
    '!**/node_modules/@vitest/**',
    '!**/node_modules/rolldown/**',
    '!**/node_modules/@rolldown/**',
    '!**/node_modules/lightningcss/**',
    '!**/node_modules/lightningcss-darwin-arm64/**',
    '!**/node_modules/chai/**',
  ]) {
    assert(config.files?.includes(pattern), `Electron Builder template must exclude ${pattern}`);
  }
  // Widening this one takes binariesGithubRelease.json and llama/grammars/ with it, and
  // `import('node-llama-cpp')` then throws on its first embedding or rerank call.
  assert(
    !config.files?.some((pattern) => /node-llama-cpp\/llama\/\*\*/.test(pattern)),
    'the llama exclusion must name the single bundle file, never the whole llama directory',
  );
  // Reachable from @earendil-works/pi-coding-agent, so it is deliberately kept.
  assert(
    !config.files?.some((pattern) => /node_modules\/(?:@esbuild|esbuild)\//.test(pattern)),
    'esbuild is reachable from a production dependency and must stay in the package',
  );
});

test('dependency classification keeps external runtime roots and bundles selected pure JavaScript packages', () => {
  const packageJson = JSON.parse(readProjectFile('package.json'));
  // This exact list is the tripwire for the failure in docs/issues/asar-packs-the-build-toolchain.md:
  // a build-time package landing under "dependencies" drags its own toolchain into the production
  // closure, and electron-builder packs all of it. Adding a runtime dependency must therefore be a
  // deliberate edit here, with the reason it cannot be bundled or moved to devDependencies.
  const externalRuntimeDependencies = [
    '@earendil-works/pi-coding-agent',
    '@electron-toolkit/utils',
    // Its ./flow and ./engine exports are imported as bare specifiers by the unbundled
    // out/main/workflow-*.mjs workers and require.resolve()d by workflowEngine/loader.ts, so it
    // cannot move to devDependencies. Its own typescript/vitest dependencies are excluded from the
    // package instead — electron-builder.tmp.yml, "build toolchain" block.
    '@kimchi-dev/kimchi-workflows',
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
    // workflowEngine/loader.ts transpiles user-authored .ts workflows through it at runtime.
    'jiti',
    'marked',
    'moment',
    'node-fetch',
    'node-llama-cpp',
    'playwright',
    'postman-request',
    'protobufjs',
    'reflect-metadata',
    // Bundled into out/main for our own code AND kept resolvable in node_modules: kimchi's dist
    // imports the bare specifier `typebox` without declaring it, so the package must ship.
    'typebox',
    'undici',
    'yaml',
    'zod',
  ];
  const bundledRuntimeDependencies = [
    '@bgotink/kdl',
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
    'unpdf',
  ];
  const movedToDev = [
    '@arco-design/web-vue',
    '@earendil-works/pi-ai',
    '@electron-toolkit/preload',
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
  assert.match(builder, /^\s+- '!dist\/\*\*'$/m);
  assert.match(builder, /^\s+- '!tmp\/\*\*'$/m);
  assert.match(builder, /^\s+- '!output\/\*\*'$/m);
  assert.doesNotMatch(
    builder,
    /@micromeet\/cli/,
    'the vendored CLI was retired in 2026-09; the template must not carry an exclusion for it',
  );
  assert.match(builder, /^\s+- '!node_modules\/\*\*\/\*\.map'$/m);
  const config = parseYaml(builder);
  assert(
    config.files?.includes('!prebuilt/**'),
    'Electron Builder template must exclude the legacy prebuilt cache from app.asar',
  );
  assert(
    config.files?.includes('!external_tools/**'),
    'Electron Builder template must exclude the external tools cache from app.asar',
  );
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
  assert(
    config.extraResources?.some(
      (resource) =>
        resource.from === 'build/maestro-tools'
        && resource.to === 'maestro-tools',
    ),
    'Electron Builder template must copy staged Maestro tools to Resources/maestro-tools',
  );

  for (const binaryPath of [
    'Contents/Resources/maestro-tools/bun',
    'Contents/Resources/maestro-tools/rg',
    'Contents/Resources/maestro-tools/fd',
    'Contents/Resources/maestro-tools/ouch',
    'Contents/Resources/maestro-tools/zellij',
    'Contents/Resources/maestro-tools/anydoc/anydoc.node',
  ]) {
    assert(
      config.mac?.binaries?.includes(binaryPath),
      `Electron Builder template must register ${binaryPath} for macOS signing`,
    );
  }
});

test('Electron Builder excludes complete release and temporary roots for Preview output', () => {
  const templateSource = readProjectFile('electron-builder.tmp.yml');
  const previewSource = templateSource.replace(/^(\s+output:).*$/m, '$1 dist/preview');
  const configurations = [
    { label: 'Stable template', config: parseYaml(templateSource), output: 'dist' },
    { label: 'Preview generated config', config: parseYaml(previewSource), output: 'dist/preview' },
  ];

  for (const { label, config, output } of configurations) {
    assert.equal(config.directories?.output, output, `${label} must use the expected output`);
    assert(config.files?.includes('!dist/**'), `${label} must exclude the complete dist root`);
    assert(config.files?.includes('!tmp/**'), `${label} must exclude the complete tmp root`);
  }
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
  const auditIndex = mainSource.indexOf('auditPackagedApplication(options.platform, options.env)');
  const finalizeIndex = mainSource.indexOf('finalizeMacDmg(options.platform, targetDistDir)');
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

test('afterPack writes the exact channel and platform update feed into every supported target', async () => {
  const targets = [
    {
      platform: 'mac',
      arch: 'arm64',
      channel: 'prod',
      runtimeProfile: {
        schemaVersion: 1,
        profileName: 'release_prod',
        releaseChannel: 'prod',
        viteEnv: 'prod',
        viteMode: 'release',
      },
      appFiles: {},
      expected: 'https://assets.terncloud.com/bitterless/distro/prod/mac_arm',
    },
    {
      platform: 'mac',
      arch: 'x64',
      channel: 'preview',
      runtimeProfile: {
        schemaVersion: 1,
        profileName: 'release_preview',
        releaseChannel: 'preview',
        viteEnv: 'prod',
        viteMode: 'release',
      },
      appFiles: {
        'Contents/Resources/icon.icns': readFileSync(
          path.join(projectRoot, 'build/icon-preview.icns'),
        ),
      },
      expected: 'https://assets.terncloud.com/bitterless/distro/preview/mac_intel',
    },
    {
      platform: 'win',
      arch: 'x64',
      channel: 'dev',
      runtimeProfile: {
        schemaVersion: 1,
        profileName: 'release_dev',
        releaseChannel: 'dev',
        viteEnv: 'dev',
        viteMode: 'release',
      },
      appFiles: {},
      expected: 'https://assets.terncloud.com/bitterless/distro/dev/win64',
    },
  ];

  for (const target of targets) {
    const fixture = await createSyntheticApplication({
      platform: target.platform,
      arch: target.arch,
      runtimeProfile: target.runtimeProfile,
      appFiles: target.appFiles,
      updateFeedUrl: PLACEHOLDER_UPDATE_FEED_URL,
    });
    const configPath = path.join(fixture.resourcesPath, 'app-update.yml');
    assert.match(readFileSync(configPath, 'utf-8'), /^url: https:\/\/assets\.terncloud\.com\/bitterless\/distro$/m);

    assert.equal(writePackagedUpdateFeed(fixture.applicationPath), target.expected);

    const rewritten = parseYaml(readFileSync(configPath, 'utf-8'));
    assert.equal(rewritten.url, target.expected);
    assert.equal(rewritten.provider, 'generic');
    assert.equal(rewritten.updaterCacheDirName, 'synthetic-updater');
    assert.equal(auditDesktopPackage(fixture.applicationPath).packagedUpdateFeedUrl, target.expected);
  }
});

test('package audit rejects a placeholder, cross-channel, cross-platform, or missing update feed', async () => {
  const runtimeProfile = {
    schemaVersion: 1,
    profileName: 'release_preview',
    releaseChannel: 'preview',
    viteEnv: 'prod',
    viteMode: 'release',
  };
  const previewIcon = {
    'Contents/Resources/icon.icns': readFileSync(path.join(projectRoot, 'build/icon-preview.icns')),
  };

  const rejected = [
    'https://example.com/auto-updates',
    PLACEHOLDER_UPDATE_FEED_URL,
    'https://assets.terncloud.com/bitterless/distro/prod/mac_arm',
    'https://assets.terncloud.com/bitterless/distro/preview/win64',
  ];
  for (const updateFeedUrl of rejected) {
    const fixture = await createSyntheticApplication({
      runtimeProfile,
      appFiles: previewIcon,
      updateFeedUrl,
    });
    assert.throws(
      () => auditDesktopPackage(fixture.outputPath),
      /update feed gate failed: app-update\.yml url must be https:\/\/assets\.terncloud\.com\/bitterless\/distro\/preview\/mac_arm/,
    );
  }

  const missing = await createSyntheticApplication({
    runtimeProfile,
    appFiles: previewIcon,
    includeUpdateConfig: false,
  });
  assert.throws(() => auditDesktopPackage(missing.outputPath), /update feed gate failed/);
  assert.throws(() => writePackagedUpdateFeed(missing.outputPath), /app-update\.yml/);
});

test('update feed rewrite requires exactly one top-level url and preserves line endings', () => {
  const feed = 'https://assets.terncloud.com/bitterless/distro/preview/mac_arm';
  assert.equal(
    setUpdateFeedUrlLine('provider: generic\nurl: https://example.com/x\n', feed),
    `provider: generic\nurl: ${feed}\n`,
  );
  assert.equal(
    setUpdateFeedUrlLine('provider: generic\r\nurl: https://example.com/x\r\n', feed),
    `provider: generic\r\nurl: ${feed}\r\n`,
  );
  assert.throws(
    () => setUpdateFeedUrlLine('provider: generic\n', feed),
    /exactly one top-level url; found 0/,
  );
  assert.throws(
    () => setUpdateFeedUrlLine('url: a\nurl: b\n', feed),
    /exactly one top-level url; found 2/,
  );
  assert.doesNotMatch(
    setUpdateFeedUrlLine('provider: generic\n  url: nested\nurl: top\n', feed),
    /url: top/,
  );
});
