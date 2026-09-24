import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'
import { timerHelper } from '@shared/timerHelper/timer.helper'

/**
 * 通用的内置 `wait {ms}`:本轮之内停一下，再继续(docs/features/builtin-wait-tool.md)。
 *
 * **为什么是常驻的内置工具**:页面还在加载、下载还在进行、服务端在生成文件 —— 「过一会儿再看」
 * 不只是 UI 操作的事(Ral 2026-09-24:「我们需要单独的 wait 内置技能，这样任何场景都能用了」)。
 * 所以它和 `reload_skills` 一样每一轮都在手边;不属于 `ui_act`,不绑 tab、不绑下载、不取浏览器锁。
 *
 * **和 `workflow_wait` 不是一回事**:那个登记后立刻返回、本轮结束,workflow 跑完时在同一个对话里恢复;
 * 这个是本轮之内停一下再继续。两边的工具说明各写一句对方是干什么的，免得模型混用。
 *
 * **两仓逐字节相同**(同 `reloadSkillsTool.ts`):只 import 两仓都有的模块。
 */

/** 单次最多等多久。超过就只等这么久，并告诉模型「太久了」。 */
export const WAIT_MAX_MS = 60_000

/** `ms` 缺失或不是有限数字时的返回。只有输入本身不对才用 `ERROR:`。 */
export const WAIT_INPUT_ERROR = `ERROR: wait needs "ms": a number of milliseconds (0–${WAIT_MAX_MS}).`

export interface WaitPlan {
  /** 模型要的毫秒数(负数已当 0)。 */
  requestedMs: number
  /** 实际要等的:不超过 `WAIT_MAX_MS`。 */
  waitMs: number
}

/**
 * 上限判定。纯函数 —— 单测直接测它，不用真等 60 秒。`null` = 输入不对。
 *
 * 用 `null` 而不是 `{ ok: false }` 联合:BL 的 tsconfig 不开 strict,按布尔字段收窄在那边不生效;
 * `null` 在两仓(一个 strict、一个不是)都能编译。
 */
export const planWait = (ms: unknown): WaitPlan | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const requestedMs = Math.max(0, ms)
  return { requestedMs, waitMs: Math.min(requestedMs, WAIT_MAX_MS) }
}

/**
 * 等完之后给模型的那一段 JSON。纯函数。
 *
 * - 被中止优先:那次等待没有做完,`waitedMs` 是实际等了多久。
 * - 超过上限**不是**故障，是给模型的反馈 —— 所以是 JSON、不加 `ERROR:`,由它重新观察、重新决策。
 */
export const waitResult = (plan: WaitPlan, outcome: { aborted: boolean; elapsedMs: number }): string => {
  if (outcome.aborted) return JSON.stringify({ ok: false, aborted: true, waitedMs: outcome.elapsedMs })
  if (plan.requestedMs > plan.waitMs) {
    return JSON.stringify({
      ok: false,
      timedOut: true,
      waitedMs: plan.waitMs,
      error: `asked for ${plan.requestedMs}ms, capped at ${plan.waitMs}ms — observe again and decide`
    })
  }
  return JSON.stringify({ ok: true, waitedMs: plan.waitMs })
}

/**
 * 两端 `execute` 的第二参数形状不同:BL 传 `AbortSignal` 本身,CoWork 传 `{ signal, confirm }`
 * (`reloadSkillsTool.ts` 因此干脆不取 signal)。`wait` 必须能被中止，所以两种形状都认 ——
 * 这个文件才能两端字节一致。
 */
const abortSignalOf = (signalOrContext: unknown): AbortSignal | undefined => {
  if (signalOrContext instanceof AbortSignal) return signalOrContext
  const nested = (signalOrContext as { signal?: unknown } | undefined)?.signal
  return nested instanceof AbortSignal ? nested : undefined
}

export const buildWaitTool = (): AgentToolSpec => ({
  name: 'wait',
  description:
    'Pause inside this turn for `ms` milliseconds, then continue. Use it when something needs time before you look again: a page still loading, a download still in progress, a server still generating a file — any "check again in a moment" situation. Waiting tells you nothing by itself: call wait on its own, and once it returns observe again (page_snapshot, download_history, or whichever read tool shows what you waited for) before you conclude anything. At most 60000 ms per call; asking for more waits 60000 ms and returns timedOut, which means it is taking too long — change approach or tell the user instead of waiting again and again. To wait for a workflow run to finish, use workflow_wait (it ends this turn and the conversation resumes when the run settles) — do not poll with wait.',
  params: [{ name: 'ms', type: 'number', required: true, description: 'Milliseconds to wait, 0–60000. Negative counts as 0.' }],
  // 上限 60 秒再加余量 —— 不能被宿主的通用超时截在半路。
  timeoutMs: WAIT_MAX_MS + 5_000,
  // 说等多久就是多久:宿主照常附下载 NOTE,只是不再为在途下载多等最多 15 秒。
  downloadSettleMs: 0,
  // pi 默认并行执行同一条消息里的工具调用:`[wait, page_snapshot]` 会在等待开始时就拍快照。
  // 批里只要有一个 sequential,pi 就把整批按顺序执行 —— 观察才真的排在等待之后。
  executionMode: 'sequential',
  execute: async (args, signalOrContext) => {
    const plan = planWait(args.ms)
    if (!plan) return WAIT_INPUT_ERROR
    const signal = abortSignalOf(signalOrContext)
    const startedAt = Date.now()
    // 到时或被中止都 resolve、不抛错;是哪一种看 `signal.aborted`。
    await timerHelper.delay(plan.waitMs, signal)
    return waitResult(plan, { aborted: signal?.aborted === true, elapsedMs: Date.now() - startedAt })
  }
})
