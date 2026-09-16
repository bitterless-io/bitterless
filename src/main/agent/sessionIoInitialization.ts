import { modelIoLog } from './runtime/modelIoLog'
import { runInAgentSession } from './runtime/agentSessionContext'

export interface SessionIoConfiguration {
  systemPrompt: string
  providerId: string
  modelId: string
  thinkingLevel: string
  cwd: string
  workspace?: string
}

/** New-chat and immediate copy share one write. Retained evidence never creates or resets an agent. */
export class SessionIoInitialization {
  private pending = new Map<string, Promise<string>>()
  private incomplete = new Set<string>()

  ensure(sessionId: string, source: 'new-chat' | 'missing-history', snapshot: () => Promise<SessionIoConfiguration>): Promise<string> {
    const id = sessionId?.trim()
    if (!id) return Promise.reject(new Error('A chat session is required.'))
    const existing = this.pending.get(id)
    if (existing) return existing
    const pending = runInAgentSession(id, async () => {
      const saved = await modelIoLog.dirForSession(id)
      if (saved && !this.incomplete.has(id)) return saved
      const configuration = await snapshot()
      const written = await modelIoLog.append({
        kind: 'note', name: 'session-configuration', subject: source, turn: 0,
        text: configuration.systemPrompt,
        detail: {
          evidence: source === 'new-chat' ? 'initial-configuration' : 'current-configuration-only',
          explanation: source === 'new-chat'
            ? 'Initial configuration before any model request; this is not a sent prompt.'
            : 'Historical model I/O is unavailable. This is the current configuration, not a reconstruction of past requests or responses.',
          providerId: configuration.providerId, modelId: configuration.modelId,
          thinkingLevel: configuration.thinkingLevel, cwd: configuration.cwd,
          workspace: configuration.workspace
        }
      })
      const path = await modelIoLog.dirForSession(id)
      if (!written || !path) {
        this.incomplete.add(id)
        throw new Error('Unable to save the session diagnostic log. Check the application log and storage permissions.')
      }
      this.incomplete.delete(id)
      return path
    })
    this.pending.set(id, pending)
    void pending.finally(() => { if (this.pending.get(id) === pending) this.pending.delete(id) }).catch(() => undefined)
    return pending
  }
}
