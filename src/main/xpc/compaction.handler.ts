import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { maestroAuthPath, maestroModelsPath } from '@maestro-main/llm/llmPaths'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '@maestro-main/llm/llmModels'
import { usageLedger } from '@main/agent/runtime/usageLedger'
import {
  isBitterlessProvider,
  registerBitterlessProvider
} from '@main/agent/runtime/bitterlessProvider'
import { compactionBoundary, toCompactionUsage, toPiUsage } from '@main/agent/compaction/compactionEntries'
import { computeCutPoint } from '@main/agent/compaction/compactionRun'
import type { AgentRuntimeContextSurface } from '@main/agent/runtime/agentRuntime.types'
import type {
  CompactionCutPoint,
  CompactionCutPointRequest,
  CompactionReply,
  CompactionRequest,
  CompactionTriggerReply,
  CompactionTriggerRequest,
  CompactionUsage,
  MaestroCompactionApi
} from '@maestro-shared/maestroChat.api'
import type { Api, Model, ProviderHeaders } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

/** Legacy mutating compaction is retired; read-only usage/cut inspection remains. */

// pi 是 ESM-only、main 打成 CJS,所以只能动态 `import()`(CJS 运行期可以 import 一个 ESM)。
// 类型走 `import type`(编译期擦除),不会退化成运行期 `require`。见 piRuntimeAdapter 顶部。
type PiModule = typeof import('@earendil-works/pi-coding-agent')

const mainCtl = (): typeof maestroWindowHelper => maestroWindowHelper

/** 解析出来的模型 + 请求凭据。`ok:false` 时 `error` 是给人看的一句话。 */
type ResolvedTarget =
  | { ok: true; pi: PiModule; model: Model<Api>; apiKey?: string; headers?: ProviderHeaders }
  | { ok: false; error: string }

class CompactionHandler extends XpcMainHandler implements MaestroCompactionApi {
  /**
   * 当前活跃后端的 pi 模型与请求凭据。
   *
   * 凭据的取法**照抄 pi 自己的 compaction 路径**(`modelRegistry.getApiKeyAndHeaders(model)`)——
   * pi 内部的 streamFn 也只是拿这一对再交给 `streamSimple`,所以 OAuth(codex / anthropic)与
   * API-key 两类都走同一个出口。
   *
   * pi 0.85.1:凭据编排归 `ModelRuntime`,`AuthStorage` / `ModelRegistry.create()` 都没了 ——
   * 本仓的 `maestroLlm.service` 早就是 `ModelRuntime` 形态(那也是四条裁决里唯一以 bitterless
   * 为准的一条),所以这里直接用它的路径函数。
   */
  private async resolveTarget(): Promise<ResolvedTarget> {
    try {
      const pi: PiModule = await import('@earendil-works/pi-coding-agent')
      const target = mainCtl().getLlmRuntimeTarget()
      const modelRuntime = await pi.ModelRuntime.create({ authPath: maestroAuthPath(), modelsPath: maestroModelsPath() })
      // pi 没有内置的 `bitterless`,它只存在于注册过它的 runtime 上 —— 这里是自建的 runtime,先注册再找模型。
      if (isBitterlessProvider(target.provider)) {
        await registerBitterlessProvider(
          modelRuntime as unknown as Parameters<typeof registerBitterlessProvider>[0]
        )
      }
      const modelRegistry = new pi.ModelRegistry(modelRuntime)
      const model = modelRegistry.find(target.provider, target.model)
      if (!model) return { ok: false, error: `model not found: ${target.provider}/${target.model}` }
      if (!modelRegistry.hasConfiguredAuth(model)) {
        return { ok: false, error: `not signed in to ${target.provider} — cannot generate a summary` }
      }
      const auth = await modelRegistry.getApiKeyAndHeaders(model)
      if (auth.ok === false) return { ok: false, error: auth.error }
      return { ok: true, pi, model, apiKey: auth.apiKey, headers: auth.headers }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 这个会话在 main 侧的 pi 条目树 —— **压缩的候选批**。
   *
   * 走的是**已存在**的那个 agent(`getExistingMaestroAgent` + `existingContextSurface`):
   * 没有 pi 会话 ⇒ 模型侧没有上下文 ⇒ 压缩无事可做,而**不是**开一个会话来凑一个候选批。
   *
   * 这里是 pi 类型的收窄点:`AgentRuntimeContextSurface.entries()` 对 provider-neutral 那一层
   * 是不透明的 `unknown[]`,到了这里才断言成 `SessionEntry[]` —— 本文件本来就只跟 pi 打交道。
   */
  private async contextSurface(sessionId: string | undefined): Promise<AgentRuntimeContextSurface | null> {
    try {
      const agent = mainCtl().agentService.getExistingMaestroAgent(sessionId)
      return (await agent?.existingContextSurface()) ?? null
    } catch {
      return null
    }
  }

  private static entriesOf(surface: AgentRuntimeContextSurface | null): SessionEntry[] {
    return (surface?.entries() ?? []) as SessionEntry[]
  }

  /**
   * 真 usage 的一次读取。
   *
   * 数据源是 `agent/runtime/usageLedger.ts` —— `AgentRuntimeEvent{type:'usage'}` 逐轮累加,
   * 由 `maestroAgent.service` 的 `onUsage: (_delta, total) => usageLedger.set(key, total)` 写入。
   * key 就是聊天会话 key(`agentSessionKey(sessionId)`,缺省 `'default'`),所以 renderer 传来的
   * `sessionId` 直接对得上。
   *
   * ⚠ 账本的值是**本回合累计**,不是会话历史总和。这恰好就是触发判定要的东西
   * (「上一轮模型实际吃进去多少」),但别当成会话总花销。
   */
  private usageSnapshot(sessionId: string | undefined, pi: PiModule | null, contextWindow: number): CompactionUsage {
    // 读不到账本(窗口还没起来 / 会话 key 取不到)时报一份全零 —— `ledgerHit:false`,调用方
    // 退回本地估算。**不让它抛**:这是失败路径上也要填的一个字段,为它把整个 xpc 调用打成 reject
    // 会让"摘要失败"变成"通信失败",两者的处置完全不同。
    const ledger = (() => {
      try {
        return usageLedger.get(mainCtl().agentService.agentSessionKey(sessionId))
      } catch {
        return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
      }
    })()
    const contextTokens = pi ? pi.calculateContextTokens(toPiUsage(ledger)) : ledger.totalTokens || 0
    return toCompactionUsage(ledger, contextTokens, contextWindow)
  }

  /**
   * 该压了吗 —— 真 usage 口径(含 `cacheRead` / `cacheWrite`)。
   *
   * 判据整条交给 pi 的 `shouldCompact`(`used > window - reserve`,**严格大于**,等于触发线不压),
   * 不在这里复刻那行公式。窗口取 pi 的 `Model.contextWindow`,不是写死的常量。
   *
   * 账本里没有这个会话(还没跑过一轮)或解析不到模型时报 `no-usage` —— 调用方退回本地估算。
   * **不返回一个零用量的「不用压」**:那和「上下文是空的」不可分,而两者的后果相反。
   */
  async shouldCompact(params: CompactionTriggerRequest): Promise<CompactionTriggerReply> {
    const resolved = await this.resolveTarget()
    const pi = resolved.ok ? resolved.pi : null
    const contextWindow = resolved.ok ? resolved.model.contextWindow || 0 : 0
    const usage = this.usageSnapshot(params?.sessionId, pi, contextWindow)
    if (params?.force) return { shouldCompact: true, usage, reason: 'forced' }
    if (!pi || !usage.ledgerHit || !contextWindow) return { shouldCompact: false, usage, reason: 'no-usage' }
    const hit = pi.shouldCompact(usage.contextTokens, contextWindow, {
      enabled: true,
      reserveTokens: Math.max(0, Math.floor(params.reserveTokens || 0)),
      keepRecentTokens: Math.max(1, Math.floor(params.keepRecentTokens || 0))
    })
    return { shouldCompact: hit, usage, reason: hit ? 'usage' : 'under-threshold' }
  }

  /**
   * 压一次:切点 → 选段 → 摘要(主 + split turn 前缀)→ 合并 → 路径清洗。
   *
   * 编排本体在 `agent/compaction/compactionRun.ts`(pi 的函数注入进去),这里只做装配 ——
   * 那样四条验收(`previousSummary` 被传入 / 整替而非追加 / 产出不含路径 / split turn 两份都产生
   * 并合并)不必启动 Electron、不必调模型就能验。
   */
  async compact(params: CompactionRequest): Promise<CompactionReply> {
    // Kept as an explicit failure for old clients; native /compact owns live writes.
    return {
      ok: false, summary: '', applied: false, ts: Date.now(), error: 'Use /compact to invoke native Pi compaction.',
      cutPoint: { firstKeptIndex: 0, turnStartIndex: -1, isSplitTurn: false },
      usage: this.usageSnapshot(params?.sessionId, null, 0), mergedTurnPrefix: false, redactedPaths: 0, entryCount: 0
    }
  }

  /**
   * 只算切点,不调模型、不落 entry。
   *
   * 返回值**已经过三层处置的前两层**:`findCutPoint` 的返回值先过校验,不过关就退回 item 粒度
   * 硬切并修 `tool_call`/`tool_result` 配对。第 3 层(被切走的前缀单独摘一份)要调模型,
   * 只在 `compact()` 上成立 —— 这里把 `isSplitTurn` / `turnStartIndex` 标对就够了。
   */
  async cutPoint(params: CompactionCutPointRequest): Promise<CompactionCutPoint> {
    // 刻意**不走 `resolveTarget`**:切点是个纯下标计算(pi 那三个函数只读 role 与 content),
    // 没登录、没配好模型都不该让它失败 —— 那会把"该在哪切"和"能不能摘要"绑成一件事。
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const entries = CompactionHandler.entriesOf(await this.contextSurface(params?.sessionId))
    return computeCutPoint(entries, params?.keepRecentTokens || 0, compactionBoundary(entries).startIndex, {
      findCutPoint: pi.findCutPoint,
      findTurnStartIndex: pi.findTurnStartIndex,
      estimateTokens: pi.estimateTokens
    })
  }
}

export const compactionHandler = new CompactionHandler()
