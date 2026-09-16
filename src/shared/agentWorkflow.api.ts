/** Shared workflow presentation contract. No Electron, Pi, or credentials cross this boundary. */
export type WorkflowBuiltinName = 'mini-demo' | 'code-review' | 'refactor-scout' | 'diagnose' | 'perf-review' | 'research' | 'agent-task'
export type WorkflowEntry = { kind: 'builtin'; name: WorkflowBuiltinName } | { kind: 'file'; path: string } | { kind: 'library'; ref: string }
export type WorkflowAgentStatus = 'queued' | 'running' | 'waiting' | 'approval' | 'retrying' | 'pausing' | 'paused' | 'stopping' | 'completed' | 'failed' | 'stopped'
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
  /** Retained launch entry; older snapshots may not have it. */
  entry?: WorkflowEntry
  input: string
  status: WorkflowRunStatus
  createdAt: number
  endedAt?: number
  agents: WorkflowAgentTask[]
  result?: string
  error?: string
}
/**
 * One-sentence account of a chat's background Agent work, for the chat status bar.
 *
 * `text` is written by a model in the task's own language and may be absent; the deterministic
 * counts always travel with it so the renderer can localize its own line without a model.
 */
export interface WorkflowActivitySummary {
  sessionId: string
  text: string
  runs: number
  agents: number
  awaitingUser: number
  /** Earliest active Agent start, for elapsed time. 0 when unknown. */
  startedAt: number
  generatedAt: number
}
export interface WorkflowSnapshot { runs: WorkflowRunSnapshot[]; revision: number; activity?: WorkflowActivitySummary[] }
export interface WorkflowStartRequest { sessionId: string; entry: WorkflowEntry; input: string; cwd?: string; origin?: 'shortcut' }
export interface WorkflowDescriptor { name: string; description: string; displayName?: string; scope?: 'shared' | 'institution'; institution_id?: number; ref?: string; entry?: WorkflowEntry }
export interface WorkflowApi {
  listRuns(params?: { sessionId?: string }): Promise<WorkflowSnapshot>
  listWorkflows(): Promise<WorkflowDescriptor[]>
  startWorkflow(params: WorkflowStartRequest): Promise<WorkflowRunSnapshot>
  retryWorkflow(params: { sessionId: string; runId: string }): Promise<WorkflowRunSnapshot>
  pauseWorkflowAgent(params: { sessionId: string; runId: string; agentId: string }): Promise<{ ok: true }>
  resumeWorkflowAgent(params: { sessionId: string; runId: string; agentId: string }): Promise<{ ok: true }>
  steerWorkflowAgent(params: { sessionId: string; runId: string; agentId: string; message: string }): Promise<{ ok: true }>
  stopAgent(params: { sessionId: string; runId: string; agentId: string }): Promise<{ ok: true }>
  stopWorkflow(params: { sessionId: string; runId: string }): Promise<{ ok: true }>
  stopSession(params: { sessionId: string }): Promise<{ ok: true }>
}
/** The XPC handler must return failures: electron-xpc converts thrown errors to null. */
export type WorkflowStartReply = { ok: true; run: WorkflowRunSnapshot } | { ok: false; error: string }
export type WorkflowIpcApi = Omit<WorkflowApi, 'startWorkflow' | 'retryWorkflow'> & {
  startWorkflow(params: WorkflowStartRequest): Promise<WorkflowStartReply>
  retryWorkflow(params: { sessionId: string; runId: string }): Promise<WorkflowStartReply>
}
export const isWorkflowAgentLive = (status: WorkflowAgentStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting' || status === 'approval' || status === 'retrying' || status === 'pausing' || status === 'paused' || status === 'stopping'

/** A paused Agent stays live and stoppable, but does not occupy the active task bar. */
export const isWorkflowAgentActive = (status: WorkflowAgentStatus): boolean => isWorkflowAgentLive(status) && status !== 'paused'

/** Deterministic view of one chat's active Agents; main and renderer must agree on these counts. */
export interface WorkflowActivityFacts {
  runs: number
  agents: number
  awaitingUser: number
  startedAt: number
  /** Changes only when the described work changes, so an unchanged snapshot costs no model call. */
  signature: string
  /**
   * The Agents themselves, without their momentary step.
   *
   * A sentence describes this set, so it survives a tool step changing underneath it; when the set
   * changes the old sentence no longer describes the work and must not be shown.
   */
  scope: string
  /** Bounded JSON handed to the summarizing model. Never includes credentials or full outputs. */
  brief: string
}

export function workflowActivityFacts(runs: readonly WorkflowRunSnapshot[], sessionId: string): WorkflowActivityFacts {
  const active = runs
    .filter(run => run.sessionId === sessionId)
    .flatMap(run => run.agents.filter(agent => isWorkflowAgentActive(agent.status)).map(agent => ({ run, agent })))
  const started = active.map(({ agent }) => agent.startedAt ?? agent.queuedAt).filter(value => Number.isFinite(value) && value > 0)
  return {
    runs: new Set(active.map(({ run }) => run.id)).size,
    agents: active.length,
    awaitingUser: active.filter(({ agent }) => agent.status === 'approval').length,
    startedAt: started.length ? Math.min(...started) : 0,
    signature: active
      .map(({ run, agent }) => [run.id, agent.id, agent.status, (agent.currentAction || '').slice(0, 80)].join(''))
      .sort()
      .join('\n'),
    scope: active.map(({ run, agent }) => [run.id, agent.id, agent.label].join('|')).sort().join('\n'),
    brief: JSON.stringify({
      tasks: active.slice(0, 8).map(({ run, agent }) => ({
        workflow: run.name,
        goal: run.input.slice(0, 200),
        agent: agent.label,
        status: agent.status,
        doing: (agent.currentAction || '').slice(0, 120)
      }))
    })
  }
}

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
