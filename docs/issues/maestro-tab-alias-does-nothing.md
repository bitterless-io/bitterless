# `Alias…` 点了没反应 —— 菜单到表单那一调丢了 `this`

Status: root cause proven and fixed; owner verification pending (2026-09-16)

Related: [Tab 别名(Alias)](../features/tab-alias.md),
micromeet-cowork `apps/cowork/src/main/modules/browser/browser.controller.ts`(同一个功能在 cowork
的落地,Ral 确认是好的)

## Report

Ral 2026-09-16:「alias 无效」，同一个功能在 micromeet-cowork 里是好的。第一轮修复之后他再次确认
**仍然无效**。他跑的是打包的 Bitterless Preview（`version_code` 260916131737）。

## Confirmed cause

`MaestroBrowserViewService.promptTabAlias`（菜单项 `Alias…` 的落点）把 controller 的方法**摘进局部
变量再调**：

```ts
const request = this._state.requestTabAlias   // ← 摘出来,丢了 this
if (!request) return
const answer = await request({ ... }).catch((err) => { emitTrace(...); return null })
```

`this._state` 就是 `MaestroWindowController`（`setState(this)` 传的是 controller 本人），而
`requestTabAlias` 是一个普通类方法，第一行就是 `this.historyView.hide()`。ES module 是严格模式，
摘出来的函数被裸调时 `this === undefined`，于是这一调**同步抛**：

```
TypeError: Cannot read properties of undefined (reading 'historyView')
```

三件事叠在一起，让它成为一个**完全无声**的失败：

| 环节 | 后果 |
|---|---|
| 抛发生在**求值调用表达式**时 | 挂在调用**结果**上的 `.catch()` 根本没机会挂上 —— 那个 `catch` 里的 `emitTrace` 从来没执行过 |
| `promptTabAlias` 是 async | 同步抛变成一个 rejected promise |
| 菜单项写的是 `click: () => void this.promptTabAlias(tab.id)` | `void` 把它丢掉 ⇒ unhandled rejection，没有任何 handler 记录 |

所以：点 `Alias…` → 什么都不发生 → 表单从来没有被请求过 → 覆盖层那一侧的每一行日志（包括
`gate=…`）当然也不会出现。**这解释了为什么日志里一片空白**，也解释了为什么第一轮针对覆盖层的
加固（静态 import、失败闩、`setVisible` 配对）一点用都没有 —— 它们修的是后半条链，而执行根本走不
到那里。

cowork 没这个 bug，因为它调的是模块单例：`shellAlertViewService.requestPrompt({...})` —— 方法调用，
`this` 天然绑住。

### 证据

用**真实源码**拼出那条缝跑一遍（`promptTabAlias` + `MaestroWindowController.requestTabAlias`，
按生产方式接线）：

| 代码 | 结果 |
|---|---|
| 修复前（摘进局部变量） | `UNHANDLED REJECTION → TypeError: Cannot read properties of undefined (reading 'historyView')`；`historyView.hide` / `requestAlias` **一次都没被调用**；trace 为空 |
| 修复后（调在 `this._state` 上） | `historyView.hide` → `requestAlias` → 写回 `tab.alias` → `broadcastTabs`，三行日志齐全 |

这条缝现在是 `tests/maestro/maestroTabAliasDialog.test.mjs` 里的一条回归用例，并且已经验证它在
旧代码上**会红**（同一个 TypeError）。

## 第一轮的误判（留档）

第一轮把嫌疑定在 `tabAlias.ts` 的 `await import('./TabAliasApp.vue')` 上（打包后走 Vite 的
`__vitePreload`，`file://` ＋ CSP 下可能整条 `import()` 抛掉，而 `loadFile` 已经 resolve，于是主进程
挂上一张什么都没画的透明层）。那条推理本身成立，但**它不是这次的原因** —— 执行连覆盖层都没走到。
排查时缺的那一环是：没有先证明「表单到底有没有被请求过」。改成静态 import 的那一条保留（每个
兄弟渲染入口都是静态的，且去掉了一个真实的 `file://` 失败面），但它是加固，不是修复。

## Fix contract

- `promptTabAlias` **调在 `this._state` 上**，不摘进局部变量。这一条不是风格问题：摘出来就丢 `this`。
- 菜单项的 `click` 带 `.catch()`，任何一次抛都落一行日志与一条 trace —— fire-and-forget 的 handler
  不许再有无声路径。
- **整条线补日志**（Ral 2026-09-16:「有日志么,没日志补一下,看下哪里失效了」），统一走
  `moduleLog('tab-alias')`，一次改名的所有步骤在一条 grep 里连起来：

  | 行 | 出处 | 它证明什么 |
  |---|---|---|
  | `menu clicked` | browserView | 菜单项确实点到了这个 tab |
  | `dialog requested` | 覆盖层 | 请求到达了覆盖层（本次失败就断在这一行之前） |
  | `layer preload requested` / `layer loaded` / `layer load failed` | 覆盖层 | 渲染进程建起来了没有 |
  | `renderer bootstrap start` / `renderer mounted` | 表单渲染层 | 表单真的挂载了 |
  | `snapshot pulled` | XPC handler | 渲染层确实在跟 main 说话 |
  | `not attached gate=…` / `dialog attached` | 覆盖层 | 挂没挂上、被哪道闸拦下 |
  | `answer received` / `dialog answered` / `alias applied` | 覆盖层 ＋ browserView | 答复回来了、写回了 |

- `/maestro/tabAlias/index.html` 补进 `logPolicy.service.ts` 的第一方渲染进程表。不在那张表里时，
  这个渲染进程自己报的任何错都**到不了日志文件** —— 与 Zellij 那条注释记录的是同一个坑。

## Acceptance

- 普通网页 tab 右键 → `Alias…` → 表单弹出，预填当前别名。
- 保存 → chip 立刻显示别名；清空保存 → 回到页面标题；Escape / 取消 → 一个字不改。
- `grep '"scope":"tab-alias"' ~/Library/Logs/<profile>/main.log` 能看到从 `menu clicked` 到
  `alias applied` 的完整一串；任何一步断掉时，最后一行就是断点。
