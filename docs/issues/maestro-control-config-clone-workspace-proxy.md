# Maestro 控制面板启动报 `An object could not be cloned.`

**报告日期**：2026-09-17（Ral：「bl yarn dev:prod 启动 chat 窗口报错，之前是好的」）。

**状态**：✅ 已修并验证。三条契约全部落地（克隆 + 自吞错 + 守卫扫整个 control renderer）。
`node --test tests/maestro/maestroXpcPayloadCloneable.test.mjs` 8/8（含当天稍后补的内联 emitter
识别,见文末）；加宽后的守卫**先对回归行判红、
改回后转绿**，不是恒真。`main` / `renderer/maestro` 两个 surface 与 HEAD 基线逐行同量
（65 / 4），改动文件里零诊断。真机 `yarn dev:prod` 验收待 Ral。

**范围**：`channel.store.ts` 的 skill view context 上报；`loadControlConfig` 的启动边界；
`maestroXpcPayloadCloneable` 守卫测试的扫描面。

## 症状

`yarn dev:prod` 起来后，Maestro 控制面板顶栏正常显示会话标题（截图里是 `hihi`），
面板主体是错误卡：

```
Failed to load control config
An object could not be cloned.
[Retry]
```

## 根因

`a7373413`（2026-09-16，*feat(skills): add three-source catalog, live reload and Workbench tabs*）
往 `ChannelStoreState.syncActiveSession()` 加了一行：

[`channel.store.ts:53`](../../src/renderer/maestro/control/src/store/channel.store.ts)

```ts
void coach.setSkillViewContext({ sessionId, workspace: this.activeSession?.detail.workspace })
```

`channelStore` 与 `messageStore` 都是 `reactive(...)`（[`channel.store.ts:138`](../../src/renderer/maestro/control/src/store/channel.store.ts)、
[`message.store.ts:1874`](../../src/renderer/maestro/control/src/store/message.store.ts)），所以
`activeSession.detail.workspace` 取到的是一个 **Vue 响应式 Proxy**。
`workspace` 在契约里是对象而不是标量
（[`coach.api.ts:125`](../../src/shared/maestro/coach.api.ts)：`{ path; name; exists; updatedAt }`），
于是这个 Proxy 被原样递进 xpc emitter。

emitter → `xpcRenderer.send` → contextBridge → `ipcRenderer.invoke(XPC_EXEC, payload)`
（`electron-xpc@1.1.0`，`dist/renderer/index.mjs:53-60` + `dist/preload/index.mjs:51-58`），
走的是 Electron 的 structured clone，**Proxy 过不去**，边界上抛出正是那 37 个字符的
`An object could not be cloned.`。

这条抛在启动的关键路径上：

`loadControlConfig()`（[`ControlApp.vue:342`](../../src/renderer/maestro/control/src/ControlApp.vue)）
→ `await channelStore.init(tabs)`（同文件 :348）
→ `init()` → `messageStore.init()` → `ensureMaestroSession()` → `syncActiveSession()`
（[`channel.store.ts:57-63`](../../src/renderer/maestro/control/src/store/channel.store.ts)）
→ 抛 → 被 `loadControlConfig` 的 catch 接住（:356-358）→ 渲染错误卡（:464-466）。

`void` 不隔离同步抛出，所以这句"即发即忘"的上报把整个控制面板配置加载拖垮了。

**为什么"之前是好的"**：只有当前会话**绑了工作区**时 `workspace` 才是对象；没绑时是
`undefined`，可克隆，一路通过。跟 `dev:prod` 这个 profile 无关 —— `debug_prod` 只换
`VITE_ENV` / `VITE_RELEASE_CHANNEL` / `VITE_MAIN_TITLE` / Core URL 这几个环境变量
（`scripts/environment/runtimeProfile.config.cjs`），控制面板这条路上没有任何按 profile 的分支；
只是 Ral 的 `Bitterless_DEBUG_PROD` 那棵 userData 树里那个活跃会话恰好绑了工作区。

运行日志与之相符（`~/Library/Application Support/Bitterless_DEBUG_PROD/logs/main.log`）：
`03:12:27.525 renderer:maestroControl maestro-turn event=history action=refresh ok=true count=7`
说明 `messageStore.init()` 走完了；随后全程没有任何 `Uncaught (in promise)` 转发到主进程日志，
说明这次抛出是**同步的、且被 catch 住**，而不是一个未处理的 Promise rejection。

## 这条已经修过一次

同一个缺陷 2026-09-10 修过，并留了守卫测试
[`tests/maestro/maestroXpcPayloadCloneable.test.mjs`](../../tests/maestro/maestroXpcPayloadCloneable.test.mjs)，
注释里连症状带成因写得很清楚（「它只在绑定了工作区之后才发作」）。当时的两个出事点
`buildAgentContext` 和 `toStoredSession` 都改成了走
`cloneWorkspace()`（[`message.store.ts:1288`](../../src/renderer/maestro/control/src/store/message.store.ts)）。

**守卫没拦住这一次，是因为它只读一个文件**：测试开头写死
`readFileSync(... 'src/renderer/maestro/control/src/store/message.store.ts')`，
新出现在 `channel.store.ts` 的第三个调用点在它的扫描面之外。六天后就复发了。

## 修复契约

1. **`channel.store.ts:53` 过边界前克隆**，与三个兄弟调用点一致；同时给这句"即发即忘"
   补上自己的 catch，理由与 `message.store.ts:346-353` 的 `ensureSessionIo` 相同 ——
   skill view context 同步失败不该让控制面板起不来。
2. **守卫测试改成扫整个 control renderer**，而不是单个文件：任何把 `.detail.workspace`
   直接作为 `workspace:` 值递给 xpc 的写法都要失败。只要扫描面还是一个文件，第四个调用点
   还会这样溜过去。
3. 不动 `electron-xpc`。它按 Electron 序列化器的规矩如实抛错，版本自 2026-04-06 起没变过
   （`yarn.lock` 锁 1.1.0），不是这次的变量。

## 验证

- `node --test tests/maestro/maestroXpcPayloadCloneable.test.mjs`（含加宽后的新用例）。
- `yarn typecheck`：按 [`bitterless-verify-baseline-vs-head`] 的口径与 HEAD 基线比对，
  只看本次改动是否新增错误。
- 不跑 Electron E2E（CLAUDE.md）。真机验收归 Ral：`yarn dev:prod`，控制面板正常出聊天区，
  且工作区已绑的会话不再出错误卡。

## 守卫的第二次加宽:内联 emitter(2026-09-17,当天稍后)

按配对开发规则把加宽后的守卫搬去 micromeet-cowork 时,发现两边的 emitter 写法并不一样,而本仓
这版**只认常量声明**(`const x = createXpcRendererEmitter(…)`):

```ts
// micromeet-cowork apps/cowork/src/renderer/control/src/store/channel.store.ts:69,setActive()
void createXpcRendererEmitter<CoworkXpcContract>('CoworkXpcHandler').setSkillWorkbenchContext({ sessionId: session.id })
```

emitter 不落常量、直接链式调用 —— 这一整类调用在原来的识别口径里**根本不存在**。本仓今天恰好
一处这种写法都没有,所以它是个**潜在**盲区而不是现行缺陷;但"下一次复发挑哪个项目发生"不是可以
赌的事,两边于是统一成同一识别口径(常量 + 内联)。

对应文件:[`micromeet-cowork/docs/issues/workspace-proxy-breaks-xpc.md`](../../../micromeet-cowork/docs/issues/workspace-proxy-breaks-xpc.md)
`#Guard widened after bitterless recurred`,守卫落在 `apps/cowork/tests/unit/xpcPayloadCloneable.test.mjs`。

**cowork 那边今天有缺陷吗?没有。** `setSkillWorkbenchContext` 的契约只收 `sessionId`
(`cowork.api.ts:306`),没有对象可克隆。搬过去的是守卫,不是修复。

验证:本仓 `node --test tests/maestro/maestroXpcPayloadCloneable.test.mjs` 8/8(加宽后多一条
"两种 emitter 写法都在识别口径里");并重新确认守卫仍然**判得了红** —— 把 `channel.store.ts` 那行
改回按引用递,立刻红并指名该行,改回来转绿。

## 另一处顺手改正的事实错误

`piRuntimeAdapter.ts` 顶上那句「`allowModelNetwork` 不传 —— 0.85.1 的默认值是 false,与我们一直设的
`PI_OFFLINE=1` 同义」在**本仓是错的**。pi 0.85.1 `dist/core/model-runtime.js`:

```js
const runtime = new ModelRuntime(…, process.env.PI_OFFLINE === undefined);   // :88 modelNetworkEnabled
const refreshFromNetwork = runtime.modelNetworkEnabled && options.allowModelNetwork === true;  // :91
```

结论(目录抓取不走网络)对,理由错:靠的是 `=== true` 这个判断,而**不是** `PI_OFFLINE`。
全仓搜索 `PI_OFFLINE` 只命中那句注释本身 —— 设它的是 micromeet-cowork
(`bundledTools.service.ts`,而且那是为了工具下载)。也就是说本仓的 `modelNetworkEnabled` 实际是
**true**,哪天有人真传 `allowModelNetwork: true`,这里就会走网络,没有任何离线开关兜底。注释已按
这个事实改写(两边都改)。
