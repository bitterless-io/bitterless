// 【回合不许有超时】
// 契约见 micromeet-cowork/apps/cowork/docs/issues/chat-shows-internal-diagnostics-as-user-facing-text.md
//
// Ral 2026-09-22:「有的任务或 tool 耗时就是就 例如,下载 … 一个 tool 下载一个资料就是要
// 几个小时或者更久,不能设置超时的,一直静默就静默着,如果用户需要可以 让 agent 定时检查下
// 下载进展 怎么检查是 agent 自己灵活决定的」。
//
// BL 这边删掉的是两层:渲染层 11 分钟**沉默**看门狗,以及 main 侧 600 秒的整回合墙钟
// (`BaseAgent` 的默认值 —— BL 从来没覆盖过它,所以任何超过 10 分钟的聊天回合都跑不完)。
// 一个长工具调用只在开始时发一次 `tool_start`,之后到结束一个事件都没有,所以"多久没有产出"
// 这个判据量的根本不是健康度,是耗时。
//
// 回合现在只有两个终点:**跑完**,或者**人按 Stop**。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(projectRoot, 'src', rel), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

/** 去掉注释 —— 反向断言的天敌是解释它为什么存在的那段注释本身。 */
const codeOnly = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n')

const turnSvc = codeOnly(read('renderer/maestro/control/src/store/turn.service.ts'))
const agent = codeOnly(read('main/agent/maestroAgent.service.ts'))
const base = codeOnly(read('main/agent/BaseAgent.ts'))

assert(!/withInactivityTimeout/.test(turnSvc), 'the renderer must not re-introduce a silence watchdog — a long tool call emits no events while it runs')
assert(!/CHAT_TURN_TIMEOUT_MS/.test(turnSvc), 'the renderer must not re-introduce a turn timeout constant')
assert(!/lastActivityAt/.test(turnSvc), 'the watchdog clock goes too — an unread "last activity" timestamp reads like the timeout is still there')

// 聊天 agent 有两个构造点(启动时的 default,以及 per-session 那个),两个都要显式不设上限。
const uncapped = agent.split('turnTimeoutMs: 0').length - 1
assert(uncapped === 2, `both chat agent constructions must pass turnTimeoutMs: 0 (found ${uncapped}) — otherwise BaseAgent's 600s default kills any turn over 10 minutes`)
assert(/timeoutMs > 0\s*\n?\s*\? withCompactionAwareTimeout/.test(base), 'BaseAgent must treat 0 as "no cap", not "expire immediately"')
// 短活仍然**该**有上限:标题生成这类不该因为这条规则一起变成无限。
assert(/600_000/.test(base), "BaseAgent's default cap stays — only chat turns opt out; title generation and friends should still time out")

console.log('check-turn-has-no-timeout: OK')
