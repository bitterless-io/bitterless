import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const harness = () => {
  const windows = [], surfaces = [];
  let open = async () => {};
  let constructorFails = false;
  class BaseWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.destroyed = false; this.shown = false; this.contentView = { addChildView() {} }; windows.push(this); }
    getContentSize() { return [1100, 800]; }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  class Surface {
    constructor(owner) { if (constructorFails) throw new Error('host limit'); this.owner = owner; surfaces.push(this); }
    open() { return open(this); }
    refresh() { this.refreshed = true; }
    setActive(active) { this.active = active; }
    dispose() { this.disposed = true; }
  }
  const code = ts.transpileModule(readFileSync(resolve(import.meta.dirname, '../../src/main/windows/indiPreviewWindow.service.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === 'electron' ? { BaseWindow } :
    name === './onlyPreviewSingleFileSurface.service' ? { OnlyPreviewSingleFileSurface: Surface } : require(name), module, module.exports);
  return { windows, surfaces, open: module.exports.openIndiPreviewFile, setOpen: value => { open = value; }, failConstructor: () => { constructorFails = true; } };
};
test('independent native windows attach the shared surface, preserve location hints and close independently', async () => {
  const h = harness();
  await Promise.all([h.open('/outside/a.md', { line: 8, fragment: 'part' }), h.open('/outside/b.pdf')]);
  assert.equal(h.windows.length, 2);
  assert.equal(h.windows[0].options.title, 'a.md');
  assert.equal(h.windows[0].options.minWidth, 800);
  assert.equal(h.windows[0].options.minHeight, 600);
  assert.equal(h.surfaces[0].owner.line, 8);
  assert.equal(h.surfaces[0].owner.fragment, 'part');
  assert.ok(h.windows.every(window => window.shown && window.focused));
  h.windows[0].emit('resize'); assert.equal(h.surfaces[0].refreshed, true);
  h.windows[0].destroy(); assert.equal(h.surfaces[0].disposed, true);
  assert.equal(h.surfaces[1].disposed, undefined);
});
test('failed startup disposes the surface and hidden window and rejects to the caller', async () => {
  const h = harness(); h.setOpen(async () => { throw new Error('failed load'); });
  await assert.rejects(h.open('/outside/bad.md'), /failed load/);
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.windows[0].shown, false);
  assert.equal(h.surfaces[0].disposed, true);
});
test('closing during startup prevents a late show or orphaned surface', async () => {
  const h = harness(); let complete;
  h.setOpen(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.open('/outside/slow.md'); h.windows[0].destroy(); complete();
  await assert.rejects(pending, /closed during startup/);
  assert.equal(h.windows[0].shown, false);
  assert.equal(h.surfaces[0].disposed, true);
});

test('a surface constructor failure destroys the already-created native window', async () => {
  const h = harness(); h.failConstructor();
  await assert.rejects(h.open('/outside/limit.md'), /host limit/);
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.windows[0].shown, false);
});
