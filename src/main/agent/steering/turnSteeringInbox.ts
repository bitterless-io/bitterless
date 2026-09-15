import type { AgentRuntimePrompt, AgentRuntimeSession } from '../runtime/agentRuntime.types'

export interface SteeringDelivery { outcome: 'delivered' | 'failed'; error?: string }
interface Entry {
  message: AgentRuntimePrompt
  state: 'waiting' | 'queued' | 'done'
  result: Promise<SteeringDelivery>
  resolve: (result: SteeringDelivery) => void
}

/** One host Turn owns this inbox from reservation through runtime cleanup. */
export class TurnSteeringInbox {
  private entries = new Map<string, Entry>()
  private runtime?: AgentRuntimeSession
  private pumping: Promise<void> = Promise.resolve()
  private closed = false
  private cancelWait: () => void = () => undefined
  private cancelled = new Promise<void>(resolve => { this.cancelWait = resolve })

  enqueue(message: AgentRuntimePrompt): Promise<SteeringDelivery> {
    if (this.closed) return Promise.resolve({ outcome: 'failed', error: 'The turn has finished; this message was not queued. Send it again.' })
    if (!message.messageId) return Promise.resolve({ outcome: 'failed', error: 'A steering message requires its message ID.' })
    const existing = this.entries.get(message.messageId)
    if (existing) return existing.result
    let resolve: Entry['resolve'] = () => undefined
    const result = new Promise<SteeringDelivery>(done => { resolve = done })
    this.entries.set(message.messageId, { message: { ...message }, state: 'waiting', result, resolve })
    this.pump()
    return result
  }

  consume(messageId: string): void {
    const entry = this.entries.get(messageId)
    if (!entry || entry.state === 'done') return
    entry.state = 'done'
    entry.resolve({ outcome: 'delivered' })
  }

  start(runtime: AgentRuntimeSession): void {
    this.runtime = runtime
    this.pump()
  }

  async pause(): Promise<void> {
    this.runtime = undefined
    await Promise.race([this.pumping, this.cancelled])
  }

  private pump(): void {
    const runtime = this.runtime
    if (!runtime || this.closed || !runtime.enqueueSteering || !runtime.takePendingSteering) return
    this.pumping = this.pumping.then(async () => {
      for (const entry of this.entries.values()) {
        if (this.closed || this.runtime !== runtime) return
        if (entry.state !== 'waiting') continue
        entry.state = 'queued'
        try {
          const accepted = await runtime.enqueueSteering!(entry.message)
          if (accepted === false) { entry.state = 'waiting'; return }
        } catch (error) {
          if ((entry.state as Entry['state']) !== 'done') {
            entry.state = 'done'
            entry.resolve({ outcome: 'failed', error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    })
  }

  /** Called only after the native run and enqueue writes settle, with pumping paused. */
  next(runtime?: AgentRuntimeSession): AgentRuntimePrompt | undefined {
    if (this.closed) return undefined
    const remaining = new Set((runtime?.takePendingSteering?.() || []).map(message => message.messageId))
    for (const entry of this.entries.values()) {
      if (entry.state === 'queued') {
        if (remaining.has(entry.message.messageId)) entry.state = 'waiting'
        else {
          entry.state = 'done'
          entry.resolve({ outcome: 'failed', error: 'The runtime ended without confirming delivery of this message.' })
        }
      }
    }
    const next = [...this.entries.values()].find(entry => entry.state === 'waiting')
    if (next) {
      next.state = 'queued'
      return next.message
    }
    // No await between the empty check and closing admission.
    this.closed = true
    return undefined
  }

  cancel(error: string): void {
    this.closed = true
    this.runtime = undefined
    this.cancelWait()
    for (const entry of this.entries.values()) {
      if (entry.state === 'done') continue
      entry.state = 'done'
      entry.resolve({ outcome: 'failed', error })
    }
  }

  get isClosed(): boolean { return this.closed }
}
