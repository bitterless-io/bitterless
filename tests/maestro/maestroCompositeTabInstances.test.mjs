/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Several tabs of ONE composite mini app, each with its own identity, restored onto their own state.
 *
 * The defect this pins: Zellij's session name is derived from the surface id, and the surface id is
 * the tab's `instanceId`. If two tabs shared an id — or if a restored tab were given a fresh one —
 * two terminals would silently drive the same pane tree, or a restored tab would attach to a
 * stranger's shell. See docs/features/zellij-multi-tab.md.
 */
const root = resolve(import.meta.dirname, '../..');
const mocks = {
  electron: `
    import { EventEmitter } from 'node:events';
    import { pathToFileURL } from 'node:url';
    class WebContents extends EventEmitter {
      url = '';
      destroyed = false;
      loads = [];
      navigationHistory = { canGoBack: () => false, canGoForward: () => false };
      isDestroyed() { return this.destroyed; }
      getURL() { return this.url; }
      setUserAgent() {}
      setWindowOpenHandler() {}
      async loadURL(url) { this.url = url; this.loads.push(url); this.emit('did-navigate', {}, url); }
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
    // Capture what the + menu would show instead of popping a real one.
    export const menus = [];
    export const Menu = {
      buildFromTemplate(template) {
        const built = { template, popped: null, popup(options) { built.popped = options } };
        menus.push(built);
        return built;
      }
    };
    export const clipboard = {};
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
      export { registerMaestroPreviewOpener } from './src/main/maestro/windows/main/previewOpener.registry.ts';
      export { messages } from 'electron-xpc/main';
      export { menus } from 'electron';
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
      name: 'maestro-composite-instances-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'instances-boundary' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'instances-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { MaestroBrowserViewService, registerMaestroCompositeTab, registerMaestroPreviewOpener, messages, menus } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

/**
 * `options`:
 *  · `settings` —— 这台机器 `coach-settings.json` 里已经有的内容,也就是「上一次启动之后」的状态。
 *    固有槽位是**从设置重建**的(pinned tab 不进 tabs 表),所以「重启」在这里就是「拿着上一个
 *    fixture 留下的 settings 再 build 一个 fixture」。
 *  · `refuseZellij` —— Zellij 在 Terminal 开关关着时会合法地拒绝打开。
 *  · `refuseOnlyPreview` —— 默认主页那个 mini app 合法地拒绝(它已经有一个活着的承载)。
 *  · `defaultHome` —— OnlyPreview 声明自己是**默认**固有 tab,也就是 bl 的真实注册形态。
 *    **opt-in**:不开的时候默认固有 tab 仍然是内置本地 Home,这正是 cowork 那一份的形态,
 *    也让本文件其余用例的启动状态一个字不用改。
 *  · `requestTabAlias` —— 别名表单的应答,`null` = 取消。
 */
const fixture = async (context, options = {}) => {
  const service = new MaestroBrowserViewService();
  const opened = [];
  const closed = [];
  const backgrounded = [];
  const workbenchClosed = [];
  const traces = [];
  const settings = { startUrl: '', llmProvider: 'openai-codex', llmModel: 'x', llmEffort: 'low', ...(options.settings || {}) };
  const state = {
    browserWindow: {
      contentView: { addChildView() {}, removeChildView() {} },
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
    emitTrace: (event) => {
      traces.push(event);
    },
    layout: () => undefined,
    newTab: async () => undefined,
    readMaestroSettings: () => settings,
    hasCustomStartUrl: () => false,
    // 与 `coachSettings.service` 的归一同义:空串 = 「没设」,这一格直接不存在。真正那份归一
    // (以及 homeInstanceId / homeAlias 依附于 homeCompositeId 这条)由 check-tab-alias.mjs ⑦ 钉住。
    saveMaestroSettings: (patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === '') delete settings[key];
        else settings[key] = value;
      }
      return settings;
    },
    requestTabAlias: options.requestTabAlias,
    // Picking a mini-app row must send the Workbench back first — it is a foreground VIEW, not an
    // OperationTab, so a tab activated under it reads as "nothing happened".
    backgroundWorkbenchTab: async () => {
      backgrounded.push(Date.now());
    },
    // 摘 chip + 隐藏 view。chip 右键菜单的 `Close` 只能走这条 —— Workbench 不在 `tabs` 里。
    closeWorkbenchTab: async () => {
      workbenchClosed.push(true);
    },
    switchCaptureTarget: async () => undefined
  };
  service.setState(state);
  // A mini app that can have several live tabs at once and wants them back next launch — Zellij's
  // shape. The container it attaches is per-host, which is what a second tab must not steal.
  registerMaestroCompositeTab({
    id: 'zellij',
    title: 'Zellij',
    favicon: '',
    displayUrl: 'bitterless://zellij',
    restorable: true,
    async open(host) {
      opened.push(host.instanceId);
      if (options.refuseZellij) throw new Error('terminal is disabled');
      host.attach({ forInstance: host.instanceId });
    },
    close(host) {
      closed.push(host.instanceId);
    },
    setActive() {},
    refresh() {}
  });
  // ...and one that cannot, to prove the reuse is the SPEC's declaration, not a blanket rule.
  registerMaestroCompositeTab({
    id: 'onlypreview',
    title: 'OnlyPreview',
    favicon: '',
    displayUrl: 'bitterless://only-preview',
    singleton: true,
    ...(options.defaultHome ? { defaultHome: true } : {}),
    async open(host) {
      opened.push(`onlypreview:${host.instanceId}`);
      if (options.refuseOnlyPreview) throw new Error('OnlyPreview already has a live host.');
      host.attach({});
    },
    close() {},
    setActive() {},
    refresh() {}
  });
  service.createPinnedHomeTab();
  await service.loadPinnedHomeTab();
  context.after(() => service.reset());
  return { service, state, settings, opened, closed, backgrounded, workbenchClosed, traces };
};

const latestStrip = () =>
  messages.filter((m) => m.topic === 'coach/tabs').at(-1)?.payload ?? [];

test('a non-singleton mini app opens N tabs, each with its own identity', async (context) => {
  const f = await fixture(context);
  const first = await f.service.openCompositeTab({ id: 'zellij' });
  const second = await f.service.openCompositeTab({ id: 'zellij' });

  assert.notEqual(first.id, second.id, 'the second call must not return the first tab');
  assert.notEqual(first.instanceId, second.instanceId);
  // This is what a Zellij session name is derived from, capped at 48 chars behind a 22-char prefix
  // — a longer id would be truncated and could fold two terminals onto one session.
  for (const tab of [first, second]) assert.match(tab.instanceId, /^[0-9a-f]{12}$/);
  assert.deepEqual(f.opened, [first.instanceId, second.instanceId]);
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 2);

  // A singleton spec still reuses its one tab — the opt-in is what differs, not the machinery.
  const preview = await f.service.openCompositeTab({ id: 'onlypreview' });
  assert.equal(await f.service.openCompositeTab({ id: 'onlypreview' }), preview);
});

test('reopening a KNOWN instance reuses its tab, so restore cannot double a session', async (context) => {
  const f = await fixture(context);
  const tab = await f.service.openCompositeTab({ id: 'zellij' });
  const again = await f.service.openCompositeTab({ id: 'zellij', instanceId: tab.instanceId })
  assert.equal(again, tab, 'the same instance is the same tab, singleton or not');
  assert.equal(f.opened.length, 1, 'the mini app was mounted exactly once');
});

test('a restored tab is rebuilt on its STORED instance id, and stays cold', async (context) => {
  const f = await fixture(context);
  messages.length = 0;
  await f.service.restoreTabs({
    tabs: [
      { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0001' },
      { url: '', title: 'Zellij', favicon: '', position: 1, kind: 'zellij', instanceId: 'deadbeef0002' },
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: '', position: 2 }
    ]
  });
  // Verbatim: a fresh id would attach the restored tab to a stranger's shell, which is worse than
  // not restoring it at all.
  assert.deepEqual(f.opened, ['deadbeef0001', 'deadbeef0002']);
  const restored = f.service.tabs.filter((t) => t.kind === 'zellij');
  assert.deepEqual(
    restored.map((t) => t.instanceId),
    ['deadbeef0001', 'deadbeef0002']
  );
  assert.equal(f.service.tabs.filter((t) => t.kind === 'browser').length, 1, 'URL rows still restore')
  // Cold: the pinned Home tab keeps focus until the renderer's last-active restore runs.
  assert.equal(f.service.getActiveTab().kind, 'home');
  // The renderer persists from the broadcast strip, so both fields have to be on the wire.
  const zellijInfo = latestStrip().filter((t) => t.kind === 'zellij');
  assert.deepEqual(
    zellijInfo.map((t) => [t.instanceId, t.restorable]),
    [
      ['deadbeef0001', true],
      ['deadbeef0002', true]
    ]
  );
});

test('a mini app that refuses to open drops only its own row', async (context) => {
  const f = await fixture(context);
  // Zellij legitimately rejects while the Terminal switch is off; the rest of the strip must live.
  registerMaestroCompositeTab({
    id: 'zellij',
    title: 'Zellij',
    favicon: '',
    displayUrl: 'bitterless://zellij',
    restorable: true,
    open: async () => {
      throw new Error('terminal is disabled');
    },
    close() {},
    setActive() {},
    refresh() {}
  });
  await f.service.restoreTabs({
    tabs: [
      { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0003' },
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: '', position: 1 }
    ]
  });
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 0);
  assert.equal(f.service.tabs.filter((t) => t.kind === 'browser').length, 1, 'the rest of the strip survives');
});

test('the + menu lists every registered mini app, from the registry', async (context) => {
  const f = await fixture(context);
  menus.length = 0;
  await f.service.showNewTabMenu({ x: 120.4, y: 64.6 });
  const menu = menus.at(-1);
  assert.ok(menu, 'a native menu is built in main — an in-renderer one would be painted behind the view');
  assert.deepEqual(
    menu.template.map((item) => item.label ?? item.type),
    ['New tab', 'separator', 'Zellij', 'OnlyPreview']
  );
  assert.deepEqual(menu.popped, { window: f.state.browserWindow, x: 120, y: 65 });

  // Picking a mini-app row opens one — and picking it twice opens a second, which is the whole
  // reason the menu exists (Ral 2026-09-11:「好让我打开多个 zellij tab」).
  await menu.template.find((item) => item.label === 'Zellij').click()
  await menu.template.find((item) => item.label === 'Zellij').click()
  assert.equal(f.service.tabs.filter((t) => t.kind === 'zellij').length, 2);
  assert.equal(f.backgrounded.length, 2, 'each pick sends the Workbench back before opening');
});

/**
 * 固有槽位那个 tab 的**身份**与**名字**跨重启还在。
 *
 * 这一组钉的是同一个根因的两半:固有 tab 是 `pinned` 的,而 pinned tab 按设计不进 SavedTab
 * (`tab.store.ts` 的 `isRestorableComposite` 要求 `!t.pinned` —— 那条过滤不许放松,放松了固有
 * tab 会在启动时被 restore 再开一份)。于是这一格身上的一切都只能从 `coach-settings.json` 重建:
 *  · 少存 `homeInstanceId` ⇒ 下次启动按 spec id 推导一个身份,设主页那一刻装在里面的那条 Zellij
 *    会话既不被接管也不被关掉 —— 每设一次主页留一条孤儿;
 *  · 少存 `homeAlias` ⇒ 用户起的名字静默消失,而 `Set as homepage` 还顺手关掉了旧的 Home tab,
 *    连第二份带着名字的副本都不存在(docs/features/tab-alias.md G5)。
 */
test('promoting a mini app to the homepage records ITS session and name — both come back next boot', async (context) => {
  const f = await fixture(context, { requestTabAlias: async () => 'left pane' });
  const tab = await f.service.openCompositeTab({ id: 'zellij' });
  // 先起名再设为主页 —— 契约点名的正是这条路径(`Alias…` 在这个 tab 上是开着的)。
  await f.service.promptTabAlias(tab.id);
  assert.equal(tab.alias, 'left pane');

  await f.service.setAsHomepage(tab.id);
  assert.equal(f.settings.homeCompositeId, 'zellij');
  assert.equal(
    f.settings.homeInstanceId,
    tab.instanceId,
    'the tab\'s ACTUAL instance id — a sha-derived one would orphan the session that is in the slot right now'
  );
  assert.equal(f.settings.homeAlias, 'left pane');

  // 「重启」= 拿着同一份设置重建一次。
  const next = await fixture(context, { settings: { ...f.settings } });
  const pinned = next.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'zellij');
  assert.equal(pinned.instanceId, tab.instanceId);
  assert.equal(pinned.alias, 'left pane');
  assert.deepEqual(next.opened, [tab.instanceId], 'the slot reattaches to the very session it was pinned with');
});

test('renaming the tab that is ALREADY the homepage survives a restart too', async (context) => {
  const f = await fixture(context, {
    settings: { homeCompositeId: 'zellij', homeInstanceId: 'deadbeef0006', homeAlias: 'old name' },
    requestTabAlias: async () => 'new name'
  });
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.alias, 'old name');
  // 晋升那一刻落一次不够:设为主页**之后**再改名走的是 promptTabAlias,不补写就重启即失。
  await f.service.promptTabAlias(pinned.id);
  assert.equal(pinned.alias, 'new name');
  assert.equal(f.settings.homeAlias, 'new name');

  const next = await fixture(context, { settings: { ...f.settings } });
  assert.equal(next.service.tabs.find((t) => t.pinned).alias, 'new name');
});

test('a setting written before homeInstanceId existed still boots — on the derived id', async (context) => {
  // 存量兜底:派生值保证每次启动稳定(不会每启动一次多一条会话),只是跟晋升那一刻的会话对不上。
  const f = await fixture(context, { settings: { homeCompositeId: 'zellij' } });
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.match(pinned.instanceId, /^[0-9a-f]{12}$/);
  assert.equal(pinned.alias, undefined);
  const again = await fixture(context, { settings: { homeCompositeId: 'zellij' } });
  assert.equal(again.service.tabs.find((t) => t.pinned).instanceId, pinned.instanceId, 'stable across launches');
});

test('Restore default homepage clears all three settings, not just the id', async (context) => {
  const f = await fixture(context, {
    settings: { homeCompositeId: 'zellij', homeInstanceId: 'deadbeef0007', homeAlias: 'left pane' }
  });
  await f.service.restoreDefaultHomepage();
  assert.equal(f.service.tabs.find((t) => t.pinned).kind, 'home');
  // 留下任何一格,下一次设主页都会捡到上一任的会话或名字。
  assert.deepEqual(
    [f.settings.homeCompositeId, f.settings.homeInstanceId, f.settings.homeAlias],
    [undefined, undefined, undefined]
  );
});

/**
 * 默认固有 tab —— bl 装 OnlyPreview,cowork 仍然装内置本地 Home。
 *
 * 「默认值」住在 registry(`spec.defaultHome`)而不是一份默认设置里,所以这一组的判据总是成对:
 * **槽位装的是谁** ＋ **设置里有没有被写进东西**。写进去了的话,「还原默认主页」清空之后又得
 * 立刻写回默认值,清空就变成假的(docs/features/onlypreview-default-homepage.md #1)。
 */
test('a machine that never set a homepage gets the registry default, and the setting stays absent', async (context) => {
  const f = await fixture(context, { defaultHome: true });
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'onlypreview');
  assert.equal(f.service.tabs.length, 1, '条上仍然恰好一个固有 tab');
  assert.equal(pinned.view, null, 'mini app 那一格没有 WebContentsView');
  assert.deepEqual(f.opened, [`onlypreview:${pinned.instanceId}`], '默认那一格是真的挂起来了');
  assert.equal(f.settings.homeCompositeId, undefined, '默认值不落盘 —— 否则「还原默认」清空即失效');
});

test('no spec declares itself the default → the pinned slot is the built-in Home, verbatim as before', async (context) => {
  const f = await fixture(context);
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'home');
  assert.ok(pinned.view, 'the built-in Home carries a real view');
});

test('a homepage the user set wins over the registry default', async (context) => {
  const f = await fixture(context, { defaultHome: true, settings: { homeCompositeId: 'zellij' } });
  assert.equal(f.service.tabs.find((t) => t.pinned).kind, 'zellij');
});

/**
 * 默认那一格不许改名;显式设成主页之后才可以。
 *
 * 判据是**设置里写没写过**,不是「装的是不是默认那个 mini app」——`coachSettings.service` 的归一
 * 在 `homeCompositeId` 为空时会把 `homeAlias` 一起丢掉,所以允许默认那一格改名 = 允许一个
 * 改完就丢的名字,而且两边都不报错(onlypreview-default-homepage.md #2)。
 */
test('the DEFAULT pinned slot cannot be renamed or restored; an explicitly set one can', async (context) => {
  const f = await fixture(context, { defaultHome: true });
  const pinnedId = f.service.tabs.find((t) => t.pinned).id;
  menus.length = 0;
  await f.service.showTabMenu({ id: pinnedId });
  const byDefault = Object.fromEntries(
    menus.at(-1).template.filter((item) => item.label).map((item) => [item.label, item.enabled])
  );
  assert.equal(byDefault['Alias…'], false, '名字来自 registry,改了也存不住');
  assert.equal(byDefault['Restore default homepage'], false, '已经是默认值,这一项点下去什么都不会变');

  // 同一个 mini app,这次是用户自己选进来的 —— 两项都该开。
  const explicit = await fixture(context, {
    defaultHome: true,
    settings: { homeCompositeId: 'onlypreview', homeInstanceId: 'deadbeef0009' }
  });
  menus.length = 0;
  await explicit.service.showTabMenu({ id: explicit.service.tabs.find((t) => t.pinned).id });
  const bySetting = Object.fromEntries(
    menus.at(-1).template.filter((item) => item.label).map((item) => [item.label, item.enabled])
  );
  assert.equal(bySetting['Alias…'], true);
  assert.equal(bySetting['Restore default homepage'], true);
});

test('Restore default homepage restores the REGISTRY default, not the built-in Home', async (context) => {
  const f = await fixture(context, {
    defaultHome: true,
    settings: { homeCompositeId: 'zellij', homeInstanceId: 'deadbeef000a', homeAlias: 'left pane' }
  });
  const previous = f.service.tabs.find((t) => t.pinned);
  await f.service.restoreDefaultHomepage();

  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'onlypreview', '还原到的是新的默认值 —— 回内置 Home 的话这一发与下次启动两种说法');
  assert.equal(pinned.alias, undefined, '这一格现在装的是默认那个,名字归 registry');
  assert.equal(previous.pinned, false, '旧主页降级成普通 tab —— 它身上有用户的状态,不该被杀');
  assert.ok(f.service.tabs.includes(previous));
  assert.deepEqual(
    [f.settings.homeCompositeId, f.settings.homeInstanceId, f.settings.homeAlias],
    [undefined, undefined, undefined]
  );
});

test('restoring promotes the default mini app that is ALREADY open instead of opening a second one', async (context) => {
  const f = await fixture(context, {
    defaultHome: true,
    settings: { homeCompositeId: 'zellij', homeInstanceId: 'deadbeef000b' }
  });
  const preview = await f.service.openCompositeTab({ id: 'onlypreview' });
  const mountsBefore = f.opened.filter((id) => id.startsWith('onlypreview:')).length;

  await f.service.restoreDefaultHomepage();

  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.id, preview.id, 'the tab that was already carrying OnlyPreview is the one promoted');
  assert.equal(f.service.tabs.indexOf(pinned), 0, '固有槽位是最左那一格');
  assert.equal(f.service.tabs.filter((t) => t.pinned).length, 1, '零 pinned 与两个 pinned 都不许留下');
  assert.equal(
    f.opened.filter((id) => id.startsWith('onlypreview:')).length,
    mountsBefore,
    'OnlyPreview 是 singleton:再挂一次拿不到内容,条上会多一格空白'
  );
});

/**
 * 默认那个 mini app 拒绝打开 → 这一发降级成内置本地 Home。
 *
 * 真实触发是 OnlyPreview 已经在独立窗口里:它只认一个活着的承载,所以 spec 的 `open` 会抛
 * (onlypreview-default-homepage.md #4)。和 Zellij 那一条同一条兜底,区别只在这次设置里**本来
 * 就是空的** —— 兜底不许顺手写点什么进去,否则下次启动就再也不试默认值了。
 */
test('the DEFAULT mini app refusing to open falls back to the built-in Home for that boot', async (context) => {
  const f = await fixture(context, { defaultHome: true, refuseOnlyPreview: true });
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'home');
  assert.equal(f.service.tabs.length, 1, '不空条');
  assert.equal(pinned.view.visible, true, '这一格是降级时新建的,可见性要自己补');
  assert.equal(f.settings.homeCompositeId, undefined, '兜底不写设置 —— 下次启动照样再试默认值');
  const refusal = f.traces.find((event) => event.msg.includes('refused to open'));
  assert.match(refusal.msg, /onlypreview/);
  assert.match(refusal.msg, /already has a live host/);
});

/**
 * 自定义主页装不起来时,这一发启动退回内置本地 Home。
 *
 * Zellij 在 Terminal 开关关着时**合法地**拒绝打开。抛出去的代价不只是「主页没装起来」:启动链上
 * `openStartupTabIfNeeded` 挂在同一个 promise 的 `.then()` 上,会被一起跳过,而条上那唯一的固有
 * tab 没有任何内容 —— 用户看到一条空条,身后没有可回落的 Home(custom-homepage-tab.md A6)。
 */
test('a homepage mini app that refuses to open falls back to the built-in Home for that boot', async (context) => {
  const f = await fixture(context, {
    refuseZellij: true,
    settings: { homeCompositeId: 'zellij', homeInstanceId: 'deadbeef0008', homeAlias: 'left pane' }
  });
  const pinned = f.service.tabs.find((t) => t.pinned);
  assert.equal(pinned.kind, 'home', 'the slot lands on the built-in Home rather than staying contentless');
  assert.equal(f.service.tabs.length, 1, '不空条:固有槽位仍然恰好一个 tab');
  assert.ok(pinned.view, 'the fallback Home has a real view');
  assert.equal(pinned.view.visible, true, '启动链只显 createPinnedHomeTab() 返回的那个 view,这一个要自己显');
  assert.equal(pinned.alias, undefined, '这一格现在装的是内置 Home,名字归 registry');
  // 设置一个字不动:拒绝的原因通常可恢复(把 Terminal 开关打开),下次启动还要再试它。
  assert.equal(f.settings.homeCompositeId, 'zellij');
  assert.equal(f.settings.homeAlias, 'left pane');
  const refusal = f.traces.find((event) => event.msg.includes('refused to open'));
  assert.ok(refusal, 'the trace has to name which mini app refused, and why');
  assert.match(refusal.msg, /zellij/);
  assert.match(refusal.msg, /terminal is disabled/);
});


test('file previews create independent tabs without replacing OnlyPreview or entering app restoration', async (context) => {
  const { service, backgrounded } = await fixture(context);
  const project = await service.openCompositeTab({ id: 'onlypreview' });
  const closed = [];
  registerMaestroPreviewOpener({
    createFileTabSpec: (path) => ({
      id: 'file', title: path.split('/').at(-1), favicon: '', displayUrl: 'file://' + path,
      open: async (host) => host.attach({ path }),
      close: () => closed.push(path), setActive() {}, refresh() {}
    })
  });
  await service.openFilePreviewTab({ path: '/outside/a.md' });
  await service.openFilePreviewTab({ path: '/outside/b.docx' });
  const files = service.tabs.filter((tab) => tab.kind === 'file');
  assert.equal(files.length, 2);
  assert.notEqual(files[0].instanceId, files[1].instanceId);
  assert.equal(files[0].surface.path, '/outside/a.md');
  assert.equal(files[1].surface.path, '/outside/b.docx');
  assert.equal(service.tabs.includes(project), true);
  assert.equal(service.activeTabId, files[1].id);
  assert.equal(backgrounded.length, 2);
  assert.equal(Boolean(latestStrip().find((tab) => tab.id === files[0].id).restorable), false);
  await service.closeTab({ id: files[0].id });
  assert.deepEqual(closed, ['/outside/a.md']);
  assert.equal(service.tabs.includes(files[1]), true);
  registerMaestroPreviewOpener(null);
});

test('address-bar component previews reuse the initiating New Tab slot and reject a closed slot', async (context) => {
  const { service } = await fixture(context);
  registerMaestroPreviewOpener({
    createFileTabSpec: (path) => ({
      id: 'file', title: path.split('/').at(-1), favicon: '', displayUrl: 'file://' + path,
      open: async (host) => host.attach({ path }), close() {}, setActive() {}, refresh() {}
    })
  });
  await service.newTab();
  const initiating = service.tabs.find((tab) => tab.id === service.activeTabId);
  const count = service.tabs.length;
  assert.equal(initiating.kind, 'browser');
  await service.openFilePreviewTab({ path: '/outside/report.docx', tabId: initiating.id });
  assert.equal(service.tabs.length, count);
  assert.equal(service.activeTabId, initiating.id);
  assert.equal(initiating.kind, 'file');
  assert.equal(initiating.surface.path, '/outside/report.docx');
  await assert.rejects(service.openFilePreviewTab({ path: '/outside/late.md', tabId: 'closed-tab' }), /no longer available/);
  assert.equal(service.tabs.length, count);
  registerMaestroPreviewOpener(null);
});

/**
 * 右击 Workbench chip —— Ral 2026-09-16:「workbench 右击应该有和 mini app 右击一样的菜单」。
 *
 * 这一组钉的是**逐项对齐**,不是「有个菜单就行」:两份模板的标签与分隔符序列必须字字相同,
 * 差别只许出现在哪几项是亮的。Workbench 不在 `this.tabs` 里,所以它走的是自己那条
 * `showWorkbenchTabMenu()`;`showTabMenu({ id })` 对它永远找不到。
 */
const labelsOf = () => menus.at(-1).template.map((item) => item.label ?? '---');
const enabledOf = () => Object.fromEntries(
  menus.at(-1).template.filter((item) => item.label).map((item) => [item.label, item.enabled !== false])
);

test('the Workbench chip menu is the mini-app menu with the inapplicable rows greyed, not hidden', async (context) => {
  const f = await fixture(context);
  const miniapp = await f.service.openCompositeTab({ id: 'zellij' });

  menus.length = 0;
  await f.service.showTabMenu({ id: miniapp.id });
  const miniappLabels = labelsOf();

  menus.length = 0;
  await f.service.showWorkbenchTabMenu();
  assert.deepEqual(labelsOf(), miniappLabels, '同一份模板、同一个顺序、同一批分隔符');

  assert.deepEqual(enabledOf(), {
    'New tab': true,
    // 五项灰的,各有理由(docs/issues/maestro-workbench-chip-divider-and-menu.md)——
    // 置灰而不是隐藏:「为什么不能点」要看得见。
    Reload: false,
    Duplicate: false,
    'Alias…': false,
    'Set as homepage': false,
    'Restore default homepage': false,
    Close: true,
    'Close other tabs': true,
    'Close tabs to the right': true
  });
});

test('Workbench Close hides the view instead of closing a tab, and the two close-batch rows share one scope', async (context) => {
  const f = await fixture(context);
  const first = await f.service.openCompositeTab({ id: 'zellij' });
  const second = await f.service.openCompositeTab({ id: 'zellij' });
  const pinnedId = f.service.tabs.find((tab) => tab.pinned).id;

  menus.length = 0;
  await f.service.showWorkbenchTabMenu();
  const byLabel = Object.fromEntries(menus.at(-1).template.filter((item) => item.label).map((item) => [item.label, item]));

  // `Close` 摘 chip + 隐藏 view —— 一个 operation tab 都不许关掉。
  byLabel.Close.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.workbenchClosed, [true]);
  assert.equal(f.service.tabs.length, 3);

  // chip 锚在 pinned 组正后方,所以「其余」与「右边的」是同一个集合:全部可关闭的 tab。
  byLabel['Close tabs to the right'].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.service.tabs.map((tab) => tab.id), [pinnedId]);
  assert.equal(f.service.tabs.includes(first) || f.service.tabs.includes(second), false);

  // 没有可关闭的 tab 了 —— 两项置灰,`Close` 仍然亮着(chip 自己永远关得掉)。
  menus.length = 0;
  await f.service.showWorkbenchTabMenu();
  const after = enabledOf();
  assert.equal(after['Close other tabs'], false);
  assert.equal(after['Close tabs to the right'], false);
  assert.equal(after.Close, true);
});

/**
 * 关闭范围在**点的那一刻**重算。
 *
 * agent 会在后台开关 tab:一份建菜单时抓下来的 id 列表,等人点下去可能已经过期 —— 少关一个,
 * 或者对着一个已经不在的 id 关。
 */
test('the Workbench close-batch scope is recomputed on click, not captured when the menu is built', async (context) => {
  const f = await fixture(context);
  menus.length = 0;
  await f.service.showWorkbenchTabMenu();
  const closeOthers = menus.at(-1).template.find((item) => item.label === 'Close other tabs');

  // 菜单已经建好了,agent 这时候才开出这个 tab。
  const late = await f.service.openCompositeTab({ id: 'zellij' });
  closeOthers.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.service.tabs.includes(late), false, '建菜单之后开的 tab 也在范围里');
  assert.equal(f.service.tabs.every((tab) => tab.pinned), true);
});
