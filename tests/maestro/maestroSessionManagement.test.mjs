import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import less from 'less'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const mocks = {
  '@arco-design/web-vue': `export const Button = 'button'; export const Message = { success: (notice) => globalThis.__sessionFixture.notices.set(notice.id, { ...notice, type: 'success' }), error: (notice) => globalThis.__sessionFixture.notices.set(notice.id, { ...notice, type: 'error' }) };`,
  'electron-xpc/renderer': `export const xpcRenderer = { subscribe: (channel, fn) => globalThis.__sessionFixture.subscriptions.set(channel, fn) };`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { maestroControl: { chat: { archiveFailed: 'Archive failed', restoreFailed: 'Restore failed', sessionArchived: 'Archived {title}', sessionRestored: 'Restored {title}', undoArchive: 'Undo' } } };`,
  './channel.store': `export const channelStore = new Proxy({}, { get: (_, key) => globalThis.__sessionFixture.channel[key] });`,
  './message.store': `export const messageStore = new Proxy({}, { get: (_, key) => globalThis.__sessionFixture.messages[key] });`
}
const bundle = await build({
  entryPoints: [resolve(root, 'src/renderer/maestro/control/src/store/sessionActions.store.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'session-fixture', setup(ctx) {
    ctx.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined)
    ctx.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path] }))
  } }]
})
const { SessionActionsState, matchesSessionTitle } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function setup() {
  const fixture = { notices: new Map(), subscriptions: new Map(), selected: [], archived: [], restored: [], failArchive: false, failRestore: false }
  fixture.messages = {
    sessionListItems: ['a', 'b', 'c'].map((id) => ({ id, title: `Session ${id}` })),
    archive: async (id) => { if (fixture.failArchive) return false; fixture.archived.push(id); return true },
    restore: async (id) => { if (fixture.failRestore) return false; fixture.restored.push(id); return true },
    refreshHistory: async () => {}
  }
  fixture.channel = { selectAfterArchive: async () => {}, selectMaestroHistorySession: async (id) => { fixture.selected.push(id); return true } }
  globalThis.__sessionFixture = fixture
  return { state: new SessionActionsState(), fixture }
}

test('rapid archive requests replace one notice and undo only the latest successful archive', async () => {
  const { state, fixture } = setup()
  await Promise.all([state.archive('a'), state.archive('b')])
  assert.deepEqual(fixture.archived, ['a', 'b'])
  assert.equal(fixture.notices.size, 1)
  assert.equal(state.lastArchived.id, 'b')
  assert.equal([...fixture.notices.values()][0].duration, 4500)
  await state.undoArchive()
  await state.undoArchive()
  assert.deepEqual(fixture.restored, ['b'])
  assert.deepEqual(fixture.selected, ['b'])
  assert.equal(state.lastArchived, null)
  assert.equal(fixture.notices.size, 1)
})

test('archiving the current session keeps its drawer open and leaves focus ready for undo', async () => {
  const { state, fixture } = setup()
  state.historyVisible = true
  fixture.channel.activeSessionId = 'a'
  let focused = false
  const previousDocument = globalThis.document
  globalThis.document = { querySelector: () => ({ focus: () => { focused = true } }) }
  try {
    await state.archive('a')
    assert.equal(state.historyVisible, true)
    assert.equal(focused, true)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('archive and restore failures retain previous undo; duplicate pending archive is ignored', async () => {
  const { state, fixture } = setup()
  await Promise.all([state.archive('a'), state.archive('a')])
  assert.deepEqual(fixture.archived, ['a'])
  fixture.failArchive = true
  await state.archive('b')
  assert.equal(state.lastArchived.id, 'a')
  fixture.failRestore = true
  await state.undoArchive()
  assert.equal(state.lastArchived.id, 'a')
  assert.equal([...fixture.notices.values()][0].type, 'error')
  fixture.failRestore = false
  await state.undoArchive()
  assert.equal(state.lastArchived, null)
})

test('search is title-only with normalized case, full-width and all query tokens', () => {
  assert.equal(matchesSessionTitle('ＧＰＴ Design 方案', 'gpt 方案'), true)
  assert.equal(matchesSessionTitle('title', 'preview words'), false)
  assert.equal(matchesSessionTitle('Some title', '  '), false)
  assert.equal(matchesSessionTitle('One title', 'one missing'), false)
  const { state, fixture } = setup()
  state.init(); state.init()
  assert.equal(fixture.subscriptions.size, 1)
  fixture.subscriptions.get('maestro/session-search')()
  assert.equal(state.searchVisible, true)
  state.openSearch()
  assert.equal(state.searchVisible, true)
  assert.equal(state.searchRevision, 2)
})

test('title marker passes through DAO normalization and guards both automatic title paths', () => {
  const dao = read('src/preload/maestro/sqlite/maestroChat.dao.ts')
  assert.match(dao, /titleCustomized: detail\?\.titleCustomized === true/)
  const turn = read('src/renderer/maestro/control/src/store/turn.service.ts')
  assert.equal((turn.match(/!session\.detail\.titleCustomized && session\.title === 'Maestro'/g) || []).length, 2)
  const app = read('src/renderer/maestro/control/src/ControlApp.vue')
  assert.match(app, /<SessionTitle v-if="activeSession"/)
  assert.doesNotMatch(app, /<span>Maestro<\/span>/)
})

test('session controls compile Vue templates and Less; rows avoid nested buttons and edit retains native undo', async () => {
  for (const file of ['ChatPanel', 'ControlApp', 'SessionTitle', 'SessionSearchModal', 'SessionsDrawer']) {
    const filename = resolve(root, `src/renderer/maestro/control/src/${file}.vue`)
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const template = compileTemplate({ id: file, filename, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], file)
    await less.render(read(`src/renderer/maestro/control/src/${file}.less`), { filename: resolve(root, `src/renderer/maestro/control/src/${file}.less`) })
  }
  const panel = read('src/renderer/maestro/control/src/ChatPanel.vue')
  const drawer = read('src/renderer/maestro/control/src/SessionsDrawer.vue')
  assert.match(drawer, /key === 'z' && !isEditableTarget\(event.target\)/)
  assert.match(drawer, /<div\s+v-for="\(item, index\) in messageStore.sessionListItems"/)
  assert.match(panel, /if \(!sessionActions.historyVisible && !sessionActions.searchVisible\) void nextTick\(focusComposer\)/)
  const titleStyle = read('src/renderer/maestro/control/src/SessionTitle.less')
  assert.match(titleStyle, /\.session-title__input \{\s+position: absolute;/)
  const search = read('src/renderer/maestro/control/src/SessionSearchModal.vue')
  assert.match(search, /event\.isComposing \|\| composing.value/)
  assert.match(search, /v-if="item.running"/)
  assert.match(search, /v-else-if="item.unread"/)
})
