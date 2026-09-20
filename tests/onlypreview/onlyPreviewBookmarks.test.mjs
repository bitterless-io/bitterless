/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { test } from 'node:test';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const base = 'src/main/miniapps/onlypreview/';
const shell = 'src/renderer/onlypreview/shell/src/';
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let release;
  const promise = new Promise((done) => { release = done; });
  return { promise, release };
};
const compiled = await build({
  stdin: { contents: [
    "export { OnlyPreviewBookmarksService } from './" + base + "onlyPreviewBookmarks.service.ts';",
    "export { OnlyPreviewHostRegistry } from './" + base + "onlyPreviewHost.registry.ts';",
    "export { OnlyPreviewWorkspaceRegistry } from './" + base + "onlyPreviewWorkspace.registry.ts';"
  ].join('\n'), resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{
    name: 'no-main-content-io',
    setup(context) {
      context.onResolve({ filter: /^(?:node:)?fs(?:\/promises)?$/ }, () => {
        throw new Error('Bookmarks may not read files in Main.');
      });
    }
  }]
});
const { OnlyPreviewBookmarksService, OnlyPreviewHostRegistry, OnlyPreviewWorkspaceRegistry } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

class Storage {
  rows = new Map(); writes = 0; readGate = null;
  async execute(request) {
    const gate = this.readGate; this.readGate = null;
    if (gate) await gate.promise;
    const old = this.rows.get(request.rootRealPath);
    const state = old ? JSON.parse(old) : { revision: 0, entries: [] };
    let entries = state.entries;
    if (request.action === 'add' && !entries.some(e => e.relativePath === request.entry.relativePath)) entries = [...entries, request.entry];
    if (request.action === 'remove') entries = entries.filter(e => e.relativePath !== request.relativePath);
    if (JSON.stringify(entries) !== JSON.stringify(state.entries)) {
      state.entries = entries; state.revision++; this.writes++;
      this.rows.set(request.rootRealPath, JSON.stringify(state));
    }
    return state;
  }
}
const harness = (storage = new Storage(), ready = true) => {
  const hosts = new OnlyPreviewHostRegistry();
  const workspaces = new OnlyPreviewWorkspaceRegistry(hosts);
  const events = [];
  let rejectAuthorization = false;
  let gate = null;
  const service = new OnlyPreviewBookmarksService(workspaces, async (authority) => {
    if (gate) await gate.promise;
    if (rejectAuthorization) throw new Error('Missing file');
    return { nodeKind: authority.relativePath === 'link' ? 'symlink' :
      authority.relativePath.endsWith('.md') ? 'file' : 'directory' };
  }, (...args) => events.push(args));
  service.configureStorage(storage);
  if (ready) service.markStorageReady();
  const host = hosts.issue('standalone', 'content');
  const bind = (path = '/bookmarks/A', owner = host) => {
    const workspace = workspaces.registerValidatedTarget(owner.hostToken, {
      rootRealPath: path, rootName: basename(path), displayPath: path
    });
    workspaces.bindProjectAuthority(owner.hostToken, workspace.workspaceId, 1);
    return { hostToken: owner.hostToken, workspaceId: workspace.workspaceId };
  };
  return { service, storage, hosts, workspaces, host, bind, events,
    missing: () => { rejectAuthorization = true; },
    gate: (value) => { gate = value; } };
};

test('Project-scoped bookmarks survive A/B/A, new host and service restart without duplicate reorder', async () => {
  const h = harness();
  const a = h.bind();
  await h.service.add({ ...a, relativePath: 'notes.md' });
  await h.service.add({ ...a, relativePath: 'docs' });
  await h.service.add({ ...a, relativePath: 'notes.md' });
  assert.equal(h.storage.writes, 2);
  assert.deepEqual((await h.service.snapshot(a)).entries.map((e) => e.nodeKind), ['file', 'directory']);
  assert.deepEqual((await h.service.snapshot(h.bind('/bookmarks/B'))).entries, []);
  const back = await h.service.snapshot(h.bind());
  assert.deepEqual(back.entries.map((e) => e.relativePath), ['notes.md', 'docs']);
  const restarted = harness(h.storage);
  const request = restarted.bind('/bookmarks/A', restarted.hosts.issue('standalone', 'content'));
  assert.deepEqual((await restarted.service.snapshot(request)).entries, back.entries);
  assert.equal(h.events.length, 3);
  assert.equal(h.workspaces.restore(h.host.hostToken).selectedRelativePath, undefined);
});

test('root, traversal, external capabilities and symlinks cannot be added', async () => {
  const h = harness(), request = h.bind();
  for (const path of ['', '..', '../outside.md', '/absolute.md', 'link']) {
    await assert.rejects(h.service.add({ ...request, relativePath: path }));
  }
  const external = h.workspaces.registerExternalPreview(h.host.hostToken, {
    rootRealPath: '/outside', rootName: 'outside', displayPath: '/outside', selectedRelativePath: 'item.md'
  });
  await assert.rejects(h.service.add({ hostToken: h.host.hostToken, ...external }));
  assert.equal(h.storage.writes, 0);
});

test('missing targets remain removable and removal only changes bookmarks', async () => {
  const h = harness(), request = h.bind();
  await h.service.add({ ...request, relativePath: 'notes.md' });
  h.missing();
  await h.service.remove({ ...request, relativePath: 'notes.md' });
  assert.deepEqual((await h.service.snapshot(request)).entries, []);
  assert.equal(h.workspaces.restore(h.host.hostToken).workspaceId, request.workspaceId);
});

test('stale authorization and slow storage reads cannot mutate a replacement Project', async () => {
  const h = harness(), request = h.bind(), gate = deferred();
  h.gate(gate);
  const add = h.service.add({ ...request, relativePath: 'notes.md' });
  const rejected = assert.rejects(add);
  h.bind('/bookmarks/B');
  gate.release(); await rejected;
  assert.equal(h.storage.writes, 0);
  h.gate(null);
  const b = h.bind('/bookmarks/B'), readGate = deferred();
  h.storage.readGate = readGate;
  const removal = assert.rejects(h.service.snapshot(b));
  await tick();
  h.bind('/bookmarks/C'); readGate.release(); await removal;
  assert.equal(h.storage.writes, 0);
});

test('serial writes retain overlapping additions and removals', async () => {
  const h = harness(), request = h.bind();
  await Promise.all(['one.md', 'two.md', 'folder'].map((relativePath) => h.service.add({ ...request, relativePath })));
  assert.deepEqual((await h.service.snapshot(request)).entries.map((e) => e.relativePath),
    ['one.md', 'two.md', 'folder']);
});

test('readiness waits, failed/corrupt storage fails explicitly and failed writes do not poison the queue', async () => {
  const h = harness(new Storage(), false), request = h.bind();
  let completed = false;
  const snapshot = h.service.snapshot(request).then(() => { completed = true; });
  await tick(); assert.equal(completed, false);
  h.service.markStorageReady(); await snapshot;
  await h.service.add({ ...request, relativePath: 'one.md' });
  const key = [...h.storage.rows.keys()][0];
  h.storage.rows.set(key, '{bad');
  await assert.rejects(h.service.add({ ...request, relativePath: 'two.md' }));
  h.storage.rows.delete(key);
  await h.service.add({ ...request, relativePath: 'two.md' });
  assert.equal((await h.service.snapshot(request)).entries[0].name, 'two.md');
  const failed = harness(new Storage(), false);
  failed.service.markStorageFailed();
  await assert.rejects(failed.service.snapshot(failed.bind()), (e) => e.code === 'OPERATION_FAILED');
});

const evaluate = (source, bindings) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(bindings), code)(module, module.exports, ...Object.values(bindings));
  return module.exports;
};
const classText = (path, names) => {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(ts.isClassDeclaration);
  return names ? owner.members.filter((node) => names.includes(node.name?.getText(ast))).map((node) => node.getText(ast)).join('\n')
    : owner.getText(ast);
};
const success = (value) => ({ ok: true, value });
const unwrap = (value) => { if (!value.ok) throw new Error(value.error.message); return value.value; };
test('actual native-menu API cancels without storage reads and removal returns its committed snapshot', async () => {
  let remove = false, reads = 0, writes = 0;
  const committed = { workspaceId: 'A', revision: 2, entries: [] };
  const Handler = evaluate('export class Handler { ' + classText('src/main/xpc/onlyPreview.handler.ts', ['showBookmarkContextMenu', 'removeBookmark']) + ' }', {
    runOperation: (_name, run) => run(), parseOnlyPreviewFileRef: value => value,
    onlyPreviewWorkspaceRegistry: { getProjectAuthorityRootRef: () => ({}) },
    onlyPreviewWindowHelper: { getStandaloneWindow: () => ({}) },
    showOnlyPreviewBookmarkMenu: async () => remove,
    onlyPreviewBookmarksService: { snapshot: async () => { reads++; return committed; }, remove: async () => { writes++; return committed; } }
  }).Handler;
  const api = new Handler(), request = { hostToken: 'host', workspaceId: 'A', relativePath: 'one.md' };
  assert.equal(await api.showBookmarkContextMenu(request), null);
  assert.equal(reads, 0); assert.equal(writes, 0);
  remove = true;
  assert.equal(await api.showBookmarkContextMenu(request), committed);
  assert.equal(reads, 0); assert.equal(writes, 1);
  assert.equal(await api.removeBookmark(request), committed);
  assert.equal(reads, 0); assert.equal(writes, 2);
});
test('committed responses/events apply once without rereads; old reads, failures and A/B responses cannot replace newer state', async () => {
  const first = deferred(), addGate = deferred();
  let project = 'A', loads = 0;
  const Store = evaluate(classText(shell + 'onlyPreviewBookmarks.store.ts'), {
    unwrapOnlyPreviewResult: unwrap, describeOnlyPreviewError: e => e.message,
    xpcRenderer: { subscribe: () => {} }, ONLY_PREVIEW_BOOKMARK_ADD_EVENT: 'add', ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT: 'change', ONLY_PREVIEW_PROJECT_DELETE_EVENT: 'delete'
  }).OnlyPreviewBookmarksStore;
  const snapshot = (revision, names, workspaceId = project) => ({ workspaceId, revision, entries: names.map(name => ({ name, relativePath: name, nodeKind: 'file' })) });
  const client = {
    getBookmarks: async () => { loads++; return first.promise; },
    addBookmark: async () => addGate.promise,
    removeBookmark: async () => ({ ok: false, error: { message: 'write failed' } }),
    showBookmarkContextMenu: async () => success(null)
  };
  const store = new Store(client, { hostId: 'host', hostToken: 'token', workspaceId: () => project });
  store.initialize();
  const adding = store.add('new.md');
  store.receive({ hostId: 'host', ...snapshot(2, ['new.md']) });
  const confirmed = store.entries;
  addGate.release(success(snapshot(2, ['new.md']))); await adding;
  first.release(success(snapshot(0, []))); await tick();
  assert.equal(store.entries, confirmed);
  assert.equal(loads, 1);
  store.receive({ hostId: 'host', ...snapshot(1, ['old.md']) });
  await store.showMenu('new.md');
  assert.equal(loads, 1);
  await store.remove('new.md');
  assert.equal(store.entries, confirmed);
  assert.equal(store.errorMessage, 'write failed');
  const late = deferred(); client.addBookmark = () => late.promise;
  const pending = store.add('late.md');
  project = 'B'; client.getBookmarks = async () => success(snapshot(0, ['B.md']));
  store.resetWorkspace(); await tick();
  late.release(success(snapshot(9, ['late.md'], 'A'))); await pending;
  store.receive({ hostId: 'host', ...snapshot(10, ['late.md'], 'A') });
  assert.equal(store.entries[0].name, 'B.md');
});
test('renderer ignores old Project responses/events and preserves full bookmark names', async () => {
  const first = deferred();
  let project = 'A', loads = 0, additions = 0;
  const Store = evaluate(classText(shell + 'onlyPreviewBookmarks.store.ts'), {
    unwrapOnlyPreviewResult: unwrap, describeOnlyPreviewError: (e) => e.message,
    xpcRenderer: { subscribe: () => {} }, ONLY_PREVIEW_BOOKMARK_ADD_EVENT: 'add', ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT: 'change', ONLY_PREVIEW_PROJECT_DELETE_EVENT: 'delete'
  }).OnlyPreviewBookmarksStore;
  const store = new Store({
    getBookmarks: async ({ workspaceId }) => {
      loads++;
      return workspaceId === 'A' ? first.promise : success({ workspaceId, revision: 0, entries: [{ name: '完整名称.md', relativePath: '完整名称.md', nodeKind: 'file' }] });
    },
    addBookmark: async () => { additions++; return success(); },
    showBookmarkContextMenu: async () => success()
  }, { hostToken: 'token', hostId: 'host', workspaceId: () => project });
  store.initialize(); await tick();
  project = 'B'; store.resetWorkspace(); await tick();
  first.release(success({ workspaceId: 'A', revision: 0, entries: [{ name: 'old' }] })); await tick();
  assert.equal(store.entries[0].name, '完整名称.md');
  store.receive({ hostId: 'host', workspaceId: 'A', relativePath: 'old' }, true);
  store.receive({ hostId: 'other', workspaceId: 'B', relativePath: 'old' }, true);
  assert.equal(additions, 0);
  await store.add(''); assert.equal(additions, 0);
  store.dispose(); const before = loads;
  store.receive({ hostId: 'host', workspaceId: 'B' }); await tick();
  assert.equal(loads, before);
});

test('bookmark files use explicit preview; rapid folders/Project changes fence late reveals', async () => {
  const requests = [], centered = [], selected = [], pending = [];
  const Shell = evaluate('export class Shell { ' + classText(shell + 'onlyPreviewShell.store.ts', ['openBookmark']) + ' }', {
    revealOnlyPreviewGlobalSearchDirectory: async (request) => {
      requests.push(request); const gate = deferred(); pending.push(gate); await gate.promise;
      request.applyResult('projection'); return true;
    },
    describeOnlyPreviewError: (e) => e.message,
    onlyPreviewI18n: { bookmarks: { unavailable: 'missing' } }
  }).Shell;
  const host = new Shell();
  Object.assign(host, {
    bookmarkGeneration: 0, workspace: { workspaceId: 'A' }, treeExpansion: { revision: 1 },
    browseProjection: {}, expandedPaths: new Set(), browseProjectionContext: () => ({}),
    collapseTreeSelection: () => {}, selectFile: async (path) => selected.push(path),
    commitBrowseProjectionResult: (result) => centered.push(result),
    centerTreeRow: (path) => centered.push(path)
  });
  await host.openBookmark({ relativePath: 'one.md', nodeKind: 'file' });
  assert.deepEqual(selected, ['one.md']);
  const first = host.openBookmark({ relativePath: 'first', nodeKind: 'directory' });
  const second = host.openBookmark({ relativePath: 'second', nodeKind: 'directory' });
  pending[1].release(); await second; pending[0].release(); await first;
  assert.deepEqual(centered, ['projection', 'second']);
  const late = host.openBookmark({ relativePath: 'late', nodeKind: 'directory' });
  host.workspace = { workspaceId: 'B' }; pending[2].release(); await late;
  assert.deepEqual(centered, ['projection', 'second']);
  assert.equal(requests[0].isCurrent(), false);
});

test('native bookmark menu removes only on command and settles on dismiss or host close', async () => {
  const window = new EventEmitter(); window.isDestroyed = () => false;
  let template, popup;
  const api = evaluate(read(base + 'onlyPreviewBookmarkMenu.service.ts').replace(/^import .*;\n/gmu, ''), {
    Menu: { buildFromTemplate: (items) => { template = items; return { popup: (options) => { popup = options; } }; } },
    i18nHelper: { getMessages: () => ({ app: { onlyPreviewFileMenu: { removeBookmark: '移除书签' } } }) }
  });
  const clicked = api.showOnlyPreviewBookmarkMenu(window);
  assert.equal(template.length, 1); assert.equal(template[0].label, '移除书签');
  template[0].click(); popup.callback(); assert.equal(await clicked, true);
  const dismissed = api.showOnlyPreviewBookmarkMenu(window); popup.callback(); assert.equal(await dismissed, false);
  const closed = api.showOnlyPreviewBookmarkMenu(window); window.emit('closed'); assert.equal(await closed, false);
  assert.equal(window.listenerCount('closed'), 0);
});

test('Shell focus follows document focus, not selected path or an inner control', () => {
  const source = read(shell + 'App.vue');
  const match = source.match(/const syncShellFocus = ([\s\S]*?);\n/);
  assert.ok(match);
  const focus = { value: false }, document = { hasFocus: () => true };
  const { sync } = evaluate('export const sync = ' + match[1], { shellFocused: focus, document });
  sync(); assert.equal(focus.value, true);
  document.hasFocus = () => false; sync(); assert.equal(focus.value, false);
  for (const event of ['focus', 'blur']) {
    assert.ok(source.includes("window.addEventListener('" + event + "', syncShellFocus)"));
    assert.ok(source.includes("window.removeEventListener('" + event + "', syncShellFocus)"));
  }
});

test('bar/Shell compile, native bounds remain measured, scoped highlights and native menu wiring are shared', async () => {
  for (const file of ['App.vue', 'components/Bookmarks/BookmarkBar.vue']) {
    const filename = resolve(root, shell + file);
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(errors, []);
    const script = compileScript(descriptor, { id: file });
    const template = compileTemplate({
      source: descriptor.template.content, filename, id: file,
      compilerOptions: { bindingMetadata: script.bindings }
    });
    assert.deepEqual(template.errors, []);
    transformSync(script.content, { loader: 'ts' });
  }
  const app = read(shell + 'App.vue');
  assert.ok(app.indexOf('<BookmarkBar />') > app.indexOf('name="onlypreview__projectPanel"'));
  assert.ok(app.indexOf('<BookmarkBar />') < app.indexOf('name="onlypreview__tree"'));
  assert.match(app, /v-show="onlyPreviewRecentsStore.activePanel === 'project'"/);
  assert.match(app, /getBoundingClientRect/);
  assert.match(app, /resizeObserver.observe\(host\)/);
  const css = (await less.render(read(shell + 'App.less'))).css;
  assert.match(css, /onlypreview-shell--focused \.onlypreview-shell__tree-row--selected\s*\{\s*background: #a9c9ff/);
  assert.match(css, /onlypreview-shell__tree-row--selected\s*\{\s*background: #d6e4ff/);
  const bookmarksCss = (await less.render(read(shell + 'components/Bookmarks/BookmarkBar.less'))).css;
  // 最高 320px,超出就滚(Ral 2026-09-09;原来是 `30%`)。下面两条是让"超出就滚"真的成立的部分:
  // 标题行 `flex: 0 0` 所以它不参与滚动,列表 `min-height: 0` 所以这个 flex 子项肯滚 ——
  // 少了 min-height,列表会把容器顶开而不是出现滚动条,而 `overflow-y: auto` 看起来仍然在。
  assert.match(bookmarksCss, /max-height: 320px/);
  assert.match(bookmarksCss, /onlypreview-bookmarks__header\s*\{[^}]*flex: 0 0 22px/);
  assert.match(bookmarksCss, /onlypreview-bookmarks__list\s*\{[^}]*min-height: 0/);
  assert.match(bookmarksCss, /overflow-y: auto/);
  const bar = read(shell + 'components/Bookmarks/BookmarkBar.vue');
  assert.doesNotMatch(bar, /IconBookmark|IconFolder|IconFile/);
  assert.match(bar, /@click.stop="onlyPreviewBookmarksStore.remove\(entry.relativePath\)"/);
  const native = read(base + 'onlyPreviewProjectNativeAction.service.ts');
  assert.match(native.slice(0, native.indexOf('async showProjectRootContextMenu')), /onlypreview-add-bookmark/);
  assert.doesNotMatch(native.slice(native.indexOf('async showProjectRootContextMenu'), native.indexOf('async copyProjectItemFromUi')), /onlypreview-add-bookmark/);
  assert.match(read(base + 'onlyPreviewBookmarks.runtime.ts'), /configureStorage\(onlyPreviewBookmarkStorage\)/);
  assert.doesNotMatch(read('src/main/xpc/onlyPreview.handler.ts'), /onlyPreviewBookmarksService.configureStorage/);
  const startup = read('src/main/app.main.ts') + read('src/main/xpc/onlyPreview.handler.ts');
  assert.match(startup, /onlyPreviewBookmarksService.markStorageReady/);
});

/**
 * **本树里每一个 `IconBtn` 都必须自己写全 `border: 0` ＋ `background`。**
 *
 * Ral 2026-09-09:「不要用这种设计,用 iconbtn 无边框的设计」。他截到的那个带框的 `?` 不是哪个
 * IconBtn 的样式,而是**根本没有样式**:micromeet-cowork 的 IconBtn 是一个 Tailwind `<button>`,
 * 而 `renderer/onlypreview/shell/src/main.ts` 只引 Arco、**不引 Tailwind 那份 css** —— 于是
 * `h-8 w-8 rounded-md …` 全是无意义的类名,按钮退回 Chromium 的 UA 默认样式:灰底 ＋ 1px 边框。
 *
 * 所以「底下那个组件是无边框的」在本树里**不成立**,外观只能由本树的 Less 负责。这条缺陷
 * typecheck 看不见、逐字节漂移检查看不见(两仓的 Less 一模一样,只是渲染结果不同),
 * 也不会在 bitterless 上复现(那边 IconBtn 是 Arco `type="text"`,本来就无框)——
 * **只有跑编译后的 CSS 才抓得到**,这就是这一条守卫。
 */
test('every OnlyPreview IconBtn is borderless in compiled CSS, not by inheritance', async () => {
  const root = 'src/renderer/onlypreview/shell/src/components/';
  // 每一处 `<IconBtn` 的承载类 —— 新增一个 IconBtn 就要在这里登记,否则下一条断言会红。
  const buttons = [
    ['PreviewToolbar/PreviewToolbar', 'onlypreview-preview-toolbar__navigation-button'],
    ['FileActions/FileActions', 'onlypreview-file-actions__button'],
    ['Bookmarks/BookmarkBar', 'onlypreview-bookmarks__hint'],
    ['Bookmarks/BookmarkBar', 'onlypreview-bookmarks__remove']
  ];
  // 登记表必须覆盖全 —— 漏登记一个,它就会带着 UA 默认边框发出去而没人知道。
  // 比的是**类名集合**而不是个数:多个 IconBtn 共用一个类是合法的(PreviewToolbar 的三个导航键
  // 就是同一个 `__navigation-button`),按个数比会把那种正确写法判成漏登记。
  const iconBtnFiles = ['PreviewToolbar/PreviewToolbar', 'FileActions/FileActions', 'Bookmarks/BookmarkBar'];
  for (const file of iconBtnFiles) {
    const vue = read(root + file + '.vue');
    const carried = new Set();
    for (const tag of vue.match(/<IconBtn[\s\S]*?>/g) || []) {
      const cls = tag.match(/class="(onlypreview-[a-z-]+__[a-z-]+)"/);
      assert.ok(cls, file + '.vue 里有一个 IconBtn 没带 onlypreview BEM 类,外观就没法在本树里定住');
      carried.add(cls[1]);
    }
    const registered = new Set(buttons.filter(([owner]) => owner === file).map(([, cls]) => cls));
    assert.deepEqual([...carried].sort(), [...registered].sort(), file + '.vue 的 IconBtn 类与登记表不一致');
  }
  for (const [file, cls] of buttons) {
    const css = (await less.render(read(root + file + '.less'), { filename: file })).css;
    const rules = [...css.matchAll(new RegExp('([^{}]*\\.' + cls + '(?![-\\w])[^{}]*)\\{([^}]*)\\}', 'g'))]
      .filter((match) => !/:(hover|focus|active|disabled)|\[disabled\]/.test(match[1]));
    assert.ok(rules.length > 0, cls + ' 在编译后的 CSS 里没有任何基础规则');
    const body = rules.map((match) => match[2]).join('\n');
    assert.match(body, /border:\s*(?:0|none)/, cls + ' 没有显式去掉边框 —— cowork 上它会是一个带框的 UA 默认按钮');
    assert.match(body, /background:\s*\S/, cls + ' 没有显式背景 —— cowork 上它会带 UA 默认灰底');
  }
});

/**
 * 删掉的文件/目录,书签要跟着走(Ral 2026-09-20)。
 *
 * 三件事一起钉:目录要连子孙一起剪、兄弟前缀不能误伤、以及**代价不随删除规模放大** ——
 * 删一整棵没被收藏的树时一次 IPC 都不发(复用删除那条已有的批量广播,不新增事件)。
 */
test('deleting paths prunes their bookmarks, keeps prefix siblings, and costs nothing when none match', async () => {
  let project = 'A';
  const removed = [];
  const Store = evaluate(classText(shell + 'onlyPreviewBookmarks.store.ts'), {
    unwrapOnlyPreviewResult: unwrap, describeOnlyPreviewError: e => e.message,
    xpcRenderer: { subscribe: () => {} }, ONLY_PREVIEW_BOOKMARK_ADD_EVENT: 'add',
    ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT: 'change', ONLY_PREVIEW_PROJECT_DELETE_EVENT: 'delete'
  }).OnlyPreviewBookmarksStore;
  const entries = ['docs/a.md', 'docs/deep/b.md', 'docs-archive/c.md', 'keep.md'];
  const client = {
    getBookmarks: async () => success({ workspaceId: project, revision: 1, entries: entries.map(name => ({ name, relativePath: name, nodeKind: 'file' })) }),
    addBookmark: async () => success(null),
    removeBookmark: async ({ relativePath }) => { removed.push(relativePath); return success(null); },
    showBookmarkContextMenu: async () => success(null)
  };
  const store = new Store(client, { hostId: 'host', hostToken: 'token', workspaceId: () => project });
  store.initialize();
  await tick();
  assert.equal(store.entries.length, 4, 'fixture bookmarks loaded');

  // 没有任何书签命中 → 一次调用都不该发。
  await store.pruneDeleted({ workspaceId: 'A', relativePaths: ['unrelated/tree', 'other.md'] });
  assert.deepEqual(removed, [], '没命中就不该产生 IPC —— 代价与删除规模无关');

  // 删目录:自身与子孙都剪,`docs-archive/**` 这种兄弟前缀不能被带走。
  await store.pruneDeleted({ workspaceId: 'A', relativePaths: ['docs'] });
  assert.deepEqual(removed.sort(), ['docs/a.md', 'docs/deep/b.md'].sort());
  assert.ok(!removed.includes('docs-archive/c.md'), '兄弟前缀不是子孙');
  assert.ok(!removed.includes('keep.md'));

  // 换了 Project 之后迟到的那一条不该剪新工作区的书签(广播没有重放)。
  removed.length = 0;
  project = 'B';
  await store.pruneDeleted({ workspaceId: 'A', relativePaths: ['keep.md'] });
  assert.deepEqual(removed, [], '跨工作区的迟到事件必须被围栏挡住');
});
