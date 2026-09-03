import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { JSDOM } from 'jsdom';

// Task 088: covers the EyesOnAgents Claude multi-environment renderer surface — one row per
// configured environment, add/rename/remove/enable calling the correct store methods with the
// correct payload, and remove staying disabled for the last remaining environment. Mirrors
// thread-card-open-capability.test.mjs's real-DOM mount/click harness (not source-pattern
// matching) so these are genuine behavioral assertions.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-claude-environment-render-'));
const browserDom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost',
});
const browserWindow = browserDom.window;
for (const key of [
  'window',
  'document',
  'navigator',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Node',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? browserWindow
      : key === 'document' ? browserWindow.document
        : browserWindow[key],
  });
}
globalThis.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);
Object.defineProperties(browserWindow.document.documentElement, {
  clientWidth: { configurable: true, value: 1024 },
  clientHeight: { configurable: true, value: 768 },
});
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ObserverStub;
globalThis.IntersectionObserver = ObserverStub;
browserWindow.ResizeObserver = ObserverStub;
browserWindow.IntersectionObserver = ObserverStub;
browserWindow.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const { createApp, nextTick } = await import('vue');
const ArcoModule = await import('@arco-design/web-vue');
const ArcoVue = ArcoModule.default?.default ?? ArcoModule.default ?? ArcoModule;
const read = (path) => readFileSync(join(projectRoot, path), 'utf8');

const vuePlugin = {
  name: 'eyes-on-agents-claude-environment-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-claude-environment',
        inlineTemplate: true,
      });
      return {
        contents: compiled.content,
        loader: 'ts',
        resolveDir: dirname(args.path),
      };
    });
  },
};

const stubsPlugin = {
  name: 'eyes-on-agents-claude-environment-stubs',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /@renderer\/common\/i18n\/i18n\.helper$/ },
      () => ({ path: 'i18n', namespace: 'eyes-claude-environment-test' }),
    );
    buildApi.onResolve(
      { filter: /eyesOnAgents\.store$/ },
      () => ({ path: 'store', namespace: 'eyes-claude-environment-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-claude-environment-test' },
      (args) => args.path === 'i18n'
        ? {
            contents: `export { en as i18nHelper } from ${JSON.stringify(join(
              projectRoot,
              'src/renderer/common/i18n/en.ts',
            ))};`,
            loader: 'js',
            resolveDir: projectRoot,
          }
        : ({
          contents: `
          const current = () => globalThis.__eyesOnAgentsClaudeEnvironmentHarness.store;
          // Mirrors eyesOnAgents.store.ts's exported Add-environment busy key, which
          // ClaudeObservationCard.vue imports instead of declaring its own literal.
          export const ADD_CLAUDE_ENVIRONMENT_KEY = '__add__';
          export const eyesOnAgentsStore = new Proxy({}, {
            get: (_target, key) => current()[key],
            set: (_target, key, value) => {
              current()[key] = value;
              return true;
            }
          });
        `,
          loader: 'js',
        }),
    );
  },
};

const createEnvironment = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Default',
  enabled: true,
  mode: 'automatic',
  configuredDirectory: null,
  effectiveDirectory: '/Users/ral/.claude',
  projectsDirectory: '/Users/ral/.claude/projects',
  desktopDirectoryCount: 1,
  state: 'watching',
  watching: true,
  lastScanAt: null,
  lastSuccessfulScanAt: null,
  nextRetryAt: null,
  error: null,
  ...overrides,
});

// ClaudeObservationService.getDirectoryStatus() stamps canRemove on every row when it assembles the
// status array (mirroring ClaudeDirectoryConfigService.removeEnvironment's last-remaining guard, and
// never removable for the identity-less synthetic sentinel row), so the harness reproduces that here
// instead of making every fixture repeat it. An explicit canRemove on a fixture still wins.
const withRemovability = (environments) => environments.map((environment) => ({
  canRemove: environments.length > 1 && environment.id !== '',
  ...environment,
}));

const createStore = (environments, { providerError = null, ...overrides } = {}) => {
  const calls = {
    add: [], rename: [], remove: [], setEnabled: [], chooseDirectory: [], useAutomatic: [],
    changeDirectory: 0, useAutomaticDirectory: 0, retry: [], retryDirectory: 0, copySetup: [],
  };
  return {
    calls,
    snapshot: {
      claudeBridge: {
        state: 'observing', setupAction: 'none', configured: true, enabled: true,
        listening: true, listeningSince: null, firstReceiptAt: null, lastReceiptAt: null,
        lastInspectedAt: null, observationProof: 'receipt', restartRequired: false, error: null,
      },
      claudeProvider: { enabled: true, error: providerError, revision: 1 },
      claudeDirectory: withRemovability(environments),
      claudeLastUserPromptCaptureEnabled: false,
    },
    busyAction: null,
    busyClaudeEnvironmentIds: new Set(),
    installClaudeBridge: async () => undefined,
    refreshClaudeBridgeStatus: async () => undefined,
    removeClaudeBridge: async () => undefined,
    installClaudeBridgeForEnvironment: async () => undefined,
    refreshClaudeBridgeStatusForEnvironment: async () => undefined,
    openNewClaudeSession: async () => undefined,
    copyClaudeReloadCommand: async () => undefined,
    changeClaudeDirectory: async () => { calls.changeDirectory += 1; },
    useAutomaticClaudeDirectory: async () => { calls.useAutomaticDirectory += 1; },
    retryClaudeDirectory: async () => { calls.retryDirectory += 1; },
    retryClaudeDirectoryForEnvironment: async (id) => { calls.retry.push(id); },
    setClaudeProviderEnabled: async () => undefined,
    setClaudeLastUserPromptCaptureEnabled: async () => undefined,
    addClaudeEnvironment: async (label) => { calls.add.push(label); },
    renameClaudeEnvironment: async (id, label) => { calls.rename.push([id, label]); },
    removeClaudeEnvironment: async (id) => { calls.remove.push(id); },
    setClaudeEnvironmentEnabled: async (id, enabled) => { calls.setEnabled.push([id, enabled]); },
    chooseClaudeEnvironmentDirectory: async (id) => { calls.chooseDirectory.push(id); },
    useAutomaticClaudeEnvironment: async (id) => { calls.useAutomatic.push(id); },
    copyClaudeEnvironmentSetupCommand: async (id) => { calls.copySetup.push(id); },
    ...overrides,
  };
};

try {
  const outfile = join(buildRoot, 'ClaudeObservationCard.mjs');
  await build({
    entryPoints: [join(
      projectRoot,
      'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue',
    )],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue', '@tabler/icons-vue'],
    plugins: [stubsPlugin, vuePlugin],
  });

  const { default: ClaudeObservationCard } = await import(
    `${pathToFileURL(outfile).href}?v=${Date.now()}`
  );

  const mountCard = async (environments, storeOverrides = {}) => {
    document.body.innerHTML = '<div id="claude-observation-root"></div>';
    const store = createStore(environments, storeOverrides);
    globalThis.__eyesOnAgentsClaudeEnvironmentHarness = { store };
    const host = document.getElementById('claude-observation-root');
    const { h } = await import('vue');
    const app = createApp({ render: () => h(ClaudeObservationCard) });
    app.use(ArcoVue);
    app.mount(host);
    await nextTick();
    return { app, host, store };
  };

  const rows = (host) => [...host.querySelectorAll(
    '[name="eyesOnAgents__connections__claudeEnvironmentRow"]',
  )];
  const rowButton = (row, pattern) => [...row.querySelectorAll('button')]
    .find((element) => pattern.test(element.textContent?.replace(/\s+/gu, ' ').trim() ?? ''));

  await test('one row renders per configured environment with its own label/path/state', async () => {
    const environments = [
      createEnvironment({
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Default',
        mode: 'automatic',
      }),
      createEnvironment({
        id: '22222222-2222-4222-8222-222222222222',
        label: 'claude2',
        mode: 'custom',
        configuredDirectory: '/Users/ral/.claude2',
        effectiveDirectory: '/Users/ral/.claude2',
        state: 'retrying',
        watching: false,
        nextRetryAt: '2026-09-03T00:00:10.000Z',
      }),
    ];
    const mounted = await mountCard(environments);
    try {
      const environmentRows = rows(mounted.host);
      assert.equal(environmentRows.length, 2, 'one row per configured environment');
      assert.match(environmentRows[0].textContent ?? '', /Default/);
      assert.match(environmentRows[0].textContent ?? '', /Automatic/);
      assert.match(environmentRows[0].textContent ?? '', /Watching/);
      assert.match(environmentRows[1].textContent ?? '', /claude2/);
      assert.match(environmentRows[1].textContent ?? '', /Custom/);
      assert.match(environmentRows[1].textContent ?? '', /Retrying/);
      const path = environmentRows[1].querySelector('input[readonly]');
      assert.ok(path);
      assert.equal(path.value, '/Users/ral/.claude2');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('a not-yet-configured custom environment shows "Not configured"', async () => {
    const environments = [
      createEnvironment({ mode: 'custom', configuredDirectory: null, effectiveDirectory: null }),
    ];
    const mounted = await mountCard(environments);
    try {
      const environmentRows = rows(mounted.host);
      const path = environmentRows[0].querySelector('input[readonly]');
      assert.equal(path.value, 'Not configured');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Add environment submits the trimmed label to addClaudeEnvironment', async () => {
    const mounted = await mountCard([createEnvironment()]);
    try {
      const addToggle = [...mounted.host.querySelectorAll('button')]
        .find((element) => element.textContent?.trim() === 'Add environment');
      assert.ok(addToggle);
      addToggle.click();
      await nextTick();
      const input = mounted.host.querySelector(
        'input[placeholder="Label (e.g. claude2)"]',
      );
      assert.ok(input, 'the add form input appears');
      input.value = '  claude3  ';
      input.dispatchEvent(new browserWindow.Event('input'));
      await nextTick();
      const addButton = [...mounted.host.querySelectorAll('button')]
        .find((element) => element.textContent?.trim() === 'Add');
      assert.ok(addButton);
      addButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.add, ['claude3'],
        'the label is trimmed before being sent to the store');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Rename submits the row id and new label to renameClaudeEnvironment', async () => {
    const environment = createEnvironment({ label: 'Default' });
    const mounted = await mountCard([environment]);
    try {
      const row = rows(mounted.host)[0];
      const renameButton = rowButton(row, /^Rename$/);
      assert.ok(renameButton);
      renameButton.click();
      await nextTick();
      const input = row.querySelector('.eyes-connection-card__directories-header input');
      assert.ok(input, 'renaming shows an inline label input');
      input.value = 'claude2';
      input.dispatchEvent(new browserWindow.Event('input'));
      await nextTick();
      const saveButton = rowButton(row, /^Save$/);
      assert.ok(saveButton);
      saveButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.rename, [[environment.id, 'claude2']]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('the enable switch calls setClaudeEnvironmentEnabled with the row id and next value', async () => {
    const environment = createEnvironment({ enabled: true });
    const mounted = await mountCard([environment, createEnvironment({
      id: '22222222-2222-4222-8222-222222222222',
      label: 'claude2',
      mode: 'custom',
      configuredDirectory: '/Users/ral/.claude2',
    })]);
    try {
      const row = rows(mounted.host)[0];
      const toggle = row.querySelector('.arco-switch');
      assert.ok(toggle);
      toggle.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.setEnabled, [[environment.id, false]]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Remove is disabled for the last remaining environment', async () => {
    const mounted = await mountCard([createEnvironment()]);
    try {
      const row = rows(mounted.host)[0];
      const removeButton = rowButton(row, /^Remove$/);
      assert.ok(removeButton);
      assert.equal(removeButton.disabled, true);
      removeButton.click();
      await nextTick();
      assert.deepEqual(mounted.store.calls.remove, [],
        'a disabled Remove control must never call the store');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Remove calls removeClaudeEnvironment with the row id when more than one environment exists', async () => {
    const first = createEnvironment({ label: 'Default' });
    const second = createEnvironment({
      id: '22222222-2222-4222-8222-222222222222',
      label: 'claude2',
      mode: 'custom',
      configuredDirectory: '/Users/ral/.claude2',
    });
    const mounted = await mountCard([first, second]);
    try {
      const row = rows(mounted.host)[1];
      const removeButton = rowButton(row, /^Remove$/);
      assert.ok(removeButton);
      assert.equal(removeButton.disabled, false);
      removeButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.remove, [second.id]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Change directory and Use automatic are scoped to the clicked row id', async () => {
    const first = createEnvironment({ label: 'Default', mode: 'custom', configuredDirectory: '/a' });
    const second = createEnvironment({
      id: '22222222-2222-4222-8222-222222222222',
      label: 'claude2',
      mode: 'custom',
      configuredDirectory: '/b',
    });
    const mounted = await mountCard([first, second]);
    try {
      const secondRow = rows(mounted.host)[1];
      const changeButton = rowButton(secondRow, /^Change directory$/);
      assert.ok(changeButton);
      changeButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.chooseDirectory, [second.id]);
      // A non-default custom environment is never eligible for automatic mode.
      assert.equal(rowButton(secondRow, /^Use automatic$/), undefined);

      const firstRow = rows(mounted.host)[0];
      const useAutomaticButton = rowButton(firstRow, /^Use automatic$/);
      assert.ok(useAutomaticButton, 'the default row is eligible for automatic mode');
      useAutomaticButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.useAutomatic, [first.id]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('the synthetic invalid-hydration row (empty id) recovers via the legacy zero-arg methods', async () => {
    const sentinel = createEnvironment({
      id: '',
      label: '',
      mode: 'automatic',
      state: 'error',
      error: 'Saved Claude directory configuration is invalid',
    });
    const mounted = await mountCard([sentinel]);
    try {
      const row = rows(mounted.host)[0];
      assert.equal(row.querySelector('.arco-switch'), null,
        'the sentinel row has no valid id to scope an enable toggle to');
      assert.equal(rowButton(row, /^Rename$/), undefined);
      assert.equal(rowButton(row, /^Remove$/), undefined);

      const changeButton = rowButton(row, /^Change directory$/);
      assert.ok(changeButton);
      changeButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.equal(mounted.store.calls.changeDirectory, 1);
      assert.deepEqual(mounted.store.calls.chooseDirectory, [],
        'an empty id must never reach the { id }-scoped XPC method');

      const useAutomaticButton = rowButton(row, /^Use automatic$/);
      assert.ok(useAutomaticButton, 'an error-state default row still offers recovery');
      useAutomaticButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.equal(mounted.store.calls.useAutomaticDirectory, 1);
      assert.deepEqual(mounted.store.calls.useAutomatic, []);

      const retryButton = rowButton(row, /^Retry$/);
      assert.ok(retryButton, 'an error-state sentinel row still offers Retry');
      retryButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.equal(mounted.store.calls.retryDirectory, 1);
      assert.deepEqual(mounted.store.calls.retry, [],
        'an empty id must never reach the { environmentId }-scoped retry method');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  // Gap 1 (post-088 review): restores the pre-088 single block's desktop-directory-count/
  // last-successful-scan/next-retry metadata and manual Retry action, scoped per environment.
  await test('desktop directory count and last scan render per row, with a next-retry note when scheduled', async () => {
    const environment = createEnvironment({
      desktopDirectoryCount: 3,
      lastSuccessfulScanAt: '2026-09-03T00:00:00.000Z',
      nextRetryAt: '2026-09-03T00:00:10.000Z',
    });
    const mounted = await mountCard([environment]);
    try {
      const row = rows(mounted.host)[0];
      assert.match(row.textContent ?? '', /Desktop metadata directories: 3/);
      assert.match(row.textContent ?? '', /Last successful scan: /);
      assert.match(row.textContent ?? '', /Next retry: /);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('Retry is offered only in a recoverable state, and retries the clicked row', async () => {
    const healthy = createEnvironment({ label: 'Default', state: 'watching' });
    const recovering = createEnvironment({
      id: '22222222-2222-4222-8222-222222222222',
      label: 'claude2',
      mode: 'custom',
      configuredDirectory: '/Users/ral/.claude2',
      state: 'retrying',
    });
    const mounted = await mountCard([healthy, recovering]);
    try {
      const healthyRow = rows(mounted.host)[0];
      assert.equal(rowButton(healthyRow, /^Retry$/), undefined,
        'a healthy watching environment does not offer Retry');
      const recoveringRow = rows(mounted.host)[1];
      const retryButton = rowButton(recoveringRow, /^Retry$/);
      assert.ok(retryButton, 'a retrying environment offers Retry');
      retryButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.retry, [recovering.id]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('a global Claude provider error offers Retry even on an otherwise-healthy row', async () => {
    const environment = createEnvironment({ state: 'watching' });
    const mounted = await mountCard([environment], { providerError: 'Claude support changed' });
    try {
      const row = rows(mounted.host)[0];
      assert.ok(rowButton(row, /^Retry$/),
        'a global provider error still offers Retry on an otherwise-watching row');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  // Task 089: Copy setup command renders only for a row with a real id, mode 'custom', and a
  // non-null configuredDirectory — the automatic environment needs no wrapper by definition.
  await test('Copy setup command renders only for a configured custom environment', async () => {
    const environments = [
      createEnvironment({ label: 'Default', mode: 'automatic', configuredDirectory: null }),
      createEnvironment({
        id: '22222222-2222-4222-8222-222222222222',
        label: 'claude2',
        mode: 'custom',
        configuredDirectory: '/Users/ral/.claude2',
        effectiveDirectory: '/Users/ral/.claude2',
      }),
      createEnvironment({
        id: '33333333-3333-4333-8333-333333333333',
        label: 'claude3',
        mode: 'custom',
        configuredDirectory: null,
        effectiveDirectory: null,
      }),
    ];
    const mounted = await mountCard(environments);
    try {
      const [automaticRow, configuredRow, unconfiguredRow] = rows(mounted.host);
      assert.equal(rowButton(automaticRow, /^Copy setup command$/), undefined,
        'the automatic environment offers no wrapper to copy');
      assert.equal(rowButton(unconfiguredRow, /^Copy setup command$/), undefined,
        'a custom environment without a chosen directory offers no wrapper');
      const copyButton = rowButton(configuredRow, /^Copy setup command$/);
      assert.ok(copyButton, 'a configured custom environment offers Copy setup command');
      copyButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      assert.deepEqual(mounted.store.calls.copySetup, ['22222222-2222-4222-8222-222222222222'],
        'the copy is scoped to the clicked row id');
      assert.match(configuredRow.textContent ?? '', /Copied/,
        'the row confirms the copy in place, mirroring the reload-command pattern');
      assert.ok(copyButton.querySelector('[aria-live="polite"]'),
        'the confirmation swap is announced politely');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('the synthetic invalid-hydration row never offers Copy setup command', async () => {
    const sentinel = createEnvironment({
      id: '',
      label: '',
      mode: 'custom',
      configuredDirectory: '/Users/ral/.claude-broken',
      state: 'error',
      error: 'Saved Claude directory configuration is invalid',
    });
    const mounted = await mountCard([sentinel]);
    try {
      const row = rows(mounted.host)[0];
      assert.equal(rowButton(row, /^Copy setup command$/), undefined,
        'an empty id has no environment identity to scope a copy to');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('a failed copy leaves the row label unconfirmed', async () => {
    const environment = createEnvironment({
      label: 'claude2',
      mode: 'custom',
      configuredDirectory: '/Users/ral/.claude2',
    });
    const mounted = await mountCard([environment], {
      copyClaudeEnvironmentSetupCommand: async () => {
        throw new Error('Claude environment "claude2" has no configured directory to wrap');
      },
    });
    try {
      const row = rows(mounted.host)[0];
      const copyButton = rowButton(row, /^Copy setup command$/);
      assert.ok(copyButton);
      copyButton.click();
      await nextTick();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      await nextTick();
      assert.doesNotMatch(row.textContent ?? '', /Copied/,
        'a rejected copy must not claim success');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  console.log('EyesOnAgents Claude environment renderer tests passed');
} finally {
  delete globalThis.__eyesOnAgentsClaudeEnvironmentHarness;
  rmSync(buildRoot, { recursive: true, force: true });
  browserWindow.close();
}
