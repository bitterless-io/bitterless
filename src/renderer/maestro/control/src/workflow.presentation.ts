import { isWorkflowAgentLive, workflowActivityFacts, type WorkflowAgentTask, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'

/** Re-exported so a view reads its own module's presentation layer, not the wire contract. */
export { workflowActivityFacts }

export type WorkflowTaskCategory = 'active' | 'paused' | 'completed' | 'failed' | 'stopped'
export interface WorkflowTaskGroup { category: WorkflowTaskCategory; tasks: WorkflowAgentTask[]; runs: WorkflowRunSnapshot[] }

export const newestWorkflowRuns = (runs: readonly WorkflowRunSnapshot[]): WorkflowRunSnapshot[] =>
  [...runs].reverse().sort((a, b) => b.createdAt - a.createdAt)

export const workflowRunCategory = (run: WorkflowRunSnapshot): WorkflowTaskCategory => {
  if (run.status === 'running' || run.status === 'stopping') return 'active'
  if (run.status === 'failed' || (run.status === 'completed' && run.agents.some(agent => agent.status === 'failed'))) return 'failed'
  return run.status === 'stopped' ? 'stopped' : 'completed'
}

/** Successful work stays visible; failed and stopped history can be collapsed independently. */
export function groupWorkflowTasks(runs: readonly WorkflowRunSnapshot[]): WorkflowTaskGroup[] {
  const categories: WorkflowTaskCategory[] = ['active', 'completed', 'paused', 'failed', 'stopped']
  const groups = categories.map(category => ({ category, tasks: [] as WorkflowAgentTask[], runs: [] as WorkflowRunSnapshot[] }))
  const byCategory = Object.fromEntries(groups.map(group => [group.category, group])) as Record<WorkflowTaskCategory, WorkflowTaskGroup>
  for (const run of newestWorkflowRuns(runs)) {
    byCategory[workflowRunCategory(run)].runs.push(run)
    for (const task of run.agents) byCategory[task.status === 'paused' ? 'paused' : isWorkflowAgentLive(task.status) ? 'active' : task.status as 'completed' | 'failed' | 'stopped'].tasks.push(task)
  }
  return groups.filter(group => group.tasks.length || group.runs.length)
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
