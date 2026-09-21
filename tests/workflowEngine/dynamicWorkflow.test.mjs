import test from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { readFileSync } from 'node:fs'
import { parseWorkflowScript } from '@quintinshaw/pi-dynamic-workflows'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared': src + 'shared', '@main': src + 'main' } })
const { DynamicWorkflowRows, toStatus } = await jiti.import('../../src/main/agent/workflowEngine/dynamic/dynamicWorkflow.ts')

const sink = () => {
  const published = []
  return { published, publish: row => published.push({ ...row }) }
}
const rows = s => new DynamicWorkflowRows({ runId: 'run-1', sessionId: 'chat-1' }, s)

test('the five engine states map onto the host set without inventing one', () => {
  assert.equal(toStatus('queued'), 'queued')
  assert.equal(toStatus('running'), 'running')
  assert.equal(toStatus('done'), 'completed')
  assert.equal(toStatus('error'), 'failed')
  // A skipped agent produced no result. Calling it completed would make a partial run read as whole.
  assert.equal(toStatus('skipped'), 'stopped')
})

test('rows are keyed per CALL, so two concurrent agents sharing a label stay separate', () => {
  const s = sink()
  const r = rows(s)
  // parallel() hands out the same default label to concurrent agents; keying on it would file one
  // agent's completion against the other's row.
  r.started({ id: 'run-1:0', label: 'Find agent', phase: 'Find', prompt: 'a' })
  r.started({ id: 'run-1:1', label: 'Find agent', phase: 'Find', prompt: 'b' })
  r.ended({ id: 'run-1:0', label: 'Find agent', result: 'ok' })

  const all = r.all()
  assert.equal(all.length, 2, 'two calls, two rows')
  assert.deepEqual(all.map(row => row.prompt), ['a', 'b'])
  assert.equal(all[0].status, 'completed')
  assert.equal(all[1].status, 'running', 'the sibling is untouched by the first one finishing')
})

test('a replayed agent is not shown as working — it never ran', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'Find', replayed: true })
  assert.equal(r.all()[0].status, 'running')
  assert.match(r.all()[0].currentAction, /previous run/)
  r.started({ id: 'run-1:1', label: 'Find' })
  assert.equal(r.all()[1].currentAction, 'Working')
})

test('the real model arrives mid-run and updates the row in place, idempotently', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'A', model: 'guessed/main' })
  // onAgentModel fires once per attempt — and per turn for a named thread — so it must be safe to
  // receive repeatedly rather than assumed once-per-agent.
  r.model({ id: 'run-1:0', label: 'A', model: 'anthropic/real' })
  r.model({ id: 'run-1:0', label: 'A', model: 'anthropic/real' })
  assert.equal(r.all().length, 1, 'no duplicate row')
  assert.equal(r.all()[0].model, 'anthropic/real')
  // A model event with nothing in it must not clobber a resolved value.
  r.model({ id: 'run-1:0', label: 'A' })
  assert.equal(r.all()[0].model, 'anthropic/real')
})

test('an error ends the row as failed and keeps the reason', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'A' })
  r.ended({ id: 'run-1:0', label: 'A', error: 'Provider usage limit reached' })
  const row = r.all()[0]
  assert.equal(row.status, 'failed')
  assert.equal(row.error, 'Provider usage limit reached')
  assert.equal(row.currentAction, '', 'a finished agent is not still doing something')
  assert(row.endedAt >= row.startedAt)
})

test('an end for an agent that never started still produces a row rather than vanishing', () => {
  const s = sink()
  const r = rows(s)
  // Journal replay can deliver an end without a live start. Dropping it would lose the agent from
  // the bar entirely — the same "it is on disk but not in the list" failure the library has to avoid.
  r.ended({ id: 'run-1:7', label: 'Restored', result: 'ok' })
  assert.equal(r.all().length, 1)
  assert.equal(r.all()[0].status, 'completed')
})

test('every mutation publishes, so the bar never has to poll', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'A' })
  r.model({ id: 'run-1:0', label: 'A', model: 'x/y' })
  r.ended({ id: 'run-1:0', label: 'A', result: 'ok' })
  assert.deepEqual(s.published.map(row => row.status), ['running', 'running', 'completed'])
})

const { DYNAMIC_RUN_BOUNDS, modelSpec } = await jiti.import('../../src/main/agent/workflowEngine/dynamic/dynamicPolicy.ts')

test('a relay is just a provider — its spec is built like any other', () => {
  // An earlier version special-cased AI-CRMS with a pre-spawn resolver that rewrote or rejected each
  // agent's model. The package already resolves explicit model → tier → medium → mainModel, so with
  // no tiers file everything lands on the model the owner selected, relay or not.
  assert.equal(modelSpec({ providerId: 'ai-crms', modelId: 'gpt-5' }), 'ai-crms/gpt-5')
  assert.equal(modelSpec({ providerId: 'anthropic', modelId: 'opus' }), 'anthropic/opus')
})

test('the run is bounded — the engine defaults would be unbounded on all four axes', () => {
  // Engine defaults: 1000 agents, 16 concurrent, no per-agent timeout, 0 retries. Taking them would
  // be a silent regression from what the retired host enforced.
  assert.equal(DYNAMIC_RUN_BOUNDS.concurrency, 4)
  assert.equal(DYNAMIC_RUN_BOUNDS.maxAgents, 100)
  assert.equal(DYNAMIC_RUN_BOUNDS.agentTimeoutMs, 600_000)
  assert.equal(DYNAMIC_RUN_BOUNDS.agentRetries, 1)
  assert(DYNAMIC_RUN_BOUNDS.agentTimeoutMs > 0, 'null would let an agent hang forever')
})

const { builtinWorkflow } = await jiti.import('../../src/main/agent/workflowEngine/builtins.ts')
const jitiSync = await jiti.import('../../src/main/agent/workflowEngine/dynamic/dynamicLoader.ts')
// Loaded once, as the app does at boot: the parser is an ESM-only module the CJS main bundle can
// only reach through a dynamic import (dynamicLoader.ts).
await jitiSync.loadWorkflowParser()

test('the builtins are the package’s own generators, and each one parses as a workflow', () => {
  const { parseDynamicWorkflow } = jitiSync
  for (const name of ['agent-task', 'code-review', 'research', 'adversarial-review']) {
    const meta = parseDynamicWorkflow(builtinWorkflow(name))
    assert(meta.name, `${name} must produce a script with a usable meta`)
    assert(meta.description, `${name} must describe itself`)
  }
})

test('a retired name points at what covers its job, rather than answering "unknown"', () => {
  // A chat mid-conversation can still say `refactor-scout`. Answering "unknown workflow" would read
  // as the feature breaking rather than as a rename.
  assert.equal(builtinWorkflow('refactor-scout'), builtinWorkflow('code-review'))
  assert.equal(builtinWorkflow('perf-review'), builtinWorkflow('code-review'))
  assert.equal(builtinWorkflow('diagnose'), builtinWorkflow('adversarial-review'))
})

test('a retired name with no counterpart says so instead of running something else', () => {
  assert.throws(() => builtinWorkflow('mini-demo'), /demonstrated the previous engine/)
  assert.throws(() => builtinWorkflow('nope'), /Unknown workflow: nope/)
})

test('the planner survived the engine change — its output is markdown, which belongs to no engine', () => {
  // It was nearly retired as "a proposal, not a run". What it really is: one structured-output agent
  // plus formatting, which this engine expresses directly. Retiring it would have dropped a working
  // capability for a packaging reason.
  const script = builtinWorkflow('plan-workflow')
  assert.match(script, /schema: PLAN_SCHEMA/)
  // The renderer is embedded as its own source, so it must not reach for anything outside itself —
  // a module-scope helper would compile in the host and throw inside the run.
  const render = script.slice(script.indexOf('const render ='), script.indexOf('phase('))
  assert.match(render, /const list = /, 'the list helper has to be inside the function, not beside it')
  const { meta, body } = parseWorkflowScript(script)
  assert.equal(meta.name, 'plan_workflow')
  assert.ok(body.includes('render(plan)'))
})

test('the Work log and Result panes are filled — an empty pane reads as "it produced nothing"', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'A' })
  assert.deepEqual(r.all()[0].logs, [])
  r.history({ id: 'run-1:0', label: 'A', history: [
    { text: 'Looking at the diff', timestamp: 10 },
    { toolName: 'grep', text: 'src/**', timestamp: 20 },
    { text: '   ', timestamp: 30 }
  ] })
  const row = r.all()[0]
  assert.deepEqual(row.logs.map(l => l.text), ['Looking at the diff', 'grep: src/**'], 'blank entries are dropped')
  // The row says what the agent is doing rather than a fixed "Working" for ten minutes.
  assert.equal(row.currentAction, 'grep: src/**')
  r.ended({ id: 'run-1:0', label: 'A', result: { findings: 2 } })
  assert.equal(r.all()[0].output, JSON.stringify({ findings: 2 }, null, 2))
  assert.equal(r.all()[0].currentAction, '')
})

test('history replaces rather than appends — it is the transcript so far, sent repeatedly', () => {
  const s = sink()
  const r = rows(s)
  r.started({ id: 'run-1:0', label: 'A' })
  r.history({ id: 'run-1:0', label: 'A', history: [{ text: 'one' }] })
  r.history({ id: 'run-1:0', label: 'A', history: [{ text: 'one' }, { text: 'two' }] })
  assert.deepEqual(r.all()[0].logs.map(l => l.text), ['one', 'two'], 'not one, one, two')
})

test('a string result is shown as-is rather than JSON-quoted', () => {
  const s = sink()
  const r = rows(s)
  r.ended({ id: 'run-1:0', label: 'A', result: 'plain text' })
  assert.equal(r.all()[0].output, 'plain text')
})

test('生成的 builtin 必须吃得下字符串入参 —— 否则 7 个 finder 在审一段空 diff', () => {
  // Ral 2026-09-21:「code review 下:<路径>」没能触发 workflow。原因之一是就算触发了也白跑 ——
  // 包的生成器按 Pi 的对象入参写:`const rawDiff = (args && args.diff) || ''`,
  // 而本宿主的 `workflow_run` 把 owner 那句话当**字符串**传,`args.diff` 恒为 undefined。
  // 它不报错,只是什么都找不到 —— 和「代码很干净」长得一模一样。
  const script = builtinWorkflow('code-review')
  assert.match(script, /typeof args === 'string' \? args :/, '字符串入参必须被接住')
  assert.doesNotMatch(script, /const rawDiff = \(args && args\.diff\) \|\| ''/, '原样的对象入参行不能留下')
  // 同时保证这是改写而不是硬编码:生成器换了写法要当场炸,而不是继续发一个坏契约。
  assert.throws(() => builtinWorkflow('code-review-nonexistent'), /Unknown workflow/)
})

test('worktree 隔离失败时,错误里要有 owner 能照着做的下一步', () => {
  // 包抛得很准:`worktree isolation failed for "X": not a git repository`。准确,但对**用** workflow
  // 的人没用 —— 他没写那个包,不知道「隔离」是什么。实测默认工作区不是 git 仓库,所以任何声明了
  // isolation 的包在那里必然撞上这句(F3)。
  const worker = readFileSync(new URL('../../src/main/agent/workflowEngine/engine.worker.ts', import.meta.url), 'utf8')
  assert.match(worker, /worktree isolation failed/, '要认出这条错误')
  assert.match(worker, /把工作区切到一个 git 仓库/, '要给出下一步')
  assert.match(worker, /message: explain\(wire\.message\)/, '翻译要真的接在错误投递上')
  // 原文不能丢 —— 那是给写包的人排查用的。
  assert.match(worker, /return message \+ /, '补一句,不是替换')
})
