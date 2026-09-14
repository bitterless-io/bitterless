/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const mocks = {
  electron: `
    import { EventEmitter } from 'node:events';
    import { pathToFileURL } from 'node:url';
    class WebContents extends EventEmitter {
      url = '';
      destroyed = false;
      loads = [];
      back = false;
      forward = false;
      navigationHistory = {
        canGoBack: () => this.back,
        canGoForward: () => this.forward
      };
      isDestroyed() { return this.destroyed; }
      getURL() { return this.url; }
      setUserAgent() {}
      setWindowOpenHandler() {}
      async loadURL(url) {
        this.url = url;
        this.loads.push(url);
        this.emit('did-navigate', {}, url);
      }
      loadFile(path) { return this.loadURL(pathToFileURL(path).href); }
      close() { this.destroyed = true; }
    }
    export class WebContentsView {
      webContents = new WebContents();
      visible = true;
      bounds = { x: 0, y: 0, width: 0, height: 0 };
      setVisible(visible) { this.visible = visible; }
      setBounds(bounds) { this.bounds = { ...bounds }; }
      getBounds() { return { ...this.bounds }; }
      setBackgroundColor() {}
    }
    export const Menu = {}, clipboard = {};
  `,
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  inversify: 'export const injectable = () => (target) => target; export class Container {}',
  'reflect-metadata': '',
  'electron-xpc/main': `
    export const messages = [];
    export const xpcMain = {
      broadcast(topic, payload) { messages.push({ topic, payload: structuredClone(payload) }); }
    };
    export const createXpcMainEmitter = () => ({ record: async () => {}, updateMetadata: async () => {} });
  `,
  '@maestro-main/capture/debuggerCapture': `
    export class DebuggerCapture {
      attached = false;
      async setInterceptionRules() {}
      async attach() { this.attached = true; }
      async prepareNavigation() { this.attached = true; }
      isSuspended() { return false; }
      isAttached() { return this.attached; }
      detach() { this.attached = false; }
    }
  `,
  '@maestro-main/capture/chromeIdentity':
    'export const chromeIdentity = () => ({ userAgent: "test" });',
  '@maestro-main/drive/replayEngine': 'export class ReplayEngine {}',
  '@maestro-main/settings/coachSettings.service': 'export const normalizeUrl = (url) => url;',
  '@maestro-main/data/maestroDataRoot': 'export const MAESTRO_PARTITION = "test:maestro";'
};

const bundled = await build({
  stdin: {
    contents: `
      export { MaestroBrowserViewService } from './src/main/maestro/windows/main/maestroBrowserView.service.ts';
      export { registerMaestroCompositeTab } from './src/main/maestro/windows/main/compositeTab.registry.ts';
      export { MAESTRO_LOCAL_HOME_DISPLAY_URL } from './src/shared/maestro/coach.api.ts';
      export { messages } from 'electron-xpc/main';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  define: {
    __dirname: JSON.stringify('/test-bundle'),
    'import.meta.env.VITE_MODE': JSON.stringify('release')
  },
  plugins: [
    {
      name: 'maestro-composite-navigation-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'navigation-boundary' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'navigation-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const {
  MaestroBrowserViewService,
  registerMaestroCompositeTab,
  MAESTRO_LOCAL_HOME_DISPLAY_URL,
  messages
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const onlyPreviewUrl = 'bitterless://only-preview';
const webUrl = 'https://example.invalid/docs';
const payloads = (topic) =>
  messages.filter((message) => message.topic === topic).map((message) => message.payload);

const fixture = async (context) => {
  const service = new MaestroBrowserViewService();
  const children = [];
  const lifecycle = [];
  const captureTargets = [];
  const state = {
    browserWindow: {
      contentView: {
        addChildView(view, index) {
          children.push({ view, index });
        },
        removeChildView(view) {
          const index = children.findIndex((entry) => entry.view === view);
          if (index >= 0) children.splice(index, 1);
        }
      },
      getContentSize: () => [1360, 900]
    },
    operationView: null,
    capture: null,
    replayEngine: null,
    currentUrl: '',
    opBounds: { x: 0, y: 78, width: 1360, height: 822 },
    capturing: false,
    captureTargetTabId: null,
    tabsOpenedThisTurn: [],
    browserInterceptionRules: [],
    emitTrace(event) {
      assert.fail(`Unexpected browser trace: ${JSON.stringify(event)}`);
    },
    layout: () => undefined,
    switchCaptureTarget: async (tab) => {
      captureTargets.push(tab.id);
    }
  };
  service.setState(state);
  const container = { visible: false };
  let mountedHost;
  const spec = {
    id: 'onlypreview',
    title: 'OnlyPreview',
    favicon: 'data:image/svg+xml,onlypreview-test',
    displayUrl: onlyPreviewUrl,
    // OnlyPreview binds one workspace and one search runtime, so reopening brings the one tab
    // forward. That reuse is now the SPEC's declaration, not a rule about composite tabs in general
    // — Zellij omits it precisely so several terminals can be open at once.
    singleton: true,
    async open(host) {
      lifecycle.push('open');
      mountedHost = host;
      host.attach(container);
    },
    // Every lifecycle callback is addressed BY HOST: one spec can now carry several live tabs, so a
    // registration that remembered one host would drive the wrong tab.
    close(host) {
      lifecycle.push('close');
      host.detach(container);
    },
    setActive(_host, active) {
      lifecycle.push(active ? 'activate' : 'deactivate');
      container.visible = active;
    },
    refresh() {
      lifecycle.push('refresh');
    }
  };
  registerMaestroCompositeTab(spec);
  service.createPinnedHomeTab();
  await service.loadPinnedHomeTab();
  const home = service.getActiveTab();
  context.after(() => service.reset());
  return {
    service,
    state,
    children,
    lifecycle,
    captureTargets,
    container,
    home,
    host: () => mountedHost
  };
};

const assertNavigation = (fixture, tab, url, title, history) => {
  assert.equal(fixture.state.currentUrl, url);
  assert.deepEqual(payloads('coach/nav'), [url]);
  assert.deepEqual(payloads('coach/title'), [title]);
  assert.deepEqual(payloads('coach/nav-state'), [history]);
  const broadcast = payloads('coach/tabs');
  assert.equal(broadcast.length, 1, 'activation retains the tab strip publication');
  assert.deepEqual(
    broadcast[0].filter((item) => item.active).map((item) => item.id),
    [tab.id]
  );
  const visibleTab = broadcast[0].find((item) => item.id === tab.id);
  assert.equal(visibleTab.url, url);
  assert.equal(visibleTab.title, title);
  assert.equal(visibleTab.debuggerEnabled, tab.kind === 'browser');
  assert.equal(visibleTab.pinned, tab.kind === 'home');
};

for (const origin of ['Home', 'web']) {
  test(`${origin} → OnlyPreview → ${origin} publishes the active identity and preserves the composite mount`, async (context) => {
    const f = await fixture(context);
    let previous = f.home;
    const expectedUrl = origin === 'Home' ? MAESTRO_LOCAL_HOME_DISPLAY_URL : webUrl;
    const expectedTitle = origin === 'Home' ? 'Home' : 'Web documentation';
    const expectedHistory = { canGoBack: origin === 'web', canGoForward: origin === 'web' };
    if (origin === 'web') {
      await f.service.openTab({ url: webUrl });
      previous = f.service.getActiveTab();
      previous.view.webContents.back = true;
      previous.view.webContents.forward = true;
      previous.view.webContents.emit('page-title-updated', {}, expectedTitle);
    }
    assert.equal(f.state.currentUrl, expectedUrl);
    const nativeChildren = f.children.length;
    const previousLoads = [...previous.view.webContents.loads];
    const captureSwitches = f.captureTargets.length;

    messages.length = 0;
    const composite = await f.service.openCompositeTab({ id: 'onlypreview' });
    assertNavigation(f, composite, onlyPreviewUrl, 'OnlyPreview', {
      canGoBack: false,
      canGoForward: false
    });
    assert.equal(f.state.operationView, null);
    assert.equal(f.state.capture, null);
    assert.equal(f.state.replayEngine, null);
    assert.equal(composite.view, null, 'the display URL does not create a web navigation');
    assert.equal(composite.surface, f.container);
    assert.equal(f.children.length, nativeChildren + 1);
    assert.deepEqual(f.children.at(-1), { view: f.container, index: 0 });
    assert.equal(f.host().window(), f.state.browserWindow);
    assert.deepEqual(f.host().contentRect(), f.state.opBounds);
    assert.equal(f.host().isOpen(), true);
    assert.equal(f.container.visible, true);
    assert.equal(previous.view.visible, false);
    assert.equal(
      f.captureTargets.length,
      captureSwitches,
      'composite activation cannot claim a browser debugger'
    );

    messages.length = 0;
    await f.service.activateTab({ id: previous.id });
    assertNavigation(f, previous, expectedUrl, expectedTitle, expectedHistory);
    assert.equal(f.state.operationView, previous.view);
    assert.equal(f.container.visible, false);
    assert.equal(previous.view.visible, true);
    assert.deepEqual(
      previous.view.webContents.loads,
      previousLoads,
      'switching does not reload the outgoing tab'
    );

    f.host().setTitle('OnlyPreview — Project');
    messages.length = 0;
    await f.service.activateTab({ id: composite.id });
    assertNavigation(f, composite, onlyPreviewUrl, 'OnlyPreview — Project', {
      canGoBack: false,
      canGoForward: false
    });
    messages.length = 0;
    assert.equal(await f.service.openCompositeTab({ id: 'onlypreview' }), composite);
    assertNavigation(f, composite, onlyPreviewUrl, 'OnlyPreview — Project', {
      canGoBack: false,
      canGoForward: false
    });
    assert.deepEqual(f.lifecycle, [
      'open',
      'deactivate',
      'activate',
      'deactivate',
      'activate',
      'activate'
    ]);
    assert.equal(f.children.length, nativeChildren + 1, 'reactivation reuses the attached surface');
  });
}
