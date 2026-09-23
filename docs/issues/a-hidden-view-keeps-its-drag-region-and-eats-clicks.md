# A hidden view keeps its drag region, so a透明 menu bar eats clicks on the tab in front

Status: fixed; owner verification pending (2026-09-22)

Related: [Maestro](../features/maestro.md),
[onlypreview-default-homepage](../features/onlypreview-default-homepage.md),
[An inactive window's tab strip has no hover and swallows the first click](inactive-window-chrome-has-no-hover-and-eats-the-first-click.md)

## Report

Ral 2026-09-22:「网页类的 tab 顶部有一段类似于 menu bar 高度的区域，是无法进行点击的。但是那段
区域可以被拖动。我觉得这个应该是 menu bar 没有被隐藏 disable。例如，当 only preview 在 tab 中
展示的时候，它顶部的 menu bar 是可以被拖动的……主要是 Web 端不应该出现一个透明的 menu bar。」

他的判断是对的：那确实是 OnlyPreview 的 menu bar，只是它不可见。

## Confirmed cause

Electron 40 把**每一个**挂进窗口的 `WebContentsView` 注册成一个 draggable-region provider，而窗口
的命中测试会把它们全部问一遍：

- `shell/browser/api/electron_api_web_contents_view.cc` `WebContentsView::NonClientHitTest()` —— 把
  widget 坐标换算进这个 view 的局部坐标，落在它自己的 `draggable_region()` 里就返回 `HTCAPTION`。
  **没有可见性判据。**
- `shell/browser/native_window.cc` `NativeWindow::NonClientHitTest()` —— 按**注册顺序**遍历所有
  provider，第一个命中就返回。**不是 z 序。**

`HTCAPTION` 在 macOS 上的意思是「这里是标题栏」：那一下 mouse-down 变成拖窗口，永远不会到达画在
那个位置的页面。

Maestro 主窗里因此出现的具体链条：

| 事实 | 出处 |
|---|---|
| 固有 Home 那一格装的是 OnlyPreview composite | `defaultHome: true`，`src/main/windows/onlyPreviewCoworkTab.ts` |
| 它的 shell 顶部 32px 声明 `-webkit-app-region: drag` | `src/renderer/onlypreview/shell/src/App.less` `.onlypreview-shell__menu-bar` |
| 切到网页 tab 时它只是 `setVisible(false)` | `src/main/windows/onlyPreviewCoworkMount.ts` `reportActivation()` |
| 它的 bounds 仍然跟着操作区走 | `refreshCompositeTabs()` → `spec.refresh(host)` |

隐藏 ≠ 注销。所以操作区顶部 32px 一直被那块看不见的 menu bar 认领：**点不动，但拖得动**，
高度正好是一条 menu bar —— 与报告逐字吻合。

## Why the other embedded surfaces are already clean

这条规则本仓库其实已经立过，只是 OnlyPreview 漏了。嵌进别人窗口的 chrome 一律在 embedded 态改
`no-drag`：

- `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less` `.trench-header--embedded`
- `src/renderer/todo/src/components/MenuBar/MenuBar.less` `.menubar--omni`
- `src/renderer/eyesOnAgents/.../EyesOnAgentsMenuBar.less` `.eyes-menu-bar--omni`
- `src/renderer/submodules/.../SubmodulesMenuBar.less` `.submodules-menu-bar--omni`

全仓扫描 `-webkit-app-region: drag` 之后，**OnlyPreview shell 是唯一一个嵌进宿主窗口却仍然声明
drag 的 surface**。

## Contract

> 一个 `WebContentsView` 只有在**它自己拥有那扇窗的标题栏**时才可以声明
> `-webkit-app-region: drag`。嵌进别人窗口的 surface（Maestro composite tab、Omni mini-app cell）
> 一律 `no-drag`。

理由不止是这个缺陷：在 tab 里拖内容去移动宿主窗口本来就不是 tab 的语义（Chrome 也不这么做），
Ral 说的「虽然这个有问题，但我暂时可以接受」指的正是它。按这条契约，那个行为一并消失。

## Fix

- `src/renderer/onlypreview/shell/src/App.vue` / `App.less`：新增 `--embedded` 修饰符，在
  `!ownsWindow`（`onlyPreviewEnv.host === 'cowork'`，即装在 tab 里）时改 `no-drag`；同一条件下
  双击 menu bar 不再 `toggleMaximizeWindow()` —— 嵌入的 chrome 不操作宿主窗口。
- `scripts/check-embedded-drag-region.mjs`（新，接进 `yarn check:*`）：对每一个声明
  `-webkit-app-region: drag` 的 surface，要求同文件里存在一个 embedded/omni 修饰符把它改回
  `no-drag`，否则失败。下一个嵌入 surface 不会再忘。

## Omni Browser —— 报告已收到，尚未定位

Ral 2026-09-22 还报了：「在 Omni Browser 中打开网页时，当我激活 layout，准备通过 layout 顶部的
状态栏去关闭这个窗口时，由于透明 menu bar 的遮挡，导致我无法关闭。」

已核实的部分：Omni 窗口里唯一声明 drag 的 surface 是它自己的窗口 chrome
（`src/renderer/omni/omniWindow/src/App.less` `.omni-menubar`，y 0–32，这是**正当的**）；
cell 的 header（`omniCell`，`no-drag`）、layout 编辑器（`omniControl`，无 drag）、以及所有可以
装进 cell 的 mini app 都已经按上面的契约做了 embedded `no-drag`。layout 编辑器的 bounds 从
`y = MENUBAR_HEIGHT` 开始（`updateControlBounds()`），与那 32px 不重叠。

也就是说 Omni 这一例**不能**用同一条链条解释，静态审读没有找到第二个 drag 来源。要继续需要 Ral
给出准确的那一个控件：是 macOS 左上角的红绿灯，还是 layout 编辑器里某个 pane 自己的关闭控件。
在拿到之前不做猜测性改动。

## Follow-up reports (2026-09-22)

1. **Omni 的 layout panel header 点不动 —— 仍然开着。**
   Ral:「在 eyesOnAgents / submodules / motto 打开时，且 layout 配置激活时，点击这些 miniapp 上
   覆盖的 layout panel header 中关闭按钮时无法点击且能拖动，表现的和系统 menubar 差不多，按理只有
   standalone 窗口才能这样；而且 standalone 和嵌入式显示状态切换时 menubar 的交互状态也应该切换。」

   **已排除**（源码 + **编译产物**两层都查过，按 CLAUDE.md 那条「要在真正渲染那份 CSS 里验」）：
   - `.eyes-menu-bar` / `.submodules-menu-bar` / `.menubar`(todo) 的基础规则是 `drag`，各自的
     `--omni` 修饰符在**同一份产物 CSS 里、排在后面**，把它改回 `no-drag`（`out/renderer/assets/`
     实测）；`host` 判据来自 preload 的 `process.argv.includes('--mode=omni')`，而 Omni 的
     mini-app content view 确实带着 `--mode=omni`（`omniWindow.helper.ts` 建 view 处）。
   - `.motto-menu-bar` **从来就是 `no-drag`**，它根本没有 drag 区 —— 而 Ral 说 motto 同样中招。
     这一条直接否掉「mini app 自己的 menu bar 是 drag 源」这个解释。
   - Omni 窗口里剩下的唯一 drag 源是它自己的 `.omni-menubar`（y 0–32），而 layout 编辑器的
     bounds 从 `y = MENUBAR_HEIGHT` 开始（`updateControlBounds()`），两者不重叠。

   所以 Omni 这一例**另有来源**，静态审读找不到第二个 drag provider。下一步需要在**运行中的 Omni**
   里取证：layout 编辑器打开、鼠标停在那个关闭按钮上时，`NativeWindow::NonClientHitTest` 命中的是
   哪一个 view —— 最省事的取法是给 Omni 的每个 `WebContentsView` 打一遍 bounds + `draggable_region`
   的日志，而不是继续猜。**未做任何猜测性改动。**

2. **失焦再聚焦抢走地址栏焦点 —— 已修。**
   见 [Refocusing the window steals focus into the address bar](refocusing-the-window-steals-focus-into-the-address-bar.md)。
