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
  '@arco-design/web-vue': `export const Button = 'button'; const notify = (type, notice) => { globalThis.__sessionFixture.noticeCalls.push({ ...notice, type }); globalThis.__sessionFixture.notices.set(notice.id, { ...notice, type }); }; export const Message = { success: (notice) => notify('success', notice), error: (notice) => notify('error', notice) };`,
  'electron-xpc/renderer': `export const xpcRenderer = { subscribe: (channel, fn) => globalThis.__sessionFixture.subscriptions.set(channel, fn) }; export const createXpcRendererEmitter = (handler) => new Proxy({}, { get: (_, method) => (params) => globalThis.__sessionFixture.xpc(handler, method, params) });`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { maestroControl: { chat: { archiveFailed: 'Archive failed', restoreFailed: 'Restore failed', renameFailed: 'Rename failed', undoFailed: 'Undo failed', sessionArchived: 'Archived {title}', sessionRestored: 'Restored {title}', sessionRenamed: 'Renamed {title}', sessionTitleRestored: 'Restored title {title}', undoArchive: 'Undo', slashPathCopied: 'Session path copied', sessionDirectoryOpened: 'Session directory opened' } } };`,
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
  const fixture = { notices: new Map(), noticeCalls: [], subscriptions: new Map(), selected: [], archived: [], restored: [], renamed: [], persistentWrites: [], menuCalls: [], menuResult: { ok: true }, failArchive: false, failRestore: false, failRename: false }
  fixture.sessions = new Map(['a', 'b', 'c'].map((id) => [id, { id, title: `Session ${id}`, detail: {} }]))
  fixture.xpc = async (handler, method, params) => {
    fixture.menuCalls.push({ handler, method, params })
    if (fixture.menuError) throw fixture.menuError
    return fixture.menuResult
  }
  fixture.messages = {
    sessionListItems: ['a', 'b', 'c'].map((id) => ({ id, title: `Session ${id}` })),
    archive: async (id) => { if (fixture.failArchive) return false; fixture.archived.push(id); return true },
    restore: async (id) => { if (fixture.failRestore) return false; fixture.restored.push(id); return true },
    loadPersistedSession: async (id) => fixture.sessions.get(id),
    renameSession: async (id, title, customized = true) => {
      fixture.renamed.push({ id, title, customized })
      if (fixture.failRename) return false
      const session = fixture.sessions.get(id)
      session.title = title
      session.detail.titleCustomized = customized || undefined
      fixture.messages.sessionListItems.find((item) => item.id === id).title = title
      return true
    },
    refreshHistory: async () => {},
    persistSession: async (...args) => { fixture.persistentWrites.push({ method: 'persistSession', args }); return true },
    pushLocalNote: (...args) => { fixture.persistentWrites.push({ method: 'pushLocalNote', args }) }
  }
  fixture.channel = { selectAfterArchive: async () => {}, selectMaestroHistorySession: async (id) => { fixture.selected.push(id); return true } }
  globalThis.__sessionFixture = fixture
  return { state: new SessionActionsState(), fixture }
}

function assertMenuHasNoSessionSideEffects(state, fixture) {
  assert.deepEqual(fixture.selected, [])
  assert.deepEqual(fixture.archived, [])
  assert.deepEqual(fixture.restored, [])
  assert.deepEqual(fixture.renamed, [])
  assert.deepEqual(fixture.persistentWrites, [])
  assert.deepEqual(state.pendingIds, [])
  assert.deepEqual(state.lastUndo, { kind: 'archive', id: 'a', title: 'Session a' })
  assert.equal(state.historyVisible, true)
  assert.equal(state.searchVisible, false)
  assert.deepEqual(fixture.messages.sessionListItems, ['a', 'b', 'c'].map((id) => ({ id, title: `Session ${id}` })))
}

test('session menu copy/open use one local success notice without selecting, archiving or persisting', async () => {
  const { state, fixture } = setup()
  state.historyVisible = true
  state.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
  fixture.channel.activeSessionId = 'a'
  fixture.menuResult = { ok: true, action: 'copy' }
  await state.showMenu('b')
  assert.deepEqual(fixture.noticeCalls[0], { id: 'maestro-session-path', duration: 4500, content: 'Session path copied', type: 'success' })
  fixture.menuResult = { ok: true, action: 'open' }
  await state.showMenu('c')
  assert.deepEqual(fixture.menuCalls, [
    { handler: 'CoachXpcHandler', method: 'showSessionMenu', params: { sessionId: 'b' } },
    { handler: 'CoachXpcHandler', method: 'showSessionMenu', params: { sessionId: 'c' } }
  ])
  assert.equal(fixture.notices.size, 1)
  assert.deepEqual(fixture.notices.get('maestro-session-path'), { id: 'maestro-session-path', duration: 4500, content: 'Session directory opened', type: 'success' })
  assert.equal(fixture.channel.activeSessionId, 'a')
  assertMenuHasNoSessionSideEffects(state, fixture)
})

test('dismissing the native session menu is silent and preserves the previous notice and undo', async () => {
  const { state, fixture } = setup()
  state.historyVisible = true
  state.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
  await state.showMenu('b')
  assert.deepEqual(fixture.noticeCalls, [])
  fixture.menuResult = { ok: true, action: 'copy' }
  await state.showMenu('b')
  const previousNotice = fixture.notices.get('maestro-session-path')
  fixture.menuResult = { ok: true }
  await state.showMenu('c')
  assert.equal(fixture.noticeCalls.length, 1)
  assert.equal(fixture.notices.get('maestro-session-path'), previousNotice)
  assertMenuHasNoSessionSideEffects(state, fixture)
})

test('native session menu failures replace one visible error notice without writing session history', async () => {
  const { state, fixture } = setup()
  state.historyVisible = true
  state.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
  fixture.menuResult = { ok: false, error: 'No saved session logs' }
  await state.showMenu('b')
  assert.deepEqual(fixture.noticeCalls[0], { id: 'maestro-session-path', duration: 6000, content: 'No saved session logs', type: 'error' })
  fixture.menuError = new Error('File manager unavailable')
  await state.showMenu('c')
  assert.equal(fixture.notices.size, 1)
  assert.deepEqual(fixture.notices.get('maestro-session-path'), { id: 'maestro-session-path', duration: 6000, content: 'File manager unavailable', type: 'error' })
  assertMenuHasNoSessionSideEffects(state, fixture)
})

test('rapid archive requests replace one notice and undo only the latest successful archive', async () => {
  const { state, fixture } = setup()
  await Promise.all([state.archive('a'), state.archive('b')])
  assert.deepEqual(fixture.archived, ['a', 'b'])
  assert.equal(fixture.notices.size, 1)
  assert.equal(state.lastUndo.id, 'b')
  assert.equal([...fixture.notices.values()][0].duration, 4500)
  await state.undo()
  await state.undo()
  assert.deepEqual(fixture.restored, ['b'])
  assert.deepEqual(fixture.selected, ['b'])
  assert.equal(state.lastUndo, null)
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
  assert.equal(state.lastUndo.id, 'a')
  fixture.failRestore = true
  await state.undo()
  assert.equal(state.lastUndo.id, 'a')
  assert.equal([...fixture.notices.values()][0].type, 'error')
  fixture.failRestore = false
  await state.undo()
  assert.equal(state.lastUndo, null)
})

test('rename replaces archive undo and archive replaces rename undo using one notice', async () => {
  const { state, fixture } = setup()
  await state.archive('a')
  await state.rename('b', '  Renamed b  ')
  assert.deepEqual(state.lastUndo, { kind: 'rename', id: 'b', title: 'Renamed b', previous: { title: 'Session b', titleCustomized: undefined } })
  await state.undo()
  await state.undo()
  assert.deepEqual(fixture.restored, [], 'replaced archive is no longer undoable')
  assert.equal(fixture.sessions.get('b').title, 'Session b')
  assert.equal(state.lastUndo, null)
  await state.rename('b', 'Another title')
  await state.archive('c')
  assert.deepEqual(state.lastUndo, { kind: 'archive', id: 'c', title: 'Session c' })
  await state.undo()
  await state.undo()
  assert.deepEqual(fixture.restored, ['c'])
  assert.deepEqual(fixture.selected, ['c'])
  assert.equal(fixture.sessions.get('b').title, 'Another title', 'replaced rename is no longer undoable')
  assert.equal(fixture.notices.size, 1)
  assert.ok(fixture.noticeCalls.every((notice) => notice.id === 'maestro-session-archive'))
})

test('rename undo restores the captured title and customized marker without selecting its session', async () => {
  for (const customized of [undefined, true]) {
    const { state, fixture } = setup()
    fixture.channel.activeSessionId = 'a'
    fixture.sessions.get('b').detail.titleCustomized = customized
    await state.rename('b', 'New title')
    assert.equal(fixture.sessions.get('b').detail.titleCustomized, true)
    assert.equal(state.lastUndo.previous.title, 'Session b')
    assert.equal(state.lastUndo.previous.titleCustomized, customized)
    await state.undo()
    await state.undo()
    assert.deepEqual(fixture.renamed, [
      { id: 'b', title: 'New title', customized: true },
      { id: 'b', title: 'Session b', customized: Boolean(customized) }
    ])
    assert.equal(fixture.sessions.get('b').title, 'Session b')
    assert.equal(fixture.sessions.get('b').detail.titleCustomized, customized)
    assert.equal(fixture.channel.activeSessionId, 'a')
    assert.deepEqual(fixture.selected, [])
    assert.equal(state.lastUndo, null)
    assert.equal(fixture.notices.size, 1)
    assert.equal(fixture.notices.get('maestro-session-archive').content, 'Restored title Session b')
  }
})

test('failed archive, rename and rename undo retain the previous record; retry consumes it only after success', async () => {
  const { state, fixture } = setup()
  await state.rename('b', 'New title')
  const record = state.lastUndo
  fixture.failArchive = true
  await state.archive('a')
  assert.equal(state.lastUndo, record)
  fixture.failRename = true
  assert.equal(await state.rename('c', 'Failed title'), false)
  assert.equal(await state.rename('b', '  '), false)
  assert.equal(await state.rename('missing', 'Title'), false)
  assert.equal(state.lastUndo, record)
  await state.undo()
  assert.equal(state.lastUndo, record)
  assert.equal(fixture.sessions.get('b').title, 'New title')
  assert.equal(fixture.notices.get('maestro-session-archive').type, 'error')
  fixture.failRename = false
  await state.undo()
  assert.equal(state.lastUndo, null)
  assert.equal(fixture.sessions.get('b').title, 'Session b')
  assert.equal(fixture.notices.get('maestro-session-archive').type, 'success')
  assert.equal(fixture.notices.size, 1)
})

test('saving an already customized identical title preserves the existing undo and notice', async () => {
  const { state, fixture } = setup()
  fixture.sessions.get('b').detail.titleCustomized = true
  await state.archive('a')
  const record = state.lastUndo
  const notice = fixture.notices.get('maestro-session-archive')
  assert.equal(await state.rename('b', ' Session b '), true)
  assert.equal(state.lastUndo, record)
  assert.equal(fixture.notices.get('maestro-session-archive'), notice)
  assert.deepEqual(fixture.renamed, [])
})

test('queued renames capture the preceding committed title and an immediate undo restores only that title', async () => {
  const { state, fixture } = setup()
  await Promise.all([state.rename('b', 'First title'), state.rename('b', 'Second title'), state.undo()])
  assert.deepEqual(fixture.renamed, [
    { id: 'b', title: 'First title', customized: true },
    { id: 'b', title: 'Second title', customized: true },
    { id: 'b', title: 'First title', customized: true }
  ])
  assert.equal(fixture.sessions.get('b').title, 'First title')
  assert.equal(state.lastUndo, null)
  assert.equal(fixture.notices.size, 1)
})

test('an in-flight undo does not clear or announce success over a replacement record', async () => {
  const { state, fixture } = setup()
  state.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
  let release
  fixture.messages.restore = () => new Promise((resolve) => { release = resolve })
  const pending = state.undo()
  await Promise.resolve()
  const replacement = { kind: 'rename', id: 'b', title: 'New title', previous: { title: 'Session b' } }
  state.lastUndo = replacement
  release(true)
  await pending
  assert.equal(state.lastUndo, replacement)
  assert.deepEqual(fixture.noticeCalls, [])
})

test('text undo calls only the typed native edit endpoint and exposes errors without consuming business undo', async () => {
  const { state, fixture } = setup()
  state.historyVisible = true
  state.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
  await state.undoTextEdit()
  assert.deepEqual(fixture.menuCalls, [{ handler: 'CoachXpcHandler', method: 'editControlText', params: { action: 'undo' } }])
  assert.deepEqual(fixture.noticeCalls, [])
  fixture.menuResult = { ok: false }
  await state.undoTextEdit()
  assert.equal(fixture.notices.get('maestro-session-archive').content, 'Undo failed')
  fixture.menuError = new Error('Control unavailable')
  await state.undoTextEdit()
  assert.equal(fixture.notices.get('maestro-session-archive').content, 'Control unavailable')
  assert.equal(fixture.notices.get('maestro-session-archive').type, 'error')
  assert.equal(fixture.notices.size, 1)
  assertMenuHasNoSessionSideEffects(state, fixture)
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

test('title marker passes through DAO normalization and the header renders SessionTitle', () => {
  const dao = read('src/preload/maestro/sqlite/maestroChat.dao.ts')
  assert.match(dao, /titleCustomized: detail\?\.titleCustomized === true/)
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
  assert.match(drawer, /<div\s+v-for="\(item, index\) in messageStore.sessionListItems"/)
  assert.match(panel, /if \(!sessionActions.historyVisible && !sessionActions.searchVisible\) void nextTick\(focusComposer\)/)
  const titleStyle = read('src/renderer/maestro/control/src/SessionTitle.less')
  assert.match(titleStyle, /\.session-title__input \{\s+position: absolute;/)
  const search = read('src/renderer/maestro/control/src/SessionSearchModal.vue')
  assert.match(search, /event\.isComposing \|\| composing.value/)
  assert.match(search, /v-if="item.running"/)
  assert.match(search, /v-else-if="item.unread"/)
})
