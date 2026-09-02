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
  const match = menuStyleSource.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing ${selector} style`);
  return match[1];
};

test('Maestro top chrome is a 36px tab strip plus a compact 42px address row', () => {
  assert.match(rule('.maestro-menu-bar'), /height: 78px;/);
  assert.match(rule('.maestro-menu-bar__tabs'), /height: 36px;/);
  assert.match(rule('.maestro-menu-bar__address-row'), /height: 42px;/);
  assert.match(menuSource, /78px top chrome = .*36px tab strip \+ .*42px address bar/);
});

test('navigation and address share a 28px box while only grouped nav buttons shrink', () => {
  assert.match(rule('.maestro-menu-bar__navigation'), /height: 28px;/);
  assert.match(rule('.maestro-menu-bar__navigation'), /padding: 2px;/);
  assert.match(rule('.maestro-menu-bar__address'), /height: 28px;/);

  const groupedButtons = rule(
    '.maestro-menu-bar__navigation .maestro-menu-bar__nav-button'
  );
  assert.match(groupedButtons, /width: 24px;/);
  assert.match(groupedButtons, /height: 24px;/);

  const sharedActions = rule(
    '.maestro-menu-bar__nav-button,\n.maestro-menu-bar__snapshot'
  );
  assert.match(sharedActions, /width: 32px;/);
  assert.match(sharedActions, /height: 32px;/);
});

test('Main first-frame native view fallback starts below the 78px chrome', () => {
  assert.match(controllerSource, /const TOOLBAR_H = 78/);
  assert.match(controllerSource, /36px tab strip plus the compact\s*\/\/ 42px address row total 78px/);
  assert.match(controllerSource, /y: TOOLBAR_H/);
  assert.match(controllerSource, /h - TOOLBAR_H/);
});
