import type { CodexDebugEvent } from '@maestro-shared/coach.api'

export type AgentRuntimeThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface AgentToolParamSpec {
  name: string
  type?: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export interface AgentToolSpec {
  name: string
  description: string
  params: AgentToolParamSpec[]
  /** Runs the underlying coach tool; returns an observation string for the agent. */
  execute: (args: Record<string, unknown>) => Promise<string>
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
  text: string
  media?: AgentRuntimeMediaRef[]
  images?: AgentRuntimeImage[]
}

export interface AgentRuntimeSessionOptions {
  target: AgentRuntimeTarget
  authPath: string
  modelsPath?: string
  tools: AgentToolSpec[]
  scope: CodexDebugEvent['scope']
  onDebug?: (event: CodexDebugEvent) => void
}

export type AgentRuntimeEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'assistant_done'; text?: string; stopReason?: string; errorMessage?: string }
  | { type: 'assistant_message_end'; text?: string; stopReason?: string; errorMessage?: string }
  | { type: 'tool_start'; toolName?: string; args?: unknown }
  | { type: 'tool_end'; toolName?: string; args?: unknown; isError?: boolean }

export interface AgentRuntimeSession {
  subscribe: (listener: (event: AgentRuntimeEvent) => void) => undefined | (() => void)
  prompt: (message: AgentRuntimePrompt) => Promise<unknown>
  abort: () => Promise<void>
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
