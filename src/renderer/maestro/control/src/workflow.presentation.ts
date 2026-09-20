import { isWorkflowAgentActive, workflowActivityFacts, type WorkflowAgentTask, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'

/** Re-exported so a view reads its own module's presentation layer, not the wire contract. */
export { workflowActivityFacts }

export type WorkflowTaskCategory = 'active' | 'paused' | 'completed' | 'failed' | 'stopped'

export const newestWorkflowRuns = (runs: readonly WorkflowRunSnapshot[]): WorkflowRunSnapshot[] =>
  [...runs].reverse().sort((a, b) => b.createdAt - a.createdAt)

export const workflowRunCategory = (run: WorkflowRunSnapshot): WorkflowTaskCategory => {
  if (run.status === 'running' || run.status === 'stopping') return 'active'
  // Paused is NOT finished, and it is not a variant of active either — its journal is intact and it
  // resumes from where it stopped. Falling through to `completed` (which is what happened before the
  // engine gained run-level pause) made a paused run render as done: the header offered "Rerun"
  // instead of "Resume", and in the live bar the group was filtered out altogether while the trigger
  // pill still counted it. A run the owner deliberately paused cannot be one they can no longer see.
  if (run.status === 'paused') return 'paused'
  if (run.status === 'failed' || (run.status === 'completed' && run.agents.some(agent => agent.status === 'failed'))) return 'failed'
  return run.status === 'stopped' ? 'stopped' : 'completed'
}

/**
 * One workflow and its own Agents.
 *
 * The roster used to group by status, which is unreadable once two workflows run at once: one
 * workflow's finder sat beside another's next to no indication of which run it belonged to.
 */
export interface WorkflowRunGroup {
  run: WorkflowRunSnapshot
  category: WorkflowTaskCategory
  /** This run's Agents, work needing attention first. */
  agents: WorkflowAgentTask[]
  activeCount: number
  awaitingUser: number
  failedCount: number
  /** A settled run collapses to its header by default; its records are kept, not dropped. */
  ended: boolean
}

/** Whatever is asking for the user comes first; finished work sinks. Ties keep snapshot order. */
const AGENT_RANK: Record<WorkflowAgentTask['status'], number> = {
  approval: 0,
  running: 1, waiting: 1, retrying: 1, stopping: 1,
  queued: 2,
  pausing: 3, paused: 3,
  completed: 4, failed: 5, stopped: 6
}

/** Primary grouping for the task roster: one group per run, newest run first. */
export function groupWorkflowRuns(runs: readonly WorkflowRunSnapshot[]): WorkflowRunGroup[] {
  return newestWorkflowRuns(runs).map(run => {
    const category = workflowRunCategory(run)
    return {
      run,
      category,
      agents: [...run.agents].sort((left, right) => AGENT_RANK[left.status] - AGENT_RANK[right.status]),
      activeCount: run.agents.filter(agent => isWorkflowAgentActive(agent.status)).length,
      awaitingUser: run.agents.filter(agent => agent.status === 'approval').length,
      failedCount: run.agents.filter(agent => agent.status === 'failed').length,
      // A paused run stays open and controllable: collapsing it by default would hide the very
      // control that un-pauses it.
      ended: category !== 'active' && category !== 'paused'
    }
  })
}

export interface WorkflowCompletionStrings {
  finishedTitle: string
  finishedFailedTitle: string
  finishedPartialTitle: string
  finishedStoppedTitle: string
  finishedNoResult: string
  finishedAgents: string
  states: Record<WorkflowAgentTask['status'], string>
}

/**
 * The chat projection of a settled run, in the user's language.
 *
 * Main keeps its own English context string for the model; this one exists because the user has
 * to notice the outcome in the conversation itself, not only in the task history.
 */
export function workflowCompletionChatText(run: WorkflowRunSnapshot, text: WorkflowCompletionStrings): string {
  const failed = run.agents.filter(agent => agent.status === 'failed').length
  const template = run.status === 'failed'
    ? text.finishedFailedTitle
    : run.status === 'stopped'
      ? text.finishedStoppedTitle
      : failed
        ? text.finishedPartialTitle.replace('{count}', String(failed))
        : text.finishedTitle
  const roster = run.agents.map(agent => `- ${agent.label}: ${text.states[agent.status] ?? agent.status}`).join('\n')
  return [
    `**${template.replace('{name}', run.name)}**`,
    run.result?.trim() || run.error?.trim() || text.finishedNoResult,
    roster ? `${text.finishedAgents}\n${roster}` : ''
  ].filter(Boolean).join('\n\n')
}
