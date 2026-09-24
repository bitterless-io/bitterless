# 选 Bitterless 模型时聊天里提示「Sign in to Bitterless」—— 就绪探测从来没注册过这个 provider

Status: fixed 2026-09-24（单测 + 独立复核）；real Bitterless turn in the app pending Ral

## 现象

Ral 2026-09-24：「当我选择 bitterless 模型 provider 的时候，它让我登录，但实际上在这种情况下应该是直接展示登录页面的。」

Control 聊天输入框上方出现卡片 `Sign in to Bitterless to use this model.` + **Login** 按钮，发送被禁用；
点 Login 没有任何反应。

## 根因

聊天能显示，说明应用账号已经是 `ready`（Control 的闸门和 Main 的发送闸门读的是同一份 Home 权威快照）；
而 `ready` 的冷启动恢复与交互登录都会经 `activateAuthenticatedSession()` 把 Core 会话推进 main 的
`customerSessionService` —— **token 在，不是它触发的提示**。

1. 卡片条件是 `needsLlmLogin = … && !activeLlmProvider.ready`（`ControlApp.vue`）。
2. `ready` 来自 main `MaestroLlmService.checkLlmProviderReady()`：除 Codex 外，它**自己** `ModelRuntime.create()`
   一个 pi runtime 再 `getModel(provider, model)`。pi 没有内置的 `bitterless`，provider 注册只存在于做注册的
   那个 runtime 实例上，而 `registerBitterlessProvider()` 只在建会话的 `createModelRuntime()`
   （`piRuntimeAdapter.ts`）里调 —— 探测用的 runtime 从没注册过，于是 **Bitterless 永远 not ready**。
   main 日志每次都有 `[maestro llm] provider readiness "bitterless" not ready`。
3. Login 按钮调 `loginLlm({ provider: 'bitterless' })` → `resolveLoginMethod()` 抛
   `Unknown LLM provider: bitterless`（`LLM_LOGIN_PROVIDERS` 刻意只有 Codex）→ renderer 里一个未处理的
   rejection，界面无反应。
4. 来历：旧的 relay provider `ai-crms` 在这条探测里有自己的分支，`fbee79b4`（2026-09-10）随 ai-crms 一起删了；
   `59f1832d` 加 Bitterless provider 时没有补分支。Cowork 的参照实现至今有这条分支
   （`coworkLlm.service.ts` `checkLlmProviderReady` 的 `ai-crms` 段：纯读会话，不建 runtime）。
5. [bitterless-model-provider.md](../features/bitterless-model-provider.md)「Where it registers」一节说在
   `createModelRuntime()` 注册能让 `checkTarget()` 答对 —— `checkTarget()` 没有调用方，就绪探测走的是另一条路。
   这一节按本修复更正。
6. 同一类缺陷：`compaction.handler.ts` `resolveTarget()` 也自建 runtime、不注册。它服务的是 `shouldCompact`
   （自动压缩的真实用量否决票），不是 `/compact`（那条走会话自己已注册的 runtime）—— 修复前的症状是对 Bitterless
   `shouldCompact` 永远 `no-usage`，否决票被静默跳过。
7. 同一类、**不在本次范围**：workflow agent 在 utilityProcess 里自建 runtime，relay 描述只认 `ai-crms`，
   选 Bitterless 时报 `Workflow model authentication unavailable`。另案跟踪。

## 契约

- **Bitterless 的就绪 = 应用账号会话在 main 里**：`checkLlmProviderReady('bitterless', model)` 是纯读 ——
  `customerSessionService.current` 存在（它只在 token 与 baseUrl 都有时才存在）且 `model` 属于 Bitterless 预设。
  不建 pi runtime、不进锁、不走网络（与 Cowork 的 ai-crms 分支同形）。
- **会话变化要重播配置**：`customerSessionService` 变化（登录、恢复、登出、失效）时 main 重新计算并广播
  `coach/llm-config`，Control 里 Bitterless 的就绪随之更新，不需要人重新选一次模型。
- **聊天里不再有「去 pi 登录 Bitterless」这条路**：Bitterless 不在 `LLM_LOGIN_PROVIDERS`，卡片的动作对它改成
  「重新验证应用账号会话」—— `localHomeAuthStore.restoreSession()`：会话有效 → Home 重新推 token → 就绪；
  会话已失效 → Home 清掉会话 → Control 的闸门直接换成**登录表单**（[control-login-form.md](../features/control-login-form.md)）。
  任何失败都要可见，不能再有未处理的 rejection。
  **代价（已接受，记录在案）**：`restoreSession()` 走的是完整恢复路径，Home 快照经历 `ready → restoring → ready`：
  Control 闸门会把聊天换成「恢复登录状态」再换回，main 会挂起再恢复已登录会话（中止所有进行中的回合、重建
  workflow host）。这张卡片只在「应用已登录但 main 丢了会话」这种边缘情况下出现（推送失败、会话号不匹配的失效），
  而且这次闪一下是承重的：main 已持有同一会话时 `set()` 不通知、不重播，只有重新挂载才刷新 Control 的配置。
  去掉闪烁需要一个不翻阶段的「重推会话」命令外加一次显式配置刷新 —— 记入 backlog。
- 未登录时根本看不到聊天（闸门），所以「未登录 → 直接显示登录页」由闸门保证，不靠这张卡片。
- 压缩 handler 解析目标时，对 Bitterless 先 `registerBitterlessProvider(runtime)` 再找模型。

## 验证

- 单元：`checkLlmProviderReady` 对 bitterless 在有 / 无会话时分别为 true / false，且不调用
  `ModelRuntime.create()`；会话变化触发一次 `coach/llm-config` 广播；Control 对 bitterless 不调用 `loginLlm`；
  压缩对 bitterless 注册后能找到模型。
- `yarn typecheck:web` / node 面、scoped ESLint。
- 不跑 Electron E2E。真实一轮 *Bitterless → Qwen 3.8 Max* 仍需 Ral 在应用里登录后跑一次。

## 结果

- `maestroLlm.service.ts`：`checkLlmProviderReady()` 的 `bitterless` 分支纯读会话 + 预设；`watchAccountSession()`
  订阅一次、监听器不抛；`getAndBroadcastLlmConfig()` 加 latest-wins 代数，晚到的旧求值不再广播。订阅挂在进程级
  单例 `maestroWindow.controller.ts` 的构造里，与 `applicationAuth.subscribe` 同一生命周期。
- `ControlApp.vue`：Bitterless 的 Login 改为 `localHomeAuthStore.restoreSession()`，转圈、防重、失败 toast；
  Codex 路径与卡片文案不变。`compaction.handler.ts`：查模型前注册。文档与注释按上面第 5–7 条更正。
- 新测试 `tests/maestro/bitterlessProviderReadiness.test.mjs` 8/8（对原码 7/8 失败，唯一通过的是未改的 Codex 路径）；
  `maestroCompactionHandler` 5/5（补了新 import 的桩）、`maestroContextWindowFallback` 8/8。复核 16 个变异杀 15 个，
  漏掉的是「删掉 controller 里那一行订阅」—— 接线未被测到，记入 backlog。
- typecheck 触及面前后同为 72 条既有诊断（仅 `piRuntimeAdapter.ts` 两条旧诊断下移 4 行）；ESLint 无新错误。
- [review 1](../plan/reviews/bitterless-provider-readiness-189-1.md)：pass。未跑 Electron E2E；真实一轮
  *Bitterless → Qwen 3.8 Max* 需 Ral 登录后在应用里跑。
