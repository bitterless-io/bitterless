/** Shared workflow presentation contract. No Electron, Pi, or credentials cross this boundary. */
export type WorkflowBuiltinName = 'agent-task' | 'plan-workflow' | 'code-review' | 'research' | 'adversarial-review'
export type WorkflowEntry = { kind: 'builtin'; name: WorkflowBuiltinName } | { kind: 'file'; path: string } | { kind: 'library'; ref: string }
export type WorkflowAgentStatus = 'queued' | 'running' | 'waiting' | 'approval' | 'retrying' | 'pausing' | 'paused' | 'stopping' | 'completed' | 'failed' | 'stopped'
export type WorkflowRunStatus = 'running' | 'paused' | 'stopping' | 'completed' | 'failed' | 'stopped'
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
  /**
   * The model this agent actually ran on (`provider/id`), when known.
   *
   * Arrives mid-run, not at start: a tier-routed agent defers the choice to the agent layer, so the
   * value known when it launches is a guess that is wrong for every such agent until it resolves.
   */
  model?: string
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
  /**
   * 结果正文。**可能被截断**(64 KB)—— 全量看 `resultPath`。
   */
  result?: string
  /**
   * 落终态时写下的**完整**结果文件(绝对路径),没有结果时不存在。
   *
   * 有界摘要进上下文、全量留在盘上,是 Pi 的做法(`deliverText` 永远附一行
   * `↳ Full result: <path>`),它的注释写着「so the tail is never lost — even when the summary
   * above is a complete verdict」。**有界不等于有损**:模型要细节就 `read` 这个文件。
   */
  resultPath?: string
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
/**
 * A chat's pending declaration that it is waiting for background runs.
 *
 * This is what the status bar renders. It is the host's own registry state, not something the model
 * said — so the user cannot be told "I'll wait" by an agent that never actually registered a wait,
 * and the indicator cannot be left behind after the wait is cancelled.
 */
export interface WorkflowWaitState {
  sessionId: string
  runIds: string[]
  declaredAt: number
}

export interface WorkflowSnapshot { runs: WorkflowRunSnapshot[]; revision: number; activity?: WorkflowActivitySummary[]; waiting?: WorkflowWaitState[] }
export interface WorkflowStartRequest { sessionId: string; entry: WorkflowEntry; input: string; cwd?: string; origin?: 'shortcut' }
export interface WorkflowDescriptor {
  name: string
  description: string
  displayName?: string
  scope?: 'builtin' | 'local'
  reference?: string
  entry?: WorkflowEntry
}
export interface WorkflowApi {
  listRuns(params?: { sessionId?: string }): Promise<WorkflowSnapshot>
  listWorkflows(): Promise<WorkflowDescriptor[]>
  startWorkflow(params: WorkflowStartRequest): Promise<WorkflowRunSnapshot>
  retryWorkflow(params: { sessionId: string; runId: string }): Promise<WorkflowRunSnapshot>
  /**
   * Run-level pause / resume / stop.
   *
   * The per-Agent calls below have no counterpart in this engine — it schedules its own agents and
   * exposes no per-agent channel — so this is what the task bar's controls act through. Pausing keeps
   * the run's journal, so resuming continues from the unchanged prefix rather than re-running it.
   */
  controlWorkflow(params: { sessionId: string; runId: string; action: 'pause' | 'resume' | 'stop' }): Promise<{ ok: boolean; status: string }>
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

/**
 * A run is live while it can still produce work — including before its first Agent exists, and
 * while paused. A paused run has not finished: its journal is intact and `resume` continues it, so
 * treating it as terminal would drop it out of the list the owner resumes from.
 */
export const isWorkflowRunLive = (run: WorkflowRunSnapshot): boolean =>
  run.status === 'running' || run.status === 'paused' || run.status === 'stopping'

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
  const mine = runs.filter(run => run.sessionId === sessionId)
  // A run is published with no Agents at all while its engine worker starts. Counting only runs that
  // already have an active Agent would report "1 workflow" for seconds while two are really running.
  const live = mine.filter(isWorkflowRunLive)
  const active = mine.flatMap(run => run.agents.filter(agent => isWorkflowAgentActive(agent.status)).map(agent => ({ run, agent })))
  const started = active.map(({ agent }) => agent.startedAt ?? agent.queuedAt).filter(value => Number.isFinite(value) && value > 0)
  return {
    runs: live.length,
    agents: active.length,
    awaitingUser: active.filter(({ agent }) => agent.status === 'approval').length,
    startedAt: started.length ? Math.min(...started) : 0,
    signature: active
      .map(({ run, agent }) => [run.id, agent.id, agent.status, (agent.currentAction || '').slice(0, 80)].join(''))
      .sort()
      .join('\n'),
    scope: [...live.map(run => run.id), ...active.map(({ run, agent }) => [run.id, agent.id, agent.label].join('|'))].sort().join('\n'),
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
