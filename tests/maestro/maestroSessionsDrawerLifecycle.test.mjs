import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'

const root = resolve(import.meta.dirname, '../..')
const controlSource = readFileSync(resolve(root, 'src/renderer/maestro/control/src/ControlApp.vue'), 'utf8')
const control = parse(controlSource).descriptor
const controlRender = compileTemplate({ source: control.template.content, filename: 'ControlApp.vue', id: 'stable-control' })
assert.deepEqual(controlRender.errors, [])
const drawerSource = readFileSync(resolve(root, 'src/renderer/maestro/control/src/SessionsDrawer.vue'), 'utf8')
const drawer = parse(drawerSource).descriptor
const drawerScript = compileScript(drawer, { id: 'stable-drawer', inlineTemplate: true })
const searchSource = readFileSync(resolve(root, 'src/renderer/maestro/control/src/SessionSearchModal.vue'), 'utf8')
const searchScript = compileScript(parse(searchSource).descriptor, { id: 'session-search', inlineTemplate: true })
const titleSource = readFileSync(resolve(root, 'src/renderer/maestro/control/src/SessionTitle.vue'), 'utf8')
const titleScript = compileScript(parse(titleSource).descriptor, { id: 'session-title', inlineTemplate: true })
const fixture = { listeners: new Map(), mounted: 0, unmounted: 0, panelsMounted: 0, panelsUnmounted: 0, visibility: [], notices: new Map(), focusCount: 0, menuCalls: [], editCalls: [], sessionActions: [] }
const session = (id) => ({ id, title: `Session ${id}`, messages: [], detail: {}, updatedAt: 1 })
fixture.sessions = vue.reactive(['a', 'b', 'c'].map(session))
fixture.messages = vue.reactive({
  sessionListItems: fixture.sessions.map((item) => ({ ...item, running: false, unread: false, preview: '' })),
  refreshHistory: async () => {},
  loadPersistedSession: async (id) => fixture.sessions.find((item) => item.id === id),
  renameSession: async (id, title, customized = true) => {
    fixture.sessionActions.push({ method: 'renameSession', id, title, customized })
    const session = fixture.sessions.find((item) => item.id === id)
    session.title = title
    session.detail.titleCustomized = customized || undefined
    const item = fixture.messages.sessionListItems.find((entry) => entry.id === id)
    if (item) item.title = title
    return true
  },
  archive: async (id) => { fixture.sessionActions.push({ method: 'archive', id }); fixture.messages.sessionListItems = fixture.messages.sessionListItems.filter((item) => item.id !== id); return true },
  restore: async (id) => { fixture.sessionActions.push({ method: 'restore', id }); fixture.messages.sessionListItems.push({ ...session(id), running: false, unread: false, preview: '' }); return true }
})
fixture.channel = vue.reactive({
  activeSessionId: 'a',
  selectAfterArchive: async (id) => { fixture.sessionActions.push({ method: 'selectAfterArchive', id }); if (fixture.channel.activeSessionId === id) fixture.channel.activeSessionId = fixture.messages.sessionListItems[0]?.id || '' },
  selectMaestroHistorySession: async (id) => { fixture.sessionActions.push({ method: 'selectMaestroHistorySession', id }); fixture.channel.activeSessionId = id; return true }
})
fixture.chat = new Proxy({}, { get: (_, key) => String(key) })
fixture.Button = vue.defineComponent({ setup(_, { attrs, slots }) { return () => vue.h('button', attrs, slots.default?.()) } })
fixture.Drawer = vue.defineComponent({
  props: ['visible', 'popupContainer'],
  setup(props, { slots }) {
    vue.onMounted(() => { fixture.mounted++ })
    vue.onBeforeUnmount(() => { fixture.unmounted++ })
    vue.watch(() => props.visible, (visible) => fixture.visibility.push(visible), { immediate: true })
    return () => vue.h('aside', { visible: props.visible, popupContainer: props.popupContainer }, slots.default?.())
  }
})
fixture.Modal = vue.defineComponent({
  props: ['visible'],
  setup(props, { slots }) { return () => vue.h('dialog', { visible: props.visible }, slots.default?.()) }
})
globalThis.__drawerFixture = fixture
globalThis.__drawerVue = vue
const originals = new Map(['document', 'window', 'navigator', 'Element'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
class TestElement { constructor(editable = false) { this.editable = editable } closest() { return this.editable ? this : null } }
Object.defineProperty(globalThis, 'Element', { configurable: true, value: TestElement })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { hasFocus: () => true, querySelector: () => ({ focus: () => { fixture.focusCount++ } }) } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'MacIntel' } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  addEventListener: (key, fn) => fixture.listeners.set(key, fn),
  removeEventListener: (key, fn) => { if (fixture.listeners.get(key) === fn) fixture.listeners.delete(key) }
} })
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  delete globalThis.__drawerFixture
  delete globalThis.__drawerVue
})
const mocks = {
  vue: Object.keys(vue).filter((key) => /^[a-zA-Z_$][\w$]*$/.test(key)).map((key) => `export const ${key} = globalThis.__drawerVue.${key};`).join('\n'),
  '@arco-design/web-vue': `export const Button = globalThis.__drawerFixture.Button; export const Drawer = globalThis.__drawerFixture.Drawer; export const Modal = globalThis.__drawerFixture.Modal; export const Message = { success: (notice) => globalThis.__drawerFixture.notices.set(notice.id, notice), error: (notice) => globalThis.__drawerFixture.notices.set(notice.id, notice) };`,
  '@tabler/icons-vue': `export const IconArchive = 'span', IconSearch = 'span', IconX = 'span';`,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { maestroControl: { chat: globalThis.__drawerFixture.chat } };`,
  'electron-xpc/renderer': `export const xpcRenderer = { subscribe: () => {} }; export const createXpcRendererEmitter = (handler) => ({ showSessionMenu: async (params) => { globalThis.__drawerFixture.menuCalls.push({ handler, params }); return { ok: true }; }, editControlText: async (params) => { globalThis.__drawerFixture.editCalls.push({ handler, params }); return { ok: true }; } });`,
  './store/message.store': 'export const messageStore = globalThis.__drawerFixture.messages;',
  './message.store': 'export const messageStore = globalThis.__drawerFixture.messages;',
  './store/channel.store': 'export const channelStore = globalThis.__drawerFixture.channel;',
  './channel.store': 'export const channelStore = globalThis.__drawerFixture.channel;',
  '../../../common/components/IconBtn/IconBtn.vue': 'export default globalThis.__drawerFixture.Button;',
  './SessionsDrawer.less': '',
  './SessionSearchModal.less': '',
  './SessionTitle.less': '',
  'fixture-drawer': drawerScript.content,
  'fixture-search': searchScript.content,
  'fixture-title': titleScript.content,
  'fixture-control-render': controlRender.code
}
const compiled = await build({
  stdin: { contents: `export { default as SessionsDrawer } from 'fixture-drawer'; export { default as SessionSearchModal } from 'fixture-search'; export { default as SessionTitle } from 'fixture-title'; export { render } from 'fixture-control-render'; export { sessionActions } from './store/sessionActions.store';`, resolveDir: resolve(root, 'src/renderer/maestro/control/src'), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{ name: 'drawer-lifecycle', setup(ctx) {
    ctx.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'drawer-fixture' } : undefined)
    ctx.onLoad({ filter: /.*/, namespace: 'drawer-fixture' }, ({ path }) => ({ contents: mocks[path], loader: 'ts', resolveDir: resolve(root, 'src/renderer/maestro/control/src') }))
  } }]
})
const { SessionsDrawer, SessionSearchModal, SessionTitle, render, sessionActions } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const node = (type, text = '') => vue.markRaw(Object.assign(new TestElement(type === 'input' || type === 'textarea'), {
  type, text, children: [], parent: null, props: {}, listeners: new Map(), querySelector: () => null,
  addEventListener(event, handler) { this.listeners.set(event, handler) },
  focus() { document.activeElement = this }, select() { this.selected = true }
}))
const renderer = vue.createRenderer({
  createElement: (type) => node(type), createText: (text) => node('#text', text), createComment: (text) => node('#comment', text),
  setText: (entry, text) => { entry.text = text }, setElementText: (entry, text) => { entry.text = text; entry.children = [] },
  parentNode: (entry) => entry.parent, nextSibling: (entry) => entry.parent?.children[entry.parent.children.indexOf(entry) + 1] || null,
  patchProp: (entry, key, _previous, value) => { entry.props[key] = value },
  insert: (entry, parent, anchor = null) => {
    if (entry.parent) entry.parent.children.splice(entry.parent.children.indexOf(entry), 1)
    entry.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(entry)
    else parent.children.splice(index, 0, entry)
  },
  remove: (entry) => { if (entry.parent) entry.parent.children.splice(entry.parent.children.indexOf(entry), 1); entry.parent = null }
})
const find = (entry, predicate) => predicate(entry) ? entry : entry.children.map((child) => find(child, predicate)).find(Boolean)
const flush = async () => { await vue.nextTick(); await new Promise((done) => setImmediate(done)) }

function mountControl() {
  const components = Object.fromEntries([...control.template.content.matchAll(/<([A-Z]\w*)\b/g)].map((match) => [match[1], { render: () => vue.h('span') }]))
  components.SessionsDrawer = SessionsDrawer
  components.SessionTitle = SessionTitle
  components.ChatPanel = vue.defineComponent({
    props: ['session'],
    setup(props) { vue.onMounted(() => fixture.panelsMounted++); vue.onBeforeUnmount(() => fixture.panelsUnmounted++); return () => vue.h('main', { sessionId: props.session.id }) }
  })
  const app = renderer.createApp({
    components, render,
    setup: () => ({
      activeSession: vue.computed(() => fixture.sessions.find((item) => item.id === fixture.channel.activeSessionId)),
      controlLoading: false, controlLoadError: '', resizing: false, panelFocused: true, llmAvailable: true, llmLoginLoading: false,
      onResizeDown() {}, onResizeMove() {}, onResizeEnd() {}, closePanel() {}, onChatReply() {}, focusComposer() {},
      i18nHelper: { menuBar: { maestro: { resizePanel: 'Resize', hidePanel: 'Close' } } }
    })
  })
  const container = node('root')
  app.mount(container)
  return { app, container }
}

test('actual Control template keeps the same Drawer instance and host node while current-chat archive remounts only ChatPanel', async () => {
  const { app, container } = mountControl()
  try {
    sessionActions.toggleHistory()
    await flush()
    const originalDrawer = find(container, (entry) => entry.type === 'aside')
    assert.equal(originalDrawer.props.visible, true)
    assert.equal(originalDrawer.props.popupContainer, '#control-card')
    const originalPanel = find(container, (entry) => entry.type === 'main')
    const originalCurrent = find(container, (entry) => entry.props['aria-current'] === 'true')
    assert.match(originalCurrent.props.class, /chat-panel__history-item--active/)
    fixture.visibility.length = 0
    const archive = find(originalCurrent, (entry) => entry.props.name === 'maestro__history-archive')
    await archive.props.onClick({ stopPropagation() {} })
    await flush()
    assert.equal(fixture.channel.activeSessionId, 'b')
    assert.equal(find(container, (entry) => entry.type === 'aside'), originalDrawer)
    assert.notEqual(find(container, (entry) => entry.type === 'main'), originalPanel)
    assert.equal(fixture.mounted, 1)
    assert.equal(fixture.unmounted, 0)
    assert.equal(fixture.panelsMounted, 2)
    assert.equal(fixture.panelsUnmounted, 1)
    assert.deepEqual(fixture.visibility, [], 'no close/open visibility transition while archiving')
    assert.equal(fixture.listeners.size, 1, 'drawer shortcut handler survives the keyed panel swap')
    assert.ok(fixture.focusCount > 0)

    await sessionActions.archive('c')
    await flush()
    assert.equal(find(container, (entry) => entry.type === 'aside'), originalDrawer)
    assert.deepEqual(fixture.visibility, [])
    await sessionActions.undo()
    await flush()
    assert.equal(fixture.channel.activeSessionId, 'c')
    assert.equal(find(container, (entry) => entry.type === 'aside'), originalDrawer)
    assert.equal(sessionActions.lastUndo, null)
  } finally {
    app.unmount()
  }
  assert.equal(fixture.unmounted, 1)
  assert.equal(fixture.listeners.size, 0)
})

test('stable drawer owns history navigation, search, IME guards and editable undo without the composer listener', async () => {
  sessionActions.historyVisible = false
  sessionActions.searchVisible = false
  fixture.messages.sessionListItems = fixture.sessions.map((item) => ({ ...item, running: false, unread: false, preview: '' }))
  fixture.channel.activeSessionId = 'b'
  const { app, container } = mountControl()
  const key = (key, options = {}) => {
    const event = { key, target: null, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, ...options }
    fixture.listeners.get('keydown')(event)
    return event
  }
  const cursorTitle = () => find(find(container, (entry) => entry.props['data-history-cursor'] === true), (entry) => entry.props.class === 'chat-panel__history-item-title')?.text
  try {
    key('h', { metaKey: true, isComposing: true })
    key('h', { metaKey: true, repeat: true })
    assert.equal(sessionActions.historyVisible, false)
    key('h', { metaKey: true })
    await flush()
    assert.equal(cursorTitle(), 'Session b')
    key('ArrowUp'); key('ArrowUp')
    await flush()
    assert.equal(cursorTitle(), 'Session c')
    const enter = key('Enter')
    await flush()
    assert.equal(enter.stopped, true)
    assert.equal(fixture.channel.activeSessionId, 'c')
    assert.equal(sessionActions.historyVisible, false)
    key('h', { ctrlKey: true })
    await flush()
    key('f', { metaKey: true })
    await flush()
    assert.equal(sessionActions.historyVisible, false)
    assert.equal(sessionActions.searchVisible, true)
    sessionActions.lastUndo = { kind: 'archive', id: 'a', title: 'Session a' }
    const pendingUndo = sessionActions.lastUndo
    const actionsBeforeUndo = fixture.sessionActions.length
    fixture.editCalls.length = 0
    const undo = key('z', { metaKey: true, target: new TestElement(true) })
    await flush()
    assert.equal(undo.defaultPrevented, true)
    assert.equal(undo.stopped, true)
    assert.deepEqual(fixture.editCalls, [{ handler: 'CoachXpcHandler', params: { action: 'undo' } }])
    assert.equal(fixture.sessionActions.length, actionsBeforeUndo)
    assert.equal(sessionActions.lastUndo, pendingUndo)
    const redo = key('z', { metaKey: true, shiftKey: true, target: new TestElement(true) })
    assert.equal(redo.defaultPrevented, undefined)
    assert.equal(redo.stopped, undefined)
    assert.equal(fixture.editCalls.length, 1)
    sessionActions.lastUndo = null
    sessionActions.closeSearch()
    fixture.messages.sessionListItems = []
    key('h', { metaKey: true })
    await flush()
    key('ArrowUp'); key('Enter'); key('Escape')
    await flush()
    assert.equal(sessionActions.historyVisible, false)
  } finally { app.unmount() }
})

test('right-clicking an actual non-current drawer row opens its native menu without selection or drawer closure', async () => {
  sessionActions.historyVisible = false
  sessionActions.searchVisible = false
  fixture.channel.activeSessionId = 'a'
  fixture.messages.sessionListItems = fixture.sessions.map((item) => ({ ...item, running: item.id === 'b', unread: false, preview: '' }))
  fixture.menuCalls.length = 0
  fixture.sessionActions.length = 0
  fixture.notices.clear()
  const { app, container } = mountControl()
  try {
    sessionActions.toggleHistory()
    await flush()
    const originalDrawer = find(container, (entry) => entry.type === 'aside')
    const originalPanel = find(container, (entry) => entry.type === 'main')
    const row = find(container, (entry) => entry.props.name === 'maestro__history-item'
      && find(entry, (child) => child.props.class === 'chat-panel__history-item-title' && child.text === 'Session b'))
    assert.equal(row.props['aria-current'], undefined)
    assert.ok(find(row, (entry) => entry.props.name === 'maestro__history-item-running'))
    fixture.visibility.length = 0
    const event = { preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true } }
    await row.props.onContextmenu(event)
    await flush()
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.stopped, true)
    assert.deepEqual(fixture.menuCalls, [{ handler: 'CoachXpcHandler', params: { sessionId: 'b' } }])
    assert.deepEqual(fixture.sessionActions, [])
    assert.equal(fixture.channel.activeSessionId, 'a')
    assert.equal(sessionActions.historyVisible, true)
    assert.equal(sessionActions.searchVisible, false)
    assert.equal(find(container, (entry) => entry.type === 'aside'), originalDrawer)
    assert.equal(find(container, (entry) => entry.type === 'main'), originalPanel)
    assert.deepEqual(fixture.visibility, [])
    assert.deepEqual(fixture.messages.sessionListItems.map((item) => item.id), ['a', 'b', 'c'])
    assert.equal(fixture.notices.size, 0, 'native menu dismissal has no toast')
  } finally { app.unmount() }
})

test('actual title-search results right-click the running/unread session without selecting or closing the modal', async () => {
  sessionActions.historyVisible = false
  sessionActions.searchVisible = true
  fixture.channel.activeSessionId = 'a'
  fixture.messages.sessionListItems = fixture.sessions.map((item) => ({ ...item, running: item.id === 'b', unread: item.id === 'c', preview: '' }))
  fixture.menuCalls.length = 0
  fixture.sessionActions.length = 0
  let closed = 0
  const app = renderer.createApp(SessionSearchModal, { onClose: () => { closed++ } })
  const container = node('root')
  app.mount(container)
  try {
    const input = find(container, (entry) => entry.props.name === 'maestro__session-search-input')
    input.value = 'Session'
    input.listeners.get('input')({ target: input })
    await flush()
    for (const [id, status] of [['b', 'running'], ['c', 'unread']]) {
      const row = find(container, (entry) => entry.props.id === `maestro-session-search-${id}`)
      assert.ok(find(row, (entry) => entry.props.class === `chat-panel__history-item-${status}`))
      const event = { preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true } }
      await row.props.onContextmenu(event)
      await flush()
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.stopped, true)
    }
    assert.deepEqual(fixture.menuCalls, [
      { handler: 'CoachXpcHandler', params: { sessionId: 'b' } },
      { handler: 'CoachXpcHandler', params: { sessionId: 'c' } }
    ])
    assert.deepEqual(fixture.sessionActions, [])
    assert.equal(fixture.channel.activeSessionId, 'a')
    assert.equal(sessionActions.searchVisible, true)
    assert.equal(find(container, (entry) => entry.type === 'dialog').props.visible, true)
    assert.equal(find(container, (entry) => entry.props.id === 'maestro-session-search-a').props['aria-selected'], true)
    assert.equal(closed, 0)
    assert.deepEqual(fixture.messages.sessionListItems.map((item) => item.id), ['a', 'b', 'c'])
  } finally { app.unmount(); sessionActions.searchVisible = false }
})

test('actual title Enter commit focuses the label so Cmd+Z undoes the saved rename exactly once', async () => {
  sessionActions.historyVisible = false
  sessionActions.searchVisible = false
  sessionActions.lastUndo = { kind: 'archive', id: 'c', title: 'Session c' }
  fixture.channel.activeSessionId = 'a'
  fixture.sessions[0].title = 'Session a'
  fixture.sessions[0].detail = {}
  fixture.sessionActions.length = 0
  fixture.editCalls.length = 0
  fixture.notices.clear()
  const { app, container } = mountControl()
  const keyboardEvent = (key, target, options = {}) => ({ key, target, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, ...options })
  try {
    const label = find(container, (entry) => entry.props.name === 'maestro__session-title-label')
    await label.props.onDblclick()
    await flush()
    const input = find(container, (entry) => entry.props.name === 'maestro__session-title-input')
    assert.equal(document.activeElement, input)
    assert.equal(input.selected, true)
    assert.equal(fixture.messages.editingTitleSessionId, 'a')
    const previousUndo = sessionActions.lastUndo
    const textUndo = keyboardEvent('z', input, { metaKey: true })
    fixture.listeners.get('keydown')(textUndo)
    await flush()
    assert.equal(textUndo.defaultPrevented, true)
    assert.deepEqual(fixture.editCalls, [{ handler: 'CoachXpcHandler', params: { action: 'undo' } }])
    assert.equal(sessionActions.lastUndo, previousUndo)
    assert.deepEqual(fixture.sessionActions, [])

    input.value = '  Saved title  '
    input.listeners.get('input')({ target: input })
    input.props.onKeydown(keyboardEvent('Enter', input))
    await flush()
    const savedLabel = find(container, (entry) => entry.props.name === 'maestro__session-title-label')
    assert.equal(savedLabel.text, 'Saved title')
    assert.equal(fixture.messages.editingTitleSessionId, '')
    assert.equal(document.activeElement, savedLabel)
    assert.equal(sessionActions.lastUndo.kind, 'rename')
    assert.equal(fixture.sessions[0].detail.titleCustomized, true)
    assert.deepEqual(fixture.sessionActions, [{ method: 'renameSession', id: 'a', title: 'Saved title', customized: true }])

    const undo = keyboardEvent('z', document.activeElement, { metaKey: true })
    fixture.listeners.get('keydown')(undo)
    await flush()
    assert.equal(undo.defaultPrevented, true)
    assert.equal(undo.stopped, true)
    assert.equal(fixture.editCalls.length, 1, 'saved-title undo does not call the native text endpoint')
    assert.equal(fixture.sessions[0].title, 'Session a')
    assert.equal(fixture.sessions[0].detail.titleCustomized, undefined)
    assert.equal(find(container, (entry) => entry.props.name === 'maestro__session-title-label').text, 'Session a')
    assert.deepEqual(fixture.sessionActions, [
      { method: 'renameSession', id: 'a', title: 'Saved title', customized: true },
      { method: 'renameSession', id: 'a', title: 'Session a', customized: false }
    ])
    assert.equal(sessionActions.lastUndo, null)
    assert.equal(fixture.notices.size, 1)
    const secondUndo = keyboardEvent('z', document.activeElement, { metaKey: true })
    fixture.listeners.get('keydown')(secondUndo)
    await flush()
    assert.equal(secondUndo.defaultPrevented, undefined)
    assert.equal(fixture.sessionActions.length, 2)
    assert.equal(fixture.channel.activeSessionId, 'a')
  } finally { app.unmount() }
})

test('actual title blur commits the rename without stealing focus from the next control', async () => {
  sessionActions.historyVisible = false
  sessionActions.searchVisible = false
  sessionActions.lastUndo = null
  fixture.channel.activeSessionId = 'a'
  fixture.sessions[0].title = 'Session a'
  fixture.sessions[0].detail = {}
  fixture.sessionActions.length = 0
  const { app, container } = mountControl()
  try {
    await find(container, (entry) => entry.props.name === 'maestro__session-title-label').props.onDblclick()
    await flush()
    const input = find(container, (entry) => entry.props.name === 'maestro__session-title-input')
    input.value = 'Blur title'
    input.listeners.get('input')({ target: input })
    const nextControl = node('textarea')
    nextControl.focus()
    await input.props.onBlur()
    await flush()
    assert.equal(document.activeElement, nextControl)
    assert.equal(fixture.messages.editingTitleSessionId, '')
    assert.equal(fixture.sessions[0].title, 'Blur title')
    assert.equal(find(container, (entry) => entry.props.name === 'maestro__session-title-label').text, 'Blur title')
    assert.equal(sessionActions.lastUndo.kind, 'rename')
    assert.deepEqual(fixture.sessionActions, [{ method: 'renameSession', id: 'a', title: 'Blur title', customized: true }])
  } finally { app.unmount(); sessionActions.lastUndo = null }
})

test('title editor registers only its current session and clears on escape and unmount', async () => {
  fixture.channel.activeSessionId = 'a'
  const { app, container } = mountControl()
  await find(container, entry => entry.props.name === 'maestro__session-title-label').props.onDblclick()
  await flush()
  assert.equal(fixture.messages.editingTitleSessionId, 'a')
  find(container, entry => entry.props.name === 'maestro__session-title-input').props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  await flush()
  assert.equal(fixture.messages.editingTitleSessionId, '')
  await find(container, entry => entry.props.name === 'maestro__session-title-label').props.onDblclick()
  await flush()
  assert.equal(fixture.messages.editingTitleSessionId, 'a')
  app.unmount()
  assert.equal(fixture.messages.editingTitleSessionId, '')
})

test('active-row emphasis uses the requested 4 px left border and no current-session arrow', () => {
  const style = readFileSync(resolve(root, 'src/renderer/maestro/control/src/SessionsDrawer.less'), 'utf8')
  assert.match(style, /border-left: 4px solid transparent/)
  assert.match(style, /\.chat-panel__history-item--active[\s\S]*?border-left-color: #4e5882/)
  assert.doesNotMatch(drawerSource, /IconArrowRight|history-current/)
  assert.doesNotMatch(controlSource, /<SessionsDrawer[^>]+:key=/)
  assert.doesNotMatch(readFileSync(resolve(root, 'src/renderer/maestro/control/src/ChatPanel.vue'), 'utf8'), /<Drawer|<SessionSearchModal/)
  assert.match(style, /\.chat-panel__history-header \{[^}]*justify-content: flex-start;[^}]*gap: 8px;/)
  assert.match(style, /\.chat-panel__history-close[^}]*margin-left: auto;/)
})
