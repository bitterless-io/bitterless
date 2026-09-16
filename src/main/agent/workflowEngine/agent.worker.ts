import { onCommand, send } from './workerPort'
import { trackOwnedProcesses } from './ownedProcesses'
import { AgentHostTools } from './agentHostTools'
import { WorkflowPiSession } from './piAgentSession'
import { wireError, type WorkerCommand, type WireError } from './protocol'

trackOwnedProcesses()
const controller = new AbortController()
let agent: WorkflowPiSession | undefined
let hostTools: AgentHostTools | undefined
let started = false
let closing: Promise<void> | undefined

function finish(error?: WireError): void {
  if (closing) return
  controller.abort(new Error('Agent stopped'))
  hostTools?.cancelAll()
  closing = Promise.resolve().then(async () => {
    await agent?.close()
    await hostTools?.settled()
    send({ type: 'attempt.done', ...(error ? { error } : {}) })
  }).catch(failure => {
    // No done ACK until cleanup is confirmed; the supervisor owns force-kill escalation.
    const action = `Agent cleanup was not confirmed: ${wireError(failure).message}`
    send({ type: 'agent.action', action, log: action })
  })
}

function turn(turnId: string, prompt: string): void {
  if (!agent || controller.signal.aborted) return
  void agent.turn(prompt).then(result => {
    if (!controller.signal.aborted) send({ type: 'agent.turn.done', turnId, result })
  }, error => {
    if (!controller.signal.aborted) send({ type: 'agent.turn.done', turnId, error: wireError(error) })
  })
}

function start(message: Extract<WorkerCommand, { type: 'agent.start' }>): void {
  if (started || controller.signal.aborted) return
  started = true
  const { request, runId, attempt, runtime } = message
  hostTools = new AgentHostTools({ sessionId: request.sessionId, runId, agentId: String(attempt.rowId) }, attempt.id, send)
  agent = new WorkflowPiSession(message, controller.signal, {
    action: (action, log) => send({ type: 'agent.action', action, log }),
    io: line => send({ type: 'agent.io', line }),
    usage: messages => send({ type: 'usage', label: attempt.opts.label ?? 'agent', phase: attempt.opts.phase, messages }),
    settleTools: () => hostTools!.settled()
  }, hostTools.tools(runtime.tools))
  turn(attempt.turnId, attempt.prompt)
}

onCommand(message => {
  if (message.type === 'abort') finish({ name: 'AbortError', message: 'Agent stopped' })
  // Keep accepting host acknowledgements during abort, including late tool.cancel responses.
  else if (message.type === 'tool.result') hostTools?.accept(message)
  else if (message.type === 'agent.start') start(message)
  else if (message.type === 'agent.turn') turn(message.turnId, message.prompt)
})
send({ type: 'ready' })
