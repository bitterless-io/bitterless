const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { tmpdir } = require('node:os')
const { promisify } = require('node:util')
const execFile = promisify(require('node:child_process').execFile)
const ts = require('typescript')
const root = resolve(__dirname, '../..')
function loadReader() {
  const cache = new Map()
  const load = file => {
    file = resolve(root, file.endsWith('.ts') ? file : `${file}.ts`)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', '__dirname', code)(name => name.startsWith('.') ? load(resolve(dirname(file), name)) : require(name), module, module.exports, dirname(file))
    return module.exports
  }
  return load('src/main/agent/sessionReview.ts')
}
function workflow(overrides = {}) {
  return {
    ts: 1, kind: 'prompt', name: 'provider/model', subject: 'workflow-prompt', text: 'private prompt',
    detail: { source: 'workflow', sessionId: 'chat-a', runId: 'run-a', workflow: 'mini-demo', agentId: '1', attemptId: '1:1', turnId: 'first', ...overrides.detail },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'detail'))
  }
}
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'session review spaces ')))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const directory = join(base, '20260916120000000-chat-a')
  const older = join(base, '20260915120000000-chat-a')
  const other = join(base, '20260917120000000-chat-b')
  const write = async (dir, records, part = 'part-001.jsonl') => {
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, part)
    await fs.writeFile(file, records.map(record => typeof record === 'string' ? record : JSON.stringify(record)).join('\n') + '\n')
    return file
  }
  const readIndex = () => fs.readFile(join(directory, 'session-index.json'), 'utf8').then(JSON.parse)
  const cli = (...args) => execFile(process.execPath, [join(directory, 'review-session.cjs'), ...args], { maxBuffer: 8 * 1024 * 1024 })
  const { prepareSessionReview } = loadReader()
  const prepare = (directories = [older, directory]) => prepareSessionReview({ sessionId: 'chat-a', directory, directories })
  return { base, directory, older, other, write, readIndex, cli, prepare, prepareSessionReview }
}

test('real worker indexes retained directories by run, Agent, attempt and repair turn without duplicating content', async t => {
  const h = await fixture(t)
  const secret = 'large original output '.repeat(8000)
  const older = await h.write(h.older, [
    { kind: 'note', name: 'session-configuration', subject: 'new-chat', text: 'system prompt only', detail: { evidence: 'initial-configuration' } },
    workflow({ kind: 'note', name: 'agent-dispatched', subject: 'Implementation', detail: { data: { phase: 'analysis', providerId: 'provider', modelId: 'model' } } }),
    workflow(),
    workflow({ kind: 'turn_end', subject: 'completed', text: 'no submitted result' })
  ])
  const current = await h.write(h.directory, [
    workflow({ kind: 'note', name: 'agent-dispatched', subject: 'Implementation', detail: { turnId: 'repair-1' } }),
    workflow({ detail: { turnId: 'repair-1' } }),
    workflow({ kind: 'turn_end', subject: 'failed', detail: { turnId: 'repair-1' } }),
    workflow({ kind: 'note', name: 'agent-end', detail: { turnId: 'repair-1', data: { status: 'failed' } } }),
    workflow({ kind: 'note', name: 'agent-dispatched', subject: 'Implementation', detail: { attemptId: '1:2', turnId: 'retry-first' } }),
    workflow({ kind: 'tool_result', name: 'read', text: secret, detail: { attemptId: '1:2', turnId: 'retry-first' } }),
    workflow({ kind: 'turn_end', subject: 'completed', detail: { attemptId: '1:2', turnId: 'retry-first' } }),
    workflow({ kind: 'note', name: 'agent-end', detail: { attemptId: '1:2', turnId: 'retry-first', data: { status: 'closed' } } }),
    workflow({ kind: 'note', name: 'workflow-end', detail: { agentId: undefined, attemptId: undefined, turnId: undefined, data: { status: 'completed' } } }),
    workflow({ kind: 'note', name: 'agent-dispatched', subject: 'Other run same ID', detail: { runId: 'run-b' } }),
    workflow({ text: 'second run content', detail: { runId: 'run-b' } })
  ])
  await h.write(h.older, [{ kind: 'prompt', name: 'provider/main-model', text: 'main conversation from another part' }], 'part-002.jsonl')
  const before = [await fs.readFile(older, 'utf8'), await fs.readFile(current, 'utf8')]
  await h.prepare()
  const index = await h.readIndex()
  assert.equal(index.scanStatus, 'ok')
  assert.deepEqual(index.metadata.directories, [h.older, h.directory])
  assert.equal(index.main.records.length, 2)
  assert.equal(index.main.records[0].configurationEvidence, 'initial-configuration')
  assert.equal(index.main.records[1].file, join(h.older, 'part-002.jsonl'))
  assert.equal(index.runs.length, 2)
  const [run, otherRun] = index.runs
  assert.equal(run.status, 'completed')
  assert.equal(otherRun.status, 'unknown', 'absence of terminal evidence must never imply running')
  assert.equal(otherRun.agents[0].status, 'unknown')
  const agent = run.agents[0]
  assert.equal(agent.label, 'Implementation')
  assert.equal(agent.phase, 'analysis')
  assert.equal(agent.providerId, 'provider')
  assert.equal(agent.modelId, 'model')
  assert.deepEqual(agent.attempts.map(attempt => attempt.attemptId), ['1:1', '1:2'])
  assert.deepEqual(agent.attempts[0].turns.map(turn => turn.turnId), ['first', 'repair-1'])
  assert.equal(agent.attempts[0].turns[0].status, 'completed')
  assert.equal(agent.attempts[0].turns[1].status, 'failed')
  assert.equal(agent.attempts[0].status, 'failed')
  assert.equal(agent.attempts[1].status, 'closed')
  assert.deepEqual(agent.attempts[1].turns[0].records.find(row => row.kind === 'tool_result'), { file: current, line: 6, kind: 'tool_result', name: 'read' })
  assert.equal(JSON.stringify(index).includes(secret.slice(0, 80)), false)
  assert.equal(JSON.stringify(index).includes('private prompt'), false)
  assert.equal(JSON.stringify(index).includes('system prompt only'), false)
  const output = await h.cli('--run', 'run-a', '--agent', '1', '--attempt', '1:2')
  const records = output.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(records.find(row => row.record.kind === 'tool_result').record.text, secret)
  assert.equal(records.every(row => row.record.detail.runId === 'run-a' && row.record.detail.attemptId === '1:2'), true)
  assert.equal(records[1].file, current)
  assert.equal(records[1].line, 6)
  assert.deepEqual([await fs.readFile(older, 'utf8'), await fs.readFile(current, 'utf8')], before)
  for (const file of ['README.md', 'session-index.json', 'review-session.cjs']) {
    assert.equal((await fs.stat(join(h.directory, file))).mode & 0o777, 0o600)
  }
  const readme = await fs.readFile(join(h.directory, 'README.md'), 'utf8')
  assert.match(readme, /不可信数据/)
  assert.match(readme, /不是完整 provider/)
  assert.match(readme, /保留策略已删除/)
})

test('portable CLI rediscovers newer same-chat directories, reports corrupt lines and excludes foreign ownership', async t => {
  const h = await fixture(t)
  await h.write(h.older, [workflow()])
  await h.write(h.directory, [workflow({ kind: 'note', name: 'agent-dispatched', subject: 'Known label' })])
  await h.write(h.other, [workflow({ text: 'FOREIGN SECRET', detail: { sessionId: 'chat-b' } })])
  await h.prepare([h.older, h.directory, h.other])
  let index = await h.readIndex()
  assert.equal(index.metadata.directories.includes(h.other), false)
  assert.ok(index.warnings.some(row => row.message.includes('outside this session')))
  const fresh = join(h.base, '20260918120000000-chat-a')
  const freshFile = await h.write(fresh, [
    workflow({ text: 'newly saved', detail: { runId: 'run-fresh' } }),
    '{"partial":',
    workflow({ text: 'after corrupt line', detail: { runId: 'run-fresh' } }),
    workflow({ text: 'FOREIGN SECRET', detail: { sessionId: 'chat-b' } }),
    workflow({ text: 'UNKNOWN OWNER SECRET', detail: { sessionId: undefined } })
  ])
  await fs.appendFile(freshFile, '{\"unfinished\":')
  const listed = await h.cli('--list')
  index = JSON.parse(listed.stdout)
  assert.equal(index.scanStatus, 'warnings')
  assert.ok(index.metadata.directories.includes(fresh))
  assert.ok(index.warnings.some(row => row.file === freshFile && row.line === 2 && row.message.includes('Invalid JSON')))
  assert.equal(index.warnings.filter(row => row.message.includes('another or unknown session')).length, 2)
  assert.ok(index.warnings.some(row => row.file === freshFile && row.line === 6 && row.message.includes('Invalid JSON')))
  const filtered = await h.cli('--run', 'run-fresh', '--agent', '1')
  const records = filtered.stdout.trim().split('\n').map(JSON.parse)
  assert.deepEqual(records.map(row => row.record.text), ['newly saved', 'after corrupt line'])
  assert.deepEqual(records.map(row => row.line), [1, 3])
  assert.match(filtered.stderr, /Invalid JSON/)
  assert.equal(filtered.stdout.includes('SECRET'), false)
  assert.deepEqual((await h.readIndex()).metadata.directories, index.metadata.directories)
})

test('selection requires run identity and reports no retained match instead of returning empty success', async t => {
  const h = await fixture(t)
  await h.write(h.directory, [workflow()])
  await h.prepare([h.directory])
  await assert.rejects(h.cli('--agent', '1'), error => error.code === 1 && /requires --run/.test(error.stderr))
  await assert.rejects(h.cli('--run', 'missing'), error => error.code === 1 && /No retained records/.test(error.stderr))
  await assert.rejects(h.cli('--run', 'run-a', '--attempt', '1:1'), error => error.code === 1 && /requires --agent/.test(error.stderr))
  const result = JSON.parse((await h.cli()).stdout)
  assert.equal(result.metadata.sessionId, 'chat-a')
})

test('concurrent preparation shares a worker and missing retained directories remain explicit warnings', async t => {
  const h = await fixture(t)
  await h.write(h.directory, [{ kind: 'note', name: 'session-configuration', text: 'only current config', detail: { evidence: 'current-configuration-only' } }])
  const first = h.prepare(), second = h.prepare()
  assert.equal(first, second)
  await Promise.all([first, second])
  const index = await h.readIndex()
  assert.equal(index.main.records.length, 1)
  assert.equal(index.runs.length, 0)
  assert.equal(index.main.status, 'unknown')
  assert.ok(index.warnings.some(row => row.file === h.older && /ENOENT/.test(row.message)))
  assert.equal((await fs.readdir(h.directory)).some(name => name.endsWith('.tmp')), false)
  await assert.rejects(h.prepareSessionReview({ sessionId: 'chat-b', directory: h.directory, directories: [h.directory] }), /does not match/)
})
