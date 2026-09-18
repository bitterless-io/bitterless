import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { transformSync } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const store = (bl ? 'src/renderer/maestro/control/src/store/' : 'src/renderer/control/src/store/') + 'message.store.ts'
const read = (path) => readFileSync(join(root, path), 'utf8')
const ast = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
const members = (path, names) => {
  const source = ast(path)
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

// The lane plumbing differs by host — Cowork funnels through `runSessionWrite`, Bitterless through
// its account-fenced `queueSessionSave` / `saveSessionNow` — but the three payload sizes and the
// guarantees they must keep are the same, which is what these tests are about.
const storeMembers = members(store, [
  ...(bl ? ['queueSessionSave', 'saveSessionNow'] : ['runSessionWrite']),
  'persistSessionMeta', 'persistMessages', 'persistSession',
  'toStoredSessionMeta', 'toStoredMessage', 'toStoredSession'
])

function harness() {
  const h = { metaWrites: 0, messageWrites: 0, rowsWritten: 0, fullRewrites: 0, cloned: 0, last: null }
  // Simulates the account changing while the bridge call is in flight.
  const logout = () => { if (h.logoutDuringWrite) { h.store.generation += 1; h.store.authGeneration += 1 } }
  const chat = {
    saveSessionMeta: async ({ session }) => { h.metaWrites += 1; h.last = session; logout(); return { ok: true } },
    saveMessages: async ({ session, messages }) => {
      h.messageWrites += 1; h.rowsWritten += messages.length; h.last = { session, messages }
      logout()
      return { ok: true }
    },
    saveSession: async ({ session }) => { h.fullRewrites += 1; h.rowsWritten += session.messages.length; h.last = session; logout(); return { ok: true } }
  }
  const { Store } = evaluate(`export class Store { ${storeMembers} }`, {
    coworkChat: chat, maestroChat: chat, toRaw: (value) => value,
    // Counting clones is the point: the old path cloned every message on every save.
    plainFiles: (files) => { h.cloned += 1; return files || [] },
    plainActivity: (activity) => activity || [],
    jsonSafe: (value) => value
  })
  const store = new Store()
  Object.assign(store, {
    generation: 0, authGeneration: 0, authActive: true,
    sessionWrites: { run: (_id, operation) => operation() },
    sessionSaves: new Map(),
    updateSessionContextUsage() {},
    refreshHistory: async () => {},
    cloneWorkspace: (value) => value,
    getSession: (id) => (h.session?.id === id ? h.session : undefined)
  })
  h.store = store
  h.makeSession = (messageCount) => ({
    id: 's1', source: 'cowork', operationTabId: 'tab', title: 'T', createdAt: 1, updatedAt: 1,
    detail: {},
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `m${i}`, role: 'human', content: `c${i}`, ts: i, source: 'cowork'
    }))
  })
  return h
}

test('a metadata change writes the session row and not one message row', async (t) => {
  const h = harness()
  h.session = h.makeSession(500)
  assert.equal(await h.store.persistSessionMeta(h.session), true)
  assert.equal(h.metaWrites, 1)
  assert.equal(h.messageWrites, 0)
  assert.equal(h.fullRewrites, 0)
  // This is the line that turns a runaway notification into a machine stall or into nothing at all.
  assert.equal(h.rowsWritten, 0, 'metadata must not touch message rows')
  assert.equal(h.cloned, 0, 'and must not clone message payloads')
})

test('appending one message costs one row, whatever the history length', async (t) => {
  for (const size of [10, 500]) {
    const h = harness()
    h.session = h.makeSession(size)
    const appended = { id: 'new', role: 'ai', content: 'hi', ts: size, source: 'cowork' }
    h.session.messages.push(appended)
    assert.equal(await h.store.persistMessages(h.session, [appended]), true)
    assert.equal(h.messageWrites, 1)
    assert.equal(h.rowsWritten, 1, `history of ${size} must still write one row`)
    assert.equal(h.cloned, 1, `history of ${size} must still clone one message`)
    assert.equal(h.last.messages[0].sortOrder, size, 'sortOrder is the index among persisted messages')
  }
})

test('sortOrder skips localOnly messages, matching what a full rewrite would number', async (t) => {
  const h = harness()
  h.session = h.makeSession(3)
  h.session.messages[1].localOnly = true
  const appended = { id: 'new', role: 'ai', content: 'hi', ts: 9, source: 'cowork' }
  h.session.messages.push(appended)
  await h.store.persistMessages(h.session, [appended])
  // Persisted messages are m0, m2, new → the new one is index 2, not 3. Getting this wrong would
  // renumber every row the next full rewrite touches.
  assert.equal(h.last.messages[0].sortOrder, 2)
})

test('a localOnly message is never written, and asking to write only it falls back to metadata', async (t) => {
  const h = harness()
  h.session = h.makeSession(2)
  const local = { id: 'local', role: 'ai', content: 'x', ts: 3, source: 'cowork', localOnly: true }
  h.session.messages.push(local)
  assert.equal(await h.store.persistMessages(h.session, [local]), true)
  assert.equal(h.messageWrites, 0, 'no message row for a localOnly message')
  assert.equal(h.metaWrites, 1, 'but the session row still records the change')
})

test('the incremental payload is byte-identical to what the full rewrite would have stored', async (t) => {
  const h = harness()
  h.session = h.makeSession(4)
  const target = h.session.messages[2]
  target.content = 'edited'
  await h.store.persistMessages(h.session, [target])
  const incremental = h.last.messages[0]
  const { sortOrder, ...incrementalRow } = incremental
  const full = h.store.toStoredSession(h.session)
  assert.deepEqual(incrementalRow, full.messages[sortOrder], 'same row, whichever lane wrote it')
  assert.deepEqual(h.last.session, h.store.toStoredSessionMeta(h.session), 'same session row too')
})

test('every lane keeps the account/identity fence and the history refresh', async (t) => {
  const h = harness()
  h.session = h.makeSession(2)
  let refreshed = 0
  h.store.refreshHistory = async () => { refreshed += 1 }
  assert.equal(await h.store.persistSessionMeta(h.session), true)
  assert.equal(refreshed, 1)
  // A save for a session the store no longer holds must be dropped, on every lane.
  const orphan = { ...h.makeSession(1), id: 'gone' }
  assert.equal(await h.store.persistSessionMeta(orphan), false)
  assert.equal(await h.store.persistMessages(orphan, orphan.messages), false)
  assert.equal(await h.store.persistSession(orphan), false)
  assert.equal(refreshed, 1, 'a fenced save refreshes nothing')
  // A logout that lands WHILE the bridge call is in flight. Both hosts re-check the account after
  // the write returns, so a save that lands for nobody is dropped on every lane.
  h.logoutDuringWrite = true
  const overtaken = [
    await h.store.persistSessionMeta(h.session),
    await h.store.persistMessages(h.session, h.session.messages),
    await h.store.persistSession(h.session)
  ]
  assert.deepEqual(overtaken, [false, false, false], 'a save overtaken by a logout is dropped on every lane')
  assert.equal(refreshed, 1, 'and refreshes nothing')
})
