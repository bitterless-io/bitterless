// 别名表单这一层的生命周期:预建预载、挂上就显、失败当场收场。
// 契约:docs/features/tab-alias.md #2.1 · docs/issues/maestro-tab-alias-does-nothing.md
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
function actualMembers(path, names, bindings = {}) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]).filter(node => names.includes(node.name?.getText(source)))
  assert.equal(found.length, names.length)
  const output = ts.transpileModule(`class Actual { ${found.map(node => node.getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${output}; return Actual`)(...Object.values(bindings))
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

let built = []
class FakeWebContentsView {
  constructor() {
    this.visible = null
    this.bounds = { x: 0, y: 0, width: 0, height: 0 }
    this.background = null
    const listeners = new Map()
    this.webContents = {
      destroyed: false,
      focused: 0,
      loads: [],
      isDestroyed() { return this.destroyed },
      focus() { this.focused += 1 },
      close() { this.destroyed = true },
      on(event, handler) { listeners.set(event, handler) },
      emit(event, ...args) { listeners.get(event)?.(...args) },
      loadURL: url => this.enqueue(url),
      loadFile: file => this.enqueue(file)
    }
    built.push(this)
  }
  enqueue(target) {
    this.webContents.loads.push(target)
    this.pending = deferred()
    return this.pending.promise
  }
  setVisible(value) { this.visible = value }
  setBounds(bounds) { this.bounds = { ...bounds } }
  getBounds() { return { ...this.bounds } }
  setBackgroundColor(color) { this.background = color }
}

const Service = actualMembers('src/main/maestro/windows/main/maestroTabAliasView.service.ts', [
  'preload', 'requestAlias', 'snapshot', 'resolveDialog', 'setBounds', 'reset', 'present', 'ensureView', 'failOpen', 'attach', 'detach', 'publish'
], {
  WebContentsView: FakeWebContentsView,
  join: (...parts) => parts.join('/'),
  __dirname: '/app/out/main',
  is: { dev: false },
  randomUUID: () => `dialog-${built.length}-${Math.random().toString(16).slice(2)}`,
  MAESTRO_PARTITION: 'persist:maestro',
  MAESTRO_TAB_ALIAS_MAX_LENGTH: 64,
  MAESTRO_TAB_ALIAS_STATE_EVENT: 'coach/tab-alias-state',
  xpcMain: { broadcast() {} }
})

function fixture(context) {
  built = []
  const traces = []
  const children = []
  const service = new Service()
  const win = {
    isDestroyed: () => false,
    contentView: {
      addChildView(view) { const at = children.indexOf(view); if (at >= 0) children.splice(at, 1); children.push(view) },
      removeChildView(view) { const at = children.indexOf(view); if (at >= 0) children.splice(at, 1) }
    }
  }
  Object.assign(service, {
    view: null, bounds: null, ready: false, attached: false, unavailable: false, revision: 0, dialog: null, settle: null,
    applyBounds: (view, rect) => { if (view) view.setBounds(rect) },
    _state: {
      browserWindow: win,
      opBounds: { x: 0, y: 78, width: 880, height: 722 },
      layout() { this.layouts = (this.layouts || 0) + 1 },
      emitTrace: event => traces.push(event)
    }
  })
  context.after(() => { built = [] })
  return { service, traces, children, view: () => built[0] }
}

test('the layer is preloaded at window open, then one request attaches and shows it', async context => {
  const { service, children, view } = fixture(context)
  service.preload()
  assert.equal(built.length, 1, '开窗时就建好,不等到点 Alias… 那一刻')
  assert.deepEqual(view().webContents.loads, ['/app/out/main/../renderer/maestro/tabAlias/index.html'])
  assert.equal(view().visible, false, '没有对话框时既不挂也不可见')
  assert.equal(children.length, 0)

  const answer = service.requestAlias({ tabLabel: 'Example', alias: '' })
  view().pending.resolve()
  await flush()
  assert.equal(children.at(-1), view(), '挂在最上面')
  assert.equal(view().visible, true)
  assert.deepEqual(view().getBounds(), { x: 0, y: 78, width: 880, height: 722 }, '取操作区矩形,不是整窗')
  assert.equal(service.snapshot().dialog.tabLabel, 'Example')

  service.resolveDialog({ dialogId: service.snapshot().dialog.dialogId, outcome: 'confirm', value: 'R'.repeat(80) })
  assert.equal(await answer, 'R'.repeat(64), '长度上限在这一侧也钳一次(shared 常量 / 表单 maxlength / 这里,三处)')
  assert.equal(children.length, 0, '答完就摘掉 —— 挂着的透明全矩形是点击黑洞')
  assert.equal(view().visible, false)
  assert.equal(built.length, 1, '渲染进程留着,下一次弹窗是即时的')
})

test('cancel leaves the alias untouched and an empty confirm is a deletion', async context => {
  const { service, view } = fixture(context)
  service.preload()
  view().pending.resolve()
  await flush()

  const cancelled = service.requestAlias({ tabLabel: 'Example', alias: 'Reports' })
  await flush()
  service.resolveDialog({ dialogId: service.snapshot().dialog.dialogId, outcome: 'cancel' })
  assert.equal(await cancelled, null, 'null = 一个字都不改')

  const cleared = service.requestAlias({ tabLabel: 'Example', alias: 'Reports' })
  await flush()
  service.resolveDialog({ dialogId: service.snapshot().dialog.dialogId, outcome: 'confirm', value: '' })
  assert.equal(await cleared, '', '空串是删除,不是取消')
})

test('a failed load answers the pending request instead of hanging the feature forever', async context => {
  const { service, traces, view } = fixture(context)
  const answer = service.requestAlias({ tabLabel: 'Example', alias: '' })
  view().pending.reject(new Error('ERR_FILE_NOT_FOUND'))
  assert.equal(await answer, null, '起不来 ⇒ 按「什么都不改」收场')

  const second = service.requestAlias({ tabLabel: 'Example', alias: '' })
  assert.equal(await second, null, '之后每一次都立刻答复,不再挂在没人结的 Promise 上')
  assert.ok(traces.some(event => event.msg.includes('tab alias load:')), '失败要留痕')
  assert.ok(traces.some(event => event.msg.includes('unavailable')), '之后每一次点击也要留痕')
})

test('a dead renderer settles the open dialog and detaches the layer', async context => {
  const { service, children, view } = fixture(context)
  service.preload()
  view().pending.resolve()
  await flush()
  const answer = service.requestAlias({ tabLabel: 'Example', alias: '' })
  await flush()
  assert.equal(children.length, 1)

  view().webContents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.equal(await answer, null)
  assert.equal(children.length, 0, '崩了要摘掉 —— 留着就是一个隐形的点击黑洞')
})

test('a request with no measured rect asks for a layout instead of stalling on gate=bounds', async context => {
  const { service, view } = fixture(context)
  service._state.opBounds = null
  service.preload()
  view().pending.resolve()
  await flush()
  service.requestAlias({ tabLabel: 'Example', alias: '' })
  assert.ok(service._state.layouts >= 1, '没有矩形就先催一次布局')
})

test('the dialog renderer mounts without a dynamic import', () => {
  const entry = read('src/renderer/maestro/tabAlias/src/tabAlias.ts')
  assert.match(entry, /^import TabAliasApp from '\.\/TabAliasApp\.vue'$/m)
  assert.doesNotMatch(
    entry,
    /await import\(['"]\.\/TabAliasApp\.vue['"]\)/,
    '打包后动态 import 要过 Vite 的 __vitePreload,它在 file:// ＋ CSP 下会把整个挂载抛掉,' +
      '而主进程那边 loadFile 早已 resolve —— 症状是一张什么都没画的透明覆盖层'
  )
})
