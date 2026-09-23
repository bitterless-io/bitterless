import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { describeErrorForLog, turnDiagnostics, type MaestroTurnStage } from './turnDiagnostics.service'
import type {
  AgentActivityStep,
  AgentConversationContext,
  AgentMessageSnapshot,
  AgentReply,
  AgentStreamDelta,
  AgentThinkingState,
  AgentTurnUpdate,
  CoachXpcContract
} from '@maestro-shared/coach.api'
import type { MaestroTask } from '@maestro-shared/task.api'
import type { ChatAttachment, ChatMessage, MessageSession, Turn } from './message.type'
import type { MessageStoreState } from './message.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

/**
 * 并发上限。**这是工程策略,不是模型限制** —— Main 现在也原子持有同一个全局 root Turn 槽,
 * renderer 这一层保留同步 UX 闸门。即使将来放开模型并发,仍有两类全局状态需要先拆开:
 *
 *  1. `coach/tasks` 是全局快照,`bindTask` 同样靠"当前活跃回合"猜;
 *  2. CDP / 浏览器工具驱动当前操作 tab,两个回合同时钻会互相踩。
 *
 * 放开并发 = 改 renderer + Main 两道 gate,再补上述归属,**不需要改状态结构**。
 */
const MAX_CONCURRENT_TURNS = 4

/**
 * 投递**之前**那四档的墙钟预算。
 *
 * 为什么必须有:投递本体已经没有任何超时(见 send() 里的说明),而投递之前这四个跨进程 await
 * 一个超时都没有,main 侧任一处不回,这一轮就永久挂着 —— turn 占着、Stop 常亮、
 * 永远没有回复,而且 `finally` 里那句 abort 也永远不会执行,那个全局 root 闸就此锁死,
 * **后续每一次发送都会被判成 busy**。这才是它真正的代价
 * (docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md #4)。
 *
 * **分档而不是一个统一值** —— 四档合理耗时差一个数量级,给同一个数必然误杀:
 *  · `claim` 是个闸,main 侧只查一下全局占用就返回,给 15s 已经宽得离谱;
 *  · `workspace` 是一次目录 stat,同上;
 *  · `attachments` 要把文件登记进会话(大文件拷贝/读取),给 2 分钟;
 *  · `compaction` **要在 main 里调模型生成摘要**,给 3 分钟 —— 给它 15s 会把正常的压缩当成
 *    故障掐死,那比不加超时更糟。
 *
 * 超时的动作是**抛**,不是静默返回:抛出去正好落进 `send()` 既有的 catch ——
 * 那里会把人的原话留在时间线上、给出一条错误气泡,`finally` 再把 root 闸释放掉。
 * 换成静默返回反而会把输入框里的字还回去、且不留任何解释。
 */
const PRE_DISPATCH_BUDGET_MS: Record<MaestroTurnStage, number> = {
  claim: 15_000,
  workspace: 15_000,
  attachments: 120_000,
  compaction: 180_000,
  // 投递本体不走这套,也不走任何别的超时 —— 一个工具跑几小时是合法的,静默就静默着。
  dispatch: 0
}

const withStageTimeout = async <T>(stage: MaestroTurnStage, run: () => Promise<T>): Promise<T> => {
  const budgetMs = PRE_DISPATCH_BUDGET_MS[stage]
  if (!budgetMs) return await run()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                interpolateChatCopy(i18nHelper.maestroControl.chat.setupTimeout, {
                  stage,
                  seconds: Math.round(budgetMs / 1000)
                })
              )
            ),
          budgetMs
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const interpolateChatCopy = (
  template: string,
  values: Record<string, string | number>
): string =>
  template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
  )
/**
 * 「这一轮没有可用产出」—— 换成本地化的说法。
 *
 * main 侧写死了两句**契约文案**(`maestroAgent.service.ts` 的 `empty-agent-turn`),这里按原文
 * 认出来再取 `i18nHelper` 里对应的那条。BL 的聊天文案一律在这一侧组装(`stopped` / `done` /
 * `failed` 同理),所以本地化也在这一侧做。
 *
 * 认不出来就返回空,走原来的 `safeReplyText || fallback` —— 模型自己写的正文永远原样。
 * 见 `micromeet-cowork/apps/cowork/docs/issues/chat-shows-internal-diagnostics-as-user-facing-text.md`。
 */
const EMPTY_TURN_MODEL_SILENT = 'The model returned nothing this turn. Send it again, or pick a different model above.'
const EMPTY_TURN_NO_RESULT = 'I did not get a usable result this turn. Send it again, in different words if that helps.'
const emptyTurnCopy = (reply: AgentReply): string => {
  if (reply.ok || reply.error !== 'empty-agent-turn') return ''
  const text = reply.text?.trim()
  if (text === EMPTY_TURN_MODEL_SILENT) return i18nHelper.maestroControl.chat.emptyTurnModelSilent
  if (text === EMPTY_TURN_NO_RESULT) return i18nHelper.maestroControl.chat.emptyTurnNoResult
  return ''
}

const summarizeTitle = (text: string): string => {
  const firstLine = text.trim().split('\n')[0]?.trim() || 'New chat'
  return firstLine.length > 36 ? firstLine.slice(0, 36) + '…' : firstLine
}

const titleFromFirstMessage = (session: MessageSession, message: ChatMessage): boolean => {
  if (!session.detail.autoTitlePending || !message.content.trim()) return false
  const humanMessages = session.messages.filter((entry) => entry.role === 'human' && !entry.promptExcluded && !entry.localOnly && !entry.id.startsWith('welcome-')
    && (!entry.type || entry.type === 'text') && Boolean(entry.content.trim()))
  // Consume even with a manual title; undoing that rename must not make the next message the first.
  session.detail.autoTitlePending = undefined
  if (!session.detail.titleCustomized && humanMessages.length === 1 && humanMessages[0].id === message.id) {
    session.title = summarizeTitle(message.content)
    return true
  }
  return false
}

/** `send()` 拒绝的原因。**必须可解释** —— 过去返回裸 null,调用方已清空输入框,人打的字就没了。 */
export type TurnRejection = { ok: false; reason: 'busy-here' | 'busy-elsewhere' | 'not-sendable' }
export type SendResult = AgentReply | TurnRejection

export const isRejection = (result: SendResult | null): result is TurnRejection =>
  Boolean(result) && (result as TurnRejection).ok === false && 'reason' in (result as TurnRejection)

interface SteeringContinuation {
  tail: Promise<void>
  ownerId?: string
  previousFinished: boolean
  requests: number
}

interface RootDispatchWaiter {
  promise: Promise<boolean>
  resolve: (ready: boolean) => void
}

/**
 * 回合的生命周期(docs/plan/tasks/maestro-cowork-chat-core-089.md)。
 *
 * 职责边界:**本 service 管回合,`message.store` 管内容。**
 * 回合 = 从人按下发送,到该次响应终结之间,agent 对某个会话的独占执行期 —— 开始 / 阶段 / 落点 /
 * 沉默看门狗 / 四条结束路径 / 并发策略都在这里;消息怎么存、怎么压缩、怎么算 token 在 store 里。
 *
 * 依赖是单向的:`TurnService → _state(message.store)`。所以 `channel.store` 可以只读地渲染回合状态,
 * 不会形成 store ↔ store 的环 —— 这正是当初否掉「turn 放 channel.store」的理由。
 *
 * **必须用方法简写,不能用箭头类字段** —— 箭头字段里的 `this` 指向裸实例、绕过 reactive 代理,
 * 表现是气泡不刷新 / spinner 卡死(与既有 reactive store 的约束相同)。
 */
@injectable()
export class TurnService extends CommonService<MessageStoreState> {
  private readonly steeringContinuations = new Map<string, SteeringContinuation>()
  private readonly rootDispatchWaiters = new Map<string, RootDispatchWaiter>()

  /** Any running session, used only for global controls; ownership always uses sessionId. */
  activeSession(): MessageSession | undefined {
    return this._state.sessions.find((session) => session.turn)
  }

  activeTurn(): Turn | undefined {
    return this.activeSession()?.turn
  }

  runningTurnCount(): number {
    const ids = new Set(this._state.sessions.filter((session) => session.turn).map((session) => session.id))
    for (const snapshot of this._state.activeAgentTurnSnapshots) ids.add(snapshot.sessionId)
    return ids.size
  }

  /** Existing turns accept steering; new turns are blocked only when all four slots are occupied. */
  busyElsewhere(sessionId: string): boolean {
    if (this._state.getSession(sessionId)?.turn) return false
    return this.runningTurnCount() >= MAX_CONCURRENT_TURNS
  }

  /**
   * 本回合的落点 —— **读记录,不再倒序猜**。
   * 回合进行中会往会话尾部追加别的条目(播报 / 任务 / 确认卡),按"最后一条"定位的话第一条播报就把
   * 落点顶掉,之后的 stream / activity 全被丢弃(turn-anchor-and-silent-send-drop.md 根因 A)。
   *
   * **还没建就返回 undefined** —— 气泡是懒建的(见 `ensureSink`)。
   */
  sink(session: MessageSession): ChatMessage | undefined {
    const id = session.turn?.assistantMessageId
    if (!id) return undefined
    // 走 `messages[i]` 取,拿到的是 reactive 数组元素的 Proxy —— 直接用裸对象改会绕过 set 陷阱,
    // 气泡就不重渲染(chat-fail-spinner-and-codex-login.md)。
    return session.messages.find((message) => message.id === id)
  }

  /**
   * 建落点(幂等)。**只在真的有文字要落时才调** —— 第一个 stream delta、或者回合收尾。
   *
   * 为什么懒建:预建空气泡是「播报出现在回复上方」的病根。回合一开始就占一条位置,而它的文字要到
   * 结束才到,于是中途追加的播报无论排在它前面还是后面都读不顺
   * (Maestro Turn/status/task 契约)。懒建之后气泡出现在它**真正说话的时刻**,
   * 时间线就是自然顺序。
   *
   * activity 数组**按引用**交给消息,不是拷贝:建之前 push 进 `turn.activity` 的那些工具行不会丢,
   * 建之后再 push 也照样进气泡。
   */
  /**
   * 封口当前落点。**任何往时间线追加东西的动作都要先调它** —— 播报、任务卡、确认卡。
   *
   * 为什么(Ral 2026-08-14):落点原本整轮固定。钻探的一个回合活 100 多分钟,模型在这期间产出几十段
   * 文字,全部 `content += delta` 拼进同一条消息;几百个工具活动也全堆在同一个数组里。而播报和任务卡
   * 是追加到末尾的 —— 于是那条消息永远停在它**第一次说话**的位置,一边越长越大,一边被后面的东西
   * 不断顶上去,人根本跟不上它在干什么。
   *
   * 「气泡不预建」只对了一半:**气泡也不该一直开着**。规则是——
   * **落点只在它是时间线最后一条时有效**;有别的东西落在它后面,它这一段就说完了。
   *
   * activity 数组要一起换新:不换的话,封口后的气泡会继续收后面的工具行,而那些工具行属于下一段。
   */
  sealSink(session: MessageSession): void {
    const turn = session.turn
    if (!turn?.assistantMessageId) return
    const sink = this.sink(session)
    // RAF-buffered deltas still target assistantMessageId. Flush while that anchor is live; clearing
    // it first drops the tail that arrived in the same frame as a task/confirmation boundary.
    this._state.flushStreamBuffer(session.id)
    if (sink) {
      turn.lastAssistantMessageId = sink.id
      turn.sealedAssistantSegments += 1
    }
    turn.assistantMessageId = undefined
    turn.activity = []
    turn.thinking = false
    if (!sink) return
    // 一个字都没说出来的落点(只有工具行)也要收 —— 它记录的是这一段干了什么,不能一直转圈。
    this._state.finishAssistant(sink, sink.content)
  }

  /**
   * **往时间线追加一条消息的唯一入口。** 先封口当前落点,再 push,返回 reactive 数组里的那个元素。
   *
   * 为什么要收敛成一个入口(parts-migration-plan.md #P1):顺序现在靠**编码纪律**保证 ——
   * 九处 `messages.push` 各自记得先 `sealSink`。忘了封口的后果是**错序**,而编译器不会提醒;
   * 这个失败模式**已经发生过**,四个症状同源(播报出现在回复上方、loading 挂在别的消息上、
   * 八张摄取卡挤成一坨、confirm 要往回滚才点得到)。
   *
   * 目前九处里有六处**不封口也是对的** —— 但那是**调用时序碰巧**如此(会话创建时还没有回合;
   * `send` 的附件/正文在建 turn 之前;压缩发生在 `turn = undefined` 之后),不是构造上成立。
   * 靠时序成立的东西,下一次挪动调用点就断,而断了不报错。
   *
   * 它同时是 P2 的脚手架:换成 parts 模型时只需要改**这一个地方**,而不是九个。
   *
   * 返回 proxy 元素而不是传进来的裸对象:往 reactive 数组里 push 之后再改裸对象是**改不动视图**的
   * (本仓踩过两次:没有 delta 的快速失败气泡一直转圈、钻探消息不刷新)。返回值直接可写。
   */
  appendTimelineEntry(session: MessageSession, message: ChatMessage): ChatMessage {
    this.sealSink(session)
    session.messages.push(message)
    return this._state.messageById(session, message.id) ?? message
  }

  ensureSink(session: MessageSession): ChatMessage | undefined {
    const turn = session.turn
    if (!turn) return undefined
    const existing = this.sink(session)
    if (existing) return existing
    const created: ChatMessage = this._state.withTokenCount({
      id: uid(), source: 'cowork', role: 'ai', content: '', streaming: true, ts: Date.now()
    })
    session.messages.push(created)
    // 绑 reactive 数组里的 Proxy 元素,不是上面那个裸对象 —— 否则一个没有任何 delta 的快速失败
    // (例如 "No API key")改不动视图,气泡会一直转(chat-fail-spinner-and-codex-login.md)。
    const sink = this._state.messageById(session, created.id) ?? created
    turn.assistantMessageId = sink.id
    sink.activity = turn.activity
    sink.thinking = turn.thinking
    this._state.scrollToBottom(true)
    return sink
  }

  /**
   * 回合活跃时的第二条消息 —— **steering**(docs/features/maestro-turn-steering.md)。
   *
   * 与 `send()` 的差别只有一句话:**它不是一个新回合**,是当前那个回合的一部分。所以这里
   * 刻意**不做**四件 `send()` 会做的事 ——
   *
   *  1. **不建 `turn`、不动现有的那个。** 契约「一个活跃回合 —— 不变」;计时、看门狗、收尾
   *     统统仍归那个还在跑的回合。这里若新建一个,`session.turn` 会被顶掉,真回合的流就失去落点。
   *  2. **不建气泡。** 判据是 main 显式置的 `reply.mergedIntoTurn`,**不是 `text === ''`** ——
   *     见下面那段。回复由那个还在跑的回合继续流出来,这条消息没有属于自己的回复。
   *  3. **不带附件。** PQ-2「先只带文本」:pi 的 `steer(text, images?)` 只收 images,而 Maestro 的
   *     附件是 path/url ref;附件按钮在回合活跃时是禁的,调用方也不会把 files 递进来。
   *  4. **不压缩。** `compactSessionIfNeeded` 会往时间线插一条 `compact` 占位并改写 `compressed`
   *     标记 —— 对着一个正在流式的回合做这件事等于在它脚下换地板。压缩仍在回合收尾时跑。
   *
   * 人类原话**逐字**进时间线(契约与压缩方案的接缝 1:它是用户意图,不可重建 ——
   * `role:'human' + type:'text'` 的收割规则天然涵盖它)。投递失败时那条消息会被标成
   * `promptExcluded`:它从来没到过模型,留在 ② 用户原话链里就是让链谎报上下文。
   */
  /**
   * **取回还没送到模型手上的排队消息**(pi 的 `app.message.dequeue` 在本宿主里的落点)。
   *
   * 与 pi 一样是**整批**:`clearQueue()` 没有"删掉其中一条"。已经送到模型那里的不会被取回 ——
   * main 只把 pi 还回来的那几条算数,所以这里拿到的 id 就是"模型确实没看见"的那些。
   *
   * 时间线上那几条当场摘掉(它们从来没进过提示词,留着就是让人以为说过了),正文按顺序返回给
   * 调用方放回输入框 —— pi 的做法也是 `[queuedText, currentText].join('\n\n')`。
   */
  async withdrawSteering(sessionId: string, only?: string[]): Promise<string[]> {
    const session = this._state.getSession(sessionId)
    if (!session) return []
    const { messageIds } = await coach.withdrawSteering({ sessionId, messageIds: only }).catch(() => ({ messageIds: [] as string[] }))
    const ids = new Set(messageIds)
    if (!ids.size) return []
    // **从队列里取**(#3 建议 3 之后,排队中的话从来没成为过消息)。`sendSteering` 那一侧
    // 收到 `steer-withdrawn` 时也会 dequeue —— 两处都做是**幂等**的,谁先到都对。
    const queue = session.pendingSteering || []
    const texts = queue.filter((item) => ids.has(item.id)).map((item) => item.text)
    session.pendingSteering = queue.filter((item) => !ids.has(item.id))
    this._state.updateSessionContextUsage(session)
    return texts
  }

  private async sendSteering(session: MessageSession, text: string, existingMessage?: ChatMessage, capturedContext?: AgentConversationContext, snapshot?: AgentMessageSnapshot): Promise<SendResult> {
    const store = this._state
    const turn = session.turn!
    // 【原来这里有一道「正在收尾就不投」的闸,已删。】收尾中照样收下 —— 投不进去也没关系,
    // 下面那条「没投出去就顺延成下一回合」的路会接住它(Ral 2026-09-22:「静默吞掉和按钮禁用
    // 都不对 … 先进 queue 等结尾完结再发出去就行」)。收尾窗口恰恰是人最想改口的时刻,
    // 这一档不该比别的档更难发出去。
    const context = capturedContext || store.buildAgentContext(session)
    const pendingRoot = this.rootDispatchWaiters.get(turn.id)
    if (pendingRoot) {
      const ready = await pendingRoot.promise
      if (!ready || session.turn?.id !== turn.id) return { ok: false, reason: 'not-sendable' }
    }
    /**
     * **排队中的话不进 `messages[]`** —— 它进队列,投递那一刻才成为一条真正的消息
     * (照 pi;`message-types.html` #3 建议 3)。界面不变:`visibleMessages()` 把队列投影在
     * 时间线末尾。这样「它到底算不算数」不再是一个要维护的状态。
     */
    const messageId = existingMessage?.id || uid()
    if (!existingMessage) {
      session.pendingSteering = [...(session.pendingSteering || []), { id: messageId, text, ts: Date.now() }]
    }
    /** 把这一条从队列里摘掉 —— 送达 / 取回 / 失败三条路都要走。 */
    const dequeue = (): void => {
      if (!session.pendingSteering?.length) return
      session.pendingSteering = session.pendingSteering.filter((item) => item.id !== messageId)
    }
    // PQ-4 留痕。**先置 pending,再发** —— 投递途中那一段也要有话说,否则人按下发送到 main 回话
    // 之间是一段没有任何反馈的静默,而那正是「以为没发成功」的窗口。
    turn.steering = { count: turn.steering?.count ?? 0, pending: true, pendingCount: (turn.steering?.pendingCount ?? 0) + 1 }
    // 状态行:最后触发的赢。下一条 agent 事件会把它清掉。
    turn.steeringEvent = { kind: 'queueing', at: Date.now() }
    store.updateSessionContextUsage(session)
    store.stickToBottom = true
    store.scrollToBottom(true)
    void store.persistSession(session)

    let reply: AgentReply
    try {
      reply = await store.dispatch(session, text, messageId, undefined, 'steering', turn.id, context, snapshot)
    } catch (err) {
      reply = { ok: false, text: String(err), ts: Date.now(), error: String(err) }
    }
    if (reply.continueAsRoot?.turnId === turn.id) {
      // 队列已经在上面摘掉;顺延那一路自己会建消息(或复用 `existingMessage`)。
      dequeue()
      const continued = await this.continueSteeringAfterCompletion(session, turn, text, existingMessage, context, reply.continueAsRoot.reply, reply.continueAsRoot.snapshot)
      if (!isRejection(continued)) return continued
      reply = { ok: false, text: 'Another turn took ownership before this message could continue. Send it again.', ts: Date.now(), error: 'steer-failed' }
    }
    // 回合已经被别处收尾(stop / 超时 / 它自己跑完了)→ 留痕无处可挂,但回复照样如实返回。
    const live = session.turn?.id === turn.id ? session.turn : undefined
    const pendingCount = Math.max(0, (turn.steering?.pendingCount ?? 1) - 1)

    // **取回** —— 人自己把它拿回去了(`withdrawSteering()`)。既不顺延、也不留失败气泡:
    // 时间线上那条消息已经被摘掉,正文已经回到输入框。这里只把计数收干净。
    if (reply.error === 'steer-withdrawn') {
      // 队列里摘掉就完了 —— 它从来没成为过一条消息,所以没有气泡要删。
      dequeue()
      if (live) live.steering = { count: live.steering?.count ?? 0, pending: pendingCount > 0, pendingCount }
      store.updateSessionContextUsage(session)
      return reply
    }

    // ⚠ **判据是 `mergedIntoTurn`,不是 `text === ''`。** 空正文是会被别的路径复用的值 ——
    // 超时、被内容过滤、模型这一轮真的没说话,全都可能是空。拿它当哨兵迟早误伤:那时会静默
    // 吃掉一条真正需要被看见的回复。`mergedIntoTurn` 是 main 在 `delivered` 那一支显式置的,
    // 只有「已并入当前回合」这一件事会置它(shared/maestro/coach.api.ts)。
    if (reply.mergedIntoTurn) {
      // **送达 = 成为一条条目**(pi 的 agent-loop 也是在这一刻把它推进 context.messages)。
      dequeue()
      const humanMessage = existingMessage || this.appendTimelineEntry(
        session,
        store.withTokenCount({ id: messageId, source: 'cowork', role: 'human', content: text, streaming: false, ts: Date.now() })
      )
      humanMessage.promptExcluded = undefined
      store.withTokenCount(humanMessage)
      if (live) {
        live.steering = { count: (live.steering?.count ?? 0) + 1, pending: pendingCount > 0, pendingCount }
        live.steeringEvent = { kind: 'steering', at: Date.now() }
      }
      void store.persistSession(session)
      return reply
    }

    // **没投出去 ≠ 失败 —— 它还在队列里。**
    //
    // 一条排队消息没能并进当前回合,意思只有一个:模型**一个字都没看见它**。那它就该等这个回合
    // 收尾,然后作为**下一个回合**发出去 —— 同一条消息、同一个气泡,不重建、不退回输入框、
    // 不要人再按一次回车(Ral 2026-09-22:「先进 queue 等结尾完结再发出去就行 … UI 上直接拼到
    // 结尾那个消息下面」)。
    //
    // 这里不需要等:停止是**同步**的(`forceStop` 当场清掉 `session.turn`),自然跑完那一档
    // 走的是上面的 `continueAsRoot`。所以走到这里而 `session.turn` 已空,就是「回合真的没了」。
    if (!session.turn && !session.archivedAt && store.getSession(session.id) === session) {
      const resent = await this.send(session.id, text, undefined, existingMessage, context, snapshot)
      if (resent && !isRejection(resent)) {
        void store.persistSession(session)
        return resent
      }
    }

    // A failed receipt identifies this undelivered message; temporary queueing is not failure.
    const detail =
      (reply.error === 'steer-failed' ? reply.text : reply.error || reply.text) ||
      i18nHelper.maestroControl.chat.unknownError
    // 顺延回来的那条(`existingMessage`)确实在时间线上,要标成"模型没看过";
    // 而第一次入队的那条从来没成为消息 —— 队列里摘掉就没了。
    dequeue()
    if (existingMessage) {
      existingMessage.promptExcluded = true
      store.withTokenCount(existingMessage)
    }
    this.appendTimelineEntry(
      session,
      store.withTokenCount({
        id: uid(),
        source: 'cowork',
        role: 'ai',
        content: interpolateChatCopy(i18nHelper.maestroControl.chat.steeringFailed, { detail }),
        streaming: false,
        error: true,
        promptExcluded: true,
        ts: Date.now()
      })
    )
    if (live) live.steering = { count: live.steering?.count ?? 0, pending: pendingCount > 0, pendingCount }
    store.updateSessionContextUsage(session)
    store.scrollToBottom(true)
    void store.persistSession(session)
    return reply
  }

  /** Serialize only ownership handoff, not the new model run: later messages steer that successor. */
  /**
   * `text` 与 `existing` 分开传:队列模型之后,**排队中的话不一定有对应的消息** ——
   * 第一次入队的那条从来没成为过条目,只有顺延回来的那条才有(见 `sendSteering` 开头那段)。
   */
  private continueSteeringAfterCompletion(session: MessageSession, previous: Turn, text: string, existing: ChatMessage | undefined, context: AgentConversationContext, reply: AgentReply, snapshot: AgentMessageSnapshot): Promise<SendResult> {
    let continuation = this.steeringContinuations.get(previous.id)
    if (!continuation) {
      continuation = { tail: Promise.resolve(), previousFinished: false, requests: 0 }
      this.steeringContinuations.set(previous.id, continuation)
    }
    const current = continuation
    current.requests += 1
    let finish: (result: SendResult) => void = () => undefined
    const result = new Promise<SendResult>(resolve => { finish = resolve })
    current.tail = current.tail.then(async () => {
      if (!current.previousFinished) {
        current.previousFinished = true
        await this.finishFromMain(session, previous.id, reply, 'completed')
      }
      if (session.turn && session.turn.id !== current.ownerId) {
        finish({ ok: false, reason: 'busy-here' })
        return
      }
      const sending = session.turn
        ? this.sendSteering(session, text, existing, context, snapshot)
        : this.send(session.id, text, undefined, existing, context, snapshot, previous.id)
      current.ownerId = session.turn?.id
      void sending.then(value => finish(value || { ok: false, reason: 'not-sendable' }), () => finish({ ok: false, reason: 'not-sendable' }))
    }).catch(() => finish({ ok: false, reason: 'not-sendable' }))
    return result.finally(() => {
      current.requests -= 1
      if (!current.requests && this.steeringContinuations.get(previous.id) === current) this.steeringContinuations.delete(previous.id)
    })
  }

  /**
   * 「这个 turn 还是我的吗」—— 原来这一判定在 `send()` 里逐字重复 5 次且**静默返回**,
   * 是「发了没反应」最难查的一类:main 侧 finish/abort 掉了这个 turn,渲染端就一声不响地退出。
   * 收成一处只为一件事:退出前留痕,说清是在哪一档之后丢的。判定语义一字未改。
   */
  private turnLost(session: MessageSession, turnId: string, at: string): boolean {
    if (session.turn?.id === turnId && !session.turn.aborting) return false
    turnDiagnostics.emit('reject', { turnId, reason: 'not-sendable', at, nowTurnId: session.turn?.id ?? 'none' })
    return true
  }

  async send(sessionId: string, message: string, files?: ChatAttachment[], existingMessage?: ChatMessage, capturedContext?: AgentConversationContext, snapshot?: AgentMessageSnapshot, continuationOf?: string): Promise<SendResult | null> {
    const store = this._state
    const session = store.getSession(sessionId)
    const text = message.trim()
    // 长度而非正文 —— 日志不记人的消息(turnDiagnostics 文件头)。
    turnDiagnostics.emit('send-start', { sessionId, textLen: text.length, files: files?.length ?? 0 })
    if (!session || session.archivedAt || !text) {
      turnDiagnostics.emit('reject', {
        sessionId,
        reason: 'not-sendable',
        at: !session ? 'no-session' : session.archivedAt ? 'archived' : 'empty-text'
      })
      return { ok: false, reason: 'not-sendable' }
    }
    // 回合活跃 → 这一条是 **steering**,插进那个还在跑的回合,不新开回合
    // (docs/features/maestro-turn-steering.md「对 turn 模型的修订」)。原来这里返回 `busy-here`,
    // 那正是三道闸的第一道。**投递方式(steer / followUp)不在这里判** —— 那是 main 侧策略的事。
    if (session.turn) {
      if (existingMessage) return { ok: false, reason: 'busy-here' }
      turnDiagnostics.emit('send-start', { sessionId, route: 'steering', turnId: session.turn.id })
      return await this.sendSteering(session, text)
    }
    if (this.busyElsewhere(sessionId)) {
      turnDiagnostics.emit('reject', { sessionId, reason: 'busy-elsewhere', at: 'max-concurrent' })
      return { ok: false, reason: 'busy-elsewhere' }
    }

    // 回合从【按下发送】起算,不是从第一个字符 —— 后续附件注册、压缩、会话启动都已独占且会失败,
    // 那段必须有名字(maestro-turn-model.md)。所以 turn 必须在第一个 await 之前同步占好全局槽。
    //
    // **但气泡不预建**:落点等第一个字符(或收尾)时才由 `ensureSink()` 建出来。在此之前这一轮
    // 在干什么由底部状态条表达,时间线上不留一条空占位 —— 那条占位正是「播报排在回复上方」的病根。
    session.turn = {
      id: uid(),
      generation: 0,
      rootText: text,
      phase: 'accepted',
      startedAt: Date.now(),
      activity: [],
      thinking: false,
      sealedAssistantSegments: 0,
      hasStreamedText: false,
      streamCoverageComplete: true,
      aborting: false
    }
    // Read the stored proxy so changes stay reactive; ownership itself is always the stable ID.
    const turn = session.turn
    let resolveRootDispatch: (ready: boolean) => void = () => undefined
    const rootDispatchPromise = new Promise<boolean>((resolve) => {
      resolveRootDispatch = resolve
    })
    const rootDispatchWaiter = { promise: rootDispatchPromise, resolve: resolveRootDispatch }
    this.rootDispatchWaiters.set(turn.id, rootDispatchWaiter)
    session.retryable = undefined
    session.updatedAt = Date.now()
    store.updateSessionContextUsage(session)
    // 新回合:无条件重新钉到底部,哪怕人在空闲时往上滚过。
    store.stickToBottom = true
    store.scrollToBottom(true)
    let stagedFiles: Awaited<ReturnType<MessageStoreState['stageAttachments']>> = []
    let humanMessage: ChatMessage | undefined
    let reply: AgentReply
    let dispatched = false
    try {
      // Main owns the global root gate. This is deliberately the first await after the renderer
      // reserves its local Turn; every later message carries explicit steering intent + turnId.
      const claim = await turnDiagnostics.stage(turn.id, 'claim', () =>
        withStageTimeout('claim', () =>
          coach.claimAgentTurn({
            continuationOf,
            sessionId: session.id,
            operationTabId: session.operationTabId,
            turnId: turn.id,
            rootText: turn.rootText,
            startedAt: turn.startedAt
          })
        )
      )
      if (!claim.ok) {
        if (session.turn?.id === turn.id) session.turn = undefined
        turnDiagnostics.emit('reject', { turnId: turn.id, reason: claim.reason || 'busy-elsewhere', at: 'claim-denied' })
        return { ok: false, reason: claim.reason || 'busy-elsewhere' }
      }
      turn.generation = claim.turn.generation
      if (this.turnLost(session, turn.id, 'after-claim')) return { ok: false, reason: 'not-sendable' }

      humanMessage = existingMessage || this.appendTimelineEntry(
        session,
        store.withTokenCount({ id: uid(), source: 'cowork', role: 'human', content: text, streaming: false, ts: Date.now() })
      )
      humanMessage.promptExcluded = undefined
      turn.rootHumanMessageId = humanMessage.id
      const generateTitle = titleFromFirstMessage(session, humanMessage)
      store.updateSessionContextUsage(session)
      if (generateTitle) store.scheduleSessionTitle(session, humanMessage)
      else void store.persistSession(session)
      // Main already owns the inbox; subsequent messages need not wait for workspace/media preparation.
      this.settleRootDispatch(turn.id, true)

      await turnDiagnostics.stage(turn.id, 'workspace', () =>
        withStageTimeout('workspace', () => store.refreshWorkspace(session.id))
      )
      if (this.turnLost(session, turn.id, 'after-workspace')) return { ok: false, reason: 'not-sendable' }

      stagedFiles = await turnDiagnostics.stage(turn.id, 'attachments', () =>
        withStageTimeout('attachments', () => store.stageAttachments(session, files))
      )
      if (this.turnLost(session, turn.id, 'after-attachments')) return { ok: false, reason: 'not-sendable' }
      if (stagedFiles.length) {
        this.appendTimelineEntry(
          session,
          store.withTokenCount({
            id: uid(),
            source: 'cowork',
            role: 'human',
            type: 'files',
            content: '',
            files: stagedFiles,
            streaming: false,
            ts: Date.now()
          })
        )
      }

      await turnDiagnostics.stage(turn.id, 'compaction', () =>
        withStageTimeout('compaction', () =>
          store.compactSessionIfNeeded(session, { protectMessageIds: new Set([humanMessage!.id]) })
        )
      )
      if (this.turnLost(session, turn.id, 'after-compaction')) return { ok: false, reason: 'not-sendable' }

      dispatched = true
      this.settleRootDispatch(turn.id, true)
      turnDiagnostics.emit('stage-start', { turnId: turn.id, stage: 'dispatch' })
      /**
       * **投递本身没有超时。**(Ral 2026-09-22:「有的任务或 tool 耗时就是就 例如,下载 …
       * 不能设置超时的,一直静默就静默着」)
       *
       * 这里原来套着一个 11 分钟的**沉默看门狗**。它看的是"多久没有产出",而一个长工具调用
       * (下载、长时间抓取)**只在开始时发一次 `tool_start`,之后到结束都没有任何事件** ——
       * 于是一次要跑几小时的下载会在第 11 分钟被判成"供应商挂住了"并掐掉。它掐掉的从来不是
       * 故障,而是耗时本身。
       *
       * 现在回合只有两个终点:**跑完**,或者**人按 Stop**。一个真挂住的供应商因此会一直转 ——
       * 那是刻意的:界面上转着圈和一个正在下载的工具从外面看本来就一样,而只有人知道自己还要不要等。
       * 要掌握进展,应当由 agent 自己决定怎么查(定时看一下下载进度之类),而不是由宿主替它判死。
       *
       * 投递**之前**那四档 `withStageTimeout` 保留:它们守的是跨进程 await 不回,不是模型工作。
       */
      reply = await store.dispatch(
        session,
        text,
        humanMessage.id,
        stagedFiles.map((file) => file.path),
        'root',
        turn.id, capturedContext, snapshot
      )
    } catch (err) {
      const error = String(err)
      if (session.turn?.id !== turn.id) {
        // Main may finish/abort the exact Turn while the root XPC is rejecting (for example the
        // inactivity timeout). Once the user's root is already in the transcript, report the
        // terminal reply instead of returning a renderer rejection that restores it to the composer.
        return turn.rootHumanMessageId
          ? { ok: false, text: error, ts: Date.now(), error }
          : { ok: false, reason: 'not-sendable' }
      }
      // Pre-dispatch setup can fail too. Keep the accepted user request in the transcript instead of
      // clearing their composer and leaving only an unexplained error bubble.
      if (!humanMessage) {
        humanMessage = this.appendTimelineEntry(
          session,
          store.withTokenCount({ id: uid(), source: 'cowork', role: 'human', content: text, streaming: false, ts: Date.now() })
        )
        turn.rootHumanMessageId = humanMessage.id
        if (titleFromFirstMessage(session, humanMessage)) store.scheduleSessionTitle(session, humanMessage)
        store.updateSessionContextUsage(session)
      }
      reply = { ok: false, text: error, ts: Date.now(), error }
      /**
       * **抛出来的失败额外插一张错误卡**(Ral 2026-09-10)。
       *
       * 为什么不只靠 `finishReply` 那条气泡:气泡里是 `reply.text` 一行,而这一类失败的原文
       * 往往是「一句话 + 几十行栈」—— 一行红字既看不出栈,也看不出是**哪一步**失败的。
       * 2026-09-10 那次 `An object could not be cloned.` 就是这样查不下去的。
       *
       * 失败消息走 `pushErrorCard` 这个**唯一入口**(errorCard.service),所以标题/副标题/全文的
       * 口径在所有失败路径上一致。`subtitle` 由这里给 —— 只有这里知道自己是"投递"这一步。
       */
      store.pushErrorCard(session.id, err, { subtitle: i18nHelper.maestroControl.chat.errorDuringSend })
    } finally {
      if (!dispatched) this.settleRootDispatch(turn.id, false)
      // Every successful Main reservation must either reach root dispatch or be explicitly released.
      // This also covers early returns after workspace/attachment/compaction awaits; abort is exact
      // turnId scoped and therefore harmless if Stop already released it.
      //
      // **条件是 `!dispatched`,不是 `claimed && !dispatched`。** `withStageTimeout` 用的是
      // `Promise.race`,它**不取消**底层那次调用 —— claim 超时后 `claimed` 仍是 false,而 main
      // 完全可能随后才批准。用原来的条件就没人释放那个全局 root 闸,于是**后续每一次发送都被判 busy**,
      // 症状比它要治的那个"这一轮没回复"更严重。
      // abort 是按 turnId 精确作用的:没被批准过的 turnId 在 main 侧找不到,这一句就是空操作;
      // claim 被拒时也一样 —— 它不会碰到别人那个正在跑的回合。所以宁可多发这一句。
      if (!dispatched) {
        await coach.abortAgent({ sessionId: session.id, turnId: turn.id }).catch(() => undefined)
      }
    }

    turnDiagnostics.emit('send-terminal', {
      turnId: turn.id,
      outcome: reply.ok ? 'success' : 'failure',
      dispatched,
      elapsedMs: Date.now() - turn.startedAt,
      // 错误原文会被脱敏吃成 `***`(24+ 字符的 token 整体替换),所以拆成三段短的记
      // —— 名字 / 前 20 字符 / 总长度。这是 2026-09-10 那次"查不下去"换来的。
      ...(reply.ok ? {} : describeErrorForLog(reply.error ?? reply.text ?? 'unknown'))
    })
    /**
     * **回合的释放必须是无条件的。**
     *
     * `finishReply` 有两条早退(当前 turnId 不匹配、拿不到落点)、中间还有一整段格式化与
     * 持久化 —— 任何一处抛出或早退,`session.turn = undefined` 那一句就到不了。而 `session.turn`
     * 还在 = 状态条永久停在「Sent · waiting for a response…」并继续计时,**而且**下一条消息会被
     * 判成 steering、插进这个已经死掉的回合 —— 于是"发消息永远没回复"
     * (Ral 2026-09-10 报的正是这个形状:25 秒还在 waiting)。
     *
     * 早退本身是对的(别人已经收尾了就该让位),错的是"释放"只在成功路径上。所以这里补一道
     * 兜底:只在**这一轮还是我**时清 —— 别人接管过就不碰,幂等且不会抢别人的收尾。
     *
     * 兜底真的开火时留一行:它开火说明上游有 bug,不记就永远查不到。
     */
    try {
      await this.finishReply(session, turn, reply)
    } finally {
      // An abort owns finalization until main confirms that all resources have stopped.
      if (session.turn?.id === turn.id && !turn.aborting) {
        turnDiagnostics.emit('send-terminal', {
          turnId: turn.id,
          outcome: 'failure',
          reason: 'turn-not-released-by-finishReply'
        })
        session.turn = undefined
        this._state.setActiveAgentTurnSnapshot(null, turn.id)
        session.updatedAt = Date.now()
        void this._state.persistSession(session)
      }
    }
    return reply
  }

  /** Main's completion broadcast is authoritative, including after this renderer was reloaded. */
  async finishFromMain(
    session: MessageSession,
    turnId: string,
    reply: AgentReply | undefined,
    reason: NonNullable<AgentTurnUpdate['finished']>['reason']
  ): Promise<void> {
    const turn = session.turn
    if (!turn || turn.id !== turnId) return
    if (reason !== 'completed' || !reply) {
      this.forceStop(session, turnId)
      return
    }
    await this.finishReply(session, turn, reply)
  }

  private async finishReply(session: MessageSession, turn: Turn, reply: AgentReply): Promise<void> {
    if (session.turn?.id !== turn.id || turn.aborting) return
    const store = this._state
    // Drain the RAF tail before choosing the final segment. A reply text is the whole logical Turn,
    // while the timeline may already contain sealed segments; never copy that whole payload into
    // the current tail segment (which would repeat every earlier paragraph).
    store.flushStreamBuffer(session.id)
    const openAssistant = this.sink(session)
    const sealedAssistant = turn.lastAssistantMessageId
      ? store.messageById(session, turn.lastAssistantMessageId)
      : undefined
    // 收尾时才可能第一次建气泡:一轮只发工具调用、没有任何文字的回合(钻探就是),到这里才有正文。
    const assistant = openAssistant ?? sealedAssistant ?? this.ensureSink(session)
    if (!assistant || session.turn?.id !== turn.id) return
    const wasAborted = turn.aborting
    const fallback = wasAborted
      ? i18nHelper.maestroControl.chat.stopped
      : reply.ok
        ? i18nHelper.maestroControl.chat.done
        : i18nHelper.maestroControl.chat.failed
    assistant.error = wasAborted ? false : !reply.ok
    assistant.promptExcluded = wasAborted
    assistant.files = reply.files?.map((file) => ({ ...file, kind: 'artifact' }))
    assistant.skill = reply.skill
    assistant.skills = reply.skills?.length ? reply.skills : reply.skill ? [reply.skill] : undefined
    assistant.replay = reply.replay
    // `reply.text` is the whole logical Turn. Use it only when the runtime emitted no text_delta at
    // all; otherwise putting it into the final segment repeats every sealed paragraph before it.
    const replyText = reply.text?.trim()
    let segmentText = assistant.content.trim()
    if (!turn.streamCoverageComplete && replyText) {
      // A rebuilt renderer may have missed an arbitrary prefix of stream events. Main's terminal
      // reply is authoritative in that case: collapse persisted partial text into the final segment
      // so recovery is complete without showing the same suffix twice.
      for (const segment of session.messages) {
        if (
          segment !== assistant &&
          segment.role === 'ai' &&
          (segment.type === undefined || segment.type === 'text') &&
          !segment.id.startsWith('welcome-') &&
          segment.ts >= turn.startedAt &&
          segment.content
        ) {
          segment.content = ''
          store.withTokenCount(segment)
        }
      }
      assistant.content = replyText
      segmentText = replyText
    }
    const safeReplyText = segmentText || (!turn.hasStreamedText ? replyText : '')
    const body =
      !wasAborted && !reply.ok && safeReplyText && reply.authoredByModel
        ? interpolateChatCopy(i18nHelper.maestroControl.chat.interruptedReply, {
            error: reply.error || i18nHelper.maestroControl.chat.unknownError,
            text: safeReplyText
          })
        : emptyTurnCopy(reply) || safeReplyText || fallback
    store.finishAssistant(assistant, body)
    session.retryable =
      !wasAborted && !reply.ok && reply.retryExhausted && turn.rootHumanMessageId
        ? {
            ...reply.retryExhausted,
            rootText: turn.rootText,
            rootHumanMessageId: turn.rootHumanMessageId
          }
        : undefined
    // **回合在它不是当前会话时结束 → 未读**(docs/features/maestro-session-list-unread.md #2)。
    // 只有真的产出了正文(或文件)才算:一次被停止、或失败到没有正文的回合置未读,
    // 只会让蓝点变成噪声。`activeSessionId` 由 channel.store 单向写入,connector 活跃时是空串。
    if (this._state.activeSessionId !== session.id && !wasAborted && (safeReplyText || reply.files?.length)) {
      this._state.markUnread(session.id)
    }
    // Clear ownership synchronously before either persistence await. A completion broadcast and the
    // root XPC response may arrive back-to-back; the second finalizer must become a no-op.
    session.turn = undefined
    store.setActiveAgentTurnSnapshot(null, turn.id)
    session.updatedAt = Date.now()
    await store.compactSessionIfNeeded(session)
    await store.persistSession(session)
  }

  /**
   * **停止必须成功**(Ral 2026-09-22:「停止失败 就不该有 stop 必须能停止成功」)。
   *
   * main 侧现在是同步的:发取消信号 + 同步放行,清理在后台排干(见 `maestroAgent.abortAgent`
   * 与 `BaseAgent.abort`,照 pi 的做法 —— pi 的 `onEscape` 就是一句不 await 的 `agent.abort()`)。
   * 既然它不会失败、也没有「停到一半」,这一侧就**不该为一次 IPC 往返等待**:先本地收尾,
   * 再把信号发出去。`aborting` / `stopError` / 超期放行那一整套中间态因此都没有了。
   */
  async stop(sessionId: string): Promise<void> {
    const session = this._state.getSession(sessionId)
    const turn = session?.turn
    if (!session || session.archivedAt || !turn) return
    const turnId = turn.id
    this.forceStop(session, turnId)
    // 信号照发 —— 界面已经不欠它了,但 main 侧的 pi 会话、任务、workflow 仍然要被取消。
    void coach.abortAgent({ sessionId: session.id, turnId }).catch(() => undefined)
  }

  /** 收尾一个回合。`turnId` 对不上说明它已被别处收尾,直接放行。 */
  forceStop(session: MessageSession, turnId?: string): void {
    const turn = session.turn
    if (!turn || (turnId && turn.id !== turnId)) return
    this.settleRootDispatch(turn.id, false)
    this._state.flushStreamBuffer(session.id)
    // Stop during workspace/attachment setup, before the root request entered the transcript: release
    // the reserved Turn silently. send() returns a rejection and the composer restores the user's text.
    // A host-authored turn never has a root human message, but it does have a live bubble; taking
    // the silent-release path would leave a spinner that never finishes.
    if (!turn.rootHumanMessageId && !turn.hostAuthored) {
      session.turn = undefined
      this._state.setActiveAgentTurnSnapshot(null, turn.id)
      session.updatedAt = Date.now()
      void this._state.persistSession(session)
      return
    }
    // 停止时连 compact 占位一起收尾 —— 否则在压缩占位上按停止会留一个永远转的 spinner。
    // 还没建气泡就 `ensureSink` 建一条:一轮被中止但一个字都没产出时,时间线上必须留下"停止了"
    // 这个事实,否则人只看到自己那条消息、后面什么都没有。
    const last = this.sink(session) ?? this._state.lastStreamingMessage(session) ?? this.ensureSink(session)
    if (last) {
      last.promptExcluded = true
      this._state.finishAssistant(
        last,
        last.content.trim() || i18nHelper.maestroControl.chat.stopped
      )
    }
    session.turn = undefined
    this._state.setActiveAgentTurnSnapshot(null, turn.id)
    session.updatedAt = Date.now()
    void this._state.persistSession(session)
  }

  // ── agent 产出的三条入口。**先刷看门狗、再找落点** ────────────────────────────────
  // 刷新写在落点 guard 之前是有意的:agent 有产出就是有产出,和这一帧落到哪条消息无关。
  // 反过来写的话,落点一断,看门狗就没人喂了,一个其实活着的回合会被 11min 误杀。

  /**
   * 活动落在 **turn 上**,不落消息 —— 气泡可能还没建。建好之后两边共用同一个数组(`ensureSink`
   * 按引用交接),所以这里只 push 一次。
   */
  pushActivity(step: AgentActivityStep): void {
    if (step.phase === 'think') return
    const session = this.sessionForAgentPayload(step)
    if (!session) return
    // 工具行**也建落点**,不只文字。否则两条播报之间的几十次工具调用只在状态条露一行,
    // 时间线上什么都看不到 —— 而这正是「不能继续感知工具调用」那条抱怨(Ral 2026-08-14)。
    // 建出来的落点会被下一条播报封口,所以它天然只装自己这一段的工具行。
    // 没有活回合 ⇒ 没有落点(`ensureSink` 自己也会直接返回 undefined)。回合已经释放之后
    // 迟到的那几帧丢在这里,而不是凭空造一个回合 —— 与 `pushStream` 同一个姿态。
    const turn = session.turn
    if (!turn) return
    // 状态行「最后触发的赢」:agent 又动了 → 把人插话那一档让开。
    turn.steeringEvent = undefined
    this.ensureSink(session)
    turn.activity.push(step)
    this._state.scheduleScrollToBottomIfNear()
  }

  /** thinking 同理:它描述的是**这一轮**,不是某条消息 —— 底部状态条读它。 */
  pushThinking(payload: AgentThinkingState): void {
    const session = this.sessionForAgentPayload(payload)
    if (!session) return
    const turn = session.turn
    if (!turn) return
    if (payload.active) turn.phase = 'thinking'
    turn.steeringEvent = undefined
    turn.thinking = payload.active
    const sink = this.sink(session)
    if (sink) sink.thinking = payload.active
    if (payload.active) this._state.scheduleScrollToBottomIfNear()
  }

  pushStream(payload: AgentStreamDelta): void {
    const session = this.sessionForAgentPayload(payload)
    if (!session || !payload.delta) return
    // **第一个字符才建气泡** —— 这就是懒建的触发点。这是阶段转移,不是回合的开始。
    if (!this.ensureSink(session)) return
    if (session.turn) {
      session.turn.phase = 'streaming'
      session.turn.steeringEvent = undefined
      session.turn.hasStreamedText = true
    }
    this._state.bufferStreamDelta(session.id, payload.delta)
  }


  /**
   * 新任务归哪个会话。**不再返回落点消息** —— 任务现在各自独占一条 `type: 'task'` 消息,按发生
   * 时间排在时间线上,而不是全部堆进「回合开头那条 assistant 消息」(一轮钻探八张摄取卡挤成一坨、
   * 读不出先后:chat-drill-messages-not-task-shaped.md)。建消息是 message.store 的事。
   *
   * 没有活跃回合 → 不绑:操作者从 Workbench 起的任务属于那条任务条,不属于某个不相干的气泡。
   */
  /**
   * 任务卡绑到哪个会话 —— **按 `task.sessionId` 路由,不猜**
   * (cowork `drill-activity-bleeds-into-another-session.md` 的接收端那半)。
   *
   * 原来这里是 `activeSession()` + 「只认这一轮开始之后起的任务」两道:
   *  · `activeSession()` 是**猜** —— 任务带着自己的主人,读它就好。按"此刻哪个会话活跃"路由,
   *    在多 operation tab 之下必然把 A 的卡画进 B;
   *  · 那道 `time.start < turn.startedAt` 栅栏**不是安全网**:主人的回合先于任务开始,
   *    所以它照样放行 —— 那正是 cowork 当初那些卡被放进来的原因。它真正的活现在由
   *    「归属 + 存活 + 恢复时补种绑定」三条接过去了。
   *
   * **`session.turn` 不再是前置条件**,这是钻探能用的关键:后台摄取跑 15–20 分钟、**活得比回合长**,
   * 完成报告在几分钟后才从后台任务的 `.then()` 里发出。要求有 turn 的话,那份报告永远绑不上,
   * 卡直接被丢 —— 而人看到的是"钻探跑完了但什么都没出现"。
   *
   * 三道 fail-closed:无主人 → 丢(宁可无主也不要一个猜出来的主人)、会话不在或已归档 → 丢、
   * 任务已终结 → 丢(终结的任务不该在新会话里冒出一张卡)。
   */
  bindTask(task: MaestroTask): { sessionId: string } | null {
    // 临时任务不建卡 —— 它只是一次挂起(审批),没有阶段也没有产出,而卡片会占着时间线位置
    // 把 confirm 留档往上顶,那正是底部操作面要解决的问题(approval-task-card-is-timeline-noise.md)。
    // 判据是结构化字段,不是任务名 —— 按名字匹配下一次换个名字就静默失效。
    if (task.transient) return null
    if (!task.sessionId) return null
    const session = this._state.getSession(task.sessionId)
    if (!session || session.archivedAt) return null
    if (task.state.status === 'completed' || task.state.status === 'error') return null
    return { sessionId: session.id }
  }

  private sessionForAgentPayload(payload: {
    sessionId?: string
    turnId?: string
    generation?: number
  }): MessageSession | undefined {
    if (!payload.sessionId || !payload.turnId || typeof payload.generation !== 'number') return undefined
    const session = this._state.getSession(payload.sessionId)
    const turn = session?.turn
    if (
      !session ||
      !turn ||
      turn.id !== payload.turnId ||
      turn.generation !== payload.generation ||
      turn.aborting
    ) {
      return undefined
    }
    return session
  }

  private settleRootDispatch(turnId: string, ready: boolean): void {
    const waiter = this.rootDispatchWaiters.get(turnId)
    if (!waiter) return
    this.rootDispatchWaiters.delete(turnId)
    waiter.resolve(ready)
  }
}
