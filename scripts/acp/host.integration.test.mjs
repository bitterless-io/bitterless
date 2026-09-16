import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')
const directory = mkdtempSync(join(tmpdir(), 'maestro-acp-host-'))
const db = new DatabaseSync(join(directory, 'sessions.sqlite'))
db.exec(`CREATE TABLE cowork_chat_session(id TEXT PRIMARY KEY, operation_tab_id TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, archived_at INTEGER, detail_json TEXT);
CREATE TABLE cowork_chat_message(id TEXT PRIMARY KEY, session_id TEXT, source TEXT, role TEXT, type TEXT, content TEXT, files_json TEXT, skill_json TEXT, skills_json TEXT, replay_json TEXT, activity_json TEXT, streaming INTEGER, error INTEGER, compressed INTEGER, prompt_excluded INTEGER, compact_summary TEXT, compact_until_message_id TEXT, token_count INTEGER, ts INTEGER, sort_order INTEGER);`)
const database = {
  prepare: (...args) => db.prepare(...args),
  transaction: (run) => () => { db.exec('BEGIN'); try { const value = run(); db.exec('COMMIT'); return value } catch (error) { db.exec('ROLLBACK'); throw error } }
}
const settings = new Map()
const runtimeSessions = []
class NetworkStub {
  async checkTarget() { return true }
  async createSession(options) {
    const listeners = new Set()
    let finish
    const instance = {
      prompts: [],
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      async prompt(message) {
        this.prompts.push(message.text)
        const emit = (event) => { for (const listener of listeners) listener(event) }
        emit({ type: 'thinking_delta', delta: 'Considering the request' })
        if (message.text.endsWith('provider failure')) throw new Error('provider refused test request')
        if (message.text.endsWith('wait for cancel')) {
          emit({ type: 'text_delta', delta: 'Partial output' })
          await new Promise((resolve) => { finish = resolve })
          return
        }
        if (message.text.endsWith('request write')) {
          const tool = options.tools.find((tool) => tool.name === 'test_write')
          try { await tool.execute({ value: 'approved write' }) } catch { emit({ type: 'text_delta', delta: 'Denied. ' }) }
        }
        emit({ type: 'text_delta', delta: 'Native runtime reply' })
        emit({ type: 'assistant_message_end', text: 'Native runtime reply', stopReason: 'stop' })
      },
      async abort() { finish?.() }
    }
    runtimeSessions.push(instance)
    return instance
  }
}
const cache = new Map()
const mocks = {
  electron: { app: { getPath: () => directory }, clipboard: {}, dialog: { showMessageBox: () => { throw new Error('External turn reached GUI approval') } }, shell: {} },
  'electron-xpc/main': {
    xpcMain: { broadcast() {} },
    createXpcMainEmitter: () => ({
      get: async ({ key }) => key === 'host-tool-policies' ? { options: { test_write: { mode: 'confirm' } } } : settings.get(key),
      upsert: async ({ key, options }) => { settings.set(key, { options }); return { ok: true } },
      getSession: async () => null
    })
  },
  'electron-xpc/preload': { XpcPreloadHandler: class {} },
  undici: { fetch: () => { throw new Error('Unexpected network call') } }
}
const load = (path) => {
  if (cache.has(path)) return cache.get(path).exports
  if (path.endsWith('/runtime/coachRuntimeAdapter.ts')) return { CoachRuntimeAdapter: NetworkStub }
  if (path.endsWith('/sqlite/sqliteManager.ts')) return { sqliteManager: { db: database } }
  if (path.includes('/networking/') && path.endsWith('.api.ts')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : () => { throw new Error('Unexpected network upload') } })
  const module = { exports: {} }
  cache.set(path, module)
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true } }).outputText
  const localRequire = (specifier) => {
    if (mocks[specifier]) return mocks[specifier]
    let target
    if (specifier.startsWith('@maestro-main/')) target = join(root, 'src/main/maestro', specifier.slice(14))
    else if (specifier.startsWith('@maestro-shared/')) target = join(root, 'src/shared/maestro', specifier.slice(16))
    else if (specifier.startsWith('.')) target = resolve(dirname(path), specifier)
    if (target && existsSync(target + '.ts')) return load(target + '.ts')
    return require(specifier)
  }
  vm.runInThisContext(`(function(exports,require,module,__filename,__dirname){${source}\n})`, { filename: path })(module.exports, localRequire, module, path, dirname(path))
  return module.exports
}

const { MaestroChatDao } = load(join(root, 'src/preload/maestro/sqlite/maestroChat.dao.ts'))
const { MaestroAgentService } = load(join(root, 'src/main/maestro/agent/maestroAgent.service.ts'))
const { MaestroAcpHost } = load(join(root, 'src/main/acp/maestroAcp.host.ts'))
const { cancelExternalTurns } = load(join(root, 'src/main/acp/maestroAcp.lifecycle.ts'))
const { HOST_TOOL_POLICY_KEY } = load(join(root, 'src/shared/maestro/config.api.ts'))
settings.set(HOST_TOOL_POLICY_KEY, { options: { test_write: { mode: 'confirm' } } })
const store = new MaestroChatDao()
const service = new MaestroAgentService()
let workspace
let authenticated = true
service.setState({
  browserWindow: null, currentUrl: '',
  ensurePersistedCaptureRecordsLoaded: async () => undefined,
  ensureServices: () => ({ registry: { listSkillsForDomain: () => [] } }),
  syncWorkspaceFromContext: (_, value) => { workspace = value },
  emitTrace() {},
  buildPiTools: () => service.wrapHostTools('cowork', [{
    name: 'test_write', description: 'Write the test artifact', params: [],
    execute: async ({ value }) => { writeFileSync(join(directory, 'artifact.txt'), value); return 'written' }
  }])
})
const runtime = {
  prepare: async () => undefined,
  assertAccess: () => { if (!authenticated) throw new Error('Sign in required') },
  checkTarget: async () => await service.ensureAgents().pi.checkTarget(),
  prompt: async (params) => await service.sendAgentMessage(params),
  abort: async (sessionId) => await service.abortAgent({ sessionId }),
  release: async (sessionId) => await service.releaseExternalSession(sessionId)
}
const host = new MaestroAcpHost(store, runtime)
const context = (controller = new AbortController(), decide = 'allow-once') => {
  const updates = [], permissions = []
  return {
    controller, updates, permissions,
    signal: controller.signal,
    emit: async (update) => { updates.push(update) },
    requestPermission: async (request) => { permissions.push(request); return { outcome: { outcome: 'selected', optionId: decide } } }
  }
}
const waitUntil = async (predicate) => {
  const end = Date.now() + 3000
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise((resolve) => setTimeout(resolve, 5)) }
}

test('real host, native MaestroAgentService, BaseAgent and SQLite DAO work end to end', async () => {
  try {
    await host.checkAccess()
    const session = await host.createSession({ cwd: directory, mcpServers: [] })
    const first = context()
    await host.prompt(session.sessionId, [{ type: 'text', text: 'hello' }, { type: 'resource_link', name: 'Guide', uri: 'file:///guide.md' }], first)
    assert.equal(workspace.path, directory)
    assert(first.updates.some((update) => update.sessionUpdate === 'agent_thought_chunk'))
    assert(first.updates.some((update) => update.sessionUpdate === 'agent_message_chunk'))
    assert.equal((await store.listSessions()).length, 0)
    assert.equal(await store.getSession({ id: session.sessionId }), null)
    const saved = await store.getExternalSession({ id: session.sessionId })
    await assert.rejects(store.saveSession({ session: saved }), /owned by ACP/)
    await assert.rejects(store.deleteSession({ id: session.sessionId }), /owned by ACP/)
    await host.prompt(session.sessionId, [{ type: 'text', text: 'same-session second turn' }], context())
    assert.equal(runtimeSessions[0].prompts.length, 2)
    assert(!runtimeSessions[0].prompts[1].includes('Human ('))
    await host.closeSession(session.sessionId)
    const reloaded = await new MaestroAcpHost(store, runtime).loadSession({ ...session, mcpServers: [] })
    assert(reloaded.history.some((update) => update.content?.type === 'resource_link'))
    await host.prompt(session.sessionId, [{ type: 'text', text: 'second turn' }], context())
    assert.equal((runtimeSessions.at(-1).prompts[0].match(/: hello/g) || []).length, 1)
    assert.equal((runtimeSessions.at(-1).prompts[0].match(/same-session second turn/g) || []).length, 1)
    const permission = context()
    await host.prompt(session.sessionId, [{ type: 'text', text: 'request write' }], permission)
    assert.equal(permission.permissions.length, 1)
    assert.equal(readFileSync(join(directory, 'artifact.txt'), 'utf8'), 'approved write')
    assert(permission.updates.some((update) => update.sessionUpdate === 'tool_call'))
    assert(permission.updates.some((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed'))
    rmSync(join(directory, 'artifact.txt'))
    const denied = context(undefined, 'deny-once')
    await host.prompt(session.sessionId, [{ type: 'text', text: 'request write' }], denied)
    assert(!existsSync(join(directory, 'artifact.txt')))
    assert(denied.updates.some((update) => update.status === 'failed'))
    const cancel = context()
    const pending = host.prompt(session.sessionId, [{ type: 'text', text: 'wait for cancel' }], cancel)
    await waitUntil(() => cancel.updates.some((update) => update.content?.text === 'Partial output'))
    await assert.rejects(service.sendAgentMessage({ message: 'GUI overlap' }), /busy with another turn/)
    await assert.rejects(host.prompt(session.sessionId, [{ type: 'text', text: 'overlap' }], context()), /busy with another turn/)
    cancel.controller.abort()
    assert.equal((await pending).stopReason, 'cancelled')
    assert((await store.getExternalSession({ id: session.sessionId })).messages.at(-1).content.includes('Partial output'))
    const logout = context()
    logout.requestPermission = () => new Promise(() => {})
    const logoutTurn = host.prompt(session.sessionId, [{ type: 'text', text: 'request write' }], logout)
    await waitUntil(() => logout.updates.some((update) => update.sessionUpdate === 'tool_call'))
    authenticated = false
    await cancelExternalTurns()
    assert.equal((await logoutTurn).stopReason, 'cancelled')
    await assert.rejects(host.checkAccess(), /Sign in required/)
    assert(!existsSync(join(directory, 'artifact.txt')))
    authenticated = true
    const failure = context()
    failure.emit = async () => { throw new Error('stream failed') }
    await assert.rejects(host.prompt(session.sessionId, [{ type: 'text', text: 'hello' }], failure), /stream failed/)
    await assert.rejects(host.prompt(session.sessionId, [{ type: 'text', text: 'provider failure' }], context()), /provider refused test request/)
    const other = await host.createSession({ cwd: directory, mcpServers: [] })
    await host.prompt(other.sessionId, [{ type: 'text', text: 'isolated' }], context())
    assert(!runtimeSessions.at(-1).prompts[0].includes('hello'))
    await host.closeSession(session.sessionId)
    await host.closeSession(other.sessionId)
    await service.shutdown()
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
