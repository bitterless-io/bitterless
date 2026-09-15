import type { AgentRuntimeEvent, AgentRuntimeSessionOptions, AgentRuntimeUsage, AgentToolParamSpec } from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'
import { executeHostTool } from './hostToolExecution'
import { toolResultLooksFailed } from './toolResultFailure'

export type PiModule = typeof import('@earendil-works/pi-coding-agent')

/** Supply only host instructions. Disk prompts, agent files, skills and extensions remain off. */
export const createPiResourceLoader = (pi: PiModule, systemPrompt: string | (() => string)) => ({
  getExtensions: () => ({ extensions: [], errors: [], runtime: pi.createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => typeof systemPrompt === 'function' ? systemPrompt() : systemPrompt,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => undefined,
  reload: async () => undefined
})

/** Map host schema/results into pi protocol without owning tool execution policy. */
export const bindPiTools = (pi: PiModule, Type: TypeBoxFactory, options: AgentRuntimeSessionOptions) =>
  options.tools.map((spec) => pi.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: buildSchema(Type, spec.params),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
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
      })
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
  if (type === 'compaction_end') {
    const e = event as { reason?: string; result?: { ok?: boolean; tokensBefore?: number; tokensAfter?: number } }
    return [{ type: 'compaction_end', reason: e.reason, ok: e.result?.ok, beforeTokens: e.result?.tokensBefore, afterTokens: e.result?.tokensAfter }]
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
