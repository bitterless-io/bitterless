/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 契约:docs/issues/refocusing-the-window-steals-focus-into-the-address-bar.md
//
// Ral 给的复现前提就是判据表:**先聚焦网页内容**再切走再切回来才要还焦点;只点过 tab
// (焦点在 chrome)的那一路一动都不能动 —— 动了就把人敲了一半的 URL 和光标抢走。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundled = await build({
  stdin: {
    contents: `
      export { attachContentFocusRestore } from './src/main/maestro/windows/main/contentFocusRestore.service.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json')
});
const encoded = Buffer.from(bundled.outputFiles[0].text).toString('base64');
const { attachContentFocusRestore } = await import(`data:text/javascript;base64,${encoded}`);

const createHarness = (contents) => {
  const handlers = new Map();
  const win = { on: (name, handler) => handlers.set(name, handler) };
  attachContentFocusRestore(win, () => contents.current);
  return {
    blur: () => handlers.get('blur')(),
    focus: () => handlers.get('focus')()
  };
};

const createContents = (overrides = {}) => ({
  focusCount: 0,
  destroyed: false,
  focused: false,
  isDestroyed() {
    return this.destroyed;
  },
  isFocused() {
    return this.focused;
  },
  focus() {
    this.focusCount += 1;
  },
  ...overrides
});

test('content that held focus when the window went away gets it back', () => {
  const page = createContents({ focused: true });
  const contents = { current: page };
  const harness = createHarness(contents);
  harness.blur();
  page.focused = false; // macOS 把 first responder 还给了窗口自己的 web view
  harness.focus();
  assert.equal(page.focusCount, 1);
});

test('a chrome-focused window is left alone — the address bar keeps the caret', () => {
  const page = createContents({ focused: false });
  const contents = { current: page };
  const harness = createHarness(contents);
  harness.blur();
  harness.focus();
  assert.equal(page.focusCount, 0);
});

test('restoring is armed once per deactivation', () => {
  const page = createContents({ focused: true });
  const harness = createHarness({ current: page });
  harness.blur();
  page.focused = false;
  harness.focus();
  harness.focus();
  assert.equal(page.focusCount, 1);
});

test('a tab switched or closed while away is not fought over', () => {
  const page = createContents({ focused: true });
  const contents = { current: page };
  const harness = createHarness(contents);
  harness.blur();
  contents.current = null; // composite tab / tab closed
  harness.focus();
  assert.equal(page.focusCount, 0);

  const destroyed = createContents({ focused: true });
  const second = { current: destroyed };
  const other = createHarness(second);
  other.blur();
  destroyed.destroyed = true;
  other.focus();
  assert.equal(destroyed.focusCount, 0);
});

test('content that already has focus on reactivation is not re-focused', () => {
  const page = createContents({ focused: true });
  const harness = createHarness({ current: page });
  harness.blur();
  harness.focus();
  assert.equal(page.focusCount, 0);
});

test('a composite tab (no content view) never arms the restore', () => {
  const contents = { current: null };
  const harness = createHarness(contents);
  harness.blur();
  contents.current = createContents({ focused: false });
  harness.focus();
  assert.equal(contents.current.focusCount, 0);
});
