import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * **IconBtn 两仓一字不差,而且自己带齐外观**(Ral 2026-09-24:「IconBtn 统一成 bl 的方式」)。
 * 见 docs/features/iconbtn-unified-with-bl.md。
 *
 * 自己带齐的理由:micromeet-cowork 的 zellij / historySuggestions 不加载 Arco。在那里只靠 Arco
 * 去掉边框和底色的按钮会渲染成浏览器默认的灰底 + 1px 边框 —— 源码看着对、渲染出来带框,
 * 2026-09-09 在 OnlyPreview 外壳上出过一次(工作区《Borderless UI》)。所以断言的是**编译后**的 CSS。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const HERE = join(ROOT, 'src/renderer/common/components/IconBtn');
const SIBLING = resolve(ROOT, '../micromeet-cowork/apps/cowork', 'src/renderer/common/components/IconBtn');
const less = createRequire(join(ROOT, 'package.json'))('less');
const source = readFileSync(join(HERE, 'IconBtn.less'), 'utf8');
const { css } = await less.render(source, { filename: join(HERE, 'IconBtn.less') });
const base = css.match(/(?:^|\n)\.icon-btn\.arco-btn\s*\{([^}]*)\}/)?.[1] ?? '';

test('是 bitterless 的写法:Arco Button type="text",属性整体透传,样式跟着组件走', () => {
  const vue = readFileSync(join(HERE, 'IconBtn.vue'), 'utf8');
  assert.match(vue, /import \{ Button \} from '@arco-design\/web-vue'/);
  assert.match(vue, /import '\.\/IconBtn\.less'/, '样式由组件自己引入 —— 用到它的每个渲染面都会带上');
  assert.match(vue, /defineOptions\(\{ inheritAttrs: false \}\)/);
  assert.match(vue, /v-bind="\$attrs"/);
  assert.match(vue, /type="text"/);
  assert.doesNotMatch(vue, /\bh-8\b|\bw-8\b|rounded-md/, 'Tailwind 那一版已经退役');
});

test('编译后自带无边框外观,不依赖 Arco 样式表', () => {
  assert.ok(base, '编译结果里没有 .icon-btn.arco-btn');
  assert.match(base, /border:\s*0/);
  assert.match(base, /background:\s*transparent/);
  assert.match(base, /-webkit-app-region:\s*no-drag/, '它会出现在无框窗口的拖拽区里');
});

test('每个 Arco 变量都有回退值 —— 不加载 Arco 的面上变量不存在', () => {
  const bare = css.match(/var\(--[a-z0-9-]+\)/g) || [];
  assert.deepEqual(bare, [], '缺回退值的 var():' + bare.join(', '));
});

test('两仓的 IconBtn.vue / IconBtn.less 字节一致', { skip: !existsSync(SIBLING) && '单独检出时没有兄弟仓' }, () => {
  for (const file of ['IconBtn.vue', 'IconBtn.less']) {
    assert.equal(readFileSync(join(HERE, file), 'utf8'), readFileSync(join(SIBLING, file), 'utf8'), `${file} 两仓漂移了`);
  }
});
