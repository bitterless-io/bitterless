import test from 'node:test'
import assert from 'node:assert/strict'
import * as nativePi from '@earendil-works/pi-coding-agent'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as fs from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const app = resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url)
const compiled = await build({ tsconfig: join(app, 'tsconfig.node.json'), stdin: { contents: [
  "export { SkillRegistryService } from './src/main/maestro/skills/skillRegistry.service'",
  "export { selectedSkillPrompt } from './src/main/maestro/skills/skillSelection'",
  "export { resolveAuthorizedSkill } from './src/main/maestro/skills/skillScope.context'",
  "export { diagnoseSkill } from './src/main/maestro/skills/skillDiagnostics'",
  "export { SkillPickerStore } from './src/renderer/maestro/control/src/store/skillPicker.store'"
].join('\n'), resolveDir: app, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['virtual:bitterless-pi-skills'], plugins: [{ name: 'scope', setup(builder) {
  builder.onResolve({ filter: /assetScope\.service$/ }, () => ({ path: 'scope', namespace: 'host' }))
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const assetScope=globalThis.__assetScope' }))
} }] })
const put = (root, file, content) => { const path = join(root, file); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content); return path }
const skill = (root, directory, body, extra = '') => put(root, `${directory}/SKILL.md`, `---\nname: same-name\ndescription: Fixture\n${extra}---\n${body}`)
const fixture = t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'bl-skill-p1-')), data = join(root, 'data'), workspace = join(root, 'workspace')
  fs.mkdirSync(data); fs.mkdirSync(workspace)
  const scope = { current: null, revalidate: async () => {}, subscribe: () => () => {} }, module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'virtual:bitterless-pi-skills' ? nativePi : require(name), process, Buffer, console, __assetScope: scope })
  const registry = new module.exports.SkillRegistryService(data)
  t.after(() => { registry.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, data, workspace, registry, scope, ...module.exports }
}

test('qualified picker selection binds the exact source and loads explicit-only current instructions', async t => {
  const f = fixture(t)
  skill(f.registry.scopeStorage.shared, 'shared-copy', 'Shared instructions')
  skill(join(f.workspace, '.agents/skills'), 'workspace-copy', 'Workspace explicit instructions', 'disable-model-invocation: true\n')
  const catalog = f.registry.catalog(f.workspace), picker = new f.SkillPickerStore({ skillCatalog: async () => catalog }, () => 'chat-a')
  await picker.open(); assert.equal(picker.filtered.length, 2)
  const selected = picker.filtered.find(row => row.layer === 'workspace')
  assert.equal(selected.allowImplicitInvocation, false); picker.pick(selected)
  assert.equal(picker.selected.reference, selected.reference); assert.equal(picker.selected.layer, 'workspace')
  const prompt = await f.registry.withWorkspace(f.workspace, () => f.selectedSkillPrompt(f.registry, picker.selected.reference))
  assert.match(prompt, /Workspace explicit instructions/); assert.ok(!prompt.includes('Shared instructions'))
  await assert.rejects(f.registry.withWorkspace(f.workspace, () => f.selectedSkillPrompt(f.registry, 'same-name')), /unavailable/)
  fs.unlinkSync(selected.path)
  await assert.rejects(f.registry.withWorkspace(f.workspace, () => f.selectedSkillPrompt(f.registry, selected.reference)), /deleted|cannot be read/)
})

test('institution selection is rejected after revocation without falling back to a shared namesake', async t => {
  const f = fixture(t); f.scope.current = { namespace: 'account', institutionId: 7, generation: 1 }
  skill(f.registry.scopeStorage.shared, 'shared-copy', 'Shared instructions')
  skill(f.registry.scopeStorage.institutionRoot(), 'institution-copy', 'Institution instructions')
  const selected = f.registry.catalog().skills.find(row => row.scope === 'institution')
  f.scope.revalidate = async () => { f.scope.current = null }
  await assert.rejects(f.selectedSkillPrompt(f.registry, selected.reference), /revoked|changed/)
  assert.equal(f.registry.catalog().skills.length, 1)
})

test('picker ignores stale requests after changing Chat and leaves unavailable rows unselected', async t => {
  const f = fixture(t); let release, sessionId = 'first'
  const pending = new Promise(resolve => { release = resolve })
  const picker = new f.SkillPickerStore({ skillCatalog: async () => pending }, () => sessionId)
  const opened = picker.open(); sessionId = 'second'; picker.reset()
  release({ skills: [{ name: 'stale' }] }); await opened
  assert.equal(picker.items.length, 0)
  picker.pick({ reference: 'shared:error', name: 'broken', status: 'error' }); assert.equal(picker.selected, undefined)
  picker.pick({ reference: 'shared:disabled', name: 'disabled', status: 'ready', enabled: false }); assert.equal(picker.selected, undefined)
})

test('disabled stable identities survive restart and revisions while management and namesakes remain available', async t => {
  const f = fixture(t)
  const file = skill(f.registry.scopeStorage.shared, 'shared-copy', 'Shared instructions')
  skill(join(f.workspace, '.agents/skills'), 'workspace-copy', 'Workspace instructions')
  const selected = f.registry.catalog(f.workspace).skills.find(row => row.layer === 'global')
  const running = await f.registry.withWorkspace(f.workspace, () => f.resolveAuthorizedSkill(f.registry, selected.reference))
  f.registry.withWorkspace(f.workspace, () => f.registry.setSkillEnabled(selected.reference, false))
  assert.equal(fs.existsSync(file), true)
  assert.equal(f.registry.catalog(f.workspace).skills.find(row => row.reference === selected.reference).enabled, false)
  assert.equal(f.registry.withWorkspace(f.workspace, () => f.registry.resolveSkill(selected.reference)), undefined)
  assert.ok(f.registry.withWorkspace(f.workspace, () => f.registry.readSkillDetail(selected.reference, true)).body.includes('Shared instructions'))
  assert.equal(f.registry.getPiSkills(f.workspace).skills.length, 1)
  assert.ok(!f.registry.catalogPrompt(f.workspace).includes(selected.reference))
  await assert.rejects(f.registry.withWorkspace(f.workspace, () => f.selectedSkillPrompt(f.registry, selected.reference)), /disabled/)
  await assert.rejects(f.registry.withWorkspace(f.workspace, () => running.guard()), /disabled|unavailable/)
  put(f.registry.scopeStorage.shared, 'shared-copy/SKILL.md', '---\nname: renamed\ndescription: Changed content\n---\nNew instructions')
  const restarted = new f.SkillRegistryService(f.data); t.after(() => restarted.dispose())
  assert.equal(restarted.catalog(f.workspace).skills.find(row => row.reference === selected.reference).enabled, false)
  restarted.withWorkspace(f.workspace, () => restarted.setSkillEnabled(selected.reference, true))
  assert.equal(restarted.getPiSkills(f.workspace).skills.length, 2)
  assert.ok(fs.existsSync(file))
})

test('enabling cannot revive an unauthorized institution and generation changes preserve disabled identity', t => {
  const f = fixture(t); f.scope.current = { namespace: 'account', institutionId: 7, generation: 1 }
  skill(f.registry.scopeStorage.institutionRoot(), 'private', 'Private instructions')
  const selected = f.registry.catalog().skills[0]
  f.registry.setSkillEnabled(selected.reference, false)
  f.scope.current.generation = 2
  assert.equal(f.registry.catalog().skills[0].enabled, false)
  f.scope.current = null
  assert.throws(() => f.registry.setSkillEnabled(selected.reference, true), /unavailable/)
  assert.equal(f.registry.catalog().skills.length, 0)
})

test('read-only diagnostics report missing entry, interpreter and declared dependencies, then restored conditions', t => {
  const f = fixture(t), directory = join(f.root, 'diagnostic'), binaries = join(f.root, 'bin'), bunPath = join(binaries, 'bun')
  skill(directory, '.', 'Fixture', 'entry: scripts/run.mjs\ndependencies: [fixture-tool]\n')
  put(directory, 'package.json', '{"dependencies":{"fixture-package":"1.0.0"}}')
  const options = { directory, bunPath, env: { PATH: binaries } }
  let result = f.diagnoseSkill(options)
  assert.equal(result.status, 'missing'); assert.equal(result.behaviorVerified, false)
  for (const kind of ['entry', 'interpreter', 'command', 'package']) assert.ok(result.checks.some(check => check.kind === kind && check.status === 'missing' && check.repair))
  assert.equal(fs.existsSync(binaries), false, 'diagnostics never prepares a runtime')
  put(directory, 'scripts/run.mjs', 'import value from "fixture-package"; console.log(JSON.stringify({result:value}));')
  put(directory, 'node_modules/fixture-package/package.json', '{"name":"fixture-package","version":"1.0.0","main":"index.js"}')
  put(directory, 'node_modules/fixture-package/index.js', 'module.exports = "ready"')
  put(binaries, 'bun', '#!/bin/sh\nexit 99\n'); fs.chmodSync(bunPath, 0o755)
  put(binaries, 'fixture-tool', '#!/bin/sh\nexit 99\n'); fs.chmodSync(join(binaries, 'fixture-tool'), 0o755)
  result = f.diagnoseSkill(options)
  assert.equal(result.status, 'ready'); assert.equal(result.behaviorVerified, false)
  assert.ok(result.checks.every(check => check.status === 'ready'))
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [join(directory, 'scripts/run.mjs')], { encoding: 'utf8' })), { result: 'ready' }, 'representative execution is separate from diagnostics')
})

test('diagnostics distinguish instruction-only and unknown declarations, and reject escaped entry links', t => {
  const f = fixture(t), directory = join(f.root, 'plain'), bunPath = join(f.root, 'missing-bun')
  skill(directory, '.', 'Follow instructions')
  let result = f.diagnoseSkill({ directory, bunPath })
  assert.equal(result.status, 'ready'); assert.match(result.checks[0].detail, /No script entry declared/)
  skill(directory, '.', 'Fixture', 'entry: script.custom\n')
  put(directory, 'script.custom', 'fixture')
  result = f.diagnoseSkill({ directory, bunPath })
  assert.equal(result.status, 'unknown'); assert.ok(result.checks.some(check => check.kind === 'interpreter' && check.status === 'unknown'))
  fs.unlinkSync(join(directory, 'script.custom')); put(f.root, 'external.custom', 'external'); fs.symlinkSync(join(f.root, 'external.custom'), join(directory, 'script.custom'))
  result = f.diagnoseSkill({ directory, bunPath })
  assert.equal(result.status, 'missing'); assert.ok(result.checks.some(check => check.kind === 'entry' && check.status === 'missing'))
})
