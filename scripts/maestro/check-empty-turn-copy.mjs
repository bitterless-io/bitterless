// 【聊天里的话是给人看的,诊断进日志】
// 契约见 micromeet-cowork/apps/cowork/docs/issues/chat-shows-internal-diagnostics-as-user-facing-text.md
//
// 2026-09-22 Ral 在 Cowork 上收到一条他看不懂的消息:
//   「The assistant (Micromeet (qwen3.8-flash)) ended without acting
//     (stop: toolUse, tools used: 4). … re-record the skill if its steps no longer fit this page.」
// 「这种报错用户看不懂的不该展示」。聊天是两个产品的共同功能(BL 叫 Maestro,Cowork 叫 Cowork),
// 同一段代码在两边都有,所以同步修改、同步守卫。
//
// 这里钉三件事:契约文案 main 与渲染层逐字一致、两种语言都有、开发者文案不许回到气泡里。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(projectRoot, 'src', rel), 'utf8')

const agent = read('main/agent/maestroAgent.service.ts')
const turnSvc = read('renderer/maestro/control/src/store/turn.service.ts')
const en = read('renderer/common/i18n/en.ts')
const zh = read('renderer/common/i18n/zh.ts')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

/** 去掉注释 —— 反向断言(「不许再出现 X」)的天敌是解释它为什么存在的那段注释本身。 */
const codeOnly = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n')

/**
 * 两句契约文案。main 写进 `reply.text`,渲染层按**原文**认出来再换成本地化的说法 ——
 * 所以它们必须逐字一致,而"逐字一致"没有类型能保证,只有这条断言能。
 */
const COPY = [
  'The model returned nothing this turn. Send it again, or pick a different model above.',
  'I did not get a usable result this turn. Send it again, in different words if that helps.'
]

for (const line of COPY) {
  assert(agent.includes(line), `maestroAgent must write the contract copy verbatim: ${line.slice(0, 40)}…`)
  assert(turnSvc.includes(line), `turn.service must match the contract copy verbatim: ${line.slice(0, 40)}…`)
}

// 两种语言都要有对应的那条。
for (const [name, catalog] of [['en', en], ['zh', zh]]) {
  assert(/emptyTurnModelSilent: '/.test(catalog), `${name} i18n is missing chat.emptyTurnModelSilent`)
  assert(/emptyTurnNoResult: '/.test(catalog), `${name} i18n is missing chat.emptyTurnNoResult`)
}
assert(
  /i18nHelper\.maestroControl\.chat\.emptyTurnModelSilent/.test(turnSvc) &&
    /i18nHelper\.maestroControl\.chat\.emptyTurnNoResult/.test(turnSvc),
  'turn.service must render the localized copy, not the English contract string'
)
assert(
  /emptyTurnCopy\(reply\) \|\| safeReplyText \|\| fallback/.test(turnSvc),
  'the localized empty-turn copy must take precedence over the raw reply text in the bubble body'
)

// 诊断进日志 —— 正文不写了,事实就得有别的地方落下来。
const agentCode = codeOnly(agent)
assert(/phase: 'empty-agent-turn'/.test(agentCode), 'empty-agent-turn must log a diagnostic to the Workbench log')
assert(/stopReason: result\.stopReason \|\| null/.test(agentCode), 'that diagnostic must carry stopReason')
assert(/toolCalls: result\.toolCalls \?\? 0/.test(agentCode), 'that diagnostic must carry toolCalls')

// 旧的开发者文案不许回到聊天里。
for (const jargon of ['ended without acting', 're-record the skill', 'tools used:']) {
  assert(!agentCode.includes(jargon), `developer copy "${jargon}" belongs in the log, not in a chat bubble`)
}

console.log('check-empty-turn-copy: OK')
