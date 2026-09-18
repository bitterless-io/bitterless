import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import ts from 'typescript'

// Execute the real methods with only native, persistence and host boundaries replaced.
// No Electron import, app launch, real directory access or renderer save queue is needed.
const root = resolve(import.meta.dirname, '../..')
const bitterless = existsSync(resolve(root, 'src/main/maestro'))
const mainFile = bitterless
  ? 'src/main/maestro/windows/main/workspaceFile.service.ts'
  : 'src/main/modules/window-manager/windows/main/workspaceFile.service.ts'
const renderer = bitterless ? 'src/renderer/maestro/control/src/' : 'src/renderer/control/src/'
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const parse = (path, source = read(path)) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
const methods = (path, names) => {
  const ast = parse(path)
  const owner = ast.statements.find((node) => ts.isClassDeclaration(node)
    && names.every((name) => node.members.some((member) => member.name?.getText(ast) === name)))
  assert.ok(owner, `${path}: class with requested methods exists`)
  return names.map((name) => owner.members.find((member) => member.name?.getText(ast) === name).getText(ast)).join('\n')
}
const evaluate = (source, bindings) => {
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} }
  vm.runInThisContext(`(function(module, exports, ${Object.keys(bindings).join(',')}) {\n${code}\n})`)(
    module, module.exports, ...Object.values(bindings)
  )
  return module.exports
}
const mainMethods = methods(mainFile, [
  'chooseWorkspaceDirectory', 'setWorkspaceDirectory', 'getWorkspaceDirectory',
  'toolWorkspaceContext', 'workspaceRefFromPath', 'readDefaultWorkspace',
  'readDefaultWorkspacePath', 'persistDefaultWorkspace', 'removeDefaultWorkspaceIfPathMatches',
  'broadcastWorkspaceChanged', 'clearWorkspaceRef', 'syncWorkspaceFromContext'
])
const rendererMethods = methods(renderer + 'store/message.store.ts', [
  'chooseWorkspace', 'refreshWorkspace', 'refreshDefaultWorkspace',
  'applyWorkspaceBroadcast', 'cloneWorkspace'
])
const panelAst = parse('ChatPanel.ts', read(renderer + 'ChatPanel.vue').match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1])
const panelChoose = panelAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'chooseWorkspace')
assert.ok(panelChoose, 'ChatPanel picker action exists')
const tick = () => new Promise((done) => setImmediate(done))
const deferred = () => {
  let finish, fail
  const promise = new Promise((done, reject) => { finish = done; fail = reject })
  return { promise, finish, fail }
}
const path = '/workspace/project'
const otherPath = '/workspace/second'
const fixture = (workspacePath = path) => ({ path: workspacePath, name: basename(workspacePath), exists: true, updatedAt: 1 })

const harness = () => {
  const h = {
    dialogResult: { canceled: false, filePaths: [path] }, dialogs: [], opens: [],
    events: [], saves: [], configValue: undefined, configWrites: [],
    missing: new Set(), files: new Set(), adapterAvailable: true,
    previewFailure: undefined, save: async () => true
  }
  const open = async (target) => {
    h.opens.push(target)
    assert.equal(h.main.workspaceRefs.get('session')?.path, target, 'bind before opening')
    assert.equal(h.configValue?.path, target, 'remember chosen workspace before opening')
    if (h.previewFailure) throw h.previewFailure
  }
  const { WorkspaceHarness } = evaluate(`export class WorkspaceHarness { ${mainMethods} }`, {
    dialog: { showOpenDialog: async (...args) => { h.dialogs.push(args); return h.dialogResult } },
    getNativeMessages: () => ({ chooseWorkspace: 'Choose workspace' }),
    isValidate: (window) => Boolean(window),
    resolve, workspaceNameForPath: (value) => basename(value) || value,
    statSync: (value) => {
      if (h.missing.has(value)) throw new Error('missing')
      return { isDirectory: () => !h.files.has(value) }
    },
    configStore: {
      get: async () => h.configValue ? { options: h.configValue } : null,
      upsert: async ({ options }) => { h.configValue = options; h.configWrites.push(options) },
      remove: async () => { h.configValue = undefined; h.configWrites.push(undefined) }
    },
    WORKSPACE_CONFIG_DOMAIN: 'workspace', WORKSPACE_DEFAULT_KEY: 'default',
    xpcMain: { broadcast: (name, value) => h.events.push({ name, value }) },
    getMaestroPreviewOpener: () => h.adapterAvailable ? { open } : undefined,
    openOnlyPreviewTarget: open
  })
  h.main = new WorkspaceHarness()
  h.main.workspaceRefs = new Map()
  h.main.defaultWorkspaceWrites = Promise.resolve()
  h.main._state = { browserWindow: {}, agentSessionKey: (sessionId) => sessionId || 'default' }
  const coach = {
    chooseWorkspaceDirectory: (params) => h.main.chooseWorkspaceDirectory(params),
    setWorkspaceDirectory: (params) => h.main.setWorkspaceDirectory(params),
    getWorkspaceDirectory: (params) => h.main.getWorkspaceDirectory(params),
    openWorkspaceInPreview: async ({ path: value }) => h.opens.push(value)
  }
  const { RendererHarness } = evaluate(`export class RendererHarness { ${rendererMethods} }`, { coach })
  h.store = new RendererHarness()
  h.store.authActive = true
  h.store.authGeneration = 0
  h.store.generation = 0
  h.store.workspaceSelectionGeneration = 0
  h.session = { id: 'session', detail: { retained: 'existing detail' }, updatedAt: 1 }
  h.store.getSession = (id) => id === h.session.id ? h.session : undefined
  h.store.persistSession = (session) => { h.saves.push(session); return h.save(session) }
  // Metadata-only saves go down their own lane now; for these tests "did it save" is the same
  // observable, so both lanes record identically.
  h.store.persistSessionMeta = (session) => { h.saves.push(session); return h.save(session) }
  h.store.persistMessages = (session) => { h.saves.push(session); return h.save(session) }
  // Old BL chooseWorkspace called its own wrapper; retain the boundary so duplicates fail by count.
  h.store.openWorkspaceInPreview = async (value) => h.opens.push(value)
  return h
}

test('Chat native choice binds, remembers and opens exactly once, and replacement opens the new path', async () => {
  const h = harness()
  const result = await h.store.chooseWorkspace('session')
  assert.equal(result.ok, true)
  assert.equal(result.previewError, undefined)
  assert.deepEqual(h.opens, [path])
  assert.equal(h.session.detail.workspace.path, path)
  assert.equal(h.session.detail.retained, 'existing detail')
  assert.equal(h.store.defaultWorkspace.path, path)
  assert.equal(h.saves.length, 1)
  h.dialogResult.filePaths = [otherPath]
  const replacement = await h.store.chooseWorkspace('session')
  assert.equal(replacement.workspace.path, otherPath)
  assert.deepEqual(h.opens, [path, otherPath])
  assert.equal(h.main.workspaceRefs.get('default').path, otherPath)
})

for (const action of ['choose', 'switch', 'set']) {
  test(`workspace_context ${action} uses the same native picker and single preview open`, async () => {
    const h = harness()
    const result = JSON.parse(await h.main.toolWorkspaceContext('session', action))
    assert.equal(result.ok, true)
    assert.equal(result.action, 'choose')
    assert.equal(result.workspace.path, path)
    assert.equal(h.dialogs.length, 1)
    assert.deepEqual(h.opens, [path])
  })
}

for (const previewFails of [false, true]) {
  test(`pending renderer save cannot delay picker ${previewFails ? 'failure feedback' : 'success'}`, async () => {
    const h = harness(), blocked = deferred()
    h.save = () => blocked.promise
    if (previewFails) h.previewFailure = new Error('private host detail')
    let returned = false
    const choose = h.store.chooseWorkspace('session').then((result) => { returned = true; return result })
    await tick()
    try {
      assert.equal(returned, true, 'picker result must return while the save queue is pending')
      assert.deepEqual(h.opens, [path])
      assert.equal(h.saves.length, 1)
    } finally {
      blocked.finish(false)
    }
    const result = await choose
    assert.equal(result.ok, true)
    assert.equal(result.previewError, previewFails ? 'open-failed' : undefined)
    assert.equal(h.session.detail.workspace.path, path)
  })
}

test('a rejected background save does not reject selection or duplicate the preview', async () => {
  const h = harness(), blocked = deferred()
  h.save = () => blocked.promise
  const result = await h.store.chooseWorkspace('session')
  blocked.fail(new Error('save unavailable'))
  await tick()
  assert.equal(result.ok, true)
  assert.deepEqual(h.opens, [path])
  assert.equal(h.session.detail.workspace.path, path)
})

test('cancellation, empty picker, missing directory and non-directory never open Preview', async () => {
  for (const scenario of ['cancelled', 'empty', 'missing', 'file']) {
    const h = harness()
    if (scenario === 'cancelled') h.dialogResult.canceled = true
    if (scenario === 'empty') h.dialogResult.filePaths = []
    if (scenario === 'missing') h.missing.add(path)
    if (scenario === 'file') h.files.add(path)
    const result = await h.store.chooseWorkspace('session')
    assert.equal(result.ok, false, scenario)
    assert.equal(h.opens.length, 0, scenario)
    assert.equal(h.saves.length, 0, scenario)
    assert.equal(h.session.detail.workspace, undefined, scenario)
  }
})

test('binding success without a workspace path does not attempt Preview', async () => {
  for (const bound of [{ ok: true }, { ok: true, workspace: fixture('') }]) {
    const h = harness()
    h.main.setWorkspaceDirectory = async () => bound
    assert.equal(await h.main.chooseWorkspaceDirectory({ sessionId: 'session' }), bound)
    assert.equal(h.opens.length, 0)
  }
})

test('preview exception retains binding and gives Chat and tool callers sanitized failure status', async () => {
  for (const caller of ['chat', 'tool']) {
    const h = harness()
    h.previewFailure = new Error('secret token and private host stack')
    const result = caller === 'chat'
      ? await h.store.chooseWorkspace('session')
      : JSON.parse(await h.main.toolWorkspaceContext('session', 'choose'))
    assert.equal(result.ok, true)
    assert.equal(result.previewError, 'open-failed')
    assert.equal(result.workspace.path, path)
    assert.equal(h.main.workspaceRefs.get('session').path, path)
    assert.equal(h.configValue.path, path)
    assert.deepEqual(h.opens, [path])
    assert.doesNotMatch(JSON.stringify(result), /secret|private host|stack/)
    if (caller === 'chat') assert.equal(h.session.detail.workspace.path, path)
  }
})

if (bitterless) {
  test('unregistered Maestro preview adapter returns unavailable without losing the workspace', async () => {
    const h = harness()
    h.adapterAvailable = false
    const result = await h.store.chooseWorkspace('session')
    assert.equal(result.ok, true)
    assert.equal(result.previewError, 'unavailable')
    assert.equal(h.session.detail.workspace.path, path)
    assert.equal(h.configValue.path, path)
    assert.equal(h.opens.length, 0)
  })
}

test('set, get, default restoration, refresh and workspace broadcasts never auto-open Preview', async () => {
  const h = harness()
  await h.main.setWorkspaceDirectory({ sessionId: 'session', path })
  assert.equal((await h.main.getWorkspaceDirectory({ sessionId: 'session' })).workspace.path, path)
  h.main.workspaceRefs.clear()
  assert.equal((await h.main.getWorkspaceDirectory()).workspace.path, path, 'restore default from config')
  await h.store.refreshDefaultWorkspace()
  assert.equal(h.store.defaultWorkspace.path, path)
  h.session.detail.workspace = fixture(path)
  await h.store.refreshWorkspace('session')
  h.main.syncWorkspaceFromContext('restored-session', fixture(otherPath))
  assert.equal(h.main.workspaceRefs.get('restored-session').path, otherPath)
  await h.store.applyWorkspaceBroadcast({ sessionId: 'session', workspace: fixture(otherPath) })
  await h.store.applyWorkspaceBroadcast({ sessionId: 'default', workspace: fixture(path) })
  assert.equal(h.session.detail.workspace.path, otherPath)
  assert.equal(h.store.defaultWorkspace.path, path)
  assert.equal(JSON.parse(await h.main.toolWorkspaceContext('session', 'status')).action, 'status')
  await h.main.setWorkspaceDirectory({ sessionId: 'session', path: '', remember: false })
  assert.equal(h.main.workspaceRefs.has('session'), false)
  assert.equal(h.dialogs.length, 0)
  assert.equal(h.opens.length, 0)
})

test('missing Chat session and picker rejection return null without changing the binding', async () => {
  const h = harness()
  assert.equal(await h.store.chooseWorkspace('unknown'), null)
  assert.equal(h.dialogs.length, 0)
  h.main.chooseWorkspaceDirectory = async () => { throw new Error('native picker unavailable') }
  assert.equal(await h.store.chooseWorkspace('session'), null)
  assert.equal(h.session.detail.workspace, undefined)
  assert.equal(h.opens.length, 0)
})

test('ChatPanel shows a localized retry warning only for preview failures and respects locked sessions', async () => {
  const warnings = [], calls = []
  const session = { id: 'session' }, turnLocked = { value: false }
  let result
  const { chooseWorkspace } = evaluate(`export ${panelChoose.getText(panelAst)}`, {
    props: { session }, turnLocked,
    messageStore: { chooseWorkspace: async (id) => { calls.push(id); return result } },
    Message: { warning: (message) => warnings.push(message) },
    i18nHelper: { maestroControl: { chat: { workspacePreviewFailed: 'localized: retry preview' } } },
    controlText: (message) => `localized: ${message}`
  })
  for (result of [null, { ok: false, error: 'cancelled' }, { ok: true }]) await chooseWorkspace()
  assert.equal(warnings.length, 0)
  for (const previewError of ['unavailable', 'open-failed']) {
    result = { ok: true, previewError }
    await chooseWorkspace()
  }
  assert.equal(warnings.length, 2)
  assert.ok(warnings.every((message) => message.startsWith('localized: ')))
  const count = calls.length
  session.archivedAt = 1
  await chooseWorkspace()
  delete session.archivedAt
  session.turn = {}
  turnLocked.value = true
  await chooseWorkspace()
  assert.equal(calls.length, count)
})
