/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-coding-agent-ui-'));
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    promise,
    resolve: (value) => resolvePromise(value),
    reject: (error) => rejectPromise(error)
  };
};

const record = (overrides = {}) => ({
  id: ID_1,
  provider: 'codex',
  surface: 'codex-desktop',
  externalSessionId: '019f653a-2ef7-7031-8f6b-c770bacffbb2',
  runtimeJobId: null,
  title: 'API pagination',
  titleIsCustom: false,
  cwd: '/tmp/project',
  state: 'unknown',
  lastTurnState: 'unknown',
  providerState: null,
  statusSource: 'none',
  statusObservedAt: null,
  statusFreshUntil: null,
  isProcessAlive: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
});

const integration = (provider, configuration = 'not-installed') => ({
  provider,
  product: provider === 'codex' ? 'Codex' : 'Claude Code CLI',
  configuration,
  bridgeListening: true,
  requiresTrust: provider === 'codex' && configuration === 'configured',
  lastEventAt: null,
  message: 'fixture'
});

const makeApi = (overrides = {}) => ({
  list: async () => [],
  register: async (params) =>
    record({
      provider: params.provider,
      surface: params.surface,
      externalSessionId: params.externalSessionId
    }),
  refresh: async (params) => ({
    providers: params?.provider ? [params.provider] : ['codex', 'claude'],
    discoveredCount: 0,
    importedCount: 0,
    issues: []
  }),
  open: async () => ({ kind: 'opened-url', url: 'codex://fixture' }),
  rename: async ({ title }) => record({ title }),
  remove: async () => true,
  getIntegrationStatus: async ({ provider }) => integration(provider),
  installStatusBridge: async ({ provider }) => integration(provider, 'configured'),
  removeStatusBridge: async ({ provider }) => integration(provider),
  ...overrides
});

const makeDependencies = (api, listeners = [], intervals = []) => ({
  api,
  subscribeChanged: (listener) => listeners.push(listener),
  copyText: async () => undefined,
  now: () => 100_000,
  setInterval: (handler, timeout) => {
    intervals.push({ handler, timeout });
    return intervals.length;
  },
  clearInterval: () => undefined
});

const settle = async () => {
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
};

try {
  const outfile = join(buildRoot, 'codingAgentSession.store.mjs');
  await build({
    entryPoints: [
      join(
        projectRoot,
        'src/renderer/home/src/views/codingAgentSessions/codingAgentSession.store.ts'
      )
    ],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    plugins: [
      {
        name: 'electron-xpc-renderer-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
            path: 'electron-xpc/renderer',
            namespace: 'fixture'
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
                export const createXpcRendererEmitter = () => ({});
                export const xpcRenderer = { subscribe: () => undefined };
              `,
            loader: 'js'
          }));
        }
      }
    ]
  });
  const { CodingAgentSessionState } = await import(pathToFileURL(outfile).href);

  // First load keeps controls stateful, exposes loading, and records recoverable errors.
  const firstList = deferred();
  const firstListeners = [];
  const firstState = new CodingAgentSessionState(
    makeDependencies(makeApi({ list: async () => await firstList.promise }), firstListeners)
  );
  const initializing = firstState.initialize();
  assert.equal(firstState.initialLoading, true);
  assert.equal(firstListeners.length, 1);
  firstList.resolve([]);
  await initializing;
  assert.equal(firstState.initialLoading, false);
  assert.deepEqual(firstState.sessions, []);

  const failedState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        list: async () => {
          throw new Error('list failed');
        }
      })
    )
  );
  await failedState.initialize();
  assert.equal(failedState.loadError, 'list failed');
  assert.deepEqual(failedState.sessions, []);

  // Provider-scoped counts, local filters, action-first sorting, and explicit turn completion.
  const filterState = new CodingAgentSessionState(makeDependencies(makeApi()));
  filterState.sessions = [
    record({ id: ID_1, state: 'unknown', updatedAt: 30 }),
    record({ id: ID_2, state: 'working', updatedAt: 10 }),
    record({
      id: ID_3,
      provider: 'claude',
      surface: 'claude-code-background',
      state: 'waiting_input',
      updatedAt: 5
    }),
    record({
      id: '44444444-4444-4444-8444-444444444444',
      state: 'idle',
      lastTurnState: 'completed',
      updatedAt: 20
    })
  ];
  assert.deepEqual(
    filterState.visibleSessions.map((item) => item.state),
    ['waiting_input', 'working', 'idle', 'unknown']
  );
  assert.equal(filterState.displayState(filterState.sessions[3]), 'turn_complete');
  filterState.providerFilter = 'codex';
  assert.equal(filterState.allCount, 3);
  assert.equal(filterState.workingCount, 1);
  filterState.stateFilter = 'unknown';
  assert.deepEqual(
    filterState.visibleSessions.map((item) => item.id),
    [ID_1]
  );

  // Manual refresh retains rows, rejects duplicate clicks, then reloads the canonical list.
  const refreshGate = deferred();
  let refreshCalls = 0;
  let listCalls = 0;
  const refreshedRows = [record(), record({ id: ID_2, title: 'Imported' })];
  const refreshState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        list: async () => {
          listCalls += 1;
          return listCalls === 1 ? [record()] : refreshedRows;
        },
        refresh: async () => {
          refreshCalls += 1;
          return await refreshGate.promise;
        }
      })
    )
  );
  await refreshState.initialize();
  const refreshing = refreshState.refresh();
  void refreshState.refresh();
  assert.equal(refreshState.refreshing, true);
  assert.equal(refreshState.sessions.length, 1, 'refresh must retain existing rows');
  assert.equal(refreshCalls, 1);
  refreshGate.resolve({
    providers: ['codex', 'claude'],
    discoveredCount: 1,
    importedCount: 1,
    issues: [{ provider: 'claude', code: 'cli-unavailable', message: 'missing' }]
  });
  await refreshing;
  assert.equal(refreshState.refreshing, false);
  assert.equal(refreshState.sessions.length, 2);
  assert.equal(refreshState.discoveryAvailability.claude, 'unavailable');
  assert.equal(refreshState.discoveryAvailability.codex, 'available');

  // Broadcasts read payload.params upstream, reload canonical rows, and dedupe revisions.
  const changedListeners = [];
  let changedListCalls = 0;
  const changedState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        list: async () => {
          changedListCalls += 1;
          return changedListCalls === 1 ? [record()] : [record({ title: 'Changed' })];
        }
      }),
      changedListeners
    )
  );
  await changedState.initialize();
  changedListeners[0]({ ids: [ID_1], revision: 1 });
  await settle();
  assert.equal(changedState.sessions[0].title, 'Changed');
  const afterChange = changedListCalls;
  changedListeners[0]({ ids: [ID_1], revision: 1 });
  changedListeners[0]({ ids: 'invalid', revision: 2 });
  await settle();
  assert.equal(changedListCalls, afterChange);

  // Registration validates UUID/surface/cwd, omits a blank title, and preserves server errors.
  let registeredParams;
  const registrationState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        register: async (params) => {
          registeredParams = params;
          return record(params);
        }
      })
    )
  );
  registrationState.openAddDialog();
  registrationState.setRegistrationProvider('claude');
  assert.equal(registrationState.registrationForm.surface, 'claude-code-cli');
  assert.equal(registrationState.validateRegistration(), false);
  assert.equal(registrationState.registrationErrors.externalSessionId, 'uuid');
  assert.equal(registrationState.registrationErrors.cwd, 'required');
  registrationState.registrationForm.externalSessionId = ID_2;
  registrationState.registrationForm.cwd = 'relative/path';
  assert.equal(registrationState.validateRegistration(), false);
  assert.equal(registrationState.registrationErrors.cwd, 'absolute-path');
  registrationState.registrationForm.cwd = '/tmp/project';
  registrationState.registrationForm.title = '   ';
  await registrationState.submitRegistration();
  assert.equal(Object.hasOwn(registeredParams, 'title'), false);
  assert.equal(registeredParams.cwd, '/tmp/project');

  const rejectedRegistration = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        register: async () => {
          throw new Error('provider rejected');
        }
      })
    )
  );
  rejectedRegistration.openAddDialog();
  rejectedRegistration.registrationForm.externalSessionId = ID_1;
  await rejectedRegistration.submitRegistration();
  assert.equal(rejectedRegistration.dialogMode, 'add');
  assert.equal(rejectedRegistration.registrationErrors.form, 'provider rejected');
  assert.equal(rejectedRegistration.registrationForm.externalSessionId, ID_1);

  // Blank rename is a deliberate null clear.
  let renamedTitle = 'unset';
  const renameState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        rename: async ({ title }) => {
          renamedTitle = title;
          return record({ title });
        }
      })
    )
  );
  renameState.openRenameDialog(record());
  renameState.renameTitle = '   ';
  await renameState.submitRename();
  assert.equal(renamedTitle, null);

  // Live/unknown foreground Claude sessions never ask main to open; renderer never executes targets.
  let openCalls = 0;
  const openState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        open: async () => {
          openCalls += 1;
          return {
            kind: 'terminal-command',
            target: {
              kind: 'claude-resume',
              executable: 'claude',
              args: ['--resume', ID_2],
              cwd: '/tmp'
            }
          };
        }
      })
    )
  );
  const liveClaude = record({
    id: ID_2,
    provider: 'claude',
    surface: 'claude-code-cli',
    isProcessAlive: true
  });
  const unknownClaude = record({ ...liveClaude, id: ID_3, isProcessAlive: null });
  const inactiveClaude = record({ ...liveClaude, id: ID_1, isProcessAlive: false });
  assert.equal(openState.primaryAction(liveClaude).kind, 'already-open');
  assert.equal(openState.primaryAction(unknownClaude).reason, 'liveness-unknown');
  await openState.openSession(liveClaude);
  await openState.openSession(unknownClaude);
  assert.equal(openCalls, 0);
  await openState.openSession(inactiveClaude);
  assert.equal(openCalls, 1);
  assert.equal(openState.actionErrors[ID_1].code, 'terminal-main-required');

  // Integration drawer loads both providers and uses install as explicit drift repair.
  const integrationState = new CodingAgentSessionState(
    makeDependencies(
      makeApi({
        getIntegrationStatus: async ({ provider }) =>
          integration(provider, provider === 'codex' ? 'drifted' : 'configured')
      })
    )
  );
  await integrationState.openIntegrations();
  assert.equal(integrationState.integrationStatuses.codex.configuration, 'drifted');
  assert.equal(integrationState.integrationStatuses.claude.configuration, 'configured');
  await integrationState.installIntegration('codex');
  assert.equal(integrationState.integrationStatuses.codex.configuration, 'configured');

  // Visible/hidden Claude polling uses bounded, distinct cadences.
  const intervals = [];
  const pollingState = new CodingAgentSessionState(makeDependencies(makeApi(), [], intervals));
  pollingState.setPageVisible(true);
  await pollingState.initialize();
  assert.ok(intervals.some((item) => item.timeout === 15_000));
  pollingState.setPageVisible(false);
  assert.ok(intervals.some((item) => item.timeout === 60_000));

  // Renderer source keeps terminal execution out of the browser boundary and includes all states.
  const storeSource = readFileSync(
    join(
      projectRoot,
      'src/renderer/home/src/views/codingAgentSessions/codingAgentSession.store.ts'
    ),
    'utf8'
  );
  assert(!storeSource.includes('child_process'));
  assert(!storeSource.includes('shell.openExternal'));
  assert(storeSource.includes("result.kind === 'terminal-command'"));

  for (const sourcePath of [
    'src/renderer/home/src/views/codingAgentSessions/CodingAgentSessions.vue',
    'src/renderer/home/src/views/codingAgentSessions/components/CodingAgentSessionRow/CodingAgentSessionRow.vue',
    'src/renderer/home/src/views/codingAgentSessions/components/CodingAgentSessionDialog/CodingAgentSessionDialog.vue',
    'src/renderer/home/src/views/codingAgentSessions/components/CodingAgentIntegrationDrawer/CodingAgentIntegrationDrawer.vue'
  ]) {
    const source = readFileSync(join(projectRoot, sourcePath), 'utf8');
    assert(source.includes('i18nHelper.codingAgentSessions'));
  }

  console.log('[coding-agent-ui] ok');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
