/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import less from 'less';

/**
 * 聊天列表**只竖着滚**(Ral 2026-09-18:「聊天页不应该出现整体横向滚动的滚动条」,
 * docs/issues/chat-list-scrolls-sideways.md)。横向滚动条挂在列表这一层,拖的就是整段对话。
 *
 * 两条声明缺一不可:滚动容器把横轴关掉,消息列 `min-width: 0` 让行宽不被后代的最小内容宽顶开。
 * 只关横轴会把顶出去的内容裁掉;只写 min-width 挡不住将来某个不能收缩的后代。
 */
const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const renderer = 'src/renderer/maestro/';
const control = `${renderer}control/src/`;

const compile = async (path) => {
  const { css } = await less.render(read(path), { filename: resolve(root, path) });
  const rules = new Map();
  // Less 保留 `/* */` 注释,不剥掉的话注释会被当成下一条规则选择符的一部分。
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    rules.set(
      match[1].trim(),
      Object.fromEntries(
        match[2]
          .split(';')
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .map((declaration) => {
            const colon = declaration.indexOf(':');
            return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
          })
      )
    );
  }
  return rules;
};

const listRules = await compile(`${control}MessageList.less`);
const itemRules = await compile(`${control}MessageItem.less`);

test('the message list scroller never scrolls sideways', () => {
  const scroller = listRules.get('.message-list__scroll');
  assert.ok(scroller, 'MessageList.less 的滚动容器变了名字,这条守卫需要跟着改');
  assert.equal(scroller.overflow, 'hidden auto');
});

test('a message row cannot be widened by its own content', () => {
  const column = itemRules.get('.message-item__content');
  assert.ok(column, 'MessageItem.less 的消息列变了名字,这条守卫需要跟着改');
  assert.equal(column['min-width'], '0');
  assert.equal(column['max-width'], '88%');
});

// 滚动条外观来自全局主题,COWORK 现在照抄的就是它 —— 断掉这条引用链,两边就分家了。
test('Maestro Control reaches the global scrollbar theme', async () => {
  assert.match(read(`${control}control.ts`), /import ['"]\.\.\/\.\.\/common\/style\.css['"]/u);
  assert.match(
    read(`${renderer}common/style.css`),
    /@import ['"]\.\.\/\.\.\/\.\.\/renderer\/common\/assets\/style\/theme\.less['"]/u
  );
  const theme = await compile('src/renderer/common/assets/style/theme.less');
  assert.deepEqual(theme.get('::-webkit-scrollbar'), { width: '8px', height: '8px' });
  assert.deepEqual(theme.get('::-webkit-scrollbar-thumb'), {
    background: 'oklch(0.7 0 0 / 0.3)',
    'border-radius': '4px'
  });
});
