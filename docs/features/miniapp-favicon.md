# Mini-app 的 favicon 由配置决定

Status: implemented — owner testing pending(2026-09-14,Ral:「miniapp 需要配置 favicon,例如
onlypreview 和 zellij 的 favicon 你帮我设计,并通过配置可以加载,没有配置 favicon 的 miniapp
就加载默认的就行(当前的设计)」)。

对齐对象是 micromeet-cowork 的 `apps/cowork/src/shared/miniappIcon.ts`,两份 SVG 源码逐字一致 ——
两个 app 展示的是同一批 mini-app,不该分裂成两个 Zellij 图标。

## #0 这边几乎不用改

`MaestroCompositeTabSpec.favicon: string` **本来就在**,而且整条线早就通了:

```
spec.favicon → tab.favicon(maestroBrowserView.service.ts,openCompositeTab 与 setTabKind 两处)
             → tabInfo() → coach/tabs 广播 → MenuBar.vue 的 <img :src="tabIconSrc(tab)">
```

缺的只有一样:三个注册点(`zellij` / `onlyPreview` / `trench`)全都传 `''`,于是每个 composite
tab 的 chip 都落到 Arco 的通用地球仪。所以本需求在 bl 这边是**给两个注册点填上取值**,不是搭管道。

`trench` 刻意不配 —— Ral 只点名了 onlypreview 和 zellij,没配的走默认正是他要的行为。

## #1 取值为什么是内联 SVG data URI

spec 在 **main** 里注册(`src/main/windows/*CoworkTab.ts`),而这个仓里「打包好的图片」是
**渲染层的概念**:

| 事实 | 后果 |
|---|---|
| `import x from './y.png'` 走 Vite,产物名带内容哈希(`bitterless-icon-Cj75Zy_s.png`) | main 无从算出那个文件名 |
| Vite 默认 4096 字节以下**不落盘**,直接内联成 base64 | 同一行 import 的产物形态取决于文件大小 |
| 仓里没有任何 asset manifest | 没有第二条路去查那个哈希 |
| `src/main` 至今**零**图片 import(托盘是唯一例外,而它走 electron-builder `extraResources`) | 从 main import 图片会是一个全新模式 |

data URI 把这四条一次绕开:一个字符串,main / renderer / XPC / sqlite `tabs` 行全都认,dev 与
打包完全一致。CSP 也放行 —— Maestro home 的 `img-src 'self' data: https: http:`。

(sqlite 窗口那次「默认 session 的 CSP 被抹平」够不到这里:那个窗口在默认 session,而 Maestro
home 在 `persist:bitterless-cowork`;何况抹掉一个响应头也删不掉 `<meta http-equiv>` 那条。)

## #2 两个图标

| mini-app | 画的是什么 | 为什么 |
|---|---|---|
| Zellij | 近黑圆角方块 ＋ 终端绿的三块 pane(左一大、右两小) | 它是终端**复用器**,不是一个终端。`>_` 提示符在 16px 上糊成一团,而三个矩形还读得出 |
| OnlyPreview | 品牌色(`#4E5882`)圆角方块 ＋ 居中的白色眼睛 | Ral 2026-09-14 定的形(「重做方形,中间是眼睛」)。**这是回到它自己本来的意象** —— 仓里那份 `onlypreview.svg` 从一开始画的就是「一张纸,里面一只眼睛」;去掉纸是因为 16px 上两层嵌套轮廓必糊,而眼睛才是这个应用在说的那件事 |

都按 16px 画(tab chip 的真实尺寸),结构是「圆角方块底 ＋ 单一主体」,和真实站点 favicon 同构,
在浅色 tab 条上自带对比。

### #2.1 同一个形,两种画法

底色用的是**品牌色** `#4E5882`(`--onlypreview-royal`,也正是老图标那个描边色),不是随便挑的蓝 ——
菜单条、设置页、引导页全是它。

| 用在哪 | 画法 | 为什么 |
|---|---|---|
| tab chip(浅色 tab 条) | 实心:品牌色底 ＋ 白眼睛 | 需要一块实心底才像一个应用图标 |
| OnlyPreview 菜单条 | 单色:描边 ＋ `currentColor` | 那条本身就是 `#4E5882`,实心底会和背景糊在一起;`currentColor` 让它跟旁边的字用同一个颜色 |
| Bitterless 首页 mini-app 列表 | 实心(`assets/icons/onlypreview.svg`,32×32) | 同一个形放大版 |

菜单条那一枚替掉的是 tabler 的 `IconFiles` —— 一个通用「文件」字形,谁都能用,因此什么也没说。
**空状态那处的 `IconFiles` 刻意保留**:那里要的正是「文件」这个通用意思,不是产品标记。

## #3 一条不许踩的既有坑

cowork 那份 connector 图标把颜色手写成 `stroke="%23475569"`(先手工编码了 `#`),整串再过一次
`encodeURIComponent` —— `%` 变 `%25`,浏览器最终拿到 `stroke="%23475569"`,不是合法颜色,stroke
被丢弃;那条 path 本身 `fill="none"`,**结果是整个图标不可见**。cowork 侧已修好并加了守卫
(`check-miniapp.mjs` §11 断言 `miniappIcon.ts` 里不许出现 `%23`)。本文件的两个图标写裸 `#`。

## #4 已知的次生影响

- **持久化会写进去。** `tab.store.ts` 的 `persistSoon` 把 `favicon` 写进 sqlite `tabs`
  行,500ms 防抖,每次 tab 开/关/重排都写一遍。两个 data URI 各 ~450 字符,`favicon TEXT NOT NULL
  DEFAULT ''` 吃得下,但要知道它在那儿。
- **restore 不读那一列。** composite 行是经 `openCompositeTab` → `spec.favicon` 复原的,存进去的
  favicon 从不被读回 —— 这反而是对的:改版换了图标,恢复出来的 tab 拿到的是**新**图标。
- `markFaviconFailed` 用的是 `tab.favicon` 而不是 `tabIconSrc` 的返回值。对 data URI 两者同串,
  所以本次不受影响;但 `kind === 'home'` 那条分支的既有缺陷(渲染的是 `bitterlessIcon`,记录的是
  `''`)没有被本次触碰。

## #5 验收

| # | 判据 |
|---|---|
| A1 | 开一个 Zellij tab:chip 显示近黑底绿分栏图标,不再是通用地球仪 |
| A2 | 开一个 OnlyPreview tab:chip 显示靛蓝底折角纸图标 |
| A3 | Trench tab 仍然是通用图标(没配 = 走默认) |
| A4 | 重启 app,恢复出来的 Zellij tab 图标照旧 |
| A5 | 打包版里两个图标一样显示(data URI 不依赖任何产物路径) |
