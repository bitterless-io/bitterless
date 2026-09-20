import { utilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { terminateOwnedProcesses } from './processTree'
import { isWorkflowAgentLive, type WorkflowLogEntry, type WorkflowRunSnapshot, type WorkflowSnapshot, type WorkflowStartRequest } from '../../../shared/agentWorkflow.api'
import { wireError, workflowEngineRuntime, type AgentAttemptRequest, type WorkerCommand, type WorkerEvent, type WorkflowHostToolRequest, type WorkflowRuntimeConfig, type WorkflowIoLine, type WireError } from './protocol'

export interface WorkflowChild {
  pid: number | undefined
  postMessage(message: WorkerCommand): void
  on(event: 'message', listener: (message: WorkerEvent) => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  once(event: 'spawn', listener: () => void): unknown
}
interface WorkerHandle {
  child: WorkflowChild
  exited: boolean
  exit: Promise<void>
  cleanup: Promise<void>
  owned: Map<number, boolean>
  ready: boolean
  stopRequested: boolean
  spawned: Promise<void>
  initial: WorkerCommand
  startTimer: ReturnType<typeof setTimeout>
  terminating?: Promise<void>
}
interface HostCall { controller: AbortController; completion: Promise<void> }
interface Attempt {
  request: AgentAttemptRequest
  worker: WorkerHandle
  calls: Map<string, HostCall>
  activeTurnId?: string
  finishing?: Promise<void>
  closing: boolean
}
interface LiveRun {
  request: WorkflowStartRequest
  runtime: WorkflowRuntimeConfig
  engine: WorkerHandle
  attempts: Map<string, Attempt>
  stoppedAgents: Set<string>
  pausedAgents: Set<string>
  steering: Map<string, string[]>
  closing: boolean
  stopRequested: boolean
  finishing?: Promise<void>
}
export interface WorkflowSupervisorDependencies {
  workflowWorkerPath: string
  agentWorkerPath: string
  storageDir: string
  recordIo?: (sessionId: string, line: WorkflowIoLine) => void
  broadcast: (snapshot: WorkflowSnapshot) => void
  executeTool: (request: WorkflowHostToolRequest, signal: AbortSignal) => Promise<string>
}
/** Process creation/signal seam permits deterministic lifecycle tests without launching Electron. */
export interface WorkflowSupervisorProcessDependencies {
  fork(path: string): WorkflowChild
  signal(pid: number, signal: NodeJS.Signals): void
  terminateOwnedProcesses?(owned: ReadonlyMap<number, boolean>): Promise<void>
  terminationGraceMs?: number
  terminationTimeoutMs?: number
}
const terminalRun = (run: WorkflowRunSnapshot): boolean => run.status !== 'running' && run.status !== 'stopping'
/**
 * 已终结 run 的保留条数。同仓先例:`MAX_FINISHED_TASKS = 20`(task.api.ts,taskRegistry 对已完成
 * task 用的就是这个形状)。
 *
 * 为什么必须有上限:`publish()` 把**全部** run clone + stringify + 落盘 + 广播,而它的调用点
 * 包含每条 agent 动作和每条日志行。`runs` 原本只增不减、且 `restore()` 跨重启整体读回,于是
 * 每条动作的代价 = O(全部历史字节数),随使用平方级增长。实测 4 个 run 就 95,550 字节。
 * 见 docs/issues/workflow-snapshot-republishes-all-history.md。
 */
const MAX_FINISHED_RUNS = 20
const limit = (text: string): string => text.slice(0, 64_000)
async function waitBounded(operation: Promise<void>, ms: number, message?: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([operation, new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => message ? reject(new Error(message)) : resolve(), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
/** Supervisor owns the durable log. Engine state snapshots only contribute entries. */
function mergeLogs(existing: readonly WorkflowLogEntry[], incoming: readonly WorkflowLogEntry[]): WorkflowLogEntry[] {
  const seen = new Set<string>()
  return [...existing, ...incoming].filter(entry => {
    const key = JSON.stringify([entry.ts, entry.text])
    if (seen.has(key)) return false
    seen.add(key); return true
  }).sort((left, right) => left.ts - right.ts).slice(-40).map(entry => ({ ts: entry.ts, text: limit(entry.text) }))
}

export class WorkflowSupervisor {
  private runs: WorkflowRunSnapshot[] = []
  private revision = 0
  private live = new Map<string, LiveRun>()
  private initialized: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  /** 最新一份待落盘内容。latest-wins —— 在途的旧快照会被下一份整个覆盖,留着只是浪费。 */
  private pendingContents: string | undefined
  private writing = false
  private changed = new Set<() => void>()
  private disposed = false
  private persistenceError: Error | undefined
  private processes: WorkflowSupervisorProcessDependencies

  constructor(private deps: WorkflowSupervisorDependencies, processes?: WorkflowSupervisorProcessDependencies) {
    this.processes = processes ?? {
      fork: path => utilityProcess.fork(path, [], { serviceName: 'Workflow', stdio: 'ignore' }),
      signal: (pid, signal) => process.kill(pid, signal)
    }
    this.initialized = this.restore()
  }

  private async restore(): Promise<void> {
    await mkdir(this.deps.storageDir, { recursive: true })
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.deps.storageDir, 'runs.json'), 'utf8'))
      if (!parsed || typeof parsed !== 'object' || !('runs' in parsed) || !Array.isArray(parsed.runs)) throw new Error('Invalid workflow snapshot file')
      this.runs = parsed.runs as WorkflowRunSnapshot[]
      for (const run of this.runs) {
        if (!terminalRun(run)) { run.status = 'failed'; run.error = '应用重启，工作流已中断'; run.endedAt = Date.now() }
        for (const agent of run.agents) if (isWorkflowAgentLive(agent.status)) { agent.status = 'failed'; agent.currentAction = '应用重启，Agent 已中断'; agent.error = run.error; agent.endedAt = Date.now() }
      }
      this.publish()
      await this.flush()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Worker messages have no authority to select the diagnostic chat/run/Agent owner. */
  private recordIo(run: WorkflowRunSnapshot, line: WorkflowIoLine, attempt?: AgentAttemptRequest, turnId?: string): void {
    try {
      this.deps.recordIo?.(run.sessionId, { ...line, detail: {
        source: 'workflow', sessionId: run.sessionId, runId: run.id, workflow: run.name,
        ...(attempt ? { agentId: String(attempt.rowId), attemptId: attempt.id, turnId, label: attempt.opts.label, phase: attempt.opts.phase, providerId: attempt.providerId, modelId: attempt.modelId } : {}),
        ...(line.detail === undefined ? {} : { data: line.detail })
      } })
    } catch { /* Diagnostics must not change workflow execution or cleanup. */ }
  }

  private snapshot(sessionId?: string): WorkflowSnapshot {
    return structuredClone({ runs: sessionId ? this.runs.filter(run => run.sessionId === sessionId) : this.runs, revision: this.revision })
  }
  /**
   * 淘汰最旧的已终结 run,把 `runs` 封在「未终结的全部 + 最近 MAX_FINISHED_RUNS 个已终结」。
   * **永不淘汰未终结的 run** —— 否则正在跑的 workflow 会从 UI 上消失。
   */
  private trimRuns(): void {
    if (this.runs.length <= MAX_FINISHED_RUNS) return
    const finished = this.runs.filter(terminalRun)
    if (finished.length <= MAX_FINISHED_RUNS) return
    const evict = new Set(finished.slice(0, finished.length - MAX_FINISHED_RUNS).map(run => run.id))
    this.runs = this.runs.filter(run => !evict.has(run.id))
  }

  private publish(): void {
    this.revision++
    this.trimRuns()
    const snapshot = this.snapshot()
    // latest-wins:只记住最新内容。原来是 `this.writes = this.writes.then(...)`,每次 append 一个
    // 链节、每个链节闭包捕获一份完整快照字符串 —— publish 快于磁盘时就按字节无界堆积。
    this.pendingContents = JSON.stringify(snapshot)
    this.scheduleWrite()
    this.deps.broadcast(snapshot)
    for (const notify of this.changed) notify()
  }

  /** 同一时刻最多一个在途写入;期间到达的 publish 只更新 `pendingContents`。 */
  private scheduleWrite(): void {
    if (this.writing) return
    this.writing = true
    this.writes = this.writes.then(async () => {
      const file = join(this.deps.storageDir, 'runs.json')
      try {
        while (this.pendingContents !== undefined) {
          const contents = this.pendingContents
          this.pendingContents = undefined
          await writeFile(`${file}.tmp`, contents, { mode: 0o600 })
          await rename(`${file}.tmp`, file)
        }
      } finally {
        this.writing = false
      }
    }).catch(error => { this.persistenceError = error instanceof Error ? error : new Error(String(error)) })
  }
  private async flush(): Promise<void> { await this.writes; if (this.persistenceError) throw this.persistenceError }
  async list(sessionId?: string): Promise<WorkflowSnapshot> { await this.initialized; return this.snapshot(sessionId) }

  async retryRequest(sessionId: string, runId: string): Promise<WorkflowStartRequest> {
    await this.initialized
    const run = this.runs.find(run => run.id === runId && run.sessionId === sessionId)
    if (!run || (run.status !== 'failed' && !(run.status === 'completed' && run.agents.some(agent => agent.status === 'failed'))) || this.live.has(runId)) throw new Error('Only a failed workflow or a completed workflow with failed Agents can be retried after cleanup.')
    if (!run.entry) throw new Error('This older workflow has no saved launch entry. Start it again with /workflow.')
    return { sessionId, entry: structuredClone(run.entry), input: run.input, origin: 'shortcut' }
  }

  async start(request: WorkflowStartRequest, runtime: WorkflowRuntimeConfig): Promise<WorkflowRunSnapshot> {
    await this.initialized
    if (this.disposed) throw new Error('Workflow supervisor is closed')
    if (!request.sessionId.trim()) throw new Error('Workflow requires a chat session')
    if (request.entry.kind === 'library') throw new Error('Workflow library references must be authorized and resolved before execution')
    const run: WorkflowRunSnapshot = { id: randomUUID(), sessionId: request.sessionId, name: request.entry.kind === 'builtin' ? request.entry.name : request.entry.path.split('/').pop() ?? 'workflow', entry: structuredClone(request.entry), input: request.input, status: 'running', createdAt: Date.now(), agents: [] }
    this.recordIo(run, { kind: 'note', name: 'workflow-start', turn: 0, subject: run.name, text: request.input, detail: { entry: request.entry, cwd: request.cwd } })
    this.runs.push(run); this.publish(); await this.flush()
    if (terminalRun(run) || this.disposed) return structuredClone(run)
    try {
      const engine = this.launch(this.deps.workflowWorkerPath, { type: 'engine.start', request, run: structuredClone(run), runtime: workflowEngineRuntime(runtime) }, event => this.engineEvent(run.id, event), () => {
        const live = this.live.get(run.id)
        if (live && !live.finishing) this.observe(this.finishRun(run.id, undefined, { name: 'WorkerExitError', message: 'Workflow process exited unexpectedly' }), run.id)
      })
      this.live.set(run.id, { request, runtime, engine, attempts: new Map(), stoppedAgents: new Set(), pausedAgents: new Set(), steering: new Map(), closing: false, stopRequested: false })
    } catch (error) {
      run.status = 'failed'; run.error = wireError(error).message; run.endedAt = Date.now()
      this.recordIo(run, { kind: 'note', name: 'workflow-end', turn: 0, subject: run.name, text: run.error, detail: { status: run.status } })
      this.publish(); await this.flush()
    }
    return structuredClone(run)
  }

  private launch(path: string, initial: WorkerCommand, onEvent: (event: WorkerEvent) => void, onExit: () => void): WorkerHandle {
    const child = this.processes.fork(path)
    let resolveExit!: () => void
    let resolveSpawn!: () => void
    let resolveCleanup!: () => void
    const handle: WorkerHandle = { child, exited: false, exit: new Promise(resolve => { resolveExit = resolve }), cleanup: new Promise(resolve => { resolveCleanup = resolve }), owned: new Map(), ready: false, stopRequested: false, spawned: new Promise(resolve => { resolveSpawn = resolve }), initial, startTimer: setTimeout(() => { if (!handle.ready) void this.terminate(handle).then(onExit, onExit) }, 30_000) }
    const runId = initial.type === 'engine.start' ? initial.run.id : initial.type === 'agent.start' ? initial.runId : ''
    const spawned = () => {
      if (child.pid !== undefined) resolveSpawn()
      if (handle.stopRequested && !handle.terminating) this.observe(this.terminate(handle), runId)
    }
    child.once('spawn', spawned)
    spawned()
    child.once('exit', () => { handle.exited = true; clearTimeout(handle.startTimer); resolveExit(); onExit() })
    child.on('message', event => {
      if (event.type === 'process.owned') {
        if (Number.isInteger(event.pid) && event.pid > 1 && event.pid !== process.pid) {
          handle.owned.set(event.pid, event.group)
          // A queued ownership event may arrive after exit or after a failed cleanup.
          if (handle.stopRequested && !handle.terminating) {
            this.observe(this.terminate(handle), runId)
          }
        }
        return
      }
      if (event.type === 'process.released') { handle.owned.delete(event.pid); return }
      if (handle.exited) return
      if (event.type === 'attempt.done' && initial.type === 'agent.start') resolveCleanup()
      if (event.type === 'ready') {
        spawned()
        if (handle.ready) return
        handle.ready = true; clearTimeout(handle.startTimer)
        if (!handle.stopRequested) {
          if (initial.type === 'agent.start' && this.live.get(initial.runId)?.pausedAgents.has(String(initial.attempt.rowId))) this.post(handle, { type: 'agent.pause', agentId: String(initial.attempt.rowId) })
          if (initial.type === 'agent.start') {
            const live = this.live.get(initial.runId), id = String(initial.attempt.rowId)
            for (const message of live?.steering.get(id) ?? []) this.post(handle, { type: 'agent.steer', agentId: id, message })
            live?.steering.delete(id)
          }
          this.post(handle, initial)
        }
      } else onEvent(event)
    })
    return handle
  }
  private post(worker: WorkerHandle, command: WorkerCommand): void {
    if (worker.stopRequested && (command.type === 'engine.start' || command.type === 'agent.start' || command.type === 'agent.turn')) return
    if (!worker.exited) { try { worker.child.postMessage(command) } catch { /* exit handler settles lifecycle */ } }
  }
  private signal(pid: number, signal: NodeJS.Signals): void {
    try { this.processes.signal(pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
  private async cleanOwned(worker: WorkerHandle, drain: boolean): Promise<void> {
    const cleanup = this.processes.terminateOwnedProcesses ?? terminateOwnedProcesses
    do {
      const batch = new Map(worker.owned)
      if (batch.size === 0) return
      await cleanup(batch)
      for (const [pid, group] of batch) if (worker.owned.get(pid) === group) worker.owned.delete(pid)
    } while (drain && worker.owned.size > 0)
  }
  private async terminateUtility(worker: WorkerHandle): Promise<void> {
    const timeout = this.processes.terminationTimeoutMs ?? 5000
    const grace = this.processes.terminationGraceMs ?? 250
    // fork can return before a PID exists. Stop remains pending until spawn or exit.
    if (!worker.exited && worker.child.pid === undefined) {
      await waitBounded(Promise.race([worker.spawned, worker.exit]), timeout, 'Workflow worker termination was not confirmed: waiting for spawn')
    }
    if (worker.exited) return
    const pid = worker.child.pid
    if (pid === undefined) throw new Error('Workflow worker termination was not confirmed: missing PID')
    this.signal(pid, 'SIGTERM')
    await waitBounded(worker.exit, grace)
    if (!worker.exited) this.signal(pid, 'SIGKILL')
    if (!worker.exited) await waitBounded(worker.exit, timeout, 'Workflow worker termination was not confirmed')
  }
  private terminate(worker: WorkerHandle): Promise<void> {
    if (worker.terminating) return worker.terminating
    worker.stopRequested = true
    clearTimeout(worker.startTimer)
    this.post(worker, { type: 'abort' })
    const operation = Promise.resolve().then(async () => {
      const failures: unknown[] = []
      // Give Pi abort/tool settlement/dispose a bounded chance before process-level escalation.
      if (worker.initial.type === 'agent.start' && worker.ready && !worker.exited) {
        await waitBounded(Promise.race([worker.cleanup, worker.exit]), this.processes.terminationGraceMs ?? 250)
      }
      // Reap registered trees before losing the utility parent; still kill it if tree cleanup fails.
      try { await this.cleanOwned(worker, false) } catch (error) { failures.push(error) }
      try { await this.terminateUtility(worker) } catch (error) { failures.push(error) }
      try { await this.cleanOwned(worker, true) } catch (error) { failures.push(error) }
      if (failures.length) throw new AggregateError(failures, failures.map(error => wireError(error).message).join('; '))
    })
    worker.terminating = operation
    const clear = () => { if (worker.terminating === operation) worker.terminating = undefined }
    void operation.then(clear, clear)
    return operation
  }

  /**
   * Run-level pause / resume / stop.
   *
   * The engine's controls are run-level; there is no per-agent equivalent, so this deliberately does
   * not take an agentId. Sent into the worker that owns the run — the manager lives there (Ral
   * 2026-09-20: main must not carry this work).
   */
  async controlWorkflow(params: { sessionId: string; runId: string; action: 'pause' | 'resume' | 'stop' }): Promise<{ ok: boolean; status: string }> {
    const run = this.runs.find(item => item.id === params.runId && item.sessionId === params.sessionId)
    if (!run) throw new Error('That workflow does not belong to this chat.')
    const live = this.live.get(params.runId)
    if (!live) throw new Error('That workflow is no longer running in this session.')
    this.post(live.engine, { type: `workflow.${params.action}` } as WorkerCommand)
    return { ok: true, status: run.status }
  }

  private engineEvent(runId: string, event: WorkerEvent): void {
    const live = this.live.get(runId), run = this.runs.find(item => item.id === runId)
    if (!live || !run || terminalRun(run)) return
    if (event.type === 'workflow.state') {
      // Run-level state from the managed run. `paused` is not terminal: the journal is intact and a
      // resume continues from the unchanged prefix, so the run stays in the live list.
      if (event.state === 'paused' && run.status === 'running') { run.status = 'paused'; this.publish() }
      else if (event.state === 'resumed' && run.status === 'paused') { run.status = 'running'; this.publish() }
      return
    }
    if (event.type === 'workflow.control') return
    if (event.type === 'agent.update') {
      if (event.agent.runId !== run.id || event.agent.sessionId !== run.sessionId) return
      const existing = run.agents.find(agent => agent.id === event.agent.id)
      const logs = mergeLogs(existing?.logs ?? [], event.agent.logs)
      if (existing && (!isWorkflowAgentLive(existing.status) || (existing.status === 'stopping' && isWorkflowAgentLive(event.agent.status)))) {
        // Upstream publishes its failure log just after the terminal state. Retain that log without reopening the Agent.
        if (JSON.stringify(existing.logs) !== JSON.stringify(logs)) { existing.logs = logs; this.publish() }
        return
      }
      const paused = live.pausedAgents.has(event.agent.id) && existing && (existing.status === 'pausing' || existing.status === 'paused')
      const row = { ...event.agent, ...(paused ? { status: existing.status, currentAction: existing.currentAction } : {}), prompt: limit(event.agent.prompt), output: event.agent.output ? limit(event.agent.output) : undefined, logs }
      if (existing) Object.assign(existing, row); else run.agents.push(row)
      this.publish()
    } else if (event.type === 'attempt.start') {
      if (live.closing || live.stoppedAgents.has(String(event.attempt.rowId))) {
        this.post(live.engine, { type: 'attempt.result', id: event.attempt.id, error: { name: 'WorkflowAgentStoppedError', message: 'Agent stopped by user' } }); return
      }
      this.startAttempt(run, live, event.attempt)
    } else if (event.type === 'attempt.turn') {
      const attempt = live.attempts.get(event.id)
      if (!attempt || attempt.closing || live.closing || live.stoppedAgents.has(String(attempt.request.rowId))) {
        this.post(live.engine, { type: 'attempt.turn.result', id: event.id, turnId: event.turnId, error: { name: 'WorkflowAgentStoppedError', message: 'Agent is no longer accepting turns' } }); return
      }
      if (attempt.activeTurnId) {
        this.post(live.engine, { type: 'attempt.turn.result', id: event.id, turnId: event.turnId, error: { name: 'WorkflowProtocolError', message: 'Agent already has an active turn' } }); return
      }
      attempt.activeTurnId = event.turnId
      this.recordIo(run, { kind: 'note', name: 'agent-dispatched', turn: 0, subject: attempt.request.opts.label ?? 'agent', text: event.prompt }, attempt.request, event.turnId)
      this.post(attempt.worker, { type: 'agent.turn', turnId: event.turnId, prompt: event.prompt })
    } else if (event.type === 'attempt.cancel') {
      const attempt = live.attempts.get(event.id)
      if (attempt) this.observe(this.finishAttempt(runId, event.id), runId)
    } else if (event.type === 'engine.done') this.observe(this.finishRun(runId, event.result, event.error), runId)
  }

  private startAttempt(run: WorkflowRunSnapshot, live: LiveRun, request: AgentAttemptRequest): void {
    this.recordIo(run, { kind: 'note', name: 'agent-dispatched', turn: 0, subject: request.opts.label ?? 'agent', text: request.prompt }, request, request.turnId)
    try {
      if (live.runtime.relay && (request.providerId !== live.runtime.relay.providerId || request.modelId !== live.runtime.relay.modelId)) throw new Error('AI-CRMS workflows must use the selected provider and model.')
      const worker = this.launch(this.deps.agentWorkerPath, { type: 'agent.start', request: live.request, runId: run.id, runtime: live.runtime, attempt: request }, event => this.attemptEvent(run.id, request.id, event), () => {
        const active = live.attempts.get(request.id)
        if (active && !active.finishing) this.observe(this.finishAttempt(run.id, request.id, undefined, { name: 'WorkerExitError', message: 'Agent process exited unexpectedly' }), run.id)
      })
      live.attempts.set(request.id, { request, worker, calls: new Map(), activeTurnId: request.turnId, closing: false })
    } catch (error) {
      this.recordIo(run, { kind: 'note', name: 'agent-end', turn: 0, subject: request.opts.label ?? 'agent', text: wireError(error).message, detail: { status: 'failed' } }, request, request.turnId)
      this.post(live.engine, { type: 'attempt.result', id: request.id, error: wireError(error) })
    }
  }

  private attemptEvent(runId: string, attemptId: string, event: WorkerEvent): void {
    const live = this.live.get(runId), attempt = live?.attempts.get(attemptId)
    const run = this.runs.find(item => item.id === runId)
    if (!live || !attempt || !run) return
    // Abort/cleanup can produce the final provider message after the stop request.
    if (event.type === 'agent.io') { this.recordIo(run, event.line, attempt.request, attempt.activeTurnId); return }
    if (event.type === 'tool.cancel') { attempt.calls.get(event.callId)?.controller.abort(); return }
    if (attempt.closing || live.closing) return
    if (event.type === 'agent.pause.state') {
      const agentId = String(attempt.request.rowId)
      if (event.agentId !== agentId || !live.pausedAgents.has(agentId)) return
      const agent = run.agents.find(item => item.id === agentId)
      if (event.paused && agent && agent.status === 'pausing') { agent.status = 'paused'; agent.currentAction = '已暂停'; this.publish() }
      this.post(live.engine, { type: 'agent.pause.state', agentId, paused: event.paused })
    } else if (event.type === 'agent.turn.done') {
      if (event.turnId !== attempt.activeTurnId) return
      attempt.activeTurnId = undefined
      this.post(live.engine, { type: 'attempt.turn.result', id: attemptId, turnId: event.turnId, result: event.result, error: event.error })
    } else if (event.type === 'attempt.done') this.observe(this.finishAttempt(runId, attemptId, event.result, event.error), runId)
    else if (event.type === 'usage') this.post(live.engine, { ...event, type: 'usage.record' })
    else if (event.type === 'agent.action') {
      const agent = run.agents.find(item => item.id === String(attempt.request.rowId))
      if (!agent || !isWorkflowAgentLive(agent.status) || agent.status === 'stopping' || agent.status === 'approval' || agent.status === 'pausing' || agent.status === 'paused') return
      agent.currentAction = limit(event.action)
      if (event.log) agent.logs = mergeLogs(agent.logs, [{ ts: Date.now(), text: limit(event.log) }])
      this.publish()
    } else if (event.type === 'tool.request') {
      if (event.request.runId !== runId || event.request.sessionId !== run.sessionId || event.request.agentId !== String(attempt.request.rowId)) return
      const descriptor = live.runtime.tools.find(tool => tool.name === event.request.toolName)
      if (!descriptor) { this.post(attempt.worker, { type: 'tool.result', callId: event.request.callId, error: 'Tool is not enabled for this workflow' }); return }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), descriptor.timeoutMs ?? 60_000)
      const completion = Promise.resolve().then(() => this.deps.executeTool(event.request, controller.signal)).then(result => {
        this.post(attempt.worker, { type: 'tool.result', callId: event.request.callId, result })
      }, error => { this.post(attempt.worker, { type: 'tool.result', callId: event.request.callId, error: wireError(error).message }) }).finally(() => { clearTimeout(timeout); attempt.calls.delete(event.request.callId) })
      attempt.calls.set(event.request.callId, { controller, completion })
    }
  }

  private finishAttempt(runId: string, id: string, result?: unknown, error?: WireError): Promise<void> {
    const live = this.live.get(runId), attempt = live?.attempts.get(id)
    if (!live || !attempt) return Promise.resolve()
    if (attempt.finishing) return attempt.finishing
    attempt.closing = true
    attempt.worker.stopRequested = true
    const operation = Promise.resolve().then(async () => {
      for (const call of attempt.calls.values()) call.controller.abort()
      await Promise.all([this.terminate(attempt.worker), ...[...attempt.calls.values()].map(call => call.completion)])
      live.attempts.delete(id)
      const stopped = live.stopRequested || live.stoppedAgents.has(String(attempt.request.rowId))
      const run = this.runs.find(item => item.id === runId)
      if (run) this.recordIo(run, { kind: 'note', name: 'agent-end', turn: 0, subject: attempt.request.opts.label ?? 'agent', text: error?.message ?? '', detail: { status: stopped ? 'stopped' : error ? 'failed' : 'closed' } }, attempt.request, attempt.activeTurnId)
      this.post(live.engine, { type: 'attempt.result', id, result, error: stopped ? { name: 'WorkflowAgentStoppedError', message: 'Agent stopped by user; result unavailable' } : error })
    }).catch(failure => {
      const run = this.runs.find(item => item.id === runId)
      if (run) { run.error = `停止尚未确认：${wireError(failure).message}`; this.publish() }
      throw failure
    })
    attempt.finishing = operation
    const clear = () => { if (attempt.finishing === operation) attempt.finishing = undefined }
    void operation.then(clear, clear)
    return operation
  }

  private finishRun(runId: string, result?: string, error?: WireError): Promise<void> {
    const live = this.live.get(runId), run = this.runs.find(item => item.id === runId)
    if (!live || !run) return Promise.resolve()
    if (live.finishing) return live.finishing
    live.closing = true
    live.engine.stopRequested = true
    for (const attempt of live.attempts.values()) attempt.worker.stopRequested = true
    const operation = Promise.resolve().then(async () => {
      // Stop residual siblings before recording the terminal run outcome.
      const attempts = await Promise.allSettled([...live.attempts.keys()].map(id => this.finishAttempt(runId, id)))
      const failures: unknown[] = attempts.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : [])
      try { await this.terminate(live.engine) } catch (failure) { failures.push(failure) }
      if (failures.length) throw new AggregateError(failures, failures.map(failure => wireError(failure).message).join('; '))
      const stopped = live.stopRequested || error?.name === 'WorkflowCancelledError'
      run.status = stopped ? 'stopped' : error ? 'failed' : 'completed'
      run.result = result === undefined ? undefined : limit(result); run.error = error?.message; run.endedAt = Date.now()
      for (const agent of run.agents) if (isWorkflowAgentLive(agent.status)) { agent.status = stopped ? 'stopped' : 'failed'; agent.currentAction = stopped ? '已停止' : '工作流已结束'; agent.endedAt = Date.now() }
      this.recordIo(run, { kind: 'note', name: 'workflow-end', turn: 0, subject: run.name, text: result ?? error?.message ?? '', detail: { status: run.status, error } })
      this.live.delete(runId); this.publish(); await this.flush()
    }).catch(failure => {
      if (!terminalRun(run)) { run.error = `资源清理尚未确认：${wireError(failure).message}`; this.publish() }
      throw failure
    })
    live.finishing = operation
    const clear = () => { if (live.finishing === operation) live.finishing = undefined }
    void operation.then(clear, clear)
    return operation
  }

  private observe(operation: Promise<void>, runId: string): void {
    void operation.catch(error => {
      const run = this.runs.find(item => item.id === runId)
      if (run && !terminalRun(run)) { run.error = `资源清理尚未确认：${wireError(error).message}`; this.publish() }
    })
  }

  private requireRun(sessionId: string, runId: string): WorkflowRunSnapshot {
    const run = this.runs.find(item => item.id === runId && item.sessionId === sessionId)
    if (!run) throw new Error('Workflow does not belong to this chat')
    return run
  }
  setAgentStatus(sessionId: string, runId: string, agentId: string, status: 'approval' | 'waiting' | 'running', currentAction: string): void {
    const run = this.requireRun(sessionId, runId), agent = run.agents.find(item => item.id === agentId)
    if (!agent || !isWorkflowAgentLive(agent.status) || agent.status === 'stopping' || agent.status === 'pausing' || agent.status === 'paused' || terminalRun(run)) return
    agent.status = status; agent.currentAction = currentAction; this.publish()
  }
  async steerAgent(sessionId: string, runId: string, agentId: string, message: string): Promise<void> {
    await this.initialized
    const run = this.requireRun(sessionId, runId), live = this.live.get(runId), agent = run.agents.find(item => item.id === agentId)
    if (!message?.trim()) throw new Error('A steering message is required')
    if (!live || !agent || !isWorkflowAgentLive(agent.status) || agent.status === 'stopping') throw new Error('Only an active or paused Agent can receive an update')
    const attempt = [...live.attempts.values()].find(item => String(item.request.rowId) === agentId && !item.closing)
    if (attempt?.worker.ready) this.post(attempt.worker, { type: 'agent.steer', agentId, message: message.trim() })
    else live.steering.set(agentId, [...live.steering.get(agentId) ?? [], message.trim()])
    agent.logs = mergeLogs(agent.logs, [{ ts: Date.now(), text: `补充任务：${message.trim()}` }]); this.publish(); await this.flush()
  }
  async pauseAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    await this.initialized
    const run = this.requireRun(sessionId, runId), live = this.live.get(runId), agent = run.agents.find(item => item.id === agentId)
    if (!agent) throw new Error('Unknown Agent in this workflow')
    if (!live || !isWorkflowAgentLive(agent.status) || agent.status === 'stopping') throw new Error('Only an active Agent can be paused')
    if (live.pausedAgents.has(agentId)) return
    live.pausedAgents.add(agentId)
    const attempts = [...live.attempts.values()].filter(attempt => String(attempt.request.rowId) === agentId && !attempt.closing)
    agent.status = attempts.length ? 'pausing' : 'paused'; agent.currentAction = attempts.length ? '等待当前操作结束后暂停…' : '已暂停'
    this.post(live.engine, { type: 'agent.pause', agentId })
    for (const attempt of attempts) this.post(attempt.worker, { type: 'agent.pause', agentId })
    this.publish(); await this.flush()
  }
  async resumeAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    await this.initialized
    const run = this.requireRun(sessionId, runId), live = this.live.get(runId), agent = run.agents.find(item => item.id === agentId)
    if (!agent) throw new Error('Unknown Agent in this workflow')
    if (!live || !live.pausedAgents.has(agentId)) throw new Error('This Agent is not paused')
    live.pausedAgents.delete(agentId)
    agent.status = agent.startedAt ? 'running' : 'queued'; agent.currentAction = '继续运行…'
    this.post(live.engine, { type: 'agent.resume', agentId })
    for (const attempt of live.attempts.values()) if (String(attempt.request.rowId) === agentId) this.post(attempt.worker, { type: 'agent.resume', agentId })
    this.publish(); await this.flush()
  }
  async stopAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    await this.initialized
    const run = this.requireRun(sessionId, runId), live = this.live.get(runId), agent = run.agents.find(item => item.id === agentId)
    if (!agent) throw new Error('Unknown Agent in this workflow')
    if (!live || !isWorkflowAgentLive(agent.status)) return
    live.pausedAgents.delete(agentId)
    live.stoppedAgents.add(agentId); agent.status = 'stopping'; agent.currentAction = '正在停止…'; this.publish()
    this.post(live.engine, { type: 'agent.stop', agentId })
    await Promise.all([...live.attempts.values()].filter(attempt => String(attempt.request.rowId) === agentId).map(attempt => this.finishAttempt(runId, attempt.request.id)))
    if (agent.status === 'stopping') { agent.status = 'stopped'; agent.currentAction = '已停止'; agent.endedAt = Date.now(); this.publish() }
    await this.flush()
  }
  async stopRun(sessionId: string, runId: string): Promise<void> {
    await this.initialized
    const run = this.requireRun(sessionId, runId)
    if (terminalRun(run)) return
    run.status = 'stopping'
    for (const agent of run.agents) if (isWorkflowAgentLive(agent.status)) { agent.status = 'stopping'; agent.currentAction = '正在停止…' }
    this.publish(); const live = this.live.get(runId)
    if (live) { live.stopRequested = true; this.post(live.engine, { type: 'abort' }) }
    else { run.status = 'stopped'; run.endedAt = Date.now(); this.publish(); await this.flush(); return }
    await this.finishRun(runId)
  }
  async stopSession(sessionId: string): Promise<void> {
    await this.initialized
    await Promise.all(this.runs.filter(run => run.sessionId === sessionId && !terminalRun(run)).map(run => this.stopRun(sessionId, run.id)))
  }
  private async waitUntil(predicate: () => boolean, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new Error('Wait aborted')
    if (predicate()) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.changed.delete(check); signal?.removeEventListener('abort', abort) }
      const check = () => { if (predicate()) { cleanup(); resolve() } }
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('Wait aborted')) }
      this.changed.add(check); signal?.addEventListener('abort', abort, { once: true }); check()
    })
  }
  async waitForRun(runId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot> {
    await this.initialized
    const run = this.runs.find(item => item.id === runId)
    if (!run) throw new Error('Unknown workflow')
    await this.waitUntil(() => terminalRun(run), signal)
    await this.flush()
    return structuredClone(run)
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.initialized
    await Promise.all(this.runs.filter(run => !terminalRun(run)).map(run => this.stopRun(run.sessionId, run.id)))
    await this.flush()
  }
}
