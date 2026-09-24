/* eslint-disable @typescript-eslint/explicit-function-return-type */
// ══ 行为守卫 ══ ⌘W 必须由菜单项拥有,仲裁不得依赖「有没有 webContents 持焦」
//
// 契约:docs/issues/cmd-w-falls-through-to-the-menu-when-focus-is-nowhere.md
//
// 这条只有在**焦点交接的空档里**按下 ⌘W 才复现,typecheck、评审、任何单测都看不见它 —— 症状却是
// 整扇主窗关掉。所以这里读源码钉四件事:
//  ① 菜单模板里不能再出现 `fileMenu` / `role: 'close'` —— macOS 默认 `fileMenu` 的全部内容就是那个
//     绑着 ⌘W 的 close,它一回来,兜底就又变成「关窗」;
//  ② Close 项显式带 `Command+W`,且 click 落到仲裁上(而不是直接 `window.close()`);
//  ③ 仲裁的四条判据齐全**且次序正确**:守卫 → 终端 → 本窗关 tab → 其余窗关窗口;
//  ④ 两条路(菜单项 / before-input-event)共用同一个去重窗口,否则一次 ⌘W 会关掉两个 tab。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MENU = 'src/main/menu/applicationFindMenu.service.ts';
const HELPER = 'src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts';
// 反向断言读去注释的源码:解释守卫为什么存在的注释本身会把它匹配红。
const read = (relativePath) =>
  readFileSync(join(projectRoot, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const menu = read(MENU);
const helper = read(HELPER);

test('the application menu no longer inherits the window-close accelerator', () => {
  assert.ok(
    !/role: 'fileMenu'/.test(menu),
    `${MENU}: macOS's default fileMenu is exactly one role: 'close' bound to ⌘W — inheriting it puts ` +
      'the "close the whole window" fallback back under every focus handover gap.'
  );
  assert.ok(!/role: 'close'/.test(menu), `${MENU}: no menu item may carry role: 'close'`);
});

test('a File ▸ Close item owns Command+W and routes to the arbitration', () => {
  const item = menu.match(/label: 'Close',[\s\S]{0,400}?\n {6}\}/)?.[0] ?? '';
  assert.ok(item, `${MENU}: expected an explicit File ▸ Close item`);
  assert.match(item, /accelerator: 'Command\+W'/, `${MENU}: the Close item must OWN ⌘W`);
  assert.match(item, /windowCloseDispatch\(\)/, `${MENU}: Close must go through the registered arbitration`);
});

test('the arbitration asks four questions, in the order that makes them true', () => {
  const body = helper.match(/export const dispatchWindowCloseShortcut[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(body, `${HELPER}: could not slice dispatchWindowCloseShortcut(); this guard checks nothing`);
  const order = ['windowCloseGuards.has', 'terminalKeyboardOwners.has', 'ownsFocusedWindow()', 'window.close()'];
  let cursor = -1;
  for (const probe of order) {
    const at = body.indexOf(probe);
    assert.ok(at >= 0, `${HELPER}: the arbitration lost its "${probe}" branch`);
    assert.ok(at > cursor, `${HELPER}: "${probe}" must come after the branch before it — the order IS the rule`);
    cursor = at;
  }
  assert.match(
    body,
    /actions\.closeActiveTab\(\)/,
    `${HELPER}: the tabbed window must close a TAB, not the window`
  );
  // 判据不许回头去问「谁持焦」—— 那正是这次缺陷的成因。
  assert.ok(
    !/before-input-event/.test(body),
    `${HELPER}: the arbitration must not depend on a focused webContents`
  );
});

test('the menu path and the key path share one dedupe window', () => {
  assert.match(
    helper,
    /const claimShortcut = \(key: string\): boolean =>/,
    `${HELPER}: expected the shared dedupe helper`
  );
  const dispatch = helper.match(/export const dispatchWindowCloseShortcut[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(dispatch, /claimShortcut\('w'\)/, `${HELPER}: the menu path must claim through the shared window`);
  const run = helper.match(/const runShortcut =[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(run, /claimShortcut\(key\)/, `${HELPER}: before-input-event must claim through the same window`);
  assert.ok(
    !/lastShortcutAt\.set/.test(run),
    `${HELPER}: runShortcut must not keep a second dedupe clock — one ⌘W would then close two tabs`
  );
});
