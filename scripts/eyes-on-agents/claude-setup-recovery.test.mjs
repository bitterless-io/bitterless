import assert from 'node:assert/strict';
import {
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
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-setup-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-setup-build-'));
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

const createPluginHarness = ({
  name,
  installEnabled,
  enableExitCode = 0,
  enableCommits = true,
  ids = [uuid(1), uuid(2), uuid(3)]
}) => {
  const root = join(fixtureRoot, name);
  const helper = join(root, 'claudeHookHelper.js');
  mkdirSync(root, { recursive: true });
  writeFileSync(helper, 'module.exports = {};\n');
  const state = {
    marketplace: false,
    installed: false,
    enabled: false,
    version: null,
    additionalPlugins: [],
    runtimeListening: false
  };
  const commands = [];
  let idIndex = 0;
  const service = new pluginModule.ClaudePluginBridgeService({
    identity: pluginModule.resolveClaudePluginBridgeIdentity('production'),
    userDataPath: root,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: root,
    pluginVersion: PLUGIN_VERSION,
    executableCandidates: ['/usr/bin/claude'],
    helperSourcePath: helper,
    idFactory: () => ids[idIndex++],
    runtimeStatus: () => ({
      listening: state.runtimeListening,
      listeningSince: state.runtimeListening ? new Date(100).toISOString() : null
    }),
    runCommand: async (_executable, args) => {
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
            ...(state.installed ? [{
              id: PLUGIN_ID,
              scope: 'user',
              enabled: state.enabled,
              version: state.version
            }] : []),
            ...state.additionalPlugins
          ]),
          stderr: ''
        };
      }
      if (command === 'plugin marketplace list --json') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(state.marketplace ? [{
            name: 'bitterless-local',
            path: join(root, 'eyes-on-agents', 'claude-marketplace')
          }] : []),
          stderr: ''
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'add') state.marketplace = true;
      if (args[1] === 'uninstall') {
        state.installed = false;
        state.enabled = false;
        state.version = null;
      }
      if (args[1] === 'install') {
        state.installed = true;
        state.enabled = installEnabled;
        state.version = PLUGIN_VERSION;
      }
      if (args[1] === 'enable') {
        if (enableCommits) state.enabled = true;
        return { exitCode: enableExitCode, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  return { root, service, state, commands, ids };
};

const waitFor = async (condition, message) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  throw new Error(message);
};

let pluginModule;
try {
  pluginModule = await load(
    'plugin',
    'src/main/eyesOnAgents/claudePluginBridge.service.ts'
  );
  const hookContract = await load(
    'hook-contract',
    'src/shared/eyesOnAgents/claudeHookBridge.contract.ts'
  );

  const enabledByInstall = createPluginHarness({
    name: 'enabled-by-install',
    installEnabled: true,
    ids: [uuid(11), uuid(12)]
  });
  assert.equal(enabledByInstall.service.getStatus().setupAction, 'enable');
  const enabledInstallStatus = await enabledByInstall.service.install();
  assert.equal(enabledInstallStatus.setupAction, 'retry',
    'an exact install must prioritize recovering a stopped listener');
  assert.equal(enabledInstallStatus.restartRequired, true);
  assert.equal(
    enabledByInstall.commands.some((command) => command.startsWith('plugin enable ')),
    false,
    'an install that is already enabled must skip the failing redundant enable command'
  );
  enabledByInstall.state.runtimeListening = true;
  assert.equal(enabledByInstall.service.getStatus().setupAction, 'reload',
    'a listening exact install with a pending first receipt must request Claude reload');
  enabledByInstall.service.recordLiveReceipt(uuid(11), 100);
  assert.equal(enabledByInstall.service.getStatus().setupAction, 'none',
    'a listening exact install is complete after its first live receipt');
  enabledByInstall.state.runtimeListening = false;
  assert.equal(enabledByInstall.service.getStatus().setupAction, 'retry',
    'listener recovery must remain actionable after observation proof exists');

  const disabledByInstall = createPluginHarness({
    name: 'disabled-by-install',
    installEnabled: false,
    ids: [uuid(21)]
  });
  await disabledByInstall.service.install();
  assert.equal(disabledByInstall.commands.filter(
    (command) => command.startsWith('plugin enable ')
  ).length, 1, 'an explicitly disabled exact user plugin must receive one enable command');

  const unknownEnablement = createPluginHarness({
    name: 'unknown-enablement',
    installEnabled: undefined,
    ids: [uuid(22)]
  });
  await assert.rejects(
    () => unknownEnablement.service.install(),
    /failed at final inspection: enablement is unknown/
  );
  assert.equal(unknownEnablement.commands.some(
    (command) => command.startsWith('plugin enable ')
  ), false, 'missing enablement evidence must not be guessed as disabled');

  const committedNonzero = createPluginHarness({
    name: 'enable-committed-nonzero',
    installEnabled: false,
    enableExitCode: 1,
    enableCommits: true,
    ids: [uuid(31)]
  });
  const committedNonzeroStatus = await committedNonzero.service.install();
  assert.equal(committedNonzeroStatus.setupAction, 'retry',
    'a non-zero enable is idempotent success only after exact read-only enabled inspection');

  const failedEnable = createPluginHarness({
    name: 'enable-failed',
    installEnabled: false,
    enableExitCode: 1,
    enableCommits: false,
    ids: [uuid(41)]
  });
  await assert.rejects(
    () => failedEnable.service.install(),
    /^Error: Claude plugin enablement failed \(exit code 1\)$/
  );
  assert.equal(failedEnable.service.getStatus().setupAction, 'repair');

  const interrupted = createPluginHarness({
    name: 'interrupted',
    installEnabled: true,
    ids: [uuid(51), uuid(52)]
  });
  await interrupted.service.install();
  const interruptedStatePath = join(
    interrupted.root,
    'eyes-on-agents',
    'claude-plugin-bridge.json'
  );
  const committedState = JSON.parse(readFileSync(interruptedStatePath, 'utf8'));
  writeFileSync(interruptedStatePath, `${JSON.stringify({
    ...committedState,
    installed: false,
    artifactDigest: null,
    firstReceiptAt: null,
    lastReceiptAt: null,
    restartRequired: true,
    recoveryReason: null
  }, null, 2)}\n`);
  const oldOutboxRoot = hookContract.getClaudeHookOutboxPath(interrupted.root);
  const oldOutbox = hookContract.getClaudeHookOutboxPath(interrupted.root, uuid(51));
  mkdirSync(oldOutbox, { recursive: true });
  writeFileSync(join(oldOutbox, 'pending.json'), '{"setupPeriod":true}\n');
  await interrupted.service.refresh();
  assert.equal(interrupted.service.hasInstallationIntent(), true,
    'the restart-required partial checkpoint must trigger startup inspection');
  assert.equal(interrupted.service.getStatus().setupAction, 'finish',
    'only an exact enabled plugin plus the owned partial checkpoint may expose Finish');
  const finishCommandStart = interrupted.commands.length;
  const finishedStatus = await interrupted.service.install();
  const finishCommands = interrupted.commands.slice(finishCommandStart);
  assert.equal(finishedStatus.setupAction, 'retry');
  assert.equal(existsSync(oldOutboxRoot), false,
    'Finish must clear the setup-period outbox instead of adopting its events');
  assert(finishCommands.includes(`plugin uninstall ${PLUGIN_ID} --scope user -y`));
  assert(finishCommands.includes(`plugin install ${PLUGIN_ID} --scope user`));
  assert.equal(finishCommands.some((command) => command.startsWith('plugin enable ')), false);
  interrupted.service.recordLiveReceipt(uuid(51), 200);
  assert.equal(interrupted.service.getStatus().observationProof, 'none',
    'the old partial generation cannot become observation proof');
  interrupted.state.runtimeListening = true;
  assert.equal(interrupted.service.getStatus().setupAction, 'reload');
  interrupted.service.recordLiveReceipt(uuid(52), 201);
  assert.equal(interrupted.service.getStatus().setupAction, 'none');

  const serviceModule = await load('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts');
  const openedUrls = [];
  const clipboardWrites = [];
  const repository = {
    getSnapshot: async () => ({
      domains: [{
        id: 1,
        domainKey: 'uncategorized',
        title: 'Uncategorized',
        sortIndex: 0,
        isSystem: true
      }],
      threads: []
    }),
    getRuntimeReceiptSummary: async () => ({ firstReceivedAt: null, lastReceivedAt: null }),
    expireClaudeAgentStates: async () => ({ changed: false }),
    invalidateCodexHookStatuses: async () => ({ changed: false })
  };
  const desktopBridge = {
    getStatus: () => ({
      state: 'not_installed',
      reviewReason: null,
      listening: false,
      listeningSince: null,
      lastEventAt: null,
      lastInspectedAt: null,
      error: null
    }),
    hasInstallationIntent: () => false,
    hasExactInstallation: () => false,
    refreshInstalledArtifacts() { return this.getStatus(); },
    getDisabledExactHookKeys: () => [],
    install() { return this.getStatus(); },
    remove() { return this.getStatus(); },
    updateHookInspection: () => undefined,
    setHookInspectionError: () => undefined,
    setOperationalError: () => undefined
  };
  const actionService = new serviceModule.EyesOnAgentsService({
    repository,
    settings: {
      get: async () => false,
      upsert: async () => undefined
    },
    appServer: {
      getStatus: () => ({
        state: 'disconnected',
        clientId: null,
        threadId: null,
        lastSyncedAt: null,
        error: null,
        autoConnectEnabled: false
      }),
      isConnected: () => false,
      connect: async () => undefined,
      disconnect: async () => undefined,
      listThreads: async () => [],
      listArchivedThreads: async () => []
    },
    desktopBridge,
    bridgeListener: {
      start: async () => undefined,
      stop: async () => undefined,
      recoverOutboxCoverageGap: async () => undefined,
      replayOutbox: async () => undefined
    },
    claudeObservation: {
      start: async () => undefined,
      stop: async () => undefined,
      refresh: async () => ({ changed: false })
    },
    openExternal: async (url) => { openedUrls.push(url); },
    writeClipboardText: (text) => { clipboardWrites.push(text); }
  });
  assert.equal(actionService.openNewClaudeSession.length, 0);
  assert.equal(actionService.copyClaudeReloadCommand.length, 0);
  await assert.rejects(() => actionService.openNewClaudeSession(), /Claude support is paused/);
  await assert.rejects(() => actionService.copyClaudeReloadCommand(), /Claude support is paused/);
  await actionService.initialize();
  await waitFor(
    () => actionService.claudeProviderPreferenceEnabled === true,
    'Claude provider management did not hydrate'
  );
  await actionService.openNewClaudeSession();
  await actionService.copyClaudeReloadCommand();
  assert.deepEqual(openedUrls, ['claude://code/new']);
  assert.deepEqual(clipboardWrites, ['/reload-plugins']);
  await actionService.setClaudeProviderEnabled({ enabled: false });
  await assert.rejects(() => actionService.openNewClaudeSession(), /Claude support is paused/);
  await assert.rejects(() => actionService.copyClaudeReloadCommand(), /Claude support is paused/);
  assert.deepEqual(openedUrls, ['claude://code/new']);
  assert.deepEqual(clipboardWrites, ['/reload-plugins']);
  await actionService.shutdown();

  for (const failureStage of ['start', 'replay']) {
    const listenerCalls = [];
    const retryStatus = {
      state: 'installed',
      setupAction: 'retry',
      configured: true,
      enabled: true,
      listening: false,
      listeningSince: null,
      firstReceiptAt: '2026-08-18T01:00:00.000Z',
      lastReceiptAt: '2026-08-18T01:00:00.000Z',
      lastInspectedAt: '2026-08-18T01:00:00.000Z',
      observationProof: 'receipt',
      restartRequired: false,
      error: null
    };
    const retryService = new serviceModule.EyesOnAgentsService({
      repository,
      settings: {
        get: async () => false,
        upsert: async () => undefined
      },
      appServer: {
        getStatus: () => ({
          state: 'disconnected',
          clientId: null,
          threadId: null,
          lastSyncedAt: null,
          error: null,
          autoConnectEnabled: false
        }),
        isConnected: () => false,
        connect: async () => undefined,
        disconnect: async () => undefined,
        listThreads: async () => [],
        listArchivedThreads: async () => []
      },
      desktopBridge,
      bridgeListener: {
        start: async () => undefined,
        stop: async () => undefined,
        recoverOutboxCoverageGap: async () => undefined,
        replayOutbox: async () => undefined
      },
      claudeBridge: {
        getStatus: () => retryStatus,
        hasInstallationIntent: () => false,
        acceptsInstallation: () => true,
        revokeObservationProof: () => undefined,
        install: async () => retryStatus,
        refresh: async () => retryStatus,
        remove: async () => retryStatus
      },
      claudeHookListener: {
        start: async () => {
          listenerCalls.push('start');
          if (failureStage === 'start') throw new Error('unsafe start detail');
        },
        stop: async () => { listenerCalls.push('stop'); },
        replayOutbox: async () => {
          listenerCalls.push('replay');
          if (failureStage === 'replay') throw new Error('unsafe replay detail');
        }
      },
      claudeObservation: {
        start: async () => undefined,
        stop: async () => undefined,
        refresh: async () => ({ changed: false })
      },
      openExternal: async () => undefined,
      writeClipboardText: () => undefined
    });
    await retryService.initialize();
    await waitFor(
      () => retryService.claudeProviderProjectionEnabled === true,
      `Claude projection did not activate for ${failureStage} failure`
    );
    await assert.rejects(
      () => retryService.refreshClaudeBridgeStatus(),
      /^Error: Claude listener retry failed$/
    );
    assert.equal(retryService.claudeHookIntakeEnabled, false);
    assert.equal(listenerCalls.filter((call) => call === 'stop').length, 2,
      'retry must stop before inspection and again after listener failure');
    assert.equal(listenerCalls.includes('replay'), failureStage === 'replay');
    await retryService.shutdown();
  }

  const handlerSource = readFileSync(
    join(projectRoot, 'src/main/xpc/eyesOnAgents.handler.ts'),
    'utf8'
  );
  assert.match(handlerSource, /import \{ app, clipboard, dialog, shell \} from 'electron'/);
  assert.match(handlerSource, /writeClipboardText: \(text\) => clipboard\.writeText\(text\)/);
  assert.match(handlerSource, /async openNewClaudeSession\(\): Promise<void>/);
  assert.match(handlerSource, /async copyClaudeReloadCommand\(\): Promise<void>/);

  console.log('EyesOnAgents Claude setup recovery tests passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
