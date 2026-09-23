import type { AgentRuntimePrompt, AgentRuntimeSession } from '../runtime/agentRuntime.types'

export interface SteeringDelivery { outcome: 'delivered' | 'failed' | 'withdrawn'; error?: string }
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

  /**
   * **取回** —— 把还没送到模型手上的排队消息整批拿回来。
   *
   * pi 自己的 TUI 就是这么做的:`app.message.dequeue`(默认 alt+up / Windows alt+q,说明文字
   * 「Restore queued messages」)→ `restoreQueuedMessagesToEditor()` → `clearQueue()`,整批回到编辑器。
   * pi 的 API **只能整批清**,所以这里也是整批 —— 不自造一个运行时兑现不了的语义。
   *
   * 三种下场:
   *  · `waiting` —— 还没交给运行时,直接取回;
   *  · `queued` 且 pi 把它还了回来 —— 还躺在 pi 的队列里,取回;
   *  · `queued` 但 pi 没还 —— **已经送到模型那里了,取不回**,原样留着等它自己的回执。
   *    谎报成"取回"等于让人以为那句话没发生过,而它已经在模型的上下文里。
   */
  async withdraw(messageIds?: string[]): Promise<AgentRuntimePrompt[]> {
    const runtime = this.runtime
    // 先让在飞的那一次 pump 落地,免得取完又被塞回 pi 的队列。
    await Promise.race([this.pumping, this.cancelled])
    // `takePendingSteering()` 是整批的(pi 的 `clearQueue()` 只能整批)—— 所以"取回其中一条"
    // 等于**全部拿走、再把其余的按原顺序放回去**。
    const pending = runtime?.takePendingSteering?.() || []
    const wanted = messageIds?.length ? new Set(messageIds) : undefined
    const returned = new Set(pending.map(message => message.messageId))
    const taken: AgentRuntimePrompt[] = []
    for (const entry of this.entries.values()) {
      if (entry.state === 'done') continue
      if (wanted && !wanted.has(entry.message.messageId!)) continue
      if (entry.state === 'queued' && !returned.has(entry.message.messageId)) continue
      entry.state = 'done'
      entry.resolve({ outcome: 'withdrawn' })
      taken.push(entry.message)
    }
    const takenIds = new Set(taken.map(message => message.messageId))
    const keep = pending.filter(message => !takenIds.has(message.messageId))
    if (keep.length) await runtime?.requeueSteering?.(keep)
    return taken
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
