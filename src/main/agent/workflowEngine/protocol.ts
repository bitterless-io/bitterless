import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { TSchema } from 'typebox'
import type { WorkflowAgentTask, WorkflowRunSnapshot, WorkflowStartRequest } from '../../../shared/agentWorkflow.api'

export interface WorkflowToolDescriptor {
  name: string
  description: string
  params: Array<{ name: string; type?: string; description?: string; required?: boolean }>
  timeoutMs?: number
}
export interface WorkflowRuntimeConfig {
  providerId: string
  modelId: string
  thinkingLevel: ThinkingLevel
  authPath: string
  modelsPath?: string
  agentDir?: string
  systemPrompt: string
  tools: WorkflowToolDescriptor[]
  /** Main-to-Agent only. Never forward to the workflow engine or persist in run snapshots. */
  relay?: WorkflowRelayCredentials
}
export interface WorkflowRelayCredentials {
  providerId: 'ai-crms'
  modelId: string
  apiKey: string
  baseUrl: string
  headers: Record<string, string>
  model: { name: string; contextWindow: number; maxTokens: number }
}
export type WorkflowEngineRuntime = Pick<WorkflowRuntimeConfig, 'providerId' | 'modelId' | 'thinkingLevel'>
export function workflowEngineRuntime(runtime: WorkflowRuntimeConfig): WorkflowEngineRuntime {
  return { providerId: runtime.providerId, modelId: runtime.modelId, thinkingLevel: runtime.thinkingLevel }
}
export interface WorkflowHostToolRequest {
  sessionId: string
  runId: string
  agentId: string
  callId: string
  toolName: string
  args: Record<string, unknown>
}
export interface WireError { name: string; message: string; details?: Record<string, unknown> }
export interface AgentAttemptOptions {
  label?: string
  phase?: string
  tools?: string[]
  thinkingLevel?: ThinkingLevel
  outputSchema?: TSchema
  asks?: boolean
}
/** A single Pi conversation. Output-repair turns keep this attempt and its utility process alive. */
export interface AgentAttemptRequest {
  id: string
  rowId: number
  prompt: string
  turnId: string
  opts: AgentAttemptOptions
  providerId: string
  modelId: string
}
/** Serializable counterpart of Kimchi's AgentTurn; only actual submit-tool calls fill submitted. */
export interface AgentTurnResult {
  text: string
  usage?: { totalTokens: number }
  cancelled?: boolean
  submitted?: { tool: string; arguments: Record<string, unknown> }
  /** A real submit call was rejected; Kimchi may repair it within its existing budget. */
  submissionError?: string
  error?: { kind: 'context-window-exceeded' | 'provider-error'; message: string }
  conversation?: readonly unknown[]
}
/** Agent diagnostics are attributed and persisted by the main process, never by utility workers. */
export interface WorkflowIoLine {
  turn: number
  kind: 'prompt' | 'tool_result' | 'turn_end' | 'note'
  name: string
  subject: string
  text: string
  detail?: unknown
}
export type WorkerCommand =
  | { type: 'usage.record'; label: string; phase?: string; messages: readonly unknown[] }
  | { type: 'engine.start'; request: WorkflowStartRequest; run: WorkflowRunSnapshot; runtime: WorkflowEngineRuntime }
  | { type: 'agent.start'; request: WorkflowStartRequest; runId: string; runtime: WorkflowRuntimeConfig; attempt: AgentAttemptRequest }
  | { type: 'agent.turn'; turnId: string; prompt: string }
  | { type: 'abort' }
  | { type: 'agent.stop'; agentId: string }
  // Run-level control. The engine has no per-agent equivalent — see engine.worker.ts.
  | { type: 'workflow.pause' | 'workflow.resume' | 'workflow.stop' }
  | { type: 'agent.pause' | 'agent.resume'; agentId: string }
  | { type: 'agent.steer'; agentId: string; message: string }
  | { type: 'agent.pause.state'; agentId: string; paused: boolean }
  | { type: 'attempt.turn.result'; id: string; turnId: string; result?: AgentTurnResult; error?: WireError }
  // This is a cleanup acknowledgement, emitted only after the supervisor confirms resource release.
  | { type: 'attempt.result'; id: string; result?: unknown; error?: WireError }
  | { type: 'tool.result'; callId: string; result?: string; error?: string }
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'agent.update'; agent: WorkflowAgentTask }
  | { type: 'attempt.start'; attempt: AgentAttemptRequest }
  | { type: 'attempt.turn'; id: string; turnId: string; prompt: string }
  | { type: 'attempt.cancel'; id: string }
  | { type: 'agent.turn.done'; turnId: string; result?: AgentTurnResult; error?: WireError }
  | { type: 'attempt.done'; result?: unknown; error?: WireError }
  | { type: 'agent.action'; action: string; log?: string }
  | { type: 'agent.pause.state'; agentId: string; paused: boolean }
  | { type: 'agent.io'; line: WorkflowIoLine }
  | { type: 'usage'; label: string; phase?: string; messages: readonly unknown[] }
  | { type: 'tool.request'; request: WorkflowHostToolRequest }
  | { type: 'tool.cancel'; callId: string }
  | { type: 'process.owned'; pid: number; group: boolean }
  | { type: 'process.released'; pid: number }
  | { type: 'workflow.state'; runId: string; state: 'started' | 'paused' | 'resumed' | 'stopped' }
  | { type: 'workflow.control'; action: 'pause' | 'resume' | 'stop'; ok: boolean }
  | { type: 'engine.done'; result?: string; error?: WireError }
export function wireError(error: unknown): WireError {
  if (error instanceof Error) {
    const details = 'details' in error && error.details && typeof error.details === 'object'
      ? error.details as Record<string, unknown> : undefined
    return { name: error.name, message: error.message, ...(details ? { details } : {}) }
  }
  return { name: 'Error', message: String(error) }
}
export function renderResult(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}
