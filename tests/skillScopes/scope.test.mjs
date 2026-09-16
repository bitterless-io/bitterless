import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skills = existsSync(join(app, 'src/main/maestro/skills')) ? 'src/main/maestro/skills' : 'src/main/skills'
const load = async entry => {
  const result = await build({ tsconfig: join(app, 'tsconfig.node.json'), entryPoints: [join(app, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'host-context', setup(builder) {
    builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
    builder.onResolve({ filter: /skillsPreset\.service$/ }, () => ({ path: 'preset', namespace: 'host' }))
    builder.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: args.path === 'scope' ? 'export const skillScopeContext={current:()=>null,authorize:async()=>null}; export const onSkillContextChanged=()=>()=>{}' : 'export const ensureSkillsPresetProject=()=>{}' }))
  } }] })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(join(app, 'package.json')), process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return module.exports
}
const { SkillRegistryService } = await load(`${skills}/skillRegistry.service.ts`)
const { SkillScopeStorage } = await load(`${skills}/skillScope.storage.ts`)
const setup = t => {
  const root = mkdtempSync(join(tmpdir(), 'skill-scope-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let current = { accountScope: 'account-a', institutionId: 'institution-a', generation: 1 }
  const context = { current: () => current, authorize: async () => current }
  return { root, registry: new SkillRegistryService(root, context), storage: new SkillScopeStorage(root, context), context, set current(value) { current = value }, get current() { return current } }
}
const file = (root, name, source = 'recording', id = name) => {
  const directory = join(root, 'skills', name); mkdirSync(directory, { recursive: true })
  const path = join(directory, 'SKILL.md')
  writeFileSync(path, `---\nname: Same name\ndescription: Fixture only\ncoach_id: ${id}\ncoach_source: ${source}\n---\nPure fixture guidance.\n`)
  return path
}

test('known shared builtin keeps stable ID and availability while logged out', t => {
  const f = setup(t), source = file(f.root, 'builtin', 'builtin')
  const bytes = readFileSync(source)
  f.current = null
  const entries = f.registry.listSkills()
  assert.equal(entries.length, 1); assert.equal(entries[0].scope, 'shared'); assert.equal(entries[0].id, 'builtin')
  assert.match(entries[0].reference, /^shared:/)
  assert.equal(f.registry.readSkillDetail(entries[0].reference).name, 'Same name')
  assert.deepEqual(readFileSync(source), bytes)
})
test('ambiguous legacy recording/import is listed for assignment but excluded from Agent', t => {
  const f = setup(t), source = file(f.root, 'legacy')
  const bytes = readFileSync(source)
  file(f.root, 'imported', 'external')
  assert.equal(f.registry.listSkills().length, 0)
  assert.equal(f.registry.listSkills(true).length, 2)
  assert.equal(f.registry.listSkills(true)[0].scope, 'unassigned')
  assert.equal(f.registry.promptContext(), '')
  assert.equal(f.registry.readSkillDetail(f.registry.listSkills(true)[0].id), null)
  assert.deepEqual(readFileSync(source), bytes)
})
test('assign Shared copies safely, preserves source bytes, and survives account changes', async t => {
  const f = setup(t), source = file(f.root, 'legacy')
  const bytes = readFileSync(source)
  const result = await f.registry.assignScope(f.registry.listSkills(true)[0].id, 'shared')
  assert.equal(result.ok, true); assert.match(result.path, /skill-library\/shared\//)
  assert.deepEqual(readFileSync(source), bytes)
  f.current = null
  const rows = f.registry.listSkills(true)
  assert.equal(rows.length, 1); assert.equal(rows[0].scope, 'shared')
  assert.equal(f.registry.readSkillDetail(rows[0].reference).body, 'Pure fixture guidance.')
})
test('institution assignment has literal ID parent and stale qualified refs stop resolving', async t => {
  const f = setup(t), source = file(f.root, 'private')
  const result = await f.registry.assignScope(f.registry.listSkills(true)[0].id, 'institution')
  assert.equal(result.ok, true); assert.match(result.path, /account-a\/institution-a\//)
  const reference = result.skill.reference
  assert.ok(f.registry.readSkillDetail(reference))
  assert.match(f.registry.promptContext(), /scope: institution/)
  assert.match(f.registry.promptContext(), /institution: institution-a/)
  f.current = { accountScope: 'account-b', institutionId: 'institution-a', generation: 2 }
  assert.equal(f.registry.listSkills().length, 0)
  assert.equal(f.registry.readSkillDetail(reference), null)
  assert.equal(f.registry.promptContext(), '')
  assert.ok(existsSync(source)); assert.ok(existsSync(result.skill.path))
})
test('same names across shared and institutional scopes remain independently addressable', async t => {
  const f = setup(t)
  file(f.root, 'one', 'recording', 'same-id'); file(f.root, 'two', 'recording', 'same-id')
  const pending = f.registry.listSkills(true)
  assert.equal(pending.length, 2)
  const shared = await f.registry.assignScope(pending[0].id, 'shared')
  const institution = await f.registry.assignScope(pending[1].id, 'institution')
  assert.equal(shared.ok, true); assert.equal(institution.ok, true)
  const rows = f.registry.listSkills(); assert.equal(rows.length, 2)
  assert.notEqual(rows[0].reference, rows[1].reference)
  for (const row of rows) assert.ok(f.registry.readSkillDetail(row.reference))
  f.current = null
  assert.equal(f.registry.listSkills().length, 1)
  assert.equal(f.registry.readSkillDetail(institution.skill.reference), null)
})
test('creation target captured before await cannot activate after context switch', async t => {
  const f = setup(t)
  let resume
  const waiting = new Promise(resolve => { resume = resolve })
  const operation = f.storage.withCreation('institution', async () => { await waiting; return f.storage.creationRoot() })
  await Promise.resolve()
  f.current = { accountScope: 'account-a', institutionId: 'institution-b', generation: 2 }; resume()
  await assert.rejects(operation, /changed/)
  f.current = null
  await assert.rejects(f.storage.withCreation('institution', async () => 1), /authorized institution/)
})
test('failed symlink assignment preserves all legacy bytes and stays quarantined', async t => {
  const f = setup(t), source = file(f.root, 'legacy')
  symlinkSync(source, join(dirname(source), 'link.md'))
  const bytes = readFileSync(source)
  const result = await f.registry.assignScope(f.registry.listSkills(true)[0].id, 'shared')
  assert.equal(result.ok, false); assert.match(result.error, /symbolic links/)
  assert.deepEqual(readFileSync(source), bytes); assert.equal(f.registry.listSkills().length, 0)
})
test('registry does not discover another context through a symlink', t => {
  const f = setup(t), foreign = join(f.root, 'skill-library', 'foreign-account', 'institution-z', 'secret')
  mkdirSync(foreign, { recursive: true }); writeFileSync(join(foreign, 'SKILL.md'), '---\nname: Private\n---\nPrivate fixture')
  mkdirSync(join(f.root, 'skills'), { recursive: true }); symlinkSync(foreign, join(f.root, 'skills', 'shortcut'))
  assert.equal(f.registry.listSkills().length, 0)
})
if (!skills.includes('maestro')) test('old flat cloud ledger without scope never becomes shared', t => {
  const f = setup(t)
  file(f.root, 'old-cloud', 'builtin')
  writeFileSync(join(f.root, 'skills', 'installed.json'), JSON.stringify({ schemaVersion: 1, skills: { 'old-cloud': { skillId: 'cloud-id', version: '1.0.0', dir: 'old-cloud', installedAt: 1 } }, blocked: {} }))
  f.current = null
  assert.equal(f.registry.listSkills().length, 0)
  assert.equal(f.registry.listSkills(true)[0].scope, 'unassigned')
})
