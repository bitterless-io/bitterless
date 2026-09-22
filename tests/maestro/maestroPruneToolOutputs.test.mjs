import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'

// 直接编译真实源文件跑,避免对着一份手抄的副本断言。
const SOURCE = join(import.meta.dirname, '../../src/main/agent/runtime/pruneToolOutputs.ts')
const compiled = transpileModule(readFileSync(SOURCE, 'utf8'), {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
}).outputText
const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const { pruneToolOutputs, measurePrune, PRUNABLE_TOOL_NAMES, PRUNE_KEEP_RECENT_ROUNDS } = mod

const snapshot = (id, chars) => ({ role: 'toolResult', toolName: 'page_snapshot', toolCallId: id, content: [{ type: 'text', text: 'S'.repeat(chars) }] })
const readFile = (id, chars) => ({ role: 'toolResult', toolName: 'read_file', toolCallId: id, content: [{ type: 'text', text: 'F'.repeat(chars) }] })
const other = (id, chars) => ({ role: 'toolResult', toolName: 'ui_act', toolCallId: id, content: [{ type: 'text', text: 'U'.repeat(chars) }] })
const assistant = (id, args) => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'page_snapshot', arguments: args ?? { tabId: 7 } }] })
const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const textOf = m => (Array.isArray(m.content) ? m.content.map(b => b.text ?? '').join('') : String(m.content ?? ''))

test('已定参数:最近 2 轮 + page_snapshot/read_file', () => {
  assert.equal(PRUNE_KEEP_RECENT_ROUNDS, 2)
  assert.deepEqual([...PRUNABLE_TOOL_NAMES], ['page_snapshot', 'read_file'])
})

test('轮 = assistant 响应,不是用户回合 —— 单回合内 26 次工具调用也会被裁', () => {
  // 故障会话的形状:1 条用户消息 + 26 轮 assistant/toolResult。
  const messages = [user('去把这些页面读一遍')]
  for (let i = 0; i < 26; i++) { messages.push(assistant(`c${i}`)); messages.push(snapshot(`c${i}`, 6_000)) }
  const out = pruneToolOutputs(messages)
  const kept = out.filter(m => m.role === 'toolResult' && !textOf(m).startsWith('[pruned-tool-output]'))
  assert.equal(kept.length, 2, '只应保留最近 2 轮的快照全文')
  assert.equal(textOf(out.at(-1)).length, 6_000, '最后一轮必须是全文')
  const measured = measurePrune(messages, out)
  assert.equal(measured.prunedMessages, 24)
  assert.ok(measured.afterChars < measured.beforeChars / 10, `应大幅缩减,实际 ${measured.beforeChars} → ${measured.afterChars}`)
})

test('白名单外的工具一律不裁', () => {
  const messages = []
  for (let i = 0; i < 5; i++) { messages.push(assistant(`c${i}`)); messages.push(other(`c${i}`, 4_000)) }
  const out = pruneToolOutputs(messages)
  assert.deepEqual(out.map(textOf), messages.map(textOf))
  assert.equal(measurePrune(messages, out).prunedMessages, 0)
})

test('read_file 同样在白名单内,且占位行带得回参数', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'r1', name: 'read_file', arguments: { path: '/tmp/sop.html', offset: 0 } }] },
    readFile('r1', 120_049),
    assistant('c1'), snapshot('c1', 100),
    assistant('c2'), snapshot('c2', 100)
  ]
  const out = pruneToolOutputs(messages)
  const placeholder = textOf(out[1])
  assert.match(placeholder, /^\[pruned-tool-output\] read_file/)
  assert.match(placeholder, /path=\/tmp\/sop\.html/, '占位行要带能重新取值的参数')
  assert.match(placeholder, /120049 字符/)
  assert.ok(!placeholder.includes('offset'), '只带恢复所需的参数,不把整份 arguments 塞回去')
})

test('幂等:重复裁剪不二次改写', () => {
  const messages = []
  for (let i = 0; i < 6; i++) { messages.push(assistant(`c${i}`)); messages.push(snapshot(`c${i}`, 5_000)) }
  const once = pruneToolOutputs(messages)
  const twice = pruneToolOutputs(once)
  assert.deepEqual(twice.map(textOf), once.map(textOf))
  assert.equal(measurePrune(once, twice).prunedMessages, 0, '第二遍不应再裁出任何东西')
  assert.equal(twice, once, '没有新变更时连数组引用都不应该换')
  assert.ok(measurePrune(messages, once).prunedMessages > 0, '第一遍确实裁了')
})

test('纯函数:不改动入参', () => {
  const messages = [assistant('a'), snapshot('a', 3_000), assistant('b'), snapshot('b', 3_000), assistant('c'), snapshot('c', 3_000)]
  const before = messages.map(textOf)
  pruneToolOutputs(messages)
  assert.deepEqual(messages.map(textOf), before)
})

test('没有可裁内容时返回等价副本,不误报变更', () => {
  const messages = [user('hi'), assistant('a'), snapshot('a', 10)]
  const out = pruneToolOutputs(messages)
  assert.deepEqual(out.map(textOf), messages.map(textOf))
  assert.equal(measurePrune(messages, out).prunedMessages, 0)
})

test('空内容的工具结果不生成占位行', () => {
  const messages = [
    assistant('a'), { role: 'toolResult', toolName: 'page_snapshot', toolCallId: 'a', content: [] },
    assistant('b'), snapshot('b', 100), assistant('c'), snapshot('c', 100)
  ]
  const out = pruneToolOutputs(messages)
  assert.equal(measurePrune(messages, out).prunedMessages, 0)
})

test('keepRecentRounds 参数校验', () => {
  assert.throws(() => pruneToolOutputs([], -1), RangeError)
  assert.throws(() => pruneToolOutputs([], 1.5), RangeError)
})

test('keepRecentRounds = 0 时连最近一轮也裁', () => {
  const messages = [assistant('a'), snapshot('a', 2_000)]
  const out = pruneToolOutputs(messages, 0)
  assert.match(textOf(out[1]), /^\[pruned-tool-output\]/)
})

test('measurePrune 只数本轮新裁的,不把上几轮的占位行重复计入', () => {
  // 裁剪结果会持久到 currentContext,所以第二轮的入参本来就带着上一轮的占位行。
  const round = n => { const out = []; for (let i = 0; i < n; i++) { out.push(assistant(`c${i}`)); out.push(snapshot(`c${i}`, 1_000)) } return out }
  const first = round(5)
  const afterFirst = pruneToolOutputs(first)
  assert.equal(measurePrune(first, afterFirst).prunedMessages, 3)
  // 再加一轮,只应新裁 1 条 —— 而不是报 4 条。
  const second = [...afterFirst, assistant('c5'), snapshot('c5', 1_000)]
  const afterSecond = pruneToolOutputs(second)
  assert.equal(measurePrune(second, afterSecond).prunedMessages, 1)
  assert.equal(measurePrune(second, afterSecond).afterChars < measurePrune(second, afterSecond).beforeChars, true)
})

test('无变更时返回原引用 —— 钩子靠 !== 判断这轮有没有裁,副本会让它恒为真', () => {
  const messages = [user('hi'), assistant('a'), snapshot('a', 10)]
  assert.equal(pruneToolOutputs(messages), messages, '没裁就必须是同一个引用')
  const many = []
  for (let i = 0; i < 4; i++) { many.push(assistant(`c${i}`)); many.push(snapshot(`c${i}`, 900)) }
  assert.notEqual(pruneToolOutputs(many), many, '裁了就必须是新数组,不能原地改入参')
})

test('空数组与非数组输入安全返回', () => {
  assert.deepEqual(pruneToolOutputs([]), [])
  assert.deepEqual(pruneToolOutputs(undefined), undefined)
})
