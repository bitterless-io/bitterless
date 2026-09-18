import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

// docs/issues/workflow-snapshot-republishes-all-history.md
// publish() clones + stringifies + persists + broadcasts EVERY run, and its ~20 call sites include
// every agent action and every log line. Two things were unbounded: `runs` (push-only, and restored
// wholesale across restarts) and the `this.writes` promise chain (one link per publish, each closing
// over a full snapshot string). Measured 95,550 bytes at just 4 runs.

const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  alias: { electron: fileURLToPath(new URL('./electronStub.cjs', import.meta.url)) }
})
const { WorkflowSupervisor } = await jiti.import(join(root, 'src/main/agent/workflowEngine/supervisor.ts'))

class Child extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.commands = [] }
  postMessage(message) { this.commands.push(message) }
  exit() { this.emit('exit', 0) }
}

const makeSupervisor = async (storageDir, broadcast = () => {}) => new WorkflowSupervisor(
  { storageDir, workflowWorkerPath: 'engine', agentWorkerPath: 'agent', broadcast, executeTool: async () => '' },
  { fork() { return new Child(9000) }, signal() {}, terminationGraceMs: 10, terminationTimeoutMs: 100 }
)

// A finished run as it appears on disk, so `restore()` is the thing under test rather than a live run.
const finishedRun = (index) => ({
  id: `run-${index}`, sessionId: 'chat', name: 'demo', entry: { kind: 'builtin', name: 'mini-demo' },
  input: 'probe', status: 'completed', createdAt: index, endedAt: index + 1, agents: []
})

test('restored history is trimmed to the finished-run cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-bounds-'))
  try {
    const runs = Array.from({ length: 60 }, (_, index) => finishedRun(index))
    await writeFile(join(directory, 'runs.json'), JSON.stringify({ runs, revision: 1 }), 'utf8')

    const supervisor = await makeSupervisor(directory)
    const snapshot = await supervisor.list()
    assert.equal(snapshot.runs.length, 20, 'a 60-run history must be trimmed to MAX_FINISHED_RUNS')
    // Oldest evicted, newest kept — the history modal shows recent work, not the first run ever.
    assert.equal(snapshot.runs[0].id, 'run-40')
    assert.equal(snapshot.runs.at(-1).id, 'run-59')

    const persisted = JSON.parse(await readFile(join(directory, 'runs.json'), 'utf8'))
    assert.equal(persisted.runs.length, 20, 'the trim must reach disk, or the next boot re-reads 60')
    await supervisor.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a run that is still going is never evicted, however much finished history there is', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-bounds-live-'))
  const runs = Array.from({ length: 40 }, (_, index) => finishedRun(index))
  await writeFile(join(directory, 'runs.json'), JSON.stringify({ runs, revision: 1 }), 'utf8')
  const supervisor = await makeSupervisor(directory)
  try {
    // A GENUINELY running run of this session. `restore()` cannot express one: it marks every
    // non-terminal restored run failed BEFORE publish() ever trims, so a restored "live" run is
    // legitimately terminal by the time the cap applies.
    const live = await supervisor.start(
      { sessionId: 'chat', input: 'probe', entry: { kind: 'builtin', name: 'mini-demo' } },
      { tools: [] }
    )
    const snapshot = await supervisor.list()
    const found = snapshot.runs.find(run => run.id === live.id)
    assert.ok(found, 'the in-flight run must survive trimming')
    assert.equal(found.status, 'running')
    assert.equal(
      snapshot.runs.filter(run => run.status === 'completed').length,
      20,
      'finished history stays capped while the live run rides along'
    )
  } finally {
    await supervisor.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('rapid publishes collapse to one in-flight write and the last snapshot wins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-bounds-writes-'))
  const supervisor = await makeSupervisor(directory)
  try {
    // start() publishes and flushes; drive many more publishes back to back without awaiting.
    const started = []
    for (let index = 0; index < 25; index++) {
      started.push(supervisor.start(
        { sessionId: 'chat', input: `probe-${index}`, entry: { kind: 'builtin', name: 'mini-demo' } },
        { tools: [] }
      ))
    }
    await Promise.all(started)

    const snapshot = await supervisor.list()
    assert.ok(snapshot.runs.length <= 20 + started.length, 'runs must stay bounded under burst')

    const persisted = JSON.parse(await readFile(join(directory, 'runs.json'), 'utf8'))
    assert.equal(
      persisted.revision,
      snapshot.revision,
      'after flush the file must equal the latest snapshot, not some superseded intermediate'
    )
  } finally {
    await supervisor.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  }
})
