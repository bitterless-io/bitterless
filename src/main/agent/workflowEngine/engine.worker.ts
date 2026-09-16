import { runWorkflow } from '@kimchi-dev/kimchi-workflows/engine'
import { KimchiHost } from './kimchiHost'
import { loadWorkflow } from './loader'
import { onCommand, send } from './workerPort'
import { trackOwnedProcesses } from './ownedProcesses'
import { renderResult, wireError, type WorkerCommand } from './protocol'
trackOwnedProcesses()
const controller = new AbortController()
let host: KimchiHost | undefined
let started = false
const requestedStops = new Set<string>()

async function run(message: Extract<WorkerCommand, { type: 'engine.start' }>): Promise<void> {
  controller.signal.throwIfAborted()
  if (message.request.cwd) process.chdir(message.request.cwd)
  const loaded = await loadWorkflow(message.request)
  controller.signal.throwIfAborted()
  host = new KimchiHost(loaded.definition, message.request, message.run, message.runtime, controller.signal, send)
  for (const id of requestedStops) host.stopAgent(id)
  try {
    const result = await runWorkflow(loaded.definition, message.request.input, host, { signal: controller.signal })
    await host.drain()
    if (result.status === 'completed') send({ type: 'engine.done', result: renderResult(result.output) + host.incompleteSummary() })
    else if (result.status === 'cancelled') throw Object.assign(new Error('Workflow stopped'), { name: 'WorkflowCancelledError' })
    else throw new Error(result.error ?? 'Workflow requires attended input; resume is not enabled')
  } finally { await host.drain() }
}
onCommand(message => {
  if (message.type === 'abort') controller.abort(new Error('Workflow stopped by user'))
  else if (message.type === 'agent.stop') { requestedStops.add(message.agentId); host?.handle(message) }
  else if (message.type === 'engine.start' && !started) {
    started = true
    void run(message).catch(error => send({ type: 'engine.done', error: wireError(error) }))
  } else host?.handle(message)
})
send({ type: 'ready' })
