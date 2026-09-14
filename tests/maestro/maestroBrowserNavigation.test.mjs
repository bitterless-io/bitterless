import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const bundle = await build({
  entryPoints: [resolve(root, 'src/main/maestro/drive/browserNavigation.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node'
})
const { navigateAgentBrowser } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function surface() {
  const wc = new EventEmitter()
  Object.assign(wc, {
    url: 'https://example.com/wrong', title: 'Wrong page', destroyed: false, crashed: false, loading: false,
    backAvailable: true, forwardAvailable: false, calls: [],
    isDestroyed: () => wc.destroyed, isCrashed: () => wc.crashed,
    isLoadingMainFrame: () => wc.loading,
    getURL: () => wc.url, getTitle: () => wc.title,
    navigate: action => wc.calls.push(action)
  })
  wc.navigationHistory = {
    canGoBack: () => wc.backAvailable, canGoForward: () => wc.forwardAvailable,
    goBack: () => wc.navigate('back'), goForward: () => wc.navigate('forward')
  }
  wc.reload = () => wc.navigate('reload')
  return wc
}

const assertClean = wc => assert.deepEqual(wc.eventNames(), [], 'all navigation listeners were removed')

test('where reports exact ID, URL, title and native history without an action', async () => {
  const wc = surface()
  assert.deepEqual(JSON.parse(await navigateAgentBrowser(wc, 'tab-a', 'where')), {
    ok: true, tab_id: 'tab-a', action: 'where', url: wc.url, title: wc.title, can_go_back: true, can_go_forward: false
  })
  assert.deepEqual(wc.calls, [])
  assertClean(wc)
})

test('back invokes one native history step with listeners registered before synchronous completion', async () => {
  const wc = surface()
  wc.navigate = action => {
    wc.calls.push(action)
    assert(wc.listenerCount('did-finish-load') > 0)
    assert(wc.listenerCount('did-fail-load') > 0)
    wc.emit('did-start-navigation', { isMainFrame: true })
    wc.url = 'https://example.com/previous'
    wc.title = 'Previous page'
    wc.backAvailable = false
    wc.forwardAvailable = true
    wc.emit('did-finish-load')
  }
  const result = JSON.parse(await navigateAgentBrowser(wc, 'tab-a', 'back'))
  assert.equal(result.url, 'https://example.com/previous')
  assert.equal(result.title, 'Previous page')
  assert.equal(result.can_go_forward, true)
  assert.deepEqual(wc.calls, ['back'])
  assertClean(wc)
})

test('same-document history completes synchronously without a load cycle', async () => {
  const wc = surface()
  wc.navigate = action => {
    wc.calls.push(action)
    wc.url = 'https://example.com/#previous'
    wc.emit('did-navigate-in-page', {}, wc.url, true)
  }
  assert.equal(JSON.parse(await navigateAgentBrowser(wc, 'tab-a', 'back')).url, 'https://example.com/#previous')
  assert.deepEqual(wc.calls, ['back'])
  assertClean(wc)
})

test('history restoration can complete after commit and stop-loading without another load event', async () => {
  const wc = surface()
  wc.navigate = () => {
    wc.emit('did-start-navigation', { isMainFrame: true })
    wc.url = 'https://example.com/restored'
    wc.emit('did-navigate', {}, wc.url)
    wc.emit('did-stop-loading')
  }
  assert.equal(JSON.parse(await navigateAgentBrowser(wc, 'tab-a', 'back')).url, wc.url)
  assertClean(wc)
})

test('subframe and unrelated load events cannot confirm a main-frame history action', async () => {
  const wc = surface()
  let settled = false
  const navigation = navigateAgentBrowser(wc, 'tab-a', 'back').then(value => { settled = true; return value })
  wc.emit('did-finish-load')
  wc.emit('did-navigate-in-page', {}, 'https://frame.example', false)
  wc.emit('did-fail-load', {}, -2, 'Subframe error', 'https://frame.example', false)
  await Promise.resolve()
  assert.equal(settled, false)
  wc.emit('did-start-navigation', { isMainFrame: true })
  wc.url = 'https://example.com/previous'
  wc.emit('did-finish-load')
  assert.equal(JSON.parse(await navigation).url, wc.url)
  assertClean(wc)
})

test('main-frame navigation failure is not reported as a completed back', async () => {
  const wc = surface()
  wc.navigate = () => {
    wc.emit('did-start-navigation', { isMainFrame: true })
    wc.emit('did-navigate', {}, 'https://bad.example')
    wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://bad.example', true)
    wc.emit('did-stop-loading')
    wc.emit('did-finish-load')
  }
  await assert.rejects(navigateAgentBrowser(wc, 'tab-a', 'back'), /Tab tab-a: back navigation failed.*ERR_NAME_NOT_RESOLVED/)
  assertClean(wc)
})

test('navigation timeout is an explicit failure and removes every listener', async () => {
  const wc = surface()
  await assert.rejects(navigateAgentBrowser(wc, 'tab-a', 'back', 5), /Tab tab-a: back navigation failed.*timed out/)
  assert.deepEqual(wc.calls, ['back'])
  assertClean(wc)
})

for (const state of ['crashed', 'destroyed']) {
  test(`${state} during navigation rejects and removes listeners`, async () => {
    const wc = surface()
    wc.navigate = () => {
      wc[state] = true
      if (state === 'crashed') wc.emit('render-process-gone', {}, { reason: 'crashed' })
      else wc.emit('destroyed')
    }
    await assert.rejects(navigateAgentBrowser(wc, 'tab-a', 'back'), new RegExp(`Tab tab-a: back navigation failed.*${state}`))
    assertClean(wc)
  })
  test(`${state} before navigation never starts a history action`, async () => {
    const wc = surface()
    wc[state] = true
    await assert.rejects(navigateAgentBrowser(wc, 'tab-a', 'back'), new RegExp(state))
    assert.deepEqual(wc.calls, [])
    assertClean(wc)
  })
}

for (const direction of ['back', 'forward']) {
  test(`no ${direction} entry is an error, not a silent successful no-op`, async () => {
    const wc = surface()
    wc.backAvailable = false
    await assert.rejects(navigateAgentBrowser(wc, 'tab-a', direction), new RegExp(`no ${direction} entry`))
    assert.deepEqual(wc.calls, [])
    assertClean(wc)
  })
}

test('synchronous native history errors clean up listeners', async () => {
  const wc = surface()
  wc.navigate = () => { throw new Error('Navigation rejected') }
  await assert.rejects(navigateAgentBrowser(wc, 'tab-a', 'back'), /Tab tab-a: back navigation failed.*Navigation rejected/)
  assertClean(wc)
})

test('forward and reload retain the same bounded completion contract', async () => {
  for (const action of ['forward', 'reload']) {
    const wc = surface()
    wc.forwardAvailable = true
    wc.navigate = value => {
      wc.calls.push(value)
      wc.emit('did-start-navigation', { isMainFrame: true })
      wc.emit('did-finish-load')
    }
    assert.equal(JSON.parse(await navigateAgentBrowser(wc, 'tab-a', action)).action, action)
    assert.deepEqual(wc.calls, [action])
    assertClean(wc)
  }
})
