import type { ChatMessage } from './message.type'

/**
 * **一条消息属于哪一类** —— 「它进不进模型的上下文」的**单一判据**。
 *
 * 照 pi 的两类做(`@earendil-works/pi-coding-agent` `core/session-manager.d.ts`):
 *
 *  · `custom`         —— 注释原话「**Does NOT** participate in LLM context」。给人看的东西:
 *                        任务卡、审批卡、拍板卡、斜杠命令回显、失败诊断。
 *  · `custom_message` —— 注释原话「This **DOES** participate」。进上下文,但渲染成一种
 *                        区别于用户消息的样子:人从选项里挑出来的那一句、压缩摘要。
 *  · `message`        —— 普通对话消息(人打的字、模型正文、附件)。
 *
 * **为什么要有这个函数**(`overmind:areas/agent-runtime/cha./message.types.html` #3 建议 1):
 * 原来「会不会进提示词」是**十几处各自维护的一个布尔**(`promptExcluded`),由产生消息的那一处
 * 记得设 —— 漏设不报错,只会静默多喂或少喂一段,而这是整条链上最贵的那个判断。
 * 现在它是一张表:加一种条目只加一行,投影只读这一个函数。
 *
 * `promptExcluded` **还留着**,但它的职责已经收窄成**唯一一件事**:回合内 steering 那条消息
 * 在「排队中 → 送达」之间的那一小段(见 #3 建议 3 —— 那一档最终会由队列投影取代,
 * 到那时这个字段可以整个删掉)。
 */
export type MessageCustomType =
  | 'task'
  | 'confirm'
  | 'decision'
  | 'local-notice'
  | 'failure'
  | 'compaction'

export type MessageEntryClass = 'message' | 'custom' | 'custom_message'

/** 永不进上下文的那几种。 */
const NEVER_IN_CONTEXT: ReadonlySet<MessageCustomType> = new Set<MessageCustomType>([
  'task', 'confirm', 'decision', 'local-notice', 'failure'
])

/**
 * 进上下文、但要渲染成区别于用户消息的样子的那几种(pi 的 `CustomMessageEntry`)。
 *
 * 今天只有压缩摘要一个成员。曾经打算加的 `user-selected`(人从 `ask_user` 选项里挑出来的那一句)
 * **2026-09-22 被否掉**:那张拍板卡本身就是 `role: 'ai'`、已经在左边,选中项就高亮在卡里 ——
 * 再贴一个气泡是同一件事说两遍。一个没有产生者的类型不加。
 */
const IN_CONTEXT_CUSTOM: ReadonlySet<MessageCustomType> = new Set<MessageCustomType>(['compaction'])

/**
 * 老数据没有 `customType` —— 从既有形态推回去,这样库里那些行不用迁移也能归类。
 * 新代码**一律显式带 `customType`**;这里只是兜底。
 */
const inferCustomType = (message: ChatMessage): MessageCustomType | undefined => {
  if (message.customType) return message.customType
  if (message.type === 'task') return 'task'
  if (message.type === 'confirm') return 'confirm'
  if (message.type === 'decision') return 'decision'
  if (message.type === 'compact') return 'compaction'
  if (message.localOnly) return 'local-notice'
  if (message.error) return 'failure'
  return undefined
}

export const entryClass = (message: ChatMessage): MessageEntryClass => {
  const custom = inferCustomType(message)
  if (!custom) return 'message'
  if (NEVER_IN_CONTEXT.has(custom)) return 'custom'
  if (IN_CONTEXT_CUSTOM.has(custom)) return 'custom_message'
  return 'message'
}

/** 这条消息**永远**不进上下文吗(pi 的 `CustomEntry`)。投影的第一道闸。 */
export const isCustomEntry = (message: ChatMessage): boolean => entryClass(message) === 'custom'
