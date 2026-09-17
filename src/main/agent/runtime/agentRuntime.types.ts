import type { CodexDebugEvent } from './runtime.types'

export type { AgentRuntimeContextEntry, AgentRuntimeContextSurface, AgentRuntimeUsage } from './runtime.types'
import type { AgentRuntimeContextSurface, AgentRuntimeUsage } from './runtime.types'

// Mirrors pi-ai's `ModelThinkingLevel` (pi 0.85.1). `max` sits above `xhigh` and only the
// models whose catalog entry declares it accept it — the preset's effort list is what gates it.
export type AgentRuntimeThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentToolParamSpec {
  name: string
  type?: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export interface AgentToolExecutionContext {
  confirm?: (resolvedArgs: Record<string, unknown>) => Promise<boolean>
}

export interface AgentToolSpec {
  name: string
  description: string
  params: AgentToolParamSpec[]
  /** Runs the underlying coach tool; returns an observation string for the agent. */
  execute: (args: Record<string, unknown>, signal?: AbortSignal, context?: AgentToolExecutionContext) => Promise<string>
  /**
   * Per-tool wall clock, overriding the default 120 s. For tools whose honest runtime is minutes,
   * not seconds — API ingest is `ceil(endpoints/4)` sequential LLM calls, so any site with more than
   * a handful of endpoints blows the default and the agent is told it failed while it keeps running.
   */
  /** Resolve concrete mutation details before requesting the existing host policy confirmation. */
  deferConfirmation?: boolean
  timeoutMs?: number
  /** Replaces the default timeout advice ("reading a very large file…") when that would mislead. */
  timeoutHint?: string
}

export interface AgentRuntimeTarget {
  providerId: string
  modelId: string
  thinkingLevel: AgentRuntimeThinkingLevel
}

export type AgentRuntimeMediaKind = 'image' | 'file'

export interface AgentRuntimeMediaRef {
  kind: AgentRuntimeMediaKind
  /** Preferred for local runtimes: pass a filesystem path and let the adapter decide transport. */
  path?: string
  /** Preferred for remote runtimes when a signed/downloadable URL exists. */
  url?: string
  mimeType?: string
  name?: string
  size?: number
}

export interface AgentRuntimeImage extends AgentRuntimeMediaRef {
  kind: 'image'
  mimeType: string
}

export interface AgentRuntimePrompt {
  messageId?: string
  turnId?: string
  text: string
  media?: AgentRuntimeMediaRef[]
  images?: AgentRuntimeImage[]
}

export interface AgentRuntimeSessionOptions {
  autoCompaction?: boolean
  compactPrompt?: () => string | undefined
  sessionFile?: string
  skillResources?: { revision?(): string; getSkills(): import('@earendil-works/pi-coding-agent').LoadSkillsResult; reload(): void | Promise<void> }
  beforeModelRequest?: () => Promise<string | undefined> | undefined
  target: AgentRuntimeTarget
  authPath: string
  modelsPath?: string
  tools: AgentToolSpec[]
  scope: CodexDebugEvent['scope']
  onDebug?: (event: CodexDebugEvent) => void
  /** pi agent dir (auth/sessions/bin). Cowork passes `<userData>/.pi` so the app is self-contained
   * and the managed ripgrep lands in a path we control; unset falls back to pi's ~/.pi/agent. */
  agentDir?: string
  /**
   * Working dir for pi's builtin file tools (read/write/grep/find/ls), the literal `spawn` cwd for
   * bash, and the value pi prints as the prompt's trailing `Current working directory:` line.
   *
   * REQUIRED — the runtime must never fall back to `process.cwd()`, which made the shipped value
   * depend on how the app was launched. Chat sessions pass the bound project root (else the shared
   * default workspace); tool-free workers pass the agent dir.
   * See docs/features/agent-cwd-follows-workspace.md.
   */
  cwd: string
  /** Enable pi's own builtin tools alongside the host tools. Names are allow-listed together with
   * every host tool name, because pi's allowlist filters builtin AND custom tools. */
  builtinTools?: string[]
  /** Complete host-authored instructions; required, nonblank, and preserved exactly by runtimes. */
  systemPrompt: string
}


export type AgentRuntimeEvent =
  | { type: 'steering_consumed'; messageId: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'assistant_done'; text?: string; stopReason?: string; errorMessage?: string }
  | { type: 'assistant_message_end'; text?: string; stopReason?: string; errorMessage?: string }
  // **独立事件,不挂在 assistant_message_end 上** —— 一条自己跑工具循环的 runtime 可能整轮只发
  // 一次 assistant_message_end(2026-09 退役的 AI-CRMS 运行时就是这样),挂上去就等于回合结束才
  // 报一次用量,钻探的 token 预算永远来不及触发。每次模型往返各发一条。
  | { type: 'usage'; usage: AgentRuntimeUsage }
  | { type: 'tool_start'; toolName?: string; args?: unknown }
  | { type: 'tool_end'; toolName?: string; args?: unknown; isError?: boolean }
  /**
   * 运行时自己做的【上下文压缩】。pi 会话内置 auto-compaction(`_runAutoCompaction`,每条
   * assistant 消息后检查一次:溢出 或 超阈值就压)—— 但我们原来**一个都没接**,日志里 0 条,
   * 于是"这一轮到底压没压、压了几次、压完剩多少"完全不可观测(Ral 2026-08-13 要日志)。
   * 钻探是单个能跑十几分钟、上百轮的回合,压缩是不是在正常工作直接决定它能不能跑完。
   */
  | { type: 'compaction_start'; reason?: string }
  | { type: 'compaction_retry'; attempt: number; maxAttempts: number; delayMs: number; error: string }
  | { type: 'compaction_attempt'; attempt?: number; maxAttempts?: number }
  | { type: 'compaction_retry_finished' }
  | { type: 'compaction_end'; reason?: string; ok?: boolean; beforeTokens?: number; afterTokens?: number; aborted?: boolean; errorMessage?: string }



export interface AgentRuntimeSession {
  compact?: (instructions?: string) => Promise<{ summary: string; tokensBefore: number; estimatedTokensAfter?: number }>
  /** Apply host-authored instructions between turns without resetting conversation context. */
  setSystemPrompt?: (systemPrompt: string) => void | Promise<void>
  subscribe: (listener: (event: AgentRuntimeEvent) => void) => undefined | (() => void)
  prompt: (message: AgentRuntimePrompt) => Promise<unknown>
  abort: () => Promise<void>
  /** Queue only; never start a concurrent ordinary prompt. */
  enqueueSteering?: (message: AgentRuntimePrompt) => Promise<void | boolean>
  /** Take only unconsumed messages after the native run settles or is stopped. */
  takePendingSteering?: () => AgentRuntimePrompt[]
  /** 上下文条目面。见 `AgentRuntimeContextSurface`。 */
  readonly context?: AgentRuntimeContextSurface
  /** Runtime activity snapshot, not a host Turn admission gate. */
  readonly isStreaming?: boolean
}

export interface AgentRuntimeAdapter {
  checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean>
  createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession>
}

export interface AgentTurnReply {
  ok: boolean
  text: string
  /** Number of tool executions the agent ran this turn (0 = it did nothing). */
  toolCalls?: number
  /** Final stop reason from the model (stop | length | toolUse | error | aborted). */
  stopReason?: string
  /** Provider error detail (e.g. a 403 body) when the turn errored. */
  errorMessage?: string
  error?: string
}
