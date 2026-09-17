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
  "export { publishSkillPackage } from './src/main/maestro/skills/skillPackage'"
].join('\n'), resolveDir: app, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'], plugins: [{ name: 'scope', setup(builder) {
  builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const skillScopeContext={current:()=>null,authorize:async()=>null}' }))
} }] })

const fixture = t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'bl-package-roundtrip-')), data = join(root, 'data'), source = join(root, 'source'), exports = join(root, 'exports')
  fs.mkdirSync(data); fs.mkdirSync(source); fs.mkdirSync(exports)
  let fault, current = null
  const hostFs = { ...fs,
    copyFileSync: (...args) => { if (fault === 'copy') throw new Error('fixture copy failure'); return fs.copyFileSync(...args) },
    renameSync: (...args) => { if (fault === 'publish') throw new Error('fixture publish failure'); return fs.renameSync(...args) }
  }
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => {
    if (['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name)) return nativePi
    if (['node:fs', 'fs'].includes(name)) return hostFs
    return require(name)
  }, process, Buffer, console, Date: class extends Date { static now() { return 1800000000000 } } })
  const context = { current: () => current, authorize: async () => current }
  const registry = new module.exports.SkillRegistryService(data, context)
  t.after(() => { registry.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, data, source, exports, registry, publish: module.exports.publishSkillPackage,
    set fault(value) { fault = value }, set current(value) { current = value } }
}
const put = (root, path, value) => { const file = join(root, path); fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file }
const standard = root => put(root, 'SKILL.md', '---\nname: roundtrip\ndescription: Read packaged resources\n---\nRun scripts/nested/check.mjs.\n')
const files = root => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).sort() : []
const noStage = root => assert.ok(files(root).every(file => !file.split('/').some(part => part.startsWith('.skill-stage-'))))

test('standard package import, local execution, export and re-import preserve the entire resource tree', t => {
  const f = fixture(t); standard(f.source)
  const resources = {
    'scripts/nested/check.mjs': "import { readFileSync } from 'node:fs'; const message = JSON.parse(readFileSync(new URL('../../references/data/message.json', import.meta.url))); const bytes = readFileSync(new URL('../../assets/probe.bin', import.meta.url)); console.log(JSON.stringify({ ok: message.ok, assetHex: bytes.toString('hex') }));\n",
    'references/data/message.json': '{"ok":true}\n',
    'assets/probe.bin': Buffer.from([0, 1, 2, 127, 128, 254, 255]),
    'agents/openai.yaml': 'interface:\n  display_name: Roundtrip Skill\n',
    'agents/extra.json': '{"preserved":true}', '.config/settings': 'hidden resource',
    'scripts/vendor/node_modules/fixture/data.bin': Buffer.from([255, 0, 24])
  }
  for (const [path, bytes] of Object.entries(resources)) put(f.source, path, bytes)
  fs.mkdirSync(join(f.source, 'assets/empty')); fs.chmodSync(join(f.source, 'scripts/nested/check.mjs'), 0o755)
  const original = fs.readFileSync(join(f.source, 'SKILL.md'))
  const imported = f.registry.importSkillPackage(f.source)
  assert.equal(imported.ok, true, imported.error); assert.equal(imported.skill.scope, 'shared')
  assert.equal(f.registry.readSkillDetail(imported.skill.reference).externalOnly, true)
  assert.equal(fs.existsSync(join(imported.path, 'recipe.json')), false)
  const exported = f.registry.exportSkillPackage(imported.skill.reference, f.exports)
  assert.equal(exported.ok, true, exported.error)
  const again = f.registry.importSkillPackage(exported.path)
  assert.equal(again.ok, true, again.error)
  for (const root of [imported.path, exported.path, again.path]) {
    for (const [path, bytes] of Object.entries(resources)) assert.deepEqual(fs.readFileSync(join(root, path)), Buffer.from(bytes), path)
    assert.ok(fs.statSync(join(root, 'assets/empty')).isDirectory())
    assert.equal(fs.statSync(join(root, 'scripts/nested/check.mjs')).mode & 0o777, 0o755)
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/nested/check.mjs')], { cwd: f.root, encoding: 'utf8' })), { ok: true, assetHex: '0001027f80feff' })
  }
  const manifest = JSON.parse(fs.readFileSync(join(exported.path, 'coach-export.json'), 'utf8'))
  for (const path of Object.keys(resources)) assert.ok(manifest.files.includes(path), path)
  assert.deepEqual(fs.readFileSync(join(f.source, 'SKILL.md')), original, 'source never changes')
  noStage(f.data); noStage(f.exports)
})

test('existing import/export destinations, including empty directories, are preserved', t => {
  const f = fixture(t); standard(f.source)
  const planned = join(f.data, 'skill-library/shared/external/1800000000000-roundtrip')
  fs.mkdirSync(planned, { recursive: true }); put(planned, 'keep.txt', 'retained')
  const first = f.registry.importSkillPackage(f.source), second = f.registry.importSkillPackage(f.source)
  assert.equal(first.ok, true, first.error); assert.equal(second.ok, true, second.error)
  assert.notEqual(first.path, second.path); assert.notEqual(first.path, planned)
  assert.equal(fs.readFileSync(join(planned, 'keep.txt'), 'utf8'), 'retained')
  const exportCollision = join(f.exports, 'roundtrip-coach-skill'); fs.mkdirSync(exportCollision)
  const output = f.registry.exportSkillPackage(first.skill.reference, f.exports)
  assert.equal(output.ok, true, output.error); assert.notEqual(output.path, exportCollision)
  assert.deepEqual(fs.readdirSync(exportCollision), [])
})

test('valid in-package file and directory links become usable relative resources', t => {
  const f = fixture(t); standard(f.source); put(f.source, 'references/nested/data.txt', 'linked bytes')
  fs.symlinkSync('references/nested/data.txt', join(f.source, 'linked.txt'))
  fs.symlinkSync('references/nested', join(f.source, 'linked-dir'))
  const output = f.registry.importSkillPackage(f.source)
  assert.equal(output.ok, true, output.error)
  assert.equal(fs.lstatSync(join(output.path, 'linked.txt')).isFile(), true)
  assert.equal(fs.readFileSync(join(output.path, 'linked-dir/data.txt'), 'utf8'), 'linked bytes')
})

for (const variant of ['escape', 'broken', 'cycle', 'unsafe-name', 'special-entry']) test(`unsafe package ${variant} fails explicitly without partial installation`, t => {
  const f = fixture(t); standard(f.source)
  if (variant === 'escape') { put(f.root, 'outside.txt', 'outside'); fs.symlinkSync('../outside.txt', join(f.source, 'link')) }
  if (variant === 'broken') fs.symlinkSync('missing', join(f.source, 'link'))
  if (variant === 'cycle') fs.symlinkSync('.', join(f.source, 'link'))
  if (variant === 'unsafe-name') put(f.source, 'unsafe\\name.txt', 'unsafe')
  if (variant === 'special-entry') execFileSync('mkfifo', [join(f.source, 'pipe')])
  const result = f.registry.importSkillPackage(f.source)
  assert.equal(result.ok, false); assert.match(result.error, /escapes|broken|Cyclic|Unsafe|Unsupported/)
  assert.equal(f.registry.listSkills().length, 0); noStage(f.data)
  assert.equal(fs.existsSync(join(f.source, 'SKILL.md')), true)
})

test('copy, normalization, native metadata and publication failures roll back hidden staging', t => {
  const f = fixture(t); standard(f.source)
  const original = f.registry.importSkillPackage(f.source); assert.equal(original.ok, true, original.error)
  const revision = f.registry.catalog().revision, installed = files(f.data)
  for (const fault of ['copy', 'publish']) {
    f.fault = fault
    const imported = f.registry.importSkillPackage(f.source)
    assert.equal(imported.ok, false); assert.match(imported.error, /fixture/)
    const exported = f.registry.exportSkillPackage(original.skill.reference, f.exports)
    assert.equal(exported.ok, false); assert.match(exported.error, /fixture/)
    f.fault = undefined
    assert.deepEqual(files(f.data), installed); assert.deepEqual(fs.readdirSync(f.exports), [])
    assert.equal(f.registry.catalog().revision, revision)
  }
  fs.mkdirSync(join(f.source, 'coach-import.json'))
  const conflict = f.registry.importSkillPackage(f.source); assert.equal(conflict.ok, false); assert.match(conflict.error, /EISDIR/)
  fs.rmdirSync(join(f.source, 'coach-import.json'))
  put(f.source, 'agents/openai.yaml', 'interface: [')
  const invalid = f.registry.importSkillPackage(f.source); assert.equal(invalid.ok, false)
  assert.deepEqual(files(f.data), installed); assert.equal(f.registry.catalog().revision, revision)
  noStage(f.data); noStage(f.exports)
})

test('the staging directory is undiscoverable and an existing destination is never overwritten', t => {
  const f = fixture(t); standard(f.source)
  const target = join(f.data, 'skill-library/shared/staged')
  const result = f.publish(f.source, target, stage => {
    assert.ok(fs.existsSync(join(stage, 'SKILL.md')))
    assert.equal(fs.existsSync(target), false)
    assert.equal(f.registry.reload().skills.length, 0)
    fs.mkdirSync(target); put(target, 'keep.txt', 'created during staging')
  })
  assert.notEqual(result, target); assert.equal(fs.readFileSync(join(target, 'keep.txt'), 'utf8'), 'created during staging')
  assert.equal(f.registry.reload().skills.length, 1)
})

test('export rejects an escaping resource introduced after catalog loading and preserves prior exports', t => {
  const f = fixture(t); standard(f.source)
  const imported = f.registry.importSkillPackage(f.source); assert.equal(imported.ok, true, imported.error)
  const previous = f.registry.exportSkillPackage(imported.skill.reference, f.exports); assert.equal(previous.ok, true, previous.error)
  const before = files(f.exports), bytes = fs.readFileSync(join(previous.path, 'SKILL.md'))
  put(f.root, 'outside.txt', 'outside')
  fs.symlinkSync(join(f.root, 'outside.txt'), join(imported.path, 'escaping-link'))
  const rejected = f.registry.exportSkillPackage(imported.skill.reference, f.exports)
  assert.equal(rejected.ok, false); assert.match(rejected.error, /escapes/)
  assert.deepEqual(files(f.exports), before)
  assert.deepEqual(fs.readFileSync(join(previous.path, 'SKILL.md')), bytes)
  noStage(f.exports)
})

test('scope provenance, stale institution references and source boundaries remain enforced', async t => {
  const f = fixture(t); standard(f.source)
  f.current = { accountScope: 'account', institutionId: '7', generation: 1 }
  const imported = await f.registry.scopeStorage.withCreation('institution', async () => f.registry.importSkillPackage(f.source))
  assert.equal(imported.ok, true, imported.error); assert.equal(imported.skill.scope, 'institution')
  f.current = null
  assert.equal(f.registry.listSkills().length, 0)
  assert.equal(f.registry.exportSkillPackage(imported.skill.reference, f.exports).ok, false)
  fs.symlinkSync(imported.path, join(f.root, 'private-alias'))
  assert.equal(f.registry.importSkillPackage(join(f.root, 'private-alias')).error, 'already-installed')
  const global = f.registry.importSkillPackage(f.source); assert.equal(global.ok, true, global.error); assert.equal(global.skill.scope, 'shared')
  assert.equal(f.registry.exportSkillPackage(global.skill.reference, join(global.path, 'assets')).ok, false)
  assert.equal(f.registry.importSkillPackage(join(f.source, 'SKILL.md')).error, 'not-a-directory')
})
