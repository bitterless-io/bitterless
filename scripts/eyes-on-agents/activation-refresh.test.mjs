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
          syncThreads: () => harness().syncThreads()
        };
        export const subscribeEyesOnAgentsChanges = () => undefined;
      `,
      loader: 'js',
    }));
  },
};

const snapshot = ({ state, autoConnectEnabled, title = 'before' }) => ({
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
    state: 'not_installed',
    listening: false,
    listeningSince: null,
    lastEventAt: null,
    error: null,
  },
  lastSyncedAt: null,
});

const createHarness = ({
  initial,
  synced = snapshot({ state: 'connected', autoConnectEnabled: true, title: 'after sync' }),
  local = initial,
  syncImplementation,
}) => {
  const calls = { snapshot: 0, sync: 0 };
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
        assert.equal(store.threads[0]?.title, 'after sync');
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
        assert.equal(store.threads[0]?.title, 'local only');
      },
    );

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
      await store.refreshOnWindowActivation();

      assert.equal(harness.calls.sync, 1);
      resolveSync(snapshot({
        state: 'connected',
        autoConnectEnabled: true,
        title: 'finished',
      }));
      await first;
      assert.equal(store.threads[0]?.title, 'finished');
    });
  } finally {
    delete globalThis.__eyesOnAgentsActivationHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
