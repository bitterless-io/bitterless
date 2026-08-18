import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createSSRApp, h, nextTick, reactive } from 'vue';
import { renderToString } from '@vue/server-renderer';
import ArcoModule from '@arco-design/web-vue';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-claude-setup-render-'));
const ArcoVue = ArcoModule.default ?? ArcoModule;

const vuePlugin = {
  name: 'eyes-on-agents-claude-setup-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-claude-setup',
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

const vueScriptPlugin = {
  name: 'eyes-on-agents-claude-setup-vue-script',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-claude-setup-script',
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
  name: 'eyes-on-agents-claude-setup-stubs',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /@renderer\/common\/i18n\/i18n\.helper$/ },
      () => ({ path: 'i18n', namespace: 'eyes-claude-setup-test' }),
    );
    buildApi.onResolve(
      { filter: /eyesOnAgents\.store$/ },
      () => ({ path: 'store', namespace: 'eyes-claude-setup-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-claude-setup-test' },
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
          const current = () => globalThis.__eyesOnAgentsClaudeSetupHarness.store;
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

const createBridge = (setupAction) => ({
  state: setupAction === 'none'
    ? 'observing'
    : setupAction === 'enable' ? 'not_installed' : 'needs_review',
  setupAction,
  configured: setupAction !== 'enable',
  enabled: setupAction !== 'enable',
  listening: setupAction === 'none' || setupAction === 'reload',
  listeningSince: null,
  firstReceiptAt: setupAction === 'none' ? '2026-08-18T01:00:00.000Z' : null,
  lastReceiptAt: setupAction === 'none' ? '2026-08-18T01:00:00.000Z' : null,
  lastInspectedAt: null,
  observationProof: setupAction === 'none' ? 'receipt' : 'none',
  restartRequired: setupAction === 'reload',
  error: setupAction === 'repair' ? 'Repair required' : null,
});

const createStore = (setupAction) => ({
  snapshot: {
    claudeBridge: createBridge(setupAction),
    claudeProvider: { enabled: true, error: null, revision: 1 },
    claudeDirectory: {
      mode: 'automatic',
      configuredDirectory: null,
      effectiveDirectory: '/tmp/claude',
      projectsDirectory: '/tmp/claude/projects',
      desktopDirectoryCount: 1,
      state: 'watching',
      watching: true,
      lastScanAt: null,
      lastSuccessfulScanAt: null,
      nextRetryAt: null,
      error: null,
    },
  },
  busyAction: null,
  installClaudeBridge: async () => undefined,
  refreshClaudeBridgeStatus: async () => undefined,
  removeClaudeBridge: async () => undefined,
  openNewClaudeSession: async () => undefined,
  copyClaudeReloadCommand: async () => undefined,
  changeClaudeDirectory: async () => undefined,
  useAutomaticClaudeDirectory: async () => undefined,
  retryClaudeDirectory: async () => undefined,
  setClaudeProviderEnabled: async () => undefined,
});

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
    external: ['vue'],
    plugins: [stubsPlugin, vuePlugin],
  });

  const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  const render = async (setupAction) => {
    globalThis.__eyesOnAgentsClaudeSetupHarness = {
      store: createStore(setupAction),
    };
    const app = createSSRApp({ render: () => h(module.default) });
    app.use(ArcoVue);
    return new JSDOM(await renderToString(app)).window.document;
  };

  for (const [action, label] of [
    ['enable', 'Enable Claude observation'],
    ['finish', 'Finish setup'],
    ['repair', 'Repair'],
  ]) {
    const document = await render(action);
    const setup = document.querySelector(
      '[name="eyesOnAgents__connections__claudeSetupAction"]',
    );
    assert.ok(setup, `${action} must render its compact setup action`);
    assert.equal(setup.querySelectorAll('.arco-btn-primary').length, 1);
    assert.match(setup.textContent ?? '', new RegExp(label));
    assert.equal(
      setup.querySelector('[name="eyesOnAgents__connections__claudeHookGuide"]'),
      null,
    );
  }

  const reloadDocument = await render('reload');
  const reloadSetup = reloadDocument.querySelector(
    '[name="eyesOnAgents__connections__claudeSetupAction"]',
  );
  assert.ok(reloadSetup);
  assert.equal(reloadSetup.querySelectorAll('.eyes-connection-card__setup-actions button').length, 2);
  assert.equal(reloadSetup.querySelectorAll('.arco-btn-primary').length, 1);
  assert.match(reloadSetup.textContent ?? '', /Open new Claude session/);
  assert.match(reloadSetup.textContent ?? '', /Copy \/reload-plugins/);
  assert.match(reloadSetup.textContent ?? '', /Still not working\?/);
  assert.doesNotMatch(reloadSetup.textContent ?? '', /\/hooks/,
    'the diagnostic command must remain collapsed by default');
  assert.match(reloadSetup.textContent ?? '', /updates automatically after the first event/);
  const copyFeedback = reloadSetup.querySelector('[aria-live="polite"]');
  assert.ok(copyFeedback, 'the copy result must expose a polite live region');
  assert.equal(copyFeedback.textContent?.trim(), 'Copy /reload-plugins');

  const retryDocument = await render('retry');
  const retrySetup = retryDocument.querySelector(
    '[name="eyesOnAgents__connections__claudeSetupAction"]',
  );
  assert.ok(retrySetup, 'a paused listener must render one compact recovery action');
  assert.equal(retrySetup.querySelectorAll('.arco-btn-primary').length, 1);
  assert.match(retrySetup.textContent ?? '', /Listener paused/);
  assert.match(retrySetup.textContent ?? '', /Retry listener/);
  assert.doesNotMatch(retryDocument.body.textContent ?? '', /Check status/,
    'the paused listener must not duplicate its retry action with Check status');
  assert.match(retryDocument.body.textContent ?? '', /Remove plugin/);

  const observingDocument = await render('none');
  assert.equal(
    observingDocument.querySelector('[name="eyesOnAgents__connections__claudeSetupAction"]'),
    null,
    'observing must not retain a setup surface',
  );
  assert.match(observingDocument.body.textContent ?? '', /Check status/);
  assert.match(observingDocument.body.textContent ?? '', /Remove plugin/);

  const scriptOutfile = join(buildRoot, 'ClaudeObservationCard.script.mjs');
  await build({
    entryPoints: [join(
      projectRoot,
      'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue',
    )],
    outfile: scriptOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue'],
    plugins: [stubsPlugin, vueScriptPlugin],
  });
  const scriptModule = await import(`${pathToFileURL(scriptOutfile).href}?v=${Date.now()}`);
  const setupStore = reactive(createStore('reload'));
  globalThis.__eyesOnAgentsClaudeSetupHarness = { store: setupStore };
  const bindings = scriptModule.default.setup({}, { expose: () => undefined });
  assert.equal(bindings.reloadCommandCopyLabel.value, 'Copy /reload-plugins');
  await bindings.handleCopyReloadCommand();
  assert.equal(bindings.reloadCommandCopyLabel.value, 'Copied');

  setupStore.snapshot.claudeBridge.setupAction = 'none';
  await nextTick();
  assert.equal(bindings.reloadCommandCopyLabel.value, 'Copy /reload-plugins',
    'leaving reload must reset the copied acknowledgement');

  setupStore.snapshot.claudeBridge.setupAction = 'reload';
  setupStore.copyClaudeReloadCommand = async () => {
    throw new Error('clipboard unavailable');
  };
  await nextTick();
  await bindings.handleCopyReloadCommand();
  assert.equal(bindings.reloadCommandCopyLabel.value, 'Copy /reload-plugins',
    'copy failure must preserve the actionable label');

  console.log('EyesOnAgents Claude setup rendered-DOM test passed');
} finally {
  delete globalThis.__eyesOnAgentsClaudeSetupHarness;
  rmSync(buildRoot, { recursive: true, force: true });
}
