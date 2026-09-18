import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { transformSync } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const main = bl ? 'src/main/maestro/windows/main/' : 'src/main/modules/window-manager/windows/main/'
const read = (path) => ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
const members = (path, names) => {
  const source = read(path)
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

const workspaceMembers = members(main + 'workspaceFile.service.ts', [
  'defaultWorkspaceWrites', 'getWorkspaceDirectory', 'setWorkspaceDirectory', 'workspaceRefFromPath',
  'readDefaultWorkspace', 'readDefaultWorkspacePath', 'persistDefaultWorkspace',
  'removeDefaultWorkspaceIfPathMatches', 'clearWorkspaceRef', 'broadcastWorkspaceChanged'
])

function harness(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'workspace-query-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const live = join(directory, 'live'); mkdirSync(live)
  const dead = join(directory, 'dead'); mkdirSync(dead)
  const h = { events: [], stored: undefined, live, dead }
  const configStore = {
    get: async () => h.stored ? { options: structuredClone(h.stored) } : null,
    upsert: async ({ options }) => { h.stored = structuredClone(options) },
    remove: async () => { h.stored = undefined }
  }
  const { Workspace } = evaluate(`export class Workspace { ${workspaceMembers} }`, {
    statSync, resolve, workspaceNameForPath: (path) => basename(path), configStore,
    WORKSPACE_CONFIG_DOMAIN: 'workspace', WORKSPACE_DEFAULT_KEY: 'default',
    xpcMain: { broadcast: (name, params) => h.events.push({ name, params }) },
    getNativeMessages: () => ({ chooseWorkspace: 'Choose' }), isValidate: () => false, dialog: {}
  })
  h.main = new Workspace()
  h.main.workspaceRefs = new Map()
  h.main._state = { agentSessionKey: (id) => id || 'default' }
  // Per key: a real change legitimately notifies both the session binding and the remembered
  // default, and lumping them together would hide which one is noisy.
  h.count = (sessionId) => h.events.filter((event) => /workspace-changed$/.test(event.name) && event.params?.sessionId === sessionId).length
  return h
}

test('reading a valid workspace never announces a change — a query is not a mutation', async (t) => {
  const h = harness(t)
  await h.main.setWorkspaceDirectory({ sessionId: 's1', path: h.live })
  const afterSet = h.count('s1')
  assert.equal(afterSet, 1, 'the real change that set it broadcasts exactly once')
  for (let i = 0; i < 25; i++) {
    const result = await h.main.getWorkspaceDirectory({ sessionId: 's1' })
    assert.equal(result.ok, true)
    assert.equal(result.workspace.path, h.live)
  }
  // The defect this pins: every read stamped a fresh `updatedAt` and broadcast it as a change, so
  // any caller that refetched on the notification drove an unbounded feedback loop.
  assert.equal(h.count('s1'), afterSet, '25 reads must add zero broadcasts')
  assert.equal(h.count('default'), 0, 'a session read must not rewrite the remembered default either')
})

test('reading a workspace whose directory vanished announces it once, not once per read', async (t) => {
  const h = harness(t)
  await h.main.setWorkspaceDirectory({ sessionId: 's1', path: h.dead })
  const afterSet = h.count('s1')
  rmSync(h.dead, { recursive: true })
  const first = await h.main.getWorkspaceDirectory({ sessionId: 's1' })
  assert.equal(first.missing, true)
  const afterFirst = h.count('s1')
  assert.equal(afterFirst, afterSet + 1, 'the present→absent transition is a real change: exactly one')
  for (let i = 0; i < 25; i++) await h.main.getWorkspaceDirectory({ sessionId: 's1' })
  assert.equal(h.count('s1'), afterFirst, 'rediscovering the same absence is not a new change')
})

test('the persisted default does not resurrect a dead path on every read', async (t) => {
  const h = harness(t)
  await h.main.setWorkspaceDirectory({ path: h.dead })
  rmSync(h.dead, { recursive: true })
  const before = h.count('default')
  for (let i = 0; i < 25; i++) await h.main.getWorkspaceDirectory({})
  assert.equal(h.stored, undefined, 'the dead default is removed for real, not re-read every time')
  assert.ok(h.count('default') - before <= 1, `at most one transition broadcast, saw ${h.count('default') - before}`)
})

test('a genuine change still notifies exactly once', async (t) => {
  const h = harness(t)
  await h.main.setWorkspaceDirectory({ sessionId: 's1', path: h.live })
  const before = h.count('s1')
  const other = join(h.live, 'nested'); mkdirSync(other)
  await h.main.setWorkspaceDirectory({ sessionId: 's1', path: other })
  assert.equal(h.count('s1'), before + 1, 'one real change, one notification')
})
