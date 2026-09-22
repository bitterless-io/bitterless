import { xpcMain } from 'electron-xpc/main'
import {
  AGENT_DECISIONS_CHANGED,
  DECISION_OTHER_LABEL,
  MAX_DECISION_OPTIONS,
  MAX_DECISION_QUESTIONS,
  MIN_DECISION_OPTIONS,
  type AgentDecisionAnswer,
  type AgentDecisionQuestion,
  type AgentDecisionRequest
} from '@shared/agentDecision.api'

/**
 * 待人拍板的 decision,以及把工具调用**挂住**的那些 resolver。
 *
 * 形状照 `taskRegistry` 的 `requestConfirm`:主进程持有 pending 状态并广播,渲染端把它投影成
 * 时间线上的一条消息;人一答,XPC 回来 resolve 那个挂着的 Promise。
 *
 * 与 confirm 的区别只有一条、但很关键:**它不挂在任务上,挂在会话上**。发起方是 agent 自己的
 * 一次工具调用,不是某个任务要审批。
 *
 * 见 `docs/features/agent-decision-sheet.md`。
 */
class AgentDecisionRegistry {
  private seq = 0
  private readonly pending = new Map<string, AgentDecisionRequest>()
  private readonly resolvers = new Map<string, (answer: AgentDecisionAnswer) => void>()

  /** 当前所有待答的拍板。渲染端据此投影消息。 */
  list(): AgentDecisionRequest[] {
    return [...this.pending.values()]
  }

  /**
   * 挂起一次拍板,直到人提交或取消。
   *
   * **不设超时。** 这是刻意的:它等的是人,而人可能去开会了。超时会让 agent 收到一个
   * "没人回答"的假事实并继续往下走 —— 那比一直等更糟。要停就按 Stop,`cancelSession()`
   * 会把这一问以"取消"了结。
   */
  request(sessionId: string, questions: AgentDecisionQuestion[]): Promise<AgentDecisionAnswer> {
    const decisionId = `decision-${++this.seq}-${Date.now().toString(36)}`
    const entry: AgentDecisionRequest = { decisionId, sessionId, questions, createdAt: Date.now() }
    return new Promise<AgentDecisionAnswer>((resolve) => {
      this.pending.set(decisionId, entry)
      this.resolvers.set(decisionId, resolve)
      this.publish()
    })
  }

  /** 渲染端 → 主进程:人点了提交或取消。同一个 id 只认第一次。 */
  resolve(answer: AgentDecisionAnswer): { ok: boolean } {
    const resolver = this.resolvers.get(answer.decisionId)
    if (!resolver) return { ok: false }
    this.resolvers.delete(answer.decisionId)
    this.pending.delete(answer.decisionId)
    resolver(answer)
    this.publish()
    return { ok: true }
  }

  /**
   * 会话被停止 / 删除 / 归档时,把它名下还挂着的拍板一律以"取消"了结。
   *
   * 不了结的话那个工具调用会永远挂着,而它所在的回合早就没了 —— 回合结束时没人 resolve 它,
   * 这个 Promise 就是一条谁也够不着的泄漏。
   */
  cancelSession(sessionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.sessionId !== sessionId) continue
      this.resolve({ decisionId: entry.decisionId, cancelled: true })
    }
  }

  private publish(): void {
    xpcMain.broadcast(AGENT_DECISIONS_CHANGED, { decisions: this.list() })
  }
}

export const agentDecisionRegistry = new AgentDecisionRegistry()

/**
 * 把模型给的问题**收进契约**。越界就报错而不是悄悄截断 —— 截断出来的卡人看着是完整的,
 * 而它少了一个选项,那比直接告诉模型"你传错了"糟得多。
 *
 * `__other__` 由界面自动补,所以这里明确拒绝调用方自带一个同名项。
 */
export const normalizeDecisionQuestions = (input: unknown): AgentDecisionQuestion[] => {
  if (!Array.isArray(input) || input.length === 0) throw new Error('questions must be a non-empty array')
  if (input.length > MAX_DECISION_QUESTIONS) throw new Error(`at most ${MAX_DECISION_QUESTIONS} questions per decision`)
  return input.map((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const question = String(item.question ?? '').trim()
    const header = String(item.header ?? '').trim()
    if (!question) throw new Error(`questions[${index}].question is required`)
    if (!header) throw new Error(`questions[${index}].header is required`)
    const rawOptions = Array.isArray(item.options) ? item.options : []
    if (rawOptions.length < MIN_DECISION_OPTIONS || rawOptions.length > MAX_DECISION_OPTIONS) {
      throw new Error(`questions[${index}].options must hold ${MIN_DECISION_OPTIONS}-${MAX_DECISION_OPTIONS} entries`)
    }
    const options = rawOptions.map((entry, optionIndex) => {
      const option = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const label = String(option.label ?? '').trim()
      if (!label) throw new Error(`questions[${index}].options[${optionIndex}].label is required`)
      if (label === DECISION_OTHER_LABEL) {
        throw new Error('the free-text option is added by the interface; do not declare it')
      }
      const description = String(option.description ?? '').trim()
      return description ? { label, description } : { label }
    })
    return { header, question, multiSelect: item.multiSelect === true, options }
  })
}
