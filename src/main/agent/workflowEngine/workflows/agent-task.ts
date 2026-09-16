import { createWorkflow } from '@kimchi-dev/kimchi-workflows/flow'
import { Type } from 'typebox'
import { createAgentTask } from '../author'

/** An additional task is independent; it never mutates an executing workflow graph. */
export default createWorkflow({ name: 'agent-task', description: 'One additional independent Agent task.', input: Type.String() })
  .then(createAgentTask({ name: 'task', label: '追加任务', input: Type.String(), output: Type.String(), tools: ['read', 'grep', 'find', 'ls', 'web_search', 'web_fetch'], retries: 0,
    prompt: ({ input }) => `Complete this additional task using verifiable evidence. Follow the user's scope. Read-only research: do not modify files or execute commands. Give a concise result in the user's language and submit it with workflow_submit_result.\n${input}` }))
  .commit()
