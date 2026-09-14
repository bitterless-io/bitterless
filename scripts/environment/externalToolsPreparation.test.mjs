/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const projectRoot = resolve(import.meta.dirname, '..', '..');
const toolsModule = join(projectRoot, 'scripts/maestro/externalTools.cjs');
const {
  INVENTORY,
  STORE_PLATFORMS,
  BINARY_TOOL_NAMES,
  MANIFEST_FILENAME,
  createManifest
} = require(toolsModule);
const debugCommands = [
  ['dev', 'dev', 'debug_dev'],
  ['dev:prod', 'dev', 'debug_prod'],
  ['build', 'build', 'debug_dev'],
  ['start', 'preview', 'debug_dev']
];
const write = (file, contents, executable = false) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  if (executable) chmodSync(file, 0o755);
};
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

const createFixture = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bitterless-debug-tools-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inventory = structuredClone(INVENTORY);
  const actualPackage = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const scriptNames = [
    'tools:init',
    '_dev:debug',
    '_build:debug',
    '_start:debug',
    ...debugCommands.map(([name]) => name)
  ];
  const pkg = {
    _name: 'Bitterless',
    _version: '0.0.100',
    name: 'Bitterless_DEBUG_DEV',
    version: '0.0.100',
    version_code: '260101000000',
    scripts: Object.fromEntries(scriptNames.map((name) => [name, actualPackage.scripts[name]]))
  };
  for (const tool of [...BINARY_TOOL_NAMES, 'anydoc']) {
    pkg[inventory[tool].versionKey] = inventory[tool].version;
  }
  write(join(root, 'package.json'), JSON.stringify(pkg));
  for (const file of [
    'scripts/before.js',
    'scripts/environment/runWithRuntimeProfile.cjs',
    'scripts/environment/assertRuntimeProfile.cjs',
    'scripts/environment/runtimeProfile.config.cjs',
    'env.rig.json5',
    'electron-builder.tmp.yml',
    'build/installer.tmp.nsh'
  ]) {
    write(join(root, file), readFileSync(join(projectRoot, file)));
  }

  const bundle = {
    'anydoc.js': 'module.exports = {};\n',
    'cli.js': '#!/usr/bin/env node\n',
    'index.js': 'module.exports = {};\n',
    'package.json': JSON.stringify({ name: '@firecrawl/anydoc', version: inventory.anydoc.version })
  };
  for (const [name, contents] of Object.entries(bundle)) {
    inventory.anydoc.bundle[name].sha256 = sha256(contents);
  }
  for (const platform of STORE_PLATFORMS) {
    const directory = join(root, 'external_tools', platform);
    write(join(directory, '.gitkeep'), '');
    for (const name of BINARY_TOOL_NAMES) {
      const contents = `${platform}:${name}:fixture\n`;
      const target = inventory[name].targets[platform];
      target.sha256 = sha256(contents);
      write(join(directory, target.output), contents, platform !== 'win');
    }
    for (const [name, contents] of Object.entries(bundle)) {
      write(join(directory, 'anydoc', name), contents);
    }
    const native = `${platform}:anydoc-native:fixture\n`;
    inventory.anydoc.targets[platform].sha256 = sha256(native);
    write(join(directory, inventory.anydoc.targets[platform].output), native);
    write(
      join(directory, MANIFEST_FILENAME),
      JSON.stringify(createManifest(directory, platform, inventory))
    );
  }
  write(join(root, 'inventory.json'), JSON.stringify(inventory));

  // Only the CLI adapter supplies small fixture payloads. Validation, initialization, and staging
  // execute the production exports with real SHA-256 checks; any download/process attempt fails.
  write(
    join(root, 'scripts/maestro/externalTools.cjs'),
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const forbid = () => {
  fs.appendFileSync(path.join(root, 'forbidden-operations.log'), 'attempt\n');
  throw new Error('fixture forbids downloads and external processes');
};
for (const name of ['execFileSync', 'execSync', 'spawn', 'spawnSync', 'execFile', 'exec']) {
  require('node:child_process')[name] = forbid;
}
for (const protocol of ['node:http', 'node:https']) {
  require(protocol).request = forbid;
  require(protocol).get = forbid;
}
globalThis.fetch = forbid;
const tools = require(${JSON.stringify(toolsModule)});
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json'), 'utf8'));
try {
  const command = process.argv[2];
  if (command === 'init') {
    tools.initializeAll(root, false, inventory, {
      packageTarget: 'mac_arm', initializeBinary: forbid,
      initializeDocumentBundle: forbid, initializeDocumentNative: forbid
    });
  } else if (command === 'stage') {
    tools.stageExternalTools(root, 'mac_arm', inventory);
  } else {
    throw new Error('unexpected fixture CLI command: ' + command);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`
  );

  const bin = join(root, 'node_modules', '.bin');
  write(
    join(bin, 'rig'),
    String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const profile = process.argv[3];
const definitions = require('json5').parse(fs.readFileSync('env.rig.json5', 'utf8'));
if (process.argv[2] !== '--env' || !definitions[profile]) process.exit(2);
const selected = definitions[profile];
fs.writeFileSync('.env.rig', [
  'MODE = ' + profile, 'VITE_ENV = ' + selected.VITE_ENV,
  'VITE_MODE = ' + selected.VITE_MODE,
  'VITE_RELEASE_CHANNEL = ' + selected.VITE_RELEASE_CHANNEL, ''
].join('\n'));
`,
    true
  );
  write(
    join(bin, 'electron-vite'),
    String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const binary = path.join(process.cwd(), 'build', 'maestro-tools', 'zellij');
if (fs.readFileSync(binary, 'utf8') !== 'mac_arm:zellij:fixture\n') process.exit(3);
const mode = fs.readFileSync('.env.rig', 'utf8').match(/^MODE = (.+)$/m)[1];
fs.appendFileSync('launches.jsonl', JSON.stringify({ command: process.argv[2], mode, binary }) + '\n');
`,
    true
  );
  for (const name of ['rig', 'electron-vite']) {
    write(join(bin, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}" %*\r\n`);
  }

  const run = (command) =>
    spawnSync('yarn', ['--silent', command], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_PATH: join(projectRoot, 'node_modules'),
        PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
        YARN_DISABLE_SELF_UPDATE_CHECK: '1'
      }
    });
  const launches = () =>
    existsSync(join(root, 'launches.jsonl'))
      ? readFileSync(join(root, 'launches.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
      : [];
  const assertOffline = () =>
    assert.equal(existsSync(join(root, 'forbidden-operations.log')), false);
  return { root, run, launches, assertOffline, stage: join(root, 'build/maestro-tools') };
};

const assertSuccess = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);
const mtimes = (root) => {
  const result = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else result[file] = statSync(file, { bigint: true }).mtimeNs.toString();
    }
  };
  walk(root);
  return result;
};
const assertLaunch = (fixture, command, mode) => {
  const last = fixture.launches().at(-1);
  assert.deepEqual(last, { command, mode, binary: join(fixture.stage, 'zellij') });
};

test('tools:init readies the runtime path; repeated init and every DEBUG alias preserve valid dependencies', (t) => {
  const fixture = createFixture(t);
  const storesBefore = mtimes(join(fixture.root, 'external_tools'));
  assertSuccess(fixture.run('tools:init'));
  assert.equal(readFileSync(join(fixture.stage, 'zellij'), 'utf8'), 'mac_arm:zellij:fixture\n');
  const stagedBefore = mtimes(fixture.stage);
  assertSuccess(fixture.run('tools:init'));
  for (const [script, command, mode] of debugCommands) {
    assertSuccess(fixture.run(script));
    assertLaunch(fixture, command, mode);
  }
  assert.deepEqual(mtimes(join(fixture.root, 'external_tools')), storesBefore);
  assert.deepEqual(mtimes(fixture.stage), stagedBefore);
  assert.equal(fixture.launches().length, debugCommands.length);
  fixture.assertOffline();
});

test('each DEBUG alias repairs a missing stage offline before its launcher runs', (t) => {
  const fixture = createFixture(t);
  for (const [script, command, mode] of debugCommands) {
    rmSync(fixture.stage, { recursive: true, force: true });
    assertSuccess(fixture.run(script));
    assertLaunch(fixture, command, mode);
  }
  assert.equal(fixture.launches().length, debugCommands.length);
  fixture.assertOffline();
});

test('invalid cache with no stage blocks every DEBUG launcher and requests tools:init', (t) => {
  const fixture = createFixture(t);
  write(join(fixture.root, 'external_tools/mac_arm/zellij'), 'corrupt', true);
  for (const [script] of debugCommands) {
    const result = fixture.run(script);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /tools:init/);
  }
  assert.deepEqual(fixture.launches(), []);
  fixture.assertOffline();
});

test('a valid stage remains sufficient for every DEBUG alias when its source cache becomes invalid', (t) => {
  const fixture = createFixture(t);
  assertSuccess(fixture.run('tools:init'));
  const stagedBefore = mtimes(fixture.stage);
  write(join(fixture.root, 'external_tools/mac_arm/zellij'), 'corrupt', true);
  for (const [script, command, mode] of debugCommands) {
    assertSuccess(fixture.run(script));
    assertLaunch(fixture, command, mode);
  }
  assert.deepEqual(mtimes(fixture.stage), stagedBefore);
  fixture.assertOffline();
});
