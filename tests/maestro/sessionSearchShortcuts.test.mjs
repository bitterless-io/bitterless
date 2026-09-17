import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../..');

const viewSource = readFileSync(resolve(root, 'src/main/maestro/windows/main/maestroControlView.service.ts'), 'utf8');
const actualMethod = (source, { name, bindings = {} }) => {
  const ast = ts.createSourceFile('target.ts', source, ts.ScriptTarget.Latest, true);
  let found;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found);
  const output = ts.transpileModule(`class Target { ${found.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return runInNewContext(`${output}\nTarget.prototype.${name}`, bindings);
};
const viewMethod = (name, broadcast) => actualMethod(viewSource, { name, bindings: { xpcMain: { broadcast } } });

const nativeUndoHarness = () => {
  const counters = { undo: 0, redo: 0, focus: 0, otherUndo: 0 };
  const state = { windowDestroyed: false, windowFocused: true, destroyed: false, focused: true };
  const contents = {
    isDestroyed: () => state.destroyed,
    isFocused: () => state.focused,
    undo: () => { counters.undo++; },
    redo: () => { counters.redo++; },
    focus: () => { counters.focus++; }
  };
  const otherContents = { undo: () => { counters.otherUndo++; } };
  const target = {
    _state: { browserWindow: {
      isDestroyed: () => state.windowDestroyed,
      isFocused: () => state.windowFocused,
      focus: () => { counters.focus++; }
    } },
    view: { webContents: contents }
  };
  target.editControlText = actualMethod(viewSource, {
    name: 'editControlText',
    bindings: { webContents: { fromId: () => otherContents, getFocusedWebContents: () => otherContents } }
  });
  const controller = { controlView: target };
  controller.editControlText = actualMethod(readFileSync(resolve(root, 'src/main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8'), {
    name: 'editControlText'
  });
  const endpoint = actualMethod(readFileSync(resolve(root, 'src/main/maestro/xpc/coach.handler.ts'), 'utf8'), {
    name: 'editControlText', bindings: { maestroWindowHelper: controller }
  });
  return { state, target, counters, endpoint };
};

test('editable Undo crosses the real handler and controller and invokes fixed Control WebContents.undo once', async () => {
  const h = nativeUndoHarness();
  assert.equal((await h.endpoint({ action: 'undo', webContentsId: 99 })).ok, true);
  assert.deepEqual(h.counters, { undo: 1, redo: 0, focus: 0, otherUndo: 0 });
  assert.equal((await h.endpoint({ action: 'redo' })).ok, false, 'native redo must not become business redo');
  assert.equal((await h.endpoint({})).ok, false);
  assert.equal((await h.endpoint(null)).ok, false);
  assert.deepEqual(h.counters, { undo: 1, redo: 0, focus: 0, otherUndo: 0 });
});

test('native text Undo rejects missing, destroyed or unfocused Control without changing focus', async () => {
  const h = nativeUndoHarness();
  for (const [key, rejected] of [
    ['windowDestroyed', true], ['windowFocused', false], ['destroyed', true], ['focused', false]
  ]) {
    const previous = h.state[key];
    h.state[key] = rejected;
    assert.equal((await h.endpoint({ action: 'undo' })).ok, false, key);
    h.state[key] = previous;
  }
  h.target.view = null;
  assert.equal((await h.endpoint({ action: 'undo' })).ok, false);
  h.target._state.browserWindow = null;
  assert.equal((await h.endpoint({ action: 'undo' })).ok, false);
  assert.deepEqual(h.counters, { undo: 0, redo: 0, focus: 0, otherUndo: 0 });
});

const controlBeforeInput = (platform, setIgnoreMenuShortcuts) => {
  const ast = ts.createSourceFile('view.ts', viewSource, ts.ScriptTarget.Latest, true);
  let listener;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'view.webContents.on' &&
        node.arguments[0]?.text === 'before-input-event') listener = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(listener, 'actual Control shortcut listener exists');
  const output = ts.transpileModule(`const listener = ${listener.getText(ast)}; listener;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return runInNewContext(output, { process: { platform }, view: { webContents: { setIgnoreMenuShortcuts } } });
};

test('Control plain Cmd/Ctrl+Z reaches DOM Undo; Shift+Cmd/Ctrl+Z keeps native menu redo', async () => {
  for (const platform of ['darwin', 'win32']) {
    const h = nativeUndoHarness();
    const ignored = [];
    const beforeInput = controlBeforeInput(platform, value => ignored.push(value));
    const event = { preventDefault: () => assert.fail('Control must deliver the DOM keyboard event') };
    const input = { type: 'keyDown', key: 'z', meta: platform === 'darwin', control: platform === 'win32',
      alt: false, shift: false, isComposing: false };
    beforeInput(event, input);
    assert.equal(ignored.at(-1), true);
    assert.equal((await h.endpoint({ action: 'undo' })).ok, true);
    assert.equal(h.counters.undo, 1, 'editable DOM routing invokes native Undo exactly once');
    beforeInput(event, { ...input, shift: true });
    assert.equal(ignored.at(-1), false, 'Shift+Z remains available to the native Redo menu');
    beforeInput(event, { ...input, type: 'keyUp' });
    assert.equal(ignored.at(-1), false);
    beforeInput(event, { ...input, isComposing: true });
    assert.equal(ignored.at(-1), false);
    assert.deepEqual(h.counters, { undo: 1, redo: 0, focus: 0, otherUndo: 0 });
  }
});
test('search from a hidden panel waits for visible bounds before focusing, then only once', () => {
  const events = [];
  let focuses = 0;
  let bounds = { x: 0, y: 0, width: 0, height: 500 };
  const wc = { isDestroyed: () => false, focus: () => { focuses++; } };
  const view = { webContents: wc, getBounds: () => bounds, setVisible: () => {} };
  const target = { view, webContents: wc, focusSearchOnLayout: false,
    _state: {},
    applyBounds: (_view, rect) => { bounds = rect; }
  };
  const open = viewMethod('openSessionSearch', (event) => events.push(event));
  const layout = viewMethod('setBounds', () => {});
  assert.equal(open.call(target), true);
  assert.deepEqual(events, ['maestro/session-search']);
  assert.equal(focuses, 0);
  layout.call(target, { ...bounds, width: 400 });
  assert.equal(focuses, 1);
  layout.call(target, { ...bounds, width: 420 });
  assert.equal(focuses, 1, 'later resize must not steal focus');
});
test('search on a destroyed control does not claim the shortcut or broadcast', () => {
  const open = viewMethod('openSessionSearch', () => assert.fail('unexpected broadcast'));
  const _state = {};
  assert.equal(open.call({ _state, view: null }), false);
  assert.equal(open.call({ _state, view: { webContents: { isDestroyed: () => true } } }), false);
});

test('Control login request reveals a hidden panel without session search', () => {
  const events = [];
  const open = viewMethod('requestLogin', (event) => events.push(event));
  const target = {
    focusSearchOnLayout: false,
    view: {
      webContents: {
        isDestroyed: () => false,
        focus: () => assert.fail('hidden Control focuses after layout')
      },
      getBounds: () => ({ x: 880, y: 78, width: 0, height: 722 })
    }
  };
  open.call(target);
  assert.equal(target.focusSearchOnLayout, true);
  assert.deepEqual(events, ['coach/login-request']);
});

const source = readFileSync(resolve(root, 'src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts'), 'utf8');
const harness = (platform = 'darwin') => {
  const app = new EventEmitter();
  const partition = {};
  const calls = [];
  let findHandled = false;
  let focused = null;
  let menu = null;
  const windows = { getFocusedWindow: () => focused, getAllWindows: () => [] };
  const exports = {};
  const stub = {
    app, session: { fromPartition: () => partition },
    webContents: { getAllWebContents: () => [], getFocusedWebContents: () => null },
    BrowserWindow: windows,
    Menu: { setApplicationMenu: (value) => { menu = value; }, buildFromTemplate: (value) => value },
    dialog: { showMessageBoxSync: () => assert.fail('Search must not show confirmation') }
  };
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  }}).outputText;
  runInNewContext(output, {
    exports, process: { platform }, Date, WeakSet, Map,
    require: (id) => {
      if (id === 'electron') return stub;
      if (id.includes('applicationFindMenu')) return {
        dispatchApplicationFindCommand: () => { if (!findHandled) return false; calls.push('preview'); return true; }
      };
      if (id.includes('maestroDataRoot')) return { MAESTRO_PARTITION: 'maestro' };
      if (id.includes('nativeMessages')) return { getNativeMessages: () => ({ searchSessions: 'Search sessions' }) };
      if (id.includes('applicationLanguage')) return { onApplicationLanguageChanged: () => {} };
      throw new Error(id);
    }
  });
  let allowed = true;
  let authLocked = false;
  exports.activateShortcuts({
    isAuthLocked: () => authLocked,
    newTab: () => calls.push('new'),
    closeActiveTab: () => calls.push('close'),
    reloadActiveTab: () => calls.push('reload'),
    searchSessions: () => { if (!allowed) return false; calls.push('search'); return true; }
  });
  const contents = (owned = true) => {
    const wc = new EventEmitter();
    wc.session = owned ? partition : {};
    app.emit('web-contents-created', {}, wc);
    return wc;
  };
  const press = (wc, overrides = {}) => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    wc.emit('before-input-event', event, {
      type: 'keyDown', key: 'f', meta: platform === 'darwin', control: platform !== 'darwin',
      alt: false, shift: false, isComposing: false, ...overrides
    });
    return event.defaultPrevented;
  };
  return { contents, press, calls, exports, get menu() { return menu; },
    setFindHandled(value) { findHandled = value; },
    setAuthLocked(value) { authLocked = value; },
    setAllowed(value) { allowed = value; }, setFocused(value) { focused = value; } };
};

test('CmdF and CtrlF dispatch session search once; IME and modified Find pass through', () => {
  for (const platform of ['darwin', 'win32']) {
    const h = harness(platform);
    const wc = h.contents();
    assert.equal(h.press(wc), true);
    assert.deepEqual(h.calls, ['search']);
    assert.equal(h.press(wc, { shift: true }), false);
    assert.equal(h.press(wc, { alt: true }), false);
    assert.equal(h.press(wc, { isComposing: true }), false);
    assert.equal(h.press(wc, { key: 'z' }), false, 'text undo stays renderer-owned');
    assert.deepEqual(h.calls, ['search']);
  }
});
test('anonymous Cmd/Ctrl+F, T and W keep browser actions available', () => {
  for (const platform of ['darwin', 'win32']) {
    const h = harness(platform);
    const wc = h.contents();
    h.setAuthLocked(true);
    h.setFindHandled(true);
    for (const key of ['f', 't', 'w']) {
      assert.equal(h.press(wc, { key }), true, `${platform} ${key}`);
    }
    assert.deepEqual(h.calls, ['preview', 'new', 'close']);
  }
});
test('unclaimed Find remains available to the focused surface', () => {
  const h = harness();
  h.setAllowed(false);
  assert.equal(h.press(h.contents()), false);
  assert.deepEqual(h.calls, []);
});
test('standalone preview is untouched, and an enrolled preview tab uses file Find', () => {
  const h = harness();
  const preview = h.contents(false);
  assert.equal(h.press(preview), false);
  h.exports.enrollMaestroShortcutContents(preview);
  h.setFindHandled(true);
  assert.equal(h.press(preview), true);
  assert.deepEqual(h.calls, ['preview']);
});

test('a consumed Preview Find is never also dispatched to Session search', () => {
  const h = harness();
  const wc = h.contents();
  wc.prependListener('before-input-event', (event) => {
    h.calls.push('local-preview');
    event.preventDefault();
  });
  assert.equal(h.press(wc), true);
  assert.deepEqual(h.calls, ['local-preview']);
});
