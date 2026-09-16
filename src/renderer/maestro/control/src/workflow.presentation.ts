import { isWorkflowAgentLive, type WorkflowAgentTask, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'

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
