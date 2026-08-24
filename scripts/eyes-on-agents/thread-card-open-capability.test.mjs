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
  const calls = { open: [], readState: [], copyPath: [] };
  return {
    calls,
    busyAction: null,
    openingSessionKeys: new Set(),
    openThread: async (sessionKey) => calls.open.push(sessionKey),
    setThreadUnread: async (sessionKey, isUnread) => calls.readState.push([sessionKey, isUnread]),
    copySessionPath: async (sessionKey) => calls.copyPath.push(sessionKey),
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
  canCopySessionPath: true,
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
    .find((element) => /Copy session path|Mark as (read|unread)|Open in/.test(
      element.textContent ?? '',
    ));
  const optionTexts = (dropdown) => [...dropdown.querySelectorAll('.arco-dropdown-option')]
    .map((element) => element.textContent?.replace(/\s+/gu, ' ').trim() ?? '');
  const clickOption = async (dropdown, pattern) => {
    const option = [...dropdown.querySelectorAll('.arco-dropdown-option')]
      .find((element) => pattern.test(element.textContent ?? ''));
    assert.ok(option, `Missing dropdown option matching ${pattern}`);
    option.click();
    await nextTick();
  };

  await test('an openable card keeps its gestures and moves Open into the menu', async () => {
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
      const more = document.querySelector('button.thread-card__more-control');

      assert.ok(card);
      assert.equal(card.getAttribute('tabindex'), '0', 'an openable card stays keyboard focusable');
      assert.equal(
        document.querySelector('.thread-card__open-control'),
        null,
        'the icon-only Open button is retired',
      );
      assert.ok(more, 'every card owns the overflow menu');
      assert.equal(more.getAttribute('aria-label'), 'More actions');
      if (thread.isUnread) {
        assert.match(card.getAttribute('aria-label') ?? '', /Unread/);
        const status = document.querySelector('.thread-card__status[role="img"]');
        assert.ok(status, 'the unread dot lives in the title status slot');
        assert.equal(status.getAttribute('aria-label'), 'Unread');
        assert.equal(document.querySelectorAll('.thread-card__unread-dot').length, 1);
      }
    }
  });

  await test('a routeless Claude row keeps unread and its session path without an open path', async () => {
    const document = await render(createThread({ isUnread: true }));
    const card = document.querySelector('[name="eyesOnAgents__threadCard"]');
    const more = document.querySelector('button.thread-card__more-control');

    assert.ok(card);
    assert.equal(card.hasAttribute('tabindex'), false, 'a routeless row is not openable');
    assert.equal(document.querySelector('.thread-card__open-control'), null);
    assert.match(card.getAttribute('aria-label') ?? '', /Unread/);
    assert.ok(more, 'the overflow menu still hosts the read-state action');
    const status = document.querySelector('.thread-card__status[role="img"]');
    assert.ok(status, 'unread attention survives without any open affordance');
    assert.equal(document.querySelectorAll('.thread-card__unread-dot').length, 1);

    const cardSource = read(
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue',
    );
    const cardStyles = read(
      'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less',
    );
    assert.match(
      cardSource,
      /v-if="thread\.canCopySessionPath"[\s\S]*?handleCopySessionPath/,
      'the copy item is gated on the snapshot capability',
    );
    assert.doesNotMatch(
      cardSource,
      /previewThread|previewTranscript|previewingSessionKeys/,
      'transcript preview is gone from the card',
    );
    assert.match(cardSource, /const handleOpen[\s\S]*?if \(!canOpenThread\.value\) return;/);
    assert.match(cardSource, /const handleDoubleClick[\s\S]*?await handleOpen\(\);/);
    assert.doesNotMatch(
      cardSource,
      /thread-card__unread-marker|more-control--unread|IconExternalLink :size="9"/,
      'the retired dot hosts and the Open button are gone',
    );
    assert.doesNotMatch(
      cardStyles,
      /more-control--unread|unread-marker|thread-card__working/,
      'the retired dot styles are gone with them',
    );
  });

  await test('the read-state toggle is offered on every card and reports the stored flag', async () => {
    const unreadRow = createThread({ isUnread: true, canCopySessionPath: false });
    let mounted = await mount(unreadRow);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown, 'a card with no Open and no Preview still opens its menu');
      assert.deepEqual(optionTexts(dropdown), ['Mark as read']);
      await clickOption(dropdown, /Mark as read/);
      assert.deepEqual(
        mounted.store.calls.readState,
        [[unreadRow.sessionKey, false]],
        'an unread row is acknowledged',
      );
      assert.deepEqual(mounted.store.calls.open, []);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    const readRow = createThread({ canCopySessionPath: false });
    mounted = await mount(readRow);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown);
      assert.deepEqual(optionTexts(dropdown), ['Mark as unread']);
      await clickOption(dropdown, /Mark as unread/);
      assert.deepEqual(
        mounted.store.calls.readState,
        [[readRow.sessionKey, true]],
        'a read row can be re-flagged',
      );
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    const workingRow = createThread({
      runtimeState: 'working',
      isUnread: true,
      canCopySessionPath: false,
    });
    mounted = await mount(workingRow);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown);
      assert.deepEqual(
        optionTexts(dropdown),
        ['Mark as read'],
        'the label follows the stored flag even while no dot is visible',
      );
      assert.equal(
        mounted.host.querySelector('.thread-card__unread-dot'),
        null,
        'an active row shows its spinner instead of the latent dot',
      );
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }
  });

  await test('the menu names the provider it opens and discloses the double-click', async () => {
    const cliThread = createThread({ isUnread: true });
    let mounted = await mount(cliThread);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown, 'CLI-only More must open its Arco Dropdown');
      assert.deepEqual(
        optionTexts(dropdown),
        ['Mark as read', 'Copy session path'],
        'a routeless Claude row offers no open item',
      );
      assert.deepEqual(mounted.store.calls.open, [], 'More must not bubble into card Open');
      await clickOption(dropdown, /Copy session path/);
      assert.deepEqual(mounted.store.calls.copyPath, [cliThread.sessionKey]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    const desktopClaude = createThread({
      desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    mounted = await mount(desktopClaude);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown);
      assert.deepEqual(
        optionTexts(dropdown),
        ['Open in Claude (double click)', 'Mark as unread', 'Copy session path'],
        'the open item leads, names Claude, and discloses the gesture',
      );
      await clickOption(dropdown, /Open in Claude/);
      assert.deepEqual(mounted.store.calls.open, [desktopClaude.sessionKey]);
    } finally {
      mounted.app.unmount();
      document.body.innerHTML = '';
    }

    const codexThread = createThread({
      sessionKey: 'codex:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      provider: 'codex',
      canCopySessionPath: false,
    });
    mounted = await mount(codexThread);
    try {
      await openMore(mounted.host);
      const dropdown = activeDropdown();
      assert.ok(dropdown, 'a Codex card owns a menu too');
      assert.deepEqual(
        optionTexts(dropdown),
        ['Open in Codex (double click)', 'Mark as unread'],
        'a Codex row names Codex and exposes no session file path',
      );
      await clickOption(dropdown, /Open in Codex/);
      assert.deepEqual(mounted.store.calls.open, [codexThread.sessionKey]);
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
        rendered.querySelector('.thread-card__status[role="status"] svg, .thread-card__status[role="status"] [role="img"]'),
        `${runtimeState} must render the active response spinner`,
      );
      assert.ok(rendered.querySelector('.thread-card__status[role="status"]'));
    }
    const idle = await render(createThread({
      desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }));
    assert.equal(idle.querySelector('.thread-card__status[role="status"]'), null);
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
      assert.equal(rendered.querySelector('.thread-card__status[role="status"]'), null);
    }

    const unknownUnread = await render(createThread({
      runtimeState: 'unknown',
      isUnread: true,
      desktopSessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }));
    assert.equal(
      unknownUnread.querySelectorAll('.thread-card__unread-dot').length,
      1,
      'an authority-lost unread row must explain why it sits in the unread tier',
    );
    assert.equal(unknownUnread.querySelector('.thread-card__status[role="status"]'), null);

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
        rendered.querySelector('.thread-card__status[role="status"]'),
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
