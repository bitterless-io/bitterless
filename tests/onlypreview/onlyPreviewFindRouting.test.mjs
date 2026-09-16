/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const menuSource = read('src/main/menu/applicationFindMenu.service.ts');
const helperSource = read('src/main/windows/onlyPreviewWindow.helper.ts');
const helperAst = ts.createSourceFile('helper.ts', helperSource, ts.ScriptTarget.Latest, true);
const helperClass = helperAst.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === 'OnlyPreviewWindowHelper');
const methodNames = [
  'bindNativeShortcuts', 'executeNativeCommand', 'runMenuFindCommand',
  'resolveFocusedOrigin', 'getStandaloneHost', 'resolveNativeCommand'
];
const methods = methodNames.map((name) => {
  const method = helperClass.members.find((node) => node.name?.getText(helperAst) === name);
  assert.ok(method, `missing ${name}`);
  return method.getText(helperAst);
}).join('\n');
const predicateNames = [
  'isCommandModifier', 'isGlobalSearchShortcut', 'isCurrentFileFindShortcut', 'isProjectItemCopyShortcut'
];
const predicates = helperAst.statements.filter((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    predicateNames.includes(declaration.name.getText(helperAst))
  )).map((node) => node.getText(helperAst)).join('\n');
const compile = (source) => {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true
  });
  assert.deepEqual(result.diagnostics, []);
  return result.outputText;
};
const menuCode = compile(menuSource);
const helperCode = compile(`${predicates}\nclass OnlyPreviewWindowHelper {${methods}}`);
const fileTabPath = existsSync(resolve(root, 'src/main/windows/onlyPreviewFileTab.service.ts'))
  ? 'src/main/windows/onlyPreviewFileTab.service.ts'
  : 'src/main/miniapps/onlypreview/host/onlyPreviewFileTab.service.ts';
const fileTabAst = ts.createSourceFile(fileTabPath, read(fileTabPath), ts.ScriptTarget.Latest, true);
const fileTabClass = fileTabAst.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === 'OnlyPreviewFileTabSurface');
assert.ok(fileTabClass);
const fileTabCode = compile(fileTabClass.getText(fileTabAst).replace(/^export /u, ''));

// Use the actual menu dispatcher, ownership predicate and native methods. Only Electron objects
// and the preview region's rendering side effects are fakes; no Electron process is launched.
const harness = ({ kind = 'cowork', platform = 'darwin' } = {}) => {
  let focused = null;
  let focusedWindow;
  let nextId = 0;
  const contents = (hostWebContents = null) => {
    const value = new EventEmitter();
    value.id = ++nextId;
    value.hostWebContents = hostWebContents;
    value.destroyed = false;
    value.focusCount = 0;
    value.isDestroyed = () => value.destroyed;
    value.focus = () => { value.focusCount++; focused = value; };
    value.close = () => { value.destroyed = true; };
    return value;
  };
  const window = { destroyed: false, isDestroyed() { return this.destroyed; } };
  if (kind === 'cowork') window.webContents = contents();
  focusedWindow = window;
  const shell = contents(), vue = contents(), chrome = contents(), chat = contents();
  const state = { visible: true, live: true, alertOpen: false, sessionSearches: 0 };
  const host = { hostToken: 'preview-token', hostId: 'preview-host', kind: 'standalone' };
  const findCalls = [], broadcasts = [], closedSearches = [];
  const electronContents = { getFocusedWebContents: () => focused };
  const menu = {};
  runInNewContext(menuCode, {
    exports: menu, process: { platform }, console: { info() {} },
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        BaseWindow: { getFocusedWindow: () => focusedWindow },
        webContents: electronContents,
        Menu: { buildFromTemplate: (template) => template, setApplicationMenu() {} }
      };
    }
  });
  const Helper = runInNewContext(`${helperCode}\nOnlyPreviewWindowHelper`, {
    process: { platform }, console: { info() {} },
    isApplicationFindFocusWithin: menu.isApplicationFindFocusWithin,
    electronWebContents: electronContents,
    onlyPreviewHostRegistry: { isLive: (token) => state.live && token === host.hostToken },
    onlyPreviewAlertWindowService: { isOpen: () => state.alertOpen },
    onlyPreviewGlobalSearchWindowService: {
      closeForFind: (token) => closedSearches.push(token), isActive: () => false
    },
    onlyPreviewPreviewRegionService: {
      openFind: (token) => { findCalls.push(token); return true; },
      getVuePreviewView: () => ({ webContents: vue })
    },
    ONLY_PREVIEW_FIND_FOCUS_EVENT: 'find-focus',
    xpcMain: { broadcast: (event, payload) => broadcasts.push({ event, payload }) }
  });
  const helper = Object.create(Helper.prototype);
  Object.assign(helper, {
    baseWindow: window, standaloneHost: host, standaloneMount: { kind },
    surfaceContainer: kind === 'cowork' ? { getVisible: () => state.visible } : null,
    shortcutContents: new WeakSet(), shellView: { webContents: shell }
  });
  for (const [source, origin] of [[shell, 'shell'], [vue, 'vue'], [chrome, 'chrome']]) {
    helper.bindNativeShortcuts(source, host, origin);
  }
  menu.setApplicationFindDispatch((command, target) => helper.runMenuFindCommand(command, target));
  menu.setApplicationSessionSearchDispatch(() => { state.sessionSearches++; return true; });
  const menuFind = menu.buildApplicationFindMenuTemplate()
    .find((item) => item.label === 'Edit').submenu
    .find((item) => item.accelerator === 'Command+F');
  const press = (source, { consumed = false, ...changes } = {}) => {
    focused = source;
    const event = {
      defaultPrevented: consumed,
      preventDefault() { this.defaultPrevented = true; }
    };
    source.emit('before-input-event', event, {
      type: 'keyDown', key: 'f', isAutoRepeat: false,
      meta: platform === 'darwin', control: platform !== 'darwin',
      shift: false, alt: false, ...changes
    });
    return event.defaultPrevented;
  };
  return {
    helper, menu, window, shell, vue, chrome, chat, host, state, contents, press,
    findCalls, broadcasts, closedSearches, clickFind: () => menuFind.click(),
    focus: (value) => { focused = value; },
    focusWindow: (value) => { focusedWindow = value; }
  };
};

test('real focus ownership accepts Preview views, host chrome, no responder and PDF guests', () => {
  const h = harness();
  const guest = h.contents(h.chrome);
  const nestedGuest = h.contents(guest);
  for (const focused of [h.shell, h.vue, h.chrome, h.window.webContents, null, guest, nestedGuest]) {
    h.focus(focused);
    assert.equal(h.menu.isApplicationFindFocusWithin(h.window, h.helper.shortcutContents), true);
  }
  for (const focused of [h.chat, h.contents(), h.contents(h.chat)]) {
    h.focus(focused);
    assert.equal(h.menu.isApplicationFindFocusWithin(h.window, h.helper.shortcutContents), false);
  }
});

test('actual menu routing opens Find once for every active embedded Preview surface', () => {
  for (const surface of ['shell', 'vue', 'chrome', 'pdf', 'host-chrome', 'none']) {
    const h = harness();
    h.focus(surface === 'pdf' ? h.contents(h.chrome)
      : surface === 'host-chrome' ? h.window.webContents
        : surface === 'none' ? null : h[surface]);
    h.clickFind();
    assert.deepEqual(h.findCalls, [h.host.hostToken], surface);
    assert.deepEqual(h.closedSearches, [h.host.hostToken], surface);
    assert.equal(h.broadcasts.length, 1, surface);
    assert.equal(h.broadcasts[0].event, 'find-focus');
    assert.equal(h.broadcasts[0].payload.hostId, h.host.hostId);
    assert.equal(h.state.sessionSearches, 0, surface);
  }
});

test('Chat focused beside an active Preview declines Preview and opens only session search', () => {
  const h = harness();
  h.focus(h.chat);
  assert.equal(h.helper.runMenuFindCommand('find-in-file', h.window), false);
  h.clickFind();
  assert.equal(h.state.sessionSearches, 1);
  assert.deepEqual(h.findCalls, []);
  assert.deepEqual(h.broadcasts, []);
  assert.equal(h.shell.focusCount, 0, 'Preview must not steal the Chat focus');
});

test('a hidden Preview refuses both menu and native Find even with stale Preview focus', () => {
  for (const surface of ['vue', 'host-chrome', 'none']) {
    const h = harness();
    h.state.visible = false;
    h.focus(surface === 'host-chrome' ? h.window.webContents : surface === 'none' ? null : h.vue);
    assert.equal(h.helper.runMenuFindCommand('find-in-file', h.window), false);
    assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
    assert.equal(h.press(h.vue), false);
    assert.deepEqual(h.findCalls, []);
    assert.deepEqual(h.broadcasts, []);
  }
});

test('standalone Preview retains menu Find and no-first-responder fallback', () => {
  for (const surface of ['shell', 'chrome', 'none']) {
    const h = harness({ kind: 'standalone' });
    h.focus(surface === 'none' ? null : h[surface]);
    assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), true);
    assert.deepEqual(h.findCalls, [h.host.hostToken]);
    assert.equal(h.shell.focusCount, 1);
  }
});

test('another window, destroyed window or revoked host cannot route to this Preview', () => {
  const h = harness();
  h.focus(h.vue);
  assert.equal(h.helper.runMenuFindCommand('find-in-file', null), false);
  assert.equal(h.helper.runMenuFindCommand('find-in-file', {}), false);
  h.focusWindow({});
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  h.window.destroyed = true;
  assert.equal(h.helper.runMenuFindCommand('find-in-file', h.window), false);
  h.window.destroyed = false;
  h.state.live = false;
  assert.equal(h.helper.runMenuFindCommand('find-in-file', h.window), false);
  assert.deepEqual(h.findCalls, []);
});

test('actual native CmdF and CtrlF route every Preview surface and reject consumed or repeated input', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const surface of ['shell', 'vue', 'chrome']) {
      const h = harness({ platform });
      assert.equal(h.press(h[surface]), true);
      assert.deepEqual(h.findCalls, [h.host.hostToken]);
      assert.equal(h.press(h[surface], { consumed: true }), true);
      assert.equal(h.press(h[surface], { isAutoRepeat: true }), false);
      assert.equal(h.press(h[surface], { type: 'keyUp' }), false);
      assert.deepEqual(h.findCalls, [h.host.hostToken]);
      assert.equal(h.broadcasts.length, 1);
      assert.equal(h.state.sessionSearches, 0);
    }
  }
});

test('a modal Preview alert consumes Find without opening either search UI', () => {
  const h = harness();
  h.state.alertOpen = true;
  h.focus(h.vue);
  assert.equal(h.helper.runMenuFindCommand('find-in-file', h.window), true);
  h.clickFind();
  assert.equal(h.press(h.vue), true);
  assert.deepEqual(h.findCalls, []);
  assert.deepEqual(h.closedSearches, []);
  assert.deepEqual(h.broadcasts, []);
  assert.equal(h.state.sessionSearches, 0);
});

test('registered file surfaces claim Find once and release the actual shared dispatcher on disposal', () => {
  const h = harness();
  h.focus(h.chat);
  const calls = [];
  const dispose = h.menu.registerApplicationFindDispatch((command, window) => {
    calls.push({ command, window });
    return true;
  });
  h.clickFind();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'find-in-file');
  assert.equal(calls[0].window, h.window);
  assert.deepEqual(h.findCalls, []);
  assert.equal(h.state.sessionSearches, 0);
  dispose();
  h.clickFind();
  assert.equal(calls.length, 1);
  assert.equal(h.state.sessionSearches, 1);
});

const fileTabHarness = (platform = 'darwin') => {
  const h = harness({ platform });
  h.menu.setApplicationFindDispatch(null);
  const lifecycle = { open: true, dispatches: 0, releases: 0, destroys: 0, revokes: 0, detaches: 0 };
  const fileHost = { hostToken: 'file-token', hostId: 'file-host', kind: 'standalone' };
  const fileFindCalls = [];
  h.window.contentView = { removeChildView: () => { lifecycle.detaches++; } };
  class View {
    visible = false;
    setVisible(value) { this.visible = value; }
    setBounds() {}
  }
  class Region {
    openFind(token) { fileFindCalls.push(token); return true; }
    updateBounds() {}
    focusActiveContent() {}
    destroy() { lifecycle.destroys++; }
  }
  const FileTabSurface = runInNewContext(`${fileTabCode}\nOnlyPreviewFileTabSurface`, {
    View, OnlyPreviewPreviewRegionService: Region, process: { platform },
    onlyPreviewHostRegistry: {
      issue: () => fileHost,
      revoke: (token) => { assert.equal(token, fileHost.hostToken); lifecycle.revokes++; }
    },
    isApplicationFindFocusWithin: h.menu.isApplicationFindFocusWithin,
    registerApplicationFindDispatch: (callback) => {
      const release = h.menu.registerApplicationFindDispatch((...args) => {
        lifecycle.dispatches++;
        return callback(...args);
      });
      return () => { lifecycle.releases++; release(); };
    },
    enrollMaestroShortcutContents() {},
    ONLY_PREVIEW_FIND_FOCUS_EVENT: 'find-focus',
    xpcMain: { broadcast: (event, payload) => h.broadcasts.push({ event, payload }) }
  });
  const surface = new FileTabSurface({
    window: h.window, path: '/fixture/document.md', isOpen: () => lifecycle.open,
    bounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), attach() {}
  });
  const toolbar = h.contents(), content = h.contents();
  surface.toolbar = { webContents: toolbar, setBounds() {} };
  surface.bindShortcuts(toolbar);
  surface.bindShortcuts(content);
  return { ...h, surface, toolbar, content, fileHost, fileFindCalls, lifecycle };
};

test('actual file-tab constructor routes only its active focused surface, including PDF and chrome fallback', () => {
  const h = fileTabHarness();
  h.focus(h.content);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false, 'new file tabs start inactive');
  h.surface.setActive(true);
  for (const focused of [h.toolbar, h.content, h.contents(h.content), h.window.webContents, null]) {
    h.focus(focused);
    assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), true);
  }
  assert.deepEqual(h.fileFindCalls, Array(5).fill(h.fileHost.hostToken));
  assert.equal(h.broadcasts.length, 5);
  assert.equal(h.toolbar.focusCount, 5);
  h.focus(h.chat);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  h.clickFind();
  assert.equal(h.state.sessionSearches, 1);
  assert.equal(h.fileFindCalls.length, 5, 'Chat must not open file Find');
  h.focus(h.content);
  assert.equal(h.menu.dispatchApplicationFindCommand('focus-search'), false);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file', {}), false);
  h.surface.setActive(false);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  assert.equal(h.press(h.content), false);
  h.surface.setActive(true);
  h.lifecycle.open = false;
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  h.lifecycle.open = true;
  h.window.destroyed = true;
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  assert.equal(h.fileFindCalls.length, 5);
});

test('actual file-tab disposal unregisters its callback once and cannot consume later Find', () => {
  const h = fileTabHarness();
  h.surface.setActive(true);
  h.focus(h.content);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), true);
  const dispatchedBeforeDisposal = h.lifecycle.dispatches;
  h.surface.dispose();
  h.surface.dispose();
  h.focus(h.content);
  assert.equal(h.menu.dispatchApplicationFindCommand('find-in-file'), false);
  assert.equal(h.lifecycle.dispatches, dispatchedBeforeDisposal, 'the disposed callback is removed, not merely declined');
  assert.equal(h.lifecycle.releases, 1);
  assert.equal(h.lifecycle.destroys, 1);
  assert.equal(h.lifecycle.revokes, 1);
  assert.equal(h.lifecycle.detaches, 1);
  assert.equal(h.toolbar.destroyed, true);
  assert.deepEqual(h.fileFindCalls, [h.fileHost.hostToken]);
});

test('actual file-tab native Find preserves single-consumption, repeated-key and IME behavior', () => {
  for (const platform of ['darwin', 'win32']) {
    const h = fileTabHarness(platform);
    h.surface.setActive(true);
    assert.equal(h.press(h.content, { consumed: true }), true);
    assert.equal(h.press(h.content, { isComposing: true }), false);
    assert.deepEqual(h.fileFindCalls, []);
    assert.equal(h.press(h.content), true);
    assert.equal(h.press(h.content, { isAutoRepeat: true }), true);
    assert.deepEqual(h.fileFindCalls, [h.fileHost.hostToken]);
    assert.equal(h.broadcasts.length, 1);
    assert.equal(h.state.sessionSearches, 0);
  }
});
