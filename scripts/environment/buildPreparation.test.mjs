/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import runtimeProfileConfig from './runtimeProfile.config.cjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const initialPackage = {
  _name: 'Bitterless',
  _version: '0.0.100',
  name: 'Bitterless_DEBUG_PROD',
  version: '0.0.100',
  version_code: '260910164530'
};

const createFixture = (t, profileName, overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-build-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    'scripts/before.js',
    'scripts/environment/runtimeProfile.config.cjs',
    'env.rig.json5',
    'electron-builder.tmp.yml',
    'build/installer.tmp.nsh'
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(join(projectRoot, path)));
  }
  const profile = runtimeProfileConfig.readProfileDefinitions(projectRoot)[profileName];
  writeFileSync(
    join(root, '.env.rig'),
    [
      `MODE = ${profileName}`,
      `VITE_ENV = ${profile.VITE_ENV}`,
      `VITE_MODE = ${profile.VITE_MODE}`,
      `VITE_RELEASE_CHANNEL = ${profile.VITE_RELEASE_CHANNEL}`,
      ''
    ].join('\n')
  );
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ ...initialPackage, ...overrides }, null, 2)}\n`
  );
  const prepare = (now) => {
    writeFileSync(
      join(root, 'clock.cjs'),
      `require('moment').now = () => ${JSON.stringify(now)};\n`
    );
    return spawnSync(process.execPath, ['--require', './clock.cjs', 'scripts/before.js'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: join(projectRoot, 'node_modules'),
        TZ: 'Asia/Shanghai',
        VITE_ENV: profile.VITE_ENV,
        VITE_MODE: profile.VITE_MODE,
        VITE_RELEASE_CHANNEL: profile.VITE_RELEASE_CHANNEL
      }
    });
  };
  return {
    root,
    prepare,
    package: () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    versionInfo: () =>
      JSON.parse(
        readFileSync(
          join(
            root,
            profile.VITE_RELEASE_CHANNEL === 'preview'
              ? 'dist/preview/version_info.json'
              : profile.VITE_ENV === 'dev'
                ? 'dist/dev/version_info.json'
                : 'dist/version_info.json'
          ),
          'utf8'
        )
      )
  };
};

const assertPrepared = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);

for (const profile of ['debug_dev', 'debug_prod']) {
  test(`${profile} refreshes a stale build, reuses the same second, and advances on the next local day`, (t) => {
    const fixture = createFixture(t, profile);
    const now = Date.parse('2026-09-12T23:59:59+08:00');
    for (const [time, expected] of [
      [now, '260912235959'],
      [now + 999, '260912235959'],
      [now + 1000, '260913000000']
    ]) {
      assertPrepared(fixture.prepare(time));
      const pkg = fixture.package();
      assert.equal(pkg.version_code, expected);
      assert.equal(pkg.version, initialPackage.version);
      assert.equal(pkg._version, initialPackage._version);
      assert.equal(
        pkg.name,
        profile === 'debug_dev' ? 'Bitterless_DEBUG_DEV' : 'Bitterless_DEBUG_PROD'
      );
      assert.equal(fixture.versionInfo().versionCode, expected);
    }
  });
}

test('DEBUG rejects a backwards clock without writing package or build metadata', (t) => {
  const fixture = createFixture(t, 'debug_prod', { version_code: '260913000000' });
  const before = readFileSync(join(fixture.root, 'package.json'), 'utf8');
  const result = fixture.prepare(Date.parse('2026-09-12T23:59:59+08:00'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /current clock 260912235959 is older than version_code 260913000000/);
  assert.equal(readFileSync(join(fixture.root, 'package.json'), 'utf8'), before);
  assert.equal(existsSync(join(fixture.root, 'electron-builder.yml')), false);
  assert.equal(existsSync(join(fixture.root, 'dist/version_info.json')), false);
});

test('invalid existing timestamp still fails closed before DEBUG refresh', (t) => {
  const fixture = createFixture(t, 'debug_prod', { version_code: '260231120000' });
  const result = fixture.prepare(Date.parse('2026-09-12T12:00:00+08:00'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version_code must be a YYMMDDHHmmss string/);
  assert.equal(fixture.package().version_code, '260231120000');
});

for (const profile of ['release_dev', 'release_prod', 'release_preview']) {
  test(`${profile} preserves the cut release identity regardless of the build clock`, (t) => {
    const fixture = createFixture(t, profile);
    for (const now of [
      Date.parse('2026-09-01T12:00:00+08:00'),
      Date.parse('2026-09-30T12:00:00+08:00')
    ]) {
      assertPrepared(fixture.prepare(now));
      const pkg = fixture.package();
      assert.equal(pkg.version_code, initialPackage.version_code);
      assert.equal(pkg.version, initialPackage.version);
      assert.equal(pkg._version, initialPackage._version);
      assert.equal(fixture.versionInfo().versionCode, initialPackage.version_code);
      assert.equal(fixture.versionInfo().version, initialPackage.version);
    }
  });
}

test('Maestro boot passes the prepared embedded version and preserves the bootstrap argument contract', async (t) => {
  const fixture = createFixture(t, 'debug_prod');
  assertPrepared(fixture.prepare(Date.parse('2026-09-12T20:30:00+08:00')));
  const embeddedVersion = fixture.package().version_code;
  const result = await build({
    entryPoints: [join(projectRoot, 'src/preload/maestro/sqlite.preload.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    define: { __BITTERLESS_VERSION_CODE__: JSON.stringify(embeddedVersion) },
    plugins: [
      {
        name: 'isolated-preload-dependencies',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.kind === 'entry-point'
              ? undefined
              : {
                  path: args.path,
                  namespace: 'preload-fixture'
                }
          );
          builder.onLoad({ filter: /.*/, namespace: 'preload-fixture' }, ({ path }) => {
            if (path === 'fs')
              return {
                contents:
                  'export const readFileSync = globalThis.fixture.readFileSync; export const unlinkSync = globalThis.fixture.unlinkSync;'
              };
            if (path === 'electron-xpc/preload')
              return {
                contents:
                  'export class XpcPreloadHandler {} export const createXpcPreloadEmitter = () => globalThis.fixture.keyService;'
              };
            if (path === './sqlite/sqliteManager')
              return { contents: 'export const sqliteManager = globalThis.fixture.sqliteManager;' };
            if (path === './sqlite/crmsSessionResidue')
              return { contents: 'export const clearCrmsSessionResidue = () => {};' };
            return { contents: '' };
          });
        }
      }
    ]
  });
  const runBoot = async (fail) => {
    const calls = [];
    const module = { exports: {} };
    runInNewContext(result.outputFiles[0].text, {
      module,
      exports: module.exports,
      Error,
      process: { argv: ['--coach-sqlite-bootstrap-file=/fixture/bootstrap'] },
      location: { pathname: '/maestro/sqlite/index.html' },
      console: { error: (...args) => calls.push(['error', ...args]) },
      fixture: {
        readFileSync: (path) => {
          assert.equal(
            path,
            '/fixture/bootstrap',
            'boot must never read stale runtime app-meta or package metadata'
          );
          calls.push(['read', path]);
          return 'fixture-token';
        },
        unlinkSync: (path) => calls.push(['unlink', path]),
        keyService: {
          getSqliteKey: async ({ bootstrapToken }) => {
            assert.equal(bootstrapToken, 'fixture-token');
            return 'fixture-key';
          }
        },
        sqliteManager: {
          init: (version, key) => {
            calls.push(['init', version, key]);
            if (fail) throw new Error('fixture migration failure');
          }
        }
      }
    });
    const ready = await module.exports.sqliteBootDao.ready();
    assert.equal(ready.ok, !fail);
    assert.deepEqual(
      calls.filter(([name]) => name === 'init'),
      [['init', embeddedVersion, 'fixture-key']]
    );
    assert.deepEqual(
      calls.filter(([name]) => name === 'unlink'),
      [['unlink', '/fixture/bootstrap']]
    );
    if (fail) {
      assert.equal(ready.error, 'fixture migration failure');
      assert.equal(calls.find(([name]) => name === 'error')[1], '[maestro sqlite] init failed:');
    }
  };
  await runBoot(false);
  await runBoot(true);
});
