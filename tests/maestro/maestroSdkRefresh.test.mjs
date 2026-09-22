// `MAESTROSDK` 的刷新两回调 —— 契约:docs/features/maestro-sdk-refresh-events.md
//
// 两侧都跑**真实实现**:main 侧是 `MaestroBrowserViewService.reload()` 那条分支,渲染侧是
// `src/preload/maestroSdk/index.ts` 整个模块。用桩替掉任何一段,「广播发给了谁」和
// 「谁该忽略它」就都测不到了 —— 而那正是这个设计里唯一容易错的地方。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

function actualMembers(path, names, bindings = {}) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
  const found = source.statements
    .filter(ts.isClassDeclaration)
    .flatMap((node) => [...node.members])
    .filter((node) => names.includes(node.name?.getText(source)))
  assert.equal(found.length, names.length, `missing one of ${names.join(', ')}`)
  const output = ts.transpileModule(
    `class Actual { ${found.map((node) => node.getText(source)).join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  return new Function(...Object.keys(bindings), `${output}; return Actual`)(...Object.values(bindings))
}

const MAESTRO_SDK_REFRESH_EVENT = 'maestro/sdk-refresh'

// ── main 侧 ────────────────────────────────────────────────────────────────────
const mainFixture = ({ composite }) => {
  const broadcasts = []
  const touched = []
  const Browser = actualMembers(
    'src/main/maestro/windows/main/maestroBrowserView.service.ts',
    ['reload', 'broadcastSdkRefresh', 'getActiveTab'],
    {
      xpcMain: { broadcast: (event, params) => broadcasts.push({ event, params }) },
      MAESTRO_SDK_REFRESH_EVENT
    }
  )
  const tab = {
    id: 'tab-1',
    instanceId: 'instance-a',
    kind: composite ? 'zellij' : 'browser',
    url: 'https://example.com/',
    navigationStarted: true,
    get view() {
      touched.push('view')
      return { webContents: { isDestroyed: () => false, reload: () => touched.push('reload') } }
    }
  }
  const service = new Browser()
  Object.assign(service, {
    tabs: [tab],
    activeTabId: tab.id,
    compositeTabs: new Map(composite ? [[tab.id, {}]] : []),
    warmAndLoad: async () => touched.push('warmAndLoad'),
    _state: { emitTrace() {} }
  })
  return { service, tab, broadcasts, touched }
}

test('刷新一个 composite miniapp tab:只发两条事件,一个 view 都不碰', async () => {
  const h = mainFixture({ composite: true })
  await h.service.reload()
  assert.deepEqual(
    h.broadcasts.map((entry) => [entry.event, entry.params.instanceId, entry.params.phase]),
    [
      [MAESTRO_SDK_REFRESH_EVENT, 'instance-a', 'before'],
      [MAESTRO_SDK_REFRESH_EVENT, 'instance-a', 'refresh']
    ],
    'before 必须在 refresh 之前,且带的是这个 tab 的 instanceId'
  )
  // 这一条同时守着 #0.1 那个既有缺陷:composite tab 没有 `tab.view`,原来会落进 warmAndLoad →
  // ensureWarm,给 mini app 套一层浏览器 view slot 再拿 tab.url 去导航。
  assert.deepEqual(h.touched, [], '既不取 view,也不 warmAndLoad —— 宿主对 composite tab 什么都不做')
})

test('普通网页 tab 的刷新一字不变:不发事件,照常 reload', async () => {
  const h = mainFixture({ composite: false })
  await h.service.reload()
  assert.deepEqual(h.broadcasts, [], 'SDK 根本不注入普通网页 tab,发了就是噪音')
  assert.ok(h.touched.includes('reload'), '还是走 webContents.reload()')
})

// ── 渲染(preload)侧 ─────────────────────────────────────────────────────────
const sdkFixture = ({ argv, answer = true }) => {
  const logs = []
  const confirmCalls = []
  let deliver = () => {}
  let exposed = null
  let handlerName = null
  const confirmAnswer = answer
  const source = ts.transpileModule(read('src/preload/maestroSdk/index.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const require_ = (id) => {
    if (id === 'electron') {
      return { contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'MAESTROSDK'); exposed = value } } }
    }
    if (id === 'electron-xpc/preload') {
      return {
        xpcRenderer: { subscribe: (event, cb) => { assert.equal(event, MAESTRO_SDK_REFRESH_EVENT); deliver = cb } },
        // 真实的 emitter 按 handler 名找 main；这里记下名字与调用，证明两仓用的是同一个字符串。
        createXpcPreloadEmitter: (name) => {
          handlerName = name
          return { confirm: async (params) => { confirmCalls.push(params); return confirmAnswer } }
        }
      }
    }
    // 真实模块:身份解析的规则本身也要被测到,不能在这儿抄一份。
    if (id.includes('maestroSdk.api')) {
      const api = ts.transpileModule(read('src/shared/maestroSdk.api.ts'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText
      const mod = { exports: {} }
      new Function('exports', api)(mod.exports)
      return mod.exports
    }
    throw new Error(`unexpected require: ${id}`)
  }
  new Function('require', 'exports', 'process', 'console', source)(
    require_,
    {},
    { argv },
    { error: (...args) => logs.push(args.join(' ')) }
  )
  return {
    sdk: exposed,
    send: (instanceId, phase) => deliver({ params: { instanceId, phase } }),
    logs,
    confirmCalls,
    handlerName: () => handlerName
  }
}

const withInstance = (id = 'instance-a', answer = true) =>
  sdkFixture({ argv: ['electron', `--maestro-instance-id=${id}`], answer })

test('只跑发给自己那个 tab 的事件', () => {
  const h = withInstance()
  const seen = []
  h.sdk.beforeRefresh(() => seen.push('before'))
  h.sdk.onRefresh(() => seen.push('refresh'))

  h.send('instance-b', 'before')
  h.send('instance-b', 'refresh')
  assert.deepEqual(seen, [], '别的 tab 的刷新与我无关 —— 广播是发给所有订阅者的,过滤是这一层的职责')

  h.send('instance-a', 'before')
  h.send('instance-a', 'refresh')
  assert.deepEqual(seen, ['before', 'refresh'])
})

test('没拿到身份的 view 一条都不跑,绝不替别人刷新', () => {
  const h = sdkFixture({ argv: ['electron'] })
  let fired = 0
  h.sdk.onRefresh(() => { fired += 1 })
  h.send('instance-a', 'refresh')
  assert.equal(fired, 0, '宁可收不到,也不能在别的 tab 刷新时误触发(建 view 时没摊 rendererArguments)')
})

test('注册返回的函数取消之后不再收到', () => {
  const h = withInstance()
  let fired = 0
  const off = h.sdk.onRefresh(() => { fired += 1 })
  h.send('instance-a', 'refresh')
  off()
  h.send('instance-a', 'refresh')
  assert.equal(fired, 1, '组件挂载/卸载多次,没有取消口第二次挂载就双跑')
})

test('一个 handler 抛异常,不影响同一轮的其它 handler,也不影响下一个 phase', () => {
  const h = withInstance()
  const seen = []
  h.sdk.beforeRefresh(() => { throw new Error('boom') })
  h.sdk.beforeRefresh(() => seen.push('before-2'))
  h.sdk.onRefresh(() => seen.push('refresh'))
  h.send('instance-a', 'before')
  h.send('instance-a', 'refresh')
  assert.deepEqual(seen, ['before-2', 'refresh'], '别人的 bug 不该把刷新这条链掐断')
  assert.equal(h.logs.length, 1, '吞掉但要留一行')
  assert.match(h.logs[0], /\[maestro-sdk\] beforeRefresh handler failed/)
})

test('三个 miniapp 的 preload 都引了这一份 —— 漏了就是它自己没有 SDK', () => {
  for (const path of [
    'src/preload/zellij/zellij.preload.ts',
    'src/preload/trench/trench.preload.ts',
    'src/preload/onlypreview/onlypreview.preload.ts'
  ]) {
    assert.match(read(path), /import '@preload\/maestroSdk';/, path)
  }
})

test('confirm 把 instanceId 一起交给 main —— main 拿不到 sender,只能靠它认是谁在问', async () => {
  const h = withInstance('instance-a', true)
  assert.equal(h.handlerName(), 'MaestroSdkXpcHandler', '类名是契约的一部分,两仓必须一致')
  const answered = await h.sdk.confirm({ title: 'T', message: 'M', confirmLabel: 'Go' })
  assert.equal(answered, true)
  assert.deepEqual(h.confirmCalls, [{ instanceId: 'instance-a', title: 'T', message: 'M', confirmLabel: 'Go' }],
    '省掉的按钮文案不许变成空串传下去 —— 空串会盖掉宿主的默认文案')
})

test('没有身份 / 缺字段 / 通路断了,confirm 一律答 false,而不是抛', async () => {
  const noId = sdkFixture({ argv: ['electron'] })
  assert.equal(await noId.sdk.confirm({ title: 'T', message: 'M' }), false, 'main 认不出是谁在问')
  assert.deepEqual(noId.confirmCalls, [], '认不出就别去打扰 main')

  const h = withInstance()
  assert.equal(await h.sdk.confirm({ title: 'T' }), false, 'message 必填')
  assert.equal(await h.sdk.confirm(null), false)
  assert.deepEqual(h.confirmCalls, [])
  // 调用方的形状是 `if (await confirm(...))`,抛出去只会变成一条没人接的 rejection。
  assert.ok(noId.logs.some((line) => line.includes('[maestro-sdk] confirm ignored')))
})

test('人点取消 ⇒ false —— 默默替人答"是"才是危险的那一边', async () => {
  const h = withInstance('instance-a', false)
  assert.equal(await h.sdk.confirm({ title: 'T', message: 'M' }), false)
})

// 注入面不许分叉:同一个 mini-app 在两个宿主里必须只写一套代码,而那正是这个 SDK 存在的理由。
test('SDK 的契约与实现两仓逐字相同', () => {
  const sibling = resolve(root, '../micromeet-cowork/apps/cowork')
  if (!existsSync(sibling)) return   // 单仓检出时跳过,而不是假装通过
  for (const [mine, theirs] of [
    ['src/shared/maestroSdk.api.ts', 'src/shared/maestroSdk.api.ts'],
    ['src/preload/maestroSdk/index.ts', 'src/preload/maestroSdk/index.ts']
  ]) {
    assert.equal(read(mine), readFileSync(resolve(sibling, theirs), 'utf8'),
      `${mine} 与 micromeet-cowork 的那一份必须逐字相同`)
  }
})

// 报过一次:`dev:prod` 炸在 `Could not resolve "@preload/maestroSdk"`。
// 两个 sandbox preload(trench / onlypreview)走的是**独立的 esbuild 调用**,不吃 vite 的
// `resolve.alias`;typecheck 用的是 tsconfig 的 paths,看不见这里,所以只有打包时才炸。
test('独立 esbuild 的 preload 构建共用同一张别名表,且带 @preload', () => {
  const config = read('electron.vite.config.ts')
  const alias = config.match(/const maestroSdkPreloadAlias = \{[^}]+\}/)?.[0]
  assert.ok(alias, '别名表要是一份常量,而不是各 plugin 各写各的')
  for (const key of ["'@preload'", "'@shared'"]) {
    assert.ok(alias.includes(key), `别名表缺 ${key}`)
  }
  // 两个 sandbox plugin 都必须用它 —— 漏掉哪个,就是那个 mini-app 在打包版里构建失败。
  assert.equal((config.match(/alias: maestroSdkPreloadAlias/g) || []).length, 2)
})
