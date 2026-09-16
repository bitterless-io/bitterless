import { workflowActivityFacts, type WorkflowActivityFacts, type WorkflowActivitySummary, type WorkflowRunSnapshot } from '../../../shared/agentWorkflow.api'
import type { AgentRuntimeAdapter, AgentRuntimeSession } from '../runtime/agentRuntime.types'

/**
 * The status bar must say what the background Agents are doing, not only how many exist.
 *
 * Counts come from the snapshot and are always correct; the sentence is written by a short,
 * tool-free model call. A failed or slow sentence degrades to the deterministic counts the
 * renderer localizes itself — it never blocks a workflow, a turn, or the broadcast.
 */
export const WORKFLOW_ACTIVITY_PROMPT = [
  'You write one status line for a chat status bar.',
  'The user message is JSON describing the background Agent tasks that are running right now.',
  'Reply with exactly one sentence of at most 80 characters describing what is being worked on.',
  'Write it in the same language as the task text. Plain text only: no quotes, markdown, lists or preamble.',
  'Describe work in progress only. Never claim progress, percentages, findings or completion.'
].join('\n')

export interface WorkflowActivityTarget {
  providerId: string
  modelId: string
  thinkingLevel: 'off' | 'low'
  authPath: string
  modelsPath?: string
  agentDir?: string
}

export interface WorkflowActivityDeps {
  runtime: Pick<AgentRuntimeAdapter, 'createSession'>
  /** Null when no model is configured; the renderer then shows the deterministic line only. */
  target(): WorkflowActivityTarget | null
  /** Called only when a sentence lands, so the host can republish the snapshot. */
  onUpdated(): void
  now?(): number
  debounceMs?: number
  minIntervalMs?: number
  deadlineMs?: number
}

interface SessionState {
  facts: WorkflowActivityFacts
  summary: WorkflowActivitySummary
  timer?: ReturnType<typeof setTimeout>
  running: boolean
  /** The described work changed while a sentence was being written. */
  dirty: boolean
  lastStartedAt: number
  /** Consecutive attempts that produced nothing usable; resets when the Agents themselves change. */
  failures: number
}

const SENTENCE_LIMIT = 100
const OUTPUT_LIMIT = 800
/** An unreachable or unusable model must cost a bounded number of attempts, not one every interval. */
const FAILURE_LIMIT = 3

/** One line, bounded, no control characters, no decorative wrapper the model may add. */
export function validateWorkflowActivitySentence(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim().replace(/^["'“”「『]+|["'“”」』]+$/g, '').trim()
  if (!text || [...text].some(character => character.codePointAt(0)! < 0x20 || character.codePointAt(0) === 0x7f)) return ''
  if (Array.from(text).length > SENTENCE_LIMIT) return ''
  if (/^[#>{[\-*`]/.test(text)) return ''
  return text
}

const abortQuietly = (session: AgentRuntimeSession): void => {
  try { void Promise.resolve(session.abort()).catch(() => undefined) } catch { /* cleanup only */ }
}

export class WorkflowActivitySummaryService {
  private readonly sessions = new Map<string, SessionState>()
  private closed = false

  constructor(private readonly deps: WorkflowActivityDeps) {}

  /** Synchronous: the caller broadcasts the same snapshot it just published. */
  update(runs: readonly WorkflowRunSnapshot[]): void {
    if (this.closed) return
    const seen = new Set<string>()
    for (const run of runs) {
      if (seen.has(run.sessionId)) continue
      seen.add(run.sessionId)
      this.applySession(run.sessionId, workflowActivityFacts(runs, run.sessionId))
    }
    for (const sessionId of [...this.sessions.keys()]) if (!seen.has(sessionId)) this.forget(sessionId)
  }

  list(sessionId?: string): WorkflowActivitySummary[] {
    const entries = [...this.sessions.values()].map(state => ({ ...state.summary }))
    return sessionId ? entries.filter(entry => entry.sessionId === sessionId) : entries
  }

  dispose(): void {
    this.closed = true
    for (const sessionId of [...this.sessions.keys()]) this.forget(sessionId)
  }

  private applySession(sessionId: string, facts: WorkflowActivityFacts): void {
    const state = this.sessions.get(sessionId)
    if (!facts.agents) { this.forget(sessionId); return }
    if (!state) {
      this.sessions.set(sessionId, { facts, summary: this.project(sessionId, facts, '', 0), running: false, dirty: false, lastStartedAt: 0, failures: 0 })
      this.schedule(sessionId)
      return
    }
    const described = state.facts.signature === facts.signature
    // A sentence describes the Agents, so a tool step changing under it must not blank the status bar.
    const sameAgents = state.facts.scope === facts.scope
    state.facts = facts
    // Counts follow the snapshot immediately, even while a sentence for older work is in flight.
    state.summary = this.project(sessionId, facts, sameAgents ? state.summary.text : '', sameAgents ? state.summary.generatedAt : 0)
    if (!sameAgents) state.failures = 0
    if (described) return
    if (state.running) { state.dirty = true; return }
    this.schedule(sessionId)
  }

  private project(sessionId: string, facts: WorkflowActivityFacts, text: string, generatedAt: number): WorkflowActivitySummary {
    return { sessionId, text, runs: facts.runs, agents: facts.agents, awaitingUser: facts.awaitingUser, startedAt: facts.startedAt, generatedAt }
  }

  private forget(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    if (state.timer) clearTimeout(state.timer)
    this.sessions.delete(sessionId)
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }

  private schedule(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state || this.closed || state.timer || state.running || state.failures >= FAILURE_LIMIT) return
    const minInterval = this.deps.minIntervalMs ?? 15_000
    const wait = Math.max(this.deps.debounceMs ?? 1_500, state.lastStartedAt ? state.lastStartedAt + minInterval - this.now() : 0)
    const timer = setTimeout(() => {
      const current = this.sessions.get(sessionId)
      if (current) current.timer = undefined
      void this.generate(sessionId)
    }, wait)
    timer.unref?.()
    state.timer = timer
  }

  private async generate(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state || this.closed || state.running) return
    const target = this.deps.target()
    if (!target || !state.facts.agents) return
    const signature = state.facts.signature
    const brief = state.facts.brief
    state.running = true
    state.lastStartedAt = this.now()
    let unusable = true
    try {
      const text = await this.write(target, brief)
      unusable = !text
      const current = this.sessions.get(sessionId)
      if (this.closed || !current || current.facts.signature !== signature) return
      if (!text || text === current.summary.text) return
      current.summary = { ...current.summary, text, generatedAt: this.now() }
      this.deps.onUpdated()
    } catch {
      // The deterministic counts stay authoritative; the renderer localizes its own line.
    } finally {
      const current = this.sessions.get(sessionId)
      if (current) {
        current.running = false
        current.failures = unusable ? current.failures + 1 : 0
        if (current.dirty || current.facts.signature !== signature) { current.dirty = false; this.schedule(sessionId) }
      }
    }
  }

  private async write(target: WorkflowActivityTarget, brief: string): Promise<string> {
    let session: AgentRuntimeSession | undefined
    let unsubscribe: undefined | (() => void)
    let finished = false
    let output = ''
    let fail: (error: Error) => void = () => undefined
    const failed = new Promise<never>((_resolve, reject) => { fail = reject })
    void failed.catch(() => undefined)
    const timer = setTimeout(() => fail(new Error('workflow-activity-timeout')), this.deps.deadlineMs ?? 12_000)
    try {
      const work = async (): Promise<string> => {
        const created = await this.deps.runtime.createSession({
          target: { providerId: target.providerId, modelId: target.modelId, thinkingLevel: target.thinkingLevel },
          authPath: target.authPath, modelsPath: target.modelsPath, agentDir: target.agentDir, cwd: target.agentDir,
          scope: 'summarize', tools: [], builtinTools: [], systemPrompt: WORKFLOW_ACTIVITY_PROMPT
        })
        // Creation can settle after the deadline; it still owns a cleanup obligation.
        if (finished || this.closed) { abortQuietly(created); return '' }
        session = created
        unsubscribe = created.subscribe(event => {
          if (event.type === 'text_delta') {
            if (output.length + event.delta.length > OUTPUT_LIMIT) fail(new Error('workflow-activity-output-limit'))
            else output += event.delta
          } else if (event.type === 'assistant_done' || event.type === 'assistant_message_end') {
            if (event.errorMessage || (event.stopReason && event.stopReason !== 'stop')) { fail(new Error('workflow-activity-provider-error')); return }
            if (event.text) output = event.text.slice(0, OUTPUT_LIMIT)
          } else if (event.type === 'tool_start' || event.type === 'compaction_start') {
            fail(new Error('workflow-activity-unexpected-work'))
          }
        })
        await created.prompt({ text: brief })
        return validateWorkflowActivitySentence(output)
      }
      return await Promise.race([work(), failed])
    } finally {
      finished = true
      clearTimeout(timer)
      try { unsubscribe?.() } catch { /* cleanup must not block the next summary */ }
      if (session) abortQuietly(session)
    }
  }
}
