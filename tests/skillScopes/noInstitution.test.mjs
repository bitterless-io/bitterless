import * as nativePi from '@earendil-works/pi-coding-agent'
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skills = existsSync(join(app, 'src/main/maestro/skills')) ? 'src/main/maestro/skills' : 'src/main/skills'
const load = async entry => {
  const result = await build({ tsconfig: join(app, 'tsconfig.node.json'), entryPoints: [join(app, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'], plugins: [{ name: 'host-context', setup(builder) {
    builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
    builder.onResolve({ filter: /skillsPreset\.service$/ }, () => ({ path: 'preset', namespace: 'host' }))
    builder.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: args.path === 'scope' ? 'export const skillScopeContext={current:()=>null,authorize:async()=>null}; export const onSkillContextChanged=()=>()=>{}' : 'export const ensureSkillsPresetProject=()=>{}' }))
  } }] })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? nativePi : createRequire(join(app, 'package.json'))(name), process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return module.exports
}
const { SkillRegistryService } = await load(`${skills}/skillRegistry.service.ts`)
const { SkillScopeStorage } = await load(`${skills}/skillScope.storage.ts`)

// Ral, 2026-09-17: 「bl 无机构的话也别阻塞 正常的功能」 — with NO authorized institution, the Global and
// Workspace layers must keep working exactly as they do when signed in. Existing coverage only proves
// this for a Shared *builtin* (scope.test.mjs "keeps stable ID and availability while logged out"); the
// Workspace layer, a stale institution package left on disk by a previous login, and a *failing*
// authorize() were all unguarded. The upcoming Pi-native loader swap
// (docs/plan/tasks/skills-pi-native-loading-001.md) rewrites exactly this discovery path, so the
// invariant needs a test that fails if the rewrite regresses it.
const layers = ['global', 'workspace', 'institution']
const noInstitution = { current: () => null, authorize: async () => null }
const failingAuthorize = { current: () => null, authorize: async () => { throw new Error('institution backend unreachable') } }

const stage = (t, context) => {
  const base = mkdtempSync(join(tmpdir(), 'skill-no-institution-'))
  const data = join(base, 'userdata'), workspace = join(base, 'workspace')
  mkdirSync(data, { recursive: true }); mkdirSync(workspace, { recursive: true })
  const registry = new SkillRegistryService(data, context)
  const storage = new SkillScopeStorage(data, context)
  t.after(() => { registry.dispose?.(); rmSync(base, { recursive: true, force: true }) })
  return { base, data, workspace, registry, storage }
}
const pkg = (directory, name) => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} fixture package\n---\nFixture body.\n`)
  return directory
}
const seedAllThree = f => {
  pkg(join(f.data, 'skill-library', 'shared', 'probe-global'), 'probe-global')
  pkg(join(f.workspace, '.agents', 'skills', 'probe-workspace'), 'probe-workspace')
  // Left behind by a previous login: the directory is still on disk, but no context authorizes it.
  pkg(join(f.data, 'skill-library', 'stale-account', 'stale-institution', 'probe-institution'), 'probe-institution')
}
// The registry is loaded through runInNewContext, so arrays it returns carry that realm's Array
// prototype and deepStrictEqual would fail on identical values. Copy into this realm before comparing.
const own = values => [...values]
const named = (skills, name) => own(skills).filter(skill => (skill.canonicalName || skill.name) === name)
const unhealthy = skills => own(skills).filter(skill => !healthy(skill)).map(skill => skill.canonicalName || skill.name)
const healthy = skill => !skill.loadError && skill.status !== 'error'

test('no institution: Global and Workspace stay listed, ready and correctly layered', t => {
  const f = stage(t, noInstitution)
  seedAllThree(f)
  const skills = f.registry.catalog(f.workspace).skills
  const global = named(skills, 'probe-global'), workspace = named(skills, 'probe-workspace')
  assert.equal(global.length, 1, 'the Global package must still be discovered with no institution')
  assert.equal(workspace.length, 1, 'the Workspace package must still be discovered with no institution')
  assert.equal(global[0].layer, 'global')
  assert.equal(workspace[0].layer, 'workspace')
  assert.ok(healthy(global[0]), `Global package must load cleanly: ${global[0].loadError || global[0].error}`)
  assert.ok(healthy(workspace[0]), `Workspace package must load cleanly: ${workspace[0].loadError || workspace[0].error}`)
  // Both must be addressable, or they are listed but unusable. Resolution reads the workspace from
  // the registry's AsyncLocalStorage, so a Workspace skill only resolves inside withWorkspace — which
  // is how the app calls it. Without that binding a Workspace reference is simply not in scope.
  f.registry.withWorkspace(f.workspace, () => {
    for (const skill of [global[0], workspace[0]]) assert.ok(f.registry.resolveSkill(skill.reference || skill.id), `listed skill must resolve: ${skill.canonicalName || skill.name}`)
  })
})

test('no institution: a stale institution package on disk is excluded without breaking the scan', t => {
  const f = stage(t, noInstitution)
  seedAllThree(f)
  const skills = f.registry.catalog(f.workspace).skills
  assert.equal(named(skills, 'probe-institution').length, 0, 'an unauthorized institution package must not be listed')
  assert.equal(own(skills).filter(skill => skill.layer === 'institution').length, 0)
  // The stale directory must not turn the other two layers into errors, and must stay on disk.
  assert.deepEqual(unhealthy(skills), [])
  assert.ok(existsSync(join(f.data, 'skill-library', 'stale-account', 'stale-institution', 'probe-institution', 'SKILL.md')), 'discovery must not delete an unauthorized package')
})

test('no institution: a failing authorize() cannot break Global or Workspace discovery', t => {
  const f = stage(t, failingAuthorize)
  seedAllThree(f)
  const skills = f.registry.catalog(f.workspace).skills
  assert.equal(named(skills, 'probe-global').length, 1)
  assert.equal(named(skills, 'probe-workspace').length, 1)
  assert.equal(named(skills, 'probe-institution').length, 0)
  assert.deepEqual(unhealthy(skills), [])
})

test('no institution: the layer set degrades to Global + Workspace only, and new skills still target Shared', t => {
  const f = stage(t, noInstitution)
  seedAllThree(f)
  const present = new Set(own(f.registry.catalog(f.workspace).skills).map(skill => skill.layer))
  for (const layer of present) assert.ok(layers.includes(layer), `unexpected layer ${layer}`)
  assert.ok(!present.has('institution'))
  assert.equal(f.storage.institutionRoot(), null, 'there is no institution root without a context')
  assert.deepEqual(own(f.storage.roots()), [f.storage.shared], 'only the Shared root is scanned when signed out')
  assert.equal(f.storage.creationRoot(), f.storage.shared, 'authoring a new skill must still have a destination')
})

test('invalid institution metadata is ignored while Global and Workspace remain usable', t => {
  const f = stage(t, { current: () => ({ accountScope: '', institutionId: '../other', generation: '' }), authorize: async () => { throw new Error('must not authorize for discovery') } })
  seedAllThree(f)
  assert.deepEqual(own(f.registry.catalog(f.workspace).skills).map(skill => skill.layer).sort(), ['global', 'workspace'])
  assert.equal(f.storage.institutionRoot(), null)
})
