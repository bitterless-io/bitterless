import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-legacy-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-legacy-build-'));
const productionPluginId = 'bitterless-observer@bitterless-local';
const pluginVersion = '0.260818.120000';
const installationId = '00000050-0000-4000-8000-000000000050';
const updateRequiredError =
  'Update Claude Code to continue: scoped plugin marketplace removal is required';

const load = async (name, entry, plugins = [], external = []) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, entry.includes('/renderer/')
      ? 'tsconfig.web.json'
      : 'tsconfig.node.json'),
    plugins,
    external,
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const writeLegacyMarketplace = (legacyRoot, marker = {
  owner: 'Bitterless',
  plugin: productionPluginId,
}) => {
  mkdirSync(join(legacyRoot, '.claude-plugin'), { recursive: true });
  writeFileSync(join(legacyRoot, '.bitterless-owner.json'), `${JSON.stringify(marker)}\n`);
  writeFileSync(join(legacyRoot, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
    name: 'bitterless-local',
    description: 'Bitterless local lifecycle observation plugins',
    owner: { name: 'Bitterless' },
    plugins: [{
      name: 'bitterless-observer',
      source: './plugins/bitterless-observer',
      description: 'Content-free local Claude lifecycle observation for Bitterless',
    }],
  })}\n`);
};

const validBridgeState = ({ installed, restartRequired }) => ({
  schemaVersion: 1,
  installationId: '00000049-0000-4000-8000-000000000049',
  installed,
  artifactDigest: null,
  firstReceiptAt: null,
  lastReceiptAt: null,
  restartRequired,
  recoveryReason: null,
});

const mutationCommands = (commands) => commands.filter((command) =>
  command !== 'plugin --help'
  && command !== 'plugin marketplace remove --help'
  && command !== 'plugin list --json'
  && command !== 'plugin marketplace list --json'
);

let pluginModule;
const createBridgeHarness = ({
  name,
  identity = 'production',
  marketplacePath,
  marker,
  plugins,
  previousState,
  injectLegacyRoot = true,
  failLegacyMarketplaceRemoveOnce = false,
  executableCandidates = ['/usr/bin/claude'],
  scopedRemovalCandidates = executableCandidates,
  failCommandOnce = null,
}) => {
  const profilesRoot = join(fixtureRoot, name);
  const productionRoot = join(profilesRoot, 'Bitterless_PROD');
  const legacyRoot = join(
    profilesRoot,
    'Bitterless_DEBUG_PROD',
    'eyes-on-agents',
    'claude-marketplace',
  );
  const helper = join(productionRoot, 'build', 'claudeHookHelper.js');
  mkdirSync(dirname(helper), { recursive: true });
  writeFileSync(helper, 'module.exports = {};\n');
  writeLegacyMarketplace(legacyRoot, marker);
  if (previousState) {
    const statePath = join(productionRoot, 'eyes-on-agents', 'claude-plugin-bridge.json');
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(previousState)}\n`);
  }
  const state = {
    marketplacePath: marketplacePath === 'legacy' ? legacyRoot : marketplacePath ?? null,
    plugins: plugins ?? [{
      id: productionPluginId,
      scope: 'user',
      enabled: true,
      version: '0.260817.100000',
    }],
  };
  const commands = [];
  const commandInvocations = [];
  let rejectLegacyMarketplaceRemove = failLegacyMarketplaceRemoveOnce;
  let rejectedCommand = false;
  const resolvedIdentity = pluginModule.resolveClaudePluginBridgeIdentity(identity);
  const service = new pluginModule.ClaudePluginBridgeService({
    identity: resolvedIdentity,
    userDataPath: productionRoot,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appRootPath: productionRoot,
    pluginVersion,
    executableCandidates,
    helperSourcePath: helper,
    idFactory: () => installationId,
    runtimeStatus: () => ({ listening: false, listeningSince: null }),
    ...(injectLegacyRoot ? { legacyProductionDebugMarketplaceRoot: legacyRoot } : {}),
    runCommand: async (executable, args) => {
      const command = args.join(' ');
      commands.push(command);
      commandInvocations.push({ executable, command });
      if (command === 'plugin --help') {
        return { exitCode: 0, stdout: 'marketplace', stderr: '' };
      }
      if (command === 'plugin marketplace remove --help') {
        return {
          exitCode: 0,
          stdout: scopedRemovalCandidates.includes(executable) ? '--scope <scope>' : 'remove',
          stderr: '',
        };
      }
      if (command === 'plugin list --json') {
        return { exitCode: 0, stdout: JSON.stringify(state.plugins), stderr: '' };
      }
      if (command === 'plugin marketplace list --json') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(state.marketplacePath ? [{
            name: resolvedIdentity.marketplaceName,
            path: state.marketplacePath,
          }] : []),
          stderr: '',
        };
      }
      if (!rejectedCommand && failCommandOnce === command) {
        rejectedCommand = true;
        return { exitCode: 1, stdout: 'unsafe output', stderr: 'secret path' };
      }
      if (args[1] === 'uninstall') state.plugins = [];
      if (args[1] === 'marketplace' && args[2] === 'remove') {
        if (rejectLegacyMarketplaceRemove) {
          rejectLegacyMarketplaceRemove = false;
          return { exitCode: 1, stdout: '', stderr: 'interrupted' };
        }
        state.marketplacePath = null;
      }
      if (args[1] === 'marketplace' && args[2] === 'add') state.marketplacePath = args[3];
      if (args[1] === 'install') {
        state.plugins = [{
          id: resolvedIdentity.pluginId,
          scope: 'user',
          enabled: true,
          version: pluginVersion,
        }];
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  return { commandInvocations, commands, legacyRoot, productionRoot, service, state };
};

const snapshot = ({ revision, error = null, title }) => ({
  domains: [],
  threads: [{
    sessionKey: 'codex:00000000-0000-4000-8000-000000000050',
    threadId: '00000000-0000-4000-8000-000000000050',
    domainId: 1,
    title,
    cwd: null,
    projectKey: null,
    projectRoot: null,
    projectName: null,
    runtimeState: 'unknown',
    activeFlags: [],
    activeTurnId: null,
    lastCompletedTurnId: null,
    lastCompletedAt: null,
    lastOpenedTurnId: null,
    lastOpenedAt: null,
    statusSource: 'discovery',
    statusObservedAt: null,
    statusFreshUntil: null,
    lastActivityAt: null,
    isUnread: false,
    isFocused: false,
  }],
  connection: { state: 'disconnected', error: null, autoConnectEnabled: false },
  bridge: { state: 'not_installed', error: null },
  claudeBridge: { state: error ? 'error' : 'drifted', error },
  claudeDirectory: { state: 'stopped' },
  claudeProvider: { enabled: true, error: null, revision },
  lastSyncedAt: null,
  lastUserPromptCaptureEnabled: false,
  claudeLastUserPromptCaptureEnabled: false,
  titleEnrichmentDiagnostic: null,
});

const storeEmitterPlugin = {
  name: 'eyes-on-agents-legacy-store-emitter',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /eyesOnAgents\.emitter$/ },
      () => ({ path: 'emitter', namespace: 'legacy-store-test' }),
    );
    buildApi.onLoad({ filter: /.*/, namespace: 'legacy-store-test' }, () => ({
      contents: `
        const harness = () => globalThis.__eyesOnAgentsLegacyStoreHarness;
        export const eyesOnAgentsEmitter = {
          getSnapshot: () => harness().getSnapshot(),
          installClaudeBridge: () => harness().installClaudeBridge()
        };
        export const subscribeEyesOnAgentsChanges = () => undefined;
      `,
      loader: 'js',
    }));
  },
};

test('production handler derives the legacy sibling only from the live appData identity', async () => {
  pluginModule = await load(
    'legacy-path-resolver',
    'src/main/eyesOnAgents/claudePluginBridge.service.ts',
  );
  const appDataPath = join(fixtureRoot, 'Application Support');
  const productionUserDataPath = join(appDataPath, 'Bitterless');
  assert.equal(
    pluginModule.resolveLegacyProductionDebugClaudeMarketplaceRoot({
      profile: { id: 'production', appName: 'Bitterless' },
      appDataPath,
      userDataPath: productionUserDataPath,
    }),
    join(
      appDataPath,
      'Bitterless_DEBUG_PROD',
      'eyes-on-agents',
      'claude-marketplace',
    ),
  );
  assert.equal(
    pluginModule.resolveLegacyProductionDebugClaudeMarketplaceRoot({
      profile: { id: 'production', appName: 'Bitterless' },
      appDataPath,
      userDataPath: join(fixtureRoot, 'custom-e2e-user-data'),
    }),
    null,
    'a custom E2E userData root must not enable production legacy recovery',
  );
  assert.equal(
    pluginModule.resolveLegacyProductionDebugClaudeMarketplaceRoot({
      profile: { id: 'production-debug', appName: 'Bitterless_DEBUG_PROD' },
      appDataPath,
      userDataPath: join(appDataPath, 'Bitterless_DEBUG_PROD'),
    }),
    null,
  );

  const handlerSource = readFileSync(
    join(projectRoot, 'src/main/xpc/eyesOnAgents.handler.ts'),
    'utf8',
  );
  assert.match(handlerSource, /appDataPath: app\.getPath\('appData'\)/);
  assert.match(handlerSource, /resolveLegacyProductionDebugClaudeMarketplaceRoot/);
  assert.doesNotMatch(handlerSource, /Bitterless_PROD/);
});

test('production Setup and Repair migrate a proven legacy marketplace before normal install', async () => {
  pluginModule ??= await load('legacy-plugin', 'src/main/eyesOnAgents/claudePluginBridge.service.ts');
  for (const scenario of [
    { name: 'setup', previousState: undefined },
    { name: 'repair', previousState: validBridgeState({ installed: true, restartRequired: true }) },
  ]) {
    const harness = createBridgeHarness({
      name: scenario.name,
      marketplacePath: 'legacy',
      previousState: scenario.previousState,
    });
    const status = await harness.service.install();
    const mutations = mutationCommands(harness.commands);
    assert.deepEqual(mutations.slice(0, 4), [
      `plugin uninstall ${productionPluginId} --scope user -y`,
      'plugin marketplace remove bitterless-local --scope user',
      `plugin marketplace add ${join(
        harness.productionRoot,
        'eyes-on-agents',
        'claude-marketplace',
      )} --scope user`,
      `plugin install ${productionPluginId} --scope user`,
    ]);
    const uninstallIndex = harness.commands.indexOf(mutations[0]);
    const removeIndex = harness.commands.indexOf(mutations[1]);
    const addIndex = harness.commands.indexOf(mutations[2]);
    assert(harness.commands.slice(uninstallIndex + 1, removeIndex).includes('plugin list --json'));
    assert(harness.commands.slice(uninstallIndex + 1, removeIndex).includes(
      'plugin marketplace list --json',
    ));
    assert(harness.commands.slice(removeIndex + 1, addIndex).includes('plugin list --json'));
    assert(harness.commands.slice(removeIndex + 1, addIndex).includes(
      'plugin marketplace list --json',
    ));
    assert.equal(status.configured, true);
    assert.equal(status.enabled, true);
    assert.equal(status.error, null);
    assert.equal(status.setupAction, 'retry');
    assert.equal(existsSync(harness.legacyRoot), true, 'migration must retain the legacy directory');
    assert.equal(
      JSON.parse(readFileSync(join(harness.legacyRoot, '.bitterless-owner.json'), 'utf8')).owner,
      'Bitterless',
    );
  }
});

test('legacy collisions fail closed before any mutating Claude command', async () => {
  pluginModule ??= await load(
    'legacy-plugin-collisions',
    'src/main/eyesOnAgents/claudePluginBridge.service.ts',
  );
  const cases = [
    {
      name: 'unknown-source',
      marketplacePath: join(fixtureRoot, 'unknown-source-marketplace'),
      expected: /marketplace name is owned by another source/,
    },
    {
      name: 'malformed-owner',
      marketplacePath: 'legacy',
      marker: { owner: 'Unknown', plugin: productionPluginId },
      expected: /ownership could not be proven/,
    },
    {
      name: 'extra-plugin',
      marketplacePath: 'legacy',
      plugins: [
        { id: productionPluginId, scope: 'user', enabled: true, version: pluginVersion },
        { id: 'other@bitterless-local', scope: 'user', enabled: true, version: '1.0.0' },
      ],
      expected: /namespace is shared/,
    },
    {
      name: 'non-user-scope',
      marketplacePath: 'legacy',
      plugins: [{ id: productionPluginId, scope: 'project', enabled: true, version: pluginVersion }],
      expected: /namespace is shared/,
    },
  ];
  for (const fixture of cases) {
    const harness = createBridgeHarness(fixture);
    await assert.rejects(() => harness.service.install(), fixture.expected);
    assert.deepEqual(mutationCommands(harness.commands), [], fixture.name);
    assert.match(harness.service.getStatus().error ?? '', fixture.expected, fixture.name);
  }

  const nonProduction = createBridgeHarness({
    name: 'non-production',
    identity: 'production-debug',
    marketplacePath: 'legacy',
    plugins: [{
      id: 'bitterless-observer-production-debug@bitterless-local-production-debug',
      scope: 'user',
      enabled: true,
      version: pluginVersion,
    }],
  });
  await assert.rejects(() => nonProduction.service.install(), /owned by another source/);
  assert.deepEqual(mutationCommands(nonProduction.commands), []);
});

test('interrupted legacy removal resumes from the proven zero-plugin state', async () => {
  pluginModule ??= await load(
    'legacy-plugin-resume',
    'src/main/eyesOnAgents/claudePluginBridge.service.ts',
  );
  const harness = createBridgeHarness({
    name: 'interrupted-remove',
    marketplacePath: 'legacy',
    failLegacyMarketplaceRemoveOnce: true,
  });

  await assert.rejects(() => harness.service.install(), /marketplace removal failed/);
  assert.deepEqual(mutationCommands(harness.commands), [
    `plugin uninstall ${productionPluginId} --scope user -y`,
    'plugin marketplace remove bitterless-local --scope user',
  ]);
  assert.deepEqual(harness.state.plugins, []);
  assert.equal(harness.state.marketplacePath, harness.legacyRoot);
  assert.equal(existsSync(harness.legacyRoot), true);

  const retryStart = harness.commands.length;
  const status = await harness.service.install();
  assert.deepEqual(mutationCommands(harness.commands.slice(retryStart)), [
    'plugin marketplace remove bitterless-local --scope user',
    `plugin marketplace add ${join(
      harness.productionRoot,
      'eyes-on-agents',
      'claude-marketplace',
    )} --scope user`,
    `plugin install ${productionPluginId} --scope user`,
  ]);
  assert.equal(status.enabled, true);
  assert.equal(status.error, null);
  assert.equal(existsSync(harness.legacyRoot), true);
});

test('capability probing skips an old Claude CLI before resuming the zero-plugin checkpoint', async () => {
  pluginModule ??= await load(
    'legacy-plugin-capability',
    'src/main/eyesOnAgents/claudePluginBridge.service.ts',
  );
  const oldExecutable = '/Users/ral/.local/bin/claude';
  const currentExecutable = '/usr/local/bin/claude';
  const harness = createBridgeHarness({
    name: 'capability-selection',
    marketplacePath: 'legacy',
    plugins: [],
    executableCandidates: [oldExecutable, currentExecutable],
    scopedRemovalCandidates: [currentExecutable],
  });

  const status = await harness.service.install();
  assert.equal(status.enabled, true);
  assert(harness.commandInvocations.some(({ executable, command }) =>
    executable === oldExecutable && command === 'plugin marketplace remove --help'));
  assert(harness.commandInvocations.some(({ executable, command }) =>
    executable === currentExecutable && command === 'plugin marketplace remove --help'));
  const capabilityInvocations = harness.commandInvocations.filter(
    ({ command }) => command.endsWith('--help'),
  );
  assert.deepEqual(capabilityInvocations, [
    { executable: oldExecutable, command: 'plugin --help' },
    { executable: oldExecutable, command: 'plugin marketplace remove --help' },
    { executable: currentExecutable, command: 'plugin --help' },
    { executable: currentExecutable, command: 'plugin marketplace remove --help' },
  ]);
  assert(harness.commandInvocations.filter(({ command }) =>
    mutationCommands([command]).length > 0
  ).every(({ executable }) => executable === currentExecutable));
  await harness.service.refresh();
  assert.deepEqual(
    harness.commandInvocations.filter(({ command }) => command.endsWith('--help')),
    capabilityInvocations,
    'a compatible executable must remain cached across internal and later refreshes',
  );

  const incompatible = createBridgeHarness({
    name: 'capability-update-required',
    marketplacePath: 'legacy',
    plugins: [],
    executableCandidates: [oldExecutable],
    scopedRemovalCandidates: [],
  });
  await assert.rejects(
    () => incompatible.service.install(),
    new RegExp(updateRequiredError),
  );
  assert.deepEqual(mutationCommands(incompatible.commands), []);
  assert.equal(incompatible.service.getStatus().state, 'error');
  assert.equal(incompatible.service.getStatus().error, updateRequiredError);
  const incompatibleProbeCount = incompatible.commands.filter(
    (command) => command.endsWith('--help'),
  ).length;
  await incompatible.service.refresh();
  assert.equal(
    incompatible.commands.filter((command) => command.endsWith('--help')).length,
    incompatibleProbeCount * 2,
    'an incompatible executable must be re-probed instead of cached',
  );

  const laterStageFailure = createBridgeHarness({
    name: 'later-stage-retention',
    marketplacePath: null,
    plugins: [],
    failCommandOnce: `plugin marketplace add ${join(
      fixtureRoot,
      'later-stage-retention',
      'Bitterless_PROD',
      'eyes-on-agents',
      'claude-marketplace',
    )} --scope user`,
  });
  await assert.rejects(
    () => laterStageFailure.service.install(),
    /Claude plugin marketplace registration failed \(exit code 1\)/,
  );
  assert.equal(
    laterStageFailure.service.getStatus().error,
    'Claude plugin marketplace registration failed (exit code 1)',
  );
  assert.doesNotMatch(laterStageFailure.service.getStatus().error ?? '', /unsafe output|secret path/);
});

test('null Claude action reloads bounded status without replacing a newer provider revision', async () => {
  let returnedSnapshot = snapshot({ revision: 5, title: 'initial' });
  globalThis.__eyesOnAgentsLegacyStoreHarness = {
    getSnapshot: async () => returnedSnapshot,
    installClaudeBridge: async () => null,
  };
  const storeModule = await load(
    'legacy-store',
    'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts',
    [storeEmitterPlugin],
  );
  const store = storeModule.eyesOnAgentsStore;
  await store.loadSnapshot();

  returnedSnapshot = snapshot({
    revision: 6,
    error: updateRequiredError,
    title: 'refreshed',
  });
  await assert.rejects(() => store.installClaudeBridge(), new RegExp(updateRequiredError));
  assert.equal(store.snapshot.threads[0].title, 'refreshed');
  assert.equal(store.snapshot.claudeProvider.revision, 6);
  assert.equal(store.actionError, updateRequiredError);

  returnedSnapshot = snapshot({ revision: 5, error: 'stale failure', title: 'stale' });
  await assert.rejects(() => store.installClaudeBridge(), new RegExp(updateRequiredError));
  assert.equal(store.snapshot.threads[0].title, 'refreshed');
  assert.equal(store.snapshot.claudeProvider.revision, 6);
  assert.equal(store.actionError, updateRequiredError);
});

test.after(() => {
  delete globalThis.__eyesOnAgentsLegacyStoreHarness;
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});
