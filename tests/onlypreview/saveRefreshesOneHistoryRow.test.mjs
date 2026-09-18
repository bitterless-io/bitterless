import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { transformSync } from 'esbuild'

/**
 * A save refreshes ONE history row — the conversation it touched.
 *
 * Every successful save used to end in `listSessions()`, a read over every message of every session
 * that recomputed counts and previews which could not have changed. That was invisible while the
 * save itself rewrote the whole session; once the write became proportional to the edit it was the
 * remaining whole-database cost on every save
 * (docs/issues/every-save-recounts-the-whole-history.md).
 *
 * The equivalence between the narrow row and the list row is pinned against real SQLite in the DAO
 * test. What is pinned HERE is the store's half, which SQL cannot see: that the narrow read happens
 * at all, that patching the list keeps the query's ordering, that a vanished session leaves no stale
 * entry behind, and that the "empty list ⇒ full pull" recovery survived the optimisation.
 */
const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const storePath = (bl ? 'src/renderer/maestro/control/src/store/' : 'src/renderer/control/src/store/') + 'message.store.ts'
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

const storeMembers = members(storePath, ['refreshHistory', 'refreshHistoryRow'])

const summary = (id, updatedAt, extra = {}) => ({ id, title: `t-${id}`, updatedAt, messageCount: 0, preview: '', ...extra })

function harness({ rows = [], summaryFor = (id) => summary(id, 500), listRows = null } = {}) {
  const h = { summaryReads: [], listReads: 0 }
  const chat = {
    getSessionSummary: async ({ id }) => {
      h.summaryReads.push(id)
      const value = summaryFor(id)
      if (value instanceof Error) throw value
      return value
    },
    listSessions: async () => { h.listReads += 1; return listRows || [] }
  }
  const { Store } = evaluate(`export class Store { ${storeMembers} }`, {
    coworkChat: chat, maestroChat: chat,
    turnDiagnostics: { emit: () => {} }
  })
  const store = new Store()
  // Both hosts fence on a generation counter; Bitterless additionally on `authActive`.
  Object.assign(store, { generation: 0, authGeneration: 0, authActive: true, historySessions: rows })
  h.store = store
  return h
}

test('the row of the saved session is re-read, and no other session is', async () => {
  const h = harness({ rows: [summary('a', 300), summary('b', 200)] })
  await h.store.refreshHistoryRow('b')
  assert.deepEqual(h.summaryReads, ['b'], 'exactly the session that was saved')
  assert.equal(h.listReads, 0, 'and never the whole list')
})

test('the patched list keeps the query’s updated_at DESC ordering', async () => {
  const h = harness({
    rows: [summary('a', 300), summary('b', 200), summary('c', 100)],
    summaryFor: () => summary('c', 999)
  })
  await h.store.refreshHistoryRow('c')
  assert.deepEqual(
    h.store.historySessions.map((row) => [row.id, row.updatedAt]),
    [['c', 999], ['a', 300], ['b', 200]],
    'a save moves its conversation to the top, exactly as ORDER BY updated_at DESC would'
  )
  assert.equal(h.store.historySessions.filter((row) => row.id === 'c').length, 1, 'patched, not appended twice')
})

test('a session that is gone leaves no stale row behind', async () => {
  const h = harness({ rows: [summary('a', 300), summary('b', 200)], summaryFor: () => null })
  await h.store.refreshHistoryRow('a')
  assert.deepEqual(h.store.historySessions.map((row) => row.id), ['b'])
})

test('a first save inserts the row the list has never seen', async () => {
  const h = harness({ rows: [summary('a', 300)], summaryFor: () => summary('new', 400) })
  await h.store.refreshHistoryRow('new')
  assert.deepEqual(h.store.historySessions.map((row) => row.id), ['new', 'a'])
})

test('an empty list still falls back to the full pull — the startup-failure recovery is intact', async () => {
  // `historySessions` is empty only when the startup load never succeeded, and the documented
  // recovery for that is "the next write re-pulls". Narrowing every save would have removed it
  // silently (docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md #2).
  const h = harness({ rows: [], listRows: [summary('a', 300), summary('b', 200)] })
  await h.store.refreshHistoryRow('a')
  assert.equal(h.listReads, 1, 'the whole list is pulled while there is nothing to patch')
  assert.deepEqual(h.summaryReads, [], 'and the narrow read is not also spent')
  assert.deepEqual(h.store.historySessions.map((row) => row.id), ['a', 'b'])
})

test('a failed read keeps the list it already had', async () => {
  const rows = [summary('a', 300), summary('b', 200)]
  const h = harness({ rows, summaryFor: () => new Error('bridge down') })
  await h.store.refreshHistoryRow('a')
  assert.deepEqual(h.store.historySessions.map((row) => row.id), ['a', 'b'], 'a dropped read must not empty the drawer')
})
