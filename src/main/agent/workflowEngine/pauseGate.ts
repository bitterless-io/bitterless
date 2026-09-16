/** Cooperative boundaries: an already running request/tool drains; its context stays alive. */
export class PauseGate {
  private requested = false
  private active = 0
  private paused = false
  private waiters = new Set<() => void>()
  constructor(private signal: AbortSignal, private changed: (paused: boolean) => void = () => undefined) {
    signal.addEventListener('abort', () => { for (const wake of this.waiters) wake() }, { once: true })
  }
  pause(): void { this.requested = true; this.publish() }
  resume(): void {
    this.requested = false
    this.publish()
    for (const wake of this.waiters) wake()
  }
  private publish(): void {
    const paused = this.requested && this.active === 0
    if (paused !== this.paused) { this.paused = paused; this.changed(paused) }
  }
  async checkpoint(): Promise<void> {
    while (this.requested) {
      this.signal.throwIfAborted()
      this.publish()
      await new Promise<void>(resolve => { const wake = () => { this.waiters.delete(wake); resolve() }; this.waiters.add(wake) })
    }
    this.signal.throwIfAborted()
  }
  async enter(): Promise<void> { while (this.requested) await this.checkpoint(); this.signal.throwIfAborted(); this.active++; this.publish() }
  leave(): void { this.active = Math.max(0, this.active - 1); this.publish() }
}
