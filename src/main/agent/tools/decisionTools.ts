import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'
import { agentDecisionRegistry, normalizeDecisionQuestions } from '@main/agent/decisionRegistry.service'
import { DECISION_OTHER_LABEL } from '@shared/agentDecision.api'

/**
 * `ask_user` —— agent 需要人在几条路里拍板时,唤起时间线上的一张卡。
 *
 * **它是阻塞的**:这次工具调用挂着不返回,直到人提交或取消,回合一直活着。这正是它存在的理由 ——
 * 不阻塞的话,它与"写一段话问你、然后结束这一轮"的区别只剩好看,而模型还得从上下文里自己认出
 * 「这是对刚才那问的回答」。契约与取舍见 `docs/features/agent-decision-sheet.md`。
 *
 * 描述文案是**给模型看的**,逐条对齐 Claude 的 `AskUserQuestion`:什么时候该用、什么时候不该用、
 * 「其他」不许自己声明。写松了,模型要么该问的时候不问,要么把它当成万能的反问出口。
 */
export const buildDecisionTools = (sessionKey: string): AgentToolSpec[] => [
  {
    name: 'ask_user',
    description:
      'Ask the user to decide between concrete options when you genuinely cannot resolve it yourself, and present the choices as a card instead of prose. ' +
      'Use it when the answer changes what you do next and the alternatives are real: which of several approaches to take, which target to act on, how to handle an ambiguity the files and the conversation do not settle. ' +
      'This call BLOCKS until the user answers, so you keep the turn and continue with their answer — do not end your reply to ask a question. ' +
      'Do NOT use it for things you can decide with a sensible default, for confirmation of an action (that has its own approval flow), or to ask the user to do your research. ' +
      'Each question needs a short header, the full question, and 2-4 options that each carry a label plus a description of what choosing it means. ' +
      'Set multiSelect to true when several answers can hold at once — features to enable, files to include — and phrase that question accordingly ("which of these…"); leave it false when the choices are mutually exclusive. ' +
      'NEVER add an "other"/"something else" option yourself — the interface always appends a free-text one. ' +
      'Returns the chosen labels, or the user\'s own text when they typed their own answer, or a cancellation you must then handle yourself.',
    params: [
      {
        name: 'questions_json',
        required: true,
        description:
          'JSON array of 1-4 questions. Each: {"header": "≤12 chars", "question": "full question?", "multiSelect": true|false, "options": [{"label": "1-5 words", "description": "what this choice means"}]}. ' +
          'multiSelect is optional and defaults to false (exactly one answer); true lets the user pick several options for that question.'
      }
    ],
    execute: async (args) => {
      let questions
      try {
        questions = normalizeDecisionQuestions(JSON.parse(String(args.questions_json ?? '')))
      } catch (error) {
        // 报错而不是悄悄修正:一张少了选项的卡,人看上去是完整的。
        return `ERROR: ${error instanceof Error ? error.message : String(error)}`
      }
      const answer = await agentDecisionRegistry.request(sessionKey, questions)
      if (answer.cancelled) {
        // **明确的取消结果,不是异常、不是空。** 措辞要让模型知道"人看见了、选择不回答",
        // 而不是"没人在" —— 后者会让它一直重试。它也不中止回合:接下来怎么办由模型自己定。
        return 'The user saw the question and chose not to answer it. Do not ask it again the same way: decide with a stated assumption, or say what you need and stop.'
      }
      const picked = answer.picked || []
      return JSON.stringify(
        questions.map((question, index) => ({
          header: question.header,
          question: question.question,
          // 选了"其他"时这里是人打的原文 —— 哨兵不会漏到模型眼前。
          answer: (picked[index] || []).filter((value) => value !== DECISION_OTHER_LABEL)
        })),
        null,
        2
      )
    }
  }
]
