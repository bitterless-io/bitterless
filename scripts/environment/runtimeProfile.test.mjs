/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { config as dotenvConfig } from 'dotenv';
import runtimeProfileConfig from './runtimeProfile.config.cjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

const loadE2ERuntimeModule = async () => {
  const result = await build({
    entryPoints: [join(projectRoot, 'tests/e2e/e2eRuntimeMode.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return await import(`data:text/javascript;base64,${encoded}`);
};

test('Rig profiles have exact backend and mode identities', () => {
  const definitions = runtimeProfileConfig.readProfileDefinitions(projectRoot);
  assert.deepEqual(
    Object.fromEntries(
      runtimeProfileConfig.PROFILE_NAMES.map((name) => [
        name,
        {
          releaseChannel: definitions[name].VITE_RELEASE_CHANNEL,
          viteEnv: definitions[name].VITE_ENV,
          viteMode: definitions[name].VITE_MODE
        }
      ])
    ),
    {
      debug_dev: { releaseChannel: 'dev', viteEnv: 'dev', viteMode: 'debug' },
      debug_prod: { releaseChannel: 'prod', viteEnv: 'prod', viteMode: 'debug' },
      release_dev: { releaseChannel: 'dev', viteEnv: 'dev', viteMode: 'release' },
      release_prod: { releaseChannel: 'prod', viteEnv: 'prod', viteMode: 'release' },
      release_preview: { releaseChannel: 'preview', viteEnv: 'prod', viteMode: 'release' }
    }
  );
});

test('Rig duplicate mode output normalizes to one canonical VITE_MODE', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-runtime-profile-'));
  try {
    writeFileSync(
      join(tempRoot, 'env.rig.json5'),
      readFileSync(join(projectRoot, 'env.rig.json5'), 'utf8')
    );
    writeFileSync(
      join(tempRoot, '.env.rig'),
      'MODE = debug_prod\nVITE_MODE = debug_prod\nVITE_ENV = prod\nVITE_RELEASE_CHANNEL = prod\nVITE_MODE = debug\n'
    );
    runtimeProfileConfig.normalizeRigEnvironment(tempRoot, 'debug_prod');
    const canonical = readFileSync(join(tempRoot, '.env.rig'), 'utf8');
    assert.equal((canonical.match(/^VITE_MODE\s*=/gm) ?? []).length, 1);
    assert.match(canonical, /^VITE_MODE = debug$/m);
    assert.deepEqual(runtimeProfileConfig.loadCanonicalRigEnvironment(tempRoot), {
      environment: {
        MODE: 'debug_prod',
        VITE_ENV: 'prod',
        VITE_MODE: 'debug',
        VITE_RELEASE_CHANNEL: 'prod'
      },
      profileName: 'debug_prod',
      releaseChannel: 'prod',
      viteEnv: 'prod',
      viteMode: 'debug'
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('canonical Rig environment overrides a hostile parent shell', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-runtime-dotenv-'));
  const previousMode = process.env.VITE_MODE;
  const previousEnvironment = process.env.VITE_ENV;
  const previousReleaseChannel = process.env.VITE_RELEASE_CHANNEL;
  try {
    const envPath = join(tempRoot, '.env.rig');
    writeFileSync(envPath, 'VITE_ENV = dev\nVITE_MODE = debug\nVITE_RELEASE_CHANNEL = dev\n');
    process.env.VITE_MODE = 'release';
    process.env.VITE_ENV = 'prod';
    process.env.VITE_RELEASE_CHANNEL = 'preview';
    const result = dotenvConfig({ path: envPath, override: true });
    assert.equal(result.error, undefined);
    assert.equal(process.env.VITE_MODE, 'debug');
    assert.equal(process.env.VITE_ENV, 'dev');
    assert.equal(process.env.VITE_RELEASE_CHANNEL, 'dev');
  } finally {
    if (previousMode === undefined) delete process.env.VITE_MODE;
    else process.env.VITE_MODE = previousMode;
    if (previousEnvironment === undefined) delete process.env.VITE_ENV;
    else process.env.VITE_ENV = previousEnvironment;
    if (previousReleaseChannel === undefined) delete process.env.VITE_RELEASE_CHANNEL;
    else process.env.VITE_RELEASE_CHANNEL = previousReleaseChannel;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('every GUI/E2E alias selects debug and every package alias selects release', () => {
  const scripts = packageJson.scripts;
  const debugProfiles = {
    build: 'debug_dev',
    dev: 'debug_dev',
    'dev:prod': 'debug_prod',
    start: 'debug_dev',
    'test:e2e:coin': 'debug_dev',
    'test:e2e:maestro': 'debug_dev',
    'test:e2e:onlypreview': 'debug_dev'
  };
  for (const [name, profile] of Object.entries(debugProfiles)) {
    assert.match(
      scripts[name],
      new RegExp(`runWithRuntimeProfile\\.cjs ${profile} -- yarn _`),
      name
    );
  }

  const releaseProfiles = {
    'build:linux': 'release_prod',
    'build:linux_arm64': 'release_prod',
    'build:linux_x64': 'release_prod',
    'build:mac_arm': 'release_prod',
    'build:mac_intel': 'release_prod',
    'build:mac_x64': 'release_prod',
    'build:unpack': 'release_prod',
    'build:win': 'release_prod',
    'build_dev:mac_arm': 'release_dev',
    'build_dev:mac_intel': 'release_dev',
    'build_dev:win': 'release_dev',
    'build_preview:mac_arm': 'release_preview',
    'build_preview:mac_intel': 'release_preview',
    'build_preview:win': 'release_preview'
  };
  for (const [name, profile] of Object.entries(releaseProfiles)) {
    assert.match(
      scripts[name],
      new RegExp(`runWithRuntimeProfile\\.cjs ${profile} -- yarn _package:`),
      name
    );
  }
  assert.match(scripts['_build:release'], /assertRuntimeProfile\.cjs release/);
  assert.doesNotMatch(scripts['_build:release'], /yarn build/);
  assert.doesNotMatch(source('scripts/publish.js'), /run\('yarn', \['build'\]\)/);
});

test('electron build loads canonical env with override and emits its mode marker', () => {
  const config = source('electron.vite.config.ts');
  const bootstrap = source('src/main/environment/runtimeProfile.bootstrap.ts');
  assert.match(config, /loadCanonicalRigEnvironment\(resolve\('\.'\)\)/);
  assert.match(config, /dotenvConfig\(\{ path: resolve\('\.env\.rig'\), override: true \}\)/);
  assert.match(config, /runtime-profile-build-marker/);
  assert.match(config, /'import\.meta\.env\.VITE_MODE'/);
  assert.match(config, /'import\.meta\.env\.VITE_RELEASE_CHANNEL'/);
  assert.match(bootstrap, /catch \(error\)[\s\S]*terminateInvalidRuntimeProfile\(error\)/);
  assert.match(bootstrap, /app\.exit\(1\)[\s\S]*throw runtimeError/);
});

test('Preview uses production APIs with isolated package, data, builder, and installer identity', () => {
  const definitions = runtimeProfileConfig.readProfileDefinitions(projectRoot);
  assert.equal(
    definitions.release_preview.VITE_BITTERLESS_CORE_URL,
    definitions.release_prod.VITE_BITTERLESS_CORE_URL
  );

  const before = source('scripts/before.js');
  assert.match(before, /pkg\.name = `\$\{baseName\}_PREVIEW`/);
  assert.match(before, /`\$\{baseName\} Preview`/);
  assert.match(before, /io\.bitterless\.desktop\.preview/);
  assert.match(before, /isPreview \? 'dist\/preview' : \(isDev \? 'dist\/dev' : 'dist'\)/);
  assert.match(before, /isPreview \? 'icon-preview' : 'icon'/);
  assert.match(before, /Preview does not own the Stable OnlyPreview shell registration/);
  assert.match(before, /Preview must not remove the Stable OnlyPreview shell registration/);

  const builder = source('electron-builder.tmp.yml');
  assert.match(builder, /^  output: dist$/m);
  assert.match(builder, /^  icon: build\/icon\.ico$/m);
  assert.match(builder, /^  icon: build\/icon\.icns$/m);
  const installer = source('build/installer.tmp.nsh');
  assert.match(installer, /^ONLY_PREVIEW_INSTALL$/m);
  assert.match(installer, /^ONLY_PREVIEW_UNINSTALL$/m);

  const runtime = source('src/main/environment/runtimeProfile.runtime.ts');
  assert.ok(
    runtime.indexOf('app.setName(profile.appName)') <
      runtime.indexOf("app.setPath('userData', userDataPath)")
  );
  assert.match(runtime, /app\.setPath\('sessionData', userDataPath\)/);
  const bootstrap = source('src/main/environment/runtimeProfile.bootstrap.ts');
  const appMain = source('src/main/app.main.ts');
  assert.match(bootstrap, /electronApp\.setAppUserModelId\(profile\.appId\)/);
  assert.doesNotMatch(appMain, /setAppUserModelId/);
  assert.equal(
    appMain.indexOf("import { runtimeProfile } from '@main/environment/runtimeProfile.bootstrap';"),
    0,
    'runtime profile bootstrap must remain the first Main import'
  );
  assert.ok(
    bootstrap.indexOf('electronApp.setAppUserModelId(profile.appId)') >
      bootstrap.indexOf('const profile = applyRuntimeProfile()'),
    'AppUserModelID must be assigned as part of early profile bootstrap'
  );
  assert.ok(
    bootstrap.indexOf('electronApp.setAppUserModelId(profile.appId)') >= 0 &&
      appMain.indexOf("import { runtimeProfile } from '@main/environment/runtimeProfile.bootstrap';") <
        appMain.indexOf('const startCoreSqliteRenderer'),
    'setAppUserModelId must run through the first-import bootstrap before startCoreSqliteRenderer'
  );
});

test('before.js isolates Development release output from Stable artifacts', () => {
  const definitions = runtimeProfileConfig.readProfileDefinitions(projectRoot);
  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-dev-before-'));
  try {
    for (const directory of ['build', 'scripts', 'scripts/environment']) {
      mkdirSync(join(tempRoot, directory), { recursive: true });
    }
    for (const relativePath of [
      'env.rig.json5',
      'electron-builder.tmp.yml',
      'scripts/before.js',
      'scripts/environment/runtimeProfile.config.cjs',
      'build/installer.tmp.nsh'
    ]) {
      writeFileSync(join(tempRoot, relativePath), source(relativePath));
    }
    writeFileSync(
      join(tempRoot, 'package.json'),
      `${JSON.stringify(
        {
          _name: 'Bitterless',
          _version: '0.0.83',
          name: 'Bitterless',
          version: '0.0.83',
          version_code: '260901131822'
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(tempRoot, '.env.rig'),
      [
        'MODE = release_dev',
        'VITE_ENV = dev',
        'VITE_MODE = release',
        'VITE_RELEASE_CHANNEL = dev',
        'VITE_MAIN_TITLE = BitterLess DEV',
        `VITE_BITTERLESS_CORE_URL = ${definitions.release_dev.VITE_BITTERLESS_CORE_URL}`,
        ''
      ].join('\n')
    );
    const result = spawnSync(process.execPath, ['scripts/before.js'], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: join(projectRoot, 'node_modules'),
        VITE_ENV: 'dev',
        VITE_MODE: 'release',
        VITE_RELEASE_CHANNEL: 'dev'
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const pkg = JSON.parse(readFileSync(join(tempRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'Bitterless_DEV');
    const builder = readFileSync(join(tempRoot, 'electron-builder.yml'), 'utf8');
    assert.match(builder, /^appId: io\.bitterless\.desktop_dev$/m);
    assert.match(builder, /^productName: Bitterless_DEV$/m);
    assert.match(builder, /^  output: dist\/dev$/m);
    assert.match(builder, /^  executableName: Bitterless_DEV$/m);
    const versionInfo = JSON.parse(
      readFileSync(join(tempRoot, 'dist', 'dev', 'version_info.json'), 'utf8')
    );
    assert.equal(versionInfo.channel, 'dev');
    assert.equal(versionInfo.version, '0.0.83');
    assert.equal(versionInfo.versionCode, '260901131822');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('before.js generates an exact Preview package without touching Stable shell integration', () => {
  const definitions = runtimeProfileConfig.readProfileDefinitions(projectRoot);
  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-preview-before-'));
  try {
    for (const directory of ['build', 'scripts', 'scripts/environment']) {
      mkdirSync(join(tempRoot, directory), { recursive: true });
    }
    for (const relativePath of [
      'env.rig.json5',
      'electron-builder.tmp.yml',
      'scripts/before.js',
      'scripts/environment/runtimeProfile.config.cjs',
      'build/installer.tmp.nsh'
    ]) {
      writeFileSync(join(tempRoot, relativePath), source(relativePath));
    }
    writeFileSync(
      join(tempRoot, 'package.json'),
      `${JSON.stringify(
        {
          _name: 'Bitterless',
          _version: '0.0.79',
          name: 'Bitterless',
          version: '0.0.79',
          version_code: '260831120000'
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(tempRoot, '.env.rig'),
      [
        'MODE = release_preview',
        'VITE_ENV = prod',
        'VITE_MODE = release',
        'VITE_RELEASE_CHANNEL = preview',
        'VITE_MAIN_TITLE = BitterLess Preview',
        `VITE_BITTERLESS_CORE_URL = ${definitions.release_preview.VITE_BITTERLESS_CORE_URL}`,
        ''
      ].join('\n')
    );
    const result = spawnSync(process.execPath, ['scripts/before.js'], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: join(projectRoot, 'node_modules'),
        VITE_ENV: 'prod',
        VITE_MODE: 'release',
        VITE_RELEASE_CHANNEL: 'preview'
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const pkg = JSON.parse(readFileSync(join(tempRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'Bitterless_PREVIEW');
    const builder = readFileSync(join(tempRoot, 'electron-builder.yml'), 'utf8');
    assert.match(builder, /^appId: io\.bitterless\.desktop\.preview$/m);
    assert.match(builder, /^productName: Bitterless Preview$/m);
    assert.match(builder, /^  output: dist\/preview$/m);
    assert.match(builder, /^  executableName: Bitterless Preview$/m);
    assert.match(builder, /^  icon: build\/icon-preview\.ico$/m);
    assert.match(builder, /^  icon: build\/icon-preview\.icns$/m);
    assert.match(builder, /Bitterless-Preview-\$\{version\}/);
    const installer = readFileSync(join(tempRoot, 'build', 'installer.nsh'), 'utf8');
    assert.doesNotMatch(installer, /Software\\Classes\\\*\\shell\\OnlyPreview/);
    assert.match(installer, /Preview does not own the Stable OnlyPreview shell registration/);
    assert.match(installer, /Preview must not remove the Stable OnlyPreview shell registration/);
    const versionInfo = JSON.parse(
      readFileSync(join(tempRoot, 'dist', 'preview', 'version_info.json'), 'utf8')
    );
    assert.equal(versionInfo.channel, 'preview');
    assert.equal(versionInfo.version, '0.0.79');
    assert.equal(versionInfo.versionCode, '260831120000');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('debug-only storage, DevTools, and path behavior reads compiled VITE_MODE', () => {
  const sqliteKey = source('src/main/maestro/security/sqliteKey.service.ts');
  assert.match(sqliteKey, /import\.meta\.env\.VITE_MODE/);
  assert.doesNotMatch(sqliteKey, /import\.meta\.env\.VITE_ENV/);

  for (const path of [
    'src/main/windows/window.helper.ts',
    'src/main/windows/llamaWindow.helper.ts',
    'src/main/windows/omniWindow.helper.ts'
  ]) {
    const windowSource = source(path);
    assert.match(windowSource, /import\.meta\.env\.VITE_MODE === 'debug'/, path);
    assert.doesNotMatch(windowSource, /VITE_ENV === 'dev'/, path);
  }

  const maestroPath = source('src/shared/maestro/pathHelper/main/pathMain.helper.ts');
  assert.match(maestroPath, /import\.meta\.env\.VITE_MODE === 'release'/);
  assert.doesNotMatch(maestroPath, /process\.env\.VITE_MODE/);

  const updater = source('src/main/updateHelper/update.service.ts');
  assert.doesNotMatch(updater, /import\.meta\.env\.VITE_(?:ENV|MODE)\s*\|\|/);
});

test('both E2E fixtures force debug and reject a stale release build marker', async () => {
  const runtimeMode = await loadE2ERuntimeModule();
  const environment = runtimeMode.withDebugE2ERuntimeEnvironment({
    VITE_ENV: 'prod',
    VITE_MODE: 'release',
    VITE_RELEASE_CHANNEL: 'preview'
  });
  assert.equal(environment.VITE_ENV, 'dev');
  assert.equal(environment.VITE_MODE, 'debug');
  assert.equal(environment.VITE_RELEASE_CHANNEL, 'dev');
  for (const fixture of [
    'tests/maestro/fixtures/bitterlessApp.fixture.ts',
    'tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts'
  ]) {
    assert.match(source(fixture), /withDebugE2ERuntimeEnvironment/);
    assert.match(source(fixture), /assertDebugE2EBuild\(projectRoot\)/);
    assert.match(source(fixture), /assertElectronDebugRuntime\(app\)/);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-e2e-mode-'));
  try {
    const markerPath = join(tempRoot, runtimeMode.E2E_BUILD_PROFILE_MARKER);
    mkdirSync(join(tempRoot, 'out'), { recursive: true });
    writeFileSync(
      markerPath,
      JSON.stringify({
        schemaVersion: 1,
        profileName: 'release_prod',
        releaseChannel: 'prod',
        viteEnv: 'prod',
        viteMode: 'release'
      })
    );
    assert.throws(() => runtimeMode.assertDebugE2EBuild(tempRoot), /fresh debug_dev build/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
