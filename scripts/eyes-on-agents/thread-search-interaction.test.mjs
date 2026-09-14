/* eslint-disable @typescript-eslint/explicit-function-return-type */
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
  'CompositionEvent',
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
browserWindow.HTMLElement.prototype.scrollIntoView = () => undefined;
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
    buildApi.onLoad({ filter: /\.less$/ }, () => ({ contents: '', loader: 'js' }));
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
      { filter: /eyesOnAgents\.emitter$/ },
      () => ({ path: 'emitter', namespace: 'eyes-thread-search-test' }),
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
                submodules: { actions: { clearSearch: 'Clear search' } },
                eyesOnAgents: {
                  actions: {
                    readAll: '全部已读',
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
        if (args.path === 'emitter') {
          return {
            contents: `
              export const eyesOnAgentsEmitter = {
                getSnapshot: async () => globalThis.__eyesOnAgentsThreadSearchHarness.snapshot,
                markAllRead: () => globalThis.__eyesOnAgentsThreadSearchHarness.markAllRead(),
                openThread: async () => ({ snapshot: globalThis.__eyesOnAgentsThreadSearchHarness.store.snapshot })
              };
              export const subscribeEyesOnAgentsChanges = () => undefined;
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
  threadSearchRevision = 0;
  readableFocusThreads = [];
  busyAction = null;
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
    this.threadSearchSelectedSessionKey = this.threadSearchResults[0]?.sessionKey ?? null;
  }

  openThreadSearch() {
    this.calls.push(['openThreadSearch']);
    this.threadSearchRevision += 1;
    this.titleDraft = '';
    this.titleQuery = '';
    this.threadSearchSelectedSessionKey = null;
    this.threadSearchVisible = true;
  }

  closeThreadSearch() {
    this.threadSearchRevision += 1;
    this.threadSearchVisible = false;
    this.titleDraft = '';
    this.titleQuery = '';
    this.threadSearchSelectedSessionKey = null;
  }

  clearTitleQuery() {
    this.titleDraft = '';
    this.titleQuery = '';
  }

  selectThreadSearchResult(sessionKey) {
    this.threadSearchSelectedSessionKey = sessionKey;
  }

  moveThreadSearchSelection() {}

  async openSelectedThreadSearchResult() {
    if (this.threadSearchSelectedSessionKey) this.closeThreadSearch();
  }
}

const ModalStub = defineComponent({
  name: 'AModal',
  props: { visible: Boolean },
  setup: (props, { emit, slots }) => {
    globalThis.__eyesOnAgentsThreadSearchHarness.modal = {
      cancel: () => emit('cancel', new Event('cancel')),
      open: () => emit('open'),
    };
    return () => props.visible
      ? h('div', { class: 'arco-modal' }, slots.default?.())
      : null;
  },
});

const TooltipStub = defineComponent({
  name: 'ATooltip',
  setup: (_props, { slots }) => () => h('div', { class: 'arco-tooltip-stub' }, slots.default?.()),
});

const mountComponent = async (component, store, { realModal = false } = {}) => {
  document.body.innerHTML = '<main class="eyes-on-agents__main"><div id="root"></div></main>';
  globalThis.__eyesOnAgentsThreadSearchHarness = { store };
  const errors = [];
  const host = document.getElementById('root');
  const app = createApp({ render: () => h(component, { threads: [] }) });
  app.config.errorHandler = (error) => errors.push(error);
  app.component('AInput', ArcoModule.Input);
  app.component('AButton', ArcoModule.Button);
  app.component('AModal', realModal ? ArcoModule.Modal : ModalStub);
  app.component('ATooltip', TooltipStub);
  app.mount(host);
  await nextTick();
  return { app, errors, host, container: host.parentElement };
};

const settleModalTransition = async () => {
  await nextTick();
  await new Promise((resolve) => browserWindow.requestAnimationFrame(() => {
    browserWindow.requestAnimationFrame(resolve);
  }));
  await nextTick();
};

const settleTitleQuery = async () => {
  await new Promise((resolve) => setTimeout(resolve, 160));
  await nextTick();
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const startComposition = (input, value) => {
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = value;
  input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: value }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const finishComposition = (input, value) => {
  input.value = value;
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
};

try {
  const threadSearchOutfile = join(buildRoot, 'ThreadSearch.mjs');
  const domainColumnOutfile = join(buildRoot, 'DomainColumn.mjs');
  const storeOutfile = join(buildRoot, 'eyesOnAgents.store.mjs');
  const commonBuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue', '@tabler/icons-vue', '@arco-design/web-vue'],
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
    build({
      ...commonBuildOptions,
      entryPoints: [join(projectRoot, 'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts')],
      outfile: storeOutfile,
    }),
  ]);

  const [{ default: ThreadSearch }, { default: DomainColumn }, actualStoreModule] = await Promise.all([
    import(`${pathToFileURL(threadSearchOutfile).href}?v=${Date.now()}`),
    import(`${pathToFileURL(domainColumnOutfile).href}?v=${Date.now()}`),
    import(`${pathToFileURL(storeOutfile).href}?v=${Date.now()}`),
  ]);
  const actualStore = () => {
    const store = actualStoreModule.eyesOnAgentsStore;
    store.closeThreadSearch();
    store.busyAction = null;
    store.actionError = null;
    store.snapshot = {
      threads: [
        { sessionKey: 'claude:match', title: 'Claude search match', runtimeState: 'idle' },
        { sessionKey: 'codex:other', title: 'Codex unrelated thread', runtimeState: 'idle' },
      ],
    };
    store.configureTitleQueryScheduler(actualStoreModule.createEyesOnAgentsTitleQueryScheduler(
      (revision) => store.commitTitleQuery(revision),
    ));
    return store;
  };

  await test('native input computed model keeps the store receiver and commits the query', async () => {
    const store = reactive(new ReceiverSensitiveStore());
    store.threadSearchVisible = true;
    const mounted = await mountComponent(ThreadSearch, store);
    try {
      const input = mounted.host.querySelector('input.thread-search__input');
      assert.ok(input, 'ThreadSearch must mount the native Search input');
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

  await test('opening Search focuses the real input and every close path clears it', async () => {
    const store = reactive(new ReceiverSensitiveStore());
    const mounted = await mountComponent(ThreadSearch, store);
    try {
      const outsideButton = document.createElement('button');
      outsideButton.type = 'button';
      mounted.host.append(outsideButton);
      outsideButton.focus();

      store.openThreadSearch();
      await nextTick();
      await nextTick();
      let input = mounted.host.querySelector('input.thread-search__input');
      assert.ok(input, 'opening Search must mount the native Search input');
      assert.equal(document.activeElement, input, 'shortcut-equivalent open focuses the input');

      input.value = 'cancel me';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      globalThis.__eyesOnAgentsThreadSearchHarness.modal.cancel();
      await nextTick();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      store.openThreadSearch();
      await nextTick();
      await nextTick();
      input = mounted.host.querySelector('input.thread-search__input');
      input.value = 'escape me';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await nextTick();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      store.openThreadSearch();
      await nextTick();
      await nextTick();
      input = mounted.host.querySelector('input.thread-search__input');
      input.value = 'claude';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      await Promise.resolve();
      await nextTick();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);
      assert.deepEqual(mounted.errors, []);
    } finally {
      mounted.app.unmount();
    }
  });

  await test('a superseded modal-open callback cannot steal focus', async () => {
    const store = reactive(new ReceiverSensitiveStore());
    const mounted = await mountComponent(ThreadSearch, store);
    try {
      const outsideButton = document.createElement('button');
      outsideButton.type = 'button';
      mounted.host.append(outsideButton);

      store.openThreadSearch();
      await nextTick();
      await nextTick();
      const input = mounted.host.querySelector('input.thread-search__input');
      assert.ok(input);
      assert.equal(document.activeElement, input);

      outsideButton.focus();
      globalThis.__eyesOnAgentsThreadSearchHarness.modal.open();
      store.closeThreadSearch();
      store.openThreadSearch();
      await nextTick();
      assert.equal(document.activeElement, outsideButton, 'the stale callback cannot focus the replacement');
      await nextTick();
      assert.equal(
        document.activeElement,
        mounted.host.querySelector('input.thread-search__input'),
        'the new lifecycle focuses its replacement even when close and reopen share a tick',
      );

      globalThis.__eyesOnAgentsThreadSearchHarness.modal.open();
      await nextTick();
      assert.equal(
        document.activeElement,
        mounted.host.querySelector('input.thread-search__input'),
        'the current modal lifecycle can focus its current input',
      );

      outsideButton.focus();
      globalThis.__eyesOnAgentsThreadSearchHarness.modal.open();
      store.closeThreadSearch();
      await nextTick();
      assert.equal(
        document.activeElement,
        outsideButton,
        'a closing lifecycle cannot pull focus back from another application surface',
      );
      assert.deepEqual(mounted.errors, []);
    } finally {
      mounted.app.unmount();
    }
  });

  await test('real retained Modal resets interrupted native composition on every Search lifecycle', async () => {
    const store = actualStore();
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      for (const query of ['claude', 'codex', 'claude']) {
        store.openThreadSearch();
        await settleModalTransition();
        const modal = mounted.container.querySelector('.thread-search-modal');
        const previousInput = mounted.container.querySelector('input.thread-search__input');
        assert.ok(modal, 'the real Modal must render inside the Search container');
        assert.ok(previousInput);
        assert.equal(document.activeElement, previousInput);
        previousInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        previousInput.value = 'unfinished';
        previousInput.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
        assert.equal(store.titleDraft, '', 'unfinished composition must not publish');

        modal.querySelector('.arco-modal-close-btn').click();
        await nextTick();
        assert.equal(store.threadSearchVisible, false);
        store.openThreadSearch();
        await settleModalTransition();
        const input = mounted.container.querySelector('input.thread-search__input');
        assert.equal(mounted.container.querySelector('.thread-search-modal'), modal, 'the Modal stays retained');
        assert.equal(document.activeElement, input);
        assert.equal(input.value, '');
        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await settleTitleQuery();
        assert.equal(store.titleDraft, query);
        assert.equal(store.titleQuery, query);
        assert.equal(input.value, query);
        assert.notEqual(input, previousInput, 'reopen replaces the Input without waiting for the leave transition');
        assert.equal(mounted.container.querySelectorAll('.thread-search__result').length, 1);
        assert.equal(
          mounted.container.querySelector('.thread-search__result .thread-card-stub').textContent,
          store.threadSearchResults[0].title,
        );
        assert.deepEqual(mounted.errors, []);
        store.closeThreadSearch();
        await settleModalTransition();
      }
    } finally {
      mounted.app.unmount();
    }
  });

  await test('real Modal native input publishes completed composition and leaves composing keys to the IME', async () => {
    const store = actualStore();
    store.threads[0].title = '中文搜索';
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      store.openThreadSearch();
      await settleModalTransition();
      const input = mounted.container.querySelector('input.thread-search__input');
      assert.equal(document.activeElement, input);
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = '中文';
      input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '中文' }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, isComposing: true });
        input.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `${key} belongs to the active IME`);
      }
      await nextTick();
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.titleDraft, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      input.value = '中文';
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
      await nextTick();
      await nextTick();
      assert.equal(store.titleDraft, '中文');
      assert.equal(store.titleQuery, '中文');
      assert.equal(mounted.container.querySelectorAll('.thread-search__result').length, 1);
      assert.equal(store.threadSearchSelectedSessionKey, 'claude:match');
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      await nextTick();
      assert.equal(store.threadSearchVisible, false, 'Enter resumes Search behavior after composition ends');
      assert.deepEqual(mounted.errors, []);
    } finally {
      mounted.app.unmount();
    }
  });

  await test('real Modal and store preserve raw input through rapid replacement, matching and snapshot renders', async () => {
    const store = actualStore();
    store.threads[0].title = 'Claude 中文 / release';
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      store.openThreadSearch();
      await settleModalTransition();
      const input = mounted.container.querySelector('input.thread-search__input');
      const type = async (value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
        assert.equal(store.titleDraft, value);
        assert.equal(input.value, value);
      };

      await type('  ClAuDe  ');
      assert.equal(store.titleQuery, '  ClAuDe  ', 'leading search commits raw text');
      await type('  CODEX  ');
      const latest = '  ｃＬａＵｄｅ / 中文  ';
      await type(latest);
      assert.equal(store.titleQuery, '  ClAuDe  ', 'rapid replacement remains a trailing update');

      globalThis.__eyesOnAgentsThreadSearchHarness.snapshot = {
        threads: store.threads.map((thread) => ({ ...thread, isUnread: true })),
      };
      await store.loadSnapshot(true);
      await nextTick();
      assert.equal(input.value, latest, 'a snapshot rerender cannot replace raw text');
      assert.equal(store.titleDraft, latest);
      await settleTitleQuery();
      assert.equal(store.titleQuery, latest);
      assert.equal(input.value, latest);
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.deepEqual(store.threadSearchResults.map((thread) => thread.sessionKey), ['claude:match']);
      assert.equal(mounted.container.querySelectorAll('.thread-search__result').length, 1);
      assert.equal(store.focusThreads.length, 2, 'search never filters the Focus board');

      await type('  - _ / ： |  ');
      await settleTitleQuery();
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.equal(input.value, '  - _ / ： |  ', 'separator normalization does not rewrite the field');
      assert.equal(store.threadSearchResults.length, 0);
      const clearButton = mounted.container.querySelector('.thread-search__clear');
      assert.ok(clearButton);
      clearButton.click();
      await nextTick();
      await settleTitleQuery();
      const clearedInput = mounted.container.querySelector('input.thread-search__input');
      assert.equal(clearedInput.value, '');
      assert.equal(document.activeElement, clearedInput);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.deepEqual(mounted.errors, []);
    } finally {
      store.closeThreadSearch();
      mounted.app.unmount();
    }
  });

  await test('native composition survives real snapshot, selection and focus updates with empty and existing drafts', async () => {
    for (const prefix of ['', 'cla ']) {
      const store = actualStore();
      store.threads[0].title = 'cla 中文搜索';
      store.threads[1].title = 'cla 第二个搜索结果';
      const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
      try {
        store.openThreadSearch();
        await settleModalTransition();
        const input = mounted.container.querySelector('input.thread-search__input');
        if (prefix) {
          input.value = prefix;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await settleTitleQuery();
        }

        const composingValue = `${prefix}zhong`;
        startComposition(input, composingValue);
        await nextTick();
        assert.equal(input.value, composingValue, 'showing the clear control must preserve the native composition');
        assert.equal(store.titleDraft, prefix, 'IME text remains uncommitted');
        const clearButton = mounted.container.querySelector('.thread-search__clear');
        assert.ok(clearButton.classList.contains('icon-btn'), 'clear uses the real shared IconBtn');
        assert.equal(clearButton.getAttribute('aria-label'), 'Clear search');

        globalThis.__eyesOnAgentsThreadSearchHarness.snapshot = {
          threads: store.threads.map((thread) => ({ ...thread, isUnread: true })),
        };
        await store.loadSnapshot(true);
        await nextTick();
        assert.equal(input.value, composingValue, 'a real snapshot refresh cannot replace uncommitted IME text');
        assert.equal(input, mounted.container.querySelector('input.thread-search__input'));

        if (prefix) {
          store.selectThreadSearchResult('codex:other');
          await nextTick();
          assert.equal(input.getAttribute('aria-activedescendant'), 'eyes-on-agents-thread-search-option-codex%3Aother');
          assert.equal(input.value, composingValue, 'ARIA selection updates preserve the same composition');
        }
        input.blur();
        input.focus();
        await nextTick();
        assert.equal(input.value, composingValue, 'focus-state updates preserve composition');

        for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
          const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
          input.dispatchEvent(event);
          assert.equal(event.defaultPrevented, false, 'the active composition owns its keys even without isComposing');
        }
        assert.equal(store.threadSearchVisible, true);
        const shortcuts = [];
        const recordShortcut = (event) => shortcuts.push(event);
        window.addEventListener('keydown', recordShortcut);
        try {
          for (const modifier of ['metaKey', 'ctrlKey']) {
            input.dispatchEvent(new KeyboardEvent('keydown', {
              bubbles: true, key: 'f', isComposing: true, [modifier]: true,
            }));
          }
          assert.equal(shortcuts.length, 2, 'Cmd/Ctrl+F still reaches the window shortcut handler during composition');
        } finally {
          window.removeEventListener('keydown', recordShortcut);
        }
        finishComposition(input, `${prefix}中文`);
        await settleTitleQuery();
        assert.equal(input.value, `${prefix}中文`);
        assert.equal(store.titleDraft, `${prefix}中文`);
        assert.equal(store.titleQuery, `${prefix}中文`);
        assert.deepEqual(mounted.errors, []);
      } finally {
        store.closeThreadSearch();
        mounted.app.unmount();
      }
    }
  });

  await test('a pending actual-store throttle commit preserves the current uncommitted native composition', async () => {
    const store = actualStore();
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      store.openThreadSearch();
      await settleModalTransition();
      const input = mounted.container.querySelector('input.thread-search__input');
      for (const value of ['c', 'cla']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
      }
      assert.equal(store.titleDraft, 'cla');
      assert.equal(store.titleQuery, 'c', 'the second draft has a pending trailing commit');
      startComposition(input, 'cla zhong');
      await settleTitleQuery();
      assert.equal(store.titleQuery, 'cla', 'the actual scheduler has committed the prior draft');
      assert.equal(store.titleDraft, 'cla');
      assert.equal(input.value, 'cla zhong', 'committing results must not write the old draft over IME text');
      assert.equal(input, mounted.container.querySelector('input.thread-search__input'));
      finishComposition(input, 'cla 中文');
      await settleTitleQuery();
      assert.equal(store.titleDraft, 'cla 中文');
      assert.equal(store.titleQuery, 'cla 中文');
      assert.deepEqual(mounted.errors, []);
    } finally {
      store.closeThreadSearch();
      mounted.app.unmount();
    }
  });

  await test('clear replaces composing input and ignores late events before and after the replacement', async () => {
    for (const prefix of ['', 'cla']) {
      const store = actualStore();
      const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
      try {
        store.openThreadSearch();
        await settleModalTransition();
        const previousInput = mounted.container.querySelector('input.thread-search__input');
        if (prefix) {
          previousInput.value = prefix;
          previousInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        startComposition(previousInput, `${prefix}zhong`);
        await nextTick();
        mounted.container.querySelector('.thread-search__clear').click();
        finishComposition(previousInput, 'late-before-render');
        assert.equal(store.titleDraft, '', 'clear invalidates the old input synchronously');
        await nextTick();
        await nextTick();
        const input = mounted.container.querySelector('input.thread-search__input');
        assert.notEqual(input, previousInput);
        assert.equal(input.value, '');
        assert.equal(document.activeElement, input);
        assert.equal(mounted.container.querySelector('.thread-search__clear'), null);

        startComposition(input, 'new-pinyin');
        startComposition(previousInput, 'obsolete');
        finishComposition(previousInput, 'late-after-render');
        previousInput.dispatchEvent(new Event('input', { bubbles: true }));
        await settleTitleQuery();
        assert.equal(input.value, 'new-pinyin');
        assert.equal(store.titleDraft, '');
        assert.equal(store.titleQuery, '');
        assert.ok(mounted.container.querySelector('.thread-search__clear'), 'a retired compositionend must not end the current composition');
        finishComposition(input, 'codex');
        await settleTitleQuery();
        assert.equal(store.titleDraft, 'codex');
        assert.equal(store.titleQuery, 'codex');
        assert.deepEqual(mounted.errors, []);
      } finally {
        store.closeThreadSearch();
        mounted.app.unmount();
      }
    }
  });

  await test('closed and reopened Search ignores late composition events from the previous lifecycle', async () => {
    const store = actualStore();
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        store.openThreadSearch();
        await settleModalTransition();
        const previousInput = mounted.container.querySelector('input.thread-search__input');
        startComposition(previousInput, 'unfinished');
        mounted.container.querySelector('.arco-modal-close-btn').click();
        finishComposition(previousInput, 'late-while-closed');
        assert.equal(store.titleDraft, '');
        store.openThreadSearch();
        finishComposition(previousInput, 'late-before-reopen-render');
        assert.equal(store.titleDraft, '');
        await settleModalTransition();
        const input = mounted.container.querySelector('input.thread-search__input');
        assert.notEqual(input, previousInput);
        startComposition(previousInput, 'obsolete');
        finishComposition(previousInput, 'late-after-reopen');
        await nextTick();
        assert.equal(input.value, '');
        assert.equal(store.titleDraft, '');
        assert.equal(document.activeElement, input);
        input.value = 'claude';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await settleTitleQuery();
        assert.equal(store.titleDraft, 'claude');
        assert.equal(store.titleQuery, 'claude');
        store.closeThreadSearch();
      }
      assert.deepEqual(mounted.errors, []);
    } finally {
      store.closeThreadSearch();
      mounted.app.unmount();
    }
  });

  await test('actual store trailing callbacks cannot overwrite a new raw draft after close and reopen', async () => {
    const store = actualStore();
    const mounted = await mountComponent(ThreadSearch, store, { realModal: true });
    try {
      store.openThreadSearch();
      await settleModalTransition();
      let input = mounted.container.querySelector('input.thread-search__input');
      for (const value of ['claude', 'old pending query']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const previousRevision = store.threadSearchRevision;
      store.closeThreadSearch();
      store.openThreadSearch();
      await settleModalTransition();
      input = mounted.container.querySelector('input.thread-search__input');
      input.value = '  CoDeX  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      store.commitTitleQuery(previousRevision);
      await settleTitleQuery();
      assert.equal(input.value, '  CoDeX  ');
      assert.equal(store.titleDraft, '  CoDeX  ');
      assert.equal(store.titleQuery, '  CoDeX  ');
      assert.deepEqual(store.threadSearchResults.map((thread) => thread.sessionKey), ['codex:other']);
      store.closeThreadSearch();
      await settleTitleQuery();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.deepEqual(mounted.errors, []);
    } finally {
      store.closeThreadSearch();
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

  await test('Focus header places localized Read all immediately after Search and keeps empty state disabled', async () => {
    const store = actualStore();
    const mounted = await mountComponent(DomainColumn, store);
    let writes = 0;
    globalThis.__eyesOnAgentsThreadSearchHarness.markAllRead = async () => {
      writes += 1;
      return store.snapshot;
    };
    try {
      const buttons = [...mounted.host.querySelectorAll('.agent-domain__header button')];
      assert.deepEqual(buttons.map((button) => button.name), [
        'eyesOnAgents__domainColumn__search',
        'eyesOnAgents__domainColumn__readAll',
      ]);
      const readAllButton = buttons[1];
      assert.equal(readAllButton.textContent.trim(), '全部已读', 'the label comes from the locale');
      assert.ok(readAllButton.classList.contains('arco-btn-text'), 'Read all uses the real text button');
      assert.ok(readAllButton.classList.contains('arco-btn-size-mini'), 'the header action stays compact');
      assert.equal(readAllButton.disabled, true);
      readAllButton.click();
      await store.markAllRead();
      assert.equal(writes, 0, 'disabled UI and the store both prevent an empty bulk action');

      store.snapshot = {
        threads: [{ sessionKey: 'claude:working', title: 'Still replying', runtimeState: 'working', isUnread: true }],
      };
      await nextTick();
      assert.equal(readAllButton.disabled, true, 'a latent unread flag on a working card is not a visible red dot');
      readAllButton.click();
      await store.markAllRead();
      assert.equal(writes, 0);
      assert.equal(mounted.host.querySelectorAll('.agent-domain__header button').length, 2, 'Read all stays visible');
      assert.deepEqual(mounted.errors, []);
    } finally {
      mounted.app.unmount();
    }
  });

  await test('Read all shows loading, rejects duplicates and applies the returned snapshot without blocking Search', async () => {
    const store = actualStore();
    store.snapshot = {
      threads: [
        { sessionKey: 'claude:unread', title: 'Ready to read', runtimeState: 'idle', isUnread: true },
        { sessionKey: 'codex:working', title: 'Still replying', runtimeState: 'working', isUnread: true },
      ],
    };
    const mounted = await mountComponent(DomainColumn, store);
    const pending = deferred();
    let writes = 0;
    globalThis.__eyesOnAgentsThreadSearchHarness.markAllRead = () => {
      writes += 1;
      return pending.promise;
    };
    try {
      const readAllButton = mounted.host.querySelector('button[name="eyesOnAgents__domainColumn__readAll"]');
      const searchButton = mounted.host.querySelector('button[name="eyesOnAgents__domainColumn__search"]');
      assert.equal(readAllButton.disabled, false);
      readAllButton.click();
      readAllButton.click();
      await store.markAllRead();
      await nextTick();
      assert.equal(writes, 1, 'rapid clicks and direct duplicate calls share the store action gate');
      assert.equal(store.busyAction, 'read-all');
      assert.equal(readAllButton.disabled, true);
      assert.ok(readAllButton.classList.contains('arco-btn-loading'));
      assert.equal(store.threads[0].isUnread, true, 'there is no optimistic unread clear');

      assert.equal(searchButton.disabled, false);
      searchButton.click();
      await nextTick();
      assert.equal(store.threadSearchVisible, true, 'Search still opens while Read all is pending');

      pending.resolve({ threads: store.threads.map((thread) => ({ ...thread, isUnread: false })) });
      await pending.promise;
      await nextTick();
      assert.equal(store.busyAction, null);
      assert.equal(readAllButton.classList.contains('arco-btn-loading'), false);
      assert.equal(readAllButton.disabled, true);
      assert.deepEqual(store.threads.map((thread) => thread.isUnread), [false, false]);
      assert.equal(store.focusThreads.length, 2, 'acknowledged cards stay on Focus');
      assert.equal(store.threads[1].runtimeState, 'working', 'the action does not stop the working card');
      assert.equal(store.actionError, null);
      assert.deepEqual(mounted.errors, []);
    } finally {
      store.closeThreadSearch();
      mounted.app.unmount();
    }
  });

  await test('Read all stays disabled for another action and catches a failed write without clearing unread', async () => {
    const store = actualStore();
    store.snapshot = {
      threads: [{ sessionKey: 'claude:unread', title: 'Ready to read', runtimeState: 'unknown', isUnread: true }],
    };
    store.busyAction = 'sync';
    const mounted = await mountComponent(DomainColumn, store);
    const pending = deferred();
    let writes = 0;
    globalThis.__eyesOnAgentsThreadSearchHarness.markAllRead = () => {
      writes += 1;
      return pending.promise;
    };
    try {
      const readAllButton = mounted.host.querySelector('button[name="eyesOnAgents__domainColumn__readAll"]');
      assert.equal(readAllButton.disabled, true);
      assert.equal(readAllButton.classList.contains('arco-btn-loading'), false, 'only Read all owns its spinner');
      readAllButton.click();
      await store.markAllRead();
      assert.equal(writes, 0);

      store.busyAction = null;
      await nextTick();
      assert.equal(readAllButton.disabled, false, 'unknown-state visible unread is eligible');
      readAllButton.click();
      await nextTick();
      pending.reject(new Error('Read all write failed'));
      await pending.promise.catch(() => undefined);
      await nextTick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(writes, 1);
      assert.equal(store.busyAction, null);
      assert.equal(store.actionError, 'Read all write failed');
      assert.equal(store.threads[0].isUnread, true);
      assert.equal(readAllButton.disabled, false, 'failure leaves the action available to retry');
      assert.equal(readAllButton.classList.contains('arco-btn-loading'), false);
      assert.deepEqual(mounted.errors, [], 'the click wrapper consumes the already-presented action failure');
    } finally {
      store.busyAction = null;
      mounted.app.unmount();
    }
  });
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__eyesOnAgentsThreadSearchHarness;
}
