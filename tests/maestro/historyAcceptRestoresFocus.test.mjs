/* eslint-disable @typescript-eslint/explicit-function-return-type */
// ══ 行为守卫 ══ 选中一条历史记录之后,窗口里必须仍然有人持有键盘焦点
//
// 契约:docs/issues/history-accept-leaves-the-window-without-keyboard-focus.md
//
// 这条只在「点过下拉 → 它被摘掉 → 谁都没接住焦点」时成立,而症状分布在别处:打字不进地址栏、
// ⌘W 落到菜单上关掉整扇窗。没有任何 typecheck 或既有单测看得见它,所以这里读源码钉四件事:
//  ① `accept` 的历史记录分支要把焦点还回去 —— 它原来是三个分支里唯一漏掉的那个;
//  ② 还焦点必须**先要原生焦点**(`popup.focusHost()`)再设 DOM 焦点,否则只画出一个焦点环;
//  ③ 两步都在 `focusSuppressed` 之内 —— 地址栏重新得到焦点会触发 `@focus`,那正是「刚选完一行、
//     下拉又弹开」的来路;
//  ④ main 侧确实提供了 `focusHost()`,而且它做的是 `win.webContents.focus()`。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STORE = 'src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts';
const SERVICE = 'src/main/maestro/windows/main/maestroHistoryView.service.ts';
const API = 'src/shared/maestro/browserHistoryPopup.api.ts';
// 反向断言读去注释的源码:解释守卫为什么存在的注释本身会把它匹配红。
const read = (relativePath) =>
  readFileSync(join(projectRoot, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const store = read(STORE);
const service = read(SERVICE);

test('the popup contract exposes a way to hand native focus back', () => {
  assert.match(read(API), /focusHost\(\): Promise<void>;/, `${API}: the contract lost focusHost()`);
  const body = service.match(/focusHost\(\): void \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.ok(body, `${SERVICE}: focusHost() is gone — the renderer can no longer reclaim native focus`);
  assert.match(body, /this\.win\.webContents\.focus\(\)/, `${SERVICE}: focusHost must focus the HOST page`);
});

test('reclaiming focus asks for native focus before touching the DOM', () => {
  const body = store.match(/async focusInput\(\): Promise<void> \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.ok(body, `${STORE}: could not slice focusInput(); this guard checks nothing without it`);
  const nativeAt = body.indexOf('popup.focusHost()');
  const domAt = body.indexOf('this.input?.focus()');
  assert.ok(nativeAt >= 0, `${STORE}: focusInput must reclaim NATIVE focus — a DOM focus alone only draws a ring`);
  assert.ok(domAt >= 0, `${STORE}: focusInput must still set DOM focus`);
  assert.ok(nativeAt < domAt, `${STORE}: native focus has to land first, or the DOM focus lands on an unfocused document`);
  // 压制必须把两步都包住:地址栏一拿到焦点就会触发 `@focus` → `focus()` → 下拉重开。
  const suppressOn = body.indexOf('this.focusSuppressed = true');
  const suppressOff = body.indexOf('this.focusSuppressed = false');
  assert.ok(suppressOn >= 0 && suppressOff > domAt, `${STORE}: both steps must sit inside focusSuppressed`);
  assert.ok(suppressOn < nativeAt, `${STORE}: suppression has to start before the native focus request`);
});

test('accepting a history row hands focus back, like remove and retry already did', () => {
  const accept = store.match(/if \(isHistoryRow\) \{[\s\S]*?\n {6}\}/)?.[0] ?? '';
  assert.ok(accept, `${STORE}: could not slice the history-row branch of accept`);
  assert.match(
    accept,
    /this\.focusInput\(\)/,
    `${STORE}: the history-row branch must reclaim focus — leaving it out is what emptied the window's ` +
      'keyboard focus and let ⌘W close the whole window (Ral 2026-09-23).'
  );
});

test('every branch that ends an interaction reclaims focus', () => {
  // toggle / retry / remove 早就这么做了;这条守住它们不被回退,也守住 accept 与它们一致。
  assert.equal(
    (store.match(/this\.focusInput\(\)/g) || []).length,
    4,
    `${STORE}: expected exactly four focus handbacks (toggle, retry, accept's history row, remove)`
  );
});
