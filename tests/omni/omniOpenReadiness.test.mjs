import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const index = (source, fragment, fromIndex = 0) => {
  const value = source.indexOf(fragment, fromIndex);
  assert.notEqual(value, -1, `missing source fragment: ${fragment}`);
  return value;
};

test('Omni shows its restored native graph before trusted renderer mount handshakes settle Open', () => {
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
  const createWindow = helper.slice(
    helper.indexOf('private async createWindow('),
    helper.indexOf('private async requireViewLoad('),
  );
  assert.ok(
    index(createWindow, 'this.show();') < index(createWindow, 'await Promise.all(['),
    'native graph must become visible before local renderer readiness is awaited',
  );
  assert.match(
    helper,
    /onInvalidate: \(generation\) => \{[\s\S]*?finishOpenDiagnostic\(generation, 'superseded', 'invalidated'\)/,
  );
  assert.match(helper, /params\.generation !== fence\.generation/);
  assert.match(helper, /params\.role !== fence\.role/);
  assert.match(helper, /params\.cellId !== fence\.cellId/);
  assert.match(helper, /OMNI_RENDERER_BOOTSTRAP_PHASES\.has\(params\.phase\)/);
  assert.match(
    helper,
    /cell\.id === fence\.cellId[\s\S]*?cell\.contentMode === 'browser'[\s\S]*?cell\.menubar === fence\.view/,
  );

  for (const source of [topMain, cellMain]) {
    const language = index(source, 'await initializeRendererLanguage();');
    const dynamicImport = index(source, "await import('./App.vue')", language);
    const mount = index(source, ".mount('#app')", dynamicImport);
    const nextTick = index(source, 'await nextTick();', mount);
    const reportReady = index(source, 'rendererMountedReady(identity)', nextTick);
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
  assert.match(helper, /createWebContentsView\([\s\S]*?'omniWindow'[\s\S]*?getRendererReadyArguments\(topRendererReady\)[\s\S]*?true,[\s\S]*?topRendererReady/);
  assert.match(helper, /createWebContentsView\('omniCell',[\s\S]*?getRendererReadyArguments\(rendererReadyFence\)[\s\S]*?\], true, rendererReadyFence/);
  assert.match(localFactory, /backgroundThrottling: !startupUnthrottled/);
  assert.match(helper, /createBrowserCellContentView[\s\S]*?backgroundThrottling: true/);
  assert.match(helper, /createMiniAppCellContentView[\s\S]*?backgroundThrottling: true/);
  assert.match(helper, /rendererReadyFences\.delete\(fence\.token\)[\s\S]*?fence\.view\.webContents\.setBackgroundThrottling\(true\)[\s\S]*?fence\.resolve\(\)/);
  assert.match(helper, /bindRendererReadyFenceView[\s\S]*?did-fail-load[\s\S]*?unresponsive[\s\S]*?responsive[\s\S]*?render-process-gone/);
  assert.match(helper, /disposeRendererReadyFenceLifecycle[\s\S]*?removeListener\('did-fail-load'[\s\S]*?removeListener\('unresponsive'[\s\S]*?removeListener\('render-process-gone'/);
  assert.match(helper, /settleRendererReadyFenceIfReady[\s\S]*?fence\.loadPending[\s\S]*?fence\.mountPending[\s\S]*?setBackgroundThrottling\(true\)/);
  assert.match(helper, /fence\.mountPending = false;[\s\S]*?settleRendererReadyFenceIfReady\(fence\)/);
  assert.match(helper, /createControlView[\s\S]*?Boolean\(rendererReadyFence\)[\s\S]*?rendererReadyFence \?\? undefined/);
  assert.match(helper, /rendererReadyFence\.timeoutHandle = setTimeout[\s\S]*?'diagnostic-timeout'[\s\S]*?OMNI_OPEN_READY_TIMEOUT_MS/);
});

test('Omni defers initial content and Control until after local chrome presentation', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const present = helper.slice(helper.indexOf('present: (window, generation)'), helper.indexOf('cleanupIncomplete:'));
  const addCell = helper.slice(helper.indexOf('private addCell('), helper.indexOf('private configureBrowserCellContentView('));
  const toggle = helper.slice(helper.indexOf('toggleControl()'), helper.indexOf('getLayoutConfig()'));
  assert.match(present, /if \(!state\.firstVisible\) \{[\s\S]*?this\.show\(\)[\s\S]*?markOpenFirstVisible\(state, window\)/);
  assert.ok(index(present, 'this.show()') < index(present, 'this.startDeferredInitialContent(generation, state.trace.tag)'));
  assert.match(helper, /deferredInitialContent\.set\(creationGeneration, \[\]\)/);
  assert.match(addCell, /const startContent[\s\S]*?loadMiniAppCellContent[\s\S]*?loadURL\(url\)[\s\S]*?deferred\.push\(startContent\)/);
  assert.match(helper, /startDeferredInitialContent[\s\S]*?openCoordinator\.isCurrent\(generation\)[\s\S]*?deferredStartupRegistry\.schedule\(generation[\s\S]*?openCoordinator\.isCurrent\(generation\)[\s\S]*?for \(const task of tasks\)[\s\S]*?try \{[\s\S]*?task\(\)[\s\S]*?catch[\s\S]*?createControlView\(generation, parentTag\)[\s\S]*?catch[\s\S]*?if \(scheduled\) this\.deferredInitialContent\.delete\(generation\)/);
  assert.match(helper, /cleanupAllViews[\s\S]*?deferredInitialContent\.clear\(\)[\s\S]*?deferredStartupRegistry\.cancelAll\(\)/);
  assert.match(toggle, /if \(!this\.controlView \|\| !this\.isWebContentsAlive[\s\S]*?this\.createControlView\(\)[\s\S]*?setControlVisible/);
});

test('Omni open diagnostics are fixed, correlated, and do not change the readiness wait', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const handler = read('src/main/xpc/omniWindow.handler.ts');

  assert.match(helper, /createOmniOpenDiagnostics/);
  assert.match(helper, /trace\('open',[\s\S]*?route: 'api'[\s\S]*?mode,[\s\S]*?generation/);
  for (const phase of ['native', 'restore', 'first-visible', 'interactive', 'ready']) {
    assert.match(helper, new RegExp(`phase: '${phase}'`));
  }
  assert.match(helper, /getPendingRendererCounts[\s\S]*?pendingTopLoad[\s\S]*?pendingTopMount[\s\S]*?pendingBrowserLoad[\s\S]*?pendingBrowserMount/);
  assert.match(helper, /error instanceof OmniOpenTimeoutError/);
  assert.match(helper, /startDeferredInitialContent\(generation, state\.trace\.tag\)/);
  assert.match(helper, /parentTag: params\.parentTag \?\?[\s\S]*?openDiagnosticStates\.get/);
  assert.match(handler, /rendererOpenStage[\s\S]*?markRendererOpenStage\(params\)/);
  assert.match(helper, /params\.outcome !== 'success' && params\.outcome !== 'failure'/);
  assert.doesNotMatch(helper, /params\.outcome !== undefined[\s\S]*?params\.outcome !== 'success'/);

  const createWindow = helper.slice(
    helper.indexOf('private async createWindow('),
    helper.indexOf('private async requireViewLoad('),
  );
  const firstVisibleShow = index(createWindow, 'this.show();');
  const waitStart = index(createWindow, 'await Promise.all([', firstVisibleShow);
  const presentStart = index(helper, 'present: (window, generation)');
  const show = index(helper, 'this.show();', presentStart);
  const deferred = index(helper, 'this.startDeferredInitialContent', show);
  assert.ok(firstVisibleShow < waitStart);
  assert.ok(show < deferred);
});

test('Omni local lifecycle and deferred navigation diagnostics are exact-generation and bounded', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const factory = helper.slice(
    helper.indexOf('private createWebContentsView('),
    helper.indexOf('\n}', helper.indexOf('private createWebContentsView(')),
  );

  const bind = index(factory, 'this.bindRendererReadyFenceView(rendererReadyFence, view)');
  const loadStart = index(factory, "'load-start'", bind);
  const loadCall = Math.min(
    index(factory, 'view.webContents.loadURL', loadStart),
    index(factory, 'view.webContents.loadFile', loadStart),
  );
  assert.ok(bind < loadStart);
  assert.ok(loadStart < loadCall);
  assert.match(helper, /isCreationActive\(fence\.generation\)/);
  assert.match(helper, /beginDeferredNavigationDiagnostic[\s\S]*?phase: 'scheduled'/);
  assert.match(helper, /startDeferredNavigationDiagnostic\(deferredNavigation\)[\s\S]*?loadURL\(url\)/);
  assert.match(helper, /contentMode === 'miniapp'[\s\S]*?startDeferredNavigationDiagnostic\(deferredNavigation\)[\s\S]*?armDeferredNavigationTimeout\(deferredNavigation\)[\s\S]*?loadMiniAppCellContent[\s\S]*?finishDeferredNavigationDiagnostic\(deferredNavigation, outcome\)/);
  assert.match(helper, /finishDeferredNavigationDiagnostic[\s\S]*?'success' \| 'failure' \| 'timeout' \| 'superseded'/);
  assert.match(helper, /for \(const navigation of \[\.\.\.this\.deferredNavigationDiagnostics\]\)[\s\S]*?'superseded'/);
  assert.match(
    helper,
    /if \(aborted\) \{[\s\S]*?finishDeferredNavigationDiagnostic\(deferredNavigation, 'superseded'\);[\s\S]*?return;[\s\S]*?if \(!this\.isWebContentsAlive\(content\.webContents\)\) \{[\s\S]*?_loadSemaphore\.release\(\)/,
  );
  assert.doesNotMatch(
    helper,
    /if \(aborted \|\| !this\.isWebContentsAlive\(content\.webContents\)\) \{[\s\S]*?_loadSemaphore\.release\(\)/,
  );
  assert.match(
    helper,
    /browserLoadResources = new Set<[\s\S]*?createOmniExactOnceResource[\s\S]*?for \(const resource of \[\.\.\.this\.browserLoadResources\]\) resource\.close\(\);[\s\S]*?this\.browserLoadResources\.clear\(\);[\s\S]*?_loadSemaphore\.drain\(\)/,
  );
  assert.match(
    helper,
    /const resources = createOmniExactOnceResource\(\);[\s\S]*?browserLoadResources\.add\(resources\);[\s\S]*?resources\.add\(\(\) => this\.browserLoadResources\.delete\(resources\)\);[\s\S]*?resources\.add\(\(\) => this\._loadSemaphore\.release\(\)\)/,
  );
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
