import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * 撤回键那一栏的尺寸 —— Ral 2026-09-24 指定:
 * 「操作栏的高度限制为 14px,只有顶部有个 2px padding,和用户的消息之间没有 margin 间距」
 * 「撤回的按钮应该是靠在最右」。见 docs/features/steering-take-back.md。
 *
 * 断言的是**编译后**的 CSS:工作区《Borderless UI》那条教训 —— 看源码看不出一条规则是否真的生效,
 * 要在真正加载这张皮的那一份编译结果里验。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const less = createRequire(join(ROOT, 'package.json'))('less');
const source = readFileSync(join(ROOT, 'src/renderer/maestro/control/src/MessageItem.less'), 'utf8');
const { css } = await less.render(source, { filename: join(ROOT, 'src/renderer/maestro/control/src/MessageItem.less') });
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `编译结果里没有 ${selector}`);
  return m[1];
};
const item = readFileSync(join(ROOT, 'src/renderer/maestro/control/src/MessageItem.vue'), 'utf8');

test('操作栏:高 14px(含 padding)、只有顶部 2px padding、零 margin、按钮靠最右', () => {
  const footer = rule('.message-item__footer');
  assert.match(footer, /height:\s*14px/);
  assert.match(footer, /box-sizing:\s*border-box/, '14px 要含 padding,否则实际是 16px');
  assert.match(footer, /padding:\s*2px 0 0/);
  assert.match(footer, /margin:\s*0/);
  assert.match(footer, /justify-content:\s*flex-end/);
  assert.match(footer, /align-self:\s*stretch/, '撑满这一列,不依赖这一列的 align-items');
});

test('与消息零间距:消息那一列不再有 gap', () => {
  assert.match(rule('.message-item__content'), /gap:\s*0/);
});

test('按钮压进 12px(14 - 2),选择器压得过 IconBtn 自己的 32px', () => {
  const btn = rule('.message-item__footer .icon-btn.arco-btn');
  for (const decl of [/width:\s*12px/, /min-width:\s*12px/, /height:\s*12px/, /flex:\s*0 0 12px/]) assert.match(btn, decl);
  assert.match(item, /<IconArrowBackUp :size="12" \/><\/IconBtn>/, '图标保持 14px 会溢出操作栏');
});
