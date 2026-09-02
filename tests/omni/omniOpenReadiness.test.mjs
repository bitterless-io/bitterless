import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const index = (source, fragment, fromIndex = 0) => {
  const value = source.indexOf(fragment, fromIndex);
  assert.notEqual(value, -1, `missing source fragment: ${fragment}`);
  return value;
};

test('Omni cold-open gate waits for explicit trusted renderer mount handshakes', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const handler = read('src/main/xpc/omniWindow.handler.ts');
  const preload = read('src/preload/omni/omni.preload.ts');
  const topMain = read('src/renderer/omni/omniWindow/src/main.ts');
  const cellMain = read('src/renderer/omni/omniCell/src/main.ts');

  assert.match(helper, /return this\.openCoordinator\.open\(\);/);
  assert.match(handler, /await omniWindowHelper\.create\(\);/);
  assert.match(handler, /rendererMountedReady[\s\S]*?markRendererMountedReady\(params\)/);
  assert.match(preload, /omni-ready-token/);
  assert.match(preload, /omni-ready-generation/);
  assert.match(preload, /omni-ready-role/);

  assert.match(helper, /this\.requireViewLoad\(menubarView, 'top menubar'\)/);
  assert.match(helper, /initialRendererReadyCollector\.begin\([\s\S]*?creationGeneration/);
  assert.match(helper, /initialRendererReadyCollector\.finish\(initialRendererReadyBatch\)/);
  assert.match(helper, /topRendererReady\.promise/);
  assert.match(helper, /\.\.\.initialBrowserRendererReady/);
  assert.match(
    helper,
    /onInvalidate: \(generation\) => \{[\s\S]*?openStartedAt\.delete\(generation\)/,
  );
  assert.match(helper, /params\.generation !== fence\.generation/);
  assert.match(helper, /params\.role !== fence\.role/);
  assert.match(helper, /params\.cellId !== fence\.cellId/);

  for (const source of [topMain, cellMain]) {
    const language = index(source, 'await initializeRendererLanguage();');
    const dynamicImport = index(source, "await import('./App.vue')", language);
    const mount = index(source, ".mount('#app')", dynamicImport);
    const nextTick = index(source, 'await nextTick();', mount);
    const reportReady = index(source, 'rendererMountedReady({', nextTick);
    assert.ok(language < dynamicImport);
    assert.ok(dynamicImport < mount);
    assert.ok(mount < nextTick);
    assert.ok(nextTick < reportReady);
  }
});

test('Omni initial chrome is unthrottled while remote content stays normally throttled', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const localFactory = helper.slice(
    helper.indexOf('private createWebContentsView('),
    helper.indexOf('\n}', helper.indexOf('private createWebContentsView(')),
  );
  assert.match(helper, /createWebContentsView\([\s\S]*?'omniWindow'[\s\S]*?getRendererReadyArguments\(topRendererReady\)[\s\S]*?true/);
  assert.match(helper, /createWebContentsView\('omniCell',[\s\S]*?getRendererReadyArguments\(rendererReadyFence\)[\s\S]*?\], true\)/);
  assert.match(localFactory, /backgroundThrottling: !startupUnthrottled/);
  assert.match(helper, /createBrowserCellContentView[\s\S]*?backgroundThrottling: true/);
  assert.match(helper, /createMiniAppCellContentView[\s\S]*?backgroundThrottling: true/);
  assert.match(helper, /rendererReadyFences\.delete\(fence\.token\)[\s\S]*?fence\.view\.webContents\.setBackgroundThrottling\(true\)[\s\S]*?fence\.resolve\(\)/);
  assert.match(helper, /bindRendererReadyFenceView[\s\S]*?fence\.view !== view \|\| fence\.settled[\s\S]*?did-fail-load[\s\S]*?unresponsive[\s\S]*?render-process-gone/);
});

test('Omni defers initial content and Control until after local chrome presentation', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const present = helper.slice(helper.indexOf('present: (window, generation)'), helper.indexOf('cleanupIncomplete:'));
  const addCell = helper.slice(helper.indexOf('private addCell('), helper.indexOf('private configureBrowserCellContentView('));
  const toggle = helper.slice(helper.indexOf('toggleControl()'), helper.indexOf('getLayoutConfig()'));
  assert.ok(index(present, 'this.show()') < index(present, 'this.startDeferredInitialContent(generation)'));
  assert.match(helper, /deferredInitialContent\.set\(creationGeneration, \[\]\)/);
  assert.match(addCell, /const startContent[\s\S]*?loadMiniAppCellContent[\s\S]*?loadURL\(url\)[\s\S]*?deferred\.push\(startContent\)/);
  assert.match(helper, /startDeferredInitialContent[\s\S]*?openCoordinator\.isCurrent\(generation\)[\s\S]*?queueMicrotask[\s\S]*?openCoordinator\.isCurrent\(generation\)[\s\S]*?for \(const task of tasks\) task\(\)/);
  assert.match(helper, /cleanupAllViews[\s\S]*?deferredInitialContent\.clear\(\)/);
  assert.match(toggle, /if \(!this\.controlView \|\| !this\.isWebContentsAlive[\s\S]*?this\.createControlView\(\)[\s\S]*?setControlVisible/);
});

test('Omni address Enter has exactly one navigation event source', () => {
  const cell = read('src/renderer/omni/omniCell/src/App.vue');

  assert.equal((cell.match(/@press-enter="navigate"/g) ?? []).length, 1);
  assert.equal((cell.match(/@keydown(?:\.enter)?=/g) ?? []).length, 0);
  assert.doesNotMatch(cell, /const onKeydown/);
});

test('Home and Workbench keep Open loading through localized Omni success feedback', () => {
  const home = read('src/renderer/home/src/views/miniApp/MiniApp.vue');
  const workbench = read('src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue');
  const en = read('src/renderer/common/i18n/en.ts');
  const zh = read('src/renderer/common/i18n/zh.ts');

  for (const source of [home, workbench]) {
    assert.match(source, /:loading="openingAppIds\.has\(app\.id\)"/);
    assert.match(source, /:disabled="openingAppIds\.has\(app\.id\)"/);
    assert.match(
      source,
      /const result = await omniWindowEmitter\.openOmniWindow\(\)[\s\S]*?if \(!result\?\.opened\) throw[\s\S]*?Message\.success\([\s\S]*?miniApp\.opened/,
    );
    assert.ok(
      index(source, 'await app.action()') < index(source, 'openingAppIds.value.delete(app.id)'),
    );
  }

  assert.match(en, /opened: '\{name\} opened'/);
  assert.match(zh, /opened: '已打开\{name\}'/);
});
