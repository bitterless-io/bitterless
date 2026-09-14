# 两处 `await import()` 从来没有真的延迟过 —— 改成静态 import,并把告警清掉

状态:fixed · 2026-09-14 · 由 `yarn build` 的 vite:reporter 告警引出

## 现象

每次 main 构建都打两条:

```text
(!) src/main/maestro/llm/llmPaths.ts is dynamically imported by src/main/app.main.ts but also
    statically imported by …6 个文件…, dynamic import will not move module into another chunk.
(!) src/main/xpc/eyesOnAgents.handler.ts is dynamically imported by src/main/app.main.ts but also
    statically imported by auth.handler.ts, xpc.helper.ts, …
```

## 原因

一个模块同时被动态 `import()` 与静态 `import` 引用时,Rollup **不能**把它切成独立 chunk ——
切出去的话那些静态引用方就要跨 chunk 异步等待,语义不成立。于是它留在引用方所在的 chunk 里,
`import()` 退化成「对同一文件里已求值模块的一次 Promise 包装」。

实测当前产物:

| 符号 | 落点 |
|---|---|
| `configureMaestroPiAgentDir` | `out/main/app.main.js`(入口 chunk) |
| `startEyesOnAgentsRuntime` | `out/main/app.main.js`(入口 chunk) |
| 对照:`initXpc` | `out/main/chunks/xpc.helper-*.js`(**真的**切出去了,它只被动态引用) |

而且 `eyesOnAgents.handler` 的模块级副作用在产物里是**顶层语句**(零缩进):

```js
const lastUserPromptPreference = new LastUserPromptPreferenceService(electron.app.getPath("userData"));
…
const eyesOnAgentsHandler = new EyesOnAgentsHandler();   // 实例化即注册 xpc 方法
```

也就是说:**进程一启动它们就执行了**,远早于 `app.whenReady()`、更早于 `'eyes-on-agents'` 那个启动阶段。
那两处 `await import()` 今天延迟的是零。

## 决定:改成静态 import

不是为性能(主进程单进程读本地磁盘、`bytecode: false`,几十 KB 的解析是毫秒级),而是因为**代码现在
在暗示一件不成立的事**。两处动态 import 的真实意图都不是省启动,而是控制**调用**时机,那与 chunk 无关:

- `llmPaths`:约束是「`configureMaestroPiAgentDir()` 必须赶在第一次
  `await import('@earendil-works/pi-coding-agent')` 之前**被调用**」(pi 在 import 时冻结 `TOOLS_DIR`,
  见 [pi-agent-dir-uses-global-home.md](pi-agent-dir-uses-global-home.md))。pi 那几处 import 全都在函数体里,
  而 `llmPaths` 自身只是一组函数定义(没有模块级副作用),静态引入不会把 pi 提前拉进来。
- `eyesOnAgents.handler`:真正的门是 `startEyesOnAgentsRuntime()` 这次显式调用所在的启动阶段。
  模块求值本来就已经在进程启动时发生(见上),静态化不改变运行时何时启动。

保持不变的三件事:
1. `stopEyesOnAgentsRuntime` 仍是模块级 `let`,只有启动成功后才被赋值 —— 关机路径 `await stopEyesOnAgentsRuntime?.()`
   靠它区分「起过」与「没起过」。静态导入用别名引入实现,赋值语义一字不动。
2. 两处 `if (!canStartNextStage()) return;` 原地保留(`multi-instance.test.mjs` 断言全文件恰好 3 处)。
3. 调用点的位置不动 —— 顺序约束全在调用点上。

被拒绝的另一个选项:在 `build.rollupOptions.onwarn` 里屏蔽这条告警 —— 那会连同别处同类(可能真有意义的)
告警一起吞掉,而告警噪音掩盖新告警正是这次要解决的问题。

## 守卫

`scripts/mcp/multi-instance.test.mjs` 此前拿 `await import('./xpc/eyesOnAgents.handler')` 这行的**位置**
当标记,断言它排在 `optionalIntegrationsLifecycle.start(` 之后。标记改为 `await startEyesOnAgentsRuntime()`
—— 断言的语义不变,而且钉的是**真正该排后面的那件事**(运行时启动),不再是 import 写法。

`yarn build` 后两条告警消失,`out/main/app.main.js` 里两个符号仍在原处(行为等价的旁证)。

## 实测(2026-09-14,mac_arm)

| 项 | 结果 |
| --- | --- |
| `runWithRuntimeProfile release_preview -- yarn _build:release` | exit 0;`llmPaths` / `eyesOnAgents.handler` 两条告警**消失** |
| 产物落点 | `configureMaestroPiAgentDir`、`startEyesOnAgentsRuntime` 仍在 `out/main/app.main.js` —— 与改前同一个 chunk,行为等价的旁证 |
| `yarn typecheck:node` | main surface 66 个 error(既有基线);本次三个文件 `app.main.ts` / `eyesOnAgents.handler.ts` / `llmPaths.ts` **零诊断** |
| 顺序判据 | `optionalIntegrationsLifecycle.start(` < `await startEyesOnAgentsRuntime()`、`canStartNextStage` 恰好 3 处、`fenceAndJoin()` < `stopEyesOnAgentsRuntime?.()` 三条都 PASS(见下) |

**`yarn test:mcp:multi-instance` 当前整体是红的,且与本次改动无关。** 它在更早的一条断言上就抛了:

```js
assert.match(appMainSource, /app\.on\('second-instance',[\s\S]*?mainWindowHelper\.show\(\)/)
```

`app.main.ts` 里 `mainWindowHelper.show()` 已经一处都没有 —— 第二实例现在要么把 OnlyPreview 目标塞进
`onlyPreviewOpenQueue`,要么 `maestroWindowHandler.openMaestroWindow()`。用 `git show HEAD:` 核对过:
**HEAD 同样不匹配**,即这条红在本次改动之前就存在。后果是该文件那条断言之后的所有判据(包括本次更新的
顺序标记)当前都跑不到,所以上表那三条是**单独复算**的结果,不是这个守卫跑出来的。这条陈年红另开任务。

## 留下没动的

`src/renderer/home/src/router/index.ts` 还有一条同类告警(被 `main.ts` 与 `messageSearch.store.ts` 动态引,
又被两个 xpc subscriber 静态引)。渲染进程的 chunk 切分与首屏加载有关,判断依据和主进程不同,不在本次范围。
