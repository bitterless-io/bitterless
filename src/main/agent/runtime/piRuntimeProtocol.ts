import type { AgentRuntimeEvent, AgentRuntimeSessionOptions, AgentRuntimeUsage, AgentToolParamSpec } from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'
import { executeHostTool } from './hostToolExecution'
import { toolResultLooksFailed } from './toolResultFailure'

export type PiModule = typeof import('@earendil-works/pi-coding-agent')

/** Use the host-authorized skill sources; unrelated disk prompts/extensions remain disabled. */
export const createPiResourceLoader = (pi: PiModule, systemPrompt: string | (() => string), skills?: AgentRuntimeSessionOptions['skillResources'], extensions: import('@earendil-works/pi-coding-agent').Extension[] = []) => {
  let loadedRevision = skills?.revision?.()
  return ({
  getExtensions: () => ({ extensions, errors: [], runtime: pi.createExtensionRuntime() }),
  getSkills: () => {
    const snapshot = skills?.getSkills() ?? { skills: [], diagnostics: [] }
    loadedRevision = skills?.revision?.()
    return snapshot
  },
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => typeof systemPrompt === 'function' ? systemPrompt() : systemPrompt,
  getSystemPromptSource: () => undefined,
  /**
   * **A8 · 完整技能目录**(`overmind:areas/agent-runtime/chat/prompt-structure.html` 表 1)。
   *
   * 走 pi 的正式追加口:`_rebuildSystemPrompt()` 在 `agent-session.js:753` 读这个函数,
   * 把返回的每段追加到系统提示词。所以它**每会话一份、不随轮数累加**,并且
   * `session.reload()` 会连同技能一起重建它 —— 与 pi `/reload` 的语义一致。
   *
   * 为什么不靠 pi 自己那份:`_rebuildSystemPrompt()` 用 `formatSkillsForPrompt(getSkills())`
   * 渲染,那是**字段子集**,缺 `ref`/`layer`/`revision`/`domain`/`implicit`,模型据此做不了
   * `get_skill_contract` 与域判断;而且 `toPiSkills()` 按 `path && path !== 'builtin'` 过滤,
   * 内置文本流程根本进不去。宿主这份补齐这两处。
   *
   * 为什么不在每轮消息里:每轮该带的只有 D1–D4(表 3)。目录挂在每条用户消息上时,历史那几份
   * 从不回收 —— 2026-09-22 实测 BL 四句短话 228,312 tok,92% 是重复的目录,越过压缩线
   * (`chat/compaction/compaction.html` #8)。
   */
  getAppendSystemPrompt: () => {
    // 技能目录 + workflow 目录 —— 两份都是会话级清单,都靠 `revision()` 变化触发 reload 重建。
    // workflow 以前挂在每一条 user 消息上,那是技能目录搬家前的同一个毛病。
    return [skills?.catalogText?.(), skills?.workflowCatalogText?.()].filter((text): text is string => Boolean(text))
  },
  getAppendSystemPromptSources: () => [],
  extendResources: () => undefined,
  reload: async () => {
    // A host change may already have loaded its snapshot (Workbench refresh, scope or workspace).
    // An explicit Pi reload with an unchanged revision is the request to read external edits.
    if (skills?.revision && skills.revision() !== loadedRevision) skills.getSkills()
    else await skills?.reload()
    loadedRevision = skills?.revision?.()
  }
  })
}

/** Map host schema/results into pi protocol without owning tool execution policy. */
export const bindPiTools = (pi: PiModule, Type: TypeBoxFactory, options: AgentRuntimeSessionOptions) =>
  options.tools.map((spec) => pi.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: buildSchema(Type, spec.params),
    execute: async (_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      const { text, durationMs } = await executeHostTool(spec, params, (event) => {
        const { status, ...detail } = event
        options.onDebug?.({
          scope: options.scope,
          phase: status === 'success' ? 'pi-tool-result' : 'pi-tool-error',
          level: status === 'success' ? 'info' : 'error',
          message: status === 'success' ? `tool ${spec.name} returned.` : `tool ${spec.name} failed.`,
          detail,
          ts: Date.now()
        })
      }, signal)
      return { content: [{ type: 'text', text }], details: { durationMs } }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any))

// TypeBox is loaded dynamically; we only need the factory methods we use, so model
// the surface loosely rather than depend on typebox's compile-time types here.
export interface TypeBoxFactory {
  Object: (props: Record<string, unknown>) => unknown
  String: () => unknown
  Number: () => unknown
  Boolean: () => unknown
  Optional: (schema: unknown) => unknown
}

interface PiMessage {
  role?: string
  stopReason?: string
  content?: string | Array<{ type?: string; text?: string }>
  errorMessage?: string
  // pi SDK 的 `Usage`(input/output/cacheRead/cacheWrite/totalTokens/cost)。这里保持 unknown 由
  // normalizePiUsage 逐字段收窄 —— 本文件对 pi 的类型一贯是手写最小结构,不直接吃 SDK 类型。
  usage?: unknown
}

export interface PiSessionEvent {
  type?: string
  message?: PiMessage
  toolName?: string
  isError?: boolean
  args?: unknown
  assistantMessageEvent?: {
    type?: string
    delta?: string
    reason?: string
    message?: PiMessage
    error?: PiMessage
  }
}

/**
 * pi 的 `AssistantMessage.usage` 是**非可选**字段(`@earendil-works/pi-ai` `dist/types.d.ts` `Usage`),
 * 一直都在送,只是以前归一化时被丢掉了。钻探的 token 预算就靠它 —— 别再丢。
 * 防御性写法是因为 SDK 大版本升级时字段可能挪位置,少一个字段不该让整个回合炸掉。
 */
const normalizePiUsage = (usage: unknown): AgentRuntimeUsage | undefined => {
  const u = usage as Record<string, unknown> | undefined
  if (!u || typeof u !== 'object') return undefined
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const cost = u.cost as Record<string, unknown> | undefined
  const input = num(u.input)
  const output = num(u.output)
  const cacheRead = num(u.cacheRead)
  const cacheWrite = num(u.cacheWrite)
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    // totalTokens 优先用 SDK 给的;缺了就自己加起来,免得预算白算。
    totalTokens: num(u.totalTokens) || input + output + cacheRead + cacheWrite,
    costUsd: num(cost?.total)
  }
}

export const normalizePiEvent = (event: PiSessionEvent): AgentRuntimeEvent[] => {
  const type = event?.type
  // 压缩事件透出来 —— 不接就等于看不见 pi 在替我们做上下文管理(见 AgentRuntimeEvent 上的说明)。
  if (type === 'compaction_start') {
    return [{ type: 'compaction_start', reason: (event as { reason?: string }).reason }]
  }
  if (type === 'summarization_retry_scheduled') {
    const e = event as unknown as { attempt: number; maxAttempts: number; delayMs: number; errorMessage?: string }
    return [{ type: 'compaction_retry', attempt: e.attempt, maxAttempts: e.maxAttempts, delayMs: e.delayMs, error: sanitizeRuntimeError(e.errorMessage, 'provider') }]
  }
  if (type === 'summarization_retry_attempt_start') return [{ type: 'compaction_attempt' }]
  if (type === 'summarization_retry_finished') return [{ type: 'compaction_retry_finished' }]
  if (type === 'compaction_end') {
    const e = event as { reason?: string; aborted?: boolean; errorMessage?: string; result?: { tokensBefore?: number; estimatedTokensAfter?: number } }
    return [{ type: 'compaction_end', reason: e.reason, ok: Boolean(e.result) && !e.aborted && !e.errorMessage, beforeTokens: e.result?.tokensBefore, afterTokens: e.result?.estimatedTokensAfter, aborted: e.aborted, errorMessage: sanitizeRuntimeError(e.errorMessage, 'provider') }]
  }
  if (type === 'message_update') return normalizeAssistantMessageEvent(event.assistantMessageEvent)
  if (type === 'message_end' && event.message?.role === 'assistant') {
    // pi 每轮工具循环都结束一条 assistant message,所以这条路径每轮都会走 —— 用量逐轮发出。
    const usage = normalizePiUsage(event.message.usage)
    const events: AgentRuntimeEvent[] = usage ? [{ type: 'usage', usage }] : []
    events.push({
      type: 'assistant_message_end',
      text: extractMessageText(event.message),
      stopReason: event.message.stopReason,
      errorMessage: sanitizeRuntimeError(event.message.errorMessage, 'provider')
    })
    return events
  }
  if (type === 'tool_execution_start') return [{ type: 'tool_start', toolName: event.toolName, args: event.args }]
  if (type === 'tool_execution_end') {
    // **`ERROR:` 前缀 = 失败**,即便 pi 认为这次调用成功了。判据与理由都在
    // `toolResultFailure.ts` —— 2026-09-08 它在 ai-crms adapter 上原样复发了一次,
    // 所以现在只有一份、并由 check-agent-runtime 钉住"每个 adapter 都用它"。
    // 判据放在这一层而不是 BaseAgent:这里是"pi 事件 → 我们的事件"的翻译层,`result` 只在这里拿得到。
    // 本地类型里 `PiSessionEvent` 没声明 `result`(我们只窄化了用到的字段),这里就地取一次。
    const carried = (event as { result?: unknown }).result
    return [
      {
        type: 'tool_end',
        toolName: event.toolName,
        args: event.args,
        isError: Boolean(event.isError) || toolResultLooksFailed(carried)
      }
    ]
  }
  return []
}

const normalizeAssistantMessageEvent = (inner?: PiSessionEvent['assistantMessageEvent']): AgentRuntimeEvent[] => {
  if (!inner) return []
  if (inner.type === 'text_delta' && typeof inner.delta === 'string') return [{ type: 'text_delta', delta: inner.delta }]
  if (inner.type === 'thinking_start') return [{ type: 'thinking_start' }]
  if (inner.type === 'thinking_delta' && typeof inner.delta === 'string') return [{ type: 'thinking_delta', delta: inner.delta }]
  if (inner.type === 'thinking_end') return [{ type: 'thinking_end' }]
  if (inner.type === 'done' || inner.type === 'error') {
    const msg = inner.message || inner.error
    return [
      {
        type: 'assistant_done',
        text: extractMessageText(msg),
        stopReason: typeof inner.reason === 'string' ? inner.reason : undefined,
        errorMessage: sanitizeRuntimeError(msg?.errorMessage, 'provider')
      }
    ]
  }
  return []
}

// Join the text parts of a final assistant message (ignoring thinking + tool calls).
const extractMessageText = (message?: PiMessage): string => {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

const buildSchema = (Type: TypeBoxFactory, params: AgentToolParamSpec[]): unknown => {
  const props: Record<string, unknown> = {}
  for (const p of params) {
    const base = p.type === 'number' ? Type.Number() : p.type === 'boolean' ? Type.Boolean() : Type.String()
    props[p.name] = p.required ? base : Type.Optional(base)
  }
  return Type.Object(props)
}
