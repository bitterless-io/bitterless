import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const root = new URL('../../', import.meta.url)
const bl = existsSync(new URL('src/renderer/maestro/control', root))
const renderer = bl ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@shared/agentWorkflow.api': fileURLToPath(new URL('src/shared/agentWorkflow.api.ts', root)) } })
const { workflowCompletionChatText } = await jiti.import(fileURLToPath(new URL(`${renderer}workflow.presentation.ts`, root)))
const { workflowEn, workflowZh } = await jiti.import(fileURLToPath(new URL(`${renderer}workflow.messages.ts`, root)))
const { workflowActivityFacts } = await jiti.import(fileURLToPath(new URL('src/shared/agentWorkflow.api.ts', root)))
const source = readFileSync(new URL(`${renderer}ResponseStatus.vue`, root), 'utf8')
const store = readFileSync(new URL(`${renderer}store/workflow.store.ts`, root), 'utf8')

const agentTask = (id, status, label) => ({ id, runId: 'run-1', sessionId: 'chat', label, prompt: 'p', status, currentAction: '', queuedAt: 1, logs: [] })
const run = (status, agents, extra = {}) => ({ id: 'run-1', sessionId: 'chat', name: 'mini-demo', input: 'goal', status, createdAt: 1, agents, ...extra })

test('the status row survives a settled turn and keeps a localized line without a model sentence', () => {
  // The bug this covers: a finished turn with Agents still running left the whole bar hidden.
  assert.match(source, /v-if="status \|\| canRetry \|\| steeringLabel \|\| backgroundAgents"/)
  assert.match(source, /workflowActivityFacts\(workflowStore\.runs, props\.session\.id\)/)
  assert.match(source, /if \(!facts\.agents\) return null/)
  // No live Agent means no row at all, so an idle chat still reserves no height.
  assert.match(source, /activityWorking/)
  assert.match(source, /activityApproval/)
  // The sentence is optional; the counted line is the fallback, never a fabricated status.
  assert.match(source, /activityFor\(props\.session\.id\)\?\.text\?\.trim\(\) \|\| ''/)
  assert.match(source, /text: sentence \|\| counts/)
  assert.match(source, /Boolean\(status\.value\) \|\| Boolean\(backgroundAgents\.value\)/, 'the clock must tick for a background-only row')
})

test('the wait is a status-bar state driven by the host registry, not prose the model must remember', () => {
  const store = readFileSync(new URL(`${renderer}store/workflow.store.ts`, root), 'utf8')
  assert.match(store, /waiting: WorkflowWaitState\[\] = \[\]/)
  assert.match(store, /this\.waiting = Array\.isArray\(snapshot\.waiting\) \? snapshot\.waiting : \[\]/)
  assert.match(store, /waitFor\(sessionId: string\)/)

  const status = readFileSync(new URL(`${renderer}ResponseStatus.vue`, root), 'utf8')
  assert.match(status, /const pendingWait = computed\(\(\) => workflowStore\.waitFor\(props\.session\.id\)\)/)
  // The declared wait outranks the plain Agent count: it is the more specific fact.
  assert.match(status, /if \(wait\) \{[\s\S]*?activityWaiting/)
  assert.match(status, /if \(wait\)[\s\S]{0,400}?if \(!facts\.agents\) return null/, 'the wait branch must come first')

  for (const messages of [workflowEn, workflowZh]) {
    assert.equal(typeof messages.activityWaiting, 'string')
    assert.match(messages.activityWaiting, /\{count\}/)
  }
})

test('the store keeps only the newest activity list and resolves it per chat', () => {
  assert.match(store, /activity: WorkflowActivitySummary\[\] = \[\]/)
  assert.match(store, /this\.activity = Array\.isArray\(snapshot\.activity\) \? snapshot\.activity : \[\]/)
  assert.match(store, /activityFor\(sessionId: string\)/)
  // Stale revisions are already rejected before activity is applied.
  assert.match(store, /snapshot\.revision < this\.revision\) return/)
})

test('every localized bundle can render the status line and the completion message', () => {
  for (const messages of [workflowEn, workflowZh]) {
    for (const key of ['activityWorking', 'activityApproval', 'finishedTitle', 'finishedFailedTitle', 'finishedPartialTitle', 'finishedStoppedTitle', 'finishedNoResult', 'finishedAgents']) {
      assert.equal(typeof messages[key], 'string', key + ' is missing')
      assert.notEqual(messages[key].trim(), '')
    }
    assert.match(messages.activityWorking, /\{count\}/)
    assert.match(messages.finishedTitle, /\{name\}/)
    assert.match(messages.finishedPartialTitle, /\{count\}/)
  }
})

test('facts drive the counted line: approval outranks plain work and paused Agents are excluded', () => {
  const working = workflowActivityFacts([run('running', [agentTask('1', 'running', 'A'), agentTask('2', 'paused', 'B')])], 'chat')
  assert.equal(working.agents, 1)
  assert.equal(working.awaitingUser, 0)
  const approving = workflowActivityFacts([run('running', [agentTask('1', 'approval', 'A'), agentTask('2', 'running', 'B')])], 'chat')
  assert.equal(approving.agents, 2)
  assert.equal(approving.awaitingUser, 1)
})

test('a settled run reaches the chat as a localized outcome, never a silent history-only entry', () => {
  const completed = workflowCompletionChatText(run('completed', [agentTask('1', 'completed', '实现建议')], { result: 'Three options compared.' }), workflowZh)
  assert.match(completed, /\*\*Workflow mini-demo 已完成\*\*/)
  assert.match(completed, /Three options compared\./)
  assert.match(completed, /- 实现建议: 已完成/)

  const partial = workflowCompletionChatText(run('completed', [agentTask('1', 'failed', 'A'), agentTask('2', 'completed', 'B')], { result: 'Partial result.' }), workflowEn)
  assert.match(partial, /finished with 1 failed Agents/, 'a partial outcome must not read as a clean success')

  const failed = workflowCompletionChatText(run('failed', [agentTask('1', 'failed', 'A')], { error: 'worker exited' }), workflowEn)
  assert.match(failed, /Workflow mini-demo failed/)
  assert.match(failed, /worker exited/)

  const stopped = workflowCompletionChatText(run('stopped', [agentTask('1', 'stopped', 'A')]), workflowEn)
  assert.match(stopped, /was stopped/)
  assert.match(stopped, /No result was produced\./, 'an empty outcome must say so rather than render blank')
})

test('the completion projection is durable, deduplicated and excluded from the prompt', () => {
  const messageStore = readFileSync(new URL(`${renderer}store/message.store.ts`, root), 'utf8')
  assert.match(messageStore, /workflowCompletionChatText\(run, workflowText\(\)\)/)
  assert.match(messageStore, /session\.messages\.some\(message => message\.id === id\)/)
  assert.match(messageStore, /promptExcluded: true/)
})
