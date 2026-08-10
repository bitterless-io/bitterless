/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
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
        { viteEnv: definitions[name].VITE_ENV, viteMode: definitions[name].VITE_MODE }
      ])
    ),
    {
      debug_dev: { viteEnv: 'dev', viteMode: 'debug' },
      debug_prod: { viteEnv: 'prod', viteMode: 'debug' },
      release_dev: { viteEnv: 'dev', viteMode: 'release' },
      release_prod: { viteEnv: 'prod', viteMode: 'release' }
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
      'MODE = debug_prod\nVITE_MODE = debug_prod\nVITE_ENV = prod\nVITE_MODE = debug\n'
    );
    runtimeProfileConfig.normalizeRigEnvironment(tempRoot, 'debug_prod');
    const canonical = readFileSync(join(tempRoot, '.env.rig'), 'utf8');
    assert.equal((canonical.match(/^VITE_MODE\s*=/gm) ?? []).length, 1);
    assert.match(canonical, /^VITE_MODE = debug$/m);
    assert.deepEqual(runtimeProfileConfig.loadCanonicalRigEnvironment(tempRoot), {
      environment: { MODE: 'debug_prod', VITE_ENV: 'prod', VITE_MODE: 'debug' },
      profileName: 'debug_prod',
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
  try {
    const envPath = join(tempRoot, '.env.rig');
    writeFileSync(envPath, 'VITE_ENV = dev\nVITE_MODE = debug\n');
    process.env.VITE_MODE = 'release';
    process.env.VITE_ENV = 'prod';
    const result = dotenvConfig({ path: envPath, override: true });
    assert.equal(result.error, undefined);
    assert.equal(process.env.VITE_MODE, 'debug');
    assert.equal(process.env.VITE_ENV, 'dev');
  } finally {
    if (previousMode === undefined) delete process.env.VITE_MODE;
    else process.env.VITE_MODE = previousMode;
    if (previousEnvironment === undefined) delete process.env.VITE_ENV;
    else process.env.VITE_ENV = previousEnvironment;
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
    'build_dev:win': 'release_dev'
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
  assert.match(bootstrap, /catch \(error\)[\s\S]*terminateInvalidRuntimeProfile\(error\)/);
  assert.match(bootstrap, /app\.exit\(1\)[\s\S]*throw runtimeError/);
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
    VITE_MODE: 'release'
  });
  assert.equal(environment.VITE_ENV, 'dev');
  assert.equal(environment.VITE_MODE, 'debug');
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
        viteEnv: 'prod',
        viteMode: 'release'
      })
    );
    assert.throws(() => runtimeMode.assertDebugE2EBuild(tempRoot), /fresh debug_dev build/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
