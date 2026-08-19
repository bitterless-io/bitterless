import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-activation-refresh-'));

const emitterPlugin = {
  name: 'eyes-on-agents-activation-emitter',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /eyesOnAgents\.emitter$/ },
      () => ({ path: 'emitter', namespace: 'eyes-activation-test' }),
    );
    buildApi.onLoad({ filter: /.*/, namespace: 'eyes-activation-test' }, () => ({
      contents: `
        const harness = () => globalThis.__eyesOnAgentsActivationHarness;
        export const eyesOnAgentsEmitter = {
          getSnapshot: () => harness().getSnapshot(),
          syncThreads: () => harness().syncThreads(),
          refreshClaudeInventory: () => harness().refreshClaudeInventory(),
          refreshCodexBridgeStatus: () => harness().refreshCodexBridgeStatus(),
          refreshClaudeBridgeStatus: () => harness().refreshClaudeBridgeStatus()
        };
        export const subscribeEyesOnAgentsChanges = () => undefined;
      `,
      loader: 'js',
    }));
  },
};

const snapshot = ({
  state,
  autoConnectEnabled,
  title = 'before',
  bridgeState = 'not_installed',
  reviewReason = null,
  listening = false,
  claudeProviderEnabled = false,
  claudeProviderRevision = 1,
  claudeBridgeState = 'not_installed',
}) => ({
  domains: [],
  threads: [{
    threadId: '11111111-1111-4111-8111-111111111111',
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
    lastActivityAt: null,
    isUnread: false,
    isFocused: false,
  }],
  connection: {
    state,
    lastSyncedAt: null,
    error: null,
    autoConnectEnabled,
  },
  bridge: {
    state: bridgeState,
    reviewReason,
    listening,
    listeningSince: null,
    lastEventAt: null,
    lastInspectedAt: null,
    error: null,
  },
  claudeProvider: {
    enabled: claudeProviderEnabled,
    error: null,
    revision: claudeProviderRevision,
  },
  claudeBridge: { state: claudeBridgeState },
  lastSyncedAt: null,
});

const createHarness = ({
  initial,
  synced = snapshot({ state: 'connected', autoConnectEnabled: true, title: 'after sync' }),
  local = initial,
  inspected = local,
  syncImplementation,
  inspectionImplementation,
  claudeInventoryImplementation,
  claudeInspectionImplementation,
}) => {
  const calls = { snapshot: 0, sync: 0, inspection: 0, claudeInventory: 0, claudeInspection: 0 };
  return {
    calls,
    getSnapshot: async () => {
      calls.snapshot += 1;
      return local;
    },
    syncThreads: async () => {
      calls.sync += 1;
      if (syncImplementation) return await syncImplementation();
      return synced;
    },
    refreshCodexBridgeStatus: async () => {
      calls.inspection += 1;
      if (inspectionImplementation) return await inspectionImplementation();
      return inspected;
    },
    refreshClaudeInventory: async () => {
      calls.claudeInventory += 1;
      if (claudeInventoryImplementation) return await claudeInventoryImplementation();
      return local;
    },
    refreshClaudeBridgeStatus: async () => {
      calls.claudeInspection += 1;
      if (claudeInspectionImplementation) return await claudeInspectionImplementation();
      return inspected;
    },
  };
};

test('window activation refresh follows connection intent and coalesces overlap', async (context) => {
  try {
    const outfile = join(buildRoot, 'eyesOnAgents.store.mjs');
    await build({
      entryPoints: [join(
        projectRoot,
        'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts',
      )],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      tsconfig: join(projectRoot, 'tsconfig.web.json'),
      external: ['vue'],
      plugins: [emitterPlugin],
    });

    let importSequence = 0;
    const loadStore = async (harness, initial) => {
      globalThis.__eyesOnAgentsActivationHarness = harness;
      importSequence += 1;
      const module = await import(`${pathToFileURL(outfile).href}?v=${importSequence}`);
      module.eyesOnAgentsStore.snapshot = initial;
      return module.eyesOnAgentsStore;
    };

    await context.test(
      'connected activation synchronizes and applies changed thread titles',
      async () => {
        const initial = snapshot({ state: 'connected', autoConnectEnabled: true });
        const harness = createHarness({ initial });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 1);
        assert.equal(harness.calls.snapshot, 0);
        assert.equal(harness.calls.inspection, 0);
        assert.equal(store.threads[0]?.title, 'after sync');
      },
    );

    await context.test(
      'connected activation also performs a fresh observation trust check',
      async () => {
        const initial = snapshot({
          state: 'connected',
          autoConnectEnabled: true,
          bridgeState: 'needs_trust',
          reviewReason: 'untrusted',
        });
        const synced = snapshot({
          state: 'connected',
          autoConnectEnabled: true,
          title: 'after sync',
          bridgeState: 'needs_trust',
          reviewReason: 'untrusted',
        });
        const inspected = snapshot({
          state: 'connected',
          autoConnectEnabled: true,
          title: 'after inspection',
          bridgeState: 'installed',
          listening: true,
        });
        const harness = createHarness({ initial, synced, inspected });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 1);
        assert.equal(harness.calls.snapshot, 0);
        assert.equal(harness.calls.inspection, 1);
        assert.equal(store.snapshot.bridge.state, 'installed');
        assert.equal(store.threads[0]?.title, 'after inspection');
      },
    );

    for (const state of ['disconnected', 'error']) {
      await context.test(
        `${state} activation retries when auto-connect remains enabled`,
        async () => {
          const initial = snapshot({ state, autoConnectEnabled: true });
          const harness = createHarness({ initial });
          const store = await loadStore(harness, initial);

          await store.refreshOnWindowActivation();

          assert.equal(harness.calls.sync, 1);
          assert.equal(harness.calls.snapshot, 0);
        },
      );
    }

    for (const state of ['connecting', 'syncing']) {
      await context.test(
        `${state} activation reloads the snapshot without a competing sync`,
        async () => {
          const initial = snapshot({ state, autoConnectEnabled: true });
          const local = snapshot({
            state,
            autoConnectEnabled: true,
            title: 'local refresh',
          });
          const harness = createHarness({ initial, local });
          const store = await loadStore(harness, initial);

          await store.refreshOnWindowActivation();

          assert.equal(harness.calls.sync, 0);
          assert.equal(harness.calls.snapshot, 1);
          assert.equal(store.threads[0]?.title, 'local refresh');
        },
      );
    }

    await context.test(
      'explicit disconnect reloads local state without reconnecting',
      async () => {
        const initial = snapshot({ state: 'disconnected', autoConnectEnabled: false });
        const local = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          title: 'local only',
        });
        const harness = createHarness({ initial, local });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 0);
        assert.equal(harness.calls.snapshot, 1);
        assert.equal(harness.calls.inspection, 0);
        assert.equal(store.threads[0]?.title, 'local only');
      },
    );

    await context.test(
      'explicit disconnect still rechecks installed observation without persistent reconnect',
      async () => {
        const initial = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          bridgeState: 'installed',
          listening: true,
        });
        const local = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          title: 'local refresh',
          bridgeState: 'installed',
          listening: true,
        });
        const inspected = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          title: 'checked',
          bridgeState: 'installed',
          listening: true,
        });
        const harness = createHarness({ initial, local, inspected });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 0);
        assert.equal(harness.calls.snapshot, 1);
        assert.equal(harness.calls.inspection, 1);
        assert.equal(store.snapshot.connection.autoConnectEnabled, false);
        assert.equal(store.threads[0]?.title, 'checked');
      },
    );

    await context.test(
      'returning from Codex rechecks a bridge awaiting trust',
      async () => {
        const initial = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          bridgeState: 'needs_trust',
          reviewReason: 'untrusted',
        });
        const inspected = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          bridgeState: 'installed',
          listening: true,
          title: 'trusted',
        });
        const harness = createHarness({ initial, inspected });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 0);
        assert.equal(harness.calls.snapshot, 1);
        assert.equal(harness.calls.inspection, 1);
        assert.equal(store.snapshot.bridge.state, 'installed');
        assert.equal(store.threads[0]?.title, 'trusted');
      },
    );

    await context.test(
      'a failed Claude runtime refresh cannot block Codex bridge inspection',
      async () => {
        const initial = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          bridgeState: 'installed',
          listening: true,
          claudeProviderEnabled: true,
          claudeBridgeState: 'installed',
        });
        const inspected = snapshot({
          state: 'disconnected',
          autoConnectEnabled: false,
          title: 'Codex inspection survived',
          bridgeState: 'installed',
          listening: true,
          claudeProviderEnabled: true,
          claudeBridgeState: 'installed',
        });
        const harness = createHarness({
          initial,
          inspected,
          claudeInventoryImplementation: async () => {
            throw new Error('Claude runtime is paused');
          },
          claudeInspectionImplementation: async () => {
            throw new Error('Claude bridge is unavailable');
          },
        });
        const store = await loadStore(harness, initial);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.claudeInventory, 1);
        assert.equal(harness.calls.inspection, 1);
        assert.equal(harness.calls.claudeInspection, 1);
        assert.equal(store.threads[0]?.title, 'Codex inspection survived');
      },
    );

    await context.test('an older provider snapshot cannot overwrite a newer Off response', async () => {
      const initial = snapshot({
        state: 'disconnected', autoConnectEnabled: false, claudeProviderEnabled: true,
      });
      const harness = createHarness({ initial });
      const store = await loadStore(harness, initial);
      const disabled = snapshot({
        state: 'disconnected', autoConnectEnabled: false,
        claudeProviderEnabled: false, claudeProviderRevision: 2,
      });
      const staleEnabled = snapshot({
        state: 'disconnected', autoConnectEnabled: false,
        claudeProviderEnabled: true, claudeProviderRevision: 1,
      });
      store.applySnapshot(disabled);
      store.applySnapshot(staleEnabled);
      assert.equal(store.snapshot.claudeProvider.enabled, false);
      assert.equal(store.snapshot.claudeProvider.revision, 2);
    });

    await context.test('Off scrubs only a selected project that disappeared with Claude', async () => {
      const initial = snapshot({
        state: 'disconnected', autoConnectEnabled: false, claudeProviderEnabled: true,
      });
      const baseThread = initial.threads[0];
      initial.threads = [{
        ...baseThread,
        provider: 'claude',
        projectKey: 'claude-only',
        projectRoot: '/tmp/claude-only',
        projectName: 'claude-only',
      }];
      const harness = createHarness({ initial });
      const store = await loadStore(harness, initial);
      store.selectProjectFilter('project:claude-only');
      assert.equal(store.projectFilter.type, 'project');

      const disabled = snapshot({
        state: 'disconnected', autoConnectEnabled: false,
        claudeProviderEnabled: false, claudeProviderRevision: 2,
      });
      store.applySnapshot(disabled);
      assert.deepEqual(store.projectFilter, { type: 'all' });
      assert.equal(store.projectOptions.some(({ projectKey }) => projectKey === 'claude-only'), false);
      assert.equal(JSON.stringify(store.projectOptions).includes('/tmp/claude-only'), false);

      const sharedEnabled = snapshot({
        state: 'disconnected', autoConnectEnabled: false,
        claudeProviderEnabled: true, claudeProviderRevision: 3,
      });
      sharedEnabled.threads = [
        { ...baseThread, provider: 'claude', projectKey: 'shared',
          projectRoot: '/tmp/shared', projectName: 'shared' },
        { ...baseThread, provider: 'codex', projectKey: 'shared',
          projectRoot: '/tmp/shared', projectName: 'shared' },
      ];
      store.applySnapshot(sharedEnabled);
      store.selectProjectFilter('project:shared');
      const sharedDisabled = snapshot({
        state: 'disconnected', autoConnectEnabled: false,
        claudeProviderEnabled: false, claudeProviderRevision: 4,
      });
      sharedDisabled.threads = [sharedEnabled.threads[1]];
      store.applySnapshot(sharedDisabled);
      assert.equal(store.projectFilter.type, 'project');
      assert.equal(store.projectFilter.projectKey, 'shared');
      assert.equal(store.projectOptions.find(({ projectKey }) => projectKey === 'shared')?.count, 1);
    });

    await context.test(
      'activation before the initial snapshot coalesces into a snapshot load',
      async () => {
        const local = snapshot({
          state: 'connected',
          autoConnectEnabled: true,
          title: 'loaded',
        });
        const harness = createHarness({ initial: null, local });
        const store = await loadStore(harness, null);

        await store.refreshOnWindowActivation();

        assert.equal(harness.calls.sync, 0);
        assert.equal(harness.calls.snapshot, 1);
      },
    );

    await context.test('failed activation sync retains the last valid snapshot', async () => {
      const initial = snapshot({ state: 'connected', autoConnectEnabled: true });
      const harness = createHarness({
        initial,
        syncImplementation: async () => {
          throw new Error('activation sync failed');
        },
      });
      const store = await loadStore(harness, initial);

      await assert.rejects(
        store.refreshOnWindowActivation(),
        /activation sync failed/,
      );

      assert.equal(store.threads[0]?.title, 'before');
      assert.equal(store.actionError, 'activation sync failed');
    });

    await context.test('repeated activation cannot overlap an in-flight sync', async () => {
      const initial = snapshot({ state: 'connected', autoConnectEnabled: true });
      let resolveSync;
      const syncResult = new Promise((resolvePromise) => {
        resolveSync = resolvePromise;
      });
      const harness = createHarness({
        initial,
        syncImplementation: async () => await syncResult,
      });
      const store = await loadStore(harness, initial);

      const first = store.refreshOnWindowActivation();
      await Promise.resolve();
      const second = store.refreshOnWindowActivation();

      assert.equal(harness.calls.sync, 1);
      resolveSync(snapshot({
        state: 'connected',
        autoConnectEnabled: true,
        title: 'finished',
      }));
      await Promise.all([first, second]);
      assert.equal(store.threads[0]?.title, 'finished');
    });
  } finally {
    delete globalThis.__eyesOnAgentsActivationHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
