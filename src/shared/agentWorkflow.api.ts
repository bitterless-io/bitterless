/** Shared workflow presentation contract. No Electron, Pi, or credentials cross this boundary. */
export type WorkflowBuiltinName = 'mini-demo' | 'code-review' | 'refactor-scout' | 'diagnose' | 'perf-review' | 'research'
export type WorkflowEntry = { kind: 'builtin'; name: WorkflowBuiltinName } | { kind: 'file'; path: string }
export type WorkflowAgentStatus = 'queued' | 'running' | 'waiting' | 'approval' | 'retrying' | 'stopping' | 'completed' | 'failed' | 'stopped'
export type WorkflowRunStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped'
export interface WorkflowLogEntry { ts: number; text: string }
export interface WorkflowAgentTask {
  id: string
  runId: string
  sessionId: string
  label: string
  prompt: string
  phase?: string
  status: WorkflowAgentStatus
  currentAction: string
  queuedAt: number
  startedAt?: number
  endedAt?: number
  logs: WorkflowLogEntry[]
  output?: string
  error?: string
}
export interface WorkflowRunSnapshot {
  id: string
  sessionId: string
  name: string
  input: string
  status: WorkflowRunStatus
  createdAt: number
  endedAt?: number
  agents: WorkflowAgentTask[]
  result?: string
  error?: string
}
export interface WorkflowSnapshot { runs: WorkflowRunSnapshot[]; revision: number }
export interface WorkflowStartRequest { sessionId: string; entry: WorkflowEntry; input: string; cwd?: string; origin?: 'shortcut' }
export interface WorkflowDescriptor { name: WorkflowBuiltinName; description: string }
export interface WorkflowApi {
  listRuns(params?: { sessionId?: string }): Promise<WorkflowSnapshot>
  listWorkflows(): Promise<WorkflowDescriptor[]>
  startWorkflow(params: WorkflowStartRequest): Promise<WorkflowRunSnapshot>
  stopAgent(params: { sessionId: string; runId: string; agentId: string }): Promise<{ ok: true }>
  stopWorkflow(params: { sessionId: string; runId: string }): Promise<{ ok: true }>
  stopSession(params: { sessionId: string }): Promise<{ ok: true }>
}
/** The XPC handler must return failures: electron-xpc converts thrown errors to null. */
export type WorkflowStartReply = { ok: true; run: WorkflowRunSnapshot } | { ok: false; error: string }
export type WorkflowIpcApi = Omit<WorkflowApi, 'startWorkflow'> & {
  startWorkflow(params: WorkflowStartRequest): Promise<WorkflowStartReply>
}
export const isWorkflowAgentLive = (status: WorkflowAgentStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting' || status === 'approval' || status === 'retrying' || status === 'stopping'

export type WorkflowCommand =
  | { kind: 'list' }
  | { kind: 'run'; target: string; input: string }
  | { kind: 'invalid' }

/** Only a whole composer command opts in. Quoted absolute paths may contain spaces. */
export const parseWorkflowCommand = (text: string): WorkflowCommand | null => {
  const match = /^\/workflow(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const args = match[1]?.trim()
  if (!args || args === 'list') return { kind: 'list' }
  const entry = /^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/.exec(args)
  if (!entry) return { kind: 'invalid' }
  const target = entry[1] || entry[2] || entry[3]
  if (target.startsWith('"') || target.startsWith("'")) return { kind: 'invalid' }
  return { kind: 'run', target: target === 'demo' ? 'mini-demo' : target, input: entry[4]?.trim() || '' }
}
