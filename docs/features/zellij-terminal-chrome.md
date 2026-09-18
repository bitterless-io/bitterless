# Zellij chrome 改成终端的样子

Status: implemented — owner testing pending(2026-09-18,Ral:「zellij 窗口的 header 太高了,改为和地址栏
一致的高度,改成更 terminal 的效果,可以用 zellij tab 中的绿色做主题色,背景用暗色」)。

范围是 Zellij 那条 chrome(`src/renderer/zellij/`)。它**同时**服务两个宿主:独立的 Zellij 窗口,和
Cowork 里的 Zellij composite tab —— 两边装的是同一个渲染入口,所以这一份改动两边一起生效。

## #0 目标

| # | 目标 | 判据 |
|---|---|---|
| G1 | 高度与地址栏一致 | 42px —— `MenuBar.less` 的 `.maestro-menu-bar__address-row` 就是 42px |
| G2 | 背景是暗的 | 与终端**同一个**背景色,chrome 与终端之间看不出接缝 |
| G3 | 绿色做主题色 | Zellij tab bar 那个绿(`#9ece6a`),用在图标、字标、就绪状态点、hover |
| G4 | 读起来像终端而不是应用标题栏 | 等宽字、更小的字号、状态点,而不是一行 16px 的粗标题 |
| G5 | 不引入边框 | 层次靠底色与留白(CLAUDE.md《Borderless UI》) |

## #1 颜色不是新挑的 —— 是终端自己的调色板

chrome 的每一个颜色都取自 `zellijDefaultConfig.constant.ts` 里 `web_client.theme` 那一段,也就是
**终端自己正在用的** ANSI 调色板(Tokyo Night):

| 用途 | 取自 | 值 |
|---|---|---|
| chrome 背景 | `background` | `#1a1b26` |
| 主文字 | `foreground` | `#c0caf5` |
| 主题色(字标 / 图标 / ready 状态点 / hover) | `green` | `#9ece6a` |
| 次要文字(状态标签、加载文案) | `white` | `#a9b1d6` |
| hover 底色 | `bright_black` | `#414868` |
| 出错 | `red` | `#f7768e` |
| 未就绪状态点 | `yellow` | `#e0af68` |

这不是审美偏好,是 G2 的**实现方式**:chrome 的背景与终端的背景是同一个字面值,于是两者之间没有
接缝可看 —— 换成任何一个「接近的暗色」都会在两块之间画出一条人眼立刻能认出的分界。

### #1.1 两棵树,一个调色板 —— 用守卫钉住

那份 KDL 常量在 `src/main/`,chrome 的样式在 `src/renderer/`,而 Less **没法 import 一个 TS 常量**。
所以这是一处真实的重复,只能用守卫防漂移:`tests/zellij/zellijChromeTheme.test.mjs` 解析
`zellijDefaultConfig.constant.ts` 的 `web_client.theme`,再解析 `App.less` 的调色板变量,逐个比对。
改了任何一边而没改另一边,这条测试当场红。

## #2 高度:42px,一个常量两处用

`App.less` 的工具条高度,和 `zellijSurface.ts` 里那个**首帧兜底** `contentBounds.y`,说的是同一件事
——「终端从哪一行开始」。今天两处各写一个 `48`,漂移了也没人会发现:首帧之后渲染层的
`ResizeObserver` 会用真实矩形把它盖掉,所以错的那一帧只是闪一下。

所以把它收敛成 `ZELLIJ_CHROME_HEIGHT`(shared),main 直接用,渲染层在 `main.ts` 里把它写成 CSS 变量
`--zellij-chrome-height` 给 Less 用。一个来源,两处消费。

## #3 白闪

之前 chrome 是浅色,所以没人注意到 `WebContentsView` 和 `BrowserWindow` 默认的白底。改成暗色之后,
加载那一瞬间的白屏会非常刺眼 —— 所以两处都显式 `backgroundColor: '#1a1b26'`:

- `ZellijSurface.createControls()` 的 `WebContentsView`
- 独立窗口的 `BrowserWindow`

## #4 chrome 长什么样

```
┌──────────────────────────────────────────────── 42px ─────────┐
│  [>_] Zellij   ● Connected                              [⚙]   │
│   绿    绿      状态点   次要色                          次要色 │
└───────────────────────────────────────────────────────────────┘
```

- 图标 16px、字标 13px 等宽半粗,都用绿;之前是 20px 图标 + 16px 粗标题,那是应用标题栏的体量。
- 状态点按 `snapshot.status` 上色:`ready` → 绿,`error` → 红,其余(`idle` / `starting` /
  `reconnecting`)→ 黄。**颜色是状态的第二条通道**,文字标签一个字都没少 —— 只靠颜色表达状态的界面
  对色觉障碍者等于没有状态。
- 设置按钮是无边框图标按钮,24px 方形,hover 时底色 `#414868`、图标转绿。

## #pending-questions

| # | 问题 | 倾向 | 阻塞什么 | 状态 |
|---|---|---|---|---|
| PQ-1 | 用户改了 `config.kdl` 的 `web_client.theme` 之后,chrome 要不要跟着变? | 要,但那是一条运行时读配置、经 XPC 推给渲染层的链路,不是这一发的体量 | G2 在「用户自定义主题」下的成立 | **未定** — 这一发钉在默认主题上;#1.1 的守卫保证的是**默认值**两边一致 |
| PQ-2 | 独立窗口要不要也去掉原生标题栏(`hiddenInset`)、让 chrome 自己当标题栏? | 不要 —— 那会同时要求 chrome 承担拖拽区与红绿灯让位,而 Cowork tab 里两者都不存在,一份 chrome 就得分叉 | G4 能做到多彻底 | **已定** — 保留原生标题栏 |
