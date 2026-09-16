import type { WorkflowRunSnapshot } from '../../../shared/agentWorkflow.api'

/**
 * A chat's declared intent to continue once named background runs settle.
 *
 * Deliberately NOT a blocking tool. A host tool that waits would deadlock twice over: the agent's
 * abort awaits every in-flight tool promise, so Stop could never end the wait; and a user's next
 * message only reaches the model when steering drains at a tool boundary, so it would hang with no
 * bubble and no error. So the tool records an intent and returns at once, the turn ends normally,
 * and the settle event starts a fresh turn.
 */
export interface WorkflowWaitIntent {
  sessionId: string
  runIds: string[]
  declaredAt: number
}

export interface WorkflowWaitSatisfied {
  sessionId: string
  /** Terminal snapshots of exactly the runs that were waited on, in the order they were named. */
  runs: WorkflowRunSnapshot[]
}

export type WorkflowWaitRejection =
  | { ok: false; reason: 'no-live-runs' }
  | { ok: false; reason: 'unknown-runs'; runIds: string[] }
  | { ok: false; reason: 'already-settled'; runIds: string[] }

export type WorkflowWaitResult = { ok: true; intent: WorkflowWaitIntent } | WorkflowWaitRejection

const isLive = (run: WorkflowRunSnapshot): boolean => run.status === 'running' || run.status === 'stopping'

/**
 * Tracks at most one pending wait per chat.
 *
 * One per chat, not one per run: a second declaration replaces the first, because the agent asking
 * to wait again has restated what it is waiting for, and two live intents in one chat would race to
 * start a turn.
 */
export class WorkflowWaitRegistry {
  private readonly intents = new Map<string, WorkflowWaitIntent>()

  /** `runIds` empty means every live run in this chat. */
  declare(sessionId: string, runIds: readonly string[], runs: readonly WorkflowRunSnapshot[], now: number): WorkflowWaitResult {
    const chatRuns = runs.filter(run => run.sessionId === sessionId)
    if (!runIds.length) {
      const live = chatRuns.filter(isLive)
      if (!live.length) return { ok: false, reason: 'no-live-runs' }
      return this.remember({ sessionId, runIds: live.map(run => run.id), declaredAt: now })
    }
    const unknown = runIds.filter(id => !chatRuns.some(run => run.id === id))
    if (unknown.length) return { ok: false, reason: 'unknown-runs', runIds: unknown }
    const settled = runIds.filter(id => !isLive(chatRuns.find(run => run.id === id)!))
    // Waiting on finished work would never fire; its outcome already reached this chat.
    if (settled.length === runIds.length) return { ok: false, reason: 'already-settled', runIds: settled }
    return this.remember({ sessionId, runIds: runIds.filter(id => !settled.includes(id)), declaredAt: now })
  }

  private remember(intent: WorkflowWaitIntent): WorkflowWaitResult {
    this.intents.set(intent.sessionId, intent)
    return { ok: true, intent }
  }

  pending(sessionId: string): WorkflowWaitIntent | undefined { return this.intents.get(sessionId) }

  /** The user outranks a wait: anything they do cancels it rather than queueing behind it. */
  cancel(sessionId: string): boolean { return this.intents.delete(sessionId) }

  clear(): void { this.intents.clear() }

  /**
   * Returns the waits whose runs have all settled, removing them so a repeated snapshot cannot
   * start the same continuation twice.
   */
  settle(runs: readonly WorkflowRunSnapshot[]): WorkflowWaitSatisfied[] {
    const satisfied: WorkflowWaitSatisfied[] = []
    for (const [sessionId, intent] of [...this.intents]) {
      const named = intent.runIds.map(id => runs.find(run => run.id === id))
      // A run that vanished from the snapshot can never settle; drop the wait rather than hang.
      if (named.some(run => run && isLive(run))) continue
      this.intents.delete(sessionId)
      satisfied.push({ sessionId, runs: named.filter((run): run is WorkflowRunSnapshot => Boolean(run)) })
    }
    return satisfied
  }
}

/** What the model is told when its wait is accepted. It must say this out loud before its turn ends. */
export function workflowWaitReceipt(intent: WorkflowWaitIntent, runs: readonly WorkflowRunSnapshot[]): string {
  const named = intent.runIds.map(id => runs.find(run => run.id === id)).filter(Boolean) as WorkflowRunSnapshot[]
  return JSON.stringify({
    waiting: true,
    runs: named.map(run => ({ runId: run.id, name: run.name, agents: run.agents.length })),
    instruction: [
      'Your wait is registered. Do NOT call this tool again and do not poll.',
      'End your turn now with a short reply that names which workflows you are waiting for.',
      'When they all settle this chat continues on its own with their real outcomes.',
      'The user can keep talking; if they do, the wait is cancelled and they are answered first.'
    ].join(' ')
  })
}

export function workflowWaitRejectionMessage(rejection: WorkflowWaitRejection): string {
  if (rejection.reason === 'no-live-runs') return 'There is no running workflow in this chat to wait for.'
  if (rejection.reason === 'unknown-runs') return `No such run in this chat: ${rejection.runIds.join(', ')}. List tasks first; never guess a run ID.`
  return `Those runs have already finished: ${rejection.runIds.join(', ')}. Their results are already in this chat — use them instead of waiting.`
}

/**
 * The root text of the continuation turn.
 *
 * It is the host speaking, not the user, and it must not overstate what happened: a stopped or
 * failed run is named as such so the continuation cannot present a partial result as a whole one.
 */
export function workflowWaitContinuationText(runs: readonly WorkflowRunSnapshot[]): string {
  // A pointer, not a restatement. Each run's full outcome already reached this chat's background
  // context when it settled; repeating it here would show the model the same result twice. Naming
  // the outcome per run is still required, so a failed branch cannot pass for a finished one.
  const lines = runs.map(run => {
    const failed = run.agents.filter(agent => agent.status === 'failed').length
    const outcome = run.status === 'completed' && !failed ? 'finished'
      : run.status === 'completed' ? `finished, ${failed} Agent(s) failed`
      : run.status === 'failed' ? 'failed'
      : 'was stopped'
    return `- ${run.name} (${run.id}): ${outcome}`
  })
  return [
    'The background workflows you said you would wait for have all settled.',
    ...lines,
    '',
    'Their full results are already in your context — do not ask for them again and do not re-run',
    'anything. Continue what you told the user you would do. Say plainly which parts are missing',
    'where a workflow failed or was stopped; never present a partial outcome as a complete one.'
  ].join('\n')
}
