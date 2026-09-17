import test from 'node:test'
import assert from 'node:assert/strict'
import * as nativePi from '@earendil-works/pi-coding-agent'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const app = resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url)
const compiled = await build({ tsconfig: join(app, 'tsconfig.node.json'), stdin: { contents: [
  "export { SkillRegistryService } from './src/main/maestro/skills/skillRegistry.service'",
  "export { buildSkillCreatorTools } from './src/main/agent/tools/skillCreatorTools'",
  "export { HostToolRegistry } from './src/main/agent/runtime/hostToolRegistry'"
].join('\n'), resolveDir: app, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['virtual:bitterless-pi-skills'], plugins: [{ name: 'scope', setup(builder) {
  builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const skillScopeContext={current:()=>null,authorize:async()=>{throw new Error("Unexpected institution authorization")}}' }))
} }] })
const fixture = t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'bl-creator-')), workspace = join(root, 'workspace'), data = join(root, 'data')
  fs.mkdirSync(workspace); fs.mkdirSync(data)
  const module = { exports: {} }
  let scans = 0, selected, changes = 0
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'virtual:bitterless-pi-skills' ? { ...nativePi, loadSkillsFromDir: options => { scans++; return nativePi.loadSkillsFromDir(options) } } : require(name), process, Buffer, console })
  const registry = new module.exports.SkillRegistryService(data)
  const tool = module.exports.buildSkillCreatorTools({ workspace: () => selected, sharedRoot: () => registry.scopeStorage.shared, libraryRoot: () => registry.scopeStorage.library, changed: () => { changes++; registry.invalidate() } })[0]
  t.after(() => { registry.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, workspace, registry, tool, HostToolRegistry: module.exports.HostToolRegistry, run: async args => JSON.parse(await tool.execute(args)), get changes() { return changes }, get scans() { return scans }, set selected(value) { selected = value } }
}
const put = (root, file, content) => { const path = join(root, file); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content) }
const document = (name, extra = '') => `---\nname: ${name}\ndescription: Format fixture\n${extra}---\nCarry out the requested fixture and report the result.\n`

test('instruction initializer is discoverable, minimal and uses Shared without institution', async t => {
  const f = fixture(t)
  const before = f.registry.catalog()
  const result = await f.run({ action: 'init', name: 'explain-fixture', description: 'Explain a fixture when asked' })
  assert.equal(result.ok, true); assert.equal(result.generated, true); assert.equal(result.formatChecked, false); assert.equal(result.behaviorVerified, false)
  assert.match(result.diagnostics.join('\n'), /unfinished/)
  assert.equal(result.path, join(f.registry.scopeStorage.shared, 'explain-fixture'))
  assert.deepEqual(fs.readdirSync(result.path), ['SKILL.md'])
  assert.equal(f.changes, 1); assert.notEqual(f.registry.catalog().revision, before.revision)
  assert.ok(f.registry.listSkills().some(skill => skill.name === 'explain-fixture'))
  const warnings = [], tools = new f.HostToolRegistry({ scope: 'cowork', onWarning: (...args) => warnings.push(args) }).add(f.tool).toRuntimeTools()
  assert.equal(tools.length, 1); assert.deepEqual(warnings, [])
  assert.match(f.tool.description, /existing file tools/); assert.match(f.tool.description, /representative input/)
})

test('script initialization, authored format check and observed behavior remain distinct', async t => {
  const f = fixture(t); f.selected = f.workspace
  const result = await f.run({ action: 'init', name: 'greet-fixture', description: 'Greet a supplied fixture name', template: 'script' })
  assert.equal(result.path, join(f.workspace, '.agents/skills/greet-fixture'))
  assert.deepEqual(fs.readdirSync(result.path), ['SKILL.md', 'scripts'])
  assert.equal(result.generated, true); assert.equal(result.formatChecked, false); assert.equal(result.behaviorVerified, false)
  assert.match(fs.readFileSync(join(result.path, 'scripts/run.mjs'), 'utf8'), /implementation is unfinished/)
  put(result.path, 'SKILL.md', document('greet-fixture', 'entry: scripts/run.mjs\nresources: [references/greeting.txt]\n'))
  put(result.path, 'references/greeting.txt', 'Hello')
  let checked = await f.run({ action: 'check', path: 'greet-fixture' })
  assert.equal(checked.ok, false); assert.match(checked.diagnostics.join('\n'), /entry.*unfinished/)
  put(result.path, 'scripts/run.mjs', 'import { readFileSync } from "node:fs"; const input = JSON.parse(process.argv[2]); if (typeof input.name !== "string") throw new Error("name required"); console.log(JSON.stringify({greeting: `${readFileSync(new URL("../references/greeting.txt", import.meta.url), "utf8")} ${input.name}`}));\n')
  checked = await f.run({ action: 'check', path: result.path })
  assert.equal(checked.ok, true); assert.equal(checked.formatChecked, true); assert.equal(checked.behaviorVerified, false)
  const actual = JSON.parse(execFileSync(process.execPath, [join(result.path, 'scripts/run.mjs'), '{"name":"Fixture"}'], { cwd: f.root, encoding: 'utf8' }))
  assert.deepEqual(actual, { greeting: 'Hello Fixture' }, 'separate representative execution produces observable evidence')
  assert.equal((await f.run({ action: 'check', path: result.path, behaviorVerified: true })).behaviorVerified, false, 'caller claims cannot upgrade the format tool to behavior evidence')
  assert.equal(f.changes, 1, 'format check remains read-only')
  f.registry.catalog(f.workspace)
  const scans = f.scans
  for (let i = 0; i < 3; i++) { f.registry.catalog(f.workspace); f.registry.getPiSkills(f.workspace) }
  assert.equal(f.scans, scans, 'ordinary cached reads do not acquire creator validation work')
})

test('native metadata, TODOs and explicit entry/resource failures cannot pass format validation', async t => {
  const f = fixture(t), root = f.registry.scopeStorage.shared
  const cases = [
    ['missing-name', '---\ndescription: Valid\n---\nBody', /name is required/],
    ['missing-description', '---\nname: valid\n---\nBody', /description is required/],
    ['bad-yaml', '---\nname: [\n---\nBody', /parse|flow|stream/i],
    ['native-name', document('Invalid_Name'), /invalid characters/],
    ['todo', document('todo') + 'SKILL_CREATOR_TODO', /unfinished/],
    ['missing-entry', document('missing-entry', 'entry: scripts/missing.mjs\n'), /ENOENT/],
    ['missing-resource', document('missing-resource', 'resources: [references/missing.json]\n'), /ENOENT/],
    ['bad-resource-list', document('bad-resource-list', 'resources: not-a-list\n'), /must be a list/],
    ['escape-resource', document('escape-resource', 'entry: ../outside.mjs\n'), /relative package paths/]
  ]
  for (const [name, content, error] of cases) {
    put(root, `${name}/SKILL.md`, content)
    const result = await f.run({ action: 'check', path: name })
    assert.equal(result.formatChecked, false, name); assert.equal(result.behaviorVerified, false, name); assert.match(result.diagnostics.join('\n'), error)
  }
  put(root, 'plain/SKILL.md', document('plain'))
  assert.equal((await f.run({ action: 'check', path: 'plain' })).formatChecked, true, 'ordinary standard packages need no creator hints or sidecar')
})

test('name collisions and invalid initialization preserve existing files and clean staging', async t => {
  const f = fixture(t), root = f.registry.scopeStorage.shared
  put(root, 'retained/keep.txt', 'unchanged')
  fs.mkdirSync(join(root, 'empty'))
  fs.symlinkSync('missing', join(root, 'broken'))
  for (const name of ['retained', 'empty', 'broken', '../escape', 'Invalid_Name']) {
    const result = await f.run({ action: 'init', name, description: 'Fixture', template: 'instruction' })
    assert.equal(result.ok, false, name)
  }
  assert.equal(fs.readFileSync(join(root, 'retained/keep.txt'), 'utf8'), 'unchanged')
  assert.deepEqual(fs.readdirSync(join(root, 'empty')), []); assert.ok(fs.lstatSync(join(root, 'broken')).isSymbolicLink())
  assert.deepEqual(fs.readdirSync(root).sort(), ['broken', 'empty', 'retained']); assert.equal(f.changes, 0)
})

test('current authoring scope rejects institution, cloud and symlink escapes', async t => {
  const f = fixture(t), shared = f.registry.scopeStorage.shared, institution = join(f.registry.scopeStorage.library, 'account/institution')
  put(institution, 'secret/SKILL.md', document('secret')); put(shared, 'cloud/managed/SKILL.md', document('managed'))
  for (const path of [join(institution, 'secret'), join(shared, 'cloud/managed')]) assert.equal((await f.run({ action: 'check', path })).ok, false)
  fs.symlinkSync(institution, join(shared, 'linked'))
  assert.equal((await f.run({ action: 'check', path: 'linked/secret' })).ok, false)
  put(f.root, 'outside.mjs', 'outside'); put(shared, 'package/SKILL.md', document('package', 'entry: linked.mjs\n'))
  fs.symlinkSync(join(f.root, 'outside.mjs'), join(shared, 'package/linked.mjs'))
  assert.match((await f.run({ action: 'check', path: 'package' })).diagnostics.join('\n'), /inside this package/)
  f.selected = f.workspace
  fs.mkdirSync(join(f.workspace, '.agents')); fs.symlinkSync(institution, join(f.workspace, '.agents/skills'))
  assert.equal((await f.run({ action: 'init', name: 'blocked', description: 'Fixture' })).ok, false)
  assert.equal(fs.existsSync(join(institution, 'blocked')), false); assert.equal(f.changes, 0)
})

test('existing host disable/confirm policy gates creator initialization', async t => {
  const f = fixture(t)
  assert.equal(new f.HostToolRegistry({ scope: 'cowork', policies: { skill_creator: { mode: 'disabled' } } }).add(f.tool).toRuntimeTools().length, 0)
  let confirmed = false
  const tool = new f.HostToolRegistry({ scope: 'cowork', policies: { skill_creator: { mode: 'confirm' } }, onConfirm: async () => confirmed }).add(f.tool).toRuntimeTools()[0]
  await assert.rejects(tool.execute({ action: 'init', name: 'policy-fixture', description: 'Fixture' }), /denied/)
  assert.equal(f.changes, 0)
  confirmed = true
  assert.equal(JSON.parse(await tool.execute({ action: 'init', name: 'policy-fixture', description: 'Fixture' })).ok, true)
})
