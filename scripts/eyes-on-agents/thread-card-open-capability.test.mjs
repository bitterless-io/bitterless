import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-thread-card-open-'));
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

const { createApp, createSSRApp, h, nextTick } = await import('vue');
const { renderToString } = await import('@vue/server-renderer');
const ArcoModule = await import('@arco-design/web-vue');
const ArcoVue = ArcoModule.default?.default ?? ArcoModule.default ?? ArcoModule;
const read = (path) => readFileSync(join(projectRoot, path), 'utf8');

const vuePlugin = {
  name: 'eyes-on-agents-thread-card-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-thread-card-open',
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
  name: 'eyes-on-agents-thread-card-stubs',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /@renderer\/common\/i18n\/i18n\.helper$/ },
      () => ({ path: 'i18n', namespace: 'eyes-thread-card-test' }),
    );
    buildApi.onResolve(
      { filter: /eyesOnAgents\.store$/ },
      () => ({ path: 'store', namespace: 'eyes-thread-card-test' }),
    );
    buildApi.onResolve(
      { filter: /global\.store$/ },
      () => ({ path: 'global-store', namespace: 'eyes-thread-card-test' }),
    );
    buildApi.onResolve(
      { filter: /ProviderGlyph\/ProviderGlyph\.vue$/ },
      () => ({ path: 'provider-glyph', namespace: 'eyes-thread-card-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-thread-card-test' },
      (args) => {
        if (args.path === 'i18n') {
          return {
            contents: `export { en as i18nHelper } from ${JSON.stringify(join(
              projectRoot,
              'src/renderer/common/i18n/en.ts',
            ))};`,
            loader: 'js',
            resolveDir: projectRoot,
          };
        }
        if (args.path === 'store') {
          return {
            contents: `
              const current = () => globalThis.__eyesOnAgentsThreadCardHarness.store;
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
        if (args.path === 'global-store') {
          return {
            contents: 'export const globalStore = { currentTime: Date.parse("2026-08-18T02:00:00.000Z") };',
            loader: 'js',
          };
        }
        return {
          contents: `
            import { h } from 'vue';
            export default {
              props: ['provider'],
              setup: (props) => () => h('span', {
                class: 'provider-glyph',
                'data-provider': props.provider
              })
            };
          `,
          loader: 'js',
        };
      },
    );
  },
};

const createStore = () => {
  const calls = { open: [], preview: [] };
  return {
    calls,
    openingSessionKeys: new Set(),
    previewingSessionKeys: new Set(),
    openThread: async (sessionKey) => calls.open.push(sessionKey),
    previewThread: async (sessionKey) => calls.preview.push(sessionKey),
  };
};

const createThread = (overrides = {}) => ({
  sessionKey: 'claude:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  provider: 'claude',
  title: 'Observed task',
  runtimeState: 'idle',
  lastUserPrompt: { state: 'unavailable', preview: null, truncated: false },
  cwd: null,
  desktopSessionId: null,
  isUnread: false,
  lastActivityAt: '2026-08-18T01:59:00.000Z',
  lastCompletedAt: null,
  canPreviewTranscript: true,
  domainId: 1,
  ...overrides,
});

try {
  const outfile = join(buildRoot, 'ThreadCard.mjs');
  await build({
    entryPoints: [join(
      projectRoot,
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue',
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

  const { default: ThreadCard } = await import(
    `${pathToFileURL(outfile).href}?v=${Date.now()}`
  );
  const render = async (thread) => {
    globalThis.__eyesOnAgentsThreadCardHarness = { store: createStore() };
    const app = createSSRApp({ render: () => h(ThreadCard, { thread }) });
    app.use(ArcoVue);
    const html = await renderToString(app);
    return new JSDOM(html).window.document;
  };
  const mount = async (thread) => {
    document.body.innerHTML = '<div id="thread-card-root"></div>';
    const store = createStore();
    globalThis.__eyesOnAgentsThreadCardHarness = { store };
    const host = document.getElementById('thread-card-root');
    const app = createApp({ render: () => h(ThreadCard, { thread }) });
    app.use(ArcoVue);
    app.mount(host);
    await nextTick();
    return { app, host, store };
  };
  const openMore = async (host) => {
    const more = host.querySelector('button.thread-card__more-control');
    assert.ok(more, 'More must remain the direct Dropdown button trigger');
    more.click();
    await nextTick();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    await nextTick();
    return more;
  };
  const activeDropdown = () => [...document.body.querySelectorAll('.arco-dropdown')]
    .find((element) => element.textContent?.includes('Preview transcript'));

  await test('Codex and Desktop-mapped Claude tasks retain Open', async () => {
    for (const thread of [
      createThread({
        sessionKey: 'codex:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        provider: 'codex',
        desktopSessionId: null,
        isUnread: true,
      }),
      createThread({
        desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ]) {
      const document = await render(thread);
      const card = document.querySelector('[name="eyesOnAgents__threadCard"]');
      const open = document.querySelector('.thread-card__open-control');
      const more = document.querySelector('button.thread-card__more-control');

      assert.ok(card);
      assert.equal(card.getAttribute('tabindex'), '0');
      assert.ok(open, `${thread.provider} must retain its Open control`);
      assert.ok(open.querySelector('button[aria-label^="Open"]'));
      if (thread.provider === 'claude') {
        assert.equal(more?.getAttribute('aria-label'), 'More actions');
        assert.equal(more?.classList.contains('thread-card__more-control--unread'), false);
      } else {
        assert.equal(more, null, 'a Codex card owns no overflow action and hides the control');
      }
      if (thread.isUnread) {
        assert.ok(open.querySelector('.thread-card__unread-dot'));
        assert.match(card.getAttribute('aria-label') ?? '', /Unread/);
      }
    }
  });

  await test('CLI-only Claude hides Open without losing Preview or unread semantics', async () => {
    const document = await render(createThread({ isUnread: true }));
    const card = document.querySelector('[name="eyesOnAgents__threadCard"]');
    const more = document.querySelector('button.thread-card__more-control');

    assert.ok(card);
    assert.equal(card.hasAttribute('tabindex'), false);
    assert.equal(document.querySelector('.thread-card__open-control'), null);
    assert.match(card.getAttribute('aria-label') ?? '', /Unread/);
    assert.equal(more?.getAttribute('aria-label'), 'More actions, Unread');
    assert.equal(more?.classList.contains('thread-card__more-control--unread'), true);

    const cardSource = read(
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue',
    );
    const cardStyles = read(
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less',
    );
    assert.match(
      cardSource,
      /a-dropdown v-if="canPreviewTranscript"[\s\S]*?handlePreview/,
    );
    assert.match(
      cardSource,
      /const canPreviewTranscript = computed\(\(\) => props\.thread\.provider === 'claude'\s*&& props\.thread\.canPreviewTranscript\);/,
    );
    assert.doesNotMatch(cardSource, /moveThread|Move to Domain|actions\.moveTo/);
    assert.match(cardSource, /const handleOpen[\s\S]*?if \(!canOpenThread\.value\) return;/);
    assert.match(cardSource, /const handleDoubleClick[\s\S]*?await handleOpen\(\);/);
    assert.match(
      cardStyles,
      /\.thread-card__more-control--unread::after[\s\S]*?width: 6px[\s\S]*?background: #ef4444[\s\S]*?content: ''/,
    );
  });

  await test('a Claude row without Open or Preview keeps a standalone unread marker', async () => {
    const unreachable = await render(createThread({
      isUnread: true,
      canPreviewTranscript: false,
    }));
    assert.equal(unreachable.querySelector('.thread-card__open-control'), null);
    assert.equal(unreachable.querySelector('button.thread-card__more-control'), null);
    const marker = unreachable.querySelector('.thread-card__unread-marker');
    assert.ok(marker, 'unread attention must survive without Open or Preview');
    assert.equal(marker.getAttribute('aria-label'), 'Unread');
    assert.equal(unreachable.querySelectorAll('.thread-card__unread-dot').length, 1);

    const readRow = await render(createThread({ canPreviewTranscript: false }));
    assert.equal(readRow.querySelector('.thread-card__unread-marker'), null);
  });

  await test('the direct More trigger opens CLI Preview and hides Domain actions', async () => {
    const cliThread = createThread({ isUnread: true });
    let mounted = await mount(cliThread);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown, 'CLI-only More must open its Arco Dropdown');
      assert.match(dropdown.textContent ?? '', /Preview transcript/);
      assert.doesNotMatch(dropdown.textContent ?? '', /Domain/);
      assert.equal(
        dropdown.querySelectorAll('.arco-dropdown-option').length,
        1,
        'Preview transcript must be the only overflow action',
      );
      assert.deepEqual(mounted.store.calls.open, [], 'More must not bubble into card Open');

      const preview = [...dropdown.querySelectorAll('.arco-dropdown-option')]
        .find((element) => element.textContent?.includes('Preview transcript'));
      assert.ok(preview);
      preview.click();
      await nextTick();
      assert.deepEqual(mounted.store.calls.preview, [cliThread.sessionKey]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    const codexThread = createThread({
      sessionKey: 'codex:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      provider: 'codex',
      canPreviewTranscript: false,
    });
    mounted = await mount(codexThread);
    try {
      assert.equal(
        mounted.host.querySelector('button.thread-card__more-control'),
        null,
        'a Codex card exposes no overflow menu once Domain actions are gone',
      );
      assert.equal(activeDropdown(), undefined);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('every active response phase keeps the loading indicator', async () => {
    for (const runtimeState of ['working', 'waiting_approval', 'waiting_input']) {
      const rendered = await render(createThread({
        runtimeState,
        desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }));
      assert.ok(
        rendered.querySelector('.thread-card__working [role="img"], .thread-card__working svg'),
        `${runtimeState} must render the active response spinner`,
      );
      assert.ok(rendered.querySelector('.thread-card__working[role="status"]'));
    }
    const idle = await render(createThread({
      desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }));
    assert.equal(idle.querySelector('.thread-card__working'), null);
  });

  await test('terminal unread states show one dot while active states show only loading', async () => {
    for (const runtimeState of ['idle', 'ended', 'failed']) {
      const rendered = await render(createThread({
        runtimeState,
        isUnread: true,
        desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }));
      assert.equal(
        rendered.querySelectorAll('.thread-card__unread-dot').length,
        1,
        `${runtimeState} unread must render exactly one terminal attention dot`,
      );
      assert.equal(rendered.querySelector('.thread-card__working'), null);
    }

    for (const runtimeState of ['working', 'waiting_approval', 'waiting_input']) {
      const rendered = await render(createThread({
        runtimeState,
        isUnread: true,
        desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }));
      assert.equal(
        rendered.querySelectorAll('.thread-card__unread-dot').length,
        0,
        `${runtimeState} must not render a terminal attention dot`,
      );
      assert.ok(
        rendered.querySelector('.thread-card__working[role="status"]'),
        `${runtimeState} must keep its loading indicator`,
      );
    }
  });

  await test('mounted card gestures and unread display follow the Open capability', async () => {
    const dispatchOpenGestures = async (host) => {
      const card = host.querySelector('[name="eyesOnAgents__threadCard"]');
      assert.ok(card);
      card.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
      await nextTick();
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await nextTick();
    };

    let mounted = await mount(createThread());
    try {
      await dispatchOpenGestures(mounted.host);
      assert.deepEqual(mounted.store.calls.open, [], 'CLI-only gestures must stay no-ops');
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    for (const thread of [
      createThread({
        sessionKey: 'codex:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        provider: 'codex',
      }),
      createThread({
        desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ]) {
      mounted = await mount(thread);
      try {
        await dispatchOpenGestures(mounted.host);
        assert.deepEqual(mounted.store.calls.open, [thread.sessionKey, thread.sessionKey]);
      } finally {
        mounted.app.unmount();
        document.body.innerHTML = '';
      }
    }

    mounted = await mount(createThread({ isUnread: true, runtimeState: 'working' }));
    try {
      const card = mounted.host.querySelector('[name="eyesOnAgents__threadCard"]');
      const more = mounted.host.querySelector('button.thread-card__more-control');
      assert.ok(card && more);
      assert.doesNotMatch(card.getAttribute('aria-label') ?? '', /Unread/);
      assert.equal(more.getAttribute('aria-label'), 'More actions');
      assert.equal(more.classList.contains('thread-card__more-control--unread'), false);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('renderer and Main keep their fail-closed Claude Open guards', () => {
    const storeSource = read(
      'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts',
    );
    const serviceSource = read(
      'src/main/eyesOnAgents/eyesOnAgents.service.ts',
    );
    const cardSource = read(
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue',
    );
    const enSource = read('src/renderer/common/i18n/en.ts');
    const zhSource = read('src/renderer/common/i18n/zh.ts');

    assert.match(
      storeSource,
      /thread\.provider === 'claude' && thread\.desktopSessionId === null/,
    );
    assert.match(
      serviceSource,
      /if \(!target\?\.desktopSessionId\) \{\s*throw new Error\('This Claude session is not matched to Claude Desktop'\);/,
    );
    assert.doesNotMatch(cardSource, /claudeDesktopOpenUnavailable/);
    assert.doesNotMatch(enSource, /claudeDesktopOpenUnavailable/);
    assert.doesNotMatch(zhSource, /claudeDesktopOpenUnavailable/);
  });
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__eyesOnAgentsThreadCardHarness;
  browserWindow.close();
}
