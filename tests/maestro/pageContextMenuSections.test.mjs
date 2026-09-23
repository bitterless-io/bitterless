/* eslint-disable @typescript-eslint/explicit-function-return-type */
// ══ 行为守卫 ══ 网页右键菜单的分段规则
//
// 契约:docs/issues/page-context-menu-shows-navigation-on-a-link.md
//
// `showPageMenu` 建的是**原生** `Menu`,不经过 DOM,单测跑不起来一个真 `Menu.popup`,所以这里读源码
// 钉三件「漏了不报错、只有右击那一下才看得见」的事:
//  ① 导航段被 `!targetSections.length` 闸住 —— 少了这一闸,链接/图片菜单上又会长出 Back / Reload;
//  ② Back / Forward 只在**网页** tab 那一支 —— mini app 没有浏览历史,摆上去永远是灰的;
//  ③ 目标段进的是 `targetSections` 而不是 `sections` —— 直接 push 进 `sections` 的话,①的判据
//     读到的就永远是 0,闸形同虚设。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVICE = 'src/main/maestro/windows/main/maestroBrowserView.service.ts';
// 反向断言读去注释的源码:解释守卫为什么存在的注释本身会把它匹配红。
const source = readFileSync(join(projectRoot, SERVICE), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const body = source.match(/private showPageMenu\([\s\S]*?\n  \}/)?.[0] ?? '';

test('showPageMenu is still one sliceable method', () => {
  assert.ok(body, `${SERVICE}: could not slice showPageMenu(); this guard checks nothing without it`);
});

test('navigation only appears when the right-click hit no target', () => {
  assert.match(
    body,
    /if \(!targetSections\.length\) \{[\s\S]*?label: 'Back'/,
    `${SERVICE}: Back/Forward/Reload must sit behind the "no target section" gate — a link or image menu ` +
      'carries no navigation in Chrome, which is exactly what Ral reported on 2026-09-23.'
  );
});

test('a mini app gets Reload but never Back or Forward', () => {
  const gate = body.match(/historyLocked\s*\?([\s\S]*?):([\s\S]*?)\n\s*\)/);
  assert.ok(gate, `${SERVICE}: expected the historyLocked ternary that splits mini app from web page`);
  const [, miniApp, webPage] = gate;
  assert.ok(!/label: 'Back'/.test(miniApp), 'a mini app must not offer Back — it has no browsing history');
  assert.ok(!/label: 'Forward'/.test(miniApp), 'a mini app must not offer Forward');
  assert.match(miniApp, /reload/, 'a mini app keeps Reload');
  assert.match(webPage, /label: 'Back'/, 'a web page keeps Back');
  assert.match(webPage, /label: 'Forward'/, 'a web page keeps Forward');
});

test('every target section is collected before the gate, not pushed straight onto the menu', () => {
  for (const label of ['Open link in new tab', 'Open image in new tab', 'Cut', 'Copy link address']) {
    const line = body.split('\n').find((row) => row.includes(`label: '${label}'`));
    assert.ok(line, `${SERVICE}: lost the "${label}" item`);
  }
  // 目标段一律进 targetSections;`sections.push` 只剩导航段、展开 targetSections、以及 Inspect。
  assert.equal(
    (body.match(/targetSections\.push\(/g) || []).length,
    4,
    `${SERVICE}: expected exactly four target sections (link, image, editable, selection)`
  );
  assert.match(
    body,
    /sections\.push\(\.\.\.targetSections\)/,
    `${SERVICE}: the collected target sections must still reach the menu`
  );
});
