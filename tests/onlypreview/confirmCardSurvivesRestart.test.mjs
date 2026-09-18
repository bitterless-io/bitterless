import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { transformSync } from 'esbuild'

/**
 * A confirmation you were asked is part of the transcript, and a restart must not make it lie.
 *
 * Three things were wrong, and each is asserted below:
 *  · **Cowork never saved a confirm card at all** — not when it appeared, not when it was answered,
 *    not when the task withdrew it. It reached the database only by riding whatever full rewrite
 *    happened next, which stops being true the moment those saves become incremental;
 *  · **Bitterless saved it but restored it live** — the sheet's pending filter is `!confirm.answer`,
 *    so an unanswered card came back with Allow/Deny pointing at a `taskId` that no longer exists
 *    in main. Clicking it failed and reported "answered elsewhere", which was never true;
 *  · **Cowork restored it as `elsewhere`** — neutralised, but that label claims somebody answered.
 *    Nobody did; the process died. Hence a distinct `expired`.
 *
 * `expired` deliberately lives in `answer` rather than a sibling flag: every "is this still
 * pending?" check in both apps is `!confirm.answer`, so one new value retires the card everywhere
 * at once. A separate boolean would need each of those call sites found and updated, and the one
 * that got missed would be a dead card sitting at the head of the queue.
 */
const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const dir = bl ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const read = (path) => readFileSync(join(root, path), 'utf8')
const members = (path, names) => {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const owner = source.statements.find((node) => ts.isClassDeclaration(node)
    && names.every((name) => node.members.some((member) => member.name?.getText(source) === name)))
  assert.ok(owner, `${path}: requested real class members exist`)
  return names.map((name) => owner.members.find((member) => member.name?.getText(source) === name).getText(source)).join('\n')
}
const evaluate = (source, bindings = {}) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} }
  vm.runInThisContext(`(function(module, exports, ${Object.keys(bindings).join(',')}) {\n${code}\n})`)(
    module, module.exports, ...Object.values(bindings)
  )
  return module.exports
}

const storeFile = dir + 'store/message.store.ts'
const storeMembers = members(storeFile, [
  ...(bl ? ['queueSessionSave', 'saveSessionNow'] : ['runSessionWrite']),
  'persistSessionMeta', 'persistMessages', 'persistSession', 'refreshHistoryRow', 'refreshHistory',
  // Bitterless inlines the close inside `syncTaskConfirm`; Cowork extracted it so the caller can
  // persist exactly the message it closed. Same behaviour, one helper apart.
  'answerConfirm', 'syncTaskConfirm', ...(bl ? [] : ['closeConfirmMessage']),
  'toStoredSessionMeta', 'toStoredMessage', 'toStoredSession'
])

const card = (overrides = {}) => ({
  taskId: 't1', confirmId: 'c1', title: 'Write to disk?', confirmLabel: 'Allow', cancelLabel: 'Deny', ...overrides
})

function harness({ respond = async () => ({ ok: true }) } = {}) {
  const h = { metaWrites: 0, messageWrites: 0, rowsWritten: 0, fullRewrites: 0, written: [], appended: [] }
  const chat = {
    saveSessionMeta: async () => { h.metaWrites += 1; return { ok: true } },
    saveMessages: async ({ messages }) => {
      h.messageWrites += 1; h.rowsWritten += messages.length
      h.written.push(messages.map((message) => message.id))
      return { ok: true }
    },
    saveSession: async ({ session }) => { h.fullRewrites += 1; h.written.push(session.messages.map((m) => m.id)); return { ok: true } },
    getSessionSummary: async () => null,
    listSessions: async () => []
  }
  const { Store } = evaluate(`export class Store { ${storeMembers} }`, {
    coworkChat: chat, maestroChat: chat, coach: { respondTaskConfirm: respond },
    toRaw: (value) => value, turnDiagnostics: { emit: () => {} },
    plainFiles: (files) => files || [], plainActivity: (activity) => activity || [], jsonSafe: (value) => value,
    uid: () => `generated-${(h.appended.length + 1)}`
  })
  const store = new Store()
  Object.assign(store, {
    generation: 0, authGeneration: 0, authActive: true, historySessions: [],
    sessionWrites: { run: (_id, operation) => operation() },
    sessionSaves: new Map(),
    confirmMessages: new Map(),
    stickToBottom: false,
    updateSessionContextUsage() {},
    withTokenCount: (message) => message,
    scrollToBottom() {},
    scheduleScrollToBottomIfNear() {},
    cloneWorkspace: (value) => value,
    getSession: (id) => h.session?.id === id ? h.session : undefined,
    turnService: {
      // The real one seals the open assistant segment and pushes; the seal is irrelevant here and
      // is why the append path deliberately stays on the full rewrite.
      appendTimelineEntry: (session, message) => { h.appended.push(message); session.messages.push(message); return message },
      touchForTask() {}
    }
  })
  h.store = store
  h.session = { id: 's1', source: 'cowork', operationTabId: 'tab', title: 'T', createdAt: 1, updatedAt: 1, detail: {}, messages: [] }
  store.sessions = [h.session]
  return h
}

test('answering a confirmation is written to the database', async () => {
  const h = harness()
  const message = { id: 'm1', source: 'cowork', role: 'ai', type: 'confirm', content: '', ts: 1, confirm: card() }
  h.session.messages.push(message)

  assert.deepEqual(await h.store.answerConfirm(message, true), { ok: true })
  assert.equal(message.confirm.answer, 'confirm')
  assert.equal(h.messageWrites, 1, 'the answer must reach the database, not just the screen')
  assert.deepEqual(h.written, [['m1']], 'and cost exactly the one message that changed')
  assert.equal(h.fullRewrites, 0)
})

test('a delivery that failed is written as elsewhere, not as the answer you clicked', async () => {
  // The save runs AFTER the bridge call for exactly this reason: an optimistic 'confirm' in the
  // database would claim you allowed something that was never actually allowed.
  const h = harness({ respond: async () => ({ ok: false }) })
  const message = { id: 'm1', source: 'cowork', role: 'ai', type: 'confirm', content: '', ts: 1, confirm: card() }
  h.session.messages.push(message)

  await h.store.answerConfirm(message, true)
  assert.equal(message.confirm.answer, 'elsewhere')
  assert.equal(h.messageWrites, 1)
})

test('an already-answered card cannot be answered again, and writes nothing', async () => {
  const h = harness()
  const message = { id: 'm1', source: 'cowork', role: 'ai', type: 'confirm', content: '', ts: 1, confirm: card({ answer: 'cancel' }) }
  h.session.messages.push(message)

  assert.deepEqual(await h.store.answerConfirm(message, true), { ok: false })
  assert.equal(message.confirm.answer, 'cancel')
  assert.equal(h.messageWrites + h.metaWrites + h.fullRewrites, 0)
})

test('a superseded question is closed, so the panel never queues a card nothing is waiting on', async () => {
  const h = harness()
  const first = { id: 'm1', source: 'cowork', role: 'ai', type: 'confirm', content: '', ts: 1, confirm: card() }
  h.session.messages.push(first)
  h.store.confirmMessages.set('t1', 'c1')

  h.store.syncTaskConfirm(h.session, {
    id: 't1',
    state: { pendingConfirm: { id: 'c2', title: 'And this one?', confirmLabel: 'Allow', cancelLabel: 'Deny' } }
  })

  assert.equal(first.confirm.answer, 'elsewhere', 'the question that is no longer being asked must be closed')
  assert.equal(h.appended.length, 1, 'and the new one appended')
  assert.equal(h.appended[0].confirm.confirmId, 'c2')
  assert.equal(h.store.confirmMessages.get('t1'), 'c2')
  // The save is fire-and-forget, so let it land before counting.
  await new Promise((done) => setImmediate(done))
  assert.equal(h.fullRewrites, 1, 'the append path stays a full rewrite — it seals an assistant segment')
  assert.equal(h.messageWrites, 0, 'and it is one save, not one per card')
})

test('a withdrawn question is closed and written, at the cost of one message', async () => {
  const h = harness()
  const message = { id: 'm1', source: 'cowork', role: 'ai', type: 'confirm', content: '', ts: 1, confirm: card() }
  h.session.messages.push(message)
  h.store.confirmMessages.set('t1', 'c1')

  h.store.syncTaskConfirm(h.session, { id: 't1', state: {} })
  await new Promise((done) => setImmediate(done))

  assert.equal(message.confirm.answer, 'elsewhere')
  assert.equal(h.store.confirmMessages.has('t1'), false)
  assert.equal(h.fullRewrites, 0, 'closing one card must not rewrite the history')
  assert.deepEqual(h.written, [['m1']])
})

/**
 * The restore half. Asserted against the real source rather than a stub, because the whole point is
 * what the shipping load path writes into `answer`.
 */
test('a restart retires an unanswered card as expired — never as answered, never as live', () => {
  const source = read(storeFile)
  const mapping = source.match(/confirm: message\.confirm \? \{[^}]*\} : undefined/)
  assert.ok(mapping, 'the load path must still map `confirm` — the assertion lost its target')
  assert.match(
    mapping[0],
    /answer: message\.confirm\.answer \|\| 'expired'/,
    'an unanswered card restored from the database must become `expired`: nothing in main is waiting '
    + 'for it any more, so leaving it live gives the user buttons that cannot work'
  )
  assert.doesNotMatch(
    mapping[0],
    /\|\| 'elsewhere'/,
    '`elsewhere` means somebody answered it. A restart is not somebody.'
  )
})

test('an expired card is excluded from the action panel by the same gate as an answered one', () => {
  const sheet = read(dir + 'task/ChatConfirmSheet.vue')
  assert.match(
    sheet,
    /!\s*\w+\.confirm\.answer/,
    'the pending queue must gate on `!answer` — that is what makes one new answer value retire the '
    + 'card everywhere instead of needing every call site updated'
  )
})

test('the expired card reads as history, not as a decision somebody made', () => {
  const confirmCard = read(dir + 'task/ChatConfirm.vue')
  assert.match(confirmCard, /answer === 'expired'/, 'the card must render a third state')
  // A check or a cross both mean "this option was chosen". Neither happened here.
  assert.match(
    confirmCard,
    /v-if="expired"[\s\S]{0,400}?<\/div>\s*<div v-else-if="answered"/,
    'the expired branch must come BEFORE the answered branch, so it does not inherit its tick/cross'
  )
  assert.doesNotMatch(
    confirmCard.slice(confirmCard.indexOf('v-if="expired"'), confirmCard.indexOf('v-else-if="answered"')),
    /IconCheck|IconX/,
    'no tick and no cross on a card nobody answered'
  )
})
