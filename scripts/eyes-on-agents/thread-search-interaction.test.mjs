import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from '@vue/compiler-sfc';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-thread-search-interaction-'));
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
    value: key === 'window'
      ? browserWindow
      : key === 'document' ? browserWindow.document : browserWindow[key],
  });
}
globalThis.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ObserverStub;
browserWindow.ResizeObserver = ObserverStub;
browserWindow.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const { createApp, defineComponent, h, nextTick, reactive } = await import('vue');
const ArcoModule = await import('@arco-design/web-vue');

const vuePlugin = {
  name: 'eyes-on-agents-thread-search-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-thread-search-interaction',
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
  name: 'eyes-on-agents-thread-search-stubs',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /@renderer\/common\/i18n\/i18n\.helper$/ },
      () => ({ path: 'i18n', namespace: 'eyes-thread-search-test' }),
    );
    buildApi.onResolve(
      { filter: /@renderer\/common\/utils\/userAgentHelper\/ua\.helper$/ },
      () => ({ path: 'ua', namespace: 'eyes-thread-search-test' }),
    );
    buildApi.onResolve(
      { filter: /eyesOnAgents\.store$/ },
      () => ({ path: 'store', namespace: 'eyes-thread-search-test' }),
    );
    buildApi.onResolve(
      { filter: /ThreadCard\/ThreadCard\.vue$/ },
      () => ({ path: 'thread-card', namespace: 'eyes-thread-search-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-thread-search-test' },
      (args) => {
        if (args.path === 'i18n') {
          return {
            contents: `
              export const i18nHelper = {
                eyesOnAgents: {
                  actions: {
                    searchTitles: 'Search threads',
                    searchTitlesMac: 'Search threads (Command+F)',
                    searchTitlesWindows: 'Search threads (Ctrl+F)'
                  },
                  board: { emptyFocus: 'Nothing needs attention' },
                  search: {
                    title: 'Search threads',
                    placeholder: 'Search thread titles',
                    results: 'Thread search results',
                    empty: 'No matching threads',
                    startTyping: 'Type a thread title to start searching'
                  }
                }
              };
            `,
            loader: 'js',
          };
        }
        if (args.path === 'ua') {
          return { contents: 'export const uaHelper = { isMac: true };', loader: 'js' };
        }
        if (args.path === 'store') {
          return {
            contents: `
              const current = () => globalThis.__eyesOnAgentsThreadSearchHarness.store;
              export const eyesOnAgentsStore = new Proxy({}, {
                get: (_target, key) => current()[key],
                set: (_target, key, value) => {
                  current()[key] = value;
                  return true;
                }
              });
            `,
            loader: 'js',
          };
        }
        return {
          contents: `
            import { h } from 'vue';
            export default {
              props: ['thread'],
              setup: (props) => () => h('article', {
                class: 'thread-card-stub',
                'data-session-key': props.thread.sessionKey
              }, props.thread.title)
            };
          `,
          loader: 'js',
        };
      },
    );
  },
};

class ReceiverSensitiveStore {
  titleDraft = '';
  titleQuery = '';
  threadSearchVisible = false;
  threadSearchSelectedSessionKey = null;
  calls = [];
  threads = [
    { sessionKey: 'claude:match', title: 'Claude search match' },
    { sessionKey: 'codex:other', title: 'Codex unrelated thread' },
  ];

  get threadSearchResults() {
    const query = this.titleQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return this.threads.filter((thread) => thread.title.toLocaleLowerCase().includes(query));
  }

  get hasThreadSearchQueryTokens() {
    return this.titleQuery.trim().length > 0;
  }

  setTitleDraft(value) {
    this.calls.push(['setTitleDraft', value]);
    this.titleDraft = value;
    this.titleQuery = value;
  }

  openThreadSearch() {
    this.calls.push(['openThreadSearch']);
    this.threadSearchVisible = true;
  }

  closeThreadSearch() {
    this.threadSearchVisible = false;
  }

  clearTitleQuery() {
    this.titleDraft = '';
    this.titleQuery = '';
  }

  selectThreadSearchResult(sessionKey) {
    this.threadSearchSelectedSessionKey = sessionKey;
  }

  moveThreadSearchSelection() {}

  async openSelectedThreadSearchResult() {}
}

const ModalStub = defineComponent({
  name: 'AModal',
  props: { visible: Boolean },
  setup: (props, { slots }) => () => props.visible
    ? h('div', { class: 'arco-modal' }, slots.default?.())
    : null,
});

const TooltipStub = defineComponent({
  name: 'ATooltip',
  setup: (_props, { slots }) => () => h('div', { class: 'arco-tooltip-stub' }, slots.default?.()),
});

const mountComponent = async (component, store) => {
  document.body.innerHTML = '<main class="eyes-on-agents__main"><div id="root"></div></main>';
  globalThis.__eyesOnAgentsThreadSearchHarness = { store };
  const errors = [];
  const host = document.getElementById('root');
  const app = createApp({ render: () => h(component, { threads: [] }) });
  app.config.errorHandler = (error) => errors.push(error);
  app.component('AInput', ArcoModule.Input);
  app.component('AButton', ArcoModule.Button);
  app.component('AModal', ModalStub);
  app.component('ATooltip', TooltipStub);
  app.mount(host);
  await nextTick();
  return { app, errors, host };
};

try {
  const threadSearchOutfile = join(buildRoot, 'ThreadSearch.mjs');
  const domainColumnOutfile = join(buildRoot, 'DomainColumn.mjs');
  const commonBuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue', '@tabler/icons-vue'],
    plugins: [stubsPlugin, vuePlugin],
  };
  await Promise.all([
    build({
      ...commonBuildOptions,
      entryPoints: [join(
        projectRoot,
        'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue',
      )],
      outfile: threadSearchOutfile,
    }),
    build({
      ...commonBuildOptions,
      entryPoints: [join(
        projectRoot,
        'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue',
      )],
      outfile: domainColumnOutfile,
    }),
  ]);

  const [{ default: ThreadSearch }, { default: DomainColumn }] = await Promise.all([
    import(`${pathToFileURL(threadSearchOutfile).href}?v=${Date.now()}`),
    import(`${pathToFileURL(domainColumnOutfile).href}?v=${Date.now()}`),
  ]);

  await test('Arco Input model update keeps the store receiver and commits the query', async () => {
    const store = reactive(new ReceiverSensitiveStore());
    store.threadSearchVisible = true;
    const mounted = await mountComponent(ThreadSearch, store);
    try {
      const input = mounted.host.querySelector('input.arco-input');
      assert.ok(input, 'ThreadSearch must mount the real Arco Input');
      input.value = 'claude';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();

      assert.deepEqual(mounted.errors, []);
      assert.equal(store.titleDraft, 'claude');
      assert.equal(store.titleQuery, 'claude');
      assert.deepEqual(store.calls, [['setTitleDraft', 'claude']]);
      assert.deepEqual(
        store.threadSearchResults.map((thread) => thread.sessionKey),
        ['claude:match'],
      );
    } finally {
      mounted.app.unmount();
    }
  });

  await test('Arco Search button click keeps the store receiver and opens the modal', async () => {
    const store = reactive(new ReceiverSensitiveStore());
    const mounted = await mountComponent(DomainColumn, store);
    try {
      const searchButton = mounted.host.querySelector(
        'button[name="eyesOnAgents__domainColumn__search"]',
      );
      assert.ok(searchButton, 'DomainColumn must mount the real Arco Search button');
      searchButton.click();
      await nextTick();

      assert.deepEqual(mounted.errors, []);
      assert.equal(store.threadSearchVisible, true);
      assert.deepEqual(store.calls, [['openThreadSearch']]);
    } finally {
      mounted.app.unmount();
    }
  });
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__eyesOnAgentsThreadSearchHarness;
}
