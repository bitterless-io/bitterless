import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as fsPromises from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const load = (relative, modules = {}) => {
  const file = fileURLToPath(new URL('../../src/' + relative, import.meta.url))
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name in modules) return modules[name]
    if (name.startsWith('node:') || ['path', 'os', 'fs', 'fs/promises', 'zod', 'yaml'].includes(name)) return require(name)
    throw Error('Unexpected fixture dependency: ' + name)
  }, module, module.exports)
  return module.exports
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const reference = 'institution:account-a:7:fixture'
const fixture = () => {
  let current = { namespace: 'account-a', institutionId: 7, institutionName: 'Fixture', generation: 'generation-1' }
  let checks = 0
  const assetScope = { get current() { return current }, revalidate: async () => { checks++; return current }, subscribe: () => () => {} }
  const context = load('main/maestro/skills/skillScope.context.ts', { '@main/workflowLibrary/assetScope.service': { assetScope } })
  const { ReplayEngine } = load('main/maestro/drive/replayEngine.ts', { './humanMouse': { HumanMouse: class {} } })
  class CommonService { setState(state) { this._state = state } }
  const { SkillService } = load('main/maestro/skills/skill.service.ts', {
    './skillScope.context': context, electron: { dialog: {}, shell: {} }, 'electron-xpc/main': { xpcMain: { broadcast() {} } }, inversify: { injectable: () => value => value },
    '@maestro-main/capture/traceTimeline': {}, '@maestro-shared/iocHelper/ioc.helper': { CommonService }
  })
  const { SkillGeneratorService } = load('main/maestro/skills/skillGenerator.service.ts', {
    '@maestro-main/skills/skillScope.context': context, './recipeRedact': { redactRecipeForStorage: value => value }, './apiProfile.service': { writeApiProfile() {} }
  })
  return { context, ReplayEngine, SkillService, SkillGeneratorService, get checks() { return checks }, set current(value) { current = value } }
}
const recipe = () => ({ id: 'fixture', name: 'Fixture', description: 'Test scope execution', inputs: [], aliases: [], shortcuts: [], keywords: [], triggers: [], network: [], snapshots: [], sourceUrl: 'https://fixture.invalid', steps: [{ action: 'click', target: { tag: 'button', selector: '#one' } }, { action: 'click', target: { tag: 'button', selector: '#two' } }] })

test('Workbench replay rejects revoked institution before reading recipe or executing a step', async () => {
  const f = fixture(); f.current = null
  let reads = 0, calls = 0
  const service = new f.SkillService()
  service.setState({ ensureServices: () => ({ registry: { readRecipe: () => { reads++; return recipe() } } }), replayEngine: {}, replayRecipe: async () => { calls++ }, emitTrace() {} })
  await assert.rejects(service.replaySkill({ skillId: reference, variables: {} }), /unavailable/)
  assert.equal(reads, 0); assert.equal(calls, 0)
})

test('real Workbench replay stops before the second UI side effect after logout mid-step', async () => {
  const f = fixture(), engine = new f.ReplayEngine({}), began = deferred(), release = deferred(), actions = []
  engine.runStep = async step => { actions.push(step.target.selector); began.resolve(); await release.promise; return { ok: true } }
  const service = new f.SkillService()
  service.setState({ ensureServices: () => ({ registry: { readRecipe: recipe } }), replayEngine: engine, replayRecipe: (value, vars, guard) => engine.replay(value, vars, guard), emitTrace() {} })
  const pending = service.replaySkill({ skillId: reference, variables: {} })
  await began.promise; f.current = null; release.resolve()
  await assert.rejects(pending, /changed/)
  assert.deepEqual(actions, ['#one'])
})

test('Shared Workbench replay remains usable offline after logout', async () => {
  const f = fixture(); f.current = null
  const engine = new f.ReplayEngine({}), actions = []
  engine.runStep = async step => { actions.push(step.target.selector); return { ok: true } }
  const service = new f.SkillService()
  service.setState({ ensureServices: () => ({ registry: { readRecipe: recipe } }), replayEngine: engine, replayRecipe: (value, vars, guard) => engine.replay(value, vars, guard), emitTrace() {} })
  const result = await service.replaySkill({ skillId: 'shared:fixture', variables: {} })
  assert.equal(result.ok, true); assert.deepEqual(actions, ['#one', '#two']); assert.equal(f.checks, 0)
})

for (const change of ['logout', 'same-account-new-generation']) test(`training cannot archive or overwrite after ${change} during model await`, async () => {
  const f = fixture(), began = deferred(), release = deferred(), writes = []
  const registry = { readRecipe: recipe, archiveSkill: () => writes.push('archive'), overwriteSkill: () => { writes.push('overwrite'); return { name: 'Fixture' } } }
  const generator = new f.SkillGeneratorService(registry, {})
  generator.askCodexToRefine = async () => { began.resolve(); await release.promise; return {} }
  const pending = generator.train(reference, 'Fixture refinement')
  await began.promise
  f.current = change === 'logout' ? null : { namespace: 'account-a', institutionId: 7, generation: 'generation-2' }
  release.resolve(); await assert.rejects(pending, /changed/); assert.deepEqual(writes, [])
})

test('Shared training still archives and overwrites once without institution authorization', async () => {
  const f = fixture(); f.current = null
  const writes = [], registry = { readRecipe: recipe, archiveSkill: () => writes.push('archive'), overwriteSkill: () => { writes.push('overwrite'); return { name: 'Fixture' } } }
  const generator = new f.SkillGeneratorService(registry, {})
  generator.askCodexToRefine = async () => ({})
  assert.equal((await generator.train('shared:fixture', 'Fixture refinement')).ok, true)
  assert.deepEqual(writes, ['archive', 'overwrite']); assert.equal(f.checks, 0)
})

test('script API fetch checks cancellation after an asynchronous approval boundary', async () => {
  const { runSkillScript } = load('main/maestro/drive/skillScript.ts')
  const began = deferred(), release = deferred(), controller = new AbortController(); let calls = 0
  const pending = runSkillScript({ script: "await api.fetch({url:'/fixture',method:'POST'})", replay: { apiFetch: async () => { calls++; return { ok: true, data: 'fixture' } } }, vars: {}, signal: controller.signal, onApiBeforeFetch: async () => { began.resolve(); await release.promise } })
  await began.promise; controller.abort(); release.resolve()
  assert.equal((await pending).ok, false); assert.equal(calls, 0)
})

const pathFixture = t => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), 'bl-skill-path-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const make = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path }
  const shared = make(join(root, 'skill-library/shared/a/SKILL.md'), 'Shared fixture')
  const institution = make(join(root, 'skill-library/account-a/7/a/SKILL.md'), 'Private needle fixture')
  const foreign = make(join(root, 'skill-library/account-b/8/a/SKILL.md'), 'Foreign needle fixture')
  const access = load('main/maestro/skills/skillFileAccess.service.ts', { './skillScope.context': f.context })
  return { ...f, root, shared, institution, foreign, access, change: value => { f.current = value } }
}

test('managed-path gate allows Shared offline and current institution only; outside aliases cannot bypass it', async t => {
  const f = pathFixture(t), alias = join(f.root, 'foreign-alias.md')
  symlinkSync(f.foreign, alias)
  await f.access.withSkillFileAccess(f.root, f.root, async () => {
    assert.equal(f.access.canReadSkillPath(f.root, f.shared), true)
    assert.equal(f.access.canReadSkillPath(f.root, f.institution), true)
    assert.equal(f.access.canReadSkillPath(f.root, f.foreign), false)
    assert.equal(f.access.canReadSkillPath(f.root, alias), false)
  })
  f.change(null)
  await f.access.withSkillFileAccess(f.root, f.root, async () => {
    assert.equal(f.access.canReadSkillPath(f.root, f.shared), true)
    assert.equal(f.access.canReadSkillPath(f.root, f.institution), false)
  })
})

test('actual file search never returns earlier private hits after logout during a later read', async t => {
  const f = pathFixture(t), began = deferred(), release = deferred(), held = join(f.root, 'z-wait.txt')
  writeFileSync(held, 'Public wait fixture')
  class CommonService { setState(state) { this._state = state } }
  const { WorkspaceFileService } = load('main/maestro/windows/main/workspaceFile.service.ts', {
    '@maestro-main/skills/skillFileAccess.service': f.access,
    electron: { dialog: {}, shell: {} }, 'electron-xpc/main': { createXpcMainEmitter: () => ({}), xpcMain: { broadcast() {} } },
    inversify: { injectable: () => value => value }, '@maestro-main/data/maestroDataRoot': { maestroDataRoot: () => f.root },
    '@maestro-main/files/fileReader.service': { FileReadError: class extends Error {} },
    '@maestro-main/files/workspaceArchive.service': { WorkspaceArchiveService: class {} },
    '@maestro-main/files/artifactWriter.service': {}, '@maestro-main/files/defaultWorkspace': {}, '@maestro-shared/config.api': {},
    '@maestro-shared/iocHelper/ioc.helper': { CommonService }, './previewOpener.registry': {},
    'fs/promises': { ...fsPromises, readFile: async (...args) => { if (args[0] === held) { began.resolve(); await release.promise }; return fsPromises.readFile(...args) } }
  })
  const service = new WorkspaceFileService(); service.effectiveWorkspaceRoot = () => f.root
  const pending = service.toolSearchWorkspaceFiles('fixture-session', 'needle', f.root)
  await began.promise; f.change(null); release.resolve()
  await assert.rejects(pending, /changed|unavailable/)
})
