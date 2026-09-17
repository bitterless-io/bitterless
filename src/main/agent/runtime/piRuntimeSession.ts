import type { AgentRuntimeContextEntry, AgentRuntimeContextSurface, AgentRuntimeEvent, AgentRuntimePrompt, AgentRuntimeSession } from './agentRuntime.types'
import type { CodexDebugEvent } from './runtime.types'
import { normalizePiEvent, type PiSessionEvent } from './piRuntimeProtocol'
import { RUNTIME_SESSION_POLICY } from './runtimeSessionPolicy'
import { decideStreamingBehavior, type SteeringMode } from '../steering/steeringPolicy'
import { resolveRuntimeSystemPrompt } from './runtimeSystemPrompt'

const STEERING_MODE = RUNTIME_SESSION_POLICY.steeringMode

/** pi `AgentSession` 上与 steeringMode 有关的那一小片(本文件对 pi 一贯手写最小结构)。 */
interface PiSteeringModeSurface {
  setSteeringMode?: (mode: SteeringMode) => void
  readonly steeringMode?: SteeringMode
}

/**
 * 建会话时把 `steeringMode` **显式**设成 `one-at-a-time`,并把实际值报出来。
 *
 * 导出仅为可测:「它被显式设置过」这条只有拿到这个函数、喂一个假 session 才验得动 ——
 * 源码正则只能看见那行字在,看不见它被执行。
 */
export const applySteeringMode = (
  session: PiSteeringModeSurface,
  debug?: (event: { phase: string; level: 'info' | 'warn'; message: string; detail?: unknown }) => void
): void => {
  let applied = false
  try {
    if (typeof session.setSteeringMode === 'function') {
      session.setSteeringMode(STEERING_MODE)
      applied = true
    }
  } catch {
    applied = false
  }
  debug?.({
    phase: 'pi-steering-mode',
    level: applied ? 'info' : 'warn',
    message: applied
      ? `pi steeringMode explicitly set to ${STEERING_MODE} (now: ${session.steeringMode ?? 'unknown'}).`
      : `pi has no setSteeringMode() — steeringMode left at the SDK default (${session.steeringMode ?? 'unknown'}); 策略表第 3 条可能失效`,
    detail: { requested: STEERING_MODE, actual: session.steeringMode, applied }
  })
}

/** Apply host session policy through the native pi controls, retaining diagnostic visibility. */
export const applyPiSessionPolicy = (
  session: PiSession,
  debug?: (event: Omit<CodexDebugEvent, 'ts' | 'scope'>) => void,
  autoCompaction: boolean = RUNTIME_SESSION_POLICY.autoCompaction
): void => {
  try {
    session.setAutoCompactionEnabled?.(autoCompaction)
  } catch {
    // Older SDKs may lack the switch; report the actual state below.
  }
  debug?.({
    phase: 'pi-compaction-config',
    level: session.autoCompactionEnabled === false ? 'warn' : 'info',
    message: `pi auto-compaction: ${session.autoCompactionEnabled === false ? 'OFF (context will only grow)' : 'on'} · model contextWindow ${session.model?.contextWindow ?? 'unknown'}`,
    detail: { autoCompaction: session.autoCompactionEnabled, contextWindow: session.model?.contextWindow }
  })
  applySteeringMode(session, debug)
}

// 导出仅为可测:steering 的投递(到底把什么 streamingBehavior 交给了 pi、有没有多调什么)只有在能
// 拿到这个类、喂一个假 pi session 时才验得动 —— 否则守卫只能退回源码正则,而正则只能看见那行字在,
// 看不见它被执行。
export class PiRuntimeSession implements AgentRuntimeSession {
  /** 本回合正在收尾(策略表第 4 条)。pi 没有这个 getter,只能由发起 abort 的这一侧记。 */
  private aborting = false
  private pendingSteering: AgentRuntimePrompt[] = []
  private heldSteering = new Set<AgentRuntimePrompt>()
  private compacting = false
  private startingMessage?: AgentRuntimePrompt
  private listeners = new Set<(event: AgentRuntimeEvent) => void>()
  private unsubscribeNative?: () => void
  private appliedResourceRevision?: string

  constructor(
    private readonly session: PiSession,
    private readonly debug?: (event: Omit<CodexDebugEvent, 'ts' | 'scope'>) => void,
    private readonly promptSource?: { hostText: string; cwd: string; resourceRevision?: () => string; skillPrompt?: (activeTools: string[]) => string },
    private readonly compactionState?: import('./piNativeCompaction').PiCompactionState
  ) {
    this.appliedResourceRevision = promptSource?.resourceRevision?.()
    if (compactionState) compactionState.onEvent = event => { if (this.compacting && !this.aborting) this.emit(event) }
  }

  /**
   * pi has no public system setter. Re-selecting the unchanged active tool names rebuilds its
   * base prompt from our loader, without resetting messages. Direct state assignment would be
   * overwritten by pi on the next prompt. File discovery and prompt composition stay in the host.
   */
  setSystemPrompt(text: string): void {
    const source = this.promptSource
    if (!source || !this.session.getActiveToolNames || !this.session.setActiveToolsByName) {
      throw new Error('The runtime does not support updating the system prompt.')
    }
    if (this.session.isStreaming || this.session.isCompacting) {
      throw new Error('Cannot update the system prompt during an active turn.')
    }
    const next = resolveRuntimeSystemPrompt({ systemPrompt: text, cwd: source.cwd })
    const previous = source.hostText
    const activeTools = this.session.getActiveToolNames()
    source.hostText = next.hostText
    try {
      this.session.setActiveToolsByName(activeTools)
      const expected = resolveRuntimeSystemPrompt({ systemPrompt: next.hostText + (source.skillPrompt?.(activeTools) || ''), cwd: source.cwd }).finalSystemPrompt
      if (this.session.systemPrompt !== expected) {
        throw new Error('The runtime did not apply the requested system prompt.')
      }
      this.appliedResourceRevision = source.resourceRevision?.()
    } catch (error) {
      source.hostText = previous
      this.session.setActiveToolsByName(activeTools)
      throw error
    }
  }

  /**
   * pi 此刻是否在流式(直接透 `AgentSession.isStreaming`)。
   *
   * `BaseAgent.steerActiveTurn` 在**投递之前**读它:非流式时 pi 会把这条消息当成一次**普通
   * prompt** 跑起来(`agent-session.js:737` 只在 `isStreaming` 为真时才走入队分支),于是它抢走
   * `activeRun`,而真正的第一条反倒变成 steer 入队 —— 角色反转。缺了这个只读面,那个判断就无从做起。
   */
  get isStreaming(): boolean {
    return this.session.isStreaming === true
  }

  /**
   * 上下文条目面 —— 压缩的候选批与落点(契约「候选批的来源」,2026-08-28 定案)。
   *
   * 直透 pi 的 `AgentSession.sessionManager`(`agent-session.d.ts:165`,公开只读成员)。
   * 原始条目用于候选/结构图；有效导出直接读公开的 `buildContextEntries()`，不支持则明确失败。
   * 写入使用公开 append 方法，并同步 `agent.state.messages` 为 `buildSessionContext().messages`。
   * 缺少同步能力时在 append 之前返回 null，由压缩调用方报告写入失败。
   *
   * ⚠ **写入会推进 `leafId`**,所以只能在回合之间调 —— 两个调用点
   * (`turn.service.ts:234` 发送前 / `:310` 回合结束后)都在回合之外。
   */
  get context(): AgentRuntimeContextSurface {
    const manager = (): PiSessionManagerSurface | undefined => this.session.sessionManager
    return {
      entries: () => {
        try {
          return manager()?.getEntries?.() ?? []
        } catch {
          return []
        }
      },
      contextEntries: () => {
        const current = manager()
        if (typeof current?.buildContextEntries !== 'function') {
          throw new Error('The runtime does not support reading effective context entries.')
        }
        return current.buildContextEntries()
      },
      appendCustomMessage: (customType: string, content: string) => {
        return this.appendContextEntry((current) => current.appendCustomMessageEntry?.(customType, content, false))
      },
      appendCompaction: (summary: string, firstKeptEntryId: string, tokensBefore: number) => {
        return this.appendContextEntry((current) => current.appendCompaction?.(summary, firstKeptEntryId, tokensBefore))
      }
    }
  }

  private appendContextEntry(write: (manager: PiSessionManagerSurface) => string | undefined): string | null {
    const manager = this.session.sessionManager
    const state = this.session.agent?.state
    if (!manager?.buildSessionContext || !state) return null
    try {
      const id = write(manager)
      if (!id) return null
      // 与 pi 原生压缩相同；manager 写树本身不会更新下一轮实际发送的 live messages。
      state.messages = manager.buildSessionContext().messages
      return id
    } catch {
      return null
    }
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      this.unsubscribeNative = this.session.subscribe((event) => {
        if (event.type === 'compaction_start') this.compacting = true
        if (event.type === 'compaction_end') {
          this.compacting = false
          if (!this.aborting) this.releaseHeldSteering()
        }
        if (event.type === 'message_start' && event.message?.role === 'user') {
          const content = event.message.content
          const text = typeof content === 'string' ? content : (content || []).filter(part => part.type === 'text').map(part => part.text || '').join('')
          let consumed: AgentRuntimePrompt | undefined
          if (this.startingMessage?.text === text) {
            consumed = this.startingMessage
            this.startingMessage = undefined
          } else {
            const index = this.pendingSteering.findIndex(message => message.text === text)
            if (index >= 0) consumed = this.pendingSteering.splice(index, 1)[0]
          }
          if (consumed?.messageId) this.emit({ type: 'steering_consumed', messageId: consumed.messageId })
        }
        for (const normalized of normalizePiEvent(event.type === 'compaction_end' && this.compactionState?.error ? { ...event, errorMessage: this.compactionState.error, aborted: false } as PiSessionEvent : event)) {
          if ((normalized.type === 'compaction_retry' || normalized.type === 'compaction_attempt' || normalized.type === 'compaction_retry_finished') && !this.compacting) continue
          this.emit(normalized)
        }
      }) || undefined
    }
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) { this.unsubscribeNative?.(); this.unsubscribeNative = undefined }
    }
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  async enqueueSteering(message: AgentRuntimePrompt): Promise<void | boolean> {
    if (this.aborting) throw new Error('The turn is stopping; this message was not queued.')
    if (!this.session.steer || !this.session.clearQueue) return false
    const queued = { ...message }
    this.pendingSteering.push(queued)
    try {
      // One FIFO queue. A later steer must not jump ahead of an earlier follow-up.
      if (this.compacting || this.session.isCompacting) this.heldSteering.add(queued)
      else await this.session.steer(message.text)
    } catch (error) {
      this.pendingSteering = this.pendingSteering.filter(item => item !== queued)
      throw error
    }
  }

  private releaseHeldSteering(): void {
    for (const message of this.heldSteering) {
      this.heldSteering.delete(message)
      // Native steer enqueues synchronously before its Promise resolves. Invoke in FIFO order
      // before Pi decides whether a completed run needs a continuation.
      void this.session.steer?.(message.text).catch(error => {
        this.debug?.({ phase: 'steering-release-error', level: 'warn', message: String(error) })
      })
    }
  }

  takePendingSteering(): AgentRuntimePrompt[] {
    this.session.clearQueue?.()
    this.heldSteering.clear()
    const pending = this.pendingSteering
    this.pendingSteering = []
    return pending
  }

  async prompt(message: AgentRuntimePrompt): Promise<unknown> {
    // 回合内 steering(docs/features/cowork-turn-steering.md)。**默认 steer,投递方式与工具无关**
    // (`steer` 不打断执行中的工具,pi 只在下一个工具边界取队)。代价不对称:
    // 「补充信息」被误判成 steer 只多插一次且内容不丢(它进 entry 树,模型下一步就看到);
    // 「改方向」被误判成 followUp,用户要看着 AI 把一条已经被否掉的路跑到回合结束。
    const decision = decideStreamingBehavior({
      streaming: this.session.isStreaming === true,
      compacting: this.session.isCompacting === true,
      pendingSteeringCount: this.session.getSteeringMessages?.().length ?? 0,
      steeringMode: this.session.steeringMode ?? RUNTIME_SESSION_POLICY.steeringMode,
      aborting: this.aborting
    })
    if (decision.rule !== 0) {
      this.debug?.({
        phase: 'steering-decision',
        level: 'info',
        message: `steering rule #${decision.rule} → ${decision.behavior} (${decision.reason}).`,
        detail: { rule: decision.rule, behavior: decision.behavior, reason: decision.reason }
      })
    }
    // The current pi SDK native media option expects inline base64 payloads. Cowork keeps
    // attachments as path/url refs instead, so pi receives the textual @path note until
    // an adapter surface can consume refs without copying bytes.
    this.startingMessage = message
    try {
      const revision = this.promptSource?.resourceRevision?.()
      if (!this.session.isStreaming && !this.session.isCompacting && revision !== this.appliedResourceRevision) {
        if (!this.session.reload) throw new Error('The runtime cannot reload changed Skill resources.')
        await this.session.reload()
        this.appliedResourceRevision = this.promptSource?.resourceRevision?.()
      }
      return await this.session.prompt(message.text, { streamingBehavior: decision.behavior })
    } finally {
      if (this.startingMessage === message) this.startingMessage = undefined
    }
  }

  async compact(instructions?: string): Promise<{ summary: string; tokensBefore: number; estimatedTokensAfter?: number }> {
    if (this.session.isStreaming || this.session.isCompacting) throw new Error('Wait for the current turn to finish before using /compact.')
    if (!this.session.compact) throw new Error('This runtime does not support /compact.')
    if (this.compactionState) this.compactionState.error = undefined
    try { return await this.session.compact(instructions) }
    catch (error) { throw new Error(this.compactionState?.error || (error instanceof Error ? error.message : String(error))) }
  }

  async abort(): Promise<void> {
    this.aborting = true
    try {
      this.session.abortCompaction?.()
      await this.session.abort()
    } finally {
      // pi 的 abort() 「等 agent 回到空闲」才 resolve,所以这一段正好就是收尾窗口。
      this.aborting = false
    }
  }
}

/**
 * 手写的 pi 会话最小结构(本文件对 pi 的类型一贯如此,不直接吃 SDK 类型)。
 *
 * steering 用到的四个成员全部标成**可选** —— 它们都是 pi `AgentSession` 上的真实公开成员
 * (`isStreaming` / `isCompacting` / `steeringMode` / `getSteeringMessages`),
 * 标可选是为了让 SDK 大版本挪动字段时退化成「按不在流式处理」,而不是让整个回合炸掉。
 */
export interface PiSession extends PiSteeringModeSurface {
  compact?: (instructions?: string) => Promise<{ summary: string; tokensBefore: number; estimatedTokensAfter?: number }>
  abortCompaction?: () => void
  reload?: () => Promise<void>
  readonly systemPrompt?: string
  getActiveToolNames?: () => string[]
  setActiveToolsByName?: (toolNames: string[]) => void
  setAutoCompactionEnabled?: (enabled: boolean) => void
  readonly autoCompactionEnabled?: boolean
  readonly model?: { contextWindow?: number }
  subscribe: (listener: (event: PiSessionEvent) => void) => undefined | (() => void)
  /** `options.streamingBehavior` 在流式中**必填** —— 不传 pi 直接抛(`agent-session.js:735`)。 */
  prompt: (message: string, options?: { streamingBehavior?: 'steer' | 'followUp' }) => Promise<unknown>
  abort: () => Promise<void>
  steer?: (text: string) => Promise<void>
  clearQueue?: () => { steering: string[]; followUp: string[] }
  readonly isStreaming?: boolean
  readonly isCompacting?: boolean
  readonly steeringMode?: SteeringMode
  getSteeringMessages?: () => readonly string[]
  /** pi `AgentSession.sessionManager`(公开只读,`agent-session.d.ts:165`)。压缩的候选批住这里。 */
  readonly sessionManager?: PiSessionManagerSurface
  /** pi AgentSession.agent.state is public; assigning messages copies the top-level array. */
  readonly agent?: { readonly state: { messages: unknown[] } }
}

/**
 * pi `SessionManager` 上下文所用的公开方法(同上,手写最小结构、全部可选)。
 * 条目形状对本文件是不透明的 —— 收窄归 pi 边界那一侧(`main/xpc/compaction.handler.ts`)。
 */
interface PiSessionManagerSurface {
  getEntries?: () => AgentRuntimeContextEntry[]
  buildContextEntries?: () => AgentRuntimeContextEntry[]
  buildSessionContext?: () => { messages: unknown[] }
  appendCustomMessageEntry?: (customType: string, content: string, display: boolean) => string
  appendCompaction?: (summary: string, firstKeptEntryId: string, tokensBefore: number) => string
}
