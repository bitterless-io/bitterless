import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * **哪个会话正在产出** —— 一个回合执行期间的隐式上下文。
 *
 * 契约:`docs/features/cowork-multi-session.md` #1。
 *
 * 为什么需要它:活动条 / 进度行的广播(`agentBroadcast.ts`)payload **原来不带 sessionId**,
 * 渲染层只能把它挂到"当前活跃会话"上 —— 这在 `MAX_CONCURRENT_TURNS = 1` 时碰巧总是对的,
 * 而放开并发后它会把 A 会话的工具行画到 B 会话里。这不是显示瑕疵:人会据此判断"我这一轮在干什么"。
 *
 * 为什么用 `AsyncLocalStorage` 而不是给 40 个调用点加参数:那些广播来自很深的服务
 * (`documentReader` 的解析进度、归档解包、技能重放),它们**本来就不该知道会话** ——
 * 会话是"谁在调用我"的属性,不是"我在做什么"的属性。ALS 正是表达这件事的机制:
 * 回合在自己的异步上下文里跑,里面任意深处都能问"我属于谁",而并发的两个回合各有自己的 store。
 *
 * 一个模块级变量做不到这件事:两个回合交替 await 时它会被后进来的那个覆盖 —— 那就是
 * 我们要修的 bug 本身。
 */
/**
 * 【这一回合的暂存】—— 深层服务往里写,回合收尾时读出来决定回复。
 *
 * 为什么必须挂在 ALS 上而不是模块级字段(issues/drill-activity-bleeds-into-another-session.md
 * 的"仍然开着的一半"):`lastAgentRun` / `lastAgentArtifacts` 原来是 service 上的普通字段,
 * 语义上却是"本回合"。并发之后 **B 回合开始时的清零会把 A 正在攒的东西抹掉**,而 A 收尾时读到的
 * 是 B 攒的 —— `replay` 决定 A 的回复文本、`files` 直接挂到 A 的消息上。这不是显示问题,是回复
 * 内容本身串了。
 *
 * 写入方散在 skill.service / requestExec(5 处)/ workspaceFile / 控制器,它们**本来就不该知道
 * 会话** —— 与活动播报同一个理由,所以用同一个机制。
 */
export interface AgentRunScratch {
  lastAgentRun: { skill?: unknown; skills?: unknown; replay?: unknown }
  lastAgentArtifacts: unknown[]
  tabsOpenedThisTurn: unknown[]
}

export interface AgentSessionContext {
  /** `agentSessionKey()` 的产物:聊天会话 id,缺省 `'default'`。 */
  sessionKey: string
  /** 本回合的暂存。**每次 runInAgentSession 新建一个**,所以并发回合各攒自己的。 */
  run: AgentRunScratch
}

const storage = new AsyncLocalStorage<AgentSessionContext>()

/** 在某个会话的上下文里跑一段(回合执行、工具循环都在里面)。 */
export const runInAgentSession = async <T>(sessionKey: string, fn: () => Promise<T>): Promise<T> =>
  await storage.run({ sessionKey, run: { lastAgentRun: {}, lastAgentArtifacts: [], tabsOpenedThisTurn: [] } }, fn)

/**
 * 本回合的暂存;不在回合里返回 `undefined`(调用方回退到 service 上那份 —— 非回合路径仍然要能用)。
 */
export const currentAgentRun = (): AgentRunScratch | undefined => storage.getStore()?.run

/** 当前上下文的会话 key;不在任何回合里(定时任务、启动期)时返回 undefined。 */
export const currentAgentSessionKey = (): string | undefined => storage.getStore()?.sessionKey

/**
 * 会话键退化时的那个值。**单独导出**,因为「是不是 'default'」这个判断在多处出现,
 * 抄字面量迟早会漏一处。
 */
export const DEFAULT_AGENT_SESSION_KEY = 'default'

/**
 * 当前**聊天会话 id** —— 与 `currentAgentSessionKey()` 的区别只有一条,但那一条是关键:
 * 退化键 `'default'` 在这里算**没有归属**,返回 `undefined`。
 *
 * 为什么必须区分:`'default'` 匹配不到任何真实会话 id,把它当归属盖到事件上,接收端就会
 * "解析不到 → 退化到当前活跃会话",于是一个会话的进度行画进另一个会话
 * (issues/drill-activity-bleeds-into-another-session.md 的 (b) 那半)。
 * 宁可无主(被丢弃且留日志),也不要一个会骗人的主人。
 */
export const currentChatSessionId = (): string | undefined => {
  const key = storage.getStore()?.sessionKey
  return key && key !== DEFAULT_AGENT_SESSION_KEY ? key : undefined
}
