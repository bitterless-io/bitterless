import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { AgentSession, AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { toolActivity } from './toolActivity'
import type { AgentTurnResult, WorkerCommand, WorkflowIoLine } from './protocol'

export const WORKFLOW_SUBMIT_RESULT = 'workflow_submit_result'
type AgentStart = Extract<WorkerCommand, { type: 'agent.start' }>
export type PiSession = Pick<AgentSession, 'messages' | 'prompt' | 'subscribe' | 'abort' | 'dispose' | 'getLastAssistantText' | 'setAutoRetryEnabled'>
  & Partial<Pick<AgentSession, 'systemPrompt' | 'getActiveToolNames' | 'getAllTools'>>
export type PiSessionFactory = (start: AgentStart, customTools: ToolDefinition[], signal: AbortSignal) => Promise<PiSession>
interface Callbacks {
  action(action: string, log?: string): void
  usage(messages: readonly unknown[]): void
  settleTools(): Promise<void>
  io?(line: WorkflowIoLine): void
}
interface AssistantMessage {
  role: 'assistant'
  provider?: string
  model?: string
  content?: Array<{ type: string; text?: string }>
  stopReason?: string
  errorMessage?: string
  usage?: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
}
const assistants = (messages: readonly unknown[]): AssistantMessage[] => messages.filter((message): message is AssistantMessage => !!message && typeof message === 'object' && 'role' in message && message.role === 'assistant')
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** The production boundary is injected in tests; no model is called by the unit suite. */
export const createWorkflowPiSession: PiSessionFactory = async (start, customTools, signal) => {
  signal.throwIfAborted()
  const { createAgentSession, getAgentDir, DefaultResourceLoader, ModelRuntime, ModelRegistry, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
  signal.throwIfAborted()
  const { request, runtime, attempt } = start
  const cwd = request.cwd ?? process.cwd()
  const relay = runtime.relay
  if (relay && (attempt.providerId !== relay.providerId || attempt.modelId !== relay.modelId)) throw new Error('AI-CRMS workflows must use the selected provider and model.')
  const modelRuntime = await ModelRuntime.create(relay ? {
    // Runtime API keys live in Pi's memory overlay. Do not open the user's auth or model files.
    credentials: {
      read: async () => undefined, list: async () => [],
      modify: async () => { throw new Error('Workflow relay credentials cannot be persisted') },
      delete: async () => { throw new Error('Workflow relay credentials cannot be persisted') }
    },
    modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, signal
  } : { authPath: runtime.authPath, modelsPath: runtime.modelsPath, signal })
  if (relay) {
    modelRuntime.registerProvider(relay.providerId, {
      name: 'Micromeet', api: 'openai-completions', baseUrl: relay.baseUrl, headers: relay.headers,
      models: [{
        id: relay.modelId, name: relay.model.name, reasoning: true, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: relay.model.contextWindow, maxTokens: relay.model.maxTokens,
        compat: {
          thinkingFormat: 'qwen', supportsReasoningEffort: false, supportsDeveloperRole: false,
          supportsStore: false, supportsStrictMode: false, supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true
        }
      }]
    })
    await modelRuntime.setRuntimeApiKey(relay.providerId, relay.apiKey, { signal })
  }
  signal.throwIfAborted()
  const modelRegistry = new ModelRegistry(modelRuntime)
  const model = modelRegistry.find(attempt.providerId, attempt.modelId)
  if (!model || !modelRegistry.hasConfiguredAuth(model)) throw new Error(`Workflow model authentication unavailable: ${attempt.providerId}/${attempt.modelId}`)
  const builtinNames = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
  const available = new Set([...builtinNames, ...customTools.map(tool => tool.name)])
  const selected = attempt.opts.tools ?? [...available]
  for (const name of selected) if (!available.has(name)) throw new Error(`Workflow tool is unavailable: ${name}`)
  const tools = [...new Set([...selected, ...customTools.filter(tool => tool.name === WORKFLOW_SUBMIT_RESULT).map(tool => tool.name)])]
  const loader = new DefaultResourceLoader({
    cwd, agentDir: runtime.agentDir ?? getAgentDir(), noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: runtime.systemPrompt
  })
  await loader.reload()
  signal.throwIfAborted()
  const { session } = await createAgentSession({
    cwd, agentDir: runtime.agentDir, modelRuntime, model, thinkingLevel: attempt.opts.thinkingLevel ?? runtime.thinkingLevel,
    tools, customTools, resourceLoader: loader, settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory()
  })
  // Kimchi owns the output-repair budget. A rejected submission must not start an
  // unbounded Pi tool loop before Kimchi can count the failed turn.
  session.agent.shouldStopAfterTurn = ({ toolResults }) => toolResults.some(result => result.toolName === WORKFLOW_SUBMIT_RESULT)
  return session
}

/** One Pi session per attempt; Kimchi can request further turns to repair structured output. */
export class WorkflowPiSession {
  private session?: PiSession
  private unsubscribe?: () => void
  private opening: Promise<void>
  private active?: Promise<AgentTurnResult>
  private closing?: Promise<void>
  private closed = false
  private submitted?: AgentTurnResult['submitted']
  private submissionError?: string
  private terminalMessages: AssistantMessage[] = []
  private turnIndex = 0
  private toolArguments = new Map<string, unknown>()

  constructor(private start: AgentStart, private signal: AbortSignal, private callbacks: Callbacks, hostTools: ToolDefinition[], factory: PiSessionFactory = createWorkflowPiSession) {
    this.opening = this.open(hostTools, factory)
    // A worker can be cancelled before its initial turn is dispatched.
    void this.opening.catch(() => undefined)
  }

  private async open(hostTools: ToolDefinition[], factory: PiSessionFactory): Promise<void> {
    this.signal.throwIfAborted()
    if (this.start.attempt.opts.asks) throw new Error('Interactive workflow questions are not supported')
    if (hostTools.some(tool => tool.name === WORKFLOW_SUBMIT_RESULT)) throw new Error('Host tool uses the reserved workflow submission name')
    const tools = [...hostTools]
    const schema = this.start.attempt.opts.outputSchema
    if (schema) tools.push({
      name: WORKFLOW_SUBMIT_RESULT, label: 'Submit workflow result',
      description: 'Submit the final structured workflow result. Call this tool instead of writing JSON as text.',
      parameters: Type.Object({ result: schema }),
      prepareArguments: args => {
        if (!args || typeof args !== 'object' || Array.isArray(args)) return args
        const result = (args as { result?: unknown }).result
        if (typeof result !== 'string' || Value.Check(schema, result)) return args
        // Some providers encode a nested JSON result as a string. Decode once,
        // without coercing fields or accepting a value outside the original schema.
        try {
          const decoded: unknown = JSON.parse(result)
          if (Value.Check(schema, decoded)) return { ...args, result: decoded }
        } catch { /* Leave malformed values for the SDK's normal validation. */ }
        return args
      },
      execute: async (_id, args) => {
        this.signal.throwIfAborted()
        if (this.closed) throw new Error('Workflow Agent is closing')
        const result = (args as { result?: unknown }).result
        if (!Value.Check(schema, result)) throw new Error('Workflow result does not match the output schema')
        if ('x-desktop-agent' in schema && schema['x-desktop-agent'] && (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'completed')) throw new Error('Only the workflow host may report a stopped or failed Agent')
        this.submitted = { tool: WORKFLOW_SUBMIT_RESULT, arguments: { result: structuredClone(result) } }
        return { content: [{ type: 'text', text: 'Workflow result recorded.' }], details: {}, terminate: true }
      }
    })
    const session = await factory(this.start, tools, this.signal)
    this.session = session
    session.setAutoRetryEnabled(false)
    this.unsubscribe = session.subscribe(event => this.onEvent(event))
  }

  private onEvent(event: AgentSessionEvent): void {
    if (event.type === 'message_end') {
      const messages = assistants([event.message])
      this.terminalMessages.push(...messages)
      for (const message of messages) this.diagnostic('note', 'assistant', message.stopReason ?? 'message-end', () => message)
    }
    if (event.type === 'tool_execution_start') {
      this.toolArguments.set(event.toolCallId, event.args)
      if (event.toolName !== WORKFLOW_SUBMIT_RESULT) {
        const action = toolActivity(event.toolName, event.args)
        this.callbacks.action(action, action)
      }
    }
    if (event.type === 'tool_execution_end') {
      const args = this.toolArguments.get(event.toolCallId)
      this.toolArguments.delete(event.toolCallId)
      this.diagnostic('tool_result', event.toolName, event.toolCallId, () => ({ args, result: event.result, isError: event.isError }))
      if (event.toolName === WORKFLOW_SUBMIT_RESULT && event.isError) {
        const result = event.result as { content?: Array<{ type: string; text?: string }> }
        this.submissionError = result.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n').split('\n\nReceived arguments:')[0] || 'Workflow result submission was rejected'
      }
      this.callbacks.action('Thinking…')
    }
  }

  private diagnostic(kind: WorkflowIoLine['kind'], name: string, subject: string, payload: () => unknown): void {
    if (!this.callbacks.io) return
    try {
      const apiKey = this.start.runtime.relay?.apiKey
      const redact = (text: string): string => apiKey ? text.split(apiKey).join('[redacted]') : text
      const serialized = JSON.stringify(payload(), (_key, value: unknown) => typeof value === 'string' ? redact(value) : value)
      // Also redact JSON object keys; build text after redaction so escaped credentials cannot leak.
      const detail: unknown = JSON.parse(apiKey ? serialized.split(JSON.stringify(apiKey).slice(1, -1)).join('[redacted]') : serialized)
      this.callbacks.io({ turn: this.turnIndex, kind, name: redact(name), subject: redact(subject), text: JSON.stringify(detail, null, 2), ...(kind === 'turn_end' ? { detail } : {}) })
    } catch {
      // Diagnostics (including serialization and the transport) must never change an Agent outcome.
    }
  }

  turn(prompt: string): Promise<AgentTurnResult> {
    if (this.closed || this.signal.aborted) return Promise.reject(new Error('Workflow Agent is closing'))
    if (this.active) return Promise.reject(new Error('Workflow Agent already has an active turn'))
    const operation = this.runTurn(prompt)
    this.active = operation
    const clear = () => { if (this.active === operation) this.active = undefined }
    void operation.then(clear, clear)
    return operation
  }

  private async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.turnIndex++
    try { return await this.executeTurn(prompt) } catch (error) {
      this.diagnostic('turn_end', `${this.start.attempt.providerId}/${this.start.attempt.modelId}`, this.signal.aborted ? 'cancelled' : 'failed', () => ({ error: messageOf(error), cancelled: this.signal.aborted }))
      throw error
    }
  }

  private async executeTurn(prompt: string): Promise<AgentTurnResult> {
    await this.opening
    this.signal.throwIfAborted()
    if (this.closed) throw new Error('Workflow Agent is closing')
    const session = this.session!
    const offset = session.messages.length
    this.submitted = undefined; this.submissionError = undefined; this.terminalMessages = []
    this.diagnostic('prompt', `${this.start.attempt.providerId}/${this.start.attempt.modelId}`, 'workflow-prompt', () => {
      const activeTools = session.getActiveToolNames?.() ?? this.start.attempt.opts.tools
      return {
        systemPrompt: session.systemPrompt ?? this.start.runtime.systemPrompt,
        messages: session.messages, prompt,
        tools: session.getAllTools?.().filter(tool => !activeTools || activeTools.includes(tool.name)) ?? this.start.runtime.tools,
        activeTools, thinkingLevel: this.start.attempt.opts.thinkingLevel ?? this.start.runtime.thinkingLevel
      }
    })
    let promptError: unknown
    try { await session.prompt(prompt) } catch (error) { promptError = error }
    const recorded = assistants(session.messages.slice(offset))
    const messages = recorded.length ? recorded : this.terminalMessages
    this.callbacks.usage(messages.map(({ role, provider, model, usage }) => ({ role, provider, model, usage })))
    const totalTokens = messages.reduce((sum, message) => sum + (message.usage?.totalTokens ?? ((message.usage?.input ?? 0) + (message.usage?.output ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0))), 0)
    const failure = messages.find(message => message.stopReason === 'error' || message.errorMessage)
    const cancelled = this.signal.aborted || messages.some(message => message.stopReason === 'aborted')
    const rawErrorMessage = failure?.errorMessage || (failure ? 'Model provider returned an error' : promptError === undefined ? undefined : messageOf(promptError))
    const apiKey = this.start.runtime.relay?.apiKey
    const errorMessage = apiKey ? rawErrorMessage?.split(apiKey).join('[redacted]') : rawErrorMessage
    // SDK events may set this while session.prompt is awaited.
    const submissionError = this.submissionError as string | undefined
    const last = messages.at(-1)
    const text = last?.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? (last ? session.getLastAssistantText() ?? '' : '')
    const result: AgentTurnResult = {
      text, usage: { totalTokens }, ...(this.submitted ? { submitted: this.submitted } : {}),
      ...(!this.submitted && submissionError ? { submissionError: apiKey ? submissionError.split(apiKey).join('[redacted]') : submissionError } : {}),
      ...(cancelled ? { cancelled: true } : {}),
      ...(!cancelled && errorMessage ? { error: { kind: /context.{0,20}(window|length|limit)|too many tokens|maximum.{0,20}tokens/i.test(errorMessage) ? 'context-window-exceeded' as const : 'provider-error' as const, message: errorMessage } } : {})
    }
    this.diagnostic('turn_end', `${this.start.attempt.providerId}/${this.start.attempt.modelId}`, cancelled ? 'cancelled' : errorMessage ? 'failed' : 'completed', () => result)
    return result
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.cleanup()
    return this.closing
  }

  private async cleanup(): Promise<void> {
    await this.opening.catch(() => undefined)
    const failures: unknown[] = []
    const session = this.session
    if (session) {
      const [abort] = await Promise.allSettled([Promise.resolve().then(() => session.abort()), this.active])
      if (abort.status === 'rejected') failures.push(abort.reason)
    }
    try { await this.callbacks.settleTools() } catch (error) { failures.push(error) }
    try { this.unsubscribe?.() } catch (error) { failures.push(error) }
    try { session?.dispose() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, `Workflow Agent cleanup was not confirmed: ${failures.map(messageOf).join('; ')}`)
  }
}
