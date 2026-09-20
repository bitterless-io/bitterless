import type { WorkflowAgentStatus, WorkflowAgentTask } from '../../../../shared/agentWorkflow.api'

/**
 * The `@quintinshaw/pi-dynamic-workflows` adapter: its per-agent events → our task rows.
 *
 * Ral 2026-09-20:「弃用 kimchi 改用 @quintinshaw/pi-dynamic-workflows」·「cowork 和 bl 都要支持,
 * 需要和 pi 中的 quintinshaw/pi-dynamic-workflows 对齐」.
 *
 * **Aligning means using the package's own runner, not reimplementing it.** `WorkflowAgent` already
 * resolves model tiers, enforces `DEFAULT_EXCLUDED_SUBAGENT_TOOLS` (so a subagent cannot start its
 * own unbounded nested run), recovers structured output, and classifies provider quota errors as
 * non-recoverable instead of collapsing them to a silent null. Writing our own runner would mean
 * reproducing all of that and drifting from Pi on every one of those behaviours.
 *
 * This file owns exactly one thing: turning the run's per-agent event stream into the rows the chat
 * task bar already renders. It does not start, stop or schedule anything.
 */

/** The five states the engine reports. Fewer than the host's own set — see `toStatus`. */
export type DynamicAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped'

export interface DynamicAgentEvent {
  /**
   * Per **call**, never per label. Concurrent agents routinely share a label — `parallel()`'s
   * default `"${phase} agent N"`, or one label reused across a fan-out — so keying rows on the label
   * files one agent's events under another's row. The package's own types warn about this; the
   * warning is repeated here because this is the place that could get it wrong.
   */
  id: string
  label: string
  phase?: string
  prompt?: string
  model?: string
  result?: unknown
  /** Compacted transcript for this agent — what the task bar's Work log shows. */
  history?: Array<{ role?: string; kind?: string; text?: string; toolName?: string; timestamp?: number }>
  error?: string
  recoverable?: boolean
  replayed?: boolean
}

/**
 * Map the engine's five states onto the host's set.
 *
 * `skipped` becomes `stopped` rather than `completed`: a skipped agent produced no result, and
 * showing it as completed would make a partial run read as a whole one. The host's richer states
 * (`waiting`, `approval`, `pausing`, `paused`, `retrying`) have no counterpart here — the engine
 * simply does not model them, so nothing is invented to fill the gap.
 */
export const toStatus = (status: DynamicAgentStatus): WorkflowAgentStatus =>
  status === 'done' ? 'completed' : status === 'error' ? 'failed' : status === 'skipped' ? 'stopped' : status

/** What the adapter needs from the host to publish a row. */
export interface DynamicRowSink {
  /** Called for every create/update. The host decides how to persist and broadcast. */
  publish(row: WorkflowAgentTask): void
}

/** The manager's per-agent snapshot entry, as much of it as the task bar uses. */
export interface DynamicAgentSnapshot {
  /** Display index. NOT an identity — it renumbers. */
  id: number
  /** Runtime call identity. This is what a row is keyed on. */
  callId?: string
  label: string
  phase?: string
  prompt: string
  status: DynamicAgentStatus
  result?: unknown
  resultPreview?: string
  error?: string
  model?: string
  history?: DynamicAgentEvent['history']
}

export interface DynamicRunIdentity {
  runId: string
  sessionId: string
}

/**
 * Accumulates rows for one run and keeps them keyed by the engine's per-call id.
 *
 * Deliberately a class holding a `Map` rather than a pure function over an event list: the events
 * arrive over the life of the run, `onAgentModel` can fire repeatedly for one agent (once per
 * attempt, and per turn for a named thread), and a row has to be updated in place rather than
 * rebuilt — the task bar keys its DOM rows on identity.
 */
export class DynamicWorkflowRows {
  private readonly rows = new Map<string, WorkflowAgentTask>()
  private sequence = 0

  constructor(private readonly identity: DynamicRunIdentity, private readonly sink: DynamicRowSink) {}

  private row(event: DynamicAgentEvent): WorkflowAgentTask {
    const existing = this.rows.get(event.id)
    if (existing) return existing
    const created: WorkflowAgentTask = {
      id: String(++this.sequence),
      runId: this.identity.runId,
      sessionId: this.identity.sessionId,
      label: event.label,
      phase: event.phase ?? '',
      prompt: event.prompt ?? '',
      status: 'queued',
      currentAction: '',
      queuedAt: Date.now(),
      logs: []
    }
    this.rows.set(event.id, created)
    return created
  }

  started(event: DynamicAgentEvent): void {
    const row = this.row(event)
    row.label = event.label
    if (event.phase) row.phase = event.phase
    if (event.prompt) row.prompt = event.prompt
    row.status = 'running'
    row.startedAt = Date.now()
    // A replayed agent never ran: it is a journalled result being rehydrated on resume. Saying
    // "running" for it would put a spinner next to work that is already finished and cost nothing.
    row.currentAction = event.replayed ? 'Restored from a previous run' : 'Working'
    this.sink.publish(row)
  }

  /** `onAgentModel` fires mid-run with the agent's REAL model, after tier routing resolves it. */
  model(event: DynamicAgentEvent): void {
    if (!event.model) return
    const row = this.row(event)
    row.model = event.model
    this.sink.publish(row)
  }

  /**
   * The agent's transcript so far, compacted by the engine.
   *
   * Without this the task bar's Work log pane is empty for every agent — the row exists and says
   * "Running", and expanding it shows nothing. Fires repeatedly as the agent works, so it replaces
   * rather than appends.
   */
  history(event: DynamicAgentEvent): void {
    if (!Array.isArray(event.history)) return
    const row = this.row(event)
    this.applyHistory(row, event.history)
    this.sink.publish(row)
  }

  private applyHistory(row: WorkflowAgentTask, history: NonNullable<DynamicAgentEvent['history']>): void {
    row.logs = history
      .map(entry => ({ ts: entry.timestamp ?? Date.now(), text: entry.toolName ? `${entry.toolName}: ${entry.text ?? ''}` : (entry.text ?? '') }))
      .filter(entry => entry.text.trim())
    // The newest line is what the row shows while it works, so the bar says what the agent is doing
    // rather than a fixed "Working" for ten minutes.
    const latest = row.logs.at(-1)
    if (latest && row.status === 'running') row.currentAction = latest.text.slice(0, 120)
  }

  ended(event: DynamicAgentEvent): void {
    const row = this.row(event)
    row.status = event.error ? 'failed' : 'completed'
    row.endedAt = Date.now()
    row.currentAction = ''
    if (event.error) row.error = event.error
    if (event.model) row.model = event.model
    // The bar has a Result pane; leaving it empty on a completed agent reads as "it produced
    // nothing", which is different from "nobody wrote the result down".
    if (event.result !== undefined && event.result !== null) {
      row.output = typeof event.result === 'string' ? event.result : JSON.stringify(event.result, null, 2)
    }
    this.sink.publish(row)
  }

  /**
   * Take the manager's whole snapshot at once.
   *
   * `WorkflowManager` reports progress as a complete `WorkflowSnapshot` rather than as the individual
   * `onAgent*` callbacks, so this is the path a managed run uses. Same rows, same keying rule: the
   * snapshot's own `callId` identifies the agent CALL, and its numeric `id` is only a display index —
   * keying on that would merge two concurrent agents the moment one finished and renumbered.
   */
  fromSnapshot(agents: readonly DynamicAgentSnapshot[]): void {
    for (const agent of agents) {
      const event: DynamicAgentEvent = {
        id: agent.callId ?? `#${agent.id}`,
        label: agent.label,
        phase: agent.phase,
        prompt: agent.prompt,
        model: agent.model,
        history: agent.history,
        error: agent.error
      }
      const row = this.row(event)
      row.label = agent.label
      if (agent.phase) row.phase = agent.phase
      if (agent.prompt) row.prompt = agent.prompt
      if (agent.model) row.model = agent.model
      const status = toStatus(agent.status)
      if (status !== row.status) {
        if (status === 'running' && !row.startedAt) row.startedAt = Date.now()
        if ((status === 'completed' || status === 'failed' || status === 'stopped') && !row.endedAt) row.endedAt = Date.now()
        row.status = status
      }
      if (Array.isArray(agent.history)) this.applyHistory(row, agent.history)
      if (agent.error) row.error = agent.error
      if (agent.result !== undefined && agent.result !== null) row.output = typeof agent.result === 'string' ? agent.result : JSON.stringify(agent.result, null, 2)
      else if (agent.resultPreview) row.output = agent.resultPreview
      if (row.status !== 'running') row.currentAction = ''
      this.sink.publish(row)
    }
  }

  /** Every row for this run, in creation order — the shape the snapshot wants. */
  all(): WorkflowAgentTask[] { return [...this.rows.values()] }
}
