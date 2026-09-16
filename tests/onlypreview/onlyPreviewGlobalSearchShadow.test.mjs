import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import less from 'less';
import { projectRoot, source } from './onlyPreviewCoreTest.helper.mjs';

/**
 * 全局搜索面板的**蓝色投影**
 * （Ral 2026-09-11：「全局搜索需要主体蓝色的阴影，这样明显点」）。
 *
 * **断言编译产物，不是原始 Less。** 这个区别是承重的：Less 把 `rgb(22 93 255 / 42%)` 改写成
 * `rgba(22, 93, 255, 0.42)` 并把多行 `box-shadow` 折成一行。原来钉这条阴影的断言
 * （`onlyPreviewGlobalSearchUi.test.mjs`）读的是源码文本，所以它能通过一个**实际渲染出来不是那样**
 * 的值 —— 和 IconBtn 那次「源码看着对、渲染出来带边框」是同一类失败
 * （`onlyPreviewBookmarks.test.mjs` 那条守卫的由来）。
 *
 * 这个面板由**独立的 `globalSearch` 渲染进程**画（`globalSearch/src/main.ts` 一份样式表都不
 * import，全部 CSS 只从 SFC 的 `<style lang="less">` 图里来），所以这里编译的就是那条链上的
 * 那一份文件 —— 不是某个恰好同名的别处的样式。
 */
const STYLESHEET =
  'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less';

// `GlobalSearchWorkspace.less` 没有 `@import`，所以不需要 `filename`（有 import 的那份必须给
// 绝对路径，否则 Less 报 "wasn't found" —— 见 GlobalSearchPreview.less）。
const compiled = (await less.render(readFileSync(join(projectRoot, STYLESHEET), 'utf8'))).css;

/**
 * 一条规则的声明块，**注释已剥掉**。
 *
 * 两个都是踩出来的：
 *
 * 1. **按位置切，不构造正则。** 选择器前缀会误命中子元素(`.onlypreview-global-search__header`),
 *    而拼出来的正则还要处理 `.` 转义。找 `选择器 + ' {'` 这个整串是确定的。
 * 2. **必须剥注释。** Less 保留 `/* *\/` 注释,而解释一条声明的注释里几乎一定会写到那条声明本身 ——
 *    于是 `doesNotMatch(rule, /width: max-content/)` 会被"这里不能再写 width: max-content"这句
 *    **解释**命中。同一个会话里这一类错犯了三次(源码守卫两次、这里一次),所以剥注释是这个 helper
 *    的固有行为,不是调用方的责任。
 */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleOf = (selector) => {
  const opening = `${selector} {`;
  const start = compiled.indexOf(opening);
  assert.notEqual(start, -1, `compiled CSS 里找不到 ${selector}`);
  const end = compiled.indexOf('}', start);
  assert.notEqual(end, -1, `${selector} 的声明块没有闭合`);
  return stripCssComments(compiled.slice(start + opening.length, end));
};

const shadowLayers = (declaration) => {
  // 顶层逗号切分：`rgba(…)` 里面也有逗号，所以要按括号深度切。
  const layers = [];
  let depth = 0;
  let current = '';
  for (const character of declaration) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
};

/**
 * 一层 box-shadow 四条边各自超出盒子多少。
 *
 * `offsetX offsetY blur spread`，四个都可省且**零可以不带单位**，所以先把 `rgba(…)` 整段剥掉
 * （里面的数字不是长度），再按空白切词逐个认。某一侧的延伸量 = 该方向的偏移 + blur/2 + spread。
 */
const shadowReach = (layer) => {
  const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = layer
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((token) => /^-?\d*\.?\d+(px)?$/.test(token))
    .map((token) => Number(token.replace('px', '')));
  const bleed = blur / 2 + spread;
  return {
    上: -offsetY + bleed,
    下: offsetY + bleed,
    左: -offsetX + bleed,
    右: offsetX + bleed
  };
};

describe('编译后的 CSS：面板主体带蓝色投影', () => {
  const body = ruleOf('.onlypreview-global-search');
  const shadow = body.match(/box-shadow:\s*([^;]+);/)?.[1];

  test('box-shadow 存在，且是两层', () => {
    assert.ok(shadow, '面板主体没有 box-shadow');
    assert.equal(shadowLayers(shadow).length, 2, '这个面板浮在透明窗口上，两层是既有形状');
  });

  test('每一层都是蓝的 —— 不是原来那个 ink 色', () => {
    for (const layer of shadowLayers(shadow)) {
      assert.match(
        layer,
        /rgba\(22, 93, 255, 0\.\d+\)/,
        `这一层不是动作蓝 #165dff：${layer}`
      );
      assert.doesNotMatch(layer, /rgba\(37, 40, 58/, '旧的 ink 阴影回来了');
    }
  });

  test('比原来更重 —— 「明显点」是这条需求本身', () => {
    // 旧值是 36% / 16%。两层都必须至少不低于它，否则这次改动没有做到他要的那件事。
    const alphas = shadowLayers(shadow).map((layer) =>
      Number(layer.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 0)
    );
    assert.ok(alphas[0] >= 0.36, `第一层 alpha ${alphas[0]} 低于原来的 0.36`);
    assert.ok(alphas[1] >= 0.16, `第二层 alpha ${alphas[1]} 低于原来的 0.16`);
  });

  test('四条边的延伸量都 ≤ 24px —— 超出会被 view 边界裁掉', () => {
    // 面板按 `FLOATING_GUTTER_PX = 24` 内缩定位，所以阴影每一侧只有 24px 可落。
    //
    // **按位置解析，不是"第一个带 px 的就是 offsetY"。** 原来那个解析器按 `matchAll(/(-?\d+)px/g)`
    // 取前三个数，靠的是 x 偏移恰好写成不带单位的 `0` 才碰巧对齐 —— 一旦 y 偏移也归零（这次就是），
    // 它把 blur 读成 offsetY、把 spread 读成 blur，于是给 `0 0 40px -2px` 算出 39px 的假越界。
    // CSS 允许无单位的零，所以按空白切词、逐个认长度才是确定的。
    const gutter = Number(source('src/renderer/onlypreview/globalSearch/src/App.vue')
      .match(/FLOATING_GUTTER_PX = (\d+)/)?.[1]);
    assert.equal(gutter, 24, 'gutter 变了，这条上限要跟着重新算');
    for (const layer of shadowLayers(shadow)) {
      const sides = shadowReach(layer);
      for (const [side, reach] of Object.entries(sides)) {
        assert.ok(
          reach <= gutter,
          `这一层向${side}延伸 ${reach}px，超过 ${gutter}px 的可落空间：${layer}`
        );
      }
    }
  });

  test('是一圈，不是往下压 —— 面板上沿也必须有阴影', () => {
    // Ral 2026-09-16:「search 弹窗阴影效果应该堆成的围绕窗口而不是偏下」。
    // 原来的 `0 14px 28px -10px` 向上延伸是 -10px，也就是上沿一点阴影都没有；只钉"向下不越界"
    // 的旧守卫对此完全无感。这一条钉的就是他要的那件事本身。
    for (const layer of shadowLayers(shadow)) {
      const { 上: top, 下: bottom, 左: left, 右: right } = shadowReach(layer);
      assert.ok(top > 0, `这一层上沿没有阴影（向上 ${top}px）：${layer}`);
      assert.equal(top, bottom, `上下不对称（${top} vs ${bottom}）：${layer}`);
      assert.equal(left, right, `左右不对称（${left} vs ${right}）：${layer}`);
    }
  });

  test('面板主体仍然无边框 —— 层次靠阴影，不靠线', () => {
    assert.doesNotMatch(body, /(^|[^-])border\s*:/, '主体上出现了 border');
    assert.match(body, /border-radius:\s*14px/, '圆角是这个浮层的既有形状');
  });
});

describe('两仓这一份必须同字节', () => {
  test('cowork 的 GlobalSearchWorkspace.less 与本仓相同', () => {
    // 这份文件是 vendored 的。没有任何测试守着两仓的 .less 同字节（bookmarks 那条守卫
    // 只枚举 IconBtn），所以阴影这一条自己带上这个断言。
    const here = readFileSync(join(projectRoot, STYLESHEET), 'utf8');
    const therePath = join(
      '/Users/ral/Documents/projects/overmind/projects/micromeet-cowork/apps/cowork',
      STYLESHEET
    );
    let there;
    try {
      there = readFileSync(therePath, 'utf8');
    } catch {
      // 只有 bitterless 的机器上没有 cowork 检出时才会到这里 —— 跳过而不是失败。
      return;
    }
    assert.equal(there, here, '两仓的全局搜索样式表漂移了');
  });
});

/**
 * Project 树每一行的底色铺满**整行宽度**，而不是停在文字末尾
 * （Ral 2026-09-11：「文件和文件夹的背景色应该占用行宽度，而不是到文字结尾」）。
 *
 * 断言编译产物而不是源码文本，理由和上面那组一样。这一条真实的失败模式很刁：行上原来写的
 * `width: max-content; min-width: 100%` 在**没有横向溢出时是对的** —— 也就是说源码读起来没问题，
 * 只有当某个长文件名把树撑出横向滚动时，短行的底色才会在滚动出去的那段里断掉。
 */
const SHELL_STYLESHEET = 'src/renderer/onlypreview/shell/src/App.less';
const shellCompiled = (
  await less.render(readFileSync(join(projectRoot, SHELL_STYLESHEET), 'utf8'), {
    filename: join(projectRoot, SHELL_STYLESHEET)
  })
).css;

const shellRuleOf = (selector) => {
  const opening = `${selector} {`;
  const start = shellCompiled.indexOf(opening);
  assert.notEqual(start, -1, `compiled CSS 里找不到 ${selector}`);
  const end = shellCompiled.indexOf('}', start);
  assert.notEqual(end, -1, `${selector} 的声明块没有闭合`);
  return stripCssComments(shellCompiled.slice(start + opening.length, end));
};

describe('编译后的 CSS：树行底色铺满整行', () => {
  const container = shellRuleOf('.onlypreview-shell__tree');
  const row = shellRuleOf('.onlypreview-shell__tree-row');

  test('容器是单列 grid，列宽至少容纳最宽内容并填满可视宽度', () => {
    assert.match(container, /display:\s*grid/);
    assert.match(
      container,
      /grid-template-columns:\s*minmax\(max-content,\s*1fr\)/,
      '内容宽度必须是下限，否则文字可能溢出行底色'
    );
  });

  test('align-content: start —— 否则行数少时行间凭空多出间距', () => {
    assert.match(container, /align-content:\s*start/);
  });

  test('行自己不再设 width —— 宽度交给那一列', () => {
    assert.doesNotMatch(
      row,
      /(^|[^-])width:\s*max-content/,
      '行上又出现 max-content，底色会重新停在文字末尾'
    );
    assert.doesNotMatch(row, /min-width:\s*100%/, '列已经保证了下限，行上再写一遍是冗余');
  });

  test('行高与字号不变 —— 这次只动宽度', () => {
    assert.match(row, /height:\s*22px/);
    assert.match(row, /font-size:\s*14px/);
  });
});
