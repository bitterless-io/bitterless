import type { AgentRuntimeContextSurface } from '../runtime/runtime.types'
import type { TurnSteeringInbox } from './turnSteeringInbox'

/** Retained results survive preparation, settled-turn and reset gaps without starting a new turn. */
export class BackgroundContextInbox {
  private readonly notes = new Map<string, string>()
  private readonly applied = new Set<string>()
  private readonly queued = new Set<string>()
  private generation = 0

  retain(id: string, text: string, inbox?: TurnSteeringInbox): void {
    this.notes.set(id, text)
    if (this.applied.has(id) || this.queued.has(id) || !inbox || inbox.isClosed) return
    this.queued.add(id)
    const generation = this.generation
    void inbox.enqueue({ messageId: id, text }).then(result => {
      if (generation !== this.generation) return
      this.queued.delete(id)
      if (result.outcome === 'delivered') this.applied.add(id)
    })
  }

  /** Only call before a model starts or after its entire tool loop has settled. */
  flush(surface?: AgentRuntimeContextSurface): void {
    if (!surface) return
    for (const [id, text] of this.notes) {
      if (this.applied.has(id) || this.queued.has(id)) continue
      const exists = surface.entries().some(entry => {
        const value = entry as { type?: string; customType?: string }
        return value.type === 'custom_message' && value.customType === id
      })
      if (exists || surface.appendCustomMessage(id, text)) this.applied.add(id)
    }
  }

  reset(): void { this.generation++; this.applied.clear(); this.queued.clear() }
}
