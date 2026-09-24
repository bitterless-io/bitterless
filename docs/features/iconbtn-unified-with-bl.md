# IconBtn 两仓统一成 bitterless 的写法

- **来由**：Ral 2026-09-24 ——「IconBtn 统一成 bl 的方式」。
- **状态**：已实施（2026-09-24）；未启动应用目测

## 统一成什么

两仓的 `src/renderer/common/components/IconBtn/` **一字不差**：

- `IconBtn.vue` = Arco `Button type="text"`（`inheritAttrs: false` + `v-bind="$attrs"`，图标走 `#icon` 插槽）；
- `IconBtn.less` = `.icon-btn.arco-btn`：32×32、`flex: 0 0 32px`、圆角 6px、`-webkit-app-region: no-drag`，
  悬停 / 按下 / 聚焦 / 禁用四态。

原来 micromeet-cowork 的 `IconBtn` 是一个 Tailwind `<button>`（`h-8 w-8 rounded-md …`）。两套实现带来过
一次事故：OnlyPreview 外壳只加载 Arco、不编译 Tailwind，cowork 的图标键在那里没有任何样式，渲染成浏览器
默认的灰底 + 1px 边框（2026-09-09，见 `tests/unit/onlyPreviewBookmarks.test.mjs`）。统一之后这类「同一个
组件在两仓长得不一样」的漂移不再可能。

## 与 bitterless 原文件唯一的差别：`IconBtn.less` 自己带齐样式

bitterless 的每个渲染面都加载 Arco，所以原来的 `IconBtn.less` 可以依赖 Arco 的 `.arco-btn-text` 去掉边框和
底色、依赖 Arco 的 CSS 变量（`--color-text-2` / `--color-fill-2` …）上色。**cowork 有两个渲染面不加载 Arco**：

| 渲染面 | 加载 Arco 样式 |
| --- | --- |
| control / home / workbench / filepreview / onlypreview 外壳 | ✅ |
| **zellij** / **historySuggestions** | ❌（只有 `common/style.css`） |

在这两个面上，照搬原文件的按钮会是浏览器默认的灰框按钮 —— 正是工作区《Borderless UI》规则记下的那一类。
所以 `.icon-btn.arco-btn` 显式写上 `border: 0` / `background: transparent`，每个 Arco 变量都带回退值
（取 Arco 默认主题的值）。bitterless 上这些声明与 Arco 自己给的一致，视觉无变化；两仓仍是同一份文件。

## 逐个实例核对（cowork 31 处 `<IconBtn`）

新的基础选择器是 `.icon-btn.arco-btn`（0,2,0），并且带 `min-width` 与 `flex: 0 0 32px` —— 实例上只改
`width` / `height` 的覆盖会输，在横向 flex 里还会被 `flex-basis` 顶掉。逐个核对的结果：

| 实例 | 原覆盖 | 处理 |
| --- | --- | --- |
| OnlyPreview 外壳三处（书签删除、导航、文件操作） | 两级选择器（0,2,0），当初就是按 bitterless 的 `.icon-btn.arco-btn` 写的，靠「定义在后」胜出 | 不改。组件文件两仓相同，统一后 cowork 与 bitterless 走同一条路径 |
| zellij 设置键 | Tailwind `!h-6 !w-6 …`（important） | 补 `!min-w-6 !basis-6` —— 否则 `min-width: 32px` / `flex-basis: 32px` 把它撑回 32px |
| 聊天里的撤回键（`messageItem__footer`） | scoped 的 `.messageItem__withdraw`（0,2,0，平手不可靠） | 改成与 bitterless 相同的 `.messageItem__footer .icon-btn.arco-btn`（0,3,0） |
| 其余（会话抽屉、搜索框、历史建议、Workbench 设置页、菜单栏…） | 只有 margin / `border: 0` 或没有覆盖 | 不改，统一成标准外观 |

**可见变化**：未覆盖的实例颜色从 Tailwind 的 `gray-600` / 悬停 `black/10` 变成 Arco 的 `--color-text-2` /
`--color-fill-2` —— 这就是「统一」本身。

## 守卫

`iconBtnUnified.test.mjs`（两仓同名）：两份 `IconBtn.vue` / `IconBtn.less` 字节一致；编译后的
`.icon-btn.arco-btn` 带 `border: 0`、`background: transparent`，所有 `var(--…)` 都有回退值。
