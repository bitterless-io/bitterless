import { PauseGate } from './pauseGate'
import { describeSchemaViolations, parsePath, type AgentRequest, type AgentSession, type HostPort, type RunEvent } from '@kimchi-dev/kimchi-workflows/engine'
import type { AgentStep, WorkflowDefinition, WorkflowNode } from '@kimchi-dev/kimchi-workflows/flow'
import type { WorkflowAgentTask, WorkflowRunSnapshot, WorkflowStartRequest } from '../../../shared/agentWorkflow.api'
import { desktopAgentOptions, type AgentOutcome } from './author'
import { renderResult, type AgentTurnResult, type WorkerCommand, type WorkerEvent, type WorkflowEngineRuntime } from './protocol'
import { restoreWorkerError } from './workerErrors'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
interface Attempt {
  id: string
  row: WorkflowAgentTask
  closed: ReturnType<typeof deferred<void>>
  turn?: ReturnType<typeof deferred<AgentTurnResult>>
  turnId?: string
  closing: boolean
  ended: boolean
  timedOut: boolean
  timer?: ReturnType<typeof setTimeout>
  remainingMs: number
  timerStartedAt?: number
}
interface HostSession { row: WorkflowAgentTask; close: () => Promise<void> }
const outcomeTurn = (outcome: AgentOutcome): AgentTurnResult => ({ text: '', submitted: { tool: 'workflow_submit_result', arguments: { result: outcome } } })
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const staticPath = (path: string): string => parsePath(path).map(segment => segment.name).join('/')

/** Kimchi HostPort owns Agent RPC; Electron main remains the resource-cleanup authority. */
export class KimchiHost implements HostPort {
  private rowSequence = 0
  private attemptSequence = 0
  private liveAttempts = 0
  private readonly rows = new Map<string, WorkflowAgentTask>()
  private readonly steps = new Map<string, AgentStep>()
  private readonly nodes = new Map<string, WorkflowNode>()
  private readonly attempts = new Map<string, Attempt>()
  private readonly sessions = new Set<HostSession>()
  private readonly stopped = new Set<string>()
  private readonly pauses = new Map<string, PauseGate>()
  private readonly pauseRequested = new Set<string>()
  private readonly pathCleanup = new Map<string, Promise<void>>()
  private readonly submissionErrors = new Map<string, string>()
  constructor(
    private readonly workflow: WorkflowDefinition,
    private readonly request: WorkflowStartRequest,
    private readonly run: WorkflowRunSnapshot,
    private readonly runtime: WorkflowEngineRuntime,
    private readonly signal: AbortSignal,
    private readonly send: (event: WorkerEvent) => void
  ) {
    const visit = (nodes: readonly WorkflowNode[], parent: string[]) => {
      for (const node of nodes) {
        const name = node.kind === 'step' ? node.step.name : node.name
        const path = [...parent, name]
        this.nodes.set(path.join('/'), node)
        if (node.kind === 'step' && node.step.kind === 'agent') this.steps.set(path.join('/'), node.step)
        else if (node.kind === 'parallel') for (const step of node.arms) {
          if (step.kind === 'agent') this.steps.set([...path, step.name].join('/'), step)
        }
        else if (node.kind === 'branch') for (const arm of node.arms) visit(arm.body.nodes, [...parent, arm.name])
        else if (node.kind === 'workflow') visit(node.workflow.nodes, path)
        else if (node.kind === 'foreach' || node.kind === 'loop') visit(node.body.nodes, path)
      }
    }
    visit(workflow.nodes, [])
  }
  generateRunId(): string { return this.run.id }
  now(): Date { return new Date() }
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, ms)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }
  private publish(row: WorkflowAgentTask): void { this.send({ type: 'agent.update', agent: { ...row, logs: [...row.logs] } }) }
  private row(path: string): WorkflowAgentTask | undefined {
    const existing = this.rows.get(path)
    if (existing) return existing
    const step = this.steps.get(staticPath(path))
    if (!step) return undefined
    const options = desktopAgentOptions(step.outputSchema)
    const row: WorkflowAgentTask = { id: String(++this.rowSequence), runId: this.run.id, sessionId: this.request.sessionId, label: options?.label ?? step.name, phase: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : this.workflow.name, prompt: '', status: 'queued', currentAction: '等待运行', queuedAt: Date.now(), logs: [] }
    this.rows.set(path, row); this.publish(row)
    return row
  }
  private log(row: WorkflowAgentTask, text: string): void { row.logs.push({ ts: Date.now(), text }); row.logs = row.logs.slice(-40); this.publish(row) }
  async emit(event: RunEvent): Promise<void> {
    if (!('path' in event) || !event.path) return
    if (event.type === 'node-started' && event.nodeKind === 'parallel') {
      const node = this.nodes.get(staticPath(event.path))
      if (node?.kind === 'parallel') for (const step of node.arms) if (step.kind === 'agent') this.row(`${event.path}/${step.name}`)
    }
    if (event.type === 'foreach-started') {
      const node = this.nodes.get(staticPath(event.path))
      // Publish immediate Agent items before the engine admits them to its concurrency pool.
      if (node?.kind === 'foreach') for (let index = 0; index < event.count; index++) {
        for (const child of node.body.nodes) if (child.kind === 'step' && child.step.kind === 'agent') this.row(`${event.path}@${index}/${child.step.name}`)
      }
    }
    const row = this.row(event.path)
    if (!row) return
    if (event.type === 'step-retry' || event.type === 'agent-steer') {
      if (!this.stopped.has(row.id)) { row.status = 'retrying'; row.currentAction = event.type === 'agent-steer' ? '修复输出格式…' : '等待重试…' }
      this.log(row, event.type === 'agent-steer' ? `输出修复：${this.submissionErrors.get(event.path) ?? event.violation}` : `重试：${event.error}`)
    } else if (event.type === 'step-log') this.log(row, event.message)
    else if (event.type === 'step-completed' || event.type === 'step-failed' || event.type === 'step-cancelled') {
      // Kimchi dispose() is synchronous; defer visible completion until the supervisor ACKs cleanup.
      await this.pathCleanup.get(event.path)
      const output = event.type === 'step-completed' ? event.output : undefined
      const outcome = desktopAgentOptions(this.steps.get(staticPath(event.path))?.outputSchema) ? output as AgentOutcome | undefined : undefined
      row.status = this.stopped.has(row.id) || outcome?.status === 'stopped' || event.type === 'step-cancelled'
        ? 'stopped' : event.type === 'step-failed' || outcome?.status === 'failed' ? 'failed' : 'completed'
      row.error = event.type === 'step-failed' ? event.error : outcome && outcome.status !== 'completed' ? outcome.error : undefined
      row.output = output === undefined ? undefined : renderResult(output)
      row.currentAction = row.status === 'completed' ? '已完成' : row.status === 'stopped' ? '已停止' : '执行失败'
      row.endedAt = Date.now(); this.publish(row)
    }
  }
  private pauseGate(id: string): PauseGate {
    let gate = this.pauses.get(id)
    if (!gate) { gate = new PauseGate(this.signal); this.pauses.set(id, gate) }
    return gate
  }
  private armTimeout(attempt: Attempt): void {
    if (attempt.closing || attempt.ended || attempt.timer) return
    attempt.timerStartedAt = Date.now()
    attempt.timer = setTimeout(() => { attempt.timedOut = true; void this.closeAttempt(attempt) }, Math.max(1, attempt.remainingMs))
  }
  private freezeTimeout(attempt: Attempt): void {
    if (!attempt.timer) return
    clearTimeout(attempt.timer); attempt.timer = undefined
    attempt.remainingMs = Math.max(1, attempt.remainingMs - (Date.now() - (attempt.timerStartedAt ?? Date.now())))
  }
  stopAgent(id: string): void {
    this.pauseRequested.delete(id); this.pauseGate(id).resume()
    this.stopped.add(id)
    for (const session of this.sessions) if (session.row.id === id) void session.close()
  }
  handle(message: WorkerCommand): void {
    if (message.type === 'agent.pause') { this.pauseRequested.add(message.agentId); this.pauseGate(message.agentId).pause(); return }
    if (message.type === 'agent.resume') {
      this.pauseRequested.delete(message.agentId); this.pauseGate(message.agentId).resume()
      for (const attempt of this.attempts.values()) if (attempt.row.id === message.agentId) this.armTimeout(attempt)
      return
    }
    if (message.type === 'agent.pause.state') {
      if (message.paused && this.pauseRequested.has(message.agentId)) for (const attempt of this.attempts.values()) if (attempt.row.id === message.agentId) this.freezeTimeout(attempt)
      return
    }
    if (message.type === 'agent.stop') { this.stopAgent(message.agentId); return }
    if (message.type !== 'attempt.turn.result' && message.type !== 'attempt.result') return
    const attempt = this.attempts.get(message.id)
    if (!attempt) return
    if (message.type === 'attempt.turn.result') {
      if (attempt.closing || message.turnId !== attempt.turnId) return
      const turn = attempt.turn; attempt.turn = undefined
      if (message.error) turn?.reject(restoreWorkerError(message.error))
      else if (message.result) turn?.resolve(message.result)
      else turn?.reject(new Error('Agent worker returned no turn'))
      return
    }
    // Supervisor sends this only after the utility process, child trees and host tools are gone.
    attempt.ended = true; clearTimeout(attempt.timer); this.attempts.delete(message.id)
    attempt.closed.resolve()
    if (attempt.turn) {
      attempt.turn.reject(message.error ? restoreWorkerError(message.error) : new Error('Agent session closed'))
      attempt.turn = undefined
    }
  }
  private closeAttempt(attempt: Attempt | undefined): Promise<void> {
    if (!attempt) return Promise.resolve()
    if (!attempt.ended && !attempt.closing) {
      attempt.closing = true; clearTimeout(attempt.timer)
      this.send({ type: 'attempt.cancel', id: attempt.id })
    }
    return attempt.closed.promise
  }
  startAgent(request: AgentRequest): AgentSession {
    const row = this.row(request.path)
    if (!row) throw new Error(`Unknown Agent path: ${request.path}`)
    const options = desktopAgentOptions(request.outputSchema)
    const step = this.steps.get(staticPath(request.path))!
    const stopSignal = request.signal ?? this.signal
    let current: Attempt | undefined
    let firstPrompt: string | undefined
    let turns = 0
    let usedRetries = 0
    let disposed = false
    let conversation: readonly unknown[] = []
    const close = () => this.closeAttempt(current)
    const session: HostSession = { row, close }
    this.sessions.add(session)
    const abort = () => { void close() }
    stopSignal.addEventListener('abort', abort, { once: true })
    const cancelled = () => this.stopped.has(row.id)
    const unavailable = async (status: 'stopped' | 'failed', error: string): Promise<AgentTurnResult> => {
      await close()
      if (this.signal.aborted || stopSignal.aborted) return { text: '', cancelled: true }
      if (!options) {
        if (status === 'stopped') return { text: '', cancelled: true }
        throw new Error(error)
      }
      return outcomeTurn({ status, error })
    }
    const sendTurn = async (prompt: string): Promise<AgentTurnResult> => {
      if (disposed) throw new Error('Agent session is disposed')
      await this.pathCleanup.get(request.path)
      firstPrompt ??= prompt
      for (;;) {
        await this.pauseGate(row.id).checkpoint()
        if (stopSignal.aborted) { await close(); return { text: '', cancelled: true } }
        if (cancelled()) return unavailable('stopped', 'Agent stopped by user; result unavailable')
        try {
          if (current?.closing) { await close(); throw new Error('Agent attempt ended before the next turn') }
          let pending: Promise<AgentTurnResult>
          if (!current || current.ended) {
            if (++this.liveAttempts > 100) return unavailable('failed', 'Workflow exceeded 100 Agent attempts')
            const model = request.model?.split('/')
            const providerId = model?.shift() || this.runtime.providerId
            const modelId = model?.join('/') || this.runtime.modelId
            current = { id: `${row.id}:${++this.attemptSequence}`, row, closed: deferred<void>(), closing: false, ended: false, timedOut: false, remainingMs: options?.timeoutMs ?? 600_000 }
            this.attempts.set(current.id, current)
            this.armTimeout(current)
            row.status = 'running'; row.startedAt ??= Date.now(); row.currentAction = 'Thinking…'; row.prompt ||= firstPrompt; this.publish(row)
            current.turn = deferred<AgentTurnResult>(); current.turnId = `${current.id}:1`; turns = 1; pending = current.turn.promise
            this.send({ type: 'attempt.start', attempt: { id: current.id, rowId: Number(row.id), turnId: current.turnId, prompt: usedRetries ? firstPrompt : prompt, opts: { label: row.label, phase: row.phase, tools: options?.tools, thinkingLevel: options?.thinkingLevel, outputSchema: request.outputSchema, asks: request.asks }, providerId, modelId } })
          } else {
            current.turn = deferred<AgentTurnResult>(); current.turnId = `${current.id}:${++turns}`; pending = current.turn.promise
            const submissionError = this.submissionErrors.get(request.path)
            this.send({ type: 'attempt.turn', id: current.id, turnId: current.turnId, prompt: submissionError ? `${prompt}\n\nThe previous workflow_submit_result call was rejected:\n${submissionError}` : prompt })
          }
          const result = await pending
          await this.pauseGate(row.id).checkpoint()
          if (result.submissionError) this.submissionErrors.set(request.path, result.submissionError)
          else this.submissionErrors.delete(request.path)
          conversation = result.conversation ?? conversation
          if (cancelled()) return unavailable('stopped', 'Agent stopped by user; result unavailable')
          if (result.error) throw new Error(result.error.message)
          if (result.cancelled) return unavailable('stopped', 'Agent was interrupted')
          if (options && result.submitted?.tool === 'workflow_submit_result') {
            const submitted = result.submitted.arguments.result as { status?: unknown } | undefined
            if (submitted?.status !== 'completed') result.submitted = undefined
          }
          if (options && request.outputSchema) {
            const value = result.submitted?.tool === 'workflow_submit_result' ? result.submitted.arguments.result : undefined
            const violation = describeSchemaViolations(request.outputSchema, value)
            if (violation && turns > Math.max(0, step.maxOutputRepairs ?? 2)) return unavailable('failed', `Output repairs exhausted: ${result.submissionError ?? violation}`)
          }
          return result
        } catch (error) {
          const timeout = current?.timedOut
          await close()
          if (stopSignal.aborted) return { text: '', cancelled: true }
          if (cancelled()) return unavailable('stopped', 'Agent stopped by user; result unavailable')
          const reason = timeout ? `Agent exceeded ${options?.timeoutMs ?? 600_000}ms` : errorText(error)
          if (options && usedRetries < options.retries) {
            usedRetries++; current = undefined
            row.status = 'retrying'; row.currentAction = '等待重试…'; this.log(row, `重试 ${usedRetries}/${options.retries}（旧 attempt 已清理）：${reason}`)
            continue
          }
          return unavailable('failed', reason)
        }
      }
    }
    return {
      sendAndAwaitEnd: async (prompt, turnOptions) => {
        const result = await sendTurn(prompt)
        if (result.usage) turnOptions?.onUsage?.(result.usage)
        return result
      },
      getConversation: () => conversation,
      dispose: () => {
        if (disposed) return
        disposed = true; stopSignal.removeEventListener('abort', abort); this.sessions.delete(session)
        this.pathCleanup.set(request.path, close())
      }
    }
  }
  async drain(): Promise<void> {
    await Promise.all([...this.sessions].map(session => session.close()))
    await Promise.all(this.pathCleanup.values())
  }
  incompleteSummary(): string {
    const incomplete = [...this.rows.values()].filter(row => row.status === 'failed' || row.status === 'stopped')
    return incomplete.length ? `\n\n未完成的 Agent（结果不包含其结论）：${incomplete.map(row => `${row.label}（${row.status}）`).join('、')}` : ''
  }
}
