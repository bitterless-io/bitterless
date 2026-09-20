import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
const root = new URL('../../', import.meta.url)
const renderer = existsSync(new URL('src/renderer/maestro/control', root)) ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared/agentWorkflow.api': fileURLToPath(new URL('src/shared/agentWorkflow.api.ts', root)) } })
const { groupWorkflowRuns, newestWorkflowRuns, workflowRunCategory } = await jiti.import(fileURLToPath(new URL(`${renderer}workflow.presentation.ts`, root)))
const run = (id, status, createdAt, states) => ({ id, sessionId: 'chat', name: 'mini-demo', status, createdAt, agents: states.map((status, index) => ({ id: String(index + 1), runId: id, sessionId: 'chat', status })) })

test('a rerun keeps failed and stopped history without burying the current run, and rewrites no evidence', () => {
  // The roster groups by workflow now; this is the same protection the status-category grouping had.
  const old = run('old', 'completed', 1, ['completed', 'failed', 'stopped'])
  const stopped = run('stopped', 'stopped', 2, ['stopped'])
  const current = run('new', 'running', 3, ['running', 'completed'])
  const input = [old, stopped, current]
  const before = JSON.stringify(input)
  const groups = groupWorkflowRuns(input)
  assert.deepEqual(groups.map(group => group.run.id), ['new', 'stopped', 'old'], 'the current run heads the roster')
  assert.deepEqual(groups.map(group => group.category), ['active', 'stopped', 'failed'])
  // Only the live run stays expanded, so old history cannot push the current run off screen.
  assert.deepEqual(groups.map(group => group.ended), [false, true, true])
  assert.deepEqual(groups[0].agents.map(task => [task.runId, task.id]), [['new', '1'], ['new', '2']])
  assert.deepEqual(groups[2].agents.map(task => task.id), ['1', '2', '3'], 'every historical Agent is retained')
  assert.equal(newestWorkflowRuns(input)[0].id, 'new')
  assert.equal(JSON.stringify(input), before, 'presentation does not rewrite original run/Agent evidence')
})

test('after rerun succeeds the newest result is successful even while older failed runs remain', () => {
  const old = run('old', 'failed', 1, ['failed'])
  const current = run('new', 'completed', 2, ['completed'])
  assert.equal(workflowRunCategory(newestWorkflowRuns([old, current])[0]), 'completed')
  assert.deepEqual(groupWorkflowRuns([old, current]).map(group => group.category), ['completed', 'failed'])
  assert.equal(workflowRunCategory(run('partial', 'completed', 3, ['failed', 'completed'])), 'failed')
  assert.equal(workflowRunCategory(run('cleanup', 'stopping', 4, ['failed'])), 'active', 'failed rows do not disguise pending cleanup')
})

test('all busy states remain active and a new run before its first Agent is still discoverable', () => {
  const current = run('new', 'running', 2, ['queued', 'running', 'waiting', 'approval', 'retrying', 'stopping'])
  assert.equal(groupWorkflowRuns([current])[0].agents.length, 6)
  assert.equal(groupWorkflowRuns([current])[0].activeCount, 6)
  const empty = run('starting', 'running', 3, [])
  const groups = groupWorkflowRuns([run('old', 'failed', 1, ['failed']), empty])
  assert.equal(groups[0].category, 'active')
  assert.equal(groups[0].run.id, 'starting', 'a run with no Agent yet still gets its own group')
  assert.equal(newestWorkflowRuns([current, empty])[0].id, 'starting')
  assert.equal(newestWorkflowRuns([current, { ...empty, createdAt: current.createdAt }])[0].id, 'starting')
})

test('paused work stays visible in its workflow but is not counted as active', async () => {
  const { isWorkflowAgentActive, isWorkflowAgentLive } = await jiti.import(fileURLToPath(new URL('src/shared/agentWorkflow.api.ts', root)))
  const current = run('parallel', 'running', 1, ['running', 'pausing', 'paused', 'completed', 'failed', 'stopped'])
  assert.equal(isWorkflowAgentLive('paused'), true)
  assert.equal(isWorkflowAgentActive('paused'), false)
  const [group] = groupWorkflowRuns([current])
  assert.equal(group.activeCount, 2, 'paused and pausing Agents do not inflate the bar')
  assert.equal(group.agents.length, 6, 'but every Agent is still listed under its workflow')
  assert.equal(group.agents.filter(task => task.status === 'paused').length, 1)
})

test('a workflow group surfaces what needs the user without expanding it', () => {
  const blocked = run('blocked', 'running', 2, ['approval', 'running', 'completed'])
  const [group] = groupWorkflowRuns([blocked])
  assert.equal(group.awaitingUser, 1)
  assert.equal(group.agents[0].status, 'approval', 'whatever asks for the user sorts to the top of its workflow')
  const broken = run('broken', 'completed', 1, ['failed', 'completed', 'failed'])
  assert.equal(groupWorkflowRuns([broken])[0].failedCount, 2)
  assert.deepEqual(groupWorkflowRuns([broken])[0].agents.map(task => task.status), ['completed', 'failed', 'failed'])
})

test('Agents sort by what needs attention, and equal ranks keep snapshot order', () => {
  const mixed = run('mixed', 'running', 1, ['stopped', 'failed', 'completed', 'paused', 'queued', 'running', 'approval'])
  assert.deepEqual(
    groupWorkflowRuns([mixed])[0].agents.map(task => task.status),
    ['approval', 'running', 'queued', 'paused', 'completed', 'failed', 'stopped']
  )
  const ties = run('ties', 'running', 1, ['running', 'waiting', 'retrying', 'stopping'])
  assert.deepEqual(
    groupWorkflowRuns([ties])[0].agents.map(task => task.id),
    ['1', '2', '3', '4'],
    'same-rank Agents keep the order main sent, so rows do not shuffle between broadcasts'
  )
})

test('a paused run is neither finished nor hidden — it is the one run the owner still has to act on', () => {
  // Before run-level pause existed, `workflowRunCategory` had no branch for it, so a paused run fell
  // through to `completed`. Everything downstream then treated it as done: the header offered Rerun
  // instead of Resume, the group collapsed, and in the live bar it was filtered out entirely — while
  // `workflowActivityFacts` still counted it, so the pill read "1 workflows · 0 agents" next to a
  // list showing nothing running. A run the owner deliberately paused cannot be one they can no
  // longer see or resume.
  const paused = run('paused', 'paused', 4, ['completed', 'paused'])
  assert.equal(workflowRunCategory(paused), 'paused')
  const [group] = groupWorkflowRuns([paused])
  assert.equal(group.category, 'paused')
  assert.equal(group.ended, false, 'a paused run stays open, so its Resume control stays reachable')
  // And it must not be mistaken for any terminal category.
  for (const status of ['completed', 'failed', 'stopped']) {
    assert.notEqual(workflowRunCategory(run('x', status, 5, ['completed'])), 'paused')
  }
})
