import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createCodingTools, createReadOnlyTools } from '@earendil-works/pi-coding-agent'
import { createWebTools, WorkflowManager } from '@quintinshaw/pi-dynamic-workflows'
import { onCommand, send } from './workerPort'
import { trackOwnedProcesses } from './ownedProcesses'
import { renderResult, wireError, type WorkerCommand } from './protocol'
import { builtinIsReadOnly, builtinWorkflow } from './builtins'
import { DynamicWorkflowRows } from './dynamic/dynamicWorkflow'
import { DYNAMIC_RUN_BOUNDS, DYNAMIC_TOOLSET, READONLY_TOOLSET, ensureModelTiers, modelSpec, modelTiersPath } from './dynamic/dynamicPolicy'
import { DYNAMIC_ENTRY, DYNAMIC_ENTRY_ALTERNATIVES } from './dynamic/dynamicLoader'

/**
 * Resolve `workflow('name')` — one workflow calling another as a step.
 *
 * Without this the manager has no way to find a name, and a script that composes another workflow
 * fails at that line. It is the one host option whose absence an ecosystem package notices directly:
 * nested composition is part of the scripting API, not an optional extra.
 *
 * Two sources, most specific last: a builtin by name, or a sibling package in the same workflows
 * directory this run was loaded from. Siblings rather than a configured root so a run started from a
 * file outside the workflows folder cannot reach into it.
 */
const savedWorkflowLoader = (entryPath?: string) => (name: string): string | undefined => {
  try { return builtinWorkflow(name) } catch { /* not a builtin — try the neighbours */ }
  if (!entryPath) return undefined
  const root = dirname(dirname(entryPath))
  for (const file of [DYNAMIC_ENTRY, ...DYNAMIC_ENTRY_ALTERNATIVES]) {
    try { return readFileSync(join(root, name, file), 'utf8') } catch { /* next candidate */ }
  }
  return undefined
}

/**
 * Runs one workflow script, in its own utilityProcess.
 *
 * Ral 2026-09-20:「弃用 kimchi 改用 @quintinshaw/pi-dynamic-workflows」·「需要和 pi 中的
 * quintinshaw/pi-dynamic-workflows 对齐」.
 *
 * **Aligning means the package runs its own agents.** `WorkflowAgent` already resolves model tiers,
 * denies the orchestration tools that would let a subagent start its own unbounded nested run,
 * recovers structured output, and classifies a provider quota error as non-recoverable rather than
 * collapsing it to a silent null. The previous engine had us spawn one process per agent attempt and
 * reimplement all of that; this worker keeps the per-run process boundary and hands the agents to
 * the package.
 *
 * **What that costs, stated plainly:** subagents are now SDK sessions inside this process, so there
 * is no per-agent kill. `abort` stops the whole run. Stopping one agent while its siblings continue
 * is not expressible in this engine's API — the chat tool for it has nothing to call.
 */
trackOwnedProcesses()
const controller = new AbortController()
let started = false
let manager: WorkflowManager | undefined
let managedRunId: string | undefined

async function run(message: Extract<WorkerCommand, { type: 'engine.start' }>): Promise<void> {
  controller.signal.throwIfAborted()
  const request = message.request
  if (request.cwd) process.chdir(request.cwd)
  // A builtin is generated, not read: the package ships the script for each shape it maintains.
  const script = request.entry.kind === 'builtin'
    ? builtinWorkflow(request.entry.name)
    : request.entry.kind === 'file'
      ? await readFile(request.entry.path, 'utf8')
      : (() => { throw new Error('Workflow entry must be a builtin name or a resolved script path.') })()
  controller.signal.throwIfAborted()

  const runtime = message.runtime
  const mainModel = runtime.modelId ? modelSpec(runtime) : undefined
  // A relay is just another provider, so there is no special case here. The package resolves an
  // agent's model as: explicit model → tier → medium tier (only when a tiers file exists) → the
  // session's mainModel. With no file, everything already lands on the model the owner selected.
  // Seeding it once makes `{ tier: 'small' }` mean something and gives untagged agents a deliberate
  // default instead of silently inheriting the main model.
  const tiers = ensureModelTiers(mainModel)
  if (tiers === 'seeded') send({ type: 'agent.action', action: '', log: `Model tiers seeded at ${modelTiersPath()} — edit it to change which model small/medium/big use.` })

  // Every row change goes straight out as `agent.update` — the event the supervisor and the chat
  // task bar already consume, so the per-agent UI needed no new channel.
  const rows = new DynamicWorkflowRows(
    { runId: message.run.id, sessionId: request.sessionId },
    { publish: agent => send({ type: 'agent.update', agent }) }
  )

  // One manager per worker, managing this worker's single run (Ral 2026-09-20:「A;B 会有问题的,主进程
  // 不应该执行太多功能代码,否则性能有问题」). That keeps the per-run process boundary — a runaway
  // script cannot take main down, and killing the process is still a hard stop — while the manager
  // brings pause/resume, the journal, and the run state the chat control tool reads. Its lease design
  // already expects several processes sharing one project directory, so this is its intended shape,
  // not a workaround.
  manager = new WorkflowManager({
    cwd: request.cwd ?? process.cwd(),
    mainModel,
    concurrency: DYNAMIC_RUN_BOUNDS.concurrency,
    defaultAgentTimeoutMs: DYNAMIC_RUN_BOUNDS.agentTimeoutMs,
    defaultAgentRetries: DYNAMIC_RUN_BOUNDS.agentRetries,
    // Named toolsets, resolved lazily per execution — including on resume. `ExecOptions.tools` is
    // explicitly NOT persistable (it is functions), so a run started with tools passed that way
    // comes back from a resume with the default coding tools and silently loses web access. The
    // tag is what survives on disk; this mirrors how the package's own extension wires it.
    loadSavedWorkflow: savedWorkflowLoader(request.entry.kind === 'file' ? request.entry.path : undefined),
    toolsets: {
      [DYNAMIC_TOOLSET]: () => [...createCodingTools(request.cwd ?? process.cwd()), ...createWebTools()],
      // No write, no execute — for a run whose contract is that it changes nothing.
      [READONLY_TOOLSET]: () => [...createReadOnlyTools(request.cwd ?? process.cwd()), ...createWebTools()]
    }
  })
  for (const event of ['started', 'paused', 'resumed', 'stopped'] as const) {
    manager.on(event, (payload: { runId: string }) => send({ type: 'workflow.state', runId: payload.runId, state: event }))
  }

  const started = manager.startInBackground(script, request.input, {
    externalSignal: controller.signal,
    maxAgents: DYNAMIC_RUN_BOUNDS.maxAgents,
    agentTimeoutMs: DYNAMIC_RUN_BOUNDS.agentTimeoutMs,
    concurrency: DYNAMIC_RUN_BOUNDS.concurrency,
    agentRetries: DYNAMIC_RUN_BOUNDS.agentRetries,
    // By tag, not by value: a resumed run re-resolves this, where a `tools` array could not be
    // persisted and would come back missing.
    toolset: request.entry.kind === 'builtin' && builtinIsReadOnly(request.entry.name) ? READONLY_TOOLSET : DYNAMIC_TOOLSET,
    // The whole snapshot on every progress event — fewer moving parts than wiring each onAgent*
    // callback, and it is what a resumed run replays through too.
    onProgress: snapshot => rows.fromSnapshot(snapshot.agents ?? [])
  })
  managedRunId = started.runId
  send({ type: 'workflow.state', runId: started.runId, state: 'started' })
  const result = await started.promise
  send({ type: 'engine.done', result: renderResult(result.result) })
}

onCommand(message => {
  if (message.type === 'abort') controller.abort(new Error('Workflow stopped by user'))
  else if (message.type === 'workflow.pause') send({ type: 'workflow.control', action: 'pause', ok: Boolean(managedRunId && manager?.pause(managedRunId)) })
  else if (message.type === 'workflow.stop') send({ type: 'workflow.control', action: 'stop', ok: Boolean(managedRunId && manager?.stop(managedRunId)) })
  else if (message.type === 'workflow.resume') {
    void (async () => {
      const ok = Boolean(managedRunId && manager && await manager.resume(managedRunId))
      send({ type: 'workflow.control', action: 'resume', ok })
    })()
  }
  else if (message.type === 'engine.start' && !started) {
    started = true
    void run(message).catch(error => send({ type: 'engine.done', error: wireError(error) }))
  }
  // Per-AGENT control (stop / pause / steer one agent while its siblings continue) still has no
  // counterpart: the engine's controls are run-level. Anything unhandled here is deliberately a
  // no-op, and the host is what must stop offering those buttons.
})
send({ type: 'ready' })
