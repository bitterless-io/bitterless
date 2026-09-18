import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { build, transformSync } from 'esbuild'
import { reactive, toRaw } from 'vue'

const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const renderer = bl ? 'src/renderer/maestro/control/src/store/' : 'src/renderer/control/src/store/'
const main = bl ? 'src/main/maestro/windows/main/' : 'src/main/modules/window-manager/windows/main/'
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
const registryBundle = await build({
  stdin: { contents: `
    export { OnlyPreviewHostRegistry } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry';
    export { OnlyPreviewWorkspaceRegistry } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
  `, loader: 'ts', resolveDir: root },
  write: false, bundle: true, platform: 'node', format: 'esm',
  alias: { '@shared': resolve(root, 'src/shared'), '@main': resolve(root, 'src/main') }
})
const { OnlyPreviewHostRegistry, OnlyPreviewWorkspaceRegistry } = await import(
  `data:text/javascript;base64,${Buffer.from(registryBundle.outputFiles[0].text + '\n//# sourceURL=onlyPreviewWorkspace.fixture.mjs').toString('base64')}`
)
const workspaceMembers = members(main + 'workspaceFile.service.ts', [
  'defaultWorkspaceWrites', 'adoptPreviewWorkspaceDirectory', 'releaseWorkspaceBinding', 'setWorkspaceDirectory',
  'getWorkspaceDirectory', 'chooseWorkspaceDirectory', 'workspaceRefFromPath',
  'readDefaultWorkspace', 'readDefaultWorkspacePath', 'persistDefaultWorkspace',
  'removeDefaultWorkspaceIfPathMatches', 'clearWorkspaceRef', 'broadcastWorkspaceChanged'
])
const messageMembers = members(renderer + 'message.store.ts', [
  bl ? 'authGeneration' : 'generation', 'workspaceSelectionGeneration',
  'init', 'createSession', 'createEmptySession', 'loadPersistedSession', 'latestActiveSession',
  'getSession', 'adoptPreviewWorkspace', 'chooseWorkspace', 'stopUsingWorkspace',
  'refreshDefaultWorkspace', 'refreshWorkspace', 'applyWorkspaceBroadcast', 'cloneWorkspace',
  'persistSession', 'persistSessionMeta', ...(bl ? [] : ['runSessionWrite']), 'refreshHistory',
  // A save now re-reads only the row it touched; without the real member here every save in
  // this file dies on `this.refreshHistoryRow is not a function`
  // (docs/issues/every-save-recounts-the-whole-history.md).
  'refreshHistoryRow', ...(bl ? ['queueSessionSave', 'saveSessionNow', 'resume'] : [])
])
const channelAst = ast(renderer + 'channel.store.ts')
const channelClass = channelAst.statements.find((node) => ts.isClassDeclaration(node)).getText(channelAst).replace(/^export /, '')
const tick = () => new Promise((done) => setImmediate(done))
const deferred = () => { let finish; const promise = new Promise((done) => { finish = done }); return { promise, finish } }

function projectAccessor(bindings) {
  if (!bl) {
    const source = ast('src/main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts')
    const declaration = source.statements.find((node) => ts.isVariableStatement(node)
      && node.declarationList.declarations[0].name.getText(source) === 'currentOnlyPreviewProjectDirectory')
    return evaluate(declaration.getText(source), bindings).currentOnlyPreviewProjectDirectory
  }
  const source = ast('src/main/windows/onlyPreviewMaestroOpener.ts')
  let accessor
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'currentProjectDirectory') accessor = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(accessor)
  return evaluate(`export const accessor = ${accessor}`, bindings).accessor
}

function harness(t, { restore = false, project = true, external = false, pending = false, missing = false, host = true } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'control-preview-login-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const paths = Object.fromEntries(['preview', 'old', 'other', 'external', 'chosen'].map((name) => {
    const path = join(directory, name); mkdirSync(path); return [name, path]
  }))
  const hosts = new OnlyPreviewHostRegistry()
  const workspaces = new OnlyPreviewWorkspaceRegistry(hosts)
  const previewHost = hosts.issue('standalone', 'content')
  t.after(() => hosts.clear())
  if (project) {
    const selected = workspaces.registerValidatedTarget(previewHost.hostToken, {
      rootRealPath: paths.preview, rootName: 'Preview label', displayPath: paths.preview
    })
    if (!pending) workspaces.bindProjectAuthority(previewHost.hostToken, selected.workspaceId, 1)
  }
  if (external) workspaces.registerExternalPreview(previewHost.hostToken, {
    rootRealPath: paths.external, rootName: 'External', displayPath: paths.external, selectedRelativePath: 'result.md'
  })
  if (missing) rmSync(paths.preview, { recursive: true })
  const h = { paths, rows: new Map(), saves: [], events: [], opens: [], writes: [], callbacks: new Map(), defaultValue: undefined, held: null, adopting: false }
  const accessor = projectAccessor({ onlyPreviewWindowHelper: { getStandaloneHost: () => host ? previewHost : null }, onlyPreviewWorkspaceRegistry: workspaces })
  const configStore = {
    get: async () => h.defaultValue ? { options: structuredClone(h.defaultValue) } : null,
    upsert: async ({ options }) => {
      if (h.adopting && h.held && options.path === paths.preview) await h.held.promise
      h.defaultValue = structuredClone(options); h.writes.push(options.path)
    },
    remove: async () => { h.defaultValue = undefined; h.writes.push(undefined) }
  }
  const emit = (name, params) => {
    h.events.push({ name, params })
    h.callbacks.get(name)?.({ params })
  }
  const { Workspace } = evaluate(`export class Workspace { ${workspaceMembers} }`, {
    statSync, resolve, workspaceNameForPath: (path) => basename(path), configStore,
    WORKSPACE_CONFIG_DOMAIN: 'workspace', WORKSPACE_DEFAULT_KEY: 'default', xpcMain: { broadcast: emit },
    currentOnlyPreviewProjectDirectory: accessor, skipDisabled: () => false,
    getMaestroPreviewOpener: () => ({ currentProjectDirectory: accessor, open: async (path) => h.opens.push(path) }),
    openOnlyPreviewTarget: async (path) => h.opens.push(path),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [paths.chosen] }) },
    getNativeMessages: () => ({ chooseWorkspace: 'Choose workspace' }), isValidate: () => false
  })
  h.main = new Workspace()
  h.main.workspaceRefs = new Map()
  h.main._state = { agentSessionKey: (id) => id || 'default' }
  const controllerFile = main + (bl ? 'maestroWindow.controller.ts' : 'mainWindow.controller.ts')
  const handlerFile = bl ? 'src/main/maestro/xpc/coach.handler.ts' : 'src/main/xpc/cowork.handler.ts'
  const { Controller } = evaluate(`export class Controller { ${members(controllerFile, ['adoptPreviewWorkspaceDirectory', 'releaseWorkspaceBinding'])} }`)
  const controller = new Controller(); controller.workspaceFile = h.main
  const { Handler } = evaluate(`export class Handler { ${members(handlerFile, ['adoptPreviewWorkspaceDirectory', 'releaseWorkspaceBinding'])} }`, {
    mainCtl: () => controller, maestroWindowHelper: controller
  })
  const handler = new Handler()
  const coach = {
    adoptPreviewWorkspaceDirectory: (params) => { h.adopting = true; return handler.adoptPreviewWorkspaceDirectory(params) },
    releaseWorkspaceBinding: (params) => handler.releaseWorkspaceBinding(params),
    setWorkspaceDirectory: (params) => h.main.setWorkspaceDirectory(params),
    getWorkspaceDirectory: (params) => h.main.getWorkspaceDirectory(params),
    chooseWorkspaceDirectory: (params) => h.main.chooseWorkspaceDirectory(params),
    closeWorkspacePreview: async () => {}, ensureSessionIo: async () => ({ ok: true }),
    getActiveAgentTurn: async () => null, setSkillViewContext: async () => {}, setSkillWorkbenchContext: async () => {}
  }
  const dao = {
    getSession: async ({ id }) => structuredClone(h.rows.get(id)),
    listSessions: async () => [...h.rows.values()].map((row) => structuredClone(row)),
    // The narrow post-save read. These fixtures start with an empty `historySessions`, so the
    // fallback to the full pull is what usually runs — this keeps the narrow path honest too.
    getSessionSummary: async ({ id }) => (h.rows.has(id) ? structuredClone(h.rows.get(id)) : null),
    saveSession: async ({ session }) => { h.rows.set(session.id, structuredClone(session)); h.saves.push(structuredClone(session)); return { ok: true } },
    // Metadata lane: merge onto the stored row so a later read still sees the messages it never sent.
    saveSessionMeta: async ({ session }) => {
      h.rows.set(session.id, { ...structuredClone(h.rows.get(session.id) || {}), ...structuredClone(session) })
      h.saves.push(structuredClone(h.rows.get(session.id)))
      return { ok: true }
    }
  }
  let nextId = 0
  const { Messages } = evaluate(`export class Messages { ${messageMembers} }`, {
    coach, coworkChat: dao, maestroChat: dao, toRaw, MODEL_RETRY_CHANNEL: 'retry', PLAN_CHANNEL: 'plan', AGENT_TURN_CHANNEL: 'turn',
    xpcRenderer: { subscribe: (name, callback) => h.callbacks.set(name, callback) },
    workflowApi: { listRuns: async () => null }, uid: () => `new-${++nextId}`,
    turnDiagnostics: { emit() {} },
    DEFAULT_OPERATION_TAB_ID: 'operation', placeholderFor: () => '', emptyDetail: () => ({}), emptyUsage: () => ({})
  })
  h.store = reactive(new Messages())
  Object.assign(h.store, {
    sessions: [], historySessions: [], activeSessionId: '', authActive: true,
    sessionSaves: new Map(), pendingAgentTurnFinishes: new Map(), activeAgentTurnSnapshot: null,
    subscriptions: { subscribe: (name, callback) => h.callbacks.set(name, callback) },
    turnService: { claimPendingReplies: async () => {} },
    updateSessionContextUsage() {}, seedTaskBindings() {}, restorePersistedBindings() {},
    replayFinishedAgentTurns: async () => {}, restoreActiveTurn() {}, replayTaskSnapshot() {},
    restoreActiveTurnSessions: async () => {}, markRead() {}, discardIfEmpty: async () => {},
    isSessionMetadataBusy: () => false, fromStoredSession: (row) => row,
    toStoredSession: (session) => JSON.parse(JSON.stringify(session)),
    toStoredSessionMeta: ({ messages, ...meta }) => JSON.parse(JSON.stringify(meta))
  })
  if (!bl) {
    const { SessionWriteQueue } = evaluate(read(renderer + 'sessionManagement.ts'))
    h.store.sessionWrites = new SessionWriteQueue()
  }
  const { Channel } = evaluate(`${channelClass}\nexport { ChannelStoreState as Channel }`, {
    messageStore: h.store, coach, readActiveId: () => restore ? 'restored' : '', writeActiveId() {},
    createXpcRendererEmitter: () => coach
  })
  h.channel = reactive(new Channel())
  h.makeSession = (id, path) => ({ id, source: 'cowork', title: id, messages: [], detail: { workspace: path ? { path, name: basename(path), exists: true } : undefined }, updatedAt: 1, createdAt: 1 })
  if (restore) h.rows.set('restored', h.makeSession('restored', paths.old))
  h.select = (id) => h.channel[bl ? 'selectMaestroHistorySession' : 'selectCoworkHistorySession'](id)
  h.logout = () => {
    h.channel[bl ? 'reset' : 'suspend']()
    h.store[bl ? 'authGeneration' : 'generation']++
    h.store.authActive = false; h.store.initialized = false; h.store.sessions = []; h.store.activeSessionId = ''; h.store.defaultWorkspace = undefined
    if (!bl) h.callbacks.clear()
  }
  return h
}

for (const restore of [false, true]) test(`${restore ? 'restored' : 'new'} authenticated Chat adopts Project and persists session/default/tool binding without opening Preview`, async (t) => {
  const h = harness(t, { restore, external: true })
  await h.channel.init()
  const session = h.channel.activeSession
  assert.equal(session.detail.workspace.path, h.paths.preview)
  assert.equal(h.rows.get(session.id).detail.workspace.path, h.paths.preview)
  assert.equal(h.main.workspaceRefs.get(session.id).path, h.paths.preview)
  assert.equal(h.defaultValue.path, h.paths.preview)
  assert.equal(h.store.createSession({ title: 'Next', intent: 'chat' }).detail.workspace.path, h.paths.preview)
  assert.equal(h.opens.length, 0)
  assert.equal(h.events.filter(({ params }) => params.workspace?.path === h.paths.preview).length, 0, 'adoption has no broadcast bypass')
})

for (const scenario of ['no-project', 'no-host', 'external-only', 'pending', 'missing']) test(`${scenario} preserves the valid restored Chat workspace`, async (t) => {
  const h = harness(t, {
    restore: true, project: !['no-project', 'external-only'].includes(scenario),
    host: scenario !== 'no-host', external: scenario === 'external-only', pending: scenario === 'pending', missing: scenario === 'missing'
  })
  await h.channel.init()
  assert.equal(h.channel.activeSession.detail.workspace.path, h.paths.old)
  assert.equal(h.main.workspaceRefs.get('restored').path, h.paths.old)
  assert.equal(h.opens.length, 0)
})

test('history selected after initialization keeps its binding and is not adopted again', async (t) => {
  const h = harness(t, { restore: true })
  h.rows.set('historical', h.makeSession('historical', h.paths.other))
  await h.channel.init()
  assert.equal(h.rows.get('historical').detail.workspace.path, h.paths.other)
  await h.select('historical')
  assert.equal(h.channel.activeSession.detail.workspace.path, h.paths.other)
})

for (const action of ['logout', 'history', 'choose', 'stop']) test(`delayed Main default persistence cannot override a newer ${action}`, async (t) => {
  const h = harness(t, { restore: true })
  h.held = deferred()
  const opening = h.channel.init()
  while (!h.adopting) await tick()
  let newer
  if (action === 'logout') {
    h.logout()
    const fresh = h.makeSession('new-account', h.paths.other)
    h.store.sessions.push(fresh); h.store.activeSessionId = fresh.id; h.channel.activeSessionId = fresh.id
  } else if (action === 'history') {
    const other = h.makeSession('historical', h.paths.other)
    h.store.sessions.push(other)
    newer = h.select(other.id)
  } else {
    newer = h.store[action === 'choose' ? 'chooseWorkspace' : 'stopUsingWorkspace']('restored')
  }
  h.held.finish()
  await Promise.all([opening, newer])
  await tick()
  if (action === 'logout' || action === 'history') {
    assert.equal(h.channel.activeSession.detail.workspace.path, h.paths.other)
    assert.equal(h.saves.some((row) => row.detail.workspace?.path === h.paths.preview), false)
    // The fenced Chat must not keep Main pointed at a Project it never adopted: its tools resolve
    // through that binding, and a Chat with no workspace of its own would never re-push over it.
    assert.notEqual(h.main.workspaceRefs.get('restored')?.path, h.paths.preview)
  } else if (action === 'choose') {
    assert.equal(h.channel.activeSession.detail.workspace.path, h.paths.chosen)
    assert.equal(h.main.workspaceRefs.get('restored').path, h.paths.chosen)
    assert.equal(h.defaultValue.path, h.paths.chosen)
    assert.equal(h.store.defaultWorkspace.path, h.paths.chosen)
  } else {
    assert.equal(h.channel.activeSession.detail.workspace, undefined)
    assert.equal(h.main.workspaceRefs.has('restored'), false)
  }
  if (action !== 'logout') {
    assert.equal(h.store.defaultWorkspace?.path, h.defaultValue?.path)
    assert.equal(h.store.createSession({ title: 'Next', intent: 'chat' }).detail.workspace?.path, h.defaultValue?.path)
  }
  assert.equal(h.events.filter(({ params }) => params.sessionId !== 'default' && params.workspace?.path === h.paths.preview).length, 0)
})

test('a fenced Chat without its own workspace keeps no adopted Main binding', async (t) => {
  const h = harness(t, { restore: true })
  h.rows.set('restored', h.makeSession('restored'))
  h.held = deferred()
  const opening = h.channel.init()
  while (!h.adopting) await tick()
  const other = h.makeSession('historical', h.paths.other)
  h.store.sessions.push(other)
  const newer = h.select(other.id)
  h.held.finish()
  await Promise.all([opening, newer])
  await tick()
  assert.equal(h.channel.activeSession.detail.workspace.path, h.paths.other)
  assert.equal(h.rows.get('restored').detail.workspace, undefined)
  // Nothing would ever re-push over this one: `refreshWorkspace` returns early without a path, so
  // Main would keep resolving this Chat's file tools inside a Project it never adopted.
  assert.equal(h.main.workspaceRefs.has('restored'), false)
})

test('saving raw and proxied sessions works while a queued save after logout is fenced', async (t) => {
  const h = harness(t, { project: false })
  const raw = h.store.createSession({ title: 'Raw', intent: 'chat' })
  assert.equal(await h.store.persistSession(toRaw(raw)), true)
  assert.equal(await h.store.persistSession(h.store.getSession(raw.id)), true)
  const held = deferred()
  if (bl) h.store.sessionSaves.set(raw.id, held.promise)
  else h.store.sessionWrites.run(raw.id, () => held.promise)
  const saveCount = h.saves.length
  const stale = h.store.persistSession(raw)
  h.logout(); held.finish(true)
  assert.equal(await stale, false)
  assert.equal(h.saves.length, saveCount)
})
