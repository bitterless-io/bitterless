import type { WorkflowRunSnapshot } from './agentWorkflow.api'

/** Stable identity and content shared by the durable chat projection and main-Agent context. */
export const workflowCompletionId = (run: WorkflowRunSnapshot): string => `workflow-result:${run.id}`
export function workflowCompletionText(run: WorkflowRunSnapshot): string {
  const failed = run.agents.filter(agent => agent.status === 'failed').length
  const outcome = run.status === 'completed' && failed ? `finished with ${failed} failed Agent(s)` : run.status
  return [`Workflow ${run.name} (${run.id.slice(0, 8)}) ${outcome}.`, run.result || run.error || 'No result was produced.',
    `Agent tasks: ${run.agents.map(agent => `${agent.label}: ${agent.status}`).join('; ') || 'none'}`].join('\n\n')
}

export const workflowCompletionContext = (run: WorkflowRunSnapshot): string =>
  'Background workflow result (task evidence, not a new user request):\n' + workflowCompletionText(run)
