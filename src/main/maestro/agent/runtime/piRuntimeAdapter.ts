import { existsSync, readFileSync } from 'fs'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeEvent,
  AgentRuntimePrompt,
  AgentRuntimeSession,
  AgentRuntimeSessionOptions,
  AgentToolParamSpec
} from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'

// pi-coding-agent is ESM-only and the coach main bundles as CJS, so pi is loaded
// lazily via dynamic import() (a CJS module may import() an ESM one at runtime).
// Keep the SDK boundary narrow: importing the package's full declaration graph here makes
// Bitterless's workspace-wide TypeScript check expand thousands of unrelated CLI/TUI types.
interface PiModelRegistry {
  find: (providerId: string, modelId: string) => unknown
  hasConfiguredAuth: (model: unknown) => boolean
  refresh?: () => Promise<void>
}

interface PiModelRuntime {
  getModel: (providerId: string, modelId: string) => unknown
  hasConfiguredAuth: (providerId: string) => boolean
}

interface PiLegacyModelRegistryFactory {
  create: (authStorage: unknown, modelsPath?: string) => PiModelRegistry
}

interface PiModernModelRegistryFactory {
  new (modelRuntime: PiModelRuntime): PiModelRegistry
}

interface PiModule {
  AuthStorage: { create: (path: string) => unknown }
  ModelRuntime?: { create: (options?: { authPath?: string; modelsPath?: string | null }) => Promise<PiModelRuntime> }
  ModelRegistry: PiLegacyModelRegistryFactory | PiModernModelRegistryFactory
  defineTool: (spec: Record<string, unknown>) => unknown
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>
  SessionManager: { inMemory: () => unknown }
}

const loadPi = async (): Promise<PiModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiModule

const createPiTargetContext = async (
  pi: PiModule,
  authPath: string,
  modelsPath?: string
): Promise<{
  authStorage?: unknown
  modelRuntime?: PiModelRuntime
  modelRegistry: PiModelRegistry
}> => {
  if (pi.ModelRuntime?.create) {
    const modelRuntime = await pi.ModelRuntime.create({ authPath, modelsPath })
    const modelRegistry = new (pi.ModelRegistry as PiModernModelRegistryFactory)(modelRuntime)
    await modelRegistry.refresh?.()
    return { modelRuntime, modelRegistry }
  }
  const authStorage = pi.AuthStorage.create(authPath)
  return {
    authStorage,
    modelRegistry: (pi.ModelRegistry as PiLegacyModelRegistryFactory).create(authStorage, modelsPath)
  }
}

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  async checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean> {
    const pi = await loadPi()
    const { modelRuntime, modelRegistry } = await createPiTargetContext(pi, params.authPath, params.modelsPath)
    if (modelRuntime) {
      const model = modelRuntime.getModel(params.providerId, params.modelId)
      return Boolean(model && modelRuntime.hasConfiguredAuth(params.providerId))
    }
    const model = modelRegistry.find(params.providerId, params.modelId)
    return Boolean(model && modelRegistry.hasConfiguredAuth(model))
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    const pi = await loadPi()
    const { Type } = (await import('typebox')) as { Type: TypeBoxFactory }
    const { authStorage, modelRuntime, modelRegistry } = await createPiTargetContext(pi, options.authPath, options.modelsPath)
    const model = modelRuntime
      ? modelRuntime.getModel(options.target.providerId, options.target.modelId)
      : modelRegistry.find(options.target.providerId, options.target.modelId)
    const configured = modelRuntime
      ? modelRuntime.hasConfiguredAuth(options.target.providerId)
      : modelRegistry.hasConfiguredAuth(model)
    if (!model || !configured) {
      const auth = describeAuthFile(options.authPath, options.target.providerId)
      throw new Error(
        `Not signed in to ${providerDisplayName(options.target.providerId)} for "${options.target.providerId}/${options.target.modelId}". ` +
          `Use the app's AI Login button to authorize in your browser ` +
          `so ${options.authPath} gets a "${options.target.providerId}" credential ` +
          `(or set COACH_PI_PROVIDER / COACH_PI_MODEL to a provider you're already logged into).\n` +
          auth
      )
    }

    const customTools = options.tools.map((spec) =>
      pi.defineTool({
        name: spec.name,
        label: spec.name,
        description: spec.description,
        parameters: buildSchema(Type, spec.params),
        execute: async (_toolCallId: string, params: Record<string, unknown>) => {
          const startedAt = Date.now()
          try {
            const text = await spec.execute(params || {})
            const durationMs = Date.now() - startedAt
            options.onDebug?.({
              scope: options.scope,
              phase: 'pi-tool-result',
              level: 'info',
              message: `tool ${spec.name} returned.`,
              detail: { durationMs, outputChars: text.length },
              ts: Date.now()
            })
            return { content: [{ type: 'text', text }], details: { durationMs } }
          } catch (err) {
            const durationMs = Date.now() - startedAt
            const error = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')
            options.onDebug?.({
              scope: options.scope,
              phase: 'pi-tool-error',
              level: 'error',
              message: `tool ${spec.name} failed.`,
              detail: { durationMs, error },
              ts: Date.now()
            })
            throw new Error(error)
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    )

    // 'builtin' disables pi's own read/bash/edit/write tools but KEEPS customTools;
    // with no custom tools at all, 'all' turns the session into a pure LLM call.
    const { session } = await pi.createAgentSession({
      model,
      ...(modelRuntime ? { modelRuntime } : { authStorage, modelRegistry }),
      thinkingLevel: options.target.thinkingLevel,
      noTools: customTools.length > 0 ? 'builtin' : 'all',
      customTools,
      sessionManager: pi.SessionManager.inMemory()
    })
    options.onDebug?.({
      scope: options.scope,
      phase: 'pi-session-start',
      level: 'info',
      message: `pi session ready (${options.target.providerId}/${options.target.modelId}, ${customTools.length} tools).`,
      ts: Date.now()
    })
    return new PiRuntimeSession(session as PiSession)
  }
}

class PiRuntimeSession implements AgentRuntimeSession {
  constructor(private readonly session: PiSession) {}

  subscribe(listener: (event: AgentRuntimeEvent) => void): undefined | (() => void) {
    return this.session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) listener(normalized)
    })
  }

  async prompt(message: AgentRuntimePrompt): Promise<unknown> {
    // The current pi SDK native media option expects inline base64 payloads. Coach keeps
    // attachments as path/url refs instead, so pi receives the textual @path note until
    // an adapter surface can consume refs without copying bytes.
    return await this.session.prompt(message.text)
  }

  async abort(): Promise<void> {
    await this.session.abort()
  }
}

// TypeBox is loaded dynamically; we only need the factory methods we use, so model
// the surface loosely rather than depend on typebox's compile-time types here.
interface TypeBoxFactory {
  Object: (props: Record<string, unknown>) => unknown
  String: () => unknown
  Number: () => unknown
  Boolean: () => unknown
  Optional: (schema: unknown) => unknown
}

interface PiMessage {
  role?: string
  stopReason?: string
  content?: string | Array<{ type?: string; text?: string }>
  errorMessage?: string
}

interface PiSessionEvent {
  type?: string
  message?: PiMessage
  toolName?: string
  isError?: boolean
  args?: unknown
  assistantMessageEvent?: {
    type?: string
    delta?: string
    reason?: string
    message?: PiMessage
    error?: PiMessage
  }
}

interface PiSession {
  subscribe: (listener: (event: PiSessionEvent) => void) => undefined | (() => void)
  prompt: (message: string) => Promise<unknown>
  abort: () => Promise<void>
}

const normalizePiEvent = (event: PiSessionEvent): AgentRuntimeEvent[] => {
  const type = event?.type
  if (type === 'message_update') return normalizeAssistantMessageEvent(event.assistantMessageEvent)
  if (type === 'message_end' && event.message?.role === 'assistant') {
    return [
      {
        type: 'assistant_message_end',
        text: extractMessageText(event.message),
        stopReason: event.message.stopReason,
        errorMessage: sanitizeRuntimeError(event.message.errorMessage, 'provider')
      }
    ]
  }
  if (type === 'tool_execution_start') return [{ type: 'tool_start', toolName: event.toolName, args: event.args }]
  if (type === 'tool_execution_end') return [{ type: 'tool_end', toolName: event.toolName, args: event.args, isError: event.isError }]
  return []
}

const normalizeAssistantMessageEvent = (inner?: PiSessionEvent['assistantMessageEvent']): AgentRuntimeEvent[] => {
  if (!inner) return []
  if (inner.type === 'text_delta' && typeof inner.delta === 'string') return [{ type: 'text_delta', delta: inner.delta }]
  if (inner.type === 'thinking_start') return [{ type: 'thinking_start' }]
  if (inner.type === 'thinking_delta' && typeof inner.delta === 'string') return [{ type: 'thinking_delta', delta: inner.delta }]
  if (inner.type === 'thinking_end') return [{ type: 'thinking_end' }]
  if (inner.type === 'done' || inner.type === 'error') {
    const msg = inner.message || inner.error
    return [
      {
        type: 'assistant_done',
        text: extractMessageText(msg),
        stopReason: typeof inner.reason === 'string' ? inner.reason : undefined,
        errorMessage: sanitizeRuntimeError(msg?.errorMessage, 'provider')
      }
    ]
  }
  return []
}

// Join the text parts of a final assistant message (ignoring thinking + tool calls).
const extractMessageText = (message?: PiMessage): string => {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

const providerDisplayName = (providerId: string): string => {
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT subscription)'
  if (providerId === 'anthropic') return 'Claude'
  return providerId
}

const describeAuthFile = (authPath: string, providerId: string): string => {
  if (!existsSync(authPath)) return `Auth diagnostic: auth file does not exist (${authPath}).`
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as unknown
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    const providers = Object.keys(record).filter(Boolean)
    if (!providers.length) return `Auth diagnostic: auth file exists but has no provider credentials (${authPath}).`
    if (!record[providerId]) {
      return `Auth diagnostic: auth file exists but is missing provider "${providerId}". Found providers: ${providers.join(', ')}.`
    }
    return `Auth diagnostic: provider "${providerId}" exists in auth file, but the SDK did not consider it configured. It may be expired or incomplete.`
  } catch (err) {
    return `Auth diagnostic: auth file exists but could not be parsed (${(err as Error).message}).`
  }
}

const buildSchema = (Type: TypeBoxFactory, params: AgentToolParamSpec[]): unknown => {
  const props: Record<string, unknown> = {}
  for (const p of params) {
    const base = p.type === 'number' ? Type.Number() : p.type === 'boolean' ? Type.Boolean() : Type.String()
    props[p.name] = p.required ? base : Type.Optional(base)
  }
  return Type.Object(props)
}
