import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * **发出消息后「滚到底」要滚到真正的底 —— 之后晚到的高度变化也要跟上。**
 *
 * Ral 2026-09-24:「新消息发出去之后,滚动到底部的操作没有完全滚动到底部」「setTimeout 尽量能不用就别用」。
 *
 * 根因两条(`docs/issues/scroll-to-bottom-falls-short-after-send.md`):
 * 1. 黏底只在被叫到的那一刻钉一次;之后内容变高(AI 回复分批渲染、状态条换文案)、可视区变矮
 *    (拍板卡 / 确认卡在滚动容器外冒出来)都不触发 scroll 事件,没人补滚。
 * 2. `onListScroll` 不看方向:钉底之后、异步 scroll 事件到达之前内容长高超过阈值,就把黏底解除了。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const STORE = 'src/renderer/maestro/control/src/store/message.store.ts';
const LIST = 'src/renderer/maestro/control/src/MessageList.vue';

const method = (name) => {
  const ast = ts.createSourceFile('store.ts', read(STORE), ts.ScriptTarget.Latest, true);
  let found;
  const visit = (node) => { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) found = node; ts.forEachChild(node, visit); };
  visit(ast);
  assert.ok(found, `找不到 ${name}`);
  const js = ts.transpileModule(`class Target { ${found.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`${js}; Target.prototype.${name}`, { STICK_TO_BOTTOM_THRESHOLD_PX: 120 });
};
const onListScroll = method('onListScroll');
const followBottom = method('followBottom');

/** 一个会自己算离底距离的假列表:clientHeight 400。 */
const list = (scrollHeight, scrollTop) => ({ scrollHeight, scrollTop, clientHeight: 400 });
const store = (el, stick = true, lastTop = el.scrollTop) => ({ listEl: el, stickToBottom: stick, lastListScrollTop: lastTop });

test('内容长高 150px(超过 120 的阈值)不会解除黏底 —— scrollTop 没变小,人没往上滚', () => {
  const el = list(1000, 600); // 在底部:1000 - 600 - 400 = 0
  const s = store(el);
  el.scrollHeight = 1150;     // AI 第一段回复 / 一张拍板卡把内容撑高了 150px
  onListScroll.call(s);       // 程序钉底那次异步到达的 scroll 事件
  assert.equal(s.stickToBottom, true, '原来只算距离:150 > 120 ⇒ 黏底被内容增长解除,之后的补滚全部失效');
});

test('人往上滚过阈值 → 解除;往下滚但还远 → 保持解除;回到阈值内 → 重新黏住', () => {
  const el = list(1000, 600);
  const s = store(el);
  el.scrollTop = 300; onListScroll.call(s);
  assert.equal(s.stickToBottom, false, '往上滚是唯一能解除黏底的动作');
  el.scrollTop = 400; onListScroll.call(s);
  assert.equal(s.stickToBottom, false, '往下挪了一点但离底还有 200px,不该被重新拽住');
  el.scrollTop = 520; onListScroll.call(s);
  assert.equal(s.stickToBottom, true, '离底 80px,回到阈值内');
});

test('内容缩短被浏览器夹回底部(scrollTop 变小但离底为 0)仍然黏住', () => {
  const el = list(1000, 600);
  const s = store(el);
  el.scrollHeight = 900; el.scrollTop = 500; // 折叠了一段,浏览器把 scrollTop 夹到新的最大值
  onListScroll.call(s);
  assert.equal(s.stickToBottom, true);
});

test('尺寸变了就补钉底;人往上滚过就不拽回来', () => {
  const pinned = store(list(1400, 600));
  followBottom.call(pinned);
  assert.equal(pinned.listEl.scrollTop, 1400);
  const released = store(list(1400, 300), false);
  followBottom.call(released);
  assert.equal(released.listEl.scrollTop, 300);
});

test('一个 ResizeObserver 同时盯内容元素与滚动容器,回调受 stickToBottom 把关', () => {
  const src = read(LIST);
  assert.match(src, /new ResizeObserver\(\(\) => \{\s*messageStore\.followBottom\(\)/, '高度一变就补钉底 —— 不靠 setTimeout 猜时长');
  assert.match(src, /sizeObserver\.observe\(listRef\.value\)/, '可视区变矮(拍板卡 / 确认卡在滚动容器外冒出来)');
  assert.match(src, /sizeObserver\.observe\(contentRef\.value\)/, '内容变高(AI 回复分批渲染、状态条换文案)');
  assert.match(src, /typeof ResizeObserver === 'undefined'/, '测试装置里可能没有 ResizeObserver');
  assert.match(src, /sizeObserver\?\.disconnect\(\)/);
  assert.doesNotMatch(src, /setTimeout/, 'Ral:setTimeout 尽量能不用就别用');
});

test('条目间距跟着挪到内容元素上 —— 条目不再是滚动容器的直接子元素', () => {
  const less = read('src/renderer/maestro/control/src/MessageList.less');
  assert.match(less, /\.message-list__content > \* \+ \* \{\s*margin-top: 12px;/);
  assert.doesNotMatch(less, /\.message-list__scroll > \* \+ \*/, '留在滚动容器上就只剩一个子元素,间距全没了');
});
