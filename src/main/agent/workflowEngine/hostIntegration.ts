import { app } from 'electron'
import { isAbsolute, join } from 'node:path'
import type { WorkflowApi, WorkflowDescriptor, WorkflowRunSnapshot, WorkflowStartRequest } from '../../../shared/agentWorkflow.api'
import type { AgentToolSpec } from '../runtime/agentRuntime.types'
import { runInAgentSession } from '../runtime/agentSessionContext'
import { modelIoLog } from '../runtime/modelIoLog'
import { WorkflowSupervisor } from './supervisor'
import type { WorkflowRuntimeConfig, WorkflowHostToolRequest } from './protocol'

export const WORKFLOW_DESCRIPTORS: WorkflowDescriptor[] = [
  { name: 'mini-demo', description: 'Three parallel analysis agents followed by an independent synthesis agent.' },
  { name: 'code-review', description: 'Review a PR, branch diff, ref range, or focused code target.' },
  { name: 'refactor-scout', description: 'Find small, defensible refactors without broad rewrites.' },
  { name: 'diagnose', description: 'Compare competing explanations for a bug or failing command.' },
  { name: 'perf-review', description: 'Investigate measured bottlenecks rather than performance guesses.' },
  { name: 'research', description: 'Research external evidence and independently verify claims.' }
]

export interface WorkflowHostOptions {
  broadcast: ConstructorParameters<typeof WorkflowSupervisor>[0]['broadcast']
  assertCanStartShortcut?(sessionId: string, otherWorkflowSessions: string[]): void
  runtime(sessionId: string, cwd?: string): Promise<Omit<WorkflowRuntimeConfig, 'tools'> & { cwd: string }>
  tools(signal?: AbortSignal, onApproval?: (waiting: boolean) => void, sessionId?: string): AgentToolSpec[]
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
  private closed = false
  private readonly stopping = new Set<string>()
  private readonly starting = new Map<string, Set<Promise<WorkflowRunSnapshot>>>()

  constructor(private readonly options: WorkflowHostOptions) {
    this.supervisor = new WorkflowSupervisor({
      workflowWorkerPath: join(__dirname, 'workflow-engine.worker.mjs'),
      agentWorkerPath: join(__dirname, 'workflow-agent.worker.mjs'),
      storageDir: join(app.getPath('userData'), 'workflow-runs'),
      broadcast: options.broadcast,
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

  async startWorkflow(request: WorkflowStartRequest): Promise<WorkflowRunSnapshot> {
    const sessionId = assertWorkflowSession(request.sessionId)
    if (this.closed || this.stopping.has(sessionId)) throw new Error('The workflow host or chat is stopping.')
    if (request.origin === 'shortcut' && this.starting.has(sessionId)) throw new Error('A workflow is already starting in this chat.')
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
    const sessionId = request.sessionId
    if (!request.input?.trim()) throw new Error('Workflow input is required.')
    const entry = request.entry
    if (entry?.kind === 'builtin') {
      if (!WORKFLOW_DESCRIPTORS.some((workflow) => workflow.name === entry.name)) throw new Error('Unknown built-in workflow.')
    } else if (request.entry?.kind === 'file') {
      if (!isAbsolute(request.entry.path) || !/\.(?:ts|mts)$/.test(request.entry.path)) {
        throw new Error('Workflow file must be an absolute .ts or .mts path.')
      }
    } else throw new Error('A built-in name or workflow file is required.')
    if (request.origin === 'shortcut') await this.assertShortcutAvailable(sessionId)
    const { cwd, ...runtime } = await this.options.runtime(sessionId, request.origin === 'shortcut' ? undefined : request.cwd)
    if (request.origin === 'shortcut') await this.assertShortcutAvailable(sessionId)
    if (this.closed || this.stopping.has(sessionId)) throw new DOMException('Workflow stopped before startup completed.', 'AbortError')
    const tools = this.options.tools().map(({ name, description, params, timeoutMs }) => ({ name, description, params, timeoutMs }))
    return this.supervisor.start({ ...request, sessionId, cwd }, { ...runtime, tools })
  }

  private async assertShortcutAvailable(sessionId: string): Promise<void> {
    if (!this.options.assertCanStartShortcut) throw new Error('Workflow shortcuts are unavailable in this host.')
    const snapshot = await this.supervisor.list()
    const live = snapshot.runs.filter(run => run.status === 'running' || run.status === 'stopping')
    if (live.some(run => run.sessionId === sessionId)) throw new Error('A workflow is already running or stopping in this chat.')
    const others = [...new Set([...live.map(run => run.sessionId), ...this.starting.keys()])].filter(id => id !== sessionId)
    this.options.assertCanStartShortcut(sessionId, others)
  }

  async listRuns(params?: { sessionId?: string }) { return this.supervisor.list(params?.sessionId) }
  async listWorkflows() { return WORKFLOW_DESCRIPTORS.map((workflow) => ({ ...workflow })) }
  async stopAgent(params: { sessionId: string; runId: string; agentId: string }) {
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
        description: 'Run a built-in workflow or an explicitly requested local TypeScript workflow file in this chat. Waits for the final result while agent tasks appear in the task bar and can be stopped individually. Supply exactly one of name or path. Available host tools: web_search/web_fetch; browser, skill, and integration actions are unavailable. Workflow subagents cannot recursively start workflows.',
        params: [
          { name: 'name', description: 'mini-demo, code-review, refactor-scout, diagnose, perf-review, or research.' },
          { name: 'path', description: 'Absolute path to a local .ts or .mts workflow file explicitly requested by the user.' },
          { name: 'input', required: true, description: 'Workflow task, target, and success criteria.' }
        ],
        timeoutMs: 130 * 60_000,
        execute: async (args) => {
          if (Boolean(args.name) === Boolean(args.path)) throw new Error('Supply exactly one of workflow name or path.')
          const run = await this.startWorkflow({
            sessionId,
            entry: args.path ? { kind: 'file', path: String(args.path) } : { kind: 'builtin', name: String(args.name) as WorkflowDescriptor['name'] },
            input: String(args.input ?? '')
          })
          const finished = await this.supervisor.waitForRun(run.id)
          if (finished.status !== 'completed') throw new Error(`Workflow ${finished.status}: ${finished.error || finished.name}`)
          return finished.result || JSON.stringify(finished)
        }
      }
    ]
  }
}
