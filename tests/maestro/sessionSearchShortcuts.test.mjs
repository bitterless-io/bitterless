import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../..');

const viewSource = readFileSync(resolve(root, 'src/main/maestro/windows/main/maestroControlView.service.ts'), 'utf8');
const viewMethod = (name, broadcast) => {
  const ast = ts.createSourceFile('view.ts', viewSource, ts.ScriptTarget.Latest, true);
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
  return runInNewContext(`${output}\nTarget.prototype.${name}`, { xpcMain: { broadcast } });
};
test('search from a hidden panel waits for visible bounds before focusing, then only once', () => {
  const events = [];
  let focuses = 0;
  let bounds = { x: 0, y: 0, width: 0, height: 500 };
  const wc = { isDestroyed: () => false, focus: () => { focuses++; } };
  const view = { webContents: wc, getBounds: () => bounds, setVisible: () => {} };
  const target = { view, webContents: wc, focusSearchOnLayout: false,
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
  assert.equal(open.call({ view: null }), false);
  assert.equal(open.call({ view: { webContents: { isDestroyed: () => true } } }), false);
});


const source = readFileSync(resolve(root, 'src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts'), 'utf8');
const harness = (platform = 'darwin') => {
  const app = new EventEmitter();
  const partition = {};
  const calls = [];
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
      if (id.includes('maestroDataRoot')) return { MAESTRO_PARTITION: 'maestro' };
      if (id.includes('nativeMessages')) return { getNativeMessages: () => ({ searchSessions: 'Search sessions' }) };
      if (id.includes('applicationLanguage')) return { onApplicationLanguageChanged: () => {} };
      throw new Error(id);
    }
  });
  let allowed = true;
  exports.activateShortcuts({
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
test('unclaimed Find remains available to the focused surface', () => {
  const h = harness();
  h.setAllowed(false);
  assert.equal(h.press(h.contents()), false);
  assert.deepEqual(h.calls, []);
});
test('standalone preview is untouched, but an enrolled preview tab receives Find', () => {
  const h = harness();
  const preview = h.contents(false);
  assert.equal(h.press(preview), false);
  h.exports.enrollMaestroShortcutContents(preview);
  assert.equal(h.press(preview), true);
  assert.deepEqual(h.calls, ['search']);
});
