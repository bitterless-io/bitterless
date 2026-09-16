import { parseWorkflowCommand, type WorkflowEntry } from '@shared/agentWorkflow.api'
import { workflowStore } from './store/workflow.store'
import { workflowText } from './workflow.text'

export interface WorkflowCommandContext {
  sessionId: string
  hasAttachments: boolean
  assertCanStart(): void
  refreshWorkspace(): Promise<string | undefined>
  note(text: string): void
}

/** A deterministic UI command. Natural-language requests still use the agent's workflow_run tool. */
export async function executeWorkflowCommand(text: string, context: WorkflowCommandContext): Promise<void> {
  const command = parseWorkflowCommand(text)
  const copy = workflowText()
  if (!command || command.kind === 'invalid') throw new Error(copy.commandUsage)
  const catalog = await workflowStore.listWorkflows()
  if (command.kind === 'list') {
    context.note(`${copy.commandUsage}\n\n${catalog.map(item => `- \`/workflow ${item.name === 'mini-demo' ? 'demo' : item.name}\` — ${item.description}`).join('\n')}`)
    return
  }
  context.assertCanStart()
  if (context.hasAttachments) throw new Error(copy.commandAttachments)
  const builtin = catalog.find(item => item.name === command.target)
  let entry: WorkflowEntry
  if (builtin) entry = { kind: 'builtin', name: builtin.name }
  else if (command.target.startsWith('/') && /\.(?:ts|mts)$/.test(command.target)) entry = { kind: 'file', path: command.target }
  else throw new Error(copy.commandUnknown.replace('{name}', command.target))
  const input = command.input || (builtin?.name === 'mini-demo' ? copy.demoInput : '')
  if (!input) throw new Error(copy.commandInput)
  const cwd = await context.refreshWorkspace()
  context.assertCanStart()
  if (!cwd) throw new Error(copy.commandWorkspace)
  // refreshWorkspace syncs this session's binding to Main; Main chooses its authoritative cwd/model.
  const run = await workflowStore.start({ sessionId: context.sessionId, entry, input, origin: 'shortcut' })
  // Completion is projected once from the persisted run snapshot by MessageStore.
  const current = workflowStore.runs.find(snapshot => snapshot.id === run.id && snapshot.sessionId === context.sessionId) ?? run
  if (run.status !== 'running' || (current.status !== 'running' && current.status !== 'stopping')) return
  context.note(copy.commandStarted.replace('{name}', run.name))
}
