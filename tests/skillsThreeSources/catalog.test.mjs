import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const load = async entry => {
  const result = await build({ tsconfig: join(app, 'tsconfig.node.json'), entryPoints: [join(app, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'host', setup(builder) {
    builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const skillScopeContext={current:()=>null,authorize:async()=>null}; export const onSkillContextChanged=()=>()=>{}' }))
  } }] })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(join(app, 'package.json')), process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return module.exports
}
const { SkillRegistryService } = await load('src/main/maestro/skills/skillRegistry.service.ts')
const { workspaceSkillRoots, discoverWorkspaceSkills, SkillDirectoryWatcher } = await load('src/main/maestro/skills/skillDiscovery.service.ts')
const fixture = t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-three-skills-')), data = join(base, 'userdata'), workspace = join(base, 'workspace')
  mkdirSync(workspace, { recursive: true }); mkdirSync(data)
  const context = { current: () => ({ accountScope: 'account', institutionId: '7', generation: 1 }), authorize: async () => context.current() }
  const registry = new SkillRegistryService(data, context)
  t.after(() => { registry.dispose(); rmSync(base, { recursive: true, force: true }) })
  return { base, data, workspace, registry, context }
}
const skill = (root, name, body = 'Body', extra = '') => {
  const dir = join(root, name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n${extra}---\n${body}`); return dir
}

test('all three layers, duplicate names, full inventory above forty and no workspace mutation', t => {
  const f = fixture(t), root = join(f.workspace, '.agents/skills')
  skill(join(f.data, 'skill-library/shared'), 'same'); skill(root, 'same'); skill(join(f.data, 'skill-library/account/7'), 'same')
  for (let i = 0; i < 48; i++) skill(root, 'entry-' + i)
  const snapshot = f.registry.catalog(f.workspace)
  assert.equal(snapshot.skills.length, 51)
  assert.equal(new Set(snapshot.skills.map(row => row.reference)).size, 51)
  assert.deepEqual(Array.from(new Set(snapshot.skills.map(row => row.layer))).sort(), ['global','institution','workspace'])
  const catalog = f.registry.catalogPrompt(f.workspace)
  for (let i = 0; i < 48; i++) assert.ok(catalog.includes('entry-' + i))
  assert.equal(existsSync(join(f.workspace, 'AGENTS.md')), false)
  assert.deepEqual(readdirSync(join(root, 'same')), ['SKILL.md'])
  f.registry.withWorkspace(f.workspace, () => { assert.throws(() => f.registry.resolveSkill('same'), /Ambiguous/); for (const row of snapshot.skills) assert.ok(f.registry.readSkillDetail(row.reference)) })
})
test('nearest Git root, submodule and non-Git boundaries', t => {
  const f = fixture(t), nested = join(f.workspace, 'nested/deep')
  mkdirSync(nested, { recursive: true }); mkdirSync(join(f.workspace, '.git'))
  assert.equal(workspaceSkillRoots(nested).length, 3)
  writeFileSync(join(f.workspace, 'nested/.git'), 'gitdir: ../elsewhere')
  assert.equal(workspaceSkillRoots(nested).length, 2)
  assert.equal(workspaceSkillRoots(f.data).length, 1)
})
test('linked skills deduplicate, auxiliary changes revise, malformed YAML is unavailable', t => {
  const f = fixture(t), root = join(f.workspace, '.agents/skills'), actual = skill(join(f.base, 'external'), 'linked')
  mkdirSync(root, { recursive: true }); symlinkSync(actual, join(root, 'alias-a')); symlinkSync(actual, join(root, 'alias-b')); symlinkSync(root, join(actual, 'cycle'))
  assert.equal(discoverWorkspaceSkills(f.workspace).length, 1)
  const before = f.registry.catalog(f.workspace)
  writeFileSync(join(actual, 'reference.txt'), 'Updated resource')
  const after = f.registry.catalog(f.workspace)
  assert.notEqual(before.revision, after.revision)
  writeFileSync(join(actual, 'SKILL.md'), '---\nname: [\n---\nbad')
  const broken = f.registry.catalog(f.workspace)
  assert.equal(broken.skills[0].status, 'error')
  assert.equal(f.registry.withWorkspace(f.workspace, () => f.registry.listSkills()).length, 0)
})
test('separate Chat workspaces and private symlink cannot become workspace or global', t => {
  const f = fixture(t), other = join(f.base, 'other'), root = join(f.workspace, '.agents/skills')
  skill(root, 'chat-a'); skill(join(other, '.agents/skills'), 'chat-b')
  assert.ok(f.registry.catalogPrompt(f.workspace).includes('chat-a')); assert.ok(!f.registry.catalogPrompt(other).includes('chat-a'))
  const secret = skill(join(f.data, 'skill-library/foreign/99'), 'secret')
  symlinkSync(secret, join(root, 'private-alias'))
  mkdirSync(join(f.data, 'skills'), { recursive: true }); symlinkSync(secret, join(f.data, 'skills/leak'))
  assert.ok(!f.registry.catalogPrompt(f.workspace).includes('secret'))
})
test('watch missing directories, rename and linked target changes without restart', async t => {
  const f = fixture(t), root = join(f.workspace, '.agents/skills')
  let changes = 0; const watcher = new SkillDirectoryWatcher(() => changes++)
  t.after(() => watcher.dispose()); watcher.update([root])
  skill(root, 'new'); for (let i = 0; i < 20 && changes < 1; i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(changes >= 1); const count = changes
  renameSync(join(root, 'new'), join(root, 'renamed')); for (let i = 0; i < 20 && changes <= count; i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(changes > count)
})

const { buildAgentTurnPrompt } = await load('src/main/agent/runtime/agentPrompt.ts')
const { appendCurrentSkillCatalog } = await load('src/main/agent/runtime/skillCatalogRequest.ts')
test('prompt and request catalog helpers refresh without history rewrite and reject overflow', t => {
  const f=fixture(t), root=join(f.workspace,'.agents/skills'); const dir=skill(root,'changing','Original')
  const catalog=f.registry.catalogPrompt(f.workspace)
  const pending=buildAgentTurnPrompt({ message:'Inspect skills', currentUrl:'', briefs:[], catalog })
  const history=[{ role:'user', content:pending, timestamp:1 }]
  const request=appendCurrentSkillCatalog({messages:history,catalog,contextWindow:262144,maxTokens:8192,systemPrompt:'Fixture'})
  assert.ok(pending.includes(request.at(-1).content)); assert.equal(history.length,1)
  writeFileSync(join(dir,'assets.txt'),'Resource revision 2')
  const newer=f.registry.catalogPrompt(f.workspace)
  assert.notEqual(newer,catalog)
  const follow=appendCurrentSkillCatalog({messages:history,catalog:newer,contextWindow:262144,maxTokens:8192,systemPrompt:'Fixture'})
  assert.equal(follow.at(-1).content,newer); assert.equal(history[0].content,pending)
  assert.throws(()=>appendCurrentSkillCatalog({messages:history,catalog:newer,contextWindow:10,maxTokens:10,systemPrompt:'Fixture'}),/no skills were silently omitted/)
})

test('workspace folder, canonical YAML name and sidecar display name remain distinct', t => {
  const f = fixture(t), dir = skill(join(f.workspace, '.agents/skills'), 'review-package')
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: code-review\ndescription: Canonical review instructions\n---\nReview the code.')
  mkdirSync(join(dir, 'agents')); writeFileSync(join(dir, 'agents/openai.yaml'), 'interface:\n  display_name: Friendly Review\n')
  const row = f.registry.catalog(f.workspace).skills[0]
  assert.equal(row.name, 'code-review'); assert.equal(row.canonicalName, 'code-review'); assert.equal(row.displayName, 'Friendly Review')
  f.registry.withWorkspace(f.workspace, () => {
    assert.equal(f.registry.resolveSkill('code-review').reference, row.reference)
    assert.equal(f.registry.resolveSkill('review-package'), undefined)
    assert.equal(f.registry.resolveSkill('Friendly Review'), undefined)
  })
  assert.ok(f.registry.catalogPrompt(f.workspace).includes('"name":"code-review"'))
})

test('legacy recording names keep their existing behavior and also resolve their canonical YAML name', t => {
  const f = fixture(t), dir = skill(join(f.data, 'skill-library/shared'), 'recording-folder')
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: recorded-login\ndescription: Login fixture\ncoach_source: recording\ncoach_display_name: Recorded Login\n---\nLegacy instructions.')
  const row = f.registry.catalog(f.workspace).skills[0]
  assert.equal(row.name, 'Recorded Login'); assert.equal(row.canonicalName, 'recorded-login')
  assert.equal(f.registry.resolveSkill('Recorded Login').reference, row.reference)
  assert.equal(f.registry.resolveSkill('recorded-login').reference, row.reference)
})

test('registry refuses archive, overwrite and delete for every read-only source while local recordings remain writable', t => {
  const f = fixture(t)
  const local = f.registry.createRecordedSkill({ name: 'Local recording', description: 'Writable fixture', triggers: [], inputs: [], body: 'Original local body', recipe: {
    id: 'fixture', name: 'Local recording', description: 'Writable fixture', source: 'recording', sourceUrl: 'https://fixture.invalid', createdAt: 1, updatedAt: 1,
    inputs: [], aliases: [], shortcuts: [], keywords: [], triggers: [], steps: [], network: [], snapshots: []
  } })
  const ref = local.reference, originalResolve = f.registry.resolveSkill.bind(f.registry)
  const recipe = f.registry.readRecipe(ref), before = readFileSync(local.path, 'utf8'), beforeRecipe = readFileSync(local.recipePath, 'utf8')
  for (const metadata of [{ readonly: true }, { managed: true }, { layer: 'workspace' }, { layer: 'institution' }, { scope: 'institution' }, { source: 'builtin' }]) {
    f.registry.resolveSkill = input => input === ref ? { ...local, ...metadata } : originalResolve(input)
    assert.throws(() => f.registry.archiveSkill(ref), /read-only/)
    assert.throws(() => f.registry.overwriteSkill(ref, { recipe, body: 'Must not write' }), /read-only/)
    assert.equal(f.registry.deleteSkill(ref).ok, false)
    assert.equal(readFileSync(local.path, 'utf8'), before)
    assert.equal(readFileSync(local.recipePath, 'utf8'), beforeRecipe)
    assert.equal(existsSync(join(dirname(local.path), 'archive')), false)
  }
  f.registry.resolveSkill = originalResolve
  assert.equal(f.registry.archiveSkill(ref), true)
  assert.ok(f.registry.overwriteSkill(ref, { recipe, body: 'Updated local body' }))
  assert.ok(readFileSync(local.path, 'utf8').includes('Updated local body'))
})
