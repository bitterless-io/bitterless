# Maestro 每标签 debugger 开关从 UI 消失,能力被搁死在无人调用的 store 方法后面

Status: 已确认(2026-08-28)—— 缺陷成立,**修法待 Ral 定**(三选一,见「Required behavior」)

## Observed behavior

MenuBar 上那个每标签 debugger 开关**不存在了**,任何 renderer 里都没有替代入口。

```bash
$ grep -rn "IconBug" src/renderer/            # → 0 命中
$ grep -rn "toggleActiveDebugger" src/         # → 只有 1 处:定义,零调用方
  src/renderer/maestro/home/src/components/MenuBar/tab.store.ts:213
```

删除发生在 **`1a7607f`(2026-08-25 21:09,"chore: sync")**:

```diff
-  IconBug,
-  IconBugOff,
-          <IconBug v-if="tabStore.activeTab?.debuggerEnabled" :size="18" stroke="1.8" />
-          <IconBugOff v-else :size="18" stroke="1.8" />
```

**它没有搬到别处。** 原生标签右键菜单(`maestroBrowserView.service.ts:907-925`)是
New tab / Reload / Duplicate / Close / Close other tabs / Close tabs to the right ——
**没有 debugger 项**。

**后端整条链路完好**:

| 层 | 位置 |
|---|---|
| store 方法(**孤儿**) | `tab.store.ts:213 toggleActiveDebugger()` → `:218 coach.setTabDebugger(...)` |
| xpc 契约 | `src/shared/maestro/coach.api.ts:35` |
| handler | `src/main/maestro/xpc/coach.handler.ts:103` |
| 控制器 | `maestroWindow.controller.ts:419-420` |
| 实现 | `maestroBrowserView.service.ts:291-296` |
| 消费方 | `capture/capture.service.ts:263`(要求 `kind === 'browser' && debuggerEnabled`)· `:274` |

## Impact

浏览器标签的 `debuggerEnabled` 默认是 **`true`**
(`maestroBrowserView.service.ts:368` / `:1013`;`:210` 那个 `false` 是固定 Home 标签,
而 Home 是 `kind:'home'`,`capture.service.ts:263` 本来就不给它抓)。

⇒ **抓取功能没坏,但用户再也无法把某个标签的 debugger 抓取关掉**(关掉后也无法开回来)。
能力被搁死在一个**没有任何调用方**的 store 方法后面。

这不是"少了个按钮"那么轻:debugger attach 会影响页面行为与性能,
遇到某个站点被 attach 搞出问题时,现在**没有任何逃生阀**。

## Root cause

**两条,缺一不可:**

### R1 —— 删除是通过一次未经审查的 `chore: sync` 提交进来的

`1a7607f` 的提交信息是 `chore: sync 2026-08-25 21:09`。一次同步型提交移除了一个 UI 能力入口,
且**没有同时清理它背后的 store 方法**,留下了孤儿代码。孤儿方法的存在让"这个能力还在"看起来成立
—— 代码在、契约在、实现在,**只有入口没了**。

### R2 —— 本该拦住它的守卫在同一时期整套失效

```js
// scripts/maestro/check-debugger-toggle.mjs:51
assert(menu.includes('IconBug') && menu.includes('IconBugOff'), 'MenuBar should render debugger icons')
```

**这条断言完全正确,而且它现在确实红。它只是没被执行过。**

时间线:

| 日期 | 事件 |
|---|---|
| 2026-08-24 | `c67ac21` 引入 `@shared/claudeSubscription` 等跨界 import ⇒ `assertMaestroAliasBoundary()` 开始失败 ⇒ **`check-maestro.mjs` 死在 `:13`,38 个脚本 spawn 数变成 0** |
| **2026-08-25 21:09** | **`1a7607f` 删掉 debugger 按钮 —— 守卫已经瞎了一天** |
| 2026-08-28 | 手动逐个跑守卫时才发现 |

⇒ **根因归属**:`docs/issues/maestro-parity-guards-silently-dead.md` 的 **R3**
(总入口把跨切面前置条件排在个体检查之前,用硬 `assert` ⇒ 一条无关违规连带打黑 38 个检查)。

**这是第一个被证实"从沉默的守卫下溜过去"的真缺陷。** 它证明 R3 不是理论风险。

## Required behavior

能力必须**有一个可达的入口**,或者**被明确退役**。三选一,**由 Ral 定**:

| 选项 | 做什么 | 代价 |
|---|---|---|
| **A. 恢复 MenuBar 按钮** | 把 `IconBug` / `IconBugOff` 与 `toggleActiveDebugger()` 接回 MenuBar | 与 `92a4afc`(2026-08-25)那次 chrome 瘦身(96px → 84px)的意图可能冲突 —— 按钮当初可能是**故意**去掉的 |
| **B. 移到原生标签右键菜单** | 在 `maestroBrowserView.service.ts:907-925` 加一项 | 不占 chrome 空间,发现性差一些;需要 i18n 处置(该菜单目前是硬编码英文) |
| **C. 明确退役整个能力** | 删 `tab.store.ts:213-223`,并**连带**决定 `setTabDebugger` 那条 xpc 链路与 `check-debugger-toggle.mjs:51` 的去留 | 失去逃生阀。**若选此项,`debuggerEnabled` 应改成配置项或常量,而不是留一个永远为 true 的字段** |

**无论选哪个:**

- **不要只把 `check-debugger-toggle.mjs:51` 那条断言删掉了事。** 那条断言是对的,
  它是这次唯一告诉我们出事的东西。退役必须留痕(原因 + 日期),见 guards issue 的 Required behavior。
- **孤儿 store 方法要一起处置** —— 要么接回入口,要么删掉。留着它会让下一个人以为能力还在。

## 相关

- [`maestro-parity-guards-silently-dead.md`](maestro-parity-guards-silently-dead.md) ——
  R2 的根因在那里;本 issue 是它的**第一个已证实后果**
- `1a7607f`(删除)· `92a4afc`(同期 chrome 瘦身,可能解释删除动机)· `c67ac21`(致守卫失明)
