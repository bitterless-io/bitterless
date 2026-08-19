/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { OMNI_MINI_APP_RUNTIME } from '../../src/main/windows/omniMiniAppRuntime.service.ts';
import {
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_IDS,
  parseOmniLayoutConfig,
  parseOmniMiniAppId
} from '../../src/shared/omni/omni.types.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Submodules is the sixth bounded Omni mini app and survives persisted round trips', () => {
  assert.deepEqual(OMNI_MINI_APP_IDS, [
    'todo',
    'eyesOnAgents',
    'translator',
    'motto',
    'trench',
    'submodules'
  ]);
  assert.equal(parseOmniMiniAppId('submodules'), 'submodules');
  assert.equal(OMNI_MINI_APP_DISPLAY_URLS.submodules, 'bl://miniapp/submodules');

  const persisted = {
    tree: {
      id: 'submodules-cell',
      type: 'leaf',
      url: 'https://preserved.example.test/workspace',
      contentMode: 'miniapp',
      miniAppId: 'submodules'
    }
  };
  const first = parseOmniLayoutConfig(persisted);
  const second = parseOmniLayoutConfig(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, persisted);
  assert.throws(() => parseOmniMiniAppId('onlypreview'), /Unsupported Omni mini app: onlypreview/);
});

test('Submodules reuses its own renderer and preload without becoming a sandboxed runtime', () => {
  assert.deepEqual(Object.keys(OMNI_MINI_APP_RUNTIME), OMNI_MINI_APP_IDS);
  assert.deepEqual(OMNI_MINI_APP_RUNTIME.submodules, {
    preloadFile: 'submodules.js',
    rendererName: 'submodules',
    sandbox: false
  });
  assert.deepEqual(
    Object.entries(OMNI_MINI_APP_RUNTIME)
      .filter(([, runtime]) => runtime.sandbox)
      .map(([id]) => id),
    ['trench'],
    'Trench must remain the only sandboxed mini-app runtime'
  );
});

test('the Submodules preload carries host context and the shared Omni active-frame SDK', () => {
  const preload = read('src/preload/submodules/submodules.preload.ts');
  assert.match(preload, /import '\.\.\/omni\/omniCellActiveFrame\.sdk';/);
  assert.match(
    preload,
    /host:\s*process\.argv\.includes\('--mode=omni'\)\s*\?\s*'omni'\s*:\s*'standalone'/
  );
  assert.match(preload, /contextBridge\.exposeInMainWorld\('submodulesEnv', submodulesEnvApi\)/);

  const bridge = read('src/renderer/submodules/src/contextBridge/submodulesEnv.bridge.ts');
  assert.match(bridge, /submodulesEnv as SubmodulesEnvApi/);

  const shared = read('src/shared/submodules/submodules.type.ts');
  assert.match(shared, /export type SubmodulesHost = 'standalone' \| 'omni';/);
});

test('an embedded Submodules cell drops every standalone-window affordance', () => {
  const menuBar = read(
    'src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.vue'
  );
  const menuBarStyle = read(
    'src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.less'
  );
  const app = read('src/renderer/submodules/src/App.vue');

  assert.match(menuBar, /const isOmni = submodulesEnv\?\.host === 'omni';/);
  assert.match(menuBar, /'submodules-menu-bar--mac': isMac && !isOmni/);
  assert.match(menuBar, /'submodules-menu-bar--windows': isWindows && !isOmni/);
  assert.match(menuBar, /'submodules-menu-bar--omni': isOmni/);
  assert.match(menuBar, /<template v-if="isWindows && !isOmni">/);

  // Every SubmodulesWindowApi call must sit behind a non-Omni guard: the three Windows controls in
  // the guarded template block, and the double-click handler that returns first.
  const doubleClick = menuBar.slice(menuBar.indexOf('const handleDoubleClick'));
  assert.match(
    doubleClick,
    /if \(isOmni\) return;[\s\S]*submodulesWindowEmitter\.toggleMaximize\(\)/
  );
  // The group's own closing tag sits at its 6-space indentation; every `<template #icon>` inside a
  // button closes on one deeper-indented line.
  const windowControlsStart = menuBar.indexOf('\n      <template v-if="isWindows && !isOmni">');
  const windowControls = menuBar.slice(
    windowControlsStart,
    menuBar.indexOf('\n      </template>', windowControlsStart)
  );
  for (const call of ['minimize()', 'toggleMaximize()', 'close()']) {
    assert.ok(
      windowControls.includes(`submodulesWindowEmitter.${call}`),
      `${call} must stay inside the guarded window-control group`
    );
  }
  assert.equal(
    [...menuBar.matchAll(/submodulesWindowEmitter\.\w+\(/g)].length,
    4,
    'the menu bar owns exactly the three Windows controls and the double-click maximize'
  );
  assert.doesNotMatch(app, /submodulesWindowEmitter/);

  assert.match(menuBarStyle, /\.submodules-menu-bar\s*\{[^}]*-webkit-app-region:\s*drag;/s);
  assert.match(menuBarStyle, /\.submodules-menu-bar--mac\s*\{[^}]*padding-left:\s*78px;/s);
  assert.match(
    menuBarStyle,
    /\.submodules-menu-bar--omni\s*\{[^}]*padding:\s*0 10px;[^}]*-webkit-app-region:\s*no-drag;/s
  );

  // Open… and Refresh are product capability, never host-conditional.
  assert.match(menuBar, /name="submodules__menuBar__open"[\s\S]*?submodulesStore\.chooseRoot\(\)/);
  assert.match(menuBar, /name="submodules__menuBar__refresh"[\s\S]*?submodulesStore\.refresh\(\)/);
  assert.doesNotMatch(
    menuBar.slice(menuBar.indexOf('name="submodules__menuBar__open"'), windowControlsStart),
    /isOmni/
  );
});

test('the directory dialog parents to the focused BaseWindow so Omni cells stay attached', () => {
  const systemHandler = read('src/main/xpc/submodulesSystem.handler.ts');
  assert.match(systemHandler, /import \{ BaseWindow, dialog \} from 'electron';/);
  assert.match(systemHandler, /const parent = BaseWindow\.getFocusedWindow\(\);/);
  assert.doesNotMatch(systemHandler, /BrowserWindow\.getFocusedWindow\(\)/);
});

test('Omni Control offers Submodules as a localized sixth mini app', () => {
  const control = read('src/renderer/omni/omniControl/src/components/OmniPane.vue');
  const en = read('src/renderer/common/i18n/en.ts');
  const zh = read('src/renderer/common/i18n/zh.ts');

  const entries = [
    ...control.matchAll(/\bid:\s*'(todo|eyesOnAgents|translator|motto|trench|submodules)'/g)
  ].map((match) => match[1]);
  assert.deepEqual(entries, OMNI_MINI_APP_IDS);
  assert.match(control, /submodulesIcon from '@renderer\/common\/assets\/icons\/submodules\.svg'/);
  assert.match(control, /i18nHelper\.miniApp\.submodules\.name/);
  assert.match(en, /submodules:\s*\{\s*name:\s*'Submodules'/);
  assert.match(zh, /submodules:\s*\{\s*name:\s*'Submodules'/);
  assert.doesNotMatch(control, /class="[^"]*\b(?:flex|grid|p-\d|m-\d|text-\w+-\d)\b/);
});

test('the build graph declares the Submodules preload and renderer entries', () => {
  const vite = read('electron.vite.config.ts');
  assert.match(
    vite,
    /submodules:\s*resolve\('src\/preload\/submodules\/submodules\.preload\.ts'\)/
  );
  assert.match(vite, /submodules:\s*resolve\('src\/renderer\/submodules\/index\.html'\)/);
  assert.match(vite, /submodulesDevCspPlugin/);
});

test('the production build carries the Submodules preload and renderer targets', (t) => {
  const preloadTarget = new URL('../../out/preload/submodules.js', import.meta.url);
  if (!existsSync(preloadTarget)) {
    t.skip('no production build in out/; run yarn build before this assertion');
    return;
  }
  for (const relativePath of [
    'out/preload/submodules.js',
    'out/renderer/submodules/index.html',
    'out/renderer/omni/omniControl/index.html'
  ]) {
    const target = new URL(`../../${relativePath}`, import.meta.url);
    assert.equal(existsSync(target), true, `${relativePath} must exist after the production build`);
    assert.equal(statSync(target).isFile(), true);
    assert.ok(statSync(target).size > 0, `${relativePath} must not be empty`);
  }
});
