import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type ExternalAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; id: string; title: string; status: 'in_progress' | 'completed' | 'failed'; input?: unknown; output?: string }

export interface ExternalAgentTurn {
  sessionId: string
  signal: AbortSignal
  emit: (event: ExternalAgentEvent) => void
  permission: (request: { id: string; title: string; input: unknown }) => Promise<boolean>
}

const externalTurns = new AsyncLocalStorage<ExternalAgentTurn>()
const currentTool = new AsyncLocalStorage<string>()
interface AgentTurnOwner { token: symbol; tools: Set<Promise<unknown>> }
const turnOwner = new AsyncLocalStorage<AgentTurnOwner>()
let activeTurn: AgentTurnOwner | undefined
const eventListeners = new Map<string, (event: ExternalAgentEvent) => void>()

/** Shared by GUI, trainer, delegates, replay and external clients: the browser is global. */
export const runAgentTurn = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeTurn && turnOwner.getStore() === activeTurn) return await run()
  if (activeTurn) throw new Error('Maestro is busy with another turn. Retry when it completes.')
  const token: AgentTurnOwner = { token: Symbol('maestro-turn'), tools: new Set() }
  activeTurn = token
  try {
    return await turnOwner.run(token, run)
  } finally {
    while (token.tools.size) await Promise.allSettled([...token.tools])
    if (activeTurn === token) activeTurn = undefined
  }
}

export const withExternalAgentTurn = async <T>(turn: ExternalAgentTurn, run: () => Promise<T>): Promise<T> => {
  if (eventListeners.has(turn.sessionId)) throw new Error('External session already has an active turn')
  eventListeners.set(turn.sessionId, turn.emit)
  try {
    return await externalTurns.run(turn, run)
  } finally {
    eventListeners.delete(turn.sessionId)
  }
}

export const emitExternalAgentEvent = (sessionId: string, event: ExternalAgentEvent): void => {
  eventListeners.get(sessionId)?.(event)
}

export const confirmAgentOperation = async (
  request: { title: string; input: unknown },
  localConfirmation: () => Promise<boolean>
): Promise<boolean> => {
  const turn = externalTurns.getStore()
  if (!turn) return await localConfirmation()
  if (turn.signal.aborted) return false
  const allowed = await turn.permission({ id: currentTool.getStore() || randomUUID(), ...request })
  return !turn.signal.aborted && allowed
}

export const observeAgentTool = async (
  title: string,
  options: { input: unknown; execute: () => Promise<string> }
): Promise<string> => {
  const { input, execute } = options
  const turn = externalTurns.getStore()
  const owner = turnOwner.getStore()
  const tracked = (): Promise<string> => {
    const pending = Promise.resolve().then(execute)
    owner?.tools.add(pending)
    void pending.finally(() => owner?.tools.delete(pending)).catch(() => undefined)
    return pending
  }
  if (!turn) return await tracked()
  if (turn.signal.aborted) throw new Error('Agent turn cancelled')
  const id = randomUUID()
  turn.emit({ type: 'tool', id, title, status: 'in_progress', input })
  try {
    const output = await currentTool.run(id, tracked)
    turn.emit({ type: 'tool', id, title, status: /^ERROR:/.test(output) ? 'failed' : 'completed', output })
    return output
  } catch (error) {
    turn.emit({ type: 'tool', id, title, status: 'failed', output: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export const assertAgentIdle = (): void => {
  if (activeTurn && turnOwner.getStore() !== activeTurn) {
    throw new Error('Maestro is busy with another turn. Retry when it completes.')
  }
}

export const assertExternalTurnActive = (): void => {
  if (externalTurns.getStore()?.signal.aborted) throw new Error('Agent turn cancelled')
}

export const drainAgentTools = async (): Promise<void> => {
  const owner = turnOwner.getStore()
  while (owner?.tools.size) await Promise.allSettled([...owner.tools])
}
