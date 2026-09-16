import type { WorkflowDefinition } from '@kimchi-dev/kimchi-workflows/flow'
import type { WorkflowBuiltinName } from '../../../shared/agentWorkflow.api'
import additional from './workflows/agent-task'
import mini from './workflows/mini-demo'
import review from './workflows/code-review'
import refactor from './workflows/refactor-scout'
import diagnose from './workflows/diagnose'
import perf from './workflows/perf-review'
import research from './workflows/research'
import planWorkflow from './workflows/plan-workflow'
const workflows: Record<WorkflowBuiltinName, WorkflowDefinition> = { 'agent-task': additional, 'mini-demo': mini, 'code-review': review, 'refactor-scout': refactor, diagnose, 'perf-review': perf, research, 'plan-workflow': planWorkflow }
export function builtinWorkflow(name: string): WorkflowDefinition {
  const workflow = workflows[(name === 'demo' ? 'mini-demo' : name) as WorkflowBuiltinName]
  if (!workflow) throw new Error(`Unknown workflow: ${name}`)
  return workflow
}
