import { createXpcMainEmitter } from 'electron-xpc/main'
import { fetch } from 'undici'
import type { SessionApi, AuthSession } from '@maestro-shared/session.api'
import { normalizeCoachRegion } from '@maestro-shared/networking/coachRegion'
import { resolveAiCrmsRelayEndpoint } from '@maestro-main/networking/clients/relay.client'
import { sanitizeRuntimeError } from './errorSanitizer'
import { isDownloadableMediaUrl } from './mediaRefResolver'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeEvent,
  AgentRuntimePrompt,
  AgentRuntimeSession,
  AgentRuntimeSessionOptions,
  AgentToolSpec
} from './agentRuntime.types'

const aiCrmsSession = createXpcMainEmitter<SessionApi>('MaestroSessionDao')

export class AiCrmsRuntimeAdapter implements AgentRuntimeAdapter {
  async checkTarget(params: { providerId: string }): Promise<boolean> {
    if (normalizeProviderId(params.providerId) !== 'ai-crms') return false
    const session = await aiCrmsSession.getSession().catch(() => null)
    return Boolean(session?.jwt_token)
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    if (normalizeProviderId(options.target.providerId) !== 'ai-crms') {
      throw new Error(`AiCrmsRuntimeAdapter cannot handle provider "${options.target.providerId}".`)
    }
    const session = await aiCrmsSession.getSession().catch(() => null)
    if (!session?.jwt_token) {
      throw new Error('Not signed in to AI-CRMS. Open the AI-CRMS tab and log in so Maestro can reuse the shared session token.')
    }
    const endpoint = resolveAiCrmsRelayEndpoint(session)
    const requestUrl = chatCompletionsUrl(endpoint.baseUrl)
    options.onDebug?.({
      scope: options.scope,
      phase: 'ai-crms-session-start',
      level: 'info',
      message: `AI-CRMS native session ready (${options.target.modelId}, ${options.tools.length} tools).`,
      detail: { baseUrl: endpoint.baseUrl, requestUrl, region: endpoint.region },
      ts: Date.now()
    })
    return new AiCrmsRuntimeSession({
      options,
      session,
      url: requestUrl
    })
  }
}

class AiCrmsRuntimeSession implements AgentRuntimeSession {
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>()
  private readonly messages: OpenAiChatMessage[] = []
  private abortController: AbortController | null = null

  constructor(private readonly params: AiCrmsRuntimeSessionParams) {}

  subscribe(listener: (event: AgentRuntimeEvent) => void): undefined | (() => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(message: AgentRuntimePrompt): Promise<unknown> {
    const controller = new AbortController()
    this.abortController = controller
    this.messages.push(buildUserMessage(message))
    try {
      await this.runToolLoop(controller.signal)
      return undefined
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort()
  }

  private async runToolLoop(signal: AbortSignal): Promise<void> {
    const maxRounds = maxToolRounds()
    for (let round = 0; round <= maxRounds; round += 1) {
      const result = await this.completeOnce(signal)
      this.messages.push(result.message)
      if (!result.toolCalls.length) {
        this.emit({ type: 'assistant_message_end', text: result.text, stopReason: result.stopReason, errorMessage: result.errorMessage })
        return
      }
      if (round === maxRounds) {
        this.emit({
          type: 'assistant_message_end',
          text: result.text,
          stopReason: 'error',
          errorMessage: `AI-CRMS tool loop exceeded ${maxRounds} rounds.`
        })
        return
      }
      for (const call of result.toolCalls) {
        const observation = await this.executeToolCall(call)
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: observation })
      }
    }
  }

  private async completeOnce(signal: AbortSignal): Promise<AssistantCompletionResult> {
    const body = buildCompletionBody(this.params.options, this.messages)
    const headers = this.headers()
    const startedAt = Date.now()
    this.params.options.onDebug?.({
      scope: this.params.options.scope,
      phase: 'ai-crms-request',
      level: 'info',
      message: 'AI-CRMS chat.completions request.',
      detail: {
        url: this.params.url,
        method: 'POST',
        model: this.params.options.target.modelId,
        stream: body.stream === true,
        messages: this.messages.length,
        tools: this.params.options.tools.length,
        hasMedia: hasMediaContent(this.messages),
        headerKeys: Object.keys(headers).sort(),
        hasAuthorizationHeader: Boolean(headers.Authorization),
        region: headers['x-region'] || '',
        hasWorkspaceId: Boolean(headers['x-workspace-id'])
      },
      ts: Date.now()
    })
    const res = await fetch(this.params.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok) {
      const text = await res.text()
      const error = text ? sanitizeRuntimeError(text, 'AI-CRMS relay') : ''
      this.params.options.onDebug?.({
        scope: this.params.options.scope,
        phase: 'ai-crms-response-error',
        level: 'error',
        message: 'AI-CRMS chat.completions failed.',
        detail: {
          url: this.params.url,
          status: res.status,
          contentType: res.headers.get('content-type') || '',
          durationMs: Date.now() - startedAt,
          error: error || undefined
        },
        ts: Date.now()
      })
      throw new Error(`AI-CRMS relay HTTP ${res.status}${error ? ` ${error}` : ''}`)
    }
    const result = await parseOpenAiChatCompletion(res, (event) => this.emit(event), signal)
    this.params.options.onDebug?.({
      scope: this.params.options.scope,
      phase: 'ai-crms-response',
      level: result.errorMessage ? 'warn' : 'info',
      message: 'AI-CRMS chat.completions response.',
      detail: {
        durationMs: Date.now() - startedAt,
        outputChars: result.text.length,
        toolCalls: result.toolCalls.length,
        stopReason: result.stopReason,
        errorMessage: result.errorMessage || undefined
      },
      ts: Date.now()
    })
    return result
  }

  private async executeToolCall(call: OpenAiToolCall): Promise<string> {
    const spec = this.params.options.tools.find((item) => item.name === call.name)
    if (!spec) {
      this.emit({ type: 'tool_start', toolName: call.name, args: call.args })
      this.emit({ type: 'tool_end', toolName: call.name, args: call.args, isError: true })
      return `Tool "${call.name}" is not available.`
    }
    this.emit({ type: 'tool_start', toolName: call.name, args: call.args })
    const startedAt = Date.now()
    try {
      const text = await spec.execute(call.args)
      this.emit({ type: 'tool_end', toolName: call.name, args: call.args })
      this.params.options.onDebug?.({
        scope: this.params.options.scope,
        phase: 'ai-crms-tool-result',
        level: 'info',
        message: `tool ${call.name} returned.`,
        detail: { durationMs: Date.now() - startedAt, outputChars: text.length },
        ts: Date.now()
      })
      return text
    } catch (err) {
      const message = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')
      this.emit({ type: 'tool_end', toolName: call.name, args: call.args, isError: true })
      this.params.options.onDebug?.({
        scope: this.params.options.scope,
        phase: 'ai-crms-tool-error',
        level: 'error',
        message: `tool ${call.name} failed.`,
        detail: { durationMs: Date.now() - startedAt, error: message },
        ts: Date.now()
      })
      return `Tool "${call.name}" failed: ${message}`
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${this.params.session.jwt_token}`,
      'Content-Type': 'application/json',
      'x-region': normalizeCoachRegion(this.params.session.region)
    }
    if (this.params.session.tenant_id) headers['x-workspace-id'] = this.params.session.tenant_id
    return headers
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

interface AiCrmsRuntimeSessionParams {
  options: AgentRuntimeSessionOptions
  session: AuthSession
  url: string
}

type OpenAiChatMessage =
  | { role: 'user'; content: string | OpenAiUserContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiAssistantToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAiUserContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

interface OpenAiAssistantToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAiToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  argsText: string
}

interface StreamToolCallScratch {
  id?: string
  name?: string
  argsText: string
}

interface AssistantCompletionResult {
  message: OpenAiChatMessage
  text: string
  stopReason: string
  errorMessage: string
  toolCalls: OpenAiToolCall[]
}

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      reasoning_text?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  error?: {
    message?: string
    type?: string
    code?: string
  }
}

interface ChatCompletionJson {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: OpenAiAssistantToolCall[]
    }
    finish_reason?: string | null
  }>
  error?: {
    message?: string
    type?: string
    code?: string
  }
}

const normalizeProviderId = (providerId: string): string => providerId.trim().toLowerCase()

const chatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

const maxToolRounds = (): number => {
  const raw = Number(process.env.COACH_AI_CRMS_TOOL_ROUNDS)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 12
}

const buildCompletionBody = (options: AgentRuntimeSessionOptions, messages: OpenAiChatMessage[]): Record<string, unknown> => {
  const tools = buildOpenAiTools(options.tools)
  const enableThinking = options.target.thinkingLevel !== 'off'
  return {
    model: options.target.modelId,
    messages,
    stream: true,
    max_tokens: 8192,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    enable_thinking: enableThinking
  }
}

const buildOpenAiTools = (tools: AgentToolSpec[]): Array<Record<string, unknown>> =>
  tools.map((tool) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const param of tool.params) {
      properties[param.name] = {
        type: param.type || 'string',
        ...(param.description ? { description: param.description } : {})
      }
      if (param.required) required.push(param.name)
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required,
          additionalProperties: false
        }
      }
    }
  })

const buildUserMessage = (message: AgentRuntimePrompt): OpenAiChatMessage => {
  const imageParts = imageUrlParts(message)
  if (!imageParts.length) return { role: 'user', content: message.text }
  return {
    role: 'user',
    content: [{ type: 'text', text: message.text }, ...imageParts]
  }
}

const imageUrlParts = (message: AgentRuntimePrompt): OpenAiUserContentPart[] => {
  const refs = [...(message.media || []), ...(message.images || [])]
  const unique = new Set<string>()
  const parts: OpenAiUserContentPart[] = []
  for (const ref of refs) {
    const url = ref.kind === 'image' ? ref.url || '' : ''
    if (!url || !isDownloadableMediaUrl(url) || unique.has(url)) continue
    unique.add(url)
    parts.push({ type: 'image_url', image_url: { url } })
  }
  return parts
}

const hasMediaContent = (messages: OpenAiChatMessage[]): boolean =>
  messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'))

const parseOpenAiChatCompletion = async (
  res: Awaited<ReturnType<typeof fetch>>,
  emit: (event: AgentRuntimeEvent) => void,
  signal: AbortSignal
): Promise<AssistantCompletionResult> => {
  const contentType = res.headers.get('content-type') || ''
  if (/application\/json/i.test(contentType)) return await parseOpenAiChatJson(res, emit)
  return await parseOpenAiChatStream(res, emit, signal)
}

const parseOpenAiChatJson = async (
  res: Awaited<ReturnType<typeof fetch>>,
  emit: (event: AgentRuntimeEvent) => void
): Promise<AssistantCompletionResult> => {
  const body = (await res.json()) as ChatCompletionJson
  if (body.error) {
    return {
      message: { role: 'assistant', content: null },
      text: '',
      toolCalls: [],
      stopReason: 'error',
      errorMessage: sanitizeRuntimeError(body.error.message || body.error.code || body.error.type || 'AI-CRMS relay returned an error.', 'AI-CRMS relay')
    }
  }
  const choice = body.choices?.[0]
  const message = choice?.message
  const text = typeof message?.content === 'string' ? message.content : ''
  const thinking = firstString(message?.reasoning_content, message?.reasoning)
  if (thinking) {
    emit({ type: 'thinking_start' })
    emit({ type: 'thinking_delta', delta: thinking })
    emit({ type: 'thinking_end' })
  }
  if (text) emit({ type: 'text_delta', delta: text })
  const toolCalls = (message?.tool_calls || [])
    .map((item, index) =>
      finalizeToolCall(
        {
          id: item.id,
          name: item.function.name,
          argsText: item.function.arguments
        },
        index
      )
    )
    .filter((item): item is OpenAiToolCall => Boolean(item))
  return {
    message: {
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((item) => ({
              id: item.id,
              type: 'function',
              function: { name: item.name, arguments: item.argsText }
            }))
          }
        : {})
    },
    text,
    toolCalls,
    stopReason: mapFinishReason(choice?.finish_reason || '') || (toolCalls.length ? 'toolUse' : 'stop'),
    errorMessage: ''
  }
}

const parseOpenAiChatStream = async (
  res: Awaited<ReturnType<typeof fetch>>,
  emit: (event: AgentRuntimeEvent) => void,
  signal: AbortSignal
): Promise<AssistantCompletionResult> => {
  const toolScratch = new Map<number, StreamToolCallScratch>()
  let text = ''
  let stopReason = ''
  let errorMessage = ''
  let thinkingOpen = false
  for await (const data of iterateSseData(res, signal)) {
    if (data === '[DONE]') break
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(data) as ChatChunk
    } catch {
      continue
    }
    if (chunk.error) {
      errorMessage = sanitizeRuntimeError(chunk.error.message || chunk.error.code || chunk.error.type || 'AI-CRMS relay returned an error chunk.', 'AI-CRMS relay')
      continue
    }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) stopReason = mapFinishReason(choice.finish_reason)
    const delta = choice.delta
    if (!delta) continue
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      text += delta.content
      emit({ type: 'text_delta', delta: delta.content })
    }
    const thinkingDelta = firstString(delta.reasoning_content, delta.reasoning, delta.reasoning_text)
    if (thinkingDelta) {
      if (!thinkingOpen) {
        thinkingOpen = true
        emit({ type: 'thinking_start' })
      }
      emit({ type: 'thinking_delta', delta: thinkingDelta })
    }
    for (const toolCall of delta.tool_calls || []) {
      const index = typeof toolCall.index === 'number' ? toolCall.index : toolScratch.size
      const scratch = toolScratch.get(index) || { argsText: '' }
      if (toolCall.id) scratch.id = toolCall.id
      if (toolCall.function?.name) scratch.name = toolCall.function.name
      if (typeof toolCall.function?.arguments === 'string') scratch.argsText += toolCall.function.arguments
      toolScratch.set(index, scratch)
    }
  }
  if (thinkingOpen) emit({ type: 'thinking_end' })
  const toolCalls = Array.from(toolScratch.entries())
    .sort(([a], [b]) => a - b)
    .map(([, item], index) => finalizeToolCall(item, index))
    .filter((item): item is OpenAiToolCall => Boolean(item))
  const message: OpenAiChatMessage = {
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length
      ? {
          tool_calls: toolCalls.map((item) => ({
            id: item.id,
            type: 'function',
            function: { name: item.name, arguments: item.argsText }
          }))
        }
      : {})
  }
  return {
    message,
    text,
    toolCalls,
    stopReason: stopReason || (toolCalls.length ? 'toolUse' : 'stop'),
    errorMessage
  }
}

const iterateSseData = async function* (
  res: Awaited<ReturnType<typeof fetch>>,
  signal: AbortSignal
): AsyncGenerator<string> {
  if (!res.body) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    if (signal.aborted) throw new Error('AI-CRMS request was aborted')
    buffer += decoder.decode(chunk, { stream: true })
    let boundary = findSseBoundary(buffer)
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(buffer[boundary] === '\r' ? boundary + 4 : boundary + 2)
      const data = parseSseData(raw)
      if (data) yield data
      boundary = findSseBoundary(buffer)
    }
  }
  buffer += decoder.decode()
  const data = parseSseData(buffer)
  if (data) yield data
}

const findSseBoundary = (text: string): number => {
  const lf = text.indexOf('\n\n')
  const crlf = text.indexOf('\r\n\r\n')
  if (lf < 0) return crlf
  if (crlf < 0) return lf
  return Math.min(lf, crlf)
}

const parseSseData = (raw: string): string => {
  const lines = raw.split(/\r?\n/)
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
  return data
}

const finalizeToolCall = (item: StreamToolCallScratch, index: number): OpenAiToolCall | null => {
  const name = item.name || ''
  if (!name) return null
  const args = parseToolArgs(item.argsText)
  return {
    id: item.id || `call_${Date.now()}_${index}`,
    name,
    args,
    argsText: item.argsText || '{}'
  }
}

const parseToolArgs = (text: string): Record<string, unknown> => {
  const value = text.trim()
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { _raw: value }
  }
}

const mapFinishReason = (reason: string): string => {
  if (reason === 'tool_calls' || reason === 'function_call') return 'toolUse'
  if (reason === 'length') return 'length'
  if (reason === 'content_filter') return 'error'
  return reason || 'stop'
}

const firstString = (...values: Array<string | null | undefined>): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}
