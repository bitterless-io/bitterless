import type { AgentRuntimeContextEntry, AgentRuntimeContextSurface, AgentRuntimeEvent, AgentRuntimePrompt, AgentRuntimeSession } from './agentRuntime.types'
import type { CodexDebugEvent } from './runtime.types'
import { normalizePiEvent, type PiSessionEvent } from './piRuntimeProtocol'
import { RUNTIME_SESSION_POLICY } from './runtimeSessionPolicy'
import { decideStreamingBehavior, type SteeringMode } from '../steering/steeringPolicy'

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
  debug?: (event: Omit<CodexDebugEvent, 'ts' | 'scope'>) => void
): void => {
  try {
    session.setAutoCompactionEnabled?.(RUNTIME_SESSION_POLICY.autoCompaction)
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

  constructor(
    private readonly session: PiSession,
    private readonly debug?: (event: Omit<CodexDebugEvent, 'ts' | 'scope'>) => void
  ) {}

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
   * `getEntries()` / `appendCustomMessageEntry()` / `appendCompaction()` 三个都是
   * `SessionManager` 的公开方法(`session-manager.d.ts:257` / `:219` / `:204`)。
   *
   * 每个成员都**按可选取**并 try 包住:pi 大版本挪走某一个,退化成「这条运行时不支持压缩」
   * (`entries()` 返回空 ⇒ 压缩如实报 `no-context-entries`),而不是让整个回合炸掉。
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
      appendCustomMessage: (customType: string, content: string) => {
        try {
          return manager()?.appendCustomMessageEntry?.(customType, content, false) ?? null
        } catch {
          return null
        }
      },
      appendCompaction: (summary: string, firstKeptEntryId: string, tokensBefore: number) => {
        try {
          return manager()?.appendCompaction?.(summary, firstKeptEntryId, tokensBefore) ?? null
        } catch {
          return null
        }
      }
    }
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): undefined | (() => void) {
    return this.session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) listener(normalized)
    })
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
    return await this.session.prompt(message.text, { streamingBehavior: decision.behavior })
  }

  async abort(): Promise<void> {
    this.aborting = true
    try {
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
  setAutoCompactionEnabled?: (enabled: boolean) => void
  readonly autoCompactionEnabled?: boolean
  readonly model?: { contextWindow?: number }
  subscribe: (listener: (event: PiSessionEvent) => void) => undefined | (() => void)
  /** `options.streamingBehavior` 在流式中**必填** —— 不传 pi 直接抛(`agent-session.js:735`)。 */
  prompt: (message: string, options?: { streamingBehavior?: 'steer' | 'followUp' }) => Promise<unknown>
  abort: () => Promise<void>
  readonly isStreaming?: boolean
  readonly isCompacting?: boolean
  readonly steeringMode?: SteeringMode
  getSteeringMessages?: () => readonly string[]
  /** pi `AgentSession.sessionManager`(公开只读,`agent-session.d.ts:165`)。压缩的候选批住这里。 */
  readonly sessionManager?: PiSessionManagerSurface
}

/**
 * pi `SessionManager` 上压缩要用到的那三个方法(同上,手写最小结构、全部可选)。
 * 条目形状对本文件是不透明的 —— 收窄归 pi 边界那一侧(`main/xpc/compaction.handler.ts`)。
 */
interface PiSessionManagerSurface {
  getEntries?: () => AgentRuntimeContextEntry[]
  appendCustomMessageEntry?: (customType: string, content: string, display: boolean) => string
  appendCompaction?: (summary: string, firstKeptEntryId: string, tokensBefore: number) => string
}

