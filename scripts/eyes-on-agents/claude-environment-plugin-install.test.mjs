import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Task 086: the Claude plugin/hook install-enable-remove-status flow gains an optional
// target-directory parameter (env.CLAUDE_CONFIG_DIR override) so it can target any configured
// environment, without touching the shared installationId/socket/outbox continuity state machine.
// This file covers the two layers that carry that parameter end to end:
//   1. claudeCommand.runner.ts  — the CLI spawn itself receives/omits CLAUDE_CONFIG_DIR correctly.
//   2. claudePluginBridge.service.ts — every command() call site used by install/refresh/remove
//      threads the given configDirectory through consistently.
//   3. claudeBridgeEnvironment.resolver.ts — { environmentId } resolves against a configured list,
//      defaulting to environments[0] when omitted, and rejects a real-but-unknown id before any
//      CLI command is attempted.
//   4. claudeBridgeLog.helper.ts — the new [claude-bridge] log lines carry id/label, never
//      configDirectory or raw CLI output.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-env-plugin-install-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-env-plugin-install-build-'));
const PLUGIN_ID = 'bitterless-observer@bitterless-local';
const PLUGIN_VERSION = '0.260818.100000';
const uuid = (index) => (
  `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16).padStart(12, '0')}`
);

const load = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const HELP_COMMANDS = new Set(['plugin --help', 'plugin marketplace remove --help']);

// Mirrors scripts/eyes-on-agents/claude-setup-recovery.test.mjs's harness, extended to capture
// the configDirectory each command() call site actually received.
const createPluginHarness = (pluginModule, { name, installEnabled = true }) => {
  const root = join(fixtureRoot, name);
  const helper = join(root, 'claudeHookHelper.js');
  mkdirSync(root, { recursive: true });
  writeFileSync(helper, 'module.exports = {};\n');
  const state = { marketplace: false, installed: false, enabled: false, version: null };
  const calls = [];
  const service = new pluginModule.ClaudePluginBridgeService({
    identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
    userDataPath: root,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: root,
    pluginVersion: PLUGIN_VERSION,
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => uuid(1),
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    runCommand: async (_executable, args, options) => {
      const command = args.join(' ');
      calls.push({ command, configDirectory: options?.configDirectory });
      if (command === 'plugin --help') return { exitCode: 0, stdout: 'marketplace', stderr: '' };
      if (command === 'plugin marketplace remove --help') {
        return { exitCode: 0, stdout: '--scope <scope>', stderr: '' };
      }
      if (command === 'plugin list --json') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(state.installed ? [{
            id: PLUGIN_ID, scope: 'user', enabled: state.enabled, version: state.version
          }] : []),
          stderr: ''
        };
      }
      if (command === 'plugin marketplace list --json') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(state.marketplace ? [{
            name: 'bitterless-local', path: join(root, 'eyes-on-agents', 'claude-marketplace')
          }] : []),
          stderr: ''
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'add') state.marketplace = true;
      if (args[1] === 'uninstall') { state.installed = false; state.enabled = false; state.version = null; }
      if (args[1] === 'install') {
        state.installed = true;
        state.enabled = installEnabled;
        state.version = PLUGIN_VERSION;
      }
      if (args[1] === 'enable') state.enabled = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  return { root, service, state, calls };
};

const automaticEnvironment = {
  id: uuid(10), label: 'Default', mode: 'automatic', configDirectory: null, enabled: true
};
const customEnvironment = {
  id: uuid(11), label: 'claude2', mode: 'custom',
  configDirectory: '/env/claude2/config', enabled: true
};
const environments = [automaticEnvironment, customEnvironment];

try {
  const command = await load('command', 'src/main/eyesOnAgents/claudeCommand.runner.ts');
  const pluginModule = await load('plugin', 'src/main/eyesOnAgents/claudePluginBridge.service.ts');
  const resolver = await load(
    'resolver',
    'src/main/eyesOnAgents/claudeBridgeEnvironment.resolver.ts'
  );
  const logHelper = await load('log-helper', 'src/main/eyesOnAgents/claudeBridgeLog.helper.ts');

  // 1. claudeCommand.runner.ts: the spawned process's environment reflects configDirectory
  //    exactly as specified — omitted/null leaves CLAUDE_CONFIG_DIR unset (today's exact ambient
  //    behavior), a given value sets it, and process.env is extended, never replaced.
  // This session's own ambient CLAUDE_CONFIG_DIR (set or unset) must pass through byte-for-byte
  // when no override is given — compare against the real process.env value rather than assuming
  // it is unset, since some environments (including this one) already export it.
  const probeScript = "process.stdout.write(process.env.CLAUDE_CONFIG_DIR || '<unset>')";
  const expectedAmbient = process.env.CLAUDE_CONFIG_DIR || '<unset>';
  const ambient = await command.runClaudeCommand(process.execPath, ['-e', probeScript], {});
  assert.equal(ambient.stdout, expectedAmbient, 'omitting configDirectory must leave today\'s ambient environment unchanged');
  const nullOverride = await command.runClaudeCommand(process.execPath, ['-e', probeScript], {
    configDirectory: null
  });
  assert.equal(nullOverride.stdout, expectedAmbient, 'a null configDirectory must behave exactly like an omitted one');
  const scoped = await command.runClaudeCommand(process.execPath, ['-e', probeScript], {
    configDirectory: customEnvironment.configDirectory
  });
  assert.equal(scoped.stdout, customEnvironment.configDirectory);
  const pathProbe = await command.runClaudeCommand(process.execPath, [
    '-e', "process.stdout.write(process.env.PATH ? 'has-path' : 'no-path')"
  ], { configDirectory: customEnvironment.configDirectory });
  assert.equal(pathProbe.stdout, 'has-path', 'a configDirectory override must extend process.env, not replace it');

  // 2. claudePluginBridge.service.ts: installing for a non-default environment spawns every
  //    marketplace/plugin CLI call with CLAUDE_CONFIG_DIR set to that environment's directory.
  //    (The two capability-probe help commands are a deliberate, documented exception — see the
  //    task's Implementation evidence — since they determine which claude binary to use, not
  //    anything scoped to one environment's registered plugins.)
  {
    const harness = createPluginHarness(pluginModule, { name: 'custom-install' });
    const status = await harness.service.install(customEnvironment.configDirectory);
    assert.equal(status.configured, true);
    assert.equal(status.enabled, true);
    assert(harness.calls.length > 0, 'install must issue at least one CLI command');
    for (const call of harness.calls) {
      if (HELP_COMMANDS.has(call.command)) {
        assert.equal(call.configDirectory, undefined, `help probe "${call.command}" must not be environment-scoped`);
      } else {
        assert.equal(
          call.configDirectory,
          customEnvironment.configDirectory,
          `"${call.command}" must run with CLAUDE_CONFIG_DIR set to the target environment's directory`
        );
      }
    }
    assert(
      harness.calls.some((call) => call.command.startsWith('plugin marketplace add')),
      'sanity: the mocked install sequence must have actually reached marketplace registration'
    );
  }

  // 3. Installing for the automatic environment (configDirectory omitted) spawns with no
  //    CLAUDE_CONFIG_DIR override at all — matching today's exact pre-086 behavior.
  {
    const harness = createPluginHarness(pluginModule, { name: 'automatic-install' });
    const status = await harness.service.install(undefined);
    assert.equal(status.configured, true);
    assert(harness.calls.length > 0);
    for (const call of harness.calls) {
      assert.equal(call.configDirectory, undefined, `"${call.command}" must not receive a CLAUDE_CONFIG_DIR override for the automatic environment`);
    }
  }

  // 4. refresh() and remove() thread configDirectory the same way as install().
  {
    const harness = createPluginHarness(pluginModule, { name: 'custom-refresh-remove' });
    await harness.service.install(customEnvironment.configDirectory);
    harness.calls.length = 0;
    await harness.service.refresh(customEnvironment.configDirectory);
    assert(harness.calls.length > 0);
    for (const call of harness.calls) {
      if (!HELP_COMMANDS.has(call.command)) {
        assert.equal(call.configDirectory, customEnvironment.configDirectory);
      }
    }
    harness.calls.length = 0;
    const removedStatus = await harness.service.remove(customEnvironment.configDirectory);
    assert.equal(removedStatus.configured, false);
    assert(harness.calls.length > 0);
    for (const call of harness.calls) {
      if (!HELP_COMMANDS.has(call.command)) {
        assert.equal(call.configDirectory, customEnvironment.configDirectory);
      }
    }
  }

  // 5. Two independent bridge operations for two different targets never leak each other's
  //    configDirectory — configDirectory is a plain per-call argument, never cached instance state.
  {
    const defaultHarness = createPluginHarness(pluginModule, { name: 'isolation-default' });
    const customHarness = createPluginHarness(pluginModule, { name: 'isolation-custom' });
    await Promise.all([
      defaultHarness.service.install(undefined),
      customHarness.service.install(customEnvironment.configDirectory)
    ]);
    assert(defaultHarness.calls.every((call) => call.configDirectory === undefined));
    assert(customHarness.calls.filter((call) => !HELP_COMMANDS.has(call.command))
      .every((call) => call.configDirectory === customEnvironment.configDirectory));
  }

  // 6. claudeBridgeEnvironment.resolver.ts: omitted/{} resolves to environments[0]; an explicit id
  //    resolves that exact environment; an unknown id rejects.
  assert.deepEqual(resolver.resolveClaudeBridgeEnvironment(environments, undefined), automaticEnvironment);
  assert.deepEqual(resolver.resolveClaudeBridgeEnvironment(environments, {}), automaticEnvironment);
  assert.deepEqual(
    resolver.resolveClaudeBridgeEnvironment(environments, { environmentId: customEnvironment.id }),
    customEnvironment
  );
  assert.throws(
    () => resolver.resolveClaudeBridgeEnvironment(environments, { environmentId: uuid(99) }),
    /Claude environment was not found/
  );
  assert.throws(
    () => resolver.resolveClaudeBridgeEnvironment([], undefined),
    /Claude environment was not found/
  );

  // 7. An unknown environmentId rejects cleanly with no CLI spawn attempted — the resolver throws
  //    before the plugin bridge is ever called, exactly mirroring eyesOnAgents.handler.ts's
  //    resolve-then-call sequence for installClaudeBridge/refreshClaudeBridgeStatus/removeClaudeBridge.
  {
    const harness = createPluginHarness(pluginModule, { name: 'unknown-environment-id' });
    const invokeInstall = async (params) => {
      const environment = resolver.resolveClaudeBridgeEnvironment(environments, params);
      return await harness.service.install(environment.configDirectory ?? undefined);
    };
    await assert.rejects(
      invokeInstall({ environmentId: uuid(99) }),
      /Claude environment was not found/
    );
    assert.equal(harness.calls.length, 0, 'an unknown environmentId must reject before any CLI command is attempted');
  }

  // 8. claudeBridgeLog.helper.ts: success/error lines carry id/label, are stage-scoped and
  //    length-bounded, and never contain the configDirectory value or raw error text unbounded.
  {
    const logs = [];
    const logger = {
      info: (line) => logs.push(['info', line]),
      error: (line) => logs.push(['error', line])
    };
    logHelper.logClaudeBridgeAction('install', customEnvironment, undefined, logger);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'info');
    assert.match(logs[0][1], /^\[claude-bridge\] action=install id=[0-9a-f-]+ label="claude2"$/);
    assert.doesNotMatch(logs[0][1], /\/env\/claude2\/config/);

    logs.length = 0;
    logHelper.logClaudeBridgeAction(
      'remove',
      customEnvironment,
      new Error('The Bitterless Claude plugin ownership could not be proven'),
      logger
    );
    assert.equal(logs[0][0], 'error');
    assert.match(
      logs[0][1],
      /^\[claude-bridge\] action=remove id=[0-9a-f-]+ label="claude2" error=The Bitterless Claude plugin ownership could not be proven$/
    );
    assert.doesNotMatch(logs[0][1], /\/env\/claude2\/config/);

    logs.length = 0;
    logHelper.logClaudeBridgeAction('refresh', customEnvironment, new Error('x'.repeat(1_000)), logger);
    assert(logs[0][1].length < 500, 'a long error message must be bounded, matching the 300-char plugin-bridge convention');
  }

  // ---- Task 090: probePluginPresence's verdict mapping ----
  // The read-only sibling of the install flow above. Every branch is asserted, because the whole
  // point of the four-value verdict is that 'unknown' ("we could not check") never masquerades as
  // 'not_installed' ("we checked and it is absent") — those prompt different user action.
  {
    const harness = createPluginHarness(pluginModule, { name: 'presence' });

    // Nothing installed yet: a successful probe that finds no plugin.
    assert.equal(await harness.service.probePluginPresence(), 'not_installed');

    // Installed and enabled.
    harness.state.installed = true;
    harness.state.enabled = true;
    harness.state.version = PLUGIN_VERSION;
    assert.equal(await harness.service.probePluginPresence(), 'installed');

    // Present but disabled must be distinguishable from absent, so the UI can offer the right fix.
    harness.state.enabled = false;
    assert.equal(await harness.service.probePluginPresence(), 'disabled');

    // The probe must target the directory it was given, exactly like the install flow does.
    harness.calls.length = 0;
    await harness.service.probePluginPresence('/env/claude2/config');
    const probeCalls = harness.calls.filter((call) => call.command.endsWith('--json'));
    assert.equal(probeCalls.length, 2, 'a probe is exactly one plugin list + one marketplace list');
    for (const call of probeCalls) {
      assert.equal(call.configDirectory, '/env/claude2/config');
    }

    // It must not disturb the shared installation state the rest of the bridge owns.
    const before = harness.service.getStatus();
    await harness.service.probePluginPresence('/env/claude2/config');
    assert.deepEqual(harness.service.getStatus(), before,
      'a read-only presence probe must not mutate the profile-wide bridge status');
  }

  {
    // A CLI that fails, and a CLI whose JSON is unparseable, are both "we could not check".
    const failing = new pluginModule.ClaudePluginBridgeService({
      identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
      userDataPath: fixtureRoot,
      execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
      appRootPath: fixtureRoot,
      pluginVersion: PLUGIN_VERSION,
      executableCandidates: ['/usr/bin/claude'],
      helperSourcePath: join(fixtureRoot, 'presence', 'claudeHookHelper.js'),
      idFactory: () => uuid(1),
      runtimeStatus: () => ({ listening: false, listeningSince: null }),
      runCommand: async (_executable, args) => {
        const command = args.join(' ');
        if (HELP_COMMANDS.has(command)) {
          return command === 'plugin --help'
            ? { exitCode: 0, stdout: 'marketplace', stderr: '' }
            : { exitCode: 0, stdout: '--scope <scope>', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'boom' };
      }
    });
    assert.equal(await failing.probePluginPresence(), 'unknown',
      'a non-zero CLI exit must report unknown, never not_installed');

    const unparseable = new pluginModule.ClaudePluginBridgeService({
      identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
      userDataPath: fixtureRoot,
      execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
      appRootPath: fixtureRoot,
      pluginVersion: PLUGIN_VERSION,
      executableCandidates: ['/usr/bin/claude'],
      helperSourcePath: join(fixtureRoot, 'presence', 'claudeHookHelper.js'),
      idFactory: () => uuid(1),
      runtimeStatus: () => ({ listening: false, listeningSince: null }),
      runCommand: async (_executable, args) => {
        const command = args.join(' ');
        if (command === 'plugin --help') return { exitCode: 0, stdout: 'marketplace', stderr: '' };
        if (command === 'plugin marketplace remove --help') {
          return { exitCode: 0, stdout: '--scope <scope>', stderr: '' };
        }
        return { exitCode: 0, stdout: 'not json at all', stderr: '' };
      }
    });
    assert.equal(await unparseable.probePluginPresence(), 'unknown');

    // No usable `claude` on the machine at all: resolveExecutable throws, which must still be
    // 'unknown' rather than a rejection escaping into the caller.
    const noExecutable = new pluginModule.ClaudePluginBridgeService({
      identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
      userDataPath: fixtureRoot,
      execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
      appRootPath: fixtureRoot,
      pluginVersion: PLUGIN_VERSION,
      executableCandidates: [],
      helperSourcePath: join(fixtureRoot, 'presence', 'claudeHookHelper.js'),
      idFactory: () => uuid(1),
      runtimeStatus: () => ({ listening: false, listeningSince: null }),
      runCommand: async () => { throw new Error('never reached'); }
    });
    assert.equal(await noExecutable.probePluginPresence(), 'unknown',
      'a missing claude executable must report unknown, never not_installed');
  }

  console.log('EyesOnAgents Claude environment plugin install tests passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
