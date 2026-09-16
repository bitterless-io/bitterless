/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const menuSource = source('src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue');
const menuStyleSource = source('src/renderer/maestro/home/src/components/MenuBar/MenuBar.less');
const controllerSource = source('src/main/maestro/windows/main/maestroWindow.controller.ts');

const rule = (selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = menuStyleSource.match(new RegExp(`${escapedSelector} \\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector} style`);
  return match[1];
};

test('Maestro top chrome is a 36px tab strip plus a compact 42px address row', () => {
  assert.match(rule('.maestro-menu-bar'), /height: 78px;/);
  assert.match(rule('.maestro-menu-bar__tabs'), /height: 36px;/);
  assert.match(rule('.maestro-menu-bar__address-row'), /height: 42px;/);
  assert.match(menuSource, /78px top chrome = .*36px tab strip \+ .*42px address bar/);
});

test('address controls use Cowork geometry at its 13px root font size', () => {
  assert.match(rule('.maestro-menu-bar__navigation'), /height: 29\.25px;/);
  assert.match(rule('.maestro-menu-bar__navigation'), /padding: 1\.625px;/);
  assert.match(rule('.maestro-menu-bar__address'), /height: 26px;/);

  const sharedActions = rule(
    '.maestro-menu-bar__nav-button,\n.maestro-menu-bar__snapshot'
  );
  assert.match(sharedActions, /width: 26px;/);
  assert.match(sharedActions, /height: 26px;/);
  assert.match(sharedActions, /padding: 0;/);
  assert.match(sharedActions, /font-size: 13px;/);

  const historyButton = rule('.maestro-menu-bar__address-row .maestro-menu-bar__history.icon-btn.arco-btn');
  assert.match(historyButton, /min-width: 26px;/);
  assert.match(historyButton, /flex: 0 0 26px;/);
});

test('Main first-frame native view fallback starts below the 78px chrome', () => {
  assert.match(controllerSource, /const TOOLBAR_H = 78/);
  assert.match(controllerSource, /36px tab strip plus the compact\s*\/\/ 42px address row total 78px/);
  assert.match(controllerSource, /y: TOOLBAR_H/);
  assert.match(controllerSource, /h - TOOLBAR_H/);
});
