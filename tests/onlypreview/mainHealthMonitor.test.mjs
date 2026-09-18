import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const APP_ROOT = new URL('../..', import.meta.url).pathname

// Real source, no bundler: `describeHealth` is pure, so the declarations it needs are lifted out of
// the actual file by AST and evaluated. Nothing about electron/os/perf_hooks is involved.
const file = 'src/main/logging/mainHealth.service.ts'
const source = readFileSync(join(APP_ROOT, file), 'utf8')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
const declaration = (name) => {
  let found
  const visit = (node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(ast) === name) found = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `${name} not found in ${file}`)
  return found.replace(/^export /, '')
}
const compile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const { describeHealth } = runInNewContext(
  `${compile(['LAG_WARN_MS', 'FREE_MEMORY_WARN', 'describeHealth'].map(declaration).join('\n'))}; ({ describeHealth })`,
  { Math }
)

const sample = (overrides = {}) => ({
  sinceLastTickMs: 10_000, overdueMs: 0, loopP50Ms: 1, loopP99Ms: 4, loopMaxMs: 9,
  rssMb: 400, heapUsedMb: 120, freeMemoryMb: 8_000, freeMemoryRatio: 0.25, processes: 'Browser=400MB/3%',
  ...overrides
})

test('a healthy tick stays at info and still carries every number', () => {
  const { level, msg } = describeHealth(sample())
  assert.equal(level, 'info')
  for (const fragment of ['p50=1ms', 'p99=4ms', 'max=9ms', 'tick=10000ms', 'rss=400MB', 'freeMem=8000MB(25%)', 'Browser=400MB/3%']) {
    assert.ok(msg.includes(fragment), `${fragment} missing from ${msg}`)
  }
})

test('an overdue tick names a blocked main loop, which is the whole point of the heartbeat', () => {
  const { level, msg } = describeHealth(sample({ sinceLastTickMs: 47_000, overdueMs: 27_000, loopMaxMs: 26_500 }))
  assert.equal(level, 'warn')
  assert.match(msg, /overdue by 27000ms/)
  assert.match(msg, /main event loop was blocked/)
  // The measured interval must survive into the line: it is the evidence a bare gap cannot give.
  assert.match(msg, /tick=47000ms/)
})

test('lag alone escalates even when the tick arrived on time — a slow loop is not yet a stalled one', () => {
  const { level, msg } = describeHealth(sample({ loopMaxMs: 1_500 }))
  assert.equal(level, 'warn')
  assert.match(msg, /event loop lag reached 1500ms/)
  assert.doesNotMatch(msg, /overdue/)
})

test('memory exhaustion escalates on its own, so a thrashing machine is distinguishable from a blocked loop', () => {
  const { level, msg } = describeHealth(sample({ freeMemoryMb: 300, freeMemoryRatio: 0.01 }))
  assert.equal(level, 'warn')
  assert.match(msg, /only 1% system memory free/)
  assert.doesNotMatch(msg, /event loop lag reached/)
})

test('concurrent causes are all reported — the first explanation is not assumed to be the only one', () => {
  const { msg } = describeHealth(sample({ overdueMs: 5_000, loopMaxMs: 9_000, freeMemoryRatio: 0.02 }))
  assert.match(msg, /overdue by 5000ms/)
  assert.match(msg, /event loop lag reached 9000ms/)
  assert.match(msg, /system memory free/)
})

test('the monitor never holds the process open and never throws on missing metrics', () => {
  assert.match(source, /timer\.unref\(\)/)
  // getAppMetrics is unavailable before ready and can throw; a diagnostic must not become the fault.
  assert.match(source, /catch \{[\s\S]*?procs=unavailable/)
  assert.match(source, /monitorEventLoopDelay/)
})
