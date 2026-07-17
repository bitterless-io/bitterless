import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-bridge-build-'));
const profileRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-bridge-profile-'));
const homePath = join(profileRoot, 'home');
const userDataPath = join(profileRoot, 'user-data');
const settingsPath = join(homePath, '.codex', 'hooks.json');
const bridgeStatePath = join(userDataPath, 'eyes-on-agents', 'codex-bridge.json');
const shimPath = join(userDataPath, 'bin', 'bitterless-codex-session-hook');
const helperPath = join(
  userDataPath,
  'bin',
  'bitterless-codex-hook-helper',
  'codexHookHelper.cjs'
);
const outboxPath = join(userDataPath, 'eyes-on-agents', 'codex-hook-outbox');
const helperSourcePath = join(profileRoot, 'codexHookHelper.js');
const helperChunkSourcePath = join(profileRoot, 'chunks', 'codexHookOutbox.js');
const helperChunkPath = join(
  userDataPath,
  'bin',
  'bitterless-codex-hook-helper',
  'chunks',
  'codexHookOutbox.js'
);
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';
const STABLE_HOOK_COMMAND_PATTERN = /^(['"]).*[/\\]bitterless-codex-session-hook(?:\.cmd)?\1$/;

const loadTypeScriptModule = async (name, entry) => {
  const outfile = name === 'service'
    ? join(buildRoot, 'chunks', `${name}.mjs`)
    : join(buildRoot, `${name}.mjs`);
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

const ownedHandlers = (root) => Object.values(root.hooks ?? {}).flatMap((groups) =>
  groups.flatMap((group) => group.hooks.filter((handler) =>
    typeof handler.command === 'string' && STABLE_HOOK_COMMAND_PATTERN.test(handler.command)
  ))
);

const ownedHookDefinitions = (root, trustStatus = 'trusted', sourcePath = settingsPath) =>
  Object.entries(root.hooks ?? {}).flatMap(([eventName, groups]) =>
    groups.flatMap((group) => group.hooks
      .filter((handler) =>
        typeof handler.command === 'string' &&
        STABLE_HOOK_COMMAND_PATTERN.test(handler.command)
      )
      .map((handler) => ({
        command: handler.command,
        currentHash: `hash-${eventName}`,
        enabled: true,
        eventName: ({
          SessionStart: 'sessionStart',
          UserPromptSubmit: 'userPromptSubmit',
          PermissionRequest: 'permissionRequest',
          Stop: 'stop'
        })[eventName],
        handlerType: 'command',
        isManaged: false,
        key: `fresh-${eventName}`,
        matcher: group.matcher ?? null,
        source: 'user',
        sourcePath,
        trustStatus
      })))
  );

class FakeServer extends EventEmitter {
  listening = false;

  listen(_path, callback) {
    this.listening = true;
    queueMicrotask(callback);
    return this;
  }

  close(callback) {
    this.listening = false;
    queueMicrotask(callback);
    return this;
  }
}

try {
  let bridgeNow = 1_000;
  mkdirSync(dirname(helperChunkSourcePath), { recursive: true });
  writeFileSync(helperChunkSourcePath, 'module.exports = {};\n');
  writeFileSync(
    helperSourcePath,
    'require("./chunks/codexHookOutbox.js"); /* dedicated node-mode helper */\n'
  );
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'custom',
        hooks: [{ type: 'command', command: '/usr/bin/user-hook', timeout: 5 }]
      }]
    },
    userSetting: true
  }, null, 2)}\n`);

  const { CodexDesktopBridgeService } = await loadTypeScriptModule(
    'service',
    'src/main/eyesOnAgents/codexDesktopBridge.service.ts'
  );
  const service = new CodexDesktopBridgeService({
    userDataPath,
    homePath,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: profileRoot,
    helperSourcePath,
    platform: 'darwin',
    idFactory: () => INSTALLATION_ID,
    now: () => bridgeNow,
    runtimeStatus: () => ({ listening: true, listeningSince: 100, lastEventAt: 123 })
  });

  assert.equal(service.getStatus().state, 'not_installed');
  assert.equal(service.hasInstallationIntent(), false);
  assert.equal(service.install().state, 'needs_trust');
  assert.equal(service.hasInstallationIntent(), true);
  assert.equal(service.hasExactInstallation(), true);
  assert.equal(existsSync(shimPath), true);
  assert.equal(existsSync(helperPath), true);
  assert.equal(existsSync(helperChunkPath), true);
  const shim = readFileSync(shimPath, 'utf8');
  assert.match(shim, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(shim, /bitterless-codex-hook-helper.*codexHookHelper\.cjs/);
  assert.doesNotMatch(shim, /app\.main/);
  let root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(root.userSetting, true);
  assert.equal(root.hooks.SessionStart[0].hooks[0].command, '/usr/bin/user-hook');
  assert.equal(ownedHandlers(root).length, 4);
  assert.equal(existsSync(join(homePath, '.claude')), false, 'Codex bridge must not touch other agents');
  assert.equal(service.getStatus().listeningSince, new Date(100).toISOString());

  const trustedDefinitions = ownedHookDefinitions(root);
  service.updateHookInspection(trustedDefinitions);
  assert.equal(service.getStatus().state, 'installed');
  const firstInspectedAt = service.getStatus().lastInspectedAt;
  bridgeNow += 1_000;
  service.setOperationalError(new Error('private repository detail'));
  assert.equal(service.getStatus().state, 'error');
  assert.equal(
    service.getStatus().lastInspectedAt,
    firstInspectedAt,
    'an operational failure must preserve the time of the last actual hooks/list inspection'
  );
  service.updateHookInspection(trustedDefinitions);
  assert.equal(service.getStatus().state, 'installed');
  service.updateHookInspection(ownedHookDefinitions(root, 'managed'));
  assert.equal(service.getStatus().state, 'installed');
  for (const trustStatus of ['untrusted', 'modified']) {
    service.updateHookInspection(ownedHookDefinitions(root, trustStatus));
    assert.equal(
      service.getStatus().state,
      'needs_trust',
      `${trustStatus} definitions must require Codex review`
    );
    assert.equal(service.getStatus().reviewReason, trustStatus);
  }
  service.updateHookInspection(ownedHookDefinitions(root, 'unknown'));
  assert.equal(service.getStatus().state, 'error');
  service.updateHookInspection([
    { ...trustedDefinitions[0], enabled: false },
    ...trustedDefinitions.slice(1)
  ]);
  assert.equal(service.getStatus().state, 'needs_trust');
  assert.equal(service.getStatus().reviewReason, 'disabled');
  assert.deepEqual(service.getDisabledExactHookKeys(), [trustedDefinitions[0].key]);
  const disabledDefinitions = [
    { ...trustedDefinitions[0], enabled: false },
    ...trustedDefinitions.slice(1)
  ];
  const assertUnsafeInspection = (definitions, label) => {
    service.updateHookInspection(definitions);
    assert.equal(service.getStatus().state, 'drifted', `${label} must fail closed`);
    assert.deepEqual(
      service.getDisabledExactHookKeys(),
      [],
      `${label} must not expose a key for hooks.state re-enable`
    );
  };
  assertUnsafeInspection(disabledDefinitions.map((definition, index) => index === 0
    ? { ...definition, sourcePath: join(homePath, '.codex', 'spoof-hooks.json') }
    : definition), 'a wrong hook sourcePath');
  assertUnsafeInspection(disabledDefinitions.map((definition, index) => index === 0
    ? { ...definition, source: 'project' }
    : definition), 'a non-user hook source');
  assertUnsafeInspection(disabledDefinitions.map((definition, index) => index === 0
    ? { ...definition, isManaged: true }
    : definition), 'a managed hook definition');
  assertUnsafeInspection([
    ...disabledDefinitions,
    { ...disabledDefinitions[0], key: 'duplicate-owned-hook-key' }
  ], 'a duplicate exact hook definition');
  assertUnsafeInspection([
    ...disabledDefinitions,
    {
      ...disabledDefinitions[0],
      key: 'spoof-hook-key',
      sourcePath: join(homePath, '.codex', 'spoof-hooks.json')
    }
  ], 'an additional same-command ownership spoof');
  service.updateHookInspection(disabledDefinitions);
  assert.equal(service.getStatus().reviewReason, 'disabled');
  assert.deepEqual(service.getDisabledExactHookKeys(), [trustedDefinitions[0].key]);
  assert.notEqual(service.getStatus().lastInspectedAt, null);
  service.updateHookInspection(trustedDefinitions.slice(1));
  assert.equal(service.getStatus().state, 'drifted');
  const inspectedBeforeListFailure = service.getStatus().lastInspectedAt;
  bridgeNow += 1_000;
  service.setHookInspectionError(new Error(`malformed-${'x'.repeat(500)}`));
  assert.equal(service.getStatus().state, 'error');
  assert.notEqual(
    service.getStatus().lastInspectedAt,
    inspectedBeforeListFailure,
    'an actual hooks/list failure must stamp its inspection attempt'
  );
  assert.ok(service.getStatus().error.length <= 300, 'inspection errors must stay bounded');

  assert.equal(service.install().state, 'needs_trust');
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(ownedHandlers(root).length, 4, 'repeated install must stay idempotent');
  service.updateHookInspection(ownedHookDefinitions(root));
  assert.equal(service.getStatus().state, 'installed');

  const owned = ownedHandlers(root)[0];
  owned.timeout = 999;
  writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
  writeFileSync(shimPath, '#!/bin/sh\n# drifted-definition legacy shim\n');
  writeFileSync(helperPath, '/* drifted-definition legacy helper */\n');
  const driftedShim = readFileSync(shimPath);
  const driftedHelper = readFileSync(helperPath);
  assert.equal(service.getStatus().state, 'drifted');
  assert.equal(service.refreshInstalledArtifacts().state, 'drifted');
  assert.deepEqual(readFileSync(shimPath), driftedShim);
  assert.deepEqual(readFileSync(helperPath), driftedHelper);
  assert.equal(service.install().state, 'needs_trust', 'install must repair owned hook drift');
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  service.updateHookInspection(ownedHookDefinitions(root));
  assert.equal(service.getStatus().state, 'installed');

  const exactSettingsBeforeArtifactMigration = readFileSync(settingsPath);
  const exactSettingsModeBeforeArtifactMigration = statSync(settingsPath).mode;
  writeFileSync(
    helperSourcePath,
    'require("./chunks/codexHookOutbox.js"); /* upgraded dedicated node-mode helper */\n'
  );
  writeFileSync(
    shimPath,
    '#!/bin/sh\nexec "/Applications/Bitterless.app/Contents/MacOS/Bitterless" "app.main.js" --codex-hook-helper "$@"\n'
  );
  rmSync(dirname(helperPath), { recursive: true, force: true });
  assert.equal(service.getStatus().state, 'drifted');
  assert.equal(service.refreshInstalledArtifacts().state, 'installed');
  assert.deepEqual(
    readFileSync(settingsPath),
    exactSettingsBeforeArtifactMigration,
    'artifact migration must preserve hook definitions and their private trust keys byte-for-byte'
  );
  assert.equal(
    statSync(settingsPath).mode,
    exactSettingsModeBeforeArtifactMigration,
    'artifact migration must preserve the hooks file mode'
  );
  assert.match(readFileSync(shimPath, 'utf8'), /ELECTRON_RUN_AS_NODE=1/);
  assert.doesNotMatch(readFileSync(shimPath, 'utf8'), /app\.main/);
  assert.equal(readFileSync(helperPath, 'utf8'), readFileSync(helperSourcePath, 'utf8'));
  assert.equal(readFileSync(helperChunkPath, 'utf8'), readFileSync(helperChunkSourcePath, 'utf8'));

  mkdirSync(join(outboxPath, 'pending'), { recursive: true });
  writeFileSync(join(outboxPath, 'pending', 'stale-delivery.json'), '{}');
  const exactOwnedCommand = ownedHookDefinitions(root)[0].command;
  const lookalikeCommand = `${exactOwnedCommand} --unrelated`;
  root.hooks.SessionStart[0].hooks.push({
    type: 'command',
    command: lookalikeCommand,
    timeout: 9
  });
  writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
  writeFileSync(bridgeStatePath, '{ corrupt bridge state');
  assert.equal(service.remove().state, 'not_installed');
  assert.equal(service.hasInstallationIntent(), false);
  assert.equal(existsSync(bridgeStatePath), false, 'Disable must discard corrupt owned state');
  assert.equal(existsSync(settingsPath), true, 'unknown settings provenance must preserve hooks.json');
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(root.userSetting, true);
  assert.equal(root.hooks.SessionStart[0].hooks[0].command, '/usr/bin/user-hook');
  assert.ok(
    root.hooks.SessionStart[0].hooks.some((handler) => handler.command === lookalikeCommand),
    'Disable must preserve similar but non-exact user hook commands'
  );
  assert.equal(ownedHandlers(root).length, 0);
  assert.equal(existsSync(shimPath), false);
  assert.equal(existsSync(helperPath), false);
  assert.equal(existsSync(outboxPath), false, 'explicit Disable must discard stale outbox data');
  assert.equal(existsSync(helperChunkPath), false);
  assert.equal(
    service.install().state,
    'needs_trust',
    'Enable must recover after corrupt state was safely removed'
  );
  assert.equal(service.hasExactInstallation(), true);
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.ok(
    root.hooks.SessionStart[0].hooks.some((handler) => handler.command === lookalikeCommand),
    'recovery Enable must preserve unrelated hooks'
  );
  assert.equal(ownedHandlers(root).length, 4);
  assert.equal(service.remove().state, 'not_installed');

  const modeledAppRoot = join(profileRoot, 'packaged-app');
  const modeledHelperSource = join(modeledAppRoot, 'out', 'main', 'codexHookHelper.js');
  const modeledChunkSource = join(
    modeledAppRoot,
    'out',
    'main',
    'chunks',
    'codexHookOutbox.js'
  );
  const modeledHomePath = join(profileRoot, 'modeled-home');
  const modeledUserDataPath = join(profileRoot, 'modeled-user-data');
  mkdirSync(dirname(modeledChunkSource), { recursive: true });
  writeFileSync(modeledChunkSource, 'module.exports = { modeled: true };\n');
  writeFileSync(
    modeledHelperSource,
    'require("./chunks/codexHookOutbox.js"); /* packaged out/main helper */\n'
  );
  const defaultSourceService = new CodexDesktopBridgeService({
    userDataPath: modeledUserDataPath,
    homePath: modeledHomePath,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: modeledAppRoot,
    platform: 'darwin',
    idFactory: () => '15151515-1515-4515-8515-151515151515',
    runtimeStatus: () => ({ listening: false, listeningSince: null, lastEventAt: null })
  });
  assert.equal(
    defaultSourceService.install().state,
    'needs_trust',
    'a service bundled in out/main/chunks must resolve the helper from appRoot/out/main'
  );
  const modeledInstalledRoot = join(
    modeledUserDataPath,
    'bin',
    'bitterless-codex-hook-helper'
  );
  assert.equal(
    readFileSync(join(modeledInstalledRoot, 'codexHookHelper.cjs'), 'utf8'),
    readFileSync(modeledHelperSource, 'utf8')
  );
  assert.equal(
    readFileSync(join(modeledInstalledRoot, 'chunks', 'codexHookOutbox.js'), 'utf8'),
    readFileSync(modeledChunkSource, 'utf8')
  );
  const modeledHooks = readFileSync(join(modeledHomePath, '.codex', 'hooks.json'), 'utf8');
  assert.doesNotMatch(
    modeledHooks,
    /packaged-app/,
    'the stable Codex hook command must not contain the versioned application root'
  );
  assert.equal(defaultSourceService.remove().state, 'not_installed');

  const windowsHomePath = join(profileRoot, 'windows-home');
  const windowsUserDataPath = join(profileRoot, 'windows%user-data');
  const windowsSettingsPath = join(windowsHomePath, '.codex', 'hooks.json');
  const windowsShimPath = join(
    windowsUserDataPath,
    'bin',
    'bitterless-codex-session-hook.cmd'
  );
  mkdirSync(dirname(windowsSettingsPath), { recursive: true });
  writeFileSync(windowsSettingsPath, `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'custom',
        hooks: [{ type: 'command', command: 'C:\\user-hook.cmd', timeout: 5 }]
      }]
    },
    userSetting: true
  }, null, 2)}\n`);
  const windowsService = new CodexDesktopBridgeService({
    userDataPath: windowsUserDataPath,
    homePath: windowsHomePath,
    execPath: 'C:\\Program Files\\Bitterless\\Bitterless.exe',
    appRootPath: profileRoot,
    helperSourcePath,
    platform: 'win32',
    idFactory: () => '16161616-1616-4616-8616-161616161616',
    runtimeStatus: () => ({ listening: true, listeningSince: 200, lastEventAt: 300 })
  });
  assert.equal(windowsService.install().state, 'needs_trust');
  let windowsRoot = JSON.parse(readFileSync(windowsSettingsPath, 'utf8'));
  const windowsOwned = ownedHandlers(windowsRoot);
  assert.equal(windowsOwned.length, 4);
  assert.ok(
    windowsOwned.every((handler) => handler.command.includes('windows%%user-data')),
    'Win32 hook commands must preserve percent-bearing paths with batch escaping'
  );
  assert.equal(existsSync(windowsShimPath), true);
  windowsService.updateHookInspection(ownedHookDefinitions(
    windowsRoot,
    'trusted',
    windowsSettingsPath
  ));
  assert.equal(
    windowsService.getStatus().state,
    'installed',
    'escaped Win32 commands must be recognized as the installed Bitterless hooks'
  );
  assert.equal(windowsService.remove().state, 'not_installed');
  windowsRoot = JSON.parse(readFileSync(windowsSettingsPath, 'utf8'));
  assert.equal(windowsRoot.userSetting, true);
  assert.equal(windowsRoot.hooks.SessionStart[0].hooks[0].command, 'C:\\user-hook.cmd');
  assert.equal(ownedHandlers(windowsRoot).length, 0);
  assert.equal(existsSync(windowsShimPath), false);

  const contract = await loadTypeScriptModule(
    'contract',
    'src/shared/eyesOnAgents/codexHookBridge.contract.ts'
  );
  const endpoint = contract.getCodexHookBridgeEndpoint(userDataPath, 'darwin');
  const contractOutboxPath = contract.getCodexHookOutboxPath(userDataPath);
  const args = contract.createCodexHookHelperArguments(
    endpoint.path,
    INSTALLATION_ID,
    contractOutboxPath
  );
  assert.deepEqual(
    contract.parseCodexHookHelperArgs(['Bitterless', ...args], 'darwin'),
    { endpoint, installationId: INSTALLATION_ID, outboxPath: contractOutboxPath }
  );
  const providerIndex = args.indexOf('--coding-agent-provider');
  const rejectedArgs = [...args];
  rejectedArgs[providerIndex + 1] = 'unsupported-agent';
  assert.throws(
    () => contract.parseCodexHookHelperArgs(['Bitterless', ...rejectedArgs], 'darwin'),
    /only accepts codex/
  );

  const secret = 'PROMPT-SENTINEL-MUST-NOT-BE-FORWARDED';
  const event = contract.createCodexHookEvent({
    rawInput: {
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-a',
      prompt: secret,
      transcript: secret,
      tool_payload: secret
    },
    installationId: INSTALLATION_ID,
    eventId: EVENT_ID,
    occurredAt: 500
  });
  assert.doesNotMatch(JSON.stringify(event), /PROMPT-SENTINEL/);
  assert.equal(event.payload.sessionId, THREAD_ID);

  const { CodexHookBridgeServer } = await loadTypeScriptModule(
    'bridge-server',
    'src/main/eyesOnAgents/codexHookBridge.server.ts'
  );
  let listenerNow = 1_000;
  const bridgeServer = new CodexHookBridgeServer(
    () => listenerNow,
    () => new FakeServer()
  );
  const listenerEndpoint = {
    transport: 'win32-named-pipe',
    path: `\\\\.\\pipe\\bitterless-eyes-${process.pid}-${Date.now()}`
  };
  await bridgeServer.start({
    endpoint: listenerEndpoint,
    installationId: INSTALLATION_ID,
    consume: async () => undefined
  });
  assert.equal(bridgeServer.getListeningSince(), 1_000);
  listenerNow = 2_000;
  await bridgeServer.start({
    endpoint: listenerEndpoint,
    installationId: INSTALLATION_ID,
    consume: async () => undefined
  });
  assert.equal(
    bridgeServer.getListeningSince(),
    1_000,
    'an idempotent start must preserve the continuous listener lifetime'
  );
  await bridgeServer.stop();
  assert.equal(bridgeServer.getListeningSince(), null);
  await bridgeServer.start({
    endpoint: listenerEndpoint,
    installationId: INSTALLATION_ID,
    consume: async () => undefined
  });
  assert.equal(bridgeServer.getListeningSince(), 2_000);
  await bridgeServer.stop();

  console.log('EyesOnAgents Codex bridge tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(profileRoot, { recursive: true, force: true });
}
