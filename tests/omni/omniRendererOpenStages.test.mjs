import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const index = (source, fragment, fromIndex = 0) => {
  const value = source.indexOf(fragment, fromIndex);
  assert.notEqual(value, -1, `missing source fragment: ${fragment}`);
  return value;
};

test('Omni preload accepts the fixed Control readiness role', () => {
  const preload = read('src/preload/omni/omni.preload.ts');

  assert.match(preload, /readyRole: 'window' \| 'browser-cell' \| 'control' \| null/);
  assert.match(preload, /readyRoleValue === 'control'/);
});

test('Omni first-party renderers report bootstrap stages without delaying final readiness', () => {
  const renderers = [
    read('src/renderer/omni/omniWindow/src/main.ts'),
    read('src/renderer/omni/omniCell/src/main.ts'),
    read('src/renderer/omni/omniControl/src/main.ts'),
  ];

  for (const source of renderers) {
    assert.match(
      source,
      /void omniWindowEmitter\.rendererOpenStage\([\s\S]*?\)\.catch\(\(\) => \{\}\)/,
    );
    const script = index(source, "reportRendererOpenStage(identity, 'renderer-script')");
    const languageInit = index(source, 'await initializeRendererLanguage()', script);
    const language = index(source, "reportRendererOpenStage(identity, 'renderer-language')", languageInit);
    const dynamicImport = index(source, "await import('./App.vue')", language);
    const imported = index(source, "reportRendererOpenStage(identity, 'renderer-import')", dynamicImport);
    const mount = index(source, ".mount('#app')", imported);
    const nextTick = index(source, 'await nextTick()', mount);
    const mounted = index(source, "reportRendererOpenStage(identity, 'renderer-mount')", nextTick);
    const ready = index(source, 'await omniWindowEmitter.rendererMountedReady(identity)', mounted);
    assert.ok(script < languageInit);
    assert.ok(languageInit < language);
    assert.ok(language < dynamicImport);
    assert.ok(dynamicImport < imported);
    assert.ok(imported < mount);
    assert.ok(mount < nextTick);
    assert.ok(nextTick < mounted);
    assert.ok(mounted < ready);
    assert.match(source, /if \(!result\?\.accepted\) return/);
    assert.match(source, /void bootstrap\(\)\.catch\(\(\) => \{\}\)/);
    assert.match(
      source,
      /catch \{[\s\S]*?reportRendererOpenStage\(identity, phase, 'failure'\)/,
    );
    assert.doesNotMatch(source, /Stale renderer readiness identity/);
  }
});

test('Omni Control reports async layout readiness as a separate fixed local stage', () => {
  const main = read('src/renderer/omni/omniControl/src/main.ts');
  const app = read('src/renderer/omni/omniControl/src/App.vue');

  const promise = index(main, 'const layoutReady = new Promise<void>');
  const listener = index(main, "addEventListener('omni-control-layout-ready'", promise);
  const mount = index(main, ".mount('#app')", listener);
  const nextTick = index(main, 'await nextTick()', mount);
  const wait = index(main, 'await layoutReady', nextTick);
  const layoutStage = index(main, "reportRendererOpenStage(identity, 'layout-ready')", wait);
  const receipt = index(main, 'await omniWindowEmitter.rendererMountedReady(identity)', layoutStage);
  assert.ok(listener < mount);
  assert.ok(mount < nextTick);
  assert.ok(nextTick < wait);
  assert.ok(wait < layoutStage);
  assert.ok(layoutStage < receipt);

  const load = index(app, 'await layoutStore.loadLayout()');
  const finallyBlock = index(app, 'finally', load);
  const dispatch = index(
    app,
    "dispatchEvent(new Event('omni-control-layout-ready'))",
    finallyBlock,
  );
  assert.ok(load < finallyBlock);
  assert.ok(finallyBlock < dispatch);
});
