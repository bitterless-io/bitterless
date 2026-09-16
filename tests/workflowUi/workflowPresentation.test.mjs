import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
const root = new URL('../../', import.meta.url)
const renderer = existsSync(new URL('src/renderer/maestro/control', root)) ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared/agentWorkflow.api': fileURLToPath(new URL('src/shared/agentWorkflow.api.ts', root)) } })
const { groupWorkflowTasks, newestWorkflowRuns, workflowRunCategory } = await jiti.import(fileURLToPath(new URL(`${renderer}workflow.presentation.ts`, root)))
const run = (id, status, createdAt, states) => ({ id, sessionId: 'chat', name: 'mini-demo', status, createdAt, agents: states.map((status, index) => ({ id: String(index + 1), runId: id, sessionId: 'chat', status })) })

test('a rerun shows active and successful work first while retaining failed/stopped history and reused Agent IDs', () => {
  const old = run('old', 'completed', 1, ['completed', 'failed', 'stopped'])
  const stopped = run('stopped', 'stopped', 2, ['stopped'])
  const current = run('new', 'running', 3, ['running', 'completed'])
  const input = [old, stopped, current]
  const before = JSON.stringify(input)
  const groups = groupWorkflowTasks(input)
  assert.deepEqual(groups.map(group => group.category), ['active', 'completed', 'failed', 'stopped'])
  assert.deepEqual(groups[0].tasks.map(task => [task.runId, task.id]), [['new', '1']])
  assert.deepEqual(groups[1].tasks.map(task => [task.runId, task.id]), [['new', '2'], ['old', '1']])
  assert.deepEqual(groups[2].runs.map(run => run.id), ['old'])
  assert.deepEqual(groups[3].tasks.map(task => task.runId), ['stopped', 'old'])
  assert.equal(newestWorkflowRuns(input)[0].id, 'new')
  assert.equal(JSON.stringify(input), before, 'presentation does not rewrite original run/Agent evidence')
})

test('after rerun succeeds the newest result is successful even while older failed runs remain', () => {
  const old = run('old', 'failed', 1, ['failed'])
  const current = run('new', 'completed', 2, ['completed'])
  assert.equal(workflowRunCategory(newestWorkflowRuns([old, current])[0]), 'completed')
  assert.deepEqual(groupWorkflowTasks([old, current]).map(group => group.category), ['completed', 'failed'])
  assert.equal(workflowRunCategory(run('partial', 'completed', 3, ['failed', 'completed'])), 'failed')
  assert.equal(workflowRunCategory(run('cleanup', 'stopping', 4, ['failed'])), 'active', 'failed rows do not disguise pending cleanup')
})

test('all busy states remain active and a new run before its first Agent is still discoverable', () => {
  const current = run('new', 'running', 2, ['queued', 'running', 'waiting', 'approval', 'retrying', 'stopping'])
  assert.equal(groupWorkflowTasks([current])[0].tasks.length, 6)
  const empty = run('starting', 'running', 3, [])
  const groups = groupWorkflowTasks([run('old', 'failed', 1, ['failed']), empty])
  assert.equal(groups[0].category, 'active'); assert.equal(groups[0].runs[0].id, 'starting')
  assert.equal(newestWorkflowRuns([current, empty])[0].id, 'starting')
  assert.equal(newestWorkflowRuns([current, { ...empty, createdAt: current.createdAt }])[0].id, 'starting')
})
