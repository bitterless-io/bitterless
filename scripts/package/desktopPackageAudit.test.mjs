import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const afterPack = require('./desktopPackage.audit.cjs');
const {
  BANNED_PACKAGES,
  auditDesktopPackage,
  getPathSize,
  packageIsPresent,
} = afterPack;

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const temporaryRoots = [];

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

const createSyntheticApplication = async ({ platform = 'mac', archiveFiles = {}, appFiles = {} } = {}) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'bitterless-desktop-package-'));
  temporaryRoots.push(fixtureRoot);
  const archiveSource = path.join(fixtureRoot, 'archive-source');
  mkdirSync(archiveSource, { recursive: true });
  writeFixtureFiles(archiveSource, {
    'package.json': '{"name":"synthetic-app"}\n',
    ...archiveFiles,
  });

  const applicationPath = platform === 'mac'
    ? path.join(fixtureRoot, 'output', 'Synthetic.app')
    : path.join(fixtureRoot, 'output', 'win-unpacked');
  const resourcesPath = platform === 'mac'
    ? path.join(applicationPath, 'Contents', 'Resources')
    : path.join(applicationPath, 'resources');
  mkdirSync(resourcesPath, { recursive: true });
  await createPackage(archiveSource, path.join(resourcesPath, 'app.asar'));
  writeFixtureFiles(applicationPath, appFiles);

  return {
    applicationPath,
    outputPath: path.dirname(applicationPath),
    asarPath: path.join(resourcesPath, 'app.asar'),
  };
};

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test('synthetic app.asar passes the desktop package audit', async () => {
  const fixture = await createSyntheticApplication({
    archiveFiles: { 'out/main/app.main.js': 'module.exports = {};\n' },
  });

  const result = auditDesktopPackage(fixture.outputPath);
  assert.equal(result.applicationPath, fixture.applicationPath);
  assert.equal(result.asarPath, fixture.asarPath);
  assert(result.asarBytes > 0);
  assert(result.appBytes >= result.asarBytes);
  await afterPack({ appOutDir: fixture.outputPath });
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
    'electron-updater',
    'electron-xpc',
    'es-toolkit',
    'fs-extra',
    'https-proxy-agent',
    'inversify',
    'moment',
    'node-fetch',
    'node-llama-cpp',
    'playwright',
    'postman-request',
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
});

test('publish audits an existing packaged app before DMG finalization or upload', () => {
  const source = readProjectFile('scripts/publish.js');
  const mainSource = source.slice(source.indexOf('const main = async () =>'));
  const buildIndex = mainSource.indexOf('runBuild(options)');
  const auditIndex = mainSource.indexOf('auditPackagedApplication(options.platform)');
  const finalizeIndex = mainSource.indexOf('finalizeMacDmg(options.platform)');
  const uploadIndex = mainSource.indexOf('await uploadFile(');

  assert(buildIndex >= 0);
  assert(auditIndex > buildIndex);
  assert(finalizeIndex > auditIndex);
  assert(uploadIndex > auditIndex);
});
