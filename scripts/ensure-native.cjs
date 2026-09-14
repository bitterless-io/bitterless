#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..');
const localRequire = createRequire(join(projectRoot, 'package.json'));

// The installed Electron executable is the ABI authority. Node itself can successfully load a
// Node prebuild that will fail as soon as the SQLite preload opens under Electron.
const PROBE = `
const runtime = {
  electron: process.versions.electron,
  node: process.versions.node,
  modules: process.versions.modules,
  platform: process.platform,
  arch: process.arch
};
try {
  const Database = require(process.argv[1]);
  const db = new Database(':memory:');
  try {
    if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite query failed');
  } finally {
    db.close();
  }
  console.log(JSON.stringify({ ...runtime, ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ...runtime, ok: false, error: error.message }));
  process.exitCode = 1;
}
`;

const probeNative = (electronPath, nativeEntry) => {
  const result = spawnSync(electronPath, ['-e', PROBE, nativeEntry], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  if (result.error) throw new Error(`Electron probe failed: ${result.error.message}`);
  let runtime;
  try {
    runtime = JSON.parse((result.stdout || '').trim());
  } catch {
    throw new Error(`Electron could not run the native probe (exit ${result.status}, signal ${result.signal || 'none'}). Repair the local Electron installation before retrying.`);
  }
  if (!runtime.electron || !runtime.modules || !runtime.arch || !runtime.platform) {
    throw new Error('Native probe did not run under a valid Electron runtime.');
  }
  return { ...runtime, ok: runtime.ok === true && result.status === 0 };
};

const ensureNative = () => {
  const electronPath = localRequire('electron');
  const nativeEntry = localRequire.resolve('better-sqlite3-multiple-ciphers');
  const before = probeNative(electronPath, nativeEntry);
  const target = `Electron ${before.electron}, ABI ${before.modules}, ${before.platform}-${before.arch}`;
  if (before.ok) {
    console.log(`[ensure-native] SQLite ready (${target}); no rebuild needed.`);
    return { repaired: false, runtime: before };
  }

  console.log(`[ensure-native] SQLite cannot load under ${target}; rebuilding its native dependency.`);
  const args = [
    'electron-rebuild', '--force', '--version', before.electron,
    '--arch', before.arch, '--module-dir', projectRoot,
    '--only', 'better-sqlite3-multiple-ciphers'
  ];
  // Yarn passes its JS entry point to lifecycle scripts, which also avoids .cmd shell quoting on
  // Windows. Direct Node invocation remains usable on macOS; Windows should use prepare:native.
  const yarnEntry = process.env.npm_execpath;
  const hasYarnEntry = yarnEntry && /(?:^|[\\/])yarn(?:\.c?js)?$/i.test(yarnEntry);
  if (process.platform === 'win32' && !hasYarnEntry) {
    throw new Error('Run yarn prepare:native so the Windows Yarn executable is resolved safely.');
  }
  const result = spawnSync(hasYarnEntry ? process.execPath : 'yarn', hasYarnEntry ? [yarnEntry, ...args] : args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(`SQLite native rebuild failed; run yarn prepare:native after fixing the reported build error.${result.error ? ` ${result.error.message}` : ''}`);
  }
  const after = probeNative(electronPath, nativeEntry);
  if (!after.ok) {
    throw new Error(`SQLite still cannot load after rebuilding for ${target}: ${after.error || 'native probe failed'}`);
  }
  console.log(`[ensure-native] SQLite repaired and verified (${target}).`);
  return { repaired: true, runtime: after };
};

module.exports = { ensureNative };
if (require.main === module) {
  try {
    ensureNative();
  } catch (error) {
    console.error(`[ensure-native] ${error.message}`);
    process.exitCode = 1;
  }
}
