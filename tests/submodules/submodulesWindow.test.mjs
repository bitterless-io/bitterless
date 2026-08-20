/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const handler = () => read('src/main/xpc/submodulesWindow.handler.ts');

test('the standalone window keeps the documented 480px minimum, restore included', () => {
  const source = handler();

  assert.match(source, /const SUBMODULES_MIN_WIDTH = 480;/);
  assert.match(source, /const SUBMODULES_MIN_HEIGHT = 600;/);
  assert.match(source, /minWidth: SUBMODULES_MIN_WIDTH,\s*\n\s*minHeight: SUBMODULES_MIN_HEIGHT,/);
  assert.doesNotMatch(source, /minWidth: 800/);

  // A restored narrow width is clamped to the service default (800) unless both calls carry it.
  assert.match(source, /windowStateService\.resolve\(WINDOW_STATE_KEY, WINDOW_STATE_OPTIONS\)/);
  assert.match(
    source,
    /windowStateService\.register\(\s*WINDOW_STATE_KEY,\s*created,\s*WINDOW_STATE_OPTIONS\s*\)/
  );
});

test('debug DevTools opens after show and focus, never during creation', () => {
  const source = handler();

  // Creating the window must not open DevTools: `focus()` would raise the window over it.
  const createWindow = source.slice(source.indexOf('private async createWindow('));
  assert.doesNotMatch(createWindow, /openDevTools/);

  const open = source.slice(
    source.indexOf('async openSubmodulesWindow('),
    source.indexOf('async minimize(')
  );
  assert.equal([...open.matchAll(/this\.openDebugDevTools\(\);/g)].length, 2);
  for (const branch of [
    /current\.focus\(\);\s*\n\s*this\.openDebugDevTools\(\);/,
    /created\.focus\(\);\s*\n\s*this\.openDebugDevTools\(\);/
  ]) {
    assert.match(open, branch, 'DevTools must open after the window is shown and focused');
  }
});

test('the DevTools gate is the project debug gate and stays out of E2E', () => {
  const source = handler();
  const devTools = source.slice(source.indexOf('private openDebugDevTools('));
  const body = devTools.slice(0, devTools.indexOf('\n  }'));

  assert.match(
    body,
    /import\.meta\.env\.VITE_MODE !== 'debug' \|\| process\.env\.BITTERLESS_E2E === '1'/
  );
  // `is.dev` is not the debug authority in this project; a release profile must stay clean.
  assert.doesNotMatch(body, /is\.dev/);
  assert.match(body, /webContents\.isDevToolsOpened\(\)/);
  assert.match(body, /webContents\.openDevTools\(\{ mode: 'detach' \}\)/);
});
