const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const projectRoot = resolve(__dirname, '..');
const source = readFileSync(join(__dirname, 'ensure-native.cjs'), 'utf8');
const runtime = { electron: '40.10.6', node: '24.15.0', modules: '143', platform: 'darwin', arch: 'arm64' };
const probeResult = (ok) => ({ status: ok ? 0 : 1, stdout: JSON.stringify({ ...runtime, ok, ...(ok ? {} : { error: 'NODE_MODULE_VERSION 137 instead of 143' }) }) });

const fixture = (results, environment = {}) => {
  const calls = [];
  const logs = [];
  const localRequire = (name) => {
    assert.equal(name, 'electron');
    return '/runtime/Electron';
  };
  localRequire.resolve = (name) => {
    assert.equal(name, 'better-sqlite3-multiple-ciphers');
    return '/modules/sqlite/lib/index.js';
  };
  const dependencies = {
    'node:child_process': { spawnSync: (...args) => { calls.push(args); assert.ok(results.length, 'unexpected extra process'); return results.shift(); } },
    'node:module': { createRequire: () => localRequire },
    'node:path': require('node:path')
  };
  const module = { exports: {} };
  const sandboxRequire = (name) => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; };
  const context = {
    require: sandboxRequire, module, __dirname,
    process: { env: environment, execPath: '/runtime/node', platform: 'darwin' },
    console: { log: (text) => logs.push(text), error: (text) => logs.push(text) }
  };
  vm.runInNewContext(source, context, { filename: 'ensure-native.cjs' });
  return { ensureNative: module.exports.ensureNative, calls, logs, process: context.process };
};

test('a compatible native binding is probed headlessly and never rebuilt', () => {
  const harness = fixture([probeResult(true)]);
  assert.equal(harness.ensureNative().repaired, false);
  assert.equal(harness.calls.length, 1);
  const [command, args, options] = harness.calls[0];
  assert.equal(command, '/runtime/Electron');
  assert.equal(args[0], '-e');
  assert.equal(args[2], '/modules/sqlite/lib/index.js');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.match(args[1], /new Database\(':memory:'\)/);
  assert.match(args[1], /SELECT 1 AS ok/);
  assert.ok(harness.logs.some((line) => /no rebuild needed/.test(line)));
});

test('same-architecture ABI mismatch rebuilds only SQLite for the actual Electron and then verifies it', () => {
  const harness = fixture([probeResult(false), { status: 0 }, probeResult(true)]);
  assert.equal(harness.ensureNative().repaired, true);
  assert.equal(harness.calls.length, 3);
  const [command, args, options] = harness.calls[1];
  assert.equal(command, 'yarn');
  assert.deepEqual(Array.from(args), [
    'electron-rebuild', '--force', '--version', '40.10.6', '--arch', 'arm64',
    '--module-dir', projectRoot, '--only', 'better-sqlite3-multiple-ciphers'
  ]);
  assert.equal(options.cwd, projectRoot);
  assert.equal(harness.calls[2][0], '/runtime/Electron');
});

test('a failed native rebuild stops immediately instead of accepting a broken dependency', () => {
  const harness = fixture([probeResult(false), { status: 2 }]);
  assert.throws(() => harness.ensureNative(), /native rebuild failed/);
  assert.equal(harness.calls.length, 2);
});

test('a rebuild reporting success still fails the guard when the binding remains incompatible', () => {
  const harness = fixture([probeResult(false), { status: 0 }, probeResult(false)]);
  assert.throws(() => harness.ensureNative(), /still cannot load after rebuilding/);
  assert.equal(harness.calls.length, 3);
});

test('a broken or non-Electron executable is not misdiagnosed as a rebuildable SQLite ABI problem', () => {
  for (const result of [
    { status: 1, signal: 'SIGABRT', stdout: '' },
    { status: 0, stdout: JSON.stringify({ ok: true, node: '24.16.0', modules: '137', arch: 'arm64' }) },
    { status: null, error: new Error('probe timeout') }
  ]) {
    const harness = fixture([result]);
    assert.throws(() => harness.ensureNative(), /Electron|probe timeout/);
    assert.equal(harness.calls.length, 1);
  }
});

test('Yarn lifecycle entry preserves Windows paths without invoking a shell', () => {
  const harness = fixture([probeResult(false), { status: 0 }, probeResult(true)], { npm_execpath: 'C:\\Yarn Home\\bin\\yarn.js' });
  harness.process.platform = 'win32';
  harness.ensureNative();
  const [command, args, options] = harness.calls[1];
  assert.equal(command, '/runtime/node');
  assert.equal(args[0], 'C:\\Yarn Home\\bin\\yarn.js');
  assert.equal(args[1], 'electron-rebuild');
  assert.equal(options.shell, undefined);
});

test('all DEBUG launcher paths run the guard before invoking their original scripts', () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  for (const script of ['_dev:debug', '_start:debug', '_build:debug']) {
    assert.equal(pkg.scripts[`pre${script}`], 'node scripts/ensure-native.cjs');
    assert.ok(pkg.scripts[script].includes('electron-vite'));
  }
  assert.equal(pkg.scripts['prepare:native'], 'node scripts/ensure-native.cjs');
  assert.equal(pkg.scripts['pre_build:release'], undefined, 'cross-target packaging retains its existing rebuild flow');
});
