# 全局搜索的蓝色投影 · Project 行底色铺满整行

Ral 2026-09-11，两条：

> bl cowork 全局搜索需要主体蓝色的阴影，这样明显点

> 补充需求：bl和 cowork 的 project 目录，文件和 文件夹的背景色应该占用行宽度，而不是到文字结尾

两处都在 **vendored 逐字节相同**的样式表里，所以一次改动、两仓同字节。

## #1 全局搜索面板的蓝色投影

改的是 `shell/src/components/GlobalSearch/GlobalSearchWorkspace.less` 的 `.onlypreview-global-search`
—— 那个 `<section name="onlypreview__globalSearch">` 就是浮起来的**主体**（另一个候选
`.onlypreview-global-search-canvas` 是透明的全窗遮罩，它必须看不见）。

```less
/* 改之前 */
box-shadow:
  0 12px 24px -12px rgb(37 40 58 / 36%),
  0 3px 8px rgb(37 40 58 / 16%);
/* 改之后 */
box-shadow:
  0 14px 28px -10px rgb(22 93 255 / 42%),
  0 4px 10px -2px rgb(22 93 255 / 26%);
```

三个判断，都不是随手定的：

**用 `#165dff` 而不是面板自己的 `--onlypreview-royal: #4e5882`。** 后者是雾面板岩蓝，而**原来的阴影
色 `#25283a` 本身就是深藏青** —— 换成 `#4e5882` 几乎看不出区别，达不到他要的「明显点」。`#165dff`
是这个 app 的动作蓝（home / maestro / workbench 都在用），不是新造的颜色；它是 onlypreview 里唯一
一处，这一点留档。

**字面量 `rgb()`，不用 token，不用 `oklch()`。** 本树 21 条投影全是字面量（唯一用 token 的那条是导轨
不是投影），而且 Less 不解析 CSS 自定义属性 —— 写成 `var()` 的话编译产物里只能断言那个字符串本身，
断言就失去意义。`CLAUDE.md` 那条「颜色走 `oklch()`」在 onlypreview 这一片**与现实不符**（见下）。

**总延伸量必须 ≤ 24px。** 面板由 `globalSearch/src/App.vue` 的 `FLOATING_GUTTER_PX = 24` 内缩定位，
超出的部分会被那个 view 的边界**裁掉**——裁一刀比不加阴影更难看。这里向下 14−10+14 = 18px 与
4−2+5 = 7px。第一版方案是 `0 16px 32px -12px`（向下 36px），会被切；是这条约束把它否掉的。

## #2 Project 树行的底色铺满整行

2026-09-14 更正：此前的 `minmax(100%, max-content)` 仍把轨道限制在可视内容宽度，
长文件名溢出时背景没有跟着扩展。实测与修复见
[横向滚动行底色缺陷](../issues/onlypreview-tree-background-scroll-width.md)。下面更新为修复后的声明。

```less
/* 容器 */
.onlypreview-shell__tree {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr);
  align-content: start;
}
/* 行：删掉 `width: max-content; min-width: 100%` */
```

**原来那一对在「没有横向溢出时」是对的** —— 这是这条 bug 难发现的原因：源码读起来没问题。一旦某个长
文件名把树撑出横向滚动，`min-width: 100%` 解析出来的是**可视内容宽**而不是滚动宽，短行的底色就在滚动
出去的那段里断在文字末尾。

单列 grid 的 `max-content` 下限保证轨道容纳最宽一行，`1fr` 在内容较短时填满可用宽度。
`justify-items` 默认 `stretch` 让每一行都铺满这一列。**不改 DOM**（模板是 vendored 的），
也不用给行算宽度。旧方案把 `max-content` 放在上限，实际不会强制轨道超过视口宽度。

`align-content: start` 是**必须的**：grid 默认 `stretch` 会把多余的竖向空间摊到行轨道之间，表现是
行数少的时候行与行之间凭空多出间距。变异测试里专门有一条。

## 顺手修掉的两条守卫缺陷

**别名边界断言把注释当成了违规。** `onlyPreviewLocalPathAddress.test.mjs` 里
`assert.doesNotMatch(source, /@shared\/onlypreview\//)` 命中了 `maestroBrowserView.service.ts` 里
一句**解释**（「maestro 曾经直接 import 过，现在刻意不去问」）。改成先剥注释再断言，并补一条
「注释里提到那个别名是允许的」，免得下次有人把 `code` 换回 `source` 来"简化"。

**「深层行底色不能被截短」那条守卫钉的是旧机制。** `onlyPreviewAdapterSource.test.mjs` 断言行上有
`min-width: 100%`。意图不变，机制换了，所以断言挪到容器的 grid 列上，并加一条「行上不该再有自己的
宽度」。

## 与 `CLAUDE.md` 的一处矛盾（留档，未改规则）

规则说「theme `src/renderer/common/assets/style/theme.less`（Royal Blue），imported by every
renderer main.ts」。onlypreview 这一片**两半都不成立**：那个文件里没有任何颜色 token，而六个
onlypreview 的 `main.ts` 一个都不 import 它。真正的 Royal Blue 阶梯在 `home/src/App.less` 里，作用域
只到 home。onlypreview 用的是每个窗口各自重声明一遍的 `--onlypreview-*`（`globalSearch/src/App.less`
第 2–10 行）。**不去改那条规则**，因为那超出这次的范围；记在这里，免得下次有人按规则去 theme.less
找蓝色。

## 2026-09-11 历史验证

以下记录是当时的声明检查结果，不能证明浏览器里行背景确实覆盖滚动内容；2026-09-14 的
实际布局测量已推翻旧列宽方案，最新验证记录见上述 issue。

- **两组编译产物断言，两仓各一份**：`tests/onlypreview/onlyPreviewGlobalSearchShadow.test.mjs` ·
  cowork `tests/unit/onlyPreviewGlobalSearchShadow.test.mjs`（各 10 条）。
  **断言编译产物而不是源码文本**是承重的：Less 把 `rgb(22 93 255 / 42%)` 改写成
  `rgba(22, 93, 255, 0.42)` 并把多行 `box-shadow` 折成一行，所以原来那条读源码的断言既过不了、也
  证明不了渲染结果 —— 和 IconBtn 那次「源码看着对、渲染出来带边框」同一类。
  那一组还自带一条**两仓同字节**断言：这两份 `.less` 是 vendored 的，而全仓没有任何测试守着它们
  不漂移（bookmarks 那条守卫只枚举 IconBtn）。
- **变异测试**：阴影 7 条（回到 ink 色 · 换成雾面板岩蓝 · 超出 24px 被裁 · alpha 降回去 · 折成一层 ·
  给主体加回 border · 只改一仓），行宽 5 条（去掉 grid · 列宽去掉 100% 下限 · 去掉
  `align-content: start` · 行上把 `max-content` 加回去 · 动了行高），**全部被捕获**。
- **取块 helper 统一剥注释** —— 同一类错（断言命中了自己写的解释性注释）这个会话犯了三次，所以剥注释
  是那个 helper 的固有行为而不是调用方的责任，理由写在函数上。
- bitterless `test:onlypreview` 1209 条 / 17 失败，失败集与 HEAD **逐条相同**；cowork onlypreview
  308 条 / 2 失败（一条来自并发的 zellij 改动，一条是既有基线）。
- **未跑**：`yarn build`、`yarn lint`（已知 OOM）、Electron E2E。
- **运行时那一半要你看一眼**：全局搜索浮起来时那圈阴影该是明显的蓝色且没有被切边；Project 树里选一个
  很短的文件名、让树里同时有一个很长的文件名（撑出横向滚动），横向滚动后短行的底色应该一直铺到最宽
  那一行的右端。
