/**
 * Decision sheet —— agent 需要人拍板时唤起的那张带选项的卡。
 *
 * 契约**逐项对齐 Claude Code 的 `AskUserQuestion`**(Ral 2026-09-22:「以 pi claude 交互为准」)。
 * 先核查过:**pi 自己没有这个机制** —— 它的 7 个内置工具是 read/bash/edit/write/grep/find/ls,
 * 全仓没有 elicit / ask-user 任何形态。所以它落在宿主这一侧,与本仓其它业务工具同形。
 *
 * 设计见 `docs/features/agent-decision-sheet.md`。
 */

/** 选项上限。多于这个数,这张卡就从"卡住的一步"变成一份问卷。 */
export const MAX_DECISION_OPTIONS = 4;
export const MIN_DECISION_OPTIONS = 2;
export const MAX_DECISION_QUESTIONS = 4;

/**
 * 自由输入那一项的固定 label。
 *
 * **它由界面自动补,调用方不许自己声明** —— Claude 的 schema 里写得很直白
 * (“There should be no 'Other' option, that will be provided automatically”)。
 * 让模型自己造一个"其他",它会把它写成一个普通选项,那一项点下去没有输入框。
 */
export const DECISION_OTHER_LABEL = '__other__';

export interface AgentDecisionOption {
  label: string
  /** 让人能选的那部分 —— 只有 label 的选项要靠猜。 */
  description?: string
}

export interface AgentDecisionQuestion {
  /** ≤ 12 字的短标签,卡片上做 chip。 */
  header: string
  question: string
  multiSelect?: boolean
  options: AgentDecisionOption[]
}

/** 一次待回答的拍板。`sessionId` 决定它出现在哪个会话的时间线里。 */
export interface AgentDecisionRequest {
  decisionId: string
  sessionId: string
  questions: AgentDecisionQuestion[]
  createdAt: number
}

/**
 * 人给出的答案。
 *
 * `picked[i]` 是第 i 问选中的 label 数组 —— **从一开始就是数组**,单选时长度为 1。
 * 选了"其他"时,该位置放的是人打的原文,而不是 `DECISION_OTHER_LABEL`。
 */
export interface AgentDecisionAnswer {
  decisionId: string
  picked?: string[][]
  /** 人看见了、选择不回答。**不等于 Stop** —— 回合不中止,交回模型自己决定。 */
  cancelled?: boolean
}

export const AGENT_DECISIONS_CHANGED = 'agent/decisions';
