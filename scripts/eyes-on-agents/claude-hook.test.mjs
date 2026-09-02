import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-build-'));
const uuid = (index) => `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const load = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)], outfile, bundle: true, platform: 'node',
    format: 'esm', target: 'node22', tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
};

try {
  const contract = await load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract.ts');
  const outbox = await load('outbox', 'src/main/eyesOnAgents/claudeHookOutbox.service.ts');
  const bridge = await load('bridge', 'src/main/eyesOnAgents/claudeHookBridge.server.ts');
  const plugin = await load('plugin', 'src/main/eyesOnAgents/claudePluginBridge.service.ts');
  const productionIdentity = plugin.resolveClaudePluginBridgeIdentity('production');
  assert.deepEqual(productionIdentity, {
    marketplaceName: 'bitterless-local',
    pluginName: 'bitterless-observer',
    pluginId: 'bitterless-observer@bitterless-local',
    artifactRootRelativePath: 'eyes-on-agents/claude-marketplace'
  }, 'production must preserve the released Claude identity byte-for-byte');
  for (const profileId of ['production-debug', 'production-preview', 'test-debug', 'test-release']) {
    assert.deepEqual(plugin.resolveClaudePluginBridgeIdentity(profileId), {
      marketplaceName: `bitterless-local-${profileId}`,
      pluginName: `bitterless-observer-${profileId}`,
      pluginId: `bitterless-observer-${profileId}@bitterless-local-${profileId}`,
      artifactRootRelativePath: `eyes-on-agents/claude-marketplace-${profileId}`
    });
  }
  assert.throws(
    () => plugin.resolveClaudePluginBridgeIdentity('future-profile'),
    /Unsupported Bitterless Claude bridge profile/
  );
  const appImage = join(fixtureRoot, 'Bitterless.AppImage');
  const nonExecutableAppImage = join(fixtureRoot, 'non-executable.AppImage');
  const symlinkedAppImage = join(fixtureRoot, 'symlinked.AppImage');
  writeFileSync(appImage, '#!/bin/sh\nexit 0\n');
  writeFileSync(nonExecutableAppImage, '#!/bin/sh\nexit 0\n');
  chmodSync(appImage, 0o700);
  chmodSync(nonExecutableAppImage, 0o600);
  if (process.platform !== 'win32') symlinkSync(appImage, symlinkedAppImage);
  const fallbackRuntime = '/tmp/.mount_Bitterless/Bitterless';
  assert.equal(plugin.resolveClaudeHookRuntimeExecutable({
    execPath: fallbackRuntime, appImagePath: appImage, isPackaged: true, platform: 'linux'
  }), appImage, 'packaged Linux must persist the stable executable APPIMAGE path');
  for (const appImagePath of [
    'relative.AppImage', nonExecutableAppImage, join(fixtureRoot, 'missing.AppImage'),
    ...(process.platform === 'win32' ? [] : [symlinkedAppImage])
  ]) {
    assert.equal(plugin.resolveClaudeHookRuntimeExecutable({
      execPath: fallbackRuntime, appImagePath, isPackaged: true, platform: 'linux'
    }), fallbackRuntime, 'untrusted APPIMAGE metadata must fall back to the current executable');
  }
  assert.equal(plugin.resolveClaudeHookRuntimeExecutable({
    execPath: fallbackRuntime, appImagePath: appImage, isPackaged: false, platform: 'linux'
  }), fallbackRuntime, 'development must keep the current Electron executable');
  assert.equal(plugin.resolveClaudeHookRuntimeExecutable({
    execPath: fallbackRuntime, appImagePath: appImage, isPackaged: true, platform: 'darwin'
  }), fallbackRuntime, 'non-Linux packages must ignore APPIMAGE');
  const installationId = uuid(1);
  const delivery = (index, occurredAt = index) => {
    const event = contract.createClaudeHookEvent({
      rawInput: {
        hook_event_name: 'UserPromptSubmit', session_id: uuid(100 + index),
        transcript_path: `/tmp/${uuid(100 + index)}.jsonl`, cwd: '/tmp/project',
        prompt: 'SECRET', tool_input: { token: 'SECRET' }, transcript: 'SECRET'
      },
      eventId: uuid(1000 + index), occurredAt
    });
    return { schemaVersion: 1, deliveryId: event.eventId, installationId, event };
  };

  const safeEvent = delivery(1).event;
  assert.deepEqual(Object.keys(safeEvent.payload).sort(),
    ['cwd', 'hookEventName', 'sessionId', 'transcriptPath'].sort());
  assert(!JSON.stringify(safeEvent).includes('SECRET'));
  assert.throws(() => contract.parseClaudeHookDelivery({
    ...delivery(2), rawInput: 'SECRET'
  }), /fields are invalid/);

  const outboxPath = join(fixtureRoot, 'outbox');
  assert(outbox.persistClaudeHookOutboxDelivery({ outboxPath, delivery: delivery(2, 20) }));
  assert(outbox.persistClaudeHookOutboxDelivery({ outboxPath, delivery: delivery(1, 10) }));
  assert.deepEqual(
    readdirSync(join(outboxPath, 'pending')).filter((name) => name.endsWith('.json')),
    [delivery(1, 10), delivery(2, 20)].map((item) =>
      `${String(item.event.occurredAt).padStart(16, '0')}-${item.deliveryId}.json`)
  );
  writeFileSync(join(outboxPath, 'pending', '.tmp-corrupt'), 'SECRET');
  const replayed = [];
  await outbox.replayClaudeHookOutbox({
    endpoint: { transport: 'unix', path: join(fixtureRoot, 'unused.sock') }, outboxPath,
    deliver: async (item) => { replayed.push(item.event.occurredAt); return true; }
  });
  assert.deepEqual(replayed, [10, 20]);
  const inspected = outbox.inspectClaudeHookOutbox(outboxPath);
  assert(inspected.coverageGap?.reasons.includes('corrupt_file'));
  assert(!JSON.stringify(inspected).includes('SECRET'));

  const gapOutbox = join(fixtureRoot, 'gap-outbox');
  for (let index = 10; index < 55; index += 1) {
    assert(outbox.persistClaudeHookOutboxDelivery({
      outboxPath: gapOutbox, delivery: delivery(index, 1_000 + index)
    }));
  }
  const firstGapFile = readdirSync(join(gapOutbox, 'pending')).sort()[0];
  writeFileSync(join(gapOutbox, 'pending', firstGapFile), 'SECRET-CORRUPT');
  let gapSeen = false;
  const gapReplayCount = await outbox.replayClaudeHookOutbox({
    endpoint: { transport: 'unix', path: join(fixtureRoot, 'unused-gap.sock') },
    outboxPath: gapOutbox,
    onCoverageGap: () => { gapSeen = true; },
    deliver: async () => {
      assert.equal(gapSeen, true, 'coverage must be reported before any later valid replay');
      return false;
    }
  });
  assert.equal(gapReplayCount, 0);
  assert.equal(outbox.inspectClaudeHookOutbox(gapOutbox).pendingCount, 44,
    'valid later deliveries must remain pending after a coverage barrier');

  const socketPath = join(fixtureRoot, 'hook.sock');
  const server = new bridge.ClaudeHookBridgeServer();
  const origins = [];
  const duplicateStatuses = [];
  let duplicateDelivery = false;
  await server.start({
    endpoint: { transport: 'unix', path: socketPath }, installationId,
    outboxPath: join(fixtureRoot, 'server-outbox'),
    consume: async () => ({ duplicate: duplicateDelivery }),
    onCommitted: (value) => {
      origins.push(value.origin);
      duplicateStatuses.push(value.duplicate);
      throw new Error('display failure');
    }
  });
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(3, 30)
  ), true, 'a display callback failure must not prevent the SQLite commit ACK');
  assert.deepEqual(origins, ['live']);
  const firstLiveEventAt = server.getLastEventAt();
  assert.equal(typeof firstLiveEventAt, 'number');
  duplicateDelivery = true;
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(30, 31)
  ), true, 'a tombstoned duplicate-style delivery must still receive a commit ACK');
  assert.equal(server.getLastEventAt(), firstLiveEventAt,
    'a duplicate-style ACK must not become observation proof');
  assert.deepEqual(duplicateStatuses, [false, true]);
  await server.stop();
  assert.equal(existsSync(socketPath), false, 'stop must remove the owned Unix socket');

  const raceSocketPath = join(fixtureRoot, 'hook-race.sock');
  const raceOutbox = join(fixtureRoot, 'race-outbox');
  const raceServer = new bridge.ClaudeHookBridgeServer();
  let intake = true;
  let proof = 'receipt';
  let releaseCommit;
  let enteredCommit;
  const commitEntered = new Promise((resolvePromise) => { enteredCommit = resolvePromise; });
  const commitGate = new Promise((resolvePromise) => { releaseCommit = resolvePromise; });
  const order = [];
  await raceServer.start({
    endpoint: { transport: 'unix', path: raceSocketPath }, installationId,
    outboxPath: raceOutbox,
    consume: async () => {
      if (!intake) throw new Error('intake disabled');
      enteredCommit();
      await commitGate;
      order.push('commit');
      return { duplicate: false };
    },
    onCoverageGap: async () => {
      intake = false;
      proof = 'none';
      order.push('gap');
    }
  });
  await raceServer.replayOutbox();
  const admitted = outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: raceSocketPath }, delivery(4, 40)
  );
  await commitEntered;
  mkdirSync(join(raceOutbox, 'pending'), { recursive: true });
  writeFileSync(join(raceOutbox, 'pending', '.tmp-corrupt'), 'corrupt');
  const gapReplay = raceServer.replayOutbox();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.deepEqual(order, [], 'coverage revocation must wait for an earlier admitted commit');
  releaseCommit();
  assert.equal(await admitted, true);
  await gapReplay;
  assert.deepEqual(order, ['commit', 'gap']);
  assert.equal(proof, 'none');
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: raceSocketPath }, delivery(5, 50)
  ), false, 'deliveries after the ordered coverage barrier must be rejected');
  await raceServer.stop();

  const finalInspectSocketPath = join(fixtureRoot, 'hook-final-inspect.sock');
  const finalInspectOutbox = join(fixtureRoot, 'final-inspect-outbox');
  assert(outbox.persistClaudeHookOutboxDelivery({
    outboxPath: finalInspectOutbox,
    delivery: delivery(6, 60)
  }));
  const finalInspectServer = new bridge.ClaudeHookBridgeServer();
  let finalInspectProof = 'receipt';
  let finalInspectIntake = true;
  let finalInspectGapCount = 0;
  await finalInspectServer.start({
    endpoint: { transport: 'unix', path: finalInspectSocketPath },
    installationId,
    outboxPath: finalInspectOutbox,
    consume: async () => {
      rmSync(finalInspectOutbox, { recursive: true, force: true });
      writeFileSync(finalInspectOutbox, 'storage-blocked');
      return { duplicate: false };
    },
    onCoverageGap: async () => {
      finalInspectGapCount += 1;
      finalInspectProof = 'none';
      finalInspectIntake = false;
    }
  });
  await finalInspectServer.replayOutbox();
  assert(finalInspectGapCount >= 1,
    'a storage failure materialized only by final inspection must cross the ordered gap barrier');
  assert.equal(finalInspectProof, 'none');
  assert.equal(finalInspectIntake, false,
    'proof and intake must be revoked even when no later live event schedules another replay');
  await finalInspectServer.stop();

  const retryGapSocketPath = join(fixtureRoot, 'hook-gap-retry.sock');
  const retryGapOutbox = join(fixtureRoot, 'gap-retry-outbox');
  outbox.inspectClaudeHookOutbox(retryGapOutbox);
  const retryGapServer = new bridge.ClaudeHookBridgeServer();
  let retryGapCallbacks = 0;
  let retryGapRevoked = false;
  await retryGapServer.start({
    endpoint: { transport: 'unix', path: retryGapSocketPath },
    installationId,
    outboxPath: retryGapOutbox,
    consume: async () => ({ duplicate: false }),
    onCoverageGap: async () => {
      retryGapCallbacks += 1;
      if (retryGapCallbacks === 1) throw new Error('temporary persistence failure');
      retryGapRevoked = true;
    }
  });
  await retryGapServer.replayOutbox();
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  writeFileSync(join(retryGapOutbox, 'coverage-gap.json'), JSON.stringify({
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 70,
    lastDetectedAt: 70,
    occurrences: 1
  }));
  await assert.rejects(() => retryGapServer.replayOutbox(), /temporary persistence failure/);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(retryGapRevoked, false);
  await retryGapServer.replayOutbox();
  assert.equal(retryGapCallbacks, 2,
    'a failed coverage callback must not suppress the same persistent marker');
  assert.equal(retryGapRevoked, true);
  await retryGapServer.stop();

  const pluginRoot = join(fixtureRoot, 'plugin');
  const helper = join(fixtureRoot, 'claudeHookHelper.js');
  writeFileSync(helper, 'module.exports = {};\n');

  const sharedProfileRegistry = {
    marketplaces: new Map(),
    plugins: new Map()
  };
  const createProfileHarness = (profileId, idOffset) => {
    const identity = plugin.resolveClaudePluginBridgeIdentity(profileId);
    const root = join(fixtureRoot, `profile-${profileId}`);
    const commands = [];
    let nextId = idOffset;
    const service = new plugin.ClaudePluginBridgeService({
      identity,
      userDataPath: root,
      execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
      appRootPath: fixtureRoot,
      pluginVersion: '0.260817.163734',
      executableCandidates: ['/usr/bin/claude'],
      helperSourcePath: helper,
      idFactory: () => uuid(nextId++),
      runtimeStatus: () => ({ listening: false, listeningSince: null }),
      runCommand: async (_executable, args) => {
        const command = args.join(' ');
        commands.push(command);
        if (command.endsWith('--help')) {
          return { exitCode: 0, stdout: command === 'plugin --help' ? 'marketplace' : '--scope <scope>', stderr: '' };
        }
        if (command === 'plugin list --json') {
          return {
            exitCode: 0,
            stdout: JSON.stringify([...sharedProfileRegistry.plugins.values()]),
            stderr: ''
          };
        }
        if (command === 'plugin marketplace list --json') {
          return {
            exitCode: 0,
            stdout: JSON.stringify([...sharedProfileRegistry.marketplaces.entries()].map(
              ([name, path]) => ({ name, path })
            )),
            stderr: ''
          };
        }
        if (args[1] === 'marketplace' && args[2] === 'add') {
          const path = args[3];
          const manifest = JSON.parse(readFileSync(
            join(path, '.claude-plugin', 'marketplace.json'),
            'utf8'
          ));
          sharedProfileRegistry.marketplaces.set(manifest.name, path);
        }
        if (args[1] === 'marketplace' && args[2] === 'remove') {
          sharedProfileRegistry.marketplaces.delete(args[3]);
        }
        if (args[1] === 'install') {
          sharedProfileRegistry.plugins.set(args[2], {
            id: args[2],
            scope: 'user',
            enabled: false,
            version: '0.260817.163734'
          });
        }
        if (args[1] === 'enable') {
          const installedPlugin = sharedProfileRegistry.plugins.get(args[2]);
          if (installedPlugin) installedPlugin.enabled = true;
        }
        if (args[1] === 'uninstall') sharedProfileRegistry.plugins.delete(args[2]);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
    });
    return { commands, identity, root, service };
  };
  const productionProfile = createProfileHarness('production', 10_000);
  const debugProfile = createProfileHarness('production-debug', 11_000);
  await productionProfile.service.install();
  await debugProfile.service.install();
  assert.deepEqual(
    [...sharedProfileRegistry.plugins.keys()].sort(),
    [productionProfile.identity.pluginId, debugProfile.identity.pluginId].sort(),
    'production and production-debug plugins must coexist'
  );
  await productionProfile.service.refresh();
  await debugProfile.service.refresh();
  assert.equal(productionProfile.service.getStatus().state, 'installed');
  assert.equal(debugProfile.service.getStatus().state, 'installed');
  await productionProfile.service.install();
  await debugProfile.service.install();
  assert.equal(sharedProfileRegistry.plugins.has(productionProfile.identity.pluginId), true);
  assert.equal(sharedProfileRegistry.plugins.has(debugProfile.identity.pluginId), true);
  assert.equal(debugProfile.commands.some((command) => command.includes(
    productionProfile.identity.pluginId
  )), false, 'debug lifecycle commands must never target production');
  assert.equal(debugProfile.commands.some((command) => command.split(' ').includes(
    productionProfile.identity.marketplaceName
  )), false, 'debug lifecycle commands must never target the production marketplace');
  const debugMarketplaceManifest = JSON.parse(readFileSync(join(
    debugProfile.root,
    debugProfile.identity.artifactRootRelativePath,
    '.claude-plugin',
    'marketplace.json'
  ), 'utf8'));
  const debugOwnerMarker = JSON.parse(readFileSync(join(
    debugProfile.root,
    debugProfile.identity.artifactRootRelativePath,
    '.bitterless-owner.json'
  ), 'utf8'));
  assert.equal(debugMarketplaceManifest.name, debugProfile.identity.marketplaceName);
  assert.equal(debugMarketplaceManifest.plugins[0].name, debugProfile.identity.pluginName);
  assert.equal(debugOwnerMarker.plugin, debugProfile.identity.pluginId);
  await productionProfile.service.remove();
  assert.equal(sharedProfileRegistry.plugins.has(debugProfile.identity.pluginId), true,
    'production removal must preserve production-debug');
  await debugProfile.service.refresh();
  assert.equal(debugProfile.service.getStatus().state, 'installed');
  await debugProfile.service.remove();
  assert.equal(sharedProfileRegistry.plugins.size, 0);
  assert.equal(sharedProfileRegistry.marketplaces.size, 0);

  const commands = [];
  let installed = false;
  let enabled = false;
  let marketplace = false;
  let installedVersion = null;
  let installsApply = true;
  let cachedInstallationId = null;
  let additionalPlugins = [];
  let injectExtraAfterUninstall = false;
  const service = new plugin.ClaudePluginBridgeService({
    identity: productionIdentity,
    userDataPath: pluginRoot, execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: fixtureRoot, pluginVersion: '0.260817.163734', executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper, idFactory: () => installationId,
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async (_executable, args) => {
      commands.push(args);
      if (args.at(-1) === '--help') return { exitCode: 0, stdout: args.length === 2 ? 'marketplace' : '--scope <scope>', stderr: '' };
      if (args.join(' ') === 'plugin list --json') return {
        exitCode: 0,
        stdout: JSON.stringify([...(installed ? [{
          id: 'bitterless-observer@bitterless-local', scope: 'user', enabled,
          version: installedVersion
        }] : []), ...additionalPlugins]),
        stderr: ''
      };
      if (args.join(' ') === 'plugin marketplace list --json') return {
        exitCode: 0,
        stdout: JSON.stringify(marketplace ? [{ name: 'bitterless-local', path: join(pluginRoot, 'eyes-on-agents', 'claude-marketplace') }] : []),
        stderr: ''
      };
      if (args[1] === 'marketplace' && args[2] === 'add') marketplace = true;
      if (args[1] === 'uninstall') {
        installed = false;
        enabled = false;
        installedVersion = null;
        if (injectExtraAfterUninstall) {
          additionalPlugins = [{
            id: 'late-plugin@bitterless-local', scope: 'project', enabled: true, version: '1.0.0'
          }];
        }
      }
      if (args[1] === 'install') {
        installed = true;
        if (installsApply) {
          installedVersion = '0.260817.163734';
          const state = JSON.parse(readFileSync(
            join(pluginRoot, 'eyes-on-agents', 'claude-plugin-bridge.json'), 'utf8'
          ));
          cachedInstallationId = state.installationId;
        } else {
          installedVersion = '0.260816.235959';
        }
      }
      if (args[1] === 'enable') enabled = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  await service.install();
  assert(service.acceptsInstallation(installationId));
  assert(commands.some((args) => args.join(' ') ===
    `plugin marketplace add ${join(pluginRoot, 'eyes-on-agents', 'claude-marketplace')} --scope user`));
  assert(commands.some((args) => args.join(' ') ===
    'plugin install bitterless-observer@bitterless-local --scope user'));
  assert.equal(cachedInstallationId, installationId);
  const hooksPath = join(pluginRoot, 'eyes-on-agents', 'claude-marketplace', 'plugins',
    'bitterless-observer', 'hooks', 'hooks.json');
  const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
  const wrapperPath = join(pluginRoot, 'eyes-on-agents', 'claude-marketplace', 'plugins',
    'bitterless-observer', 'scripts', 'observe.sh');
  const wrapperResult = spawnSync(wrapperPath, [], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: resolve(dirname(wrapperPath), '..') }
  });
  assert.equal(wrapperResult.status, 0);
  assert.equal(wrapperResult.stdout, '');
  assert.equal(wrapperResult.stderr, '');
  chmodSync(wrapperPath, 0o600);
  await service.refresh();
  assert.equal(service.getStatus().state, 'drifted');
  assert.equal(service.acceptsInstallation(installationId), false);
  const repairCommandStart = commands.length;
  await service.install();
  const repairCommands = commands.slice(repairCommandStart).map((args) => args.join(' '));
  assert(repairCommands.includes(
    'plugin uninstall bitterless-observer@bitterless-local --scope user -y'
  ), 'same-version Repair must evict Claude\'s cached plugin generation');
  assert(repairCommands.includes(
    'plugin install bitterless-observer@bitterless-local --scope user'
  ));
  assert(!repairCommands.includes(
    'plugin update bitterless-observer@bitterless-local --scope user'
  ));
  assert.equal(cachedInstallationId, installationId,
    'reinstall must cache the newly rotated installation ID');
  assert.equal(lstatSync(wrapperPath).mode & 0o777, 0o700);
  const pluginManifest = JSON.parse(readFileSync(join(dirname(hooksPath), '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(pluginManifest.version, '0.260817.163734');
  assert.equal(plugin.claudePluginVersionFromVersionCode('260817163734'), '0.260817.163734');
  assert.equal(plugin.claudePluginVersionFromVersionCode('260817005959'), '0.260817.5959');
  assert.match(plugin.claudePluginVersionFromVersionCode('260817000000'), /^0\.\d+\.\d+$/);
  assert.throws(() => plugin.claudePluginVersionFromVersionCode('0.0.69'), /YYMMDDHHmmss/);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd']) {
    assert.equal(hooks.hooks[event][0].hooks[0].timeout, 2);
  }
  service.recordLiveReceipt(installationId, 123);
  assert.equal(service.getStatus().observationProof, 'receipt');
  service.revokeObservationProof();
  assert.equal(service.getStatus().observationProof, 'none');
  assert.equal(service.acceptsInstallation(uuid(999)), false);
  installedVersion = '0.260816.235959';
  await service.refresh();
  assert.equal(service.getStatus().state, 'drifted');
  assert.equal(service.acceptsInstallation(installationId), false);
  installsApply = false;
  await assert.rejects(() => service.install(), /version or installation is not exact/);
  assert.equal(service.getStatus().state, 'error');
  assert.match(service.getStatus().error ?? '', /version or installation is not exact/);
  installsApply = true;
  await service.install();
  assert.equal(service.acceptsInstallation(installationId), true);
  const marketplaceManifestPath = join(
    pluginRoot, 'eyes-on-agents', 'claude-marketplace', '.claude-plugin', 'marketplace.json'
  );
  const generatedMarketplace = JSON.parse(readFileSync(marketplaceManifestPath, 'utf8'));
  const generatedPlugin = JSON.parse(readFileSync(join(
    pluginRoot, 'eyes-on-agents', 'claude-marketplace', 'plugins', 'bitterless-observer',
    '.claude-plugin', 'plugin.json'
  ), 'utf8'));
  assert.equal(generatedMarketplace.description,
    'Bitterless local lifecycle observation plugins');
  assert.deepEqual(generatedPlugin.author, { name: 'Bitterless' },
    'generated manifests must satisfy Claude plugin validate --strict required metadata');
  const assertUnsafeRemoveDoesNotMutate = async (message) => {
    const commandStart = commands.length;
    await assert.rejects(() => service.remove(), /manual cleanup is required/, message);
    const attempted = commands.slice(commandStart).map((args) => args.join(' '));
    assert.equal(attempted.some((command) =>
      command.startsWith('plugin uninstall ') ||
      command.startsWith('plugin marketplace remove ') && !command.endsWith('--help')
    ), false, `${message}: remove must remain read-only`);
  };
  const assertUnsafeInstallDoesNotMutate = async (message) => {
    const stateBefore = readFileSync(
      join(pluginRoot, 'eyes-on-agents', 'claude-plugin-bridge.json'), 'utf8'
    );
    const commandStart = commands.length;
    await assert.rejects(() => service.install(), /namespace contains another plugin or scope/, message);
    const attempted = commands.slice(commandStart);
    assert.equal(attempted.some((args) =>
      ['install', 'uninstall', 'enable', 'update'].includes(args[1]) ||
      args[1] === 'marketplace' && args[2] !== 'list' && args.at(-1) !== '--help'
    ), false, `${message}: install must remain read-only`);
    assert.equal(readFileSync(
      join(pluginRoot, 'eyes-on-agents', 'claude-plugin-bridge.json'), 'utf8'
    ), stateBefore, `${message}: bridge state must remain unchanged`);
  };
  additionalPlugins = [{
    id: 'third-party@bitterless-local', scope: 'user', enabled: true, version: '1.0.0'
  }];
  await assertUnsafeInstallDoesNotMutate(
    'an extra plugin in the marketplace namespace must block Repair'
  );
  await assertUnsafeRemoveDoesNotMutate(
    'an extra plugin in the owned marketplace namespace must block cascading removal'
  );
  additionalPlugins = [{
    id: 'bitterless-observer@bitterless-local', scope: 'project', enabled: true,
    version: '0.260817.163734'
  }];
  await assertUnsafeInstallDoesNotMutate(
    'a project-scoped target plugin must block Repair'
  );
  await assertUnsafeRemoveDoesNotMutate(
    'a project-scoped target plugin must block user marketplace removal'
  );
  additionalPlugins = [];
  writeFileSync(marketplaceManifestPath, JSON.stringify({
    name: 'bitterless-local', plugins: [
      { name: 'bitterless-observer', source: './plugins/bitterless-observer' },
      { name: 'unexpected', source: './plugins/unexpected' }
    ]
  }));
  await assertUnsafeRemoveDoesNotMutate(
    'a drifted owned marketplace catalog must block source removal'
  );
  await service.install();
  const statePath = join(pluginRoot, 'eyes-on-agents', 'claude-plugin-bridge.json');
  writeFileSync(statePath, '{broken-json');
  const corruptStatus = service.getStatus();
  assert.equal(corruptStatus.configured, true);
  assert.equal(corruptStatus.state, 'error');
  assert.equal(service.acceptsInstallation(installationId), false);
  additionalPlugins = [{
    id: 'third-party@bitterless-local', scope: 'user', enabled: true, version: '1.0.0'
  }];
  await assertUnsafeRemoveDoesNotMutate(
    'corrupt local state must not bypass namespace ownership checks'
  );
  additionalPlugins = [];
  await service.install();
  assert.equal(service.acceptsInstallation(installationId), true,
    'Repair must atomically replace corrupt local bridge state after exact ownership proof');
  const strictState = {
    schemaVersion: 1,
    installationId,
    installed: true,
    artifactDigest: null,
    firstReceiptAt: null,
    lastReceiptAt: null,
    restartRequired: true,
    recoveryReason: null
  };
  writeFileSync(statePath, JSON.stringify({
    ...strictState,
    firstReceiptAt: 9_007_199_254_740_991,
    lastReceiptAt: 9_007_199_254_740_991
  }));
  assert.doesNotThrow(() => service.getStatus());
  assert.equal(service.getStatus().state, 'error',
    'a safe integer outside the JavaScript Date range must fail closed before ISO projection');
  await assert.doesNotReject(() => service.install(),
    'Repair must recover an out-of-range persisted receipt timestamp');
  const { recoveryReason: _missingRecoveryReason, ...missingKeyState } = strictState;
  for (const corruptState of [
    missingKeyState,
    { ...strictState, unexpected: true },
    { ...strictState, restartRequired: 'false', firstReceiptAt: 1, lastReceiptAt: 2 },
    { ...strictState, artifactDigest: 'ABC' },
    { ...strictState, firstReceiptAt: 1, lastReceiptAt: null },
    { ...strictState, firstReceiptAt: 2, lastReceiptAt: 1 },
    { ...strictState, installed: false, firstReceiptAt: 1, lastReceiptAt: 2 },
    { ...strictState, recoveryReason: 'future_reason' }
  ]) {
    writeFileSync(statePath, JSON.stringify(corruptState));
    assert.equal(service.getStatus().state, 'error');
    assert.equal(service.getStatus().observationProof, 'none');
    assert.equal(service.acceptsInstallation(installationId), false,
      'malformed exact-state fields must never admit Hook deliveries');
  }
  await service.install();
  injectExtraAfterUninstall = true;
  const removalRaceCommandStart = commands.length;
  await assert.rejects(
    () => service.remove(),
    /marketplace changed during removal/,
    'Disable must re-inspect the namespace after uninstall before cascading marketplace removal'
  );
  assert.equal(commands.slice(removalRaceCommandStart).some((args) =>
    args.join(' ') === 'plugin marketplace remove bitterless-local --scope user'
  ), false);
  assert.equal(existsSync(join(pluginRoot, 'eyes-on-agents', 'claude-marketplace')), true,
    'a late namespace collision must preserve the marketplace source and artifacts');
  injectExtraAfterUninstall = false;
  additionalPlugins = [];
  await service.install();
  writeFileSync(statePath, JSON.stringify({
    schemaVersion: 1, installationId: 'invalid', installed: true,
    artifactDigest: null, firstReceiptAt: -1, lastReceiptAt: 'bad', restartRequired: false
  }));
  assert.equal(service.getStatus().state, 'error');
  await service.remove();
  assert.equal(service.getStatus().configured, false,
    'Disable must recover a corrupt state after exact CLI and owner-marker proof');

  const collisionRoot = join(fixtureRoot, 'collision');
  const collisionState = join(collisionRoot, 'eyes-on-agents', 'claude-plugin-bridge.json');
  mkdirSync(dirname(collisionState), { recursive: true });
  writeFileSync(collisionState, '{broken-json');
  const collisionService = new plugin.ClaudePluginBridgeService({
    identity: productionIdentity,
    userDataPath: collisionRoot, execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: fixtureRoot, pluginVersion: '0.260817.163734',
    executableCandidates: ['/usr/bin/claude'], helperSourcePath: helper,
    idFactory: () => uuid(77), runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async (_executable, args) => {
      if (args.at(-1) === '--help') return { exitCode: 0, stdout: args.length === 2 ? 'marketplace' : '--scope <scope>', stderr: '' };
      if (args.join(' ') === 'plugin list --json') return { exitCode: 0, stdout: '[]', stderr: '' };
      if (args.join(' ') === 'plugin marketplace list --json') return {
        exitCode: 0,
        stdout: JSON.stringify([{ name: 'bitterless-local', source: 'directory', path: '/tmp/third-party' }]),
        stderr: ''
      };
      throw new Error('collision must not execute a mutating command');
    }
  });
  await assert.rejects(() => collisionService.install(), /owned by another source/);
  await assert.rejects(() => collisionService.remove(), /ownership could not be proven/);
  assert.equal(readFileSync(collisionState, 'utf8'), '{broken-json');

  const unprovenRoot = join(fixtureRoot, 'unproven-plugin');
  const unprovenCommands = [];
  const unprovenService = new plugin.ClaudePluginBridgeService({
    identity: productionIdentity,
    userDataPath: unprovenRoot,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: fixtureRoot,
    pluginVersion: '0.260817.163734',
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => uuid(78),
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async (_executable, args) => {
      unprovenCommands.push(args);
      if (args.at(-1) === '--help') return { exitCode: 0, stdout: args.length === 2 ? 'marketplace' : '--scope <scope>', stderr: '' };
      if (args.join(' ') === 'plugin list --json') return {
        exitCode: 0,
        stdout: JSON.stringify([{
          id: 'bitterless-observer@bitterless-local', scope: 'user', enabled: true,
          version: '0.260817.163734'
        }]),
        stderr: ''
      };
      if (args.join(' ') === 'plugin marketplace list --json') {
        return { exitCode: 0, stdout: '[]', stderr: '' };
      }
      throw new Error('unproven plugin must not execute a mutating command');
    }
  });
  await assert.rejects(() => unprovenService.install(), /ownership could not be proven/);
  assert.equal(unprovenCommands.some((args) =>
    ['install', 'uninstall', 'enable', 'update'].includes(args[1]) ||
    args[1] === 'marketplace' && args[2] !== 'list' && args.at(-1) !== '--help'
  ), false);
  assert.equal(existsSync(join(unprovenRoot, 'eyes-on-agents', 'claude-plugin-bridge.json')), false);
  assert.equal(existsSync(contract.getClaudeHookOutboxPath(unprovenRoot)), false);

  for (const [label, injectedPlugins, expectedError] of [
    [
      'unowned target',
      [{
        id: 'bitterless-observer@bitterless-local', scope: 'user', enabled: true,
        version: '0.260817.163734'
      }],
      /ownership could not be proven/
    ],
    [
      'late project-scope plugin',
      [{
        id: 'late-plugin@bitterless-local', scope: 'project', enabled: true,
        version: '1.0.0'
      }],
      /namespace contains another plugin or scope/
    ]
  ]) {
    const raceRoot = join(fixtureRoot, `install-race-${label.replaceAll(' ', '-')}`);
    const raceCommands = [];
    let pluginListReads = 0;
    const raceService = new plugin.ClaudePluginBridgeService({
      identity: productionIdentity,
      userDataPath: raceRoot,
      execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
      appRootPath: fixtureRoot,
      pluginVersion: '0.260817.163734',
      executableCandidates: ['/usr/bin/claude'],
      helperSourcePath: helper,
      idFactory: () => uuid(label === 'unowned target' ? 79 : 80),
      runtimeStatus: () => ({ listening: false, listeningSince: null }),
      runCommand: async (_executable, args) => {
        raceCommands.push(args);
        if (args.at(-1) === '--help') {
          return { exitCode: 0, stdout: args.length === 2 ? 'marketplace' : '--scope <scope>', stderr: '' };
        }
        if (args.join(' ') === 'plugin list --json') {
          pluginListReads += 1;
          return {
            exitCode: 0,
            stdout: JSON.stringify(pluginListReads === 1 ? [] : injectedPlugins),
            stderr: ''
          };
        }
        if (args.join(' ') === 'plugin marketplace list --json') {
          return { exitCode: 0, stdout: '[]', stderr: '' };
        }
        throw new Error('ownership race must stop before the first mutating CLI command');
      }
    });
    await assert.rejects(() => raceService.install(), expectedError);
    assert.equal(pluginListReads, 2, `${label}: ownership must be re-read after artifact staging`);
    assert.equal(raceCommands.some((args) =>
      ['install', 'uninstall', 'enable', 'update'].includes(args[1]) ||
      args[1] === 'marketplace' && args[2] !== 'list' && args.at(-1) !== '--help'
    ), false, `${label}: the second observation must stop every mutating CLI command`);
  }

  const cacheRoot = join(fixtureRoot, 'same-version-cache');
  const cacheIds = [uuid(81), uuid(82), uuid(83), uuid(84)];
  const cacheCommands = [];
  let cacheMarketplace = false;
  let cacheInstalled = false;
  let cacheEnabled = false;
  let cachedWrapperInstallationId = null;
  let cacheEnableEventIndex = 0;
  const cacheService = new plugin.ClaudePluginBridgeService({
    identity: productionIdentity,
    userDataPath: cacheRoot,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: fixtureRoot,
    pluginVersion: '0.260817.163734',
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => cacheIds.shift(),
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async (_executable, args) => {
      cacheCommands.push(args.join(' '));
      if (args.at(-1) === '--help') return { exitCode: 0, stdout: args.length === 2 ? 'marketplace' : '--scope <scope>', stderr: '' };
      if (args.join(' ') === 'plugin list --json') return {
        exitCode: 0,
        stdout: JSON.stringify(cacheInstalled ? [{
          id: 'bitterless-observer@bitterless-local', scope: 'user', enabled: cacheEnabled,
          version: '0.260817.163734'
        }] : []),
        stderr: ''
      };
      if (args.join(' ') === 'plugin marketplace list --json') return {
        exitCode: 0,
        stdout: JSON.stringify(cacheMarketplace ? [{
          name: 'bitterless-local',
          path: join(cacheRoot, 'eyes-on-agents', 'claude-marketplace')
        }] : []),
        stderr: ''
      };
      if (args[1] === 'marketplace' && args[2] === 'add') cacheMarketplace = true;
      if (args[1] === 'marketplace' && args[2] === 'remove') cacheMarketplace = false;
      if (args[1] === 'uninstall') { cacheInstalled = false; cacheEnabled = false; }
      if (args[1] === 'install') {
        cacheInstalled = true;
        cachedWrapperInstallationId = JSON.parse(readFileSync(
          join(cacheRoot, 'eyes-on-agents', 'claude-plugin-bridge.json'), 'utf8'
        )).installationId;
      }
      if (args[1] === 'enable') {
        cacheEnabled = true;
        cacheEnableEventIndex += 1;
        const currentInstallationId = JSON.parse(readFileSync(
          join(cacheRoot, 'eyes-on-agents', 'claude-plugin-bridge.json'), 'utf8'
        )).installationId;
        const enabledDelivery = {
          ...delivery(700 + cacheEnableEventIndex, 70_000 + cacheEnableEventIndex),
          installationId: currentInstallationId
        };
        assert(outbox.persistClaudeHookOutboxDelivery({
          outboxPath: contract.getClaudeHookOutboxPath(cacheRoot, currentInstallationId),
          delivery: enabledDelivery
        }));
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  await cacheService.install();
  assert.equal(cachedWrapperInstallationId, uuid(81));
  const secondInstallStart = cacheCommands.length;
  await cacheService.install();
  const secondInstallCommands = cacheCommands.slice(secondInstallStart);
  assert.equal(cachedWrapperInstallationId, uuid(82),
    'same-build Repair must force Claude to cache the newly rotated wrapper generation');
  assert(secondInstallCommands.includes(
    'plugin uninstall bitterless-observer@bitterless-local --scope user -y'
  ));
  assert(secondInstallCommands.includes(
    'plugin install bitterless-observer@bitterless-local --scope user'
  ));
  assert.equal(secondInstallCommands.some((command) => command.startsWith('plugin update ')), false);
  assert.equal(cacheService.acceptsInstallation(uuid(81)), false);
  assert.equal(cacheService.acceptsInstallation(uuid(82)), true);
  const oldCoverageOutbox = contract.getClaudeHookOutboxPath(cacheRoot, uuid(82));
  mkdirSync(oldCoverageOutbox, { recursive: true });
  writeFileSync(join(oldCoverageOutbox, 'coverage-gap.json'), JSON.stringify({
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 1,
    lastDetectedAt: 1,
    occurrences: 1
  }));
  cacheService.revokeObservationProof('coverage_gap');
  const coverageStatus = cacheService.getStatus();
  assert.equal(coverageStatus.state, 'error');
  assert.match(coverageStatus.error, /Repair is required/);
  assert.equal(cacheService.acceptsInstallation(uuid(82)), false,
    'a persisted coverage gap must keep runtime intake closed');
  const claudeCardSource = readFileSync(join(
    projectRoot,
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue'
  ), 'utf8');
  assert.match(claudeCardSource,
    /case 'repair': return i18nHelper\.eyesOnAgents\.claudeBridge\.repair/,
    'the recovery error state must expose the existing Repair action');
  await cacheService.install();
  assert.equal(existsSync(oldCoverageOutbox), false,
    'Repair must remove the old generation and its persistent coverage marker');
  assert.equal(outbox.inspectClaudeHookOutbox(
    contract.getClaudeHookOutboxPath(cacheRoot, uuid(83))
  ).pendingCount, 1,
  'an event emitted after plugin enable must survive Repair for the restarted listener to replay');
  assert.equal(cacheService.getStatus().error, null);
  assert.equal(cacheService.acceptsInstallation(uuid(82)), false);
  assert.equal(cacheService.acceptsInstallation(uuid(83)), true,
    'successful Repair must reopen intake only for the new generation');
  const cacheOutboxRoot = contract.getClaudeHookOutboxPath(cacheRoot);
  mkdirSync(join(cacheOutboxRoot, uuid(81)), { recursive: true });
  mkdirSync(join(cacheOutboxRoot, uuid(83)), { recursive: true });
  writeFileSync(join(cacheOutboxRoot, uuid(81), 'metadata.json'), 'session metadata');
  writeFileSync(join(cacheOutboxRoot, uuid(83), 'metadata.json'), 'session metadata');
  await cacheService.remove();
  assert.equal(existsSync(cacheOutboxRoot), false,
    'Disable must clear every Bitterless-owned Claude outbox generation');
  await cacheService.remove();
  assert.equal(existsSync(cacheOutboxRoot), false,
    'repeated Disable must remain idempotent with no outbox root');

  const boundedRoot = join(fixtureRoot, 'bounded-corrupt-state');
  const boundedState = join(boundedRoot, 'eyes-on-agents', 'claude-plugin-bridge.json');
  mkdirSync(dirname(boundedState), { recursive: true });
  writeFileSync(boundedState, Buffer.alloc(20 * 1024, 0x61));
  const boundedService = new plugin.ClaudePluginBridgeService({
    identity: productionIdentity,
    userDataPath: boundedRoot,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: fixtureRoot,
    pluginVersion: '0.260817.163734',
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => uuid(91),
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async () => ({ exitCode: 0, stdout: '[]', stderr: '' })
  });
  assert.equal(boundedService.getStatus().state, 'error',
    'an oversized state file must fail closed without being parsed');
  if (process.platform !== 'win32') {
    const symlinkTarget = join(boundedRoot, 'outside-state.json');
    writeFileSync(symlinkTarget, JSON.stringify({ schemaVersion: 1 }));
    rmSync(boundedState);
    symlinkSync(symlinkTarget, boundedState);
    assert.equal(boundedService.getStatus().state, 'error',
      'a symlinked state file must fail closed');
  }

  const handlerSource = readFileSync(join(projectRoot, 'src/main/xpc/eyesOnAgents.handler.ts'), 'utf8');
  assert.match(handlerSource, /await claudeHookBridgeServer\.stop\(\)/);
  assert.match(handlerSource, /outboxPath: getClaudeHookOutboxPath\([^\n]+installationId\)/);
  const serviceSource = readFileSync(join(projectRoot, 'src/main/eyesOnAgents/eyesOnAgents.service.ts'), 'utf8');
  assert.match(serviceSource, /acceptsInstallation\(delivery\.installationId\)/);
  assert.match(serviceSource, /runClaudeBridgeLifecycle/);
  console.log('EyesOnAgents Claude hook bridge tests passed.');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
