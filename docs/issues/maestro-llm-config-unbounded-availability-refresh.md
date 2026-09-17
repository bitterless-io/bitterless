# `getLlmConfig` 会挂住几分钟 —— pi 的 availability refresh 没封顶

**报告日期**：2026-09-17。**来源**：cowork 那边同一缺陷把启动判成 stalled 后，按 paired-development
规则查到 BL 这边也有。证据链与 pi 源码引用在
[`micromeet-cowork/docs/issues/boot-stall-renderer-config-pi-availability-refresh.md`](../../../micromeet-cowork/docs/issues/boot-stall-renderer-config-pi-availability-refresh.md)，
不在这里重抄。

**状态**：✅ 已修并验证。`main` / `renderer/maestro` 两个 surface 与 HEAD 基线逐行同量（65 / 4），
改动文件里零诊断。真机 `yarn dev` 验收待 Ral。

**范围**：`src/main/agent/runtime/piRuntimeAdapter.ts`、`src/main/maestro/llm/maestroLlm.service.ts`。

## 症状在 BL 这边长什么样

BL 没有 boot watchdog，所以它**不会**像 cowork 那样报 `renderer-config STUCK`；它表现为控制面板
的 LLM 配置久久不出来（cowork 实测那次 `getLlmConfig` 跑了 333,784ms）。没有看门狗只是让它**更
难被发现**，不是没有这个缺陷。

## 根因（一句话）

`pi.ModelRuntime.create({ authPath, modelsPath })` 默认跑一趟 availability refresh，对**每个
provider** 调 `models.checkAuth()`；那是网络调用、**不受 `allowModelNetwork` 管**，而这条路上既没
`signal` 也没超时。没登录时一个 provider 就能挂住整条 `getLlmConfig`。

## 改了什么

1. **`describeContextWindows` 传 `refreshOnCreate: false`** —— 它只读 `contextWindow` 这种**静态
   模型数据**，不需要 availability 快照。
2. **`withResolvedContextWindows` 在调用方封顶 3s**，超时退 `{}`。`try/catch` 只接得住抛出、接不住
   **挂住**；退 `{}` 与原有解析失败同口径（整批退 256K），不是新的失败模式。
3. **`buildLlmProviderStates` 由串行不封顶改为并行 + 每个 8s 封顶**（`PROVIDER_READY_TIMEOUT_MS`，
   与 cowork 同值）。这一条 cowork 早就有，BL 缺 —— 属于"同一功能的既有实现"，按 paired-development
   规则补齐。

## 边界：其余 `ModelRuntime.create()` **不许**跟着改

逐个看过，不是推断：

| 调用点 | 消费什么 | 能否跳 refresh |
| --- | --- | --- |
| `piRuntimeAdapter.ts:27`（`describeContextWindows`） | `find().contextWindow`（静态） | ✅ 已跳 |
| `piRuntimeAdapter.ts:27`（`checkTarget` / `createSession`） | `hasConfiguredAuth` | ❌ 保留 |
| `maestroLlm.service.ts:115`（`createPiModelRuntime`） | 登录/登出/就绪探测 | ❌ 保留 |
| `src/main/xpc/compaction.handler.ts:85` | `hasConfiguredAuth` + `getApiKeyAndHeaders` | ❌ 保留 |
| `main/codex/codexCredential.service.ts`、`codexRuntime.service.ts` | 凭据 | ❌ 保留 |

跳了会把**所有 provider 报成未登录**。所以这条修的是"哪一次 create 不需要 auth 快照"，
不是"把 refresh 全局关掉"。

## 验证

- `yarn typecheck`（surfaces）：与 HEAD 基线按 surface 比对，`main` 65、`renderer/maestro` 4，
  改前改后逐行相同；本次改动的文件里没有任何诊断。
- 不跑 Electron E2E（CLAUDE.md）。真机验收归 Ral：`yarn dev` 起来后控制面板的 LLM 配置秒出，
  未登录的 provider 只是标灰而不是拖住整块面板。
