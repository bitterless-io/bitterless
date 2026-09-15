/**
 * 运行时端口里**已被 SDK 内部消费**的那两个类型 —— 先迁这两个,不是整个端口。
 *
 * `agentRuntime.types.ts` 有 22 个引用方,整体搬迁属于批次 4;这里只把 SDK 已经用到的部分
 * 拿过来,宿主那份 re-export 它们,所以那 22 个引用方一行不用改。批次 4 搬完剩下的之后,
 * 宿主侧的 re-export 一并删掉。
 *
 * 从 `micromeet-cowork:src/main/agent/runtime/agentRuntime.types.ts` 原样迁入(2026-09-08)。
 */
/**
 * 一次模型往返的用量。**每轮工具循环结束一条 assistant message = 一条 usage**,所以一个回合会有 N 条,
 * 要累加而不是取最后一条。钻探的 token 预算(exploreSession `SESSION_BUDGET_TOKENS`)就靠这个累计值。
 *
 * 形状取自 pi SDK 的 `Usage`(`@earendil-works/pi-ai` `dist/types.d.ts`),只把 `cost` 压平成
 * 总额一项 —— 预算按 token 判,金额只用来显示。`cacheRead`/`cacheWrite` 单列是因为命中缓存的
 * input 便宜得多,以后若改成按钱设预算要用得上。
 */
export interface AgentRuntimeUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costUsd: number
}

/**
 * 这个会话的**上下文条目面** —— 上下文压缩的候选批与落点
 * (docs/features/cowork-context-compaction.md「候选批的来源」,2026-08-28 定案)。
 *
 * 为什么必须有:压缩要在**运行时自己的条目树**上做,而不是在 renderer 的 chat 消息上 ——
 * renderer 的消息里**永远没有工具返回正文**(工具活动只挂 label),而 `findCutPoint` 的
 * 静默失效条件恰恰是关于工具返回体积的。没有这个面,压缩就只能在一份有损投影上做。
 *
 * **可选**:只有把会话历史存成条目树的运行时才实现它(pi 是 `SessionManager`)。
 * 不实现 = 那条运行时上没有可压的上下文,压缩如实报失败而不是假装压了。
 */
/**
 * 一条上下文条目。**不透明** —— 具体形状归适配器(pi 侧是 `SessionEntry`)。
 *
 * 刻意不在这个 provider-neutral 的文件里 import pi 的类型:本文件对具体运行时一贯零依赖
 * (`piRuntimeAdapter` 里的 `PiSession` 就是手写的最小结构)。收窄发生在 pi 边界那一侧 ——
 * `main/xpc/compaction.handler.ts`,它本来就只跟 pi 打交道。
 */
export type AgentRuntimeContextEntry = unknown

export interface AgentRuntimeContextSurface {
  /** 原始会话历史条目，供压缩候选和结构统计使用。 */
  entries(): AgentRuntimeContextEntry[]
  /** 当前分支在压缩后的有效上下文；不支持时明确抛错，不能退回全部历史。 */
  contextEntries(): AgentRuntimeContextEntry[]
  /**
   * 追加一条**进上下文**的自定义消息条目(pi `appendCustomMessageEntry`)。
   * ② 用户原话链与 ④ 清单就走这条。返回条目 id;不支持时返回 null。
   */
  appendCustomMessage(customType: string, content: string): string | null
  /**
   * 追加一条压缩条目(pi `appendCompaction`)—— ③ 摘要的载体,同时**定下保留起点**。
   *
   * `firstKeptEntryId` 匹配不到任何条目时保留区为空(pi `session-manager.js:190-200` 的
   * `foundFirstKept` 永不置真)—— 那正是「⑤ 尾部清空」这个**合法结果**的表达方式。
   */
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string | null
}

/**
 * agent 运行时的调试事件。
 *
 * `AgentDebugEvent` 是正名;`CodexDebugEvent` 是历史遗名的别名 —— 宿主两边都有 13+ 处引用,
 * 改名属于另一次独立改动,这里先并存,不在搬迁里夹带重命名。
 * 从 `micromeet-cowork:src/shared/cowork.api.ts:1420` 原样迁入(2026-09-08)。
 * bitterless 的 `coach.api.ts` 里那份与它逐字相同,接入时直接复用。
 */
export interface AgentDebugEvent {
  scope: 'summarize' | 'agent' | 'codex'
  phase: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: unknown
  ts: number
}

/** @deprecated 用 `AgentDebugEvent`。保留只为宿主既有引用不必一次性全改。 */
export type CodexDebugEvent = AgentDebugEvent

/**
 * agent 回合向宿主吐出的观测量 —— 活动行、思考态、努力档。
 *
 * 从 `micromeet-cowork:src/shared/cowork.api.ts` 原样迁入(2026-09-08 批次 5)。
 * ⚠ 两个宿主的 `AgentActivityStep` 已经分叉:cowork 这份带 `status` / `detailId` / `key`,
 * bitterless 那份带 `turnId` / `generation`。按 Ral 的裁决**以 cowork 为准**,bitterless 接入时
 * 它自己的两个字段需要单独安排(它的 renderer 在消费它们)。
 */
export type LlmEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentThinkingState {
  sessionId: string
  active: boolean
  ts: number
}

// A single live step the invocation agent took during a turn, broadcast on
// 'cowork/agent-activity' so the chat can show the observe→act loop in real time.
export interface AgentActivityStep {
  /**
   * 产出这一行的会话。**并发回合的归属判据**(cowork-multi-session.md #1)——
   * 没有它,渲染层只能挂到"当前活跃会话",于是并发时 A 的工具行会画进 B 的时间线。
   * 旧 main 不带这个字段,所以渲染层缺省回退到当前会话(向后兼容)。
   */
  sessionId?: string
  phase: 'think' | 'tool' | 'skill' | 'observe' | 'act' | 'api-read' | 'api-call' | 'api' | 'tab'
  label: string
  ok: boolean
  ts: number
  /**
   * HTTP status for api-read / api-call steps. 0 = never got a response (DNS/TLS/abort).
   * `ok` alone cannot distinguish a 400 from a transport failure, and after the Node-execution
   * migration it also folds in the envelope rule (a 200 carrying {code:'needLogin'} is ok:false).
   */
  status?: number
  /** Id into main's bounded API exchange log — the handle that makes the chip clickable. */
  detailId?: string
  /**
   * Progress identity. A step carrying a `key` **replaces** the previous step with the same key
   * instead of appending a new row (`turn.service.pushActivity`).
   *
   * This exists for the multi-minute calls: a scanned document goes to the vision model for
   * 1-4 minutes, and one static row for that whole stretch is indistinguishable from a hang
   * (Ral 2026-09-01: 「一直开在 … 实在太慢了」). Re-broadcasting elapsed/received progress every few
   * seconds is the fix, but without a key each tick would push its own row — and the strip only
   * shows the last 3, so the ticks would bury every real step behind them.
   */
  key?: string
}
