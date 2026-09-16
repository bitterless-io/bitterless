import { watch } from 'vue'
import { parseWorkflowCommand, type WorkflowEntry, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'
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
  const isTerminal = (snapshot: WorkflowRunSnapshot): boolean => snapshot.status !== 'running' && snapshot.status !== 'stopping'
  const noteResult = (snapshot: WorkflowRunSnapshot): void => {
    context.note([`${snapshot.name} · ${copy.states[snapshot.status]}`, snapshot.error, snapshot.result].filter(Boolean).join('\n\n'))
  }
  // A broadcast may already be newer than the start reply by the time IPC resolves.
  const currentRun = (): WorkflowRunSnapshot => workflowStore.runs.find(snapshot => snapshot.id === run.id && snapshot.sessionId === context.sessionId) ?? run
  const current = isTerminal(run) ? run : currentRun()
  if (isTerminal(current)) {
    noteResult(current)
    return
  }
  if (!current.agents.length) {
    // Runs without Agents have no task bar. Keep their result in the original chat.
    const stopWatching = watch(currentRun, snapshot => {
      if (snapshot.agents.length) stopWatching()
      else if (isTerminal(snapshot)) {
        stopWatching()
        noteResult(snapshot)
      }
    }, { deep: true, flush: 'sync' })
  }
  context.note(copy.commandStarted.replace('{name}', run.name))
}
