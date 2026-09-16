import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { ContentBlock, PromptResponse, SessionUpdate } from '@agentclientprotocol/sdk'
import type { MaestroChatApi, MaestroChatMessage, MaestroChatSession } from '../../shared/maestro/maestroChat.api'
import type { AgentConversationContext, AgentReply } from '../../shared/maestro/coach.api'
import { AcpError, type AcpHost, type AcpPromptContext, type AcpSession, type AcpSessionSetup } from './core/acpHost.type'
import { drainAgentTools, runAgentTurn, withExternalAgentTurn, type ExternalAgentEvent } from '../maestro/agent/runtime/agentExecutionContext'
import { registerExternalTurn } from './maestroAcp.lifecycle'

export interface MaestroAcpRuntime {
  prepare(): Promise<void>
  assertAccess(): void
  checkTarget(): Promise<{ ready: boolean }>
  prompt(params: { message: string; sessionId: string; context: AgentConversationContext }): Promise<AgentReply>
  abort(sessionId: string): Promise<void>
  release(sessionId: string): Promise<void>
}

const describe = (session: MaestroChatSession): AcpSession => ({
  sessionId: session.id,
  cwd: session.detail.workspace?.path || '',
  title: session.title,
  updatedAt: new Date(session.updatedAt).toISOString()
})

const messageUpdate = (message: MaestroChatMessage): SessionUpdate => ({
  sessionUpdate: message.role === 'human' ? 'user_message_chunk' : 'agent_message_chunk',
  content: { type: 'text', text: message.content }
})

const promptText = (prompt: ContentBlock[]): string => prompt.map((block) => {
  if (block.type === 'text') return block.text
  if (block.type === 'resource_link') return `[Resource: ${block.name}](${block.uri})${block.description ? '\n' + block.description : ''}`
  throw new AcpError(-32602, `Unsupported prompt content: ${block.type}. Use text or resource_link.`)
}).join('\n\n')

/** Uses Maestro's actual controller and SQLite conversation API; it never constructs a model. */
export class MaestroAcpHost implements AcpHost {
  readonly info = { name: 'bitterless-maestro', title: 'Bitterless Maestro', version: '1.0.0' }
  readonly authMethods = [{ id: 'bitterless-login', name: 'Sign in through Bitterless', description: 'Open Bitterless, sign in and configure AI Login. Then retry authenticate.' }]
  readonly promptCapabilities = { image: false, audio: false, embeddedContext: false }
  readonly supportsMcpServers = false

  constructor(private readonly store: Pick<MaestroChatApi, 'listExternalSessions' | 'getExternalSession' | 'saveExternalSession'>, private readonly runtime: MaestroAcpRuntime) {}

  async checkAccess(): Promise<void> {
    try {
      this.runtime.assertAccess()
      await this.runtime.prepare()
      this.runtime.assertAccess()
      if (!(await this.runtime.checkTarget()).ready) throw new Error('Configure AI Login in Bitterless before using ACP')
    } catch (error) {
      throw new AcpError(-32000, error instanceof Error ? error.message : 'Bitterless authentication required')
    }
  }

  async authenticate(methodId: string): Promise<void> {
    if (methodId !== 'bitterless-login') throw new AcpError(-32602, 'Unknown authentication method')
    await this.checkAccess()
  }

  async createSession(params: AcpSessionSetup): Promise<AcpSession> {
    this.runtime.assertAccess()
    const now = Date.now()
    const session: MaestroChatSession = {
      id: `acp:${randomUUID()}`, operationTabId: '__acp__', title: 'External ACP session',
      createdAt: now, updatedAt: now,
      detail: { compressedContext: '', externalHistory: [], workspace: { path: params.cwd, name: basename(params.cwd), exists: true, updatedAt: now } },
      messages: []
    }
    await this.save(session)
    return describe(session)
  }

  async getSession(sessionId: string): Promise<AcpSession | undefined> {
    const session = await this.read(sessionId)
    return session ? describe(session) : undefined
  }

  async listSessions(): Promise<AcpSession[]> {
    const rows = await this.store.listExternalSessions()
    return rows.filter((row) => row.id.startsWith('acp:') && row.operationTabId === '__acp__' && row.cwd).map((row) => ({
      sessionId: row.id, cwd: row.cwd!, title: row.title, updatedAt: new Date(row.updatedAt).toISOString()
    }))
  }

  async loadSession(params: AcpSessionSetup & { sessionId: string }): Promise<{ session: AcpSession; history: SessionUpdate[] }> {
    const session = await this.requireSession(params.sessionId)
    if (params.cwd !== session.detail.workspace?.path) throw new AcpError(-32602, 'cwd must match the saved session workspace')
    await this.runtime.release(session.id)
    return { session: describe(session), history: session.detail.externalHistory || session.messages.filter((message) => message.content).map(messageUpdate) }
  }

  async prompt(sessionId: string, prompt: ContentBlock[], context: AcpPromptContext): Promise<PromptResponse> {
    const message = promptText(prompt)
    if (!message.trim()) throw new AcpError(-32602, 'Prompt must not be empty')
    try {
      return await runAgentTurn(async () => await this.executePrompt(sessionId, { text: message, prompt, context }))
    } catch (error) {
      if (error instanceof Error && error.message.includes('busy with another turn')) throw new AcpError(-32600, error.message)
      throw error
    }
  }

  private async executePrompt(sessionId: string, options: { text: string; prompt: ContentBlock[]; context: AcpPromptContext }): Promise<PromptResponse> {
    const { text, prompt, context } = options
    this.runtime.assertAccess()
    const session = await this.requireSession(sessionId)
    if (context.signal.aborted) return { stopReason: 'cancelled' }
    const recentMessages = session.messages.filter((message) => !message.error).map(({ role, content, ts }) => ({ role, content, ts }))
    const now = Date.now()
    const history = session.detail.externalHistory ??= session.messages.filter((message) => message.content).map(messageUpdate)
    for (const content of prompt) history.push({ sessionUpdate: 'user_message_chunk', content })
    session.messages.push({ id: randomUUID(), source: 'cowork', role: 'human', content: text, streaming: false, ts: now })
    const answer: MaestroChatMessage = { id: randomUUID(), source: 'cowork', role: 'ai', content: '', streaming: true, ts: now }
    session.messages.push(answer)
    if (session.messages.length === 2) session.title = text.slice(0, 100)
    await this.save(session)

    const controller = new AbortController()
    let abortDrain: Promise<void> = Promise.resolve()
    const onAbort = (): void => {
      if (controller.signal.aborted) return
      controller.abort()
      abortDrain = this.runtime.abort(sessionId).catch(() => undefined)
    }
    context.signal.addEventListener('abort', onAbort, { once: true })
    if (context.signal.aborted) onAbort()
    let streamError: unknown
    let persistenceError: unknown
    let persistence = Promise.resolve()
    let persistTimer: ReturnType<typeof setTimeout> | undefined
    const checkpoint = (): void => {
      persistTimer = undefined
      persistence = persistence.then(async () => await this.save(session)).catch((error) => { persistenceError = error; onAbort() })
    }
    let updates = Promise.resolve()
    let queuedUpdates = 0
    const emit = (update: SessionUpdate): void => {
      const previous = history.at(-1)
      if (previous && previous.sessionUpdate === update.sessionUpdate &&
          (previous.sessionUpdate === 'agent_message_chunk' || previous.sessionUpdate === 'agent_thought_chunk') &&
          (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') &&
          previous.content.type === 'text' && update.content.type === 'text' &&
          previous.content.text.length + update.content.text.length <= 64_000) {
        previous.content.text += update.content.text
      } else history.push(structuredClone(update))
      if (!persistTimer) persistTimer = setTimeout(checkpoint, 1000)
      queuedUpdates += 1
      if (queuedUpdates > 2048) {
        streamError = new Error('ACP client cannot keep up with runtime output')
        onAbort()
        return
      }
      updates = updates.then(async () => {
        try { if (!context.signal.aborted) await context.emit(update) } finally { queuedUpdates -= 1 }
      }).catch((error) => { streamError = error; onAbort() })
    }
    const onEvent = (event: ExternalAgentEvent): void => {
      if (controller.signal.aborted) return
      if (event.type === 'text' || event.type === 'thought') {
        if (event.type === 'text') answer.content += event.text
        emit({ sessionUpdate: event.type === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk', content: { type: 'text', text: event.text } })
      } else {
        emit({
          sessionUpdate: event.status === 'in_progress' ? 'tool_call' : 'tool_call_update',
          toolCallId: event.id, title: event.title, status: event.status,
          ...(event.input !== undefined ? { rawInput: event.input } : {}),
          ...(event.output !== undefined ? { content: [{ type: 'content', content: { type: 'text', text: event.output.slice(0, 64_000) } }], rawOutput: event.output.slice(0, 64_000) } : {})
        })
      }
    }
    let complete: () => void = () => undefined
    const completed = new Promise<void>((resolve) => { complete = resolve })
    let drain: Promise<AgentReply> | undefined
    const unregister = registerExternalTurn(async () => { onAbort(); await completed })
    try {
      if (controller.signal.aborted) return { stopReason: 'cancelled' }
      drain = withExternalAgentTurn({
        sessionId, signal: controller.signal, emit: onEvent,
        permission: async (request) => {
          if (controller.signal.aborted) return false
          const decision = context.requestPermission({
            toolCall: { toolCallId: request.id, title: request.title, status: 'pending', rawInput: request.input },
            options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny-once', name: 'Deny', kind: 'reject_once' }]
          })
          return await new Promise<boolean>((resolve) => {
            const cancelled = (): void => { resolve(false) }
            controller.signal.addEventListener('abort', cancelled, { once: true })
            if (controller.signal.aborted) cancelled()
            void decision.then((response) => {
              controller.signal.removeEventListener('abort', cancelled)
              resolve(!controller.signal.aborted && response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow-once')
            }, () => {
              controller.signal.removeEventListener('abort', cancelled)
              resolve(false)
            })
          })
        }
      }, async () => await this.runtime.prompt({ message: text, sessionId, context: { workspace: session.detail.workspace, recentMessages } }))
      const reply = await drain
      if (!answer.content && reply.text) {
        answer.content = reply.text
        emit(messageUpdate(answer))
      }
      answer.error = !reply.ok && !controller.signal.aborted
      await updates
      if (streamError && !context.signal.aborted) throw streamError
      if (persistenceError) throw persistenceError
      if (controller.signal.aborted) return { stopReason: 'cancelled' }
      if (!reply.ok) throw new AcpError(-32603, reply.text || reply.error || 'Maestro runtime failed', { runtimeCode: reply.error })
      return { stopReason: reply.stopReason === 'length' ? 'max_tokens' : reply.stopReason === 'refusal' ? 'refusal' : reply.stopReason === 'aborted' ? 'cancelled' : 'end_turn' }
    } catch (error) {
      answer.error = !controller.signal.aborted
      if (streamError && !context.signal.aborted) throw streamError
      if (persistenceError) throw persistenceError
      if (controller.signal.aborted) return { stopReason: 'cancelled' }
      throw error
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      answer.streaming = false
      if (persistTimer) clearTimeout(persistTimer)
      try { await abortDrain; await drainAgentTools(); await updates; await persistence; await this.save(session) } finally { unregister(); complete() }
    }
  }

  async closeSession(sessionId: string): Promise<void> { await this.runtime.release(sessionId) }

  private async read(id: string): Promise<MaestroChatSession | null> {
    if (!id.startsWith('acp:')) return null
    const session = await this.store.getExternalSession({ id })
    return session?.operationTabId === '__acp__' ? session : null
  }

  private async requireSession(id: string): Promise<MaestroChatSession> {
    const session = await this.read(id)
    if (!session) throw new AcpError(-32002, 'Unknown external session')
    return session
  }

  private async save(session: MaestroChatSession): Promise<void> {
    session.updatedAt = Date.now()
    if (!(await this.store.saveExternalSession({ session })).ok) throw new Error('External session could not be persisted')
  }
}
