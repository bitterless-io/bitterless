import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temp = mkdtempSync(join(root, '.chat-escape-test-'))
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><input id="outside"></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost'
})
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true })
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
let focused = true
let visibility = 'visible'
document.hasFocus = () => focused
Object.defineProperty(document, 'visibilityState', { get: () => visibility })
// JSDOM has no layout. Supply only browser geometry/focus boundaries, leaving the
// compiled component, Vue events, Arco controls and message/channel stores real.
dom.window.HTMLElement.prototype.getClientRects = function () {
  for (let element = this; element; element = element.parentElement) {
    if (element.hidden || getComputedStyle(element).display === 'none') return []
  }
  return this.isConnected ? [{ width: 100, height: 30 }] : []
}
const harness = { aborts: [], pending: [], sends: [], pendingSends: [], saved: [] }
globalThis.__chatEscapeHarness = harness

await build({
  stdin: {
    contents: `
      export { default as ChatPanel } from './src/renderer/maestro/control/src/ChatPanel.vue'
      export { messageStore } from './src/renderer/maestro/control/src/store/message.store'
      export { channelStore } from './src/renderer/maestro/control/src/store/channel.store'
    `,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: join(temp, 'chat.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  tsconfig: join(root, 'tsconfig.web.json'),
  loader: { '.less': 'empty' },
  plugins: [{
    name: 'chat-component-harness',
    setup(api) {
      api.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({ path: 'xpc', namespace: 'chat-test' }))
      api.onLoad({ filter: /.*/, namespace: 'chat-test' }, () => ({
        contents: `
          export const xpcRenderer = { subscribe() {}, broadcast() {} }
          export const createXpcRendererEmitter = () => new Proxy({}, {
            get: (_, method) => async (params) => {
              const harness = globalThis.__chatEscapeHarness
              if (method === 'abortAgent') {
                harness.aborts.push(params)
                return new Promise((resolve, reject) => harness.pending.push({ resolve, reject }))
              }
              if (method === 'sendAgentMessage') {
                harness.sends.push(params)
                return new Promise(resolve => harness.pendingSends.push(resolve))
              }
              if (method === 'saveSession') harness.saved.push(params.session)
              if (method === 'listSessions') return []
              return { ok: true }
            }
          })
        `,
        loader: 'js'
      }))
      api.onLoad({ filter: /MessageItem\.vue$/ }, () => ({
        contents: `export default { render: () => null }`,
        loader: 'js'
      }))
      api.onLoad({ filter: /\.vue$/ }, ({ path }) => {
        const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
        assert.deepEqual(errors, [])
        return {
          contents: compileScript(descriptor, { id: 'chat-escape-test', inlineTemplate: true }).content,
          loader: 'ts',
          resolveDir: dirname(path)
        }
      })
    }
  }]
})

const { createApp, h, nextTick } = await import('vue')
const { Message } = await import('@arco-design/web-vue')
const { ChatPanel, messageStore, channelStore } = await import(pathToFileURL(join(temp, 'chat.mjs')).href)
let app
const flush = async () => {
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  await nextTick()
}
const mount = async ({ busy = true, aborting = false } = {}) => {
  messageStore.sessions = []
  messageStore.historySessions = []
  harness.aborts = []
  harness.saved = []
  harness.sends = []
  focused = true
  visibility = 'visible'
  const created = messageStore.createSession({ title: 'Current', intent: 'chat', operationTabId: 'tab-current' })
  const session = messageStore.getSession(created.id)
  const background = messageStore.createSession({ title: 'Background', intent: 'chat', operationTabId: 'tab-background' })
  Object.assign(session, { busy, aborting, activeTurnId: 'turn-current' })
  Object.assign(background, { busy: true, activeTurnId: 'turn-background' })
  session.messages.push({ id: 'human', source: 'cowork', role: 'human', content: 'Question', streaming: false, ts: 1 })
  session.messages.push({ id: 'answer', source: 'cowork', role: 'ai', content: 'Partial reply', streaming: true, ts: 2 })
  messageStore.globalBusySessionId = session.id
  channelStore.activeSource = 'cowork'
  channelStore.currentOperationTabId = 'tab-current'
  channelStore.maestroSessionByTabId = { 'tab-current': session.id, 'tab-background': background.id }
  app = createApp({ render: () => h(ChatPanel, { session }) })
  app.mount('#app')
  await flush()
  return { session, background }
}
const escape = (options = {}, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options })
  target.dispatchEvent(event)
  return event
}
const finishStop = async () => {
  for (const pending of harness.pending.splice(0)) pending.resolve()
  await flush()
}
afterEach(async () => {
  await finishStop()
  for (const resolve of harness.pendingSends.splice(0)) resolve({ ok: false, text: '', error: 'test finished', ts: Date.now() })
  Message.clear()
  app?.unmount()
  app = undefined
  for (const overlay of document.querySelectorAll('[data-test-overlay]')) overlay.remove()
  await flush()
})
after(() => {
  dom.window.close()
  rmSync(temp, { recursive: true, force: true })
  delete globalThis.__chatEscapeHarness
})

test('Escape from body after the composer disables has the same stop/persistence effect as clicking Stop', async () => {
  for (const action of ['keyboard', 'click']) {
    const { session, background } = await mount()
    assert.equal(document.querySelector('textarea').disabled, true)
    const button = document.querySelector('.chat-panel__stop-button')
    assert.equal(button.disabled, false)
    if (action === 'keyboard') assert.equal(escape().defaultPrevented, true)
    else button.click()
    assert.deepEqual(harness.aborts, [{ sessionId: session.id }])
    assert.equal(session.aborting, true)
    await flush()
    assert.equal(button.disabled, true)
    assert.equal(escape().defaultPrevented, false)
    button.click()
    assert.equal(harness.aborts.length, 1)
    await finishStop()
    assert.equal(session.busy, false)
    assert.equal(session.aborting, false)
    assert.equal(session.activeTurnId, undefined)
    assert.equal(session.messages.at(-1).content, 'Partial reply')
    assert.equal(session.messages.at(-1).streaming, false)
    assert.equal(harness.saved.at(-1).messages.at(-1).content, 'Partial reply')
    assert.equal(background.busy, true)
    assert.equal(background.activeTurnId, 'turn-background')
    app.unmount()
    app = undefined
    await flush()
  }
})

test('hidden and disabled Stop leave Escape untouched', async () => {
  for (const state of [{ busy: false }, { aborting: true }]) {
    await mount(state)
    assert.equal(escape().defaultPrevented, false)
    assert.equal(harness.aborts.length, 0)
    app.unmount()
    app = undefined
    await flush()
  }
})

test('modifiers, repeat, IME and already-handled keys never invoke Stop', async () => {
  await mount()
  for (const options of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { key: 'Enter' }]) {
    assert.equal(escape(options).defaultPrevented, false)
  }
  const handled = event => event.preventDefault()
  document.body.addEventListener('keydown', handled, { once: true })
  escape()
  assert.equal(harness.aborts.length, 0)
})

test('blurred/hidden native view, another channel/session and outside focus do not stop this chat', async () => {
  await mount()
  focused = false
  assert.equal(escape().defaultPrevented, false)
  focused = true
  visibility = 'hidden'
  assert.equal(escape().defaultPrevented, false)
  visibility = 'visible'
  channelStore.activeSource = 'connector'
  assert.equal(escape().defaultPrevented, false)
  channelStore.activeSource = 'cowork'
  channelStore.currentOperationTabId = 'tab-background'
  assert.equal(escape().defaultPrevented, false)
  channelStore.currentOperationTabId = 'tab-current'
  const outside = document.querySelector('#outside')
  outside.focus()
  assert.equal(escape({}, outside).defaultPrevented, false)
  const panel = document.querySelector('.chat-panel')
  panel.hidden = true
  assert.equal(escape().defaultPrevented, false)
  panel.hidden = false
  assert.equal(harness.aborts.length, 0)
})

test('focused chat controls can stop without moving focus', async () => {
  const { session } = await mount()
  const button = document.querySelector('.chat-panel__stop-button')
  button.focus()
  assert.equal(escape({}, button).defaultPrevented, true)
  assert.equal(document.activeElement, button)
  assert.deepEqual(harness.aborts, [{ sessionId: session.id }])
})

test('history Drawer consumes Escape without stopping and the next Escape can stop', async () => {
  await mount()
  document.querySelector('[name="maestro__history"]').click()
  await flush()
  assert.ok(document.querySelector('.arco-drawer'))
  assert.equal(escape().defaultPrevented, false)
  assert.equal(harness.aborts.length, 0)
  await flush()
  // Arco keeps the closing drawer mounted until its transition completes.
  for (const drawer of document.querySelectorAll('.arco-drawer')) drawer.dispatchEvent(new Event('transitionend', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 350))
  await flush()
  assert.equal(escape().defaultPrevented, true)
  assert.equal(harness.aborts.length, 1)
})

test('visible dialogs, menus and model popups retain Escape; hidden overlays and tooltips do not block Stop', async () => {
  await mount()
  for (const html of ['<div class="arco-modal"></div>', '<div role="dialog"></div>', '<div role="menu"></div>', '<div role="listbox"></div>', '<div class="arco-trigger-popup"><div class="arco-trigger-popup-wrapper"></div></div>']) {
    const overlay = document.createElement('div')
    overlay.dataset.testOverlay = ''
    overlay.innerHTML = html
    document.body.append(overlay)
    assert.equal(escape().defaultPrevented, false)
    assert.equal(harness.aborts.length, 0)
    overlay.remove()
  }
  const hidden = document.createElement('div')
  hidden.dataset.testOverlay = ''
  hidden.innerHTML = '<div role="dialog" style="display:none"></div><div class="arco-trigger-popup arco-tooltip"><div class="arco-trigger-popup-wrapper"></div></div>'
  document.body.append(hidden)
  assert.equal(escape().defaultPrevented, true)
  assert.equal(harness.aborts.length, 1)
})

test('unmount removes the listener before another chat receives Escape', async () => {
  await mount()
  app.unmount()
  app = undefined
  assert.equal(escape().defaultPrevented, false)
  assert.equal(harness.aborts.length, 0)
})

test('Stop stays busy and disabled beyond 900ms until the native receipt, including after a session switch', async () => {
  const { session, background } = await mount()
  escape()
  channelStore.currentOperationTabId = 'tab-background'
  await new Promise(resolve => setTimeout(resolve, 950))
  await flush()
  const beforeReceipt = { busy: session.busy, aborting: session.aborting, streaming: session.messages.at(-1).streaming }
  assert.deepEqual(beforeReceipt, { busy: true, aborting: true, streaming: true })
  assert.equal(document.querySelector('.chat-panel__stop-button').disabled, true)
  await finishStop()
  assert.deepEqual(beforeReceipt, { busy: true, aborting: true, streaming: true })
  assert.equal(session.busy, false)
  assert.equal(session.messages.at(-1).content, 'Partial reply')
  assert.equal(background.busy, true)
  assert.equal(background.activeTurnId, 'turn-background')
  assert.deepEqual(harness.aborts, [{ sessionId: session.id }])
})

test('native Stop rejection exposes an error and leaves the same turn retryable with its partial reply', async () => {
  const { session } = await mount()
  escape()
  harness.pending.shift().reject(new Error('native cleanup failed'))
  await flush()
  assert.equal(session.busy, true)
  assert.equal(session.aborting, false)
  assert.equal(session.activeTurnId, 'turn-current')
  assert.equal(session.messages.at(-1).content, 'Partial reply')
  assert.equal(document.querySelector('.chat-panel__stop-button').disabled, false)
  assert.match(document.body.textContent, /Could not stop.*native cleanup failed/)
  escape()
  assert.equal(harness.aborts.length, 2)
  await finishStop()
  assert.equal(session.busy, false)
  assert.equal(session.messages.at(-1).content, 'Partial reply')
})

for (const first of ['model reply', 'Stop receipt']) {
  test(`real send preserves Stop ownership and partial text when ${first} arrives first`, async () => {
    const { session, background } = await mount({ busy: false })
    session.activeTurnId = undefined
    session.messages.at(-1).streaming = false
    messageStore.globalBusySessionId = ''
    const sending = messageStore.send(session.id, 'New request')
    await flush()
    assert.equal(harness.pendingSends.length, 1)
    messageStore.pushStream({ sessionId: session.id, delta: 'Live partial reply' })
    await new Promise(resolve => setTimeout(resolve, 25))
    escape()
    await flush()
    const reply = () => harness.pendingSends.shift()({ ok: false, text: 'late cancellation result', error: 'cancelled', ts: Date.now() })
    if (first === 'model reply') {
      reply()
      await sending
      await flush()
      assert.equal(session.busy, true)
      assert.equal(session.aborting, true)
      assert.equal(document.querySelector('.chat-panel__stop-button').disabled, true)
      assert.equal(await messageStore.send(session.id, 'overlap'), null)
      channelStore.currentOperationTabId = 'tab-background'
      await finishStop()
    } else {
      await finishStop()
      channelStore.currentOperationTabId = 'tab-background'
      reply()
      await sending
    }
    assert.equal(session.busy, false)
    assert.equal(session.aborting, false)
    assert.equal(session.messages.at(-1).content, 'Live partial reply')
    assert.equal(session.messages.at(-1).streaming, false)
    assert.equal(harness.saved.at(-1).messages.at(-1).content, 'Live partial reply')
    assert.equal(background.busy, true)
    assert.equal(background.activeTurnId, 'turn-background')
  })
}

test('a late real send reply after Stop failure cannot clear the retryable original turn', async () => {
  const { session, background } = await mount({ busy: false })
  session.activeTurnId = undefined
  session.messages.at(-1).streaming = false
  messageStore.globalBusySessionId = ''
  const sending = messageStore.send(session.id, 'New request')
  await flush()
  messageStore.pushStream({ sessionId: session.id, delta: 'Retain this partial reply' })
  await new Promise(resolve => setTimeout(resolve, 25))
  const turnId = session.activeTurnId
  escape()
  harness.pending.shift().reject(new Error('native cleanup failed'))
  await flush()
  channelStore.currentOperationTabId = 'tab-background'
  harness.pendingSends.shift()({ ok: false, text: 'late cancellation result', error: 'cancelled', ts: Date.now() })
  await sending
  await flush()
  assert.equal(session.busy, true)
  assert.equal(session.aborting, false)
  assert.equal(session.activeTurnId, turnId)
  assert.equal(session.messages.at(-1).content, 'Retain this partial reply')
  assert.equal(messageStore.globalBusySessionId, session.id)
  assert.equal(document.querySelector('.chat-panel__stop-button').disabled, false)
  assert.equal(background.activeTurnId, 'turn-background')
  channelStore.currentOperationTabId = 'tab-current'
  escape()
  assert.deepEqual(harness.aborts, [{ sessionId: session.id }, { sessionId: session.id }])
  await finishStop()
  assert.equal(session.busy, false)
  assert.equal(session.messages.at(-1).content, 'Retain this partial reply')
  assert.equal(background.busy, true)
})
