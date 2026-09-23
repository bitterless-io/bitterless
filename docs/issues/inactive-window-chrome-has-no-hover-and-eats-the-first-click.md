# An inactive window's tab strip has no hover and swallows the first click

Status: fixed; owner verification pending (2026-09-22)

Related: [Maestro](../features/maestro.md),
[A hidden view keeps its drag region and eats clicks](a-hidden-view-keeps-its-drag-region-and-eats-clicks.md)

## Report

Ral 2026-09-22:「我激活别的窗口的时候，这个时候点击某一个 tab。当我 hover 到某一个 tab 上时，
tab 的背景色并没有发生变化；而且我需要先点击一遍激活窗口，再点击一遍才能直接到 tab 上。
而 Chrome 是能够直接激活没有被聚焦的窗口的 tab 的。」

两件事，同一个前提：**窗口没有被聚焦**。

## Confirmed cause

Agent Browser 的 tab 条是 DOM（`src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue`，
画在窗口自己的 webContents 上）。Chrome 的 tab 条是**原生 Views 控件**。macOS 对这两者的规则不同，
所以这不是一个 CSS 缺陷 —— `.maestro-menu-bar__tab--idle:hover` 一直都写着，只是事件根本没送到。

### 1. hover 不变色 —— Chromium 主动丢掉非 key 窗口的 mouse-moved

`content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm` 的 `shouldIgnoreMouseEvent:`：
事件类型是 `NSEventTypeMouseMoved`、视图不 `acceptsMouseEventsWhenInactive`、窗口既不是 main 也不是
key —— 三条同时成立就**忽略**。而 `acceptsMouseEventsWhenInactive` 的判据是
`[[self window] level] > NSNormalWindowLevel`，普通应用窗口恒为 false。

于是后台窗口的网页内容收不到任何 `mousemove`，Blink 不会更新 hover 链，`:hover` 永远不生效。
把窗口抬到 `NSNormalWindowLevel` 之上（`alwaysOnTop`）确实能同时解决 hover 与首次点击，但那等于
让 Agent Browser 永远浮在所有应用之上，不是可接受的代价。

### 2. 第一下点击只用来激活窗口 —— `acceptsFirstMouse` 默认 NO

macOS 的默认是：失焦窗口上的那一下 mouse-down **只激活窗口**，不下发给内容视图。Electron 把它
暴露成 `BaseWindowConstructorOptions.acceptFirstMouse`。

本仓库已经在两个地方做对了 —— `src/main/windows/omniWindow.helper.ts`（Omni Browser）与
micromeet-cowork 的 `blBaseWindow.ts`（2026-09-02 Ral 报的同一个症状）—— 唯独 Maestro 主窗那条
路径 `src/main/maestro/windows/window.helper.ts` 没有设，所以 Agent Browser 还要点两下。

这是**窗口级**选项：窗口里的 `WebContentsView` 子视图（操作区、控制面板）一并生效。

## Fix

1. `src/main/maestro/windows/window.helper.ts`：darwin 下 `acceptFirstMouse: true`，与 omni /
   cowork 对齐。代价与 cowork 记过的一样 —— 从别的应用切回来的第一下会**真的点下去**；破坏性动作
   都另有二次确认，这是 Ral 已经做过的取舍。
2. `src/main/maestro/windows/main/inactiveChromeHover.service.ts`（新）：窗口失焦期间，主进程按
   固定间隔读 `screen.getCursorScreenPoint()`，光标落在**窗口 chrome 那一条**（操作区之上的
   78px）时，用 `webContents.sendInputEvent({ type: 'mouseMove' })` 把这一次移动补给 chrome 的
   webContents；离开时补一次 `mouseLeave`。`sendInputEvent` 直接进 RenderWidgetHost，不经过
   Cocoa 那层判据，所以 `:hover` 恢复成普通 CSS 行为 —— tab、关闭按钮、地址栏按钮全部照常，
   **渲染进程不需要任何新的 hover class**。
   - 只在 `blur` 之后、窗口可见且未最小化时跑；`focus` 立刻停（原生事件自己会接上）。
   - 只补 chrome 那一条：网页内容与控制面板是另外的 webContents，合成 hover 进任意网站既没有
     必要也不便宜。控制面板的后台 hover 是已知的遗留缺口，本次不做。
3. `MenuBar.vue` 的 `armNewTabMenu()` 加一条 `document.hasFocus()` 闸：合成 hover 之后，鼠标
   停在 `+` 上 600ms 会弹一个**原生**菜单，而原生菜单一出现就抢焦点。后台窗口不该弹它。

## Verification

- `yarn typecheck` / `yarn build`
- `tests/unit/inactiveChromeHover.test.mjs`：纯函数 `resolveInactiveHover()` 的判据表 —— 光标在
  chrome 条内 → `move`；移出 → 一次 `leave`；再移动 → 不重复发 `leave`；窗口外 → 什么都不发。
- 人工（Ral）：另一个应用在前台时，hover Agent Browser 的 tab 背景变色；一次点击直接切到那个 tab。

## Out of scope

控制面板（右侧 Chat）与操作区网页在后台窗口下仍然没有 hover —— 同一个 Chromium 判据，但补 hover
进任意网站不是本次要做的事。
