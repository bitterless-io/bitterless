import * as nativePi from '@earendil-works/pi-coding-agent'
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
let nativeScans = 0
const countedPi = { ...nativePi, loadSkillsFromDir: options => { nativeScans++; return nativePi.loadSkillsFromDir(options) } }
const load = async entry => {
  const result = await build({ tsconfig: join(app, 'tsconfig.node.json'), entryPoints: [join(app, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'], plugins: [{ name: 'host', setup(builder) {
    builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const skillScopeContext={current:()=>null,authorize:async()=>null}; export const onSkillContextChanged=()=>()=>{}' }))
  } }] })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? countedPi : createRequire(join(app, 'package.json'))(name), process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return module.exports
}
const { SkillRegistryService } = await load('src/main/maestro/skills/skillRegistry.service.ts')
const { workspaceSkillRoots, discoverWorkspaceSkills } = await load('src/main/maestro/skills/skillDiscovery.service.ts')
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
  assert.equal(f.registry.catalog(f.workspace).revision, before.revision, 'external edits stay cached until explicit refresh')
  const after = f.registry.reload(f.workspace)
  assert.notEqual(before.revision, after.revision)
  writeFileSync(join(actual, 'SKILL.md'), '---\nname: [\n---\nbad')
  const broken = f.registry.reload(f.workspace)
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
  f.registry.reload(f.workspace)
  assert.ok(!f.registry.catalogPrompt(f.workspace).includes('secret'))
})
test('explicit reload discovers creation, rename and linked target changes without background watching', t => {
  const f = fixture(t), root = join(f.workspace, '.agents/skills')
  let changes = 0; f.registry.onChanged(() => changes++)
  assert.equal(f.registry.reload(f.workspace).skills.length, 0)
  const folder = skill(root, 'new')
  assert.equal(f.registry.reload(f.workspace).skills.length, 1)
  renameSync(folder, join(root, 'renamed'))
  const updated = f.registry.reload(f.workspace)
  assert.ok(updated.skills[0].path.includes('/renamed/'))
  writeFileSync(join(root, 'renamed', 'resource.txt'), 'Updated resource')
  assert.notEqual(f.registry.reload(f.workspace).revision, updated.revision)
  assert.equal(changes, 4)
  const source = readFileSync(join(app, 'src/main/maestro/skills/skillDiscovery.service.ts'), 'utf8')
  assert.doesNotMatch(source, /setInterval|setTimeout|\bwatch\(/)
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
  assert.equal(f.registry.catalogPrompt(f.workspace),catalog)
  f.registry.reload(f.workspace)
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

test('native prompt preserves complete metadata and skill authoring targets the explicit workspace or Global with bundled Bun', () => {
  const globalRoot = '/fixture/global skills', bunPath = "/fixture/owner's app/bun"
  const briefs = Array.from({ length: 251 }, (_, n) => ({ id: `shared:${n}`, name: `skill-${n}`, description: 'A & B <fixture>', path: `/fixture/${n}/SKILL.md`, inputs: [], triggers: [], seed: {}, missing: [] }))
  const params = { message: 'Create a reusable skill', currentUrl: '', briefs, skillAuthoring: { globalRoot, bunPath } }
  const global = buildAgentTurnPrompt(params)
  assert.equal((global.match(/<skill>/g) || []).length, 251)
  assert.ok(global.includes('<description>A &amp; B &lt;fixture&gt;</description>'))
  assert.ok(global.includes(JSON.stringify(globalRoot)))
  assert.ok(global.includes("'/fixture/owner'\\''s app/bun'"))
  const workspace = buildAgentTurnPrompt({ ...params, context: { workspace: { path: '/fixture/workspace' } } })
  assert.ok(workspace.includes('"/fixture/workspace/.agents/skills" as the package root'))
  assert.ok(!workspace.includes('"/fixture/global skills" as the package root'))
})

test('rendered installer guidance uses managed sources without unnecessary runtime installation', () => {
  for (const workspace of [undefined, { path: '/fixture/selected' }]) {
    const prompt = buildAgentTurnPrompt({ message: 'Install the skill from this npx command', currentUrl: '', briefs: [], context: { workspace }, skillAuthoring: { globalRoot: '/fixture/shared', bunPath: '/fixture/bun' } })
    assert.match(prompt, /Prefer existing tools, bundled Bun and direct HTTPS retrieval/)
    assert.match(prompt, /Treat an npx command as installation intent: identify the exact source, requested version\/ref and CLI behavior/)
    assert.match(prompt, /do not run it verbatim by default/)
    assert.match(prompt, /use bundled Bun only after verifying compatibility/)
    assert.match(prompt, /app-private Node\/npm\/Git when a required runtime is missing/)
    assert.match(prompt, /automatic runtime preparation is not implemented/)
    assert.match(prompt, /Use skill_install for supported GitHub archives, npm tarballs and HTTPS Git sources/);
    assert.match(prompt, /it records a local source ledger without executing a CLI/);
    assert.match(prompt, /Installing necessary dependencies is allowed when existing capabilities are insufficient/)
    assert.match(prompt, /never default to global installs or PATH changes/)
    assert.match(prompt, /scripts\/references\/assets and binary files/)
    assert.match(prompt, /never overwrite an existing package implicitly/)
    assert.match(prompt, /Local installation does not require an institution/)
    assert.match(prompt, /report the exact missing capability rather than claiming installation succeeded/)
    assert.ok(prompt.includes(JSON.stringify(workspace ? '/fixture/selected/.agents/skills' : '/fixture/shared') + ' as the package root'))
    assert.match(prompt, /skill_creator check for format evidence, keep behavior verification separate/)
    assert.match(prompt, /Skills Refresh or a new Chat after file-tool edits/)
  }
})

test('native traversal cannot publish a nested owned alias or invalid private workspace alias', t => {
  const f = fixture(t), privateDir = skill(join(f.data, 'skill-library/foreign/99'), 'private-skill')
  const owned = join(f.data, 'skills/nested'), workspace = join(f.workspace, '.agents/skills')
  mkdirSync(owned, { recursive: true }); mkdirSync(workspace, { recursive: true })
  symlinkSync(privateDir, join(owned, 'private-alias'))
  symlinkSync(privateDir, join(workspace, 'private-alias'))
  assert.equal(f.registry.catalog(f.workspace).skills.length, 0)
  writeFileSync(join(privateDir, 'SKILL.md'), '---\nname: [\n---\nInvalid private body')
  f.registry.reload(f.workspace)
  assert.equal(f.registry.catalog(f.workspace).skills.length, 0)
})

test('cached catalog and Pi snapshots perform no native scans until explicit reload', t => {
  const f = fixture(t), root = join(f.workspace, '.agents/skills')
  const folder = skill(root, 'cached')
  const first = f.registry.catalog(f.workspace), pi = f.registry.getPiSkills(f.workspace), scans = nativeScans
  for (let n = 0; n < 5; n++) {
    assert.equal(f.registry.catalog(f.workspace), first)
    assert.equal(f.registry.getPiSkills(f.workspace), pi)
    f.registry.catalogPrompt(f.workspace); f.registry.resourceRevision(f.workspace)
    f.registry.withWorkspace(f.workspace, () => f.registry.listSkills())
  }
  assert.equal(nativeScans, scans)
  skill(root, 'added'); rmSync(folder, { recursive: true, force: true })
  assert.equal(f.registry.catalog(f.workspace), first)
  const refreshed = f.registry.reload(f.workspace)
  assert.deepEqual(Array.from(refreshed.skills, row => row.name), ['added'])
  assert.ok(nativeScans > scans)
  const reloadedScans = nativeScans
  f.registry.getPiSkills(f.workspace); f.registry.catalogPrompt(f.workspace)
  assert.equal(nativeScans, reloadedScans)
})

test('host mutation, cloud revision and institution scope changes invalidate loaded snapshots', t => {
  const f = fixture(t)
  let cloudRevision = 0
  const registry = new SkillRegistryService(f.data, f.context, () => cloudRevision)
  t.after(() => registry.dispose())
  skill(join(f.data, 'skill-library/account/7'), 'private')
  const initial = registry.catalog(f.workspace), originalReference = initial.skills[0].reference
  const saved = registry.createRecordedSkill({ name: 'Created', description: 'Created fixture', triggers: [], inputs: [], body: 'Original', recipe: {
    id: 'created', name: 'Created', description: 'Created fixture', source: 'recording', createdAt: 1, updatedAt: 1, inputs: [], steps: [], network: [], snapshots: []
  } })
  assert.equal(registry.catalog(f.workspace).skills.length, 2)
  assert.equal(registry.deleteSkill(saved.reference).ok, true)
  assert.equal(registry.catalog(f.workspace).skills.length, 1)
  skill(join(f.data, 'skill-library/shared'), 'cloud-update')
  const beforeCloud = registry.catalog(f.workspace)
  assert.equal(beforeCloud.skills.length, 1)
  cloudRevision++
  assert.equal(registry.catalog(f.workspace).skills.length, 2)
  f.context.current = () => null
  assert.deepEqual(Array.from(registry.catalog(f.workspace).skills, row => row.name), ['cloud-update'])
  assert.equal(registry.resolveSkill(originalReference), undefined)
  const scans = nativeScans
  registry.catalog(f.workspace); registry.getPiSkills(f.workspace)
  assert.equal(nativeScans, scans)
})
