// 每个 subagent 的派发与结束必须进 session transcript。
//
// Ral 2026-09-21:「UI 上有 sub agents 任务了,你能否判断 subagents 是否正常在跑,有足够的日志么」——
// 答案当时是「不能」:那次 run 的 agent-io 里一共 12 条记录,**Agent 记录 0 条**。
//
// 原因是换引擎时悄悄丢的。`agent-dispatched` / `agent-end` 这两行只在 `startAttempt` 里写,
// 而那是已退役的「每个 Agent 一个进程」模型的一部分 —— 新引擎从不发 `attempt.start`,于是没人调它。
// 任务栏照常显示(它读的是实时快照),这正是它一直没被发现的原因:屏幕上 Agent 全在,
// transcript 里一个都没有。会话一关,什么都不剩。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { electron: fileURLToPath(new URL('./electronStub.cjs', import.meta.url)) }, fsCache: false })
const { WorkflowSupervisor } = await jiti.import(join(root, 'src/main/agent/workflowEngine/supervisor.ts'))

class Child extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.sent = [] }
  postMessage(message) { this.sent.push(message) }
  message(message) { this.emit('message', message) }
  exit() { this.emit('exit', 0) }
}
const runtime = { providerId: 'fixture', modelId: 'fixture', thinkingLevel: 'low', authPath: '/nope', systemPrompt: '' }
const tick = () => new Promise(resolve => setImmediate(resolve))

const harness = async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'agent-io-'))
  const lines = []
  const children = []
  const supervisor = new WorkflowSupervisor(
    { workflowWorkerPath: 'engine', agentWorkerPath: 'agent', storageDir, broadcast() {}, executeTool: async () => 'x', recordIo: (sessionId, line) => lines.push({ sessionId, ...line }) },
    {
      fork() { const c = new Child(9000 + children.length); children.push(c); return c },
      // 必须真的让子进程退出,否则 dispose() 等不到终止确认 —— 和 core.test.mjs 的假进程同款。
      signal(pid) { children.find(c => c.pid === pid)?.exit() },
      async terminateOwnedProcesses() {}
    }
  )
  const run = await supervisor.start({ sessionId: 'chat-a', entry: { kind: 'builtin', name: 'agent-task' }, input: 'review it', cwd: root }, runtime)
  children[0].message({ type: 'ready' })
  const update = (id, patch) => children[0].message({ type: 'agent.update', agent: {
    id: String(id), runId: run.id, sessionId: 'chat-a', label: `finder-${id}`, prompt: 'look for X',
    phase: 'Find', status: 'running', currentAction: 'Working', queuedAt: 1, startedAt: 2, logs: [], ...patch
  } })
  return { supervisor, run, lines, update, cleanup: async () => { await supervisor.dispose(); await rm(storageDir, { recursive: true, force: true }) } }
}

test('每个 Agent 恰好留下一条派发、一条结束', async () => {
  const h = await harness()
  try {
    h.update(1); h.update(2)
    await tick()
    const dispatched = h.lines.filter(l => l.name === 'agent-dispatched')
    assert.equal(dispatched.length, 2, '两个 Agent 就该有两条派发记录')
    assert.deepEqual(dispatched.map(l => l.subject), ['finder-1', 'finder-2'])
    assert.equal(dispatched[0].text, 'look for X', '派发要带提示词 —— 否则没法判断它被要求做什么')

    // 快照每秒重发:同一个 Agent 不能每次都写一遍。
    h.update(1); h.update(1, { currentAction: 'Still working' })
    await tick()
    assert.equal(h.lines.filter(l => l.name === 'agent-dispatched').length, 2, '重复快照不许重复记录')

    h.update(1, { status: 'completed', endedAt: 5, output: 'found 3 things' })
    h.update(2, { status: 'failed', endedAt: 7, error: 'provider quota' })
    await tick()
    const ended = h.lines.filter(l => l.name === 'agent-end')
    assert.equal(ended.length, 2)
    assert.equal(ended[0].detail.data.status, 'completed')
    assert.equal(ended[0].text, 'found 3 things', '结果要留下来')
    assert.equal(ended[0].detail.data.ms, 3, '用时可算 —— 判断它是真跑了还是秒退')
    assert.equal(ended[1].detail.data.status, 'failed')
    assert.equal(ended[1].text, 'provider quota', '失败原因要留下来')

    // 终态之后再来的快照也不许再写。
    h.update(1, { status: 'completed', endedAt: 5 })
    await tick()
    assert.equal(h.lines.filter(l => l.name === 'agent-end').length, 2)
  } finally { await h.cleanup() }
})

test('run 级的两条照旧在,Agent 记录是补上的那一层', async () => {
  const h = await harness()
  try {
    h.update(1, { status: 'completed', endedAt: 9 })
    await tick()
    const names = h.lines.map(l => l.name)
    assert.ok(names.includes('workflow-start'), 'run 开始')
    assert.ok(names.includes('agent-dispatched') && names.includes('agent-end'), 'Agent 两端')
    // 每条都要能归到具体哪个 Agent,否则并发时分不清谁是谁。
    for (const line of h.lines.filter(l => l.name.startsWith('agent-'))) {
      // 顶层 agentId —— sessionReviewReader 按它分组,放进 data 里它看不见。
      assert.ok(line.detail.agentId, `${line.name} 必须带顶层 agentId`)
      assert.equal(line.detail.phase, 'Find', '阶段也要带 —— 7 个 finder 并行时这是唯一的分组依据')
    }
  } finally { await h.cleanup() }
})
