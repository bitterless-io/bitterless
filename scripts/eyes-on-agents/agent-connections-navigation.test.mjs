import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from '@vue/compiler-sfc';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-agent-connections-'));
const read = (path) => readFileSync(join(projectRoot, path), 'utf8');
const componentPath =
  'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue';
const stylePath = 'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less';
const componentSource = read(componentPath);
const styleSource = read(stylePath);
const packageSource = read('package.json');

const browserDom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost'
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
  'CustomEvent'
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value:
      key === 'window'
        ? browserWindow
        : key === 'document'
          ? browserWindow.document
          : browserWindow[key]
  });
}
globalThis.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);

const { createApp, defineComponent, h, nextTick } = await import('vue');

const vuePlugin = {
  name: 'eyes-agent-connections-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-agent-connections-navigation',
        inlineTemplate: true
      });
      return {
        contents: compiled.content,
        loader: 'ts',
        resolveDir: dirname(args.path)
      };
    });
  }
};

const stubsPlugin = {
  name: 'eyes-agent-connections-stubs',
  setup(buildApi) {
    buildApi.onResolve({ filter: /@renderer\/common\/i18n\/i18n\.helper$/ }, () => ({
      path: 'i18n',
      namespace: 'eyes-agent-connections-test'
    }));
    buildApi.onResolve({ filter: /eyesOnAgents\.store$/ }, () => ({
      path: 'store',
      namespace: 'eyes-agent-connections-test'
    }));
    buildApi.onResolve({ filter: /ClaudeObservationCard\.vue$/ }, () => ({
      path: 'claude-card',
      namespace: 'eyes-agent-connections-test'
    }));
    // Task 093: the rail gained a third section whose detail pane is its own component, so the
    // navigation harness stubs it the same way — this suite tests the rail, not either card.
    buildApi.onResolve({ filter: /ClaudeIterm2Card\.vue$/ }, () => ({
      path: 'claude-iterm2-card',
      namespace: 'eyes-agent-connections-test'
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'eyes-agent-connections-test' }, (args) => {
      if (args.path === 'i18n') {
        return {
          contents: `export { en as i18nHelper } from ${JSON.stringify(
            join(projectRoot, 'src/renderer/common/i18n/en.ts')
          )};`,
          loader: 'js',
          resolveDir: projectRoot
        };
      }
      if (args.path === 'store') {
        return {
          contents: `
              const current = () => globalThis.__eyesAgentConnectionsHarness.store;
              export const eyesOnAgentsStore = new Proxy({}, {
                get: (_target, key) => current()[key],
                set: (_target, key, value) => {
                  current()[key] = value;
                  return true;
                }
              });
            `,
          loader: 'js'
        };
      }
      if (args.path === 'claude-iterm2-card') {
        return {
          contents: `
              import { h } from 'vue';
              export default {
                name: 'ClaudeIterm2CardStub',
                setup: () => () => h('div', {
                  class: 'claude-iterm2-stub',
                  'data-provider-enabled': String(
                    globalThis.__eyesAgentConnectionsHarness.store.snapshot.claudeProvider.enabled
                  )
                }, 'Claude in iTerm2')
              };
            `,
          loader: 'js'
        };
      }
      return {
        contents: `
            import { h, ref } from 'vue';
            export default {
              name: 'ClaudeObservationCardStub',
              setup: () => {
                const note = ref('Claude local state');
                return () => h('div', {
                  class: 'claude-observation-stub',
                  'data-provider-enabled': String(
                    globalThis.__eyesAgentConnectionsHarness.store.snapshot.claudeProvider.enabled
                  )
                }, [
                  h('label', { for: 'claude-local-state' }, 'Claude observation'),
                  h('input', {
                    id: 'claude-local-state',
                    value: note.value,
                    onInput: (event) => { note.value = event.target.value; }
                  })
                ]);
              }
            };
          `,
        loader: 'js'
      };
    });
  }
};

const createStore = () => {
  const calls = [];
  const actionNames = [
    'connectAppServer',
    'disconnectAppServer',
    'syncThreads',
    'setLastUserPromptCaptureEnabled',
    'installCodexBridge',
    'reviewCodexBridge',
    'refreshCodexBridgeStatus',
    'removeCodexBridge'
  ];
  const store = {
    calls,
    busyAction: null,
    snapshot: {
      connection: {
        state: 'connected',
        autoConnectEnabled: true,
        lastSyncedAt: null,
        error: null
      },
      bridge: {
        state: 'installed',
        listening: true,
        listeningSince: null,
        lastInspectedAt: null,
        lastEventAt: null,
        reviewReason: null,
        error: null
      },
      titleEnrichmentDiagnostic: null,
      lastUserPromptCaptureEnabled: false,
      claudeProvider: { enabled: false, error: null, revision: 1 }
    }
  };
  for (const actionName of actionNames) {
    store[actionName] = async (...args) => {
      calls.push([actionName, ...args]);
    };
  }
  return store;
};

const DrawerStub = defineComponent({
  name: 'ADrawer',
  props: {
    visible: Boolean,
    width: Number
  },
  setup:
    (props, { slots }) =>
    () =>
      props.visible
        ? h(
            'div',
            {
              class: 'eyes-connection-panel',
              'data-drawer-width': String(props.width)
            },
            [
              h('header', { class: 'arco-drawer-header' }, slots.title?.()),
              h('main', { class: 'arco-drawer-body' }, slots.default?.())
            ]
          )
        : null
});

const ButtonStub = defineComponent({
  name: 'AButton',
  inheritAttrs: false,
  props: { disabled: Boolean },
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(
        'button',
        {
          ...attrs,
          type: 'button',
          disabled: props.disabled
        },
        [slots.icon?.(), slots.default?.()]
      )
});

const SwitchStub = defineComponent({
  name: 'ASwitch',
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    disabled: Boolean,
    loading: Boolean,
    size: String
  },
  setup:
    (props, { attrs }) =>
    () =>
      h('input', {
        ...attrs,
        type: 'checkbox',
        checked: props.modelValue,
        disabled: props.disabled
      })
});

const settle = async () => {
  await nextTick();
  await nextTick();
};

const dispatchKey = async (element, key) => {
  const accepted = element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true
    })
  );
  await settle();
  return accepted;
};

try {
  await test('source and styles preserve the master-detail visual contract', () => {
    assert.match(componentSource, /<a-drawer[\s\S]*?:width="540"/);
    assert.match(
      componentSource,
      /popup-container="\.eyes-on-agents__main"/,
      "the drawer stays inside the board region so the menu bar remains visible",
    );
    assert.match(
      styleSource,
      /\.eyes-connection-panel\s*\{[\s\S]*?--eyes-focus-ring: #4e5882;[\s\S]*?max-width: 100%;/,
    );
    assert.match(
      styleSource,
      /\.eyes-connection-panel \.arco-drawer\s*\{[\s\S]*?max-width: 100%;/,
    );
    assert.match(
      componentSource,
      /import codexLogo from '@renderer\/common\/assets\/icons\/providers\/codex\.png';/
    );
    assert.match(
      componentSource,
      /import claudeLogo from '@renderer\/common\/assets\/icons\/providers\/claude\.png';/
    );
    assert.match(componentSource, /role="tablist"[\s\S]*?aria-orientation="vertical"/);
    assert.match(
      componentSource,
      /<button[\s\S]*?role="tab"[\s\S]*?:aria-selected=[\s\S]*?:aria-controls=[\s\S]*?:tabindex=/
    );
    assert.match(componentSource, /case 'ArrowUp':[\s\S]*?case 'ArrowDown':/);
    assert.match(componentSource, /case 'Home':[\s\S]*?case 'End':/);
    assert.match(
      componentSource,
      /v-show="activeProvider === 'codex'"[\s\S]*?role="tabpanel"[\s\S]*?v-show="activeProvider === 'claude'"[\s\S]*?role="tabpanel"[\s\S]*?v-show="activeProvider === 'claude-iterm2'"[\s\S]*?role="tabpanel"/
    );
    assert.match(
      componentSource,
      /name="eyesOnAgents__connections__codexPanel"[\s\S]*?eyesOnAgents__connections__appServer[\s\S]*?eyesOnAgents__connections__boundary[\s\S]*?eyesOnAgents__connections__bridge[\s\S]*?name="eyesOnAgents__connections__claudePanel"[\s\S]*?<ClaudeObservationCard\s*\/>[\s\S]*?name="eyesOnAgents__connections__claudeIterm2Panel"[\s\S]*?<ClaudeIterm2Card\s*\/>/
    );
    // Task 093: the rail is driven by a section union, not the provider union — a Claude CLI
    // environment is an iTerm2 concern and gets its own tab, while the provider union survives
    // only for genuinely provider-shaped facts (the logo).
    assert.match(
      componentSource,
      /type ConnectionSection = 'codex' \| 'claude' \| 'claude-iterm2';/
    );
    assert.match(
      componentSource,
      /const connectionSections = \[\s*'codex',\s*'claude',\s*'claude-iterm2',\s*\] as const satisfies readonly ConnectionSection\[\];/
    );
    assert.match(
      componentSource,
      /const getSectionProvider = \(section: ConnectionSection\): ConnectionProvider =>\s*section === 'codex' \? 'codex' : 'claude';/,
      'both Claude sections must reuse the Claude Spark logo rather than a new asset'
    );
    assert.doesNotMatch(
      componentSource,
      /providers\/claude-iterm2|iterm2\.png/,
      'the tab label carries the distinction; no new image asset is invented'
    );
    assert.match(componentSource, /case 'claude-iterm2': return i18nHelper\.eyesOnAgents\.provider\.claudeIterm2/);
    for (const action of [
      'connectAppServer',
      'disconnectAppServer',
      'syncThreads',
      'setLastUserPromptCaptureEnabled',
      'installCodexBridge',
      'refreshCodexBridgeStatus',
      'removeCodexBridge'
    ]) {
      assert.match(componentSource, new RegExp(`eyesOnAgentsStore\\.${action}\\(`));
    }

    assert.match(
      styleSource,
      /\.eyes-connection-panel__body\s*\{[\s\S]*?grid-template-columns: 60px minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/
    );
    assert.match(
      styleSource,
      /\.eyes-connection-panel__provider-rail\s*\{[\s\S]*?width: 60px;[\s\S]*?overflow: hidden;[\s\S]*?background: #eef1fa;/
    );
    assert.match(
      styleSource,
      /\.eyes-connection-panel__provider-tab\s*\{[\s\S]*?width: 52px;[\s\S]*?height: 56px;[\s\S]*?border: 0;/
    );
    assert.match(styleSource, /provider-tab:hover\s*\{[\s\S]*?background: #f7f8fc;/);
    assert.match(
      styleSource,
      /provider-tab--active[\s\S]*?color: #1e2237;[\s\S]*?background: #fff;/
    );
    assert.match(
      styleSource,
      /provider-tab:focus-visible[\s\S]*?outline: 2px solid var\(--eyes-focus-ring\);/
    );
    assert.match(styleSource, /provider-logo--codex\s*\{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
    assert.match(
      styleSource,
      /provider-logo--claude\s*\{[\s\S]*?width: 23px;[\s\S]*?height: 23px;/
    );
    assert.match(
      styleSource,
      /\.eyes-connection-panel__detail\s*\{[\s\S]*?padding: 14px;[\s\S]*?overflow-y: auto;/
    );
    assert.match(
      styleSource,
      /@media \(max-width: 479px\)[\s\S]*?grid-template-columns: 52px[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?provider-label[\s\S]*?display: none;[\s\S]*?padding: 10px;/
    );
    const railStyles = styleSource.slice(
      styleSource.indexOf('.eyes-connection-panel__provider-rail'),
      styleSource.indexOf('.eyes-connection-panel__detail')
    );
    assert.doesNotMatch(railStyles, /box-shadow/);
    assert.deepEqual(
      [...railStyles.matchAll(/^\s*border:\s*([^;]+);/gm)].map((match) => match[1]),
      ['0'],
      'the rail may only reset the native button border'
    );
    assert.equal(
      (packageSource.match(/agent-connections-navigation\.test\.mjs/g) ?? []).length,
      1,
      'the focused test must be included once in the UI aggregate'
    );
  });

  const outfile = join(buildRoot, 'ConnectionPanel.mjs');
  await build({
    entryPoints: [join(projectRoot, componentPath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue', '@tabler/icons-vue'],
    loader: { '.png': 'dataurl' },
    plugins: [stubsPlugin, vuePlugin]
  });
  const { default: ConnectionPanel } = await import(
    `${pathToFileURL(outfile).href}?v=${Date.now()}`
  );

  await test('real DOM navigation supports click, keyboard, Off state, and state retention', async () => {
    document.body.innerHTML = '<div id="connection-panel-root"></div>';
    const store = createStore();
    globalThis.__eyesAgentConnectionsHarness = { store };
    const host = document.getElementById('connection-panel-root');
    const app = createApp({ render: () => h(ConnectionPanel, { visible: true }) });
    app.component('a-drawer', DrawerStub);
    app.component('a-button', ButtonStub);
    app.component('a-switch', SwitchStub);
    app.mount(host);
    await settle();

    try {
      const drawer = host.querySelector('.eyes-connection-panel');
      const tablist = host.querySelector('[role="tablist"]');
      const tabs = [...host.querySelectorAll('button[role="tab"]')];
      // Task 093: two of the three tabs are Claude tabs, so they are resolved by id rather than by
      // a substring of their label.
      const codexTab = host.querySelector('#eyes-connection-provider-tab-codex');
      const claudeTab = host.querySelector('#eyes-connection-provider-tab-claude');
      const iterm2Tab = host.querySelector('#eyes-connection-provider-tab-claude-iterm2');
      const codexPanel = host.querySelector('#eyes-connection-provider-panel-codex');
      const claudePanel = host.querySelector('#eyes-connection-provider-panel-claude');
      const iterm2Panel = host.querySelector('#eyes-connection-provider-panel-claude-iterm2');

      assert.equal(drawer?.getAttribute('data-drawer-width'), '540');
      assert.equal(tablist?.getAttribute('aria-label'), 'Agent apps');
      assert.equal(tablist?.getAttribute('aria-orientation'), 'vertical');
      assert.equal(tabs.length, 3, 'the rail shows exactly three sections');
      assert.ok(codexTab && claudeTab && iterm2Tab);
      assert.ok(codexPanel && claudePanel && iterm2Panel);
      assert.equal(codexTab.textContent?.trim(), 'Codex');
      assert.equal(claudeTab.textContent?.trim(), 'Claude');
      assert.equal(iterm2Tab.textContent?.trim(), 'iTerm2');
      assert.equal(codexTab.getAttribute('aria-selected'), 'true');
      assert.equal(codexTab.getAttribute('tabindex'), '0');
      assert.equal(claudeTab.getAttribute('aria-selected'), 'false');
      assert.equal(claudeTab.getAttribute('tabindex'), '-1');
      assert.equal(iterm2Tab.getAttribute('aria-selected'), 'false');
      assert.equal(iterm2Tab.getAttribute('tabindex'), '-1');
      assert.equal(codexTab.getAttribute('aria-controls'), codexPanel.id);
      assert.equal(claudeTab.getAttribute('aria-controls'), claudePanel.id);
      assert.equal(iterm2Tab.getAttribute('aria-controls'), iterm2Panel.id);
      assert.equal(codexPanel.getAttribute('aria-labelledby'), codexTab.id);
      assert.equal(claudePanel.getAttribute('aria-labelledby'), claudeTab.id);
      assert.equal(iterm2Panel.getAttribute('aria-labelledby'), iterm2Tab.id);
      assert.equal(codexPanel.style.display, '');
      assert.equal(claudePanel.style.display, 'none');
      assert.equal(iterm2Panel.style.display, 'none');
      assert.ok(codexPanel.querySelector('[name="eyesOnAgents__connections__appServer"]'));
      assert.ok(codexPanel.querySelector('[name="eyesOnAgents__connections__boundary"]'));
      assert.ok(codexPanel.querySelector('[name="eyesOnAgents__connections__bridge"]'));
      assert.ok(claudePanel.querySelector('.claude-observation-stub'));
      assert.ok(iterm2Panel.querySelector('.claude-iterm2-stub'));
      assert.equal(claudePanel.querySelector('.claude-iterm2-stub'), null,
        'the environment list must render only under Claude in iTerm2');

      iterm2Tab.click();
      await settle();
      assert.equal(iterm2Tab.getAttribute('aria-selected'), 'true');
      assert.equal(iterm2Tab.getAttribute('tabindex'), '0');
      assert.equal(iterm2Panel.style.display, '');
      assert.equal(claudePanel.style.display, 'none');
      assert.equal(
        iterm2Panel.querySelector('.claude-iterm2-stub')?.getAttribute('data-provider-enabled'),
        'false',
        'the iTerm2 section stays selectable while Claude support is Off'
      );

      claudeTab.click();
      await settle();
      assert.equal(claudeTab.getAttribute('aria-selected'), 'true');
      assert.equal(claudeTab.getAttribute('tabindex'), '0');
      assert.equal(codexTab.getAttribute('tabindex'), '-1');
      assert.equal(codexPanel.style.display, 'none');
      assert.equal(claudePanel.style.display, '');
      assert.equal(
        claudePanel
          .querySelector('.claude-observation-stub')
          ?.getAttribute('data-provider-enabled'),
        'false',
        'Claude remains selectable while provider support is Off'
      );

      const stateInput = claudePanel.querySelector('#claude-local-state');
      assert.ok(stateInput);
      stateInput.value = 'Retained troubleshooting draft';
      stateInput.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
      codexTab.click();
      await settle();
      assert.equal(claudePanel.style.display, 'none');
      assert.equal(claudePanel.querySelector('#claude-local-state'), stateInput);
      claudeTab.click();
      await settle();
      assert.equal(claudePanel.querySelector('#claude-local-state'), stateInput);
      assert.equal(stateInput.value, 'Retained troubleshooting draft');

      // Task 093: keyboard navigation now wraps over THREE tabs, so a move from the middle tab and
      // a wrap from an end tab are different assertions.
      claudeTab.focus();
      assert.equal(await dispatchKey(claudeTab, 'ArrowDown'), false);
      assert.equal(iterm2Tab.getAttribute('aria-selected'), 'true');
      assert.equal(document.activeElement, iterm2Tab, 'ArrowDown moves Claude → Claude in iTerm2');
      assert.equal(await dispatchKey(iterm2Tab, 'ArrowDown'), false);
      assert.equal(codexTab.getAttribute('aria-selected'), 'true');
      assert.equal(document.activeElement, codexTab, 'ArrowDown wraps from the last tab to Codex');
      assert.equal(await dispatchKey(codexTab, 'ArrowUp'), false);
      assert.equal(document.activeElement, iterm2Tab, 'ArrowUp wraps from Codex to the last tab');
      assert.equal(await dispatchKey(iterm2Tab, 'ArrowUp'), false);
      assert.equal(document.activeElement, claudeTab, 'ArrowUp moves Claude in iTerm2 → Claude');
      await dispatchKey(claudeTab, 'Home');
      assert.equal(document.activeElement, codexTab, 'Home selects and focuses the first tab');
      await dispatchKey(codexTab, 'End');
      assert.equal(document.activeElement, iterm2Tab, 'End selects and focuses the last of three');
      assert.equal(codexTab.getAttribute('tabindex'), '-1');
      assert.equal(claudeTab.getAttribute('tabindex'), '-1');
      assert.equal(iterm2Tab.getAttribute('tabindex'), '0',
        'the roving tabindex keeps exactly one tab reachable across three sections');
      assert.deepEqual(store.calls, [], 'provider navigation must never invoke connection APIs');
    } finally {
      app.unmount();
      document.body.innerHTML = '';
    }
  });
} finally {
  delete globalThis.__eyesAgentConnectionsHarness;
  rmSync(buildRoot, { recursive: true, force: true });
  browserWindow.close();
}
