/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * 独立窗口占着 OnlyPreview 时,那一格 tab 的双态运行时。
 *
 * 方案:docs/features/onlypreview-deferred-tab-placeholder.md。这里跑的是**真的**
 * `onlyPreviewCoworkTab.ts` ＋ `onlyPreviewCoworkMount.ts` ＋ `onlyPreviewDeferredTabSurface.ts`,
 * 只把 electron、maestro 的 host api 与窗口 helper 换成替身 —— 与
 * `onlyPreviewFileTabLifecycle.test.mjs` 同一套加载方式。
 */
const root = resolve(import.meta.dirname, '../..');
const nodeRequire = createRequire(import.meta.url);
const source = (path) => readFileSync(resolve(root, path), 'utf8');
/** 只看**代码**:这些文件的注释里到处是被取代掉的那些名字,那正是它们该在的地方。 */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const loadMain = (path, stubs) => {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function(
    'require',
    'module',
    'exports',
    '__dirname',
    compiled
  )(
    (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith('node:')) return nodeRequire(name);
      throw new Error(`unstubbed import: ${name}`);
    },
    module,
    module.exports,
    '/fixture/main'
  );
  return module.exports;
};

// 替身只记录调用,既不启动 Electron 也不模拟渲染。
class View {
  children = [];
  visible = true;
  bounds = null;
  setVisible(value) {
    this.visible = value;
  }
  setBounds(value) {
    this.bounds = value;
  }
  addChildView(view) {
    this.children.push(view);
  }
  removeChildView(view) {
    this.children = this.children.filter((child) => child !== view);
  }
}

const createdPages = [];
class WebContentsView extends View {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new EventEmitter();
    this.webContents.closed = 0;
    this.webContents.isDestroyed = () => this.webContents.closed > 0;
    this.webContents.close = () => {
      this.webContents.closed += 1;
    };
    this.webContents.focus = () => undefined;
    this.webContents.loadURL = async (url) => {
      this.url = url;
    };
    createdPages.push(this);
  }
}

const harness = () => {
  createdPages.length = 0;
  const fences = [];
  const explicitTargets = [];
  const windowDouble = { contentView: new View(), isDestroyed: () => false };
  const helper = {
    live: null,
    mounts: [],
    getStandaloneHost: () =>
      helper.live ? { hostToken: helper.live.hostToken, hostId: 'only-preview-host' } : null,
    getMountKind: (hostToken) => {
      if (!helper.live || helper.live.hostToken !== hostToken) throw new Error('HOST_NOT_FOUND');
      return helper.live.kind;
    },
    openOnMount: async (mount) => {
      helper.mounts.push(mount);
      mount.attach(new View());
      helper.live = { hostToken: 'cowork-token', kind: 'cowork' };
      return helper.getStandaloneHost();
    }
  };
  const shortcuts = { enrolled: [] };
  const deferredSurfaceStubs = {
    electron: { View, WebContentsView },
    '@electron-toolkit/utils': { is: { dev: false } },
    '@maestro-main/common/shortcutsHelper/shortcuts.helper': {
      enrollMaestroShortcutContents: (contents) => shortcuts.enrolled.push(contents)
    },
    '@main/miniapps/onlypreview/views/onlyPreviewRendererTarget.service': {
      configureOnlyPreviewNavigationFence: (contents, url, allowExternalHttp) =>
        fences.push({ url, allowExternalHttp })
    }
  };
  const deferredSurface = loadMain(
    'src/main/windows/onlyPreviewDeferredTabSurface.ts',
    deferredSurfaceStubs
  );
  const coworkMount = loadMain('src/main/windows/onlyPreviewCoworkMount.ts', {
    electron: { View, WebContentsView },
    '@maestro-main/common/shortcutsHelper/shortcuts.helper':
      deferredSurfaceStubs['@maestro-main/common/shortcutsHelper/shortcuts.helper']
  });
  let spec = null;
  const glue = loadMain('src/main/windows/onlyPreviewCoworkTab.ts', {
    '@maestro-main/windows/main/compositeTab.registry': {
      registerMaestroCompositeTab: (value) => {
        spec = value;
      }
    },
    '@maestro-shared/compositeTab.identity': {
      MAESTRO_ONLY_PREVIEW_TAB_ID: 'onlypreview',
      MAESTRO_ONLY_PREVIEW_DISPLAY_URL: 'bitterless://only-preview'
    },
    '@maestro-shared/compositeTabIcon': { MAESTRO_ICON_ONLY_PREVIEW: '' },
    '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service': {
      openOnlyPreviewAbsoluteTarget: async (path) => explicitTargets.push(path)
    },
    '@main/windows/onlyPreviewWindow.helper': { onlyPreviewWindowHelper: helper },
    '@main/windows/onlyPreviewCoworkMount': coworkMount,
    '@main/windows/onlyPreviewDeferredTabSurface': deferredSurface,
    '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service': {
      onlyPreviewPreviewRegionService: { displayedFilePath: () => '/project/a.md' }
    }
  });
  glue.registerOnlyPreviewCoworkTab();
  const host = {
    instanceId: 'deadbeef0001',
    open: true,
    closes: 0,
    activations: 0,
    attachments: [],
    detachments: [],
    rect: { x: 0, y: 40, width: 1000, height: 700 },
    window: () => windowDouble,
    contentRect: () => host.rect,
    attach: (container) => {
      host.attachments.push(container);
      windowDouble.contentView.addChildView(container);
    },
    detach: (container) => {
      host.detachments.push(container);
      windowDouble.contentView.removeChildView(container);
    },
    activate: () => {
      host.activations += 1;
    },
    close: () => {
      host.closes += 1;
      host.open = false;
    },
    setTitle: () => undefined,
    setDisplayUrl: () => undefined,
    isOpen: () => host.open
  };
  return { glue, spec, helper, host, windowDouble, fences, explicitTargets, shortcuts };
};

/** 独立窗口拿着承载时的那一刻。 */
const withStandaloneWindow = (h) => {
  h.helper.live = { hostToken: 'window-token', kind: 'standalone' };
};

test('a live standalone host makes the tab build a placeholder instead of refusing', async () => {
  const h = harness();
  withStandaloneWindow(h);
  await h.spec.open(h.host);

  assert.equal(h.glue.getOnlyPreviewCoworkTabState(), 'deferred');
  assert.equal(h.helper.mounts.length, 0, '占位态下不建 composite —— 承载还在那个窗口手里');
  assert.equal(h.host.closes, 0, '那一格不许被关掉');
  assert.equal(h.host.attachments.length, 1, '占位 surface 就地装在这一格上');
  assert.equal(h.spec.getDisplayedFile(h.host), null, '占位态下没有在显示任何文件');

  const [page] = createdPages;
  assert.match(page.url, /onlypreview\/detached\/index\.html$/);
  assert.deepEqual(h.fences, [{ url: page.url, allowExternalHttp: false }]);
  assert.deepEqual(page.options.webPreferences.additionalArguments, [
    '--onlypreview-mode=detached'
  ]);
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) {
    assert.equal(page.options.webPreferences[key], true);
  }
  assert.equal(page.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(h.shortcuts.enrolled, [page.webContents], 'Cmd+W 要落在这一格,不是整个窗口');
});

test('the placeholder holds no host token, workspace or file authority', async () => {
  const h = harness();
  withStandaloneWindow(h);
  await h.spec.open(h.host);

  const [page] = createdPages;
  const serialized = JSON.stringify(page.options.webPreferences.additionalArguments);
  for (const forbidden of ['host-token', 'host-id', 'runtime-token', 'broker-capability']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden), `占位页不许拿到 ${forbidden}`);
  }
  // 源码层同一条:这个文件一个字都不许提承载注册表 / 工作区注册表 —— 拿了就会在升格那一刻和真正的
  // 承载抢同一个单例。
  const code = source('src/main/windows/onlyPreviewDeferredTabSurface.ts')
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [
    'onlyPreviewHostRegistry',
    'onlyPreviewWorkspaceRegistry',
    'getOnlyPreviewRendererArguments',
    'hostToken'
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `占位 surface 不许碰 ${forbidden}`);
  }
});

test('destroyHost defers the tab instead of closing it, and promotion puts the composite back', async () => {
  const h = harness();
  await h.spec.open(h.host);
  assert.equal(h.glue.getOnlyPreviewCoworkTabState(), 'live');
  const [mount] = h.helper.mounts;
  h.spec.setActive(h.host, true);

  // 切成独立窗口:`destroyStandalone()` 先 detach,再 `mount.destroyHost()`。
  h.helper.live = null;
  mount.detach();
  mount.destroyHost();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.host.closes, 0, 'G1:undock 一次 closeTab 都没有');
  assert.equal(h.glue.getOnlyPreviewCoworkTabState(), 'deferred');
  const placeholder = createdPages.at(-1);
  assert.match(placeholder.url, /onlypreview\/detached\/index\.html$/);
  const container = h.host.attachments.at(-1);
  assert.equal(container.visible, true, '这一格本来就在前台,换装之后要接着可见');
  assert.deepEqual(container.bounds, { x: 0, y: 40, width: 1000, height: 700 });

  withStandaloneWindow(h);
  h.helper.live = null;
  assert.equal(await h.glue.promoteOnlyPreviewCoworkTab(), true);
  assert.equal(h.glue.getOnlyPreviewCoworkTabState(), 'live');
  assert.equal(placeholder.webContents.closed, 1, '升格之后占位页才被释放');
  assert.equal(h.host.closes, 0);
  assert.equal(
    await h.glue.promoteOnlyPreviewCoworkTab(),
    false,
    '没有占位页就不升格 —— 幂等,而且 G5 靠这一条'
  );
});

test('closing the tab while it is deferred releases the placeholder and promotes nothing', async () => {
  const h = harness();
  withStandaloneWindow(h);
  await h.spec.open(h.host);
  const [page] = createdPages;

  h.spec.close(h.host);

  assert.equal(h.glue.getOnlyPreviewCoworkTabState(), 'none');
  assert.equal(page.webContents.closed, 1);
  assert.deepEqual(h.host.detachments, h.host.attachments);
  assert.equal(await h.glue.promoteOnlyPreviewCoworkTab(), false);
});

test('a deferred tab routes refresh, activation and openTarget without touching the composite', async () => {
  const h = harness();
  withStandaloneWindow(h);
  await h.spec.open(h.host);
  const [page] = createdPages;
  const container = h.host.attachments.at(-1);

  h.spec.setActive(h.host, false);
  assert.equal(container.visible, false);
  h.spec.setActive(h.host, true);
  assert.equal(container.visible, true);
  h.host.rect = { x: 0, y: 40, width: 640, height: 480 };
  h.spec.refresh(h.host);
  assert.deepEqual(container.bounds, { x: 0, y: 40, width: 640, height: 480 });
  assert.deepEqual(page.bounds, { x: 0, y: 0, width: 640, height: 480 });

  // 占位态下目标照旧交给那个活着的承载(那个独立窗口),不是塞进一张纸里。
  await h.spec.openTarget('/outside/report.pdf');
  assert.deepEqual(h.explicitTargets, ['/outside/report.pdf']);
  assert.equal(h.helper.mounts.length, 0);
});

/**
 * 源码守卫。这三条都是「不这么写也不会报错,只会静默退化」的地方:
 *  · undock 路径上再出现 `closeTab` = 旧行为复辟,而 pinned 那一格关不掉,留下一格空白;
 *  · `destroyHost()` 回到 `deps.close()` 同上;
 *  · 「前往」的两条分支少一条:活窗口那一支少了就点了没反应,升格那一支少了就永远回不来。
 */
test('source guards: the undock path closes nothing and Go-to-window has both branches', () => {
  const toggle = source('src/main/windows/onlyPreviewHostToggle.service.ts');
  assert.doesNotMatch(codeOnly(toggle), /closeTab/, 'G1:undock 与 dock 两条路上都不许有 closeTab');
  assert.match(source('src/main/windows/onlyPreviewCoworkMount.ts'), /this\.deps\.defer\(\);/);
  const focus = toggle.slice(toggle.indexOf('async focusStandaloneWindow('));
  const body = focus.slice(0, focus.indexOf('\n  }\n'));
  assert.match(body, /=== 'standalone'\) \{\n\s*onlyPreviewWindowHelper\.show\(\);/, '活窗口 → show + focus');
  assert.match(body, /await this\.promoteDeferredTab\(/, '窗口死了 → 走升格');
  assert.doesNotMatch(
    body,
    /ensureStandalone|openOnlyPreviewWindow/,
    '不许复用 openOnlyPreviewWindow —— 它的冷分支会新建一个窗口'
  );
});

test('source guards: the placeholder stylesheet carries its own border: 0 and background', () => {
  const styles = source('src/renderer/onlypreview/detached/src/App.less');
  const button = styles.slice(styles.indexOf('.onlypreview-detached__focus'));
  assert.match(button, /border: 0;/);
  assert.match(button, /background: var\(--onlypreview-royal\)/);
  // 这个 surface 只加载这一份样式表(`detached/src/main.ts` 里只有 Arco ＋ App.less),所以
  // 「按钮是无边框的」这句话必须在这里成立,不能靠别处继承 —— 2026-09-09 那一例正是这样丢的。
  assert.match(source('src/renderer/onlypreview/detached/src/App.vue'), /@import '\.\/App\.less';/);
});
