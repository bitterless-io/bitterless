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
import { WORKFLOW_ENTRY_EXTENSIONS, isWorkflowEntryPath } from '../../../shared/workflowPackage'

export const WORKFLOW_DESCRIPTORS: WorkflowDescriptor[] = [
  { name: 'agent-task', description: 'One independent Agent task, run in the background and reported back into this chat.' },
  { name: 'plan-workflow', description: 'Turn a goal into a reviewable workflow plan. Produces a proposal only; it creates and runs nothing.' },
  { name: 'code-review', description: 'Review a diff from seven angles in parallel, verify every candidate, then rank. Advisory: it changes nothing.' },
  { name: 'research', description: 'Research a question against real sources with web search and fetch, then verify each claim before reporting it.' },
  { name: 'adversarial-review', description: 'Judge each finding with independent reviewers told to refute it; only findings that survive the agreement threshold are reported.' }
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
      // `isWorkflowEntryPath`, never a literal extension list. This gate said `.ts|.mts` — Kimchi's
      // Jiti extensions — while the engine moved to `workflow.mjs` and the scanner followed. Every
      // local package therefore listed correctly, showed its phases and source, and then refused to
      // start. The catalog and the gate have to read the same contract or the failure is invisible
      // on both sides.
      if (!isAbsolute(request.entry.path) || !isWorkflowEntryPath(request.entry.path)) {
        throw new Error(`Workflow file must be an absolute path ending in ${WORKFLOW_ENTRY_EXTENSIONS.join(', ')}.`)
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
    // The status bar renders the wait from the host's own registry, so it can never claim a chat is
    // waiting when no wait was registered, nor keep showing one that has fired or been cancelled.
    const waiting = this.waits.list(sessionId)
    if (!this.activity) return { ...snapshot, waiting }
    this.activity.update(snapshot.runs)
    return { ...snapshot, activity: this.activity.list(sessionId), waiting }
  }

  /** A sentence lands after its snapshot was already published; republish that same state. */
  private republishActivity(): void {
    if (this.closed) return
    void this.supervisor.list()
      .then(snapshot => { if (!this.closed) this.options.broadcast(this.withActivity(snapshot)) })
      .catch(error => console.warn('[workflow] snapshot not republished', String(error)))
  }

  /**
   * The user outranks a pending wait.
   *
   * Called when this chat starts a turn of its own, so the status bar stops showing a wait the user
   * has already overtaken, and no continuation fires behind their back.
   */
  cancelWait(sessionId: string): void {
    if (!this.waits.cancel(sessionId)) return
    this.republishActivity()
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
  /**
   * Run-level pause / resume / stop — what the task bar's run controls call.
   *
   * Ownership is checked here rather than in the XPC handler or the renderer: both the chat tool and
   * the task bar reach the supervisor through this method, so one check covers both callers and
   * neither can be the one that forgets.
   */
  async controlWorkflow(params: { sessionId: string; runId: string; action: 'pause' | 'resume' | 'stop' }) {
    assertWorkflowSession(params.sessionId)
    const runId = params.runId?.trim()
    if (!runId) throw new Error('An exact runId is required.')
    if (!['pause', 'resume', 'stop'].includes(params.action)) throw new Error('action must be pause, resume or stop.')
    const snapshot = await this.supervisor.list(params.sessionId)
    if (!snapshot.runs.some(run => run.id === runId)) throw new Error(`No run ${runId} in this chat.`)
    return this.supervisor.controlWorkflow({ sessionId: params.sessionId, runId, action: params.action })
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
  async listWorkflows() { return [...WORKFLOW_DESCRIPTORS.map((workflow) => ({ ...workflow, scope: 'builtin' as const, reference: `builtin:${workflow.name}`, entry: { kind: 'builtin' as const, name: workflow.name as WorkflowBuiltinName } })), ...await workflowLibraryRuntime.list()] }
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
        description: 'Refresh the workflow list. The installed packages are already in <available_workflows> in this message; call this only when the owner says they just added or changed one, or to see built-ins. One task represents one agent. Workflow agents have Pi read/bash/edit/write/grep/find/ls and policy-permitted, cancellable web_search/web_fetch. Host browser, skill, and integration tools are not available; missing required tool hints fail explicitly.',
        params: [],
        execute: async () => JSON.stringify(await this.listWorkflows())
      },
      {
        name: 'workflow_run',
        description: 'Start a built-in workflow or an explicitly requested local TypeScript workflow file in the background. Returns a run receipt immediately; completion is delivered into this chat automatically. The user may continue talking and run other workflows concurrently. Supply exactly one of name or path. Available host tools: web_search/web_fetch; browser, skill, and integration actions are unavailable. Workflow subagents cannot recursively start workflows.',
        params: [
          { name: 'name', description: 'An exact reference from the resident <available_workflows> catalog or from workflow_list — builtin:<name> or local:<folder>. Never guess a reference or choose between duplicate display names.' },
          { name: 'path', description: `Absolute path to a local workflow script (${WORKFLOW_ENTRY_EXTENSIONS.join('/')}) explicitly requested by the user.` },
          { name: 'input', required: true, description: 'Workflow task, target, and success criteria.' }
        ],
        timeoutMs: 60_000,
        execute: async (args) => {
          if (Boolean(args.name) === Boolean(args.path)) throw new Error('Supply exactly one of workflow name or path.')
          // Resolve through the catalog rather than parsing the reference string: a name that is no
          // longer installed fails here, saying so, instead of at load with a file error — and the
          // descriptor's own `entry` is what runs, so the two cannot disagree (⑤).
          const selected = args.name ? (await this.listWorkflows()).find(item => item.name === String(args.name) || item.reference === String(args.name)) : undefined
          if (args.name && !selected) throw new Error('That workflow is not installed. Call workflow_list for what is available.')
          const run = await this.startWorkflow({
            sessionId,
            entry: args.path ? { kind: 'file', path: String(args.path) } : selected!.entry!,
            input: String(args.input ?? '')
          })
          return JSON.stringify({ runId: run.id, name: run.name, status: run.status, background: true })
        }
      },
      {
        name: 'workflow_control',
        description: 'Pause, resume or stop a background workflow in this chat. Pausing keeps the run\'s journal, so resuming continues from where it stopped rather than restarting — the work already done is not repeated. Use workflow_tasks first to get the exact runId; never guess one. These act on a whole run: this engine has no per-Agent pause or stop.',
        params: [
          { name: 'action', required: true, description: 'pause, resume or stop.' },
          { name: 'runId', required: true, description: 'Exact run ID from workflow_tasks.' }
        ],
        execute: async args => {
          const action = String(args.action ?? '').trim()
          if (!['pause', 'resume', 'stop'].includes(action)) throw new Error('action must be pause, resume or stop.')
          const runId = String(args.runId ?? '').trim()
          // Resolved against THIS chat's runs, not passed straight through. A run ID is a plain
          // string the model can produce from anywhere — a scrolled-back transcript, another chat,
          // or nothing at all — and pausing a run the owner is watching in a different chat is not
          // an error this session could ever see. The per-agent tools this replaced checked the same
          // way; the run-level tool must not be the one that stops checking.
          const runs = (await this.listRuns({ sessionId })).runs
          if (!runs.some(run => run.id === runId)) throw new Error(`No run ${runId || '(none given)'} in this chat. Call workflow_tasks for the exact runId.`)
          return JSON.stringify(await this.supervisor.controlWorkflow({ sessionId, runId, action: action as 'pause' | 'resume' | 'stop' }))
        }
      },
      {
        name: 'workflow_tasks', description: 'List every Agent task in this chat, including exact runId and agentId, current work and status. Use these identifiers before controlling an Agent; never guess IDs.', params: [],
        execute: async () => JSON.stringify((await this.listRuns({ sessionId })).runs.map(run => ({ runId: run.id, name: run.name, status: run.status, agents: run.agents })))
      },
      // `workflow_steer` stood here: it re-instructed ONE running Agent mid-turn. The engine has no
      // per-agent channel to deliver that on, so it would have accepted the message and dropped it.
      // `workflow_pause` / `workflow_resume` / `workflow_stop_agent` stood here: per-AGENT controls
      // the retired engine supported. This engine's controls are run-level (workflow_control above),
      // so keeping them would offer the model three tools that cannot do anything — worse than not
      // having them, because the model would report success it never achieved.
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
      {
        name: 'workflow_wait',
        description: 'Declare that this chat is waiting for named background runs to finish. Returns IMMEDIATELY — it does not block and must not be polled. The status bar shows the user that this chat is waiting. End your turn right after calling it. The receipt says whether this host resumes the conversation by itself once they settle; do not promise more than it says. A new user message cancels the wait and is answered first.',
        params: [{ name: 'runIds', description: 'Comma-separated exact run IDs from workflow_tasks. Omit to wait for every running workflow in this chat.' }],
        execute: async args => {
          const requested = String(args.runIds ?? '').split(',').map(value => value.trim()).filter(Boolean)
          const snapshot = await this.supervisor.list()
          const outcome = this.waits.declare(sessionId, requested, snapshot.runs, Date.now())
          if (!outcome.ok) throw new Error(workflowWaitRejectionMessage(outcome))
          this.republishActivity()
          return workflowWaitReceipt(outcome.intent, snapshot.runs, Boolean(this.options.onWaitSatisfied))
        }
      }
    ]
  }
}
