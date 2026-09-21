// 结论要进上下文,而且要按 Pi 的形状:事实行 + 有界正文 + 全量结果的磁盘路径。
//
// A3(Ral 2026-09-21 定:按 Pi 对齐)。改之前:完成消息是 `promptExcluded: true`,模型永远读不到
// workflow 产出了什么 —— 而等待回执还告诉它「results land in your context」。宿主承诺了一件它不做
// 的事,于是模型只能反复轮询 `workflow_tasks`,把主 prompt 从 98KB 灌到 830KB。
//
// Pi 的 `deliverText` 注释里那句是这段设计的承重点:
//   "Always point at the full persisted result so the tail is never lost — even when the summary
//    above is a complete verdict/summary field or an untruncated dump."
// **有界不等于有损**:上下文拿摘要,要细节就 read 那个文件。少了路径,截断就是真丢。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = fileURLToPath(new URL('../../src/', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared': src + 'shared' } })
const { workflowCompletionChatText, COMPLETION_RESULT_CHARS } =
  await jiti.import(fileURLToPath(new URL('../../src/renderer/maestro/control/src/workflow.presentation.ts', import.meta.url)))
const { workflowEn: text } = await jiti.import(fileURLToPath(new URL('../../src/renderer/maestro/control/src/workflow.messages.ts', import.meta.url)))

const run = (patch = {}) => ({
  id: 'r1', sessionId: 'chat-a', name: 'code-review', status: 'completed',
  input: 'x', createdAt: 1_000, endedAt: 76_000,
  agents: [{ id: '1', label: 'A', status: 'completed' }, { id: '2', label: 'B', status: 'failed' }],
  result: 'findings…', resultPath: '/data/workflow-runs/results/r1.txt', ...patch
})

test('事实行给出 Agent 数和用时 —— 判断跑得对不对最先看这两个', () => {
  const out = workflowCompletionChatText(run(), text)
  assert.match(out, /2 agents · 1m15s/, '用时要人读得懂,不是毫秒')
})

test('正文有界,且**永远**附全量结果的路径', () => {
  const long = workflowCompletionChatText(run({ result: 'R'.repeat(9_000) }), text)
  assert.ok(long.length < COMPLETION_RESULT_CHARS + 1_000, `投递正文必须有界,实际 ${long.length}`)
  assert.match(long, /more characters/, '截断要说出来')
  assert.match(long, /↳ Full result: \/data\/workflow-runs\/results\/r1\.txt/, '截断了当然要给路径')

  // 关键:**没截断也要给**。Pi 的注释明说 even when the summary is a complete dump。
  const short = workflowCompletionChatText(run({ result: '就三个字' }), text)
  assert.doesNotMatch(short, /more characters/)
  assert.match(short, /↳ Full result: /, '没截断也必须给路径 —— 否则「要细节去读文件」这条路时有时无')
})

test('没有结果时不硬造一行路径', () => {
  const out = workflowCompletionChatText(run({ result: undefined, resultPath: undefined, error: 'boom' }), text)
  assert.match(out, /boom/)
  assert.doesNotMatch(out, /Full result/)
})

test('失败的 Agent 在花名册里点名 —— 「完成」和「完成但挂了两个」不是一回事', () => {
  const out = workflowCompletionChatText(run(), text)
  assert.match(out, /- B: Failed/)
  assert.match(out, /finished with 1 failed Agents/)
})

test('结果由主进程送进上下文,renderer 那条**保持** promptExcluded —— 否则送两遍', () => {
  // BL 和 Cowork 在这里是**两套机制,不要照抄**:
  //  · BL:`onRunSettled` → `retainBackgroundContext(workflowCompletionContext(run))`,主进程直接把
  //    结果插进 agent 上下文;`onWaitSatisfied` 只送引用文本(它自己的注释:repeating it here would
  //    show the model the same result twice)。所以 renderer 那条是纯展示,promptExcluded 正确。
  //  · Cowork:没有这条主进程路径,结果从来没到过模型 —— 那才是 A3 要修的。
  const service = readFileSync(join(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8')
  assert.match(service, /onRunSettled[\s\S]{0,200}retainBackgroundContext\(workflowCompletionId\(run\), workflowCompletionContext\(run\)\)/,
    '主进程必须在 run 落终态时把结果留进上下文')
  const store = readFileSync(join(root, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8')
  const at = store.indexOf('workflowCompletionChatText(run, workflowText())')
  assert.match(store.slice(at, at + 400), /promptExcluded: true/,
    '主进程已经送过了,renderer 这条再进上下文就是同一份结果出现两次')
})

test('等待回执的措辞要和实现对得上', () => {
  const wait = readFileSync(join(root, 'src/main/agent/workflowEngine/workflowWait.ts'), 'utf8')
  assert.doesNotMatch(wait, /their results land in your context and the user speaks next/,
    '旧措辞说结果会自己出现在上下文里,而当时并没有任何东西做这件事')
  assert.match(wait, /delivered into this chat as a message you will see on your next turn/)
})
