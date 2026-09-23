import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { createHarness, bounds, host, state, descriptorFor, fileRef, deferred } from './onlyPreviewPreviewRegionTest.helper.mjs';
const pool = () => {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(import.meta.dirname, '../../src/main/windows/indiPreviewChromePartition.service.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports.acquireIndiPreviewChromePartition;
};
const tick = () => new Promise(resolve => setImmediate(resolve));
test('persistent slots isolate concurrent windows and reuse only after complete disposal', async () => {
  const acquire = pool(), first = acquire(), second = acquire(), gate = deferred();
  assert.notEqual(first.partition, second.partition);
  first.release(gate.promise);
  const during = acquire(); assert.notEqual(during.partition, first.partition);
  gate.resolve(); await tick();
  assert.equal(acquire().partition, first.partition);
  first.release(Promise.resolve()); await tick();
  assert.notEqual(acquire().partition, first.partition, 'double release must not free the new owner');
});
test('failed cleanup never returns a partition slot to another window', async () => {
  const acquire = pool(), first = acquire();
  first.release(Promise.reject(new Error('clear failed'))); await tick();
  assert.notEqual(acquire().partition, first.partition);
});
test('actual renderer disposal waits for pending Chrome startup and all cleanup tasks', async () => {
  const { service } = createHarness(); service.updateBounds(host.hostToken, bounds);
  const proxy = { started: deferred(), completion: deferred() };
  state.nextProxyDeferred = proxy; state.describe = async () => descriptorFor('page.html', 'text');
  const presenting = service.present(host.hostToken, fileRef('page.html'));
  await proxy.started.promise;
  const cleanup = deferred();
  state.chromeViews[0].webContents.session.clearStorageData = () => cleanup.promise;
  service.destroy(); let disposed = false;
  const disposing = service.waitForChromeDisposal().then(() => { disposed = true; });
  await tick(); assert.equal(disposed, false);
  proxy.completion.resolve(); await presenting; await tick(); assert.equal(disposed, false);
  cleanup.resolve(); await disposing; assert.equal(disposed, true);
});
test('actual session clear failures reject disposal rather than releasing an unsafe slot', async () => {
  const { service } = createHarness(); service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  state.chromeViews[0].webContents.session.clearCache = async () => { throw new Error('cache locked'); };
  service.destroy(); await assert.rejects(service.waitForChromeDisposal(), /could not be cleared/);
});
