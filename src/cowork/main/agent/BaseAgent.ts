import { homedir } from 'os'
import { join } from 'path'
import type { AgentActivityStep, AgentThinkingState, CodexDebugEvent, LlmEffort } from '@cowork-shared/coach.api'
import { CoachRuntimeAdapter } from './runtime/coachRuntimeAdapter'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeEvent,
  AgentRuntimeImage,
  AgentRuntimeMediaRef,
  AgentRuntimePrompt,
  AgentRuntimeSession,
  AgentRuntimeThinkingLevel,
  AgentToolParamSpec,
  AgentToolSpec,
  AgentTurnReply
} from './runtime/agentRuntime.types'

export type PiParamSpec = AgentToolParamSpec
export type PiToolSpec = AgentToolSpec
export type PiAgentReply = AgentTurnReply

export interface BaseAgentPromptOptions {
  freshSession?: boolean
  media?: AgentRuntimeMediaRef[]
  images?: AgentRuntimeImage[]
}

export interface BaseAgentOptions {
  /** pi-ai provider id. Default 'openai-codex'. Env: COACH_PI_PROVIDER. */
  providerId?: string
  /** Model id for the provider (openai-codex default: gpt-5.5). Env: COACH_PI_MODEL. */
  modelId?: string
  /** Thinking/effort level for the provider. */
  effort?: LlmEffort
  /** pi auth store path. Cowork passes a userData path (coworkAuthPath); populated by the in-app
   * browser login (AuthStorage.login), NOT the `pi` CLI. Defaults to ~/.pi/agent/auth.json. */
  authPath?: string
  /** Optional pi models.json path for app-local custom providers. */
  modelsPath?: string
  /** Runtime adapter. Defaults to pi; Codex CLI / Claude CLI / ACP can implement the same boundary. */
  runtime?: AgentRuntimeAdapter
  /** Lazily supplies this instance's tools (called when a session starts). */
  buildTools: () => PiToolSpec[]
  /** Debug-log scope label for this instance (e.g. 'agent' chat vs 'summarize' generation). */
  scope?: CodexDebugEvent['scope']
  /** Streamed assistant text deltas (for the chat UI). */
  onStream?: (delta: string) => void
  /** Live low-priority activity shown above the assistant message. */
  onActivity?: (step: AgentActivityStep) => void
  /** Live provider thinking state; not persisted as message activity. */
  onThinking?: (state: Omit<AgentThinkingState, 'sessionId'>) => void
  onDebug?: (event: CodexDebugEvent) => void
}

// LLM provider/model are env-switchable. Subscription OAuth tokens are created by the in-app
// browser login — AuthStorage.login — into the coach's userData auth store, NOT the `pi` CLI.
const DEFAULT_PROVIDER = 'openai-codex'
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  'openai-codex': 'gpt-5.5',
  anthropic: 'claude-opus-4-8'
}
const DEFAULT_SESSION_START_TIMEOUT_MS = 45_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sessionStartTimeoutMs = (): number => {
  const raw = Number(process.env.COACH_PI_SESSION_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_START_TIMEOUT_MS
}

// Per-tool-call wall clock. A single tool that hangs (a stuck read/parse, a runaway
// scan, a wedged page action) would otherwise freeze the whole turn with no error;
// this makes it surface as a tool error the agent can react to. Override via env.
const toolTimeoutMs = (): number => {
  const raw = Number(process.env.COACH_TOOL_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000
}

/**
 * Runs a provider-neutral agent runtime in-process (no CLI, no exec) and lets the
 * selected adapter run its ReAct/tool loop. The coach's recorded skills are the
 * agent's ONLY tools — provider built-in read/bash/edit/write surfaces are disabled.
 */
export class BaseAgent {
  private sessionPromise: Promise<AgentRuntimeSession> | null = null
  private readonly runtime: AgentRuntimeAdapter
  // The system prompt is injected ONCE per session as a preamble (pi exposes no API to set
  // the LLM system prompt directly); `primed` tracks whether this session has received it.
  private primed = false
  private busy = false
  // Runtime overrides set by the UI provider switch; take precedence over env/opts.
  private providerOverride?: string
  private modelOverride?: string
  private effortOverride?: LlmEffort
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private activePromptDrain: Promise<void> | null = null
  private activeOneShotRuns = new Set<Promise<AgentTurnReply>>()
  private activeOneShotSessions = new Set<AgentRuntimeSession>()
  private pendingSessionCreations = new Set<Promise<AgentRuntimeSession>>()
  private pendingSessionAborts = new Set<Promise<void>>()

  constructor(protected readonly opts: BaseAgentOptions) {
    this.runtime = opts.runtime ?? new CoachRuntimeAdapter()
  }

  /**
   * The agent's system prompt (markdown). Subclasses OVERRIDE this with a template literal to
   * give the agent its role + instructions; returning '' means no preamble. It is sent ONCE at
   * the start of each conversation session (prepended to the first prompt; later turns rely on
   * the session's own history). oneShot() bypasses it — those prompts are self-contained.
   */
  protected systemPrompt(): string {
    return ''
  }

  /** Switch the LLM backend live. Drops the session so the next turn rebuilds it. */
  setTarget(providerId?: string, modelId?: string, effort?: LlmEffort): void {
    this.providerOverride = providerId?.trim() || undefined
    this.modelOverride = modelId?.trim() || undefined
    this.effortOverride = effort || undefined
    this.reset()
  }

  private resolveProvider(): string {
    return this.providerOverride || process.env.COACH_PI_PROVIDER || this.opts.providerId || DEFAULT_PROVIDER
  }

  private resolveModel(providerId: string): string {
    return (
      this.modelOverride ||
      process.env.COACH_PI_MODEL ||
      this.opts.modelId ||
      DEFAULT_MODEL_BY_PROVIDER[providerId] ||
      'gpt-5.5'
    )
  }

  private resolveEffort(): LlmEffort {
    return this.effortOverride || this.opts.effort || 'low'
  }

  private resolveThinkingLevel(): AgentRuntimeThinkingLevel {
    const effort = this.resolveEffort()
    if (effort === 'medium' || effort === 'high' || effort === 'xhigh') return effort
    if (effort === 'max') return 'xhigh'
    return 'low'
  }

  /** Resolve the active target + whether it has a usable credential (no OAuth refresh). */
  async checkTarget(): Promise<{ providerId: string; modelId: string; effort: LlmEffort; ready: boolean }> {
    const providerId = this.resolveProvider()
    const modelId = this.resolveModel(providerId)
    const effort = this.resolveEffort()
    try {
      const authPath = this.opts.authPath ?? join(homedir(), '.pi', 'agent', 'auth.json')
      const ready = await this.runtime.checkTarget({ providerId, modelId, authPath, modelsPath: this.opts.modelsPath })
      return { providerId, modelId, effort, ready }
    } catch {
      return { providerId, modelId, effort, ready: false }
    }
  }

  /**
   * Initialize this agent's session. IDEMPOTENT — an instance holds AT MOST ONE session, so a
   * second init() keeps the same one. Optional to call directly: prompt() inits lazily if you
   * skip it. Use reset() to drop the session; a later init()/prompt() starts a fresh one.
   * (oneShot() is separate — it runs a throwaway session and never touches this managed one.)
   */
  async init(): Promise<void> {
    await this.ensureSession()
  }

  private async ensureSession(): Promise<AgentRuntimeSession> {
    if (this.disposed) throw new Error('agent has been disposed')
    if (!this.sessionPromise) this.sessionPromise = this.startSession()
    return this.sessionPromise
  }

  private async startSession(): Promise<AgentRuntimeSession> {
    const session = await this.createSession(true)
    if (this.disposed) {
      await session.abort().catch(() => undefined)
      throw new Error('agent has been disposed')
    }
    return session
  }

  private async createSession(withTools: boolean): Promise<AgentRuntimeSession> {
    const authPath = this.opts.authPath ?? join(homedir(), '.pi', 'agent', 'auth.json')
    const providerId = this.resolveProvider()
    const modelId = this.resolveModel(providerId)
    const specs = withTools ? this.opts.buildTools().map((spec) => this.withToolTimeout(spec)) : []
    const creation = this.runtime.createSession({
      target: { providerId, modelId, thinkingLevel: this.resolveThinkingLevel() },
      authPath,
      modelsPath: this.opts.modelsPath,
      tools: specs,
      scope: this.scope(),
      onDebug: this.opts.onDebug
    })
    this.pendingSessionCreations.add(creation)
    try {
      return await creation
    } finally {
      this.pendingSessionCreations.delete(creation)
    }
  }

  // Wrap a tool so a hang surfaces as a tool error instead of freezing the turn silently.
  // NOTE: this only rescues tools that yield (async I/O); a tool that blocks the main thread
  // synchronously must be fixed at the source (e.g. async fs in search) — the timer can't fire
  // while the event loop is blocked.
  private withToolTimeout(spec: PiToolSpec): PiToolSpec {
    const ms = toolTimeoutMs()
    return {
      ...spec,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        try {
          return await withTimeout(
            Promise.resolve(spec.execute(args)),
            ms,
            `tool "${spec.name}" timed out after ${Math.round(ms / 1000)}s — it may be reading a very large file or scanning a huge directory. Try a narrower path or a specific file.`
          )
        } catch (err) {
          if (isTimeoutError(err)) return `ERROR: ${err instanceof Error ? err.message : String(err)}`
          throw err
        }
      }
    }
  }

  // Wraps the ENTIRE ReAct turn (every page_snapshot + ui_act round-trip + tool time),
  // not a single model call — multi-step UI automation through a proxy can need several
  // minutes. Override via COACH_PI_TURN_TIMEOUT_MS.
  async prompt(
    message: string,
    timeoutMs = Number(process.env.COACH_PI_TURN_TIMEOUT_MS) || 600_000,
    options?: BaseAgentPromptOptions
  ): Promise<AgentTurnReply> {
    if (this.disposed) return { ok: false, text: '', error: 'agent has been disposed' }
    if (this.busy) return { ok: false, text: '', error: 'agent is already handling a message' }
    this.busy = true
    let resolvePromptDrain: () => void = () => undefined
    const promptDrain = new Promise<void>((resolve) => {
      resolvePromptDrain = resolve
    })
    this.activePromptDrain = promptDrain
    const startedAt = Date.now()
    try {
      if (options?.freshSession) this.reset()
      let session: AgentRuntimeSession
      try {
        session = await withTimeout(
          this.ensureSession(),
          sessionStartTimeoutMs(),
          `agent runtime session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
        )
      } catch (err) {
        // A failed session start (e.g. missing pi login) must not poison future
        // attempts — drop the rejected promise so the next prompt retries.
        if (this.sessionPromise) this.trackSessionAbort(this.sessionPromise)
        this.sessionPromise = null
        throw err
      }
      const turn = await this.runPrompt(session, this.withSystemPreamble({ text: message, media: options?.media, images: options?.images }), timeoutMs)
      this.debug(turn.errorMessage ? 'agent-turn-error' : 'agent-turn-complete', turn.errorMessage ? 'warn' : 'info', 'agent runtime turn completed.', {
        durationMs: Date.now() - startedAt,
        outputChars: turn.text.length,
        streamedChars: turn.streamedChars,
        finalChars: turn.finalChars,
        toolCalls: turn.toolCalls,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      })
      return {
        ok: true,
        text: turn.text,
        toolCalls: turn.toolCalls,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // After a timeout the in-flight turn's state is unknown — start fresh.
      if (isTimeoutError(err)) this.reset()
      this.debug('agent-error', 'error', 'agent runtime prompt failed.', { error, durationMs: Date.now() - startedAt })
      return { ok: false, text: '', error }
    } finally {
      this.busy = false
      resolvePromptDrain()
      if (this.activePromptDrain === promptDrain) this.activePromptDrain = null
    }
  }

  /**
   * One-shot prompt on a FRESH throwaway session — no tools, no carried context.
   * For structured generation calls (skill drafts/refines) that must not bleed
   * state between invocations. Independent of the conversational session.
   */
  async oneShot(prompt: string, timeoutMs = 120_000): Promise<AgentTurnReply> {
    if (this.disposed) return { ok: false, text: '', error: 'agent has been disposed' }
    const run = this.runOneShot(prompt, timeoutMs)
    this.activeOneShotRuns.add(run)
    try {
      return await run
    } finally {
      this.activeOneShotRuns.delete(run)
    }
  }

  private async runOneShot(prompt: string, timeoutMs: number): Promise<AgentTurnReply> {
    const startedAt = Date.now()
    let session: AgentRuntimeSession | null = null
    const creation = this.createSession(false)
    try {
      session = await withTimeout(
        creation,
        sessionStartTimeoutMs(),
        `agent runtime one-shot session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
      )
      this.activeOneShotSessions.add(session)
      if (this.disposed) return { ok: false, text: '', error: 'agent has been disposed' }
      const turn = await this.runPrompt(session, { text: prompt }, timeoutMs)
      this.debug(turn.errorMessage ? 'agent-oneshot-error' : 'agent-oneshot-complete', turn.errorMessage ? 'warn' : 'info', 'agent runtime one-shot completed.', {
        durationMs: Date.now() - startedAt,
        outputChars: turn.text.length,
        finalChars: turn.finalChars,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      })
      return { ok: true, text: turn.text, errorMessage: turn.errorMessage || undefined }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (!session) this.trackSessionAbort(creation)
      this.debug('agent-oneshot-error', 'error', 'agent runtime one-shot failed.', { error, durationMs: Date.now() - startedAt })
      return { ok: false, text: '', error }
    } finally {
      if (session) {
        this.activeOneShotSessions.delete(session)
        await session.abort().catch(() => undefined)
      }
    }
  }

  /** Drop the current conversation; the next prompt starts a fresh session. */
  reset(): void {
    const existing = this.sessionPromise
    this.sessionPromise = null
    this.primed = false
    if (existing) this.trackSessionAbort(existing)
  }

  /** Permanently stop this agent and wait for managed, reset, and one-shot work to drain. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return await this.disposePromise
    this.disposed = true
    const dispose = this.disposeSessions()
    this.disposePromise = dispose
    await dispose
  }

  private async disposeSessions(): Promise<void> {
    const managed = this.sessionPromise
    this.sessionPromise = null
    this.primed = false
    if (managed) this.trackSessionAbort(managed)
    for (const creation of this.pendingSessionCreations) this.trackSessionAbort(creation)

    const oneShotAborts = [...this.activeOneShotSessions].map((session) => session.abort())
    await Promise.allSettled([...this.pendingSessionAborts, ...oneShotAborts])

    const drains = [
      ...(this.activePromptDrain ? [this.activePromptDrain] : []),
      ...this.activeOneShotRuns
    ]
    await Promise.allSettled(drains)
    await Promise.allSettled([...this.pendingSessionAborts])
    this.activeOneShotSessions.clear()
    this.busy = false
  }

  private trackSessionAbort(creation: Promise<AgentRuntimeSession>): void {
    const abort = creation.then((session) => session.abort()).catch(() => undefined)
    this.pendingSessionAborts.add(abort)
    void abort.then(() => this.pendingSessionAborts.delete(abort))
  }

  /**
   * Stop the in-flight turn (if any): tell the live runtime session to abort and go idle, which
   * resolves the pending prompt() so the turn ends with whatever partial output it has. Then drop
   * the session so aborted output is never reused as later model context. No-op when idle.
   */
  async abort(): Promise<void> {
    if (!this.busy || !this.sessionPromise) return
    try {
      const session = await Promise.race([this.sessionPromise, sleep(500).then(() => null)])
      if (session) await Promise.race([session.abort(), sleep(1500)])
    } catch {
      /* best effort — the turn may already be resolving */
    } finally {
      this.reset()
      this.busy = false
    }
  }

  // Prepend the system prompt to the FIRST message of a session (once); later turns rely on
  // the session's own history. oneShot() bypasses this — its prompts are self-contained.
  private withSystemPreamble(message: AgentRuntimePrompt): AgentRuntimePrompt {
    if (this.primed) return message
    this.primed = true
    const sys = this.systemPrompt().trim()
    return sys ? { ...message, text: `${sys}\n\n${message.text}` } : message
  }

  private async runPrompt(session: AgentRuntimeSession, message: AgentRuntimePrompt, timeoutMs: number): Promise<PiTurnResult> {
    let streamed = ''
    let finalText = ''
    let stopReason = ''
    let errorMessage = ''
    let toolCalls = 0
    let thinkingActive = false
    const toolStartedAt = new Map<string, number[]>()
    const setThinking = (active: boolean): void => {
      if (thinkingActive === active) return
      thinkingActive = active
      this.opts.onThinking?.({ active, ts: Date.now() })
    }
    const unsubscribe = session.subscribe((event: AgentRuntimeEvent) => {
      const type = event?.type
      if (type === 'text_delta') {
        setThinking(false)
        streamed += event.delta
        this.opts.onStream?.(event.delta)
      } else if (type === 'thinking_start') {
        setThinking(true)
      } else if (type === 'thinking_delta') {
        setThinking(true)
      } else if (type === 'thinking_end') {
        setThinking(false)
      } else if (type === 'assistant_done') {
        if (event.text) finalText = event.text
        if (event.stopReason) stopReason = event.stopReason
        if (event.errorMessage) errorMessage = event.errorMessage
      } else if (type === 'assistant_message_end') {
        // The terminal assistant message — the most reliable source of the final
        // text AND of provider errors (e.g. a 403), which some providers report
        // late with no provider-specific done/error event. Role-guarding happens in
        // the runtime adapter so BaseAgent only sees assistant terminals.
        if (event.text) finalText = event.text
        if (event.stopReason) stopReason = event.stopReason
        if (event.errorMessage) errorMessage = event.errorMessage
      } else if (type === 'tool_start') {
        toolCalls += 1
        const toolName = event.toolName || 'tool'
        const starts = toolStartedAt.get(toolName) || []
        starts.push(Date.now())
        toolStartedAt.set(toolName, starts)
        const activity = activityForTool(event.toolName, event.args)
        this.activity(activity.phase, activity.label)
        this.debug('agent-tool', 'info', `tool → ${toolName}`, { args: clip(event.args) })
      } else if (type === 'tool_end') {
        const toolName = event.toolName || 'tool'
        const starts = toolStartedAt.get(toolName)
        const started = starts?.shift()
        const detail = started ? { durationMs: Date.now() - started } : undefined
        if (starts && starts.length === 0) toolStartedAt.delete(toolName)
        if (event.isError) this.activity(activityForTool(event.toolName, event.args).phase, `${event.toolName || 'tool'} failed`, false)
        this.debug('agent-tool-end', event.isError ? 'warn' : 'info', `tool ${toolName} ${event.isError ? 'errored' : 'ok'}`, detail)
      }
    })
    try {
      await withTimeout(session.prompt(message), timeoutMs, `pi agent turn timed out after ${Math.round(timeoutMs / 1000)}s`)
    } catch (err) {
      if (isTimeoutError(err)) {
        await Promise.race([session.abort(), sleep(1500)]).catch(() => undefined)
      }
      throw err
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe()
      setThinking(false)
    }
    const text = streamed.trim() || finalText.trim()
    return { text, streamedChars: streamed.length, finalChars: finalText.length, toolCalls, stopReason, errorMessage }
  }

  private scope(): CodexDebugEvent['scope'] {
    return this.opts.scope ?? 'agent'
  }

  private debug(phase: string, level: CodexDebugEvent['level'], message: string, detail?: unknown): void {
    this.opts.onDebug?.({ scope: this.scope(), phase, level, message, detail, ts: Date.now() })
  }

  private activity(phase: AgentActivityStep['phase'], label: string, ok = true): void {
    const compact = compactActivityLabel(label)
    if (!compact) return
    this.opts.onActivity?.({ phase, label: compact, ok, ts: Date.now() })
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

interface PiTurnResult {
  text: string
  streamedChars: number
  finalChars: number
  toolCalls: number
  stopReason: string
  errorMessage: string
}

const clip = (value: unknown, max = 300): string => {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

const compactActivityLabel = (value: string, max = 180): string => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

const activityForTool = (toolName?: string, args?: unknown): { phase: AgentActivityStep['phase']; label: string } => {
  if (!toolName) return { phase: 'tool', label: 'tool' }
  if (toolName === 'browser_exec') return browserExecActivity(args)
  // Show the raw tool name under its tag (e.g. "tool" + "page_snapshot" → tool:page_snapshot),
  // NOT a remapped semantic verb ("see"/"do") or a "call …" prefix — the record is the tool called.
  return { phase: activityPhaseForTool(toolName), label: toolName }
}

const activityPhaseForTool = (toolName: string): AgentActivityStep['phase'] => {
  if (toolName === 'get_skill_contract' || toolName === 'get_skill_detail' || toolName === 'run_skill_script' || toolName === 'replay_skill_ui' || toolName === 'delete_skill') {
    return 'skill'
  }
  return 'tool'
}

const browserExecActivity = (args: unknown): { phase: AgentActivityStep['phase']; label: string } => {
  const commands = parseBrowserExecCommands(args)
  const fetches = commands.filter((cmd) => cmd.command === 'fetch')
  if (!commands.length) return { phase: 'tool', label: 'call browser_exec' }
  if (!fetches.length) return { phase: 'tool', label: 'read browser context' }
  const first = fetches[0]
  const method = (first.method || 'GET').toUpperCase()
  const phase: AgentActivityStep['phase'] = ['GET', 'HEAD', 'OPTIONS'].includes(method) && fetches.every((cmd) => ['GET', 'HEAD', 'OPTIONS'].includes((cmd.method || 'GET').toUpperCase()))
    ? 'api-read'
    : 'api-call'
  const more = fetches.length > 1 ? ` +${fetches.length - 1}` : ''
  return { phase, label: `${method} ${activityEndpoint(first.url || '')}${more}` }
}

const parseBrowserExecCommands = (args: unknown): { command: string; method?: string; url?: string }[] => {
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const raw = rec.commands_json
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const readOne = (item: unknown): { command: string; method?: string; url?: string }[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      const command = String(record.command || '')
      if (command === 'parallel' && Array.isArray(record.commands)) return record.commands.flatMap(readOne)
      return [
        {
          command,
          method: typeof record.method === 'string' ? record.method : undefined,
          url: typeof record.url === 'string' ? record.url : undefined
        }
      ]
    }
    return list.flatMap(readOne).filter((item) => item.command)
  } catch {
    return []
  }
}

const activityEndpoint = (url: string): string => {
  try {
    const parsed = new URL(url, 'https://coach.local')
    const keys = Array.from(parsed.searchParams.keys())
    const query = keys.map((key) => `${encodeURIComponent(key)}=<${activityVarName(key) || 'value'}>`).join('&')
    return `${sanitizeActivityPath(parsed.pathname)}${query ? `?${query}` : ''}`
  } catch {
    return url || '/api'
  }
}

const sanitizeActivityPath = (path: string): string => {
  return path
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (/^[0-9]{5,}$/.test(decoded) || /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) || /^[A-Za-z0-9_-]{16,}$/.test(decoded)) return ':id'
      return segment
    })
    .join('/')
}

const activityVarName = (label: string): string => {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const isTimeoutError = (err: unknown): boolean => err instanceof TimeoutError || /timed out/i.test(err instanceof Error ? err.message : String(err))

const withTimeout = <T>(promise: Promise<T>, ms: number, message = `operation timed out after ${Math.round(ms / 1000)}s`): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
