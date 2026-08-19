import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-update-build-'));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-update-'));
const pluginId = 'bitterless-observer@bitterless-local';
const marketplaceName = 'bitterless-local';
const oldVersion = '0.260818.100000';
const newVersion = '0.260819.100000';
const installationId = '00000053-0000-4000-8000-000000000053';
const nextInstallationId = '00000054-0000-4000-8000-000000000054';

const outfile = join(buildRoot, 'claude-plugin-bridge.mjs');
await build({
  entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/claudePluginBridge.service.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});
const pluginModule = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const readBridgeState = (root) => JSON.parse(readFileSync(
  join(root, 'eyes-on-agents', 'claude-plugin-bridge.json'),
  'utf8'
));

const pluginManifestPath = (root) => join(
  root,
  'eyes-on-agents',
  'claude-marketplace',
  'plugins',
  'bitterless-observer',
  '.claude-plugin',
  'plugin.json'
);

const wrapperPath = (root) => join(
  root,
  'eyes-on-agents',
  'claude-marketplace',
  'plugins',
  'bitterless-observer',
  'scripts',
  process.platform === 'win32' ? 'observe.ps1' : 'observe.sh'
);

const outboxFile = (root, id = installationId) => join(
  root,
  'eyes-on-agents',
  'claude-hook-outbox',
  id,
  'pending',
  'owned-delivery.json'
);

const createHarness = (name) => {
  const root = join(fixtureRoot, name);
  mkdirSync(root, { recursive: true });
  const registry = {
    marketplace: false,
    installed: false,
    enabled: false,
    version: null,
    additionalPlugins: [],
    failInstallOnce: false,
    failUpdate: false
  };
  const commands = [];
  const runCommand = async (_executable, args) => {
    const command = args.join(' ');
    commands.push(command);
    if (command === 'plugin --help') {
      return { exitCode: 0, stdout: 'marketplace', stderr: '' };
    }
    if (command === 'plugin marketplace remove --help') {
      return { exitCode: 0, stdout: '--scope <scope>', stderr: '' };
    }
    if (command === 'plugin list --json') {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          ...(registry.installed ? [{
            id: pluginId,
            scope: 'user',
            enabled: registry.enabled,
            version: registry.version
          }] : []),
          ...registry.additionalPlugins
        ]),
        stderr: ''
      };
    }
    if (command === 'plugin marketplace list --json') {
      return {
        exitCode: 0,
        stdout: JSON.stringify(registry.marketplace ? [{
          name: marketplaceName,
          path: join(root, 'eyes-on-agents', 'claude-marketplace')
        }] : []),
        stderr: ''
      };
    }
    if (args[1] === 'marketplace' && args[2] === 'add') registry.marketplace = true;
    if (args[1] === 'uninstall') {
      registry.installed = false;
      registry.enabled = false;
      registry.version = null;
    }
    if (args[1] === 'install') {
      if (registry.failInstallOnce) {
        registry.failInstallOnce = false;
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      registry.installed = true;
      registry.enabled = true;
      registry.version = JSON.parse(readFileSync(pluginManifestPath(root), 'utf8')).version;
    }
    if (args[1] === 'update') {
      if (registry.failUpdate) return { exitCode: 1, stdout: '', stderr: '' };
      registry.version = JSON.parse(readFileSync(pluginManifestPath(root), 'utf8')).version;
    }
    if (args[1] === 'enable') registry.enabled = true;
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { root, registry, commands, runCommand };
};

const createService = ({
  harness,
  version,
  helperName,
  ids = [installationId],
  runtimeListening = true
}) => {
  const helperRoot = join(harness.root, helperName);
  const helper = join(helperRoot, 'claudeHookHelper.js');
  mkdirSync(helperRoot, { recursive: true });
  writeFileSync(helper, `module.exports = { generation: ${JSON.stringify(helperName)} };\n`);
  let idIndex = 0;
  return new pluginModule.ClaudePluginBridgeService({
    identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
    userDataPath: harness.root,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: helperRoot,
    pluginVersion: version,
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => ids[idIndex++],
    runtimeStatus: () => ({
      listening: runtimeListening,
      listeningSince: runtimeListening ? 100 : null
    }),
    runCommand: harness.runCommand
  });
};

const installObservedOldRelease = async (harness, ids = [installationId]) => {
  const service = createService({
    harness,
    version: oldVersion,
    helperName: 'old-helper',
    ids
  });
  await service.install();
  service.recordLiveReceipt(installationId, 100);
  const pending = outboxFile(harness.root);
  mkdirSync(dirname(pending), { recursive: true });
  writeFileSync(pending, '{"owned":true}\n');
  return service;
};

test('a trusted app release upgrades exact owned artifacts without rotating observation', async () => {
  const harness = createHarness('automatic-upgrade');
  await installObservedOldRelease(harness);
  const before = readBridgeState(harness.root);
  const oldWrapper = readFileSync(wrapperPath(harness.root), 'utf8');
  const commandStart = harness.commands.length;
  const upgraded = createService({
    harness,
    version: newVersion,
    helperName: 'new-helper',
    ids: [nextInstallationId]
  });

  const status = await upgraded.refresh();
  const after = readBridgeState(harness.root);
  const upgradeCommands = harness.commands.slice(commandStart);
  assert.equal(status.state, 'observing');
  assert.equal(status.setupAction, 'none');
  assert.equal(after.installationId, installationId);
  assert.equal(after.firstReceiptAt, before.firstReceiptAt);
  assert.equal(after.lastReceiptAt, before.lastReceiptAt);
  assert.equal(after.restartRequired, false);
  assert.notEqual(after.artifactDigest, before.artifactDigest);
  assert.equal(existsSync(outboxFile(harness.root)), true);
  assert(upgradeCommands.includes(`plugin marketplace update ${marketplaceName}`));
  assert(upgradeCommands.includes(`plugin update ${pluginId} --scope user`));
  assert.equal(upgradeCommands.some((command) => command.startsWith('plugin uninstall ')), false);
  assert.equal(upgradeCommands.some((command) => command.startsWith('plugin install ')), false);
  assert.match(oldWrapper, new RegExp(installationId));
  assert.match(readFileSync(wrapperPath(harness.root), 'utf8'), new RegExp(installationId));
  assert.equal(upgraded.acceptsInstallation(installationId), true);

  if (process.platform !== 'win32') chmodSync(wrapperPath(harness.root), 0o600);
  else writeFileSync(wrapperPath(harness.root), `${readFileSync(wrapperPath(harness.root), 'utf8')}# drift\n`);
  const repairStart = harness.commands.length;
  await upgraded.install();
  const repaired = readBridgeState(harness.root);
  const repairCommands = harness.commands.slice(repairStart);
  assert.equal(repaired.installationId, installationId);
  assert.equal(repaired.firstReceiptAt, 100);
  assert.equal(repaired.lastReceiptAt, 100);
  assert.equal(repaired.restartRequired, false);
  assert.equal(existsSync(outboxFile(harness.root)), true);
  assert(repairCommands.includes(`plugin uninstall ${pluginId} --scope user -y`));
  assert(repairCommands.includes(`plugin install ${pluginId} --scope user`));
});

test('a staged automatic upgrade resumes after process exit and preserves the old commit', async () => {
  const harness = createHarness('crash-resume');
  await installObservedOldRelease(harness);
  const before = readBridgeState(harness.root);
  harness.registry.failUpdate = true;
  const interrupted = createService({
    harness,
    version: newVersion,
    helperName: 'new-helper',
    ids: [nextInstallationId]
  });
  const failedStatus = await interrupted.refresh();
  assert.match(failedStatus.error ?? '', /Claude plugin update failed \(exit code 1\)/);
  assert.deepEqual(readBridgeState(harness.root), before,
    'artifact staging failure must leave the prior committed identity and receipts intact');
  assert.equal(existsSync(outboxFile(harness.root)), true);

  harness.registry.failUpdate = false;
  const restarted = createService({
    harness,
    version: newVersion,
    helperName: 'new-helper',
    ids: [nextInstallationId]
  });
  const resumedStatus = await restarted.refresh();
  const after = readBridgeState(harness.root);
  assert.equal(resumedStatus.state, 'observing');
  assert.equal(resumedStatus.error, null);
  assert.equal(after.installationId, installationId);
  assert.equal(after.firstReceiptAt, 100);
  assert.equal(after.lastReceiptAt, 100);
  assert.equal(existsSync(outboxFile(harness.root)), true);
});

test('Repair resumes after uninstall failure checkpoint with the same generation', async () => {
  const harness = createHarness('repair-retry');
  const service = await installObservedOldRelease(harness);
  const before = readBridgeState(harness.root);
  if (process.platform !== 'win32') chmodSync(wrapperPath(harness.root), 0o600);
  else writeFileSync(wrapperPath(harness.root), `${readFileSync(wrapperPath(harness.root), 'utf8')}# drift\n`);
  harness.registry.failInstallOnce = true;
  await assert.rejects(() => service.install(), /Claude plugin installation failed \(exit code 1\)/);
  assert.equal(harness.registry.installed, false,
    'the first Repair must reach the plugin-absent retry checkpoint');
  assert.deepEqual(readBridgeState(harness.root), before);
  assert.equal(existsSync(outboxFile(harness.root)), true);

  await service.install();
  const after = readBridgeState(harness.root);
  assert.equal(after.installationId, installationId);
  assert.equal(after.firstReceiptAt, 100);
  assert.equal(after.lastReceiptAt, 100);
  assert.equal(existsSync(outboxFile(harness.root)), true);
});

test('Repair re-enables an exact disabled plugin without rotating its generation', async () => {
  const harness = createHarness('disabled-repair');
  const service = await installObservedOldRelease(harness);
  const before = readBridgeState(harness.root);
  harness.registry.enabled = false;
  const disabledStatus = await service.refresh();
  assert.equal(disabledStatus.setupAction, 'repair');

  await service.install();
  const after = readBridgeState(harness.root);
  assert.equal(harness.registry.enabled, true);
  assert.equal(after.installationId, installationId);
  assert.equal(after.firstReceiptAt, before.firstReceiptAt);
  assert.equal(after.lastReceiptAt, before.lastReceiptAt);
  assert.equal(after.restartRequired, before.restartRequired);
  assert.equal(existsSync(outboxFile(harness.root)), true);
  assert.equal(service.getStatus().state, 'observing');
  assert.equal(service.getStatus().setupAction, 'none');
});

test('namespace ambiguity blocks automatic upgrade without mutating state or artifacts', async () => {
  const harness = createHarness('ambiguous');
  await installObservedOldRelease(harness);
  harness.registry.additionalPlugins = [{
    id: 'third-party@bitterless-local',
    scope: 'user',
    enabled: true,
    version: '1.0.0'
  }];
  const beforeState = readFileSync(
    join(harness.root, 'eyes-on-agents', 'claude-plugin-bridge.json'),
    'utf8'
  );
  const beforeWrapper = readFileSync(wrapperPath(harness.root), 'utf8');
  const commandStart = harness.commands.length;
  const next = createService({
    harness,
    version: newVersion,
    helperName: 'new-helper',
    ids: [nextInstallationId]
  });
  const status = await next.refresh();
  assert.equal(status.state, 'drifted');
  assert.equal(status.setupAction, 'repair');
  assert.equal(readFileSync(
    join(harness.root, 'eyes-on-agents', 'claude-plugin-bridge.json'),
    'utf8'
  ), beforeState);
  assert.equal(readFileSync(wrapperPath(harness.root), 'utf8'), beforeWrapper);
  assert.equal(harness.commands.slice(commandStart).some((command) =>
    command.startsWith('plugin update ') || command.startsWith('plugin install ') ||
    command.startsWith('plugin uninstall ') || command.startsWith('plugin marketplace update ')
  ), false);
});

test.after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});
