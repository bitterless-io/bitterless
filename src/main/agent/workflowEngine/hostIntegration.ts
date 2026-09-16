import { app } from 'electron'
import { WorkflowWaitRegistry, workflowWaitReceipt, workflowWaitRejectionMessage, type WorkflowWaitSatisfied } from './workflowWait'
import { isAbsolute, join } from 'node:path'
import type { WorkflowApi, WorkflowBuiltinName, WorkflowDescriptor, WorkflowRunSnapshot, WorkflowSnapshot, WorkflowStartRequest } from '../../../shared/agentWorkflow.api'
import { workflowLibraryRuntime } from '../../workflowLibrary/workflowLibraryRuntime'
import type { AgentToolSpec } from '../runtime/agentRuntime.types'
import { runInAgentSession } from '../runtime/agentSessionContext'
import { modelIoLog } from '../runtime/modelIoLog'
import { WorkflowActivitySummaryService, type WorkflowActivityDeps } from './activitySummary'
import { WorkflowSupervisor } from './supervisor'
import type { WorkflowRuntimeConfig, WorkflowHostToolRequest } from './protocol'

export const WORKFLOW_DESCRIPTORS: WorkflowDescriptor[] = [
  { name: 'agent-task', description: 'One independent additional Agent task in this chat; does not change an existing workflow graph.' },
  { name: 'mini-demo', description: 'Three parallel analysis agents followed by an independent synthesis agent.' },
  { name: 'code-review', description: 'Review a PR, branch diff, ref range, or focused code target.' },
  { name: 'refactor-scout', description: 'Find small, defensible refactors without broad rewrites.' },
  { name: 'diagnose', description: 'Compare competing explanations for a bug or failing command.' },
  { name: 'perf-review', description: 'Investigate measured bottlenecks rather than performance guesses.' },
  { name: 'research', description: 'Research external evidence and independently verify claims.' },
  { name: 'plan-workflow', description: 'Turn a goal into a reviewable workflow plan. Produces a proposal only; it creates and runs nothing.' }
]

export interface WorkflowHostOptions {
  broadcast: ConstructorParameters<typeof WorkflowSupervisor>[0]['broadcast']
  onRunSettled?(run: WorkflowRunSnapshot): Promise<void>
  /** Start a fresh assistant turn in this chat because a declared wait was satisfied. */
  onWaitSatisfied?(satisfied: WorkflowWaitSatisfied): void | Promise<void>
  assertCanStartShortcut?(sessionId: string, otherWorkflowSessions: string[]): void
  runtime(sessionId: string, cwd?: string): Promise<Omit<WorkflowRuntimeConfig, 'tools'> & { cwd: string }>
  tools(signal?: AbortSignal, onApproval?: (waiting: boolean) => void, sessionId?: string): AgentToolSpec[]
  /** Optional one-sentence status summarizer; without it the snapshot carries counts only. */
  activity?: Pick<WorkflowActivityDeps, 'runtime' | 'target' | 'debounceMs' | 'minIntervalMs' | 'deadlineMs'>
}

/** Each tool has a separate ALS owner. A subagent must never cancel its parent chat's resources. */
export const workflowToolScope = (request: Pick<WorkflowHostToolRequest, 'runId' | 'agentId'>): string =>
  `workflow:${request.runId}:${request.agentId}`

export const assertWorkflowSession = (sessionId: string): string => {
  if (!sessionId?.trim() || sessionId === 'default' || sessionId.startsWith('workflow:')) {
    throw new Error('A workflow requires an explicit chat session.')
  }
  return sessionId.trim()
}

export class WorkflowHostIntegration implements WorkflowApi {
  private readonly supervisor: WorkflowSupervisor
  private readonly waits = new WorkflowWaitRegistry()
  private readonly activity: WorkflowActivitySummaryService | null
  private closed = false
  private readonly retrying = new Map<string, Promise<WorkflowRunSnapshot>>()
  private readonly stopping = new Set<string>()
  private readonly starting = new Map<string, Set<Promise<WorkflowRunSnapshot>>>()

  constructor(private readonly options: WorkflowHostOptions) {
    this.activity = options.activity
      ? new WorkflowActivitySummaryService({ ...options.activity, onUpdated: () => this.republishActivity() })
      : null
    this.supervisor = new WorkflowSupervisor({
      workflowWorkerPath: join(__dirname, 'workflow-engine.worker.mjs'),
      agentWorkerPath: join(__dirname, 'workflow-agent.worker.mjs'),
      storageDir: join(app.getPath('userData'), 'workflow-runs'),
      broadcast: snapshot => {
        options.broadcast(this.withActivity(snapshot))
        this.deliverSettled(snapshot.runs)
      },
      recordIo: (sessionId, line) => {
        // Resource ownership uses workflow:<run>:<agent>; diagnostics belong to the chat.
        void runInAgentSession(sessionId, async () => modelIoLog.append(line)).catch(() => undefined)
      },
      executeTool: (request, signal) => this.executeTool(request, signal)
    })
  }

  private async executeTool(request: WorkflowHostToolRequest, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    return runInAgentSession(workflowToolScope(request), async () => {
      const tool = this.options.tools(signal, (waiting) => {
        this.supervisor.setAgentStatus(request.sessionId, request.runId, request.agentId,
          waiting ? 'approval' : 'running', waiting ? `Awaiting approval: ${request.toolName}` : request.toolName)
      }, request.sessionId).find((candidate) => candidate.name === request.toolName)
      if (!tool || !['web_search', 'web_fetch'].includes(tool.name)) {
        throw new Error(`Workflow host tool is unavailable or cannot be cancelled safely: ${request.toolName}`)
      }
      // The underlying fetch receives this signal. Await its actual completion; no Promise.race.
      const result = await tool.execute(request.args)
      signal.throwIfAborted()
      return result
    })
  }

  async retryWorkflow(params: { sessionId: string; runId: string }): Promise<WorkflowRunSnapshot> {
    const sessionId = assertWorkflowSession(params.sessionId)
    const key = JSON.stringify([sessionId, params.runId])
    const existing = this.retrying.get(key)
    if (existing) return existing
    if (this.closed || this.stopping.has(sessionId)) throw new Error('The workflow host or chat is stopping.')
    const pending = this.supervisor.retryRequest(sessionId, params.runId).then(request => this.startInSession(request))
    this.retrying.set(key, pending)
    const starts = this.starting.get(sessionId) || new Set<Promise<WorkflowRunSnapshot>>()
    starts.add(pending)
    this.starting.set(sessionId, starts)
    try { return await pending }
    finally {
      if (this.retrying.get(key) === pending) this.retrying.delete(key)
      starts.delete(pending)
      if (!starts.size) this.starting.delete(sessionId)
    }
  }

  async startWorkflow(request: WorkflowStartRequest): Promise<WorkflowRunSnapshot> {
    const sessionId = assertWorkflowSession(request.sessionId)
    if (this.closed || this.stopping.has(sessionId)) throw new Error('The workflow host or chat is stopping.')
    const pending = this.startInSession({ ...request, sessionId })
    const starts = this.starting.get(sessionId) || new Set<Promise<WorkflowRunSnapshot>>()
    starts.add(pending)
    this.starting.set(sessionId, starts)
    try { return await pending }
    finally {
      starts.delete(pending)
      if (!starts.size) this.starting.delete(sessionId)
    }
  }

  private async startInSession(request: WorkflowStartRequest): Promise<WorkflowRunSnapshot> {
    if (request.entry?.kind === 'library') request = { ...request, entry: await workflowLibraryRuntime.resolve(request.entry.ref) }
    const sessionId = request.sessionId
    if (!request.input?.trim()) throw new Error('Workflow input is required.')
    const entry = request.entry
    if (entry?.kind === 'builtin') {
      if (!WORKFLOW_DESCRIPTORS.some((workflow) => workflow.name === entry.name)) throw new Error('Unknown built-in workflow.')
    } else if (request.entry?.kind === 'file') {
      if (!isAbsolute(request.entry.path) || !/\.(?:ts|mts)$/.test(request.entry.path)) {
        throw new Error('Workflow file must be an absolute .ts or .mts path.')
      }
      await workflowLibraryRuntime.assertPath(request.entry.path)
    } else throw new Error('A built-in name or workflow file is required.')
    if (request.origin === 'shortcut') await this.assertShortcutAvailable(sessionId)
    const { cwd, ...runtime } = await this.options.runtime(sessionId, request.origin === 'shortcut' ? undefined : request.cwd)
    if (request.origin === 'shortcut') await this.assertShortcutAvailable(sessionId)
    if (request.entry.kind === 'file') await workflowLibraryRuntime.assertPath(request.entry.path)
    if (this.closed || this.stopping.has(sessionId)) throw new DOMException('Workflow stopped before startup completed.', 'AbortError')
    const tools = this.options.tools().map(({ name, description, params, timeoutMs }) => ({ name, description, params, timeoutMs }))
    return this.supervisor.start({ ...request, sessionId, cwd }, { ...runtime, tools })
  }

  private async assertShortcutAvailable(sessionId: string): Promise<void> {
    if (!this.options.assertCanStartShortcut) throw new Error('Workflow shortcuts are unavailable in this host.')
    const snapshot = await this.supervisor.list()
    const live = snapshot.runs.filter(run => run.status === 'running' || run.status === 'stopping')
    const others = [...new Set([...live.map(run => run.sessionId), ...this.starting.keys()])].filter(id => id !== sessionId)
    this.options.assertCanStartShortcut(sessionId, others)
  }

  /** Every published snapshot carries the current per-chat activity, including an empty list. */
  private withActivity(snapshot: WorkflowSnapshot, sessionId?: string): WorkflowSnapshot {
    if (!this.activity) return snapshot
    this.activity.update(snapshot.runs)
    return { ...snapshot, activity: this.activity.list(sessionId) }
  }

  /** A sentence lands after its snapshot was already published; republish that same state. */
  private republishActivity(): void {
    if (this.closed || !this.activity) return
    void this.supervisor.list()
      .then(snapshot => { if (!this.closed) this.options.broadcast(this.withActivity(snapshot)) })
      .catch(error => console.warn('[workflow] activity summary not published', String(error)))
  }

  private deliverSettled(runs: WorkflowRunSnapshot[]): void {
    for (const run of runs) if (run.status !== 'running' && run.status !== 'stopping') {
      // Persisted terminal snapshots are the durable outbox. The consumer deduplicates by run ID.
      void this.options.onRunSettled?.(structuredClone(run)).catch(error => console.warn('[workflow] completion delivery deferred', run.id, String(error)))
    }
    // A satisfied wait is removed as it fires, so a repeated snapshot cannot continue a chat twice.
    for (const satisfied of this.waits.settle(runs)) {
      void Promise.resolve(this.options.onWaitSatisfied?.({ sessionId: satisfied.sessionId, runs: satisfied.runs.map(run => structuredClone(run)) }))
        .catch(error => console.warn('[workflow] chat continuation not started', satisfied.sessionId, String(error)))
    }
  }
  async listRuns(params?: { sessionId?: string }) {
    const snapshot = await this.supervisor.list(params?.sessionId)
    this.deliverSettled(snapshot.runs)
    // A filtered listing must not retire other chats' activity, so update from the full snapshot.
    if (!this.activity || !params?.sessionId) return this.withActivity(snapshot)
    const full = await this.supervisor.list()
    this.activity.update(full.runs)
    return { ...snapshot, activity: this.activity.list(params.sessionId) }
  }
  private async requireAgent(params: { sessionId: string; runId: string; agentId: string }): Promise<void> {
    assertWorkflowSession(params.sessionId)
    if (!params.runId?.trim() || !params.agentId?.trim()) throw new Error('Exact runId and agentId are required.')
    const snapshot = await this.supervisor.list(params.sessionId)
    if (!snapshot.runs.some(run => run.id === params.runId && run.agents.some(agent => agent.id === params.agentId))) throw new Error('Agent does not belong to this chat.')
  }
  async pauseWorkflowAgent(params: { sessionId: string; runId: string; agentId: string }) {
    await this.requireAgent(params)
    await this.supervisor.pauseAgent(params.sessionId, params.runId, params.agentId)
    return { ok: true as const }
  }
  async resumeWorkflowAgent(params: { sessionId: string; runId: string; agentId: string }) {
    await this.requireAgent(params)
    await this.supervisor.resumeAgent(params.sessionId, params.runId, params.agentId)
    return { ok: true as const }
  }
  async listWorkflows() { return [...WORKFLOW_DESCRIPTORS.map((workflow) => ({ ...workflow, scope: 'shared' as const, ref: `shared:builtin:${workflow.name}` })), ...await workflowLibraryRuntime.list()] }
  async steerWorkflowAgent(params: { sessionId: string; runId: string; agentId: string; message: string }) {
    await this.requireAgent(params)
    if (!params.message?.trim()) throw new Error('A steering instruction is required.')
    await this.supervisor.steerAgent(params.sessionId, params.runId, params.agentId, params.message.trim())
    return { ok: true as const }
  }
  async stopAgent(params: { sessionId: string; runId: string; agentId: string }) {
    await this.requireAgent(params)
    await this.supervisor.stopAgent(assertWorkflowSession(params.sessionId), params.runId, params.agentId)
    return { ok: true as const }
  }
  async stopWorkflow(params: { sessionId: string; runId: string }) {
    await this.supervisor.stopRun(assertWorkflowSession(params.sessionId), params.runId)
    return { ok: true as const }
  }
  async stopSession(params: { sessionId: string }) {
    const sessionId = assertWorkflowSession(params.sessionId)
    this.stopping.add(sessionId)
    try {
      await Promise.all([
        this.supervisor.stopSession(sessionId),
        ...[...this.starting.get(sessionId) || []].map((pending) => pending.catch(() => undefined))
      ])
      // A start already inside the supervisor may have published while the first stop drained.
      await this.supervisor.stopSession(sessionId)
      return { ok: true as const }
    } finally { this.stopping.delete(sessionId) }
  }
  async dispose() {
    this.closed = true
    this.activity?.dispose()
    await Promise.all([this.supervisor.dispose(), ...[...this.starting.values()].flatMap((starts) => [...starts].map((pending) => pending.catch(() => undefined)))])
  }

  chatTools(sessionId: string): AgentToolSpec[] {
    return [
      {
        name: 'workflow_list',
        description: 'List the available TypeScript workflows. One task represents one agent. Workflow agents have Pi read/bash/edit/write/grep/find/ls and policy-permitted, cancellable web_search/web_fetch. Host browser, skill, and integration tools are not available; missing required tool hints fail explicitly.',
        params: [],
        execute: async () => JSON.stringify(await this.listWorkflows())
      },
      {
        name: 'workflow_run',
        description: 'Start a built-in workflow or an explicitly requested local TypeScript workflow file in the background. Returns a run receipt immediately; completion is delivered into this chat automatically. The user may continue talking and run other workflows concurrently. Supply exactly one of name or path. Available host tools: web_search/web_fetch; browser, skill, and integration actions are unavailable. Workflow subagents cannot recursively start workflows.',
        params: [
          { name: 'name', description: 'A built-in name or exact shared:<id> / institution:<institution_id>:<id> reference from workflow_list. Never guess scope or choose between duplicate display names.' },
          { name: 'path', description: 'Absolute path to a local .ts or .mts workflow file explicitly requested by the user.' },
          { name: 'input', required: true, description: 'Workflow task, target, and success criteria.' }
        ],
        timeoutMs: 60_000,
        execute: async (args) => {
          if (Boolean(args.name) === Boolean(args.path)) throw new Error('Supply exactly one of workflow name or path.')
          const run = await this.startWorkflow({
            sessionId,
            entry: args.path ? { kind: 'file', path: String(args.path) } : String(args.name).startsWith('shared:builtin:') ? { kind: 'builtin', name: String(args.name).slice(15) as WorkflowBuiltinName } : /^(shared|institution):/.test(String(args.name)) ? { kind: 'library', ref: String(args.name) } : { kind: 'builtin', name: String(args.name) as WorkflowBuiltinName },
            input: String(args.input ?? '')
          })
          return JSON.stringify({ runId: run.id, name: run.name, status: run.status, background: true })
        }
      },
      {
        name: 'workflow_tasks', description: 'List every Agent task in this chat, including exact runId and agentId, current work and status. Use these identifiers before controlling an Agent; never guess IDs.', params: [],
        execute: async () => JSON.stringify((await this.listRuns({ sessionId })).runs.map(run => ({ runId: run.id, name: run.name, status: run.status, agents: run.agents })))
      },
      {
        name: 'workflow_steer', description: 'Update the instructions of one exact active Agent in this chat. Preserves its conversation and delivers at a safe model/tool boundary; while paused the instruction waits until resume. List tasks first and route the user intent to the relevant task.',
        params: [{ name: 'runId', required: true }, { name: 'agentId', required: true }, { name: 'message', required: true }],
        execute: async args => JSON.stringify(await this.steerWorkflowAgent({ sessionId, runId: String(args.runId ?? ''), agentId: String(args.agentId ?? ''), message: String(args.message ?? '') }))
      },
      ...(['pause', 'resume', 'stop_agent'] as const).map(action => ({
        name: 'workflow_' + action,
        description: action === 'pause' ? 'Cooperatively pause one exact Agent, preserving its conversation. Pausing waits for an active model request or tool to finish, then no further model/tool/dependent step runs until resumed. Does not instantly suspend an external command.' : action === 'resume' ? 'Resume the same paused Agent conversation and remaining timeout budget.' : 'Stop one exact Agent in this chat. Other Agents and the main chat continue.',
        params: [{ name: 'runId', required: true }, { name: 'agentId', required: true }],
        execute: async (args: Record<string, unknown>) => {
          const target = { sessionId, runId: String(args.runId ?? ''), agentId: String(args.agentId ?? '') }
          const result = action === 'pause' ? await this.pauseWorkflowAgent(target) : action === 'resume' ? await this.resumeWorkflowAgent(target) : await this.stopAgent(target)
          return JSON.stringify(result)
        }
      })),
      {
        name: 'workflow_add_task', description: 'Start one additional independent Agent task in this chat and return immediately. Optionally reference an existing run as context. This creates a separate single-Agent run and does not modify the executing workflow graph; its result is delivered into the main chat.',
        params: [{ name: 'input', required: true, description: 'Specific task, constraints, evidence and expected result.' }, { name: 'parentRunId', description: 'Optional exact run ID in this chat to use as context.' }],
        execute: async (args) => {
          const input = String(args.input ?? '').trim()
          if (!input) throw new Error('An additional Agent task requires input.')
          let context = ''
          if (args.parentRunId) {
            const parent = (await this.supervisor.list(sessionId)).runs.find(run => run.id === args.parentRunId)
            if (!parent) throw new Error('Parent workflow does not belong to this chat.')
            context = '\nRelated workflow (context only): ' + parent.name + ' (' + parent.id + ')\nOriginal task: ' + parent.input
          }
          const run = await this.startWorkflow({ sessionId, entry: { kind: 'builtin', name: 'agent-task' }, input: input + context })
          return JSON.stringify({ runId: run.id, name: run.name, status: run.status, background: true })
        }
      },
      // Only offered where a settled wait can actually continue the chat. A tool that promises the
      // conversation will resume on its own, in an app that cannot resume it, is worse than absent.
      ...(this.options.onWaitSatisfied ? [{
        name: 'workflow_wait',
        description: 'Declare that this chat should continue once named background runs finish. Returns IMMEDIATELY — it does not block and must not be polled. End your turn right after calling it, saying which workflows you are waiting for; when they all settle this chat continues on its own with their real outcomes. A new user message cancels the wait and is answered first.',
        params: [{ name: 'runIds', description: 'Comma-separated exact run IDs from workflow_tasks. Omit to wait for every running workflow in this chat.' }],
        execute: async args => {
          const requested = String(args.runIds ?? '').split(',').map(value => value.trim()).filter(Boolean)
          const snapshot = await this.supervisor.list()
          const outcome = this.waits.declare(sessionId, requested, snapshot.runs, Date.now())
          if (!outcome.ok) throw new Error(workflowWaitRejectionMessage(outcome))
          return workflowWaitReceipt(outcome.intent, snapshot.runs)
        }
      }] : [])
    ]
  }
}
