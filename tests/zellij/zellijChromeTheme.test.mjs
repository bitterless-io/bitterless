/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
// Zellij chrome 的调色板必须和**终端自己**的调色板逐值相等。
//
// 契约:`docs/features/zellij-terminal-chrome.md` #1 / #1.1。
//
// 为什么需要一条测试而不是一个共享常量:这套颜色天然要在三种语言里各存一份 —— KDL(写进
// `config.kdl` 给 Zellij 的 web client)、TypeScript(main 在 CSS 生效前给 view/window 涂的底色)、
// Less(chrome 自己)。Less 没法 import 一个 TS 常量,KDL 那份是一段模板字符串。重复消不掉,
// 只能守住。
//
// 漏了会怎样:chrome 的背景与终端的背景差一点点,于是两块之间出现一条谁都没画过、但人眼立刻认得出
// 的分界 —— 而这正是「改成更 terminal 的效果」要消掉的那条线。typecheck 看不见,截图不比对也看不见。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const KDL = 'src/main/zellij/zellijDefaultConfig.constant.ts';
const LESS = 'src/renderer/zellij/src/App.less';
const SHARED = 'src/shared/zellij/zellij.type.ts';

/** `web_client { ... theme { <slot> "#rrggbb" ... } }` —— 终端真正在用的那一套。 */
const terminalPalette = () => {
  const source = read(KDL);
  const block = source.match(/web_client \{[\s\S]*?theme \{([\s\S]*?)\n {4}\}/)?.[1];
  assert(block, `${KDL}: could not locate the web_client theme block`);
  const palette = new Map();
  for (const [, slot, hex] of block.matchAll(/^\s*([a-z_]+)\s+"(#[0-9a-fA-F]{6})"\s*$/gm)) {
    palette.set(slot, hex.toLowerCase());
  }
  assert(palette.size > 0, `${KDL}: parsed an EMPTY palette — the block shape changed, fix this parser`);
  return palette;
};

/** `@zellij-<name>: #rrggbb;` —— chrome 自己那份副本。 */
const chromePalette = () => {
  const palette = new Map();
  for (const [, name, hex] of read(LESS).matchAll(/^@zellij-([a-z-]+):\s*(#[0-9a-fA-F]{6});$/gm)) {
    palette.set(name, hex.toLowerCase());
  }
  assert(palette.size > 0, `${LESS}: parsed an EMPTY palette — the variable shape changed, fix this parser`);
  return palette;
};

// chrome 变量名 → 终端调色板槽位。左边是 Less 里的 `@zellij-<name>`,右边是 `web_client.theme` 的槽。
const MAPPING = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['green', 'green'],
  ['white', 'white'],
  ['bright-black', 'bright_black'],
  ['red', 'red'],
  ['yellow', 'yellow']
];

test('the chrome palette is the terminal palette, value for value', () => {
  const terminal = terminalPalette();
  const chrome = chromePalette();
  for (const [chromeName, terminalSlot] of MAPPING) {
    const expected = terminal.get(terminalSlot);
    assert(expected, `${KDL}: web_client.theme is missing the "${terminalSlot}" slot`);
    assert.equal(
      chrome.get(chromeName),
      expected,
      `${LESS}: @zellij-${chromeName} must equal the terminal's ${terminalSlot} (${expected}). ` +
        'The chrome sits directly above the terminal; any difference draws a seam between them.'
    );
  }
});

test('every chrome palette variable is accounted for — no unmapped colour sneaks in', () => {
  const chrome = chromePalette();
  const mapped = new Set(MAPPING.map(([name]) => name));
  for (const name of chrome.keys()) {
    assert(
      mapped.has(name),
      `${LESS}: @zellij-${name} is not mapped to a terminal palette slot. Either map it here or drop it — ` +
        'a hand-picked colour beside the terminal palette is exactly the drift this test exists to stop.'
    );
  }
});

test('the pre-paint background constant main uses matches the terminal background', () => {
  const declared = read(SHARED).match(/ZELLIJ_CHROME_BACKGROUND = '(#[0-9a-fA-F]{6})'/)?.[1];
  assert(declared, `${SHARED}: expected ZELLIJ_CHROME_BACKGROUND to be a hex literal`);
  assert.equal(
    declared.toLowerCase(),
    terminalPalette().get('background'),
    `${SHARED}: ZELLIJ_CHROME_BACKGROUND paints the view and window BEFORE any CSS runs. If it differs from the ` +
      'terminal background, opening Zellij flashes a wrong-coloured frame every single time.'
  );
});

test('the chrome height is one shared constant, consumed by both trees', () => {
  const height = read(SHARED).match(/ZELLIJ_CHROME_HEIGHT = (\d+)/)?.[1];
  assert(height, `${SHARED}: expected ZELLIJ_CHROME_HEIGHT to be a numeric literal`);
  assert.equal(height, '42', 'the chrome matches the Cowork address row, which is 42px (Ral 2026-09-18)');
  assert.match(
    read('src/main/zellij/zellijSurface.ts'),
    /y: ZELLIJ_CHROME_HEIGHT/,
    "zellijSurface.ts: the first-frame contentBounds fallback must read the shared constant, not a literal — a " +
      'drifted literal is corrected by the first ResizeObserver measurement, so it only ever shows as one wrong frame.'
  );
  assert.match(
    read('src/renderer/zellij/src/main.ts'),
    /setProperty\('--zellij-chrome-height', `\$\{ZELLIJ_CHROME_HEIGHT\}px`\)/,
    'zellij/src/main.ts: the renderer must publish the shared constant as the CSS variable the toolbar reads.'
  );
  assert.match(
    read(LESS),
    /var\(--zellij-chrome-height/,
    `${LESS}: the toolbar height must come from the CSS variable, not a second hand-written number.`
  );
});
