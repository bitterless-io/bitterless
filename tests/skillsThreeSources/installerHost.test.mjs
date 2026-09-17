import test from 'node:test'
import assert from 'node:assert/strict'
import * as nativePi from '@earendil-works/pi-coding-agent'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as fs from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const app = resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), AdmZip = require('adm-zip')
const compiled = await build({ tsconfig: join(app, 'tsconfig.node.json'), stdin: { contents: [
  "export { buildSkillInstallTools } from './src/main/agent/tools/skillInstallTools'",
  "export { HostToolRegistry } from './src/main/agent/runtime/hostToolRegistry'",
  "export { BaseAgent } from './src/main/agent/BaseAgent'",
  "export { bindPiTools } from './src/main/agent/runtime/piRuntimeProtocol'",
  "export { SkillRegistryService } from './src/main/maestro/skills/skillRegistry.service'"
].join('\n'), resolveDir: app, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['virtual:bitterless-pi-skills'], plugins: [{ name: 'scope', setup(builder) {
  builder.onResolve({ filter: /modelIoLog$/ }, () => ({ path: 'log', namespace: 'logging' }))
  builder.onLoad({ filter: /.*/, namespace: 'logging' }, () => ({ contents: 'export const modelIoLog={append(){},openSession(){}}' }))
  builder.onResolve({ filter: /assetScope\.service$/ }, () => ({ path: 'scope', namespace: 'host' }))
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const assetScope=globalThis.__assetScope' }))
} }] })
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'bl-install-host-')), data = join(root, 'data'), workspace = join(root, 'workspace')
  fs.mkdirSync(data); fs.mkdirSync(workspace)
  const module = { exports: {} }, scope = { current: null, revalidate: async () => { throw new Error('Local installer must not authorize institution') }, subscribe: () => () => {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: n => n === 'virtual:bitterless-pi-skills' ? nativePi : require(n), process, Buffer, console, URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout, __assetScope: scope })
  const api = module.exports, registry = new api.SkillRegistryService(data), state = { workspace, identity: 'none', commit: '1'.repeat(40), changes: 0, requests: 0, body: 'Initial', intercept: undefined }
  const fetch = async (input, init) => {
    state.requests++; await state.intercept?.(String(input), init)
    if (String(input).includes('/commits/')) return Response.json({ sha: state.commit })
    if (String(input).includes('/zipball/')) {
      const zip = new AdmZip()
      zip.addFile('source/skills/fixture/SKILL.md', Buffer.from(`---\nname: fixture\ndescription: Installer fixture\n---\n${state.body}\n`))
      zip.addFile('source/lib/resource.bin', Buffer.from([0, 128, 255])); return new Response(zip.toBuffer())
    }
    return Response.json({ default_branch: 'main' })
  }
  const host = { workspace: () => state.workspace, identity: () => state.identity, sharedRoot: () => registry.scopeStorage.shared, libraryRoot: () => registry.scopeStorage.library, stateRoot: () => join(data, 'installer'), changed: () => { state.changes++; registry.invalidate() }, fetch }
  const tool = api.buildSkillInstallTools(host)[0]
  const call = async (args, signal, context) => JSON.parse(await tool.execute(args, signal, context))
  t.after(() => { registry.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
  return { ...api, root, data, workspace, registry, state, host, tool, call }
}
const input = 'npx skills add owner/repo'

test('local install uses explicit workspace, warms registry cache, persists ledger and protects edits', async t => {
  const f = fixture(t); assert.equal(f.registry.catalog(f.workspace).skills.length, 0)
  const preview = await f.call({ action: 'inspect', input })
  assert.equal(preview.scope, 'workspace'); assert.equal(f.state.changes, 0)
  const installed = await f.call({ action: 'install', inspection_id: preview.inspection.id })
  const record = installed.installation
  assert.equal(f.registry.catalog(f.workspace).skills.length, 1); assert.equal(f.state.changes, 1)
  assert.equal(fs.readFileSync(join(record.destination, 'lib/resource.bin')).toString('hex'), '0080ff')
  assert.equal((await f.call({ action: 'list' })).installations[0].id, record.id)
  f.state.commit = '2'.repeat(40); f.state.body = 'Updated'
  const updated = await f.call({ action: 'update', installation_id: record.id })
  assert.equal(updated.installation.source.resolvedCommit, f.state.commit)
  const file = join(record.destination, 'skills/fixture/SKILL.md'), text = fs.readFileSync(file, 'utf8')
  fs.appendFileSync(file, 'Local change')
  assert.equal((await f.call({ action: 'list' })).installations[0].status, 'modified')
  await assert.rejects(f.call({ action: 'remove', installation_id: record.id }), /modified|local/i)
  fs.writeFileSync(file, text)
  await f.call({ action: 'remove', installation_id: record.id })
  assert.equal(f.registry.catalog(f.workspace).skills.length, 0); assert.equal(f.state.changes, 3)
})

test('global flags and no selected workspace use Shared without institution; unsupported commands publish nothing', async t => {
  const f = fixture(t)
  const result = await f.call({ action: 'install', input: input + ' --global' })
  assert.equal(result.scope, 'shared'); assert.equal(f.registry.catalog(f.workspace).skills[0].layer, 'global')
  f.state.workspace = undefined
  assert.equal((await f.call({ action: 'list' })).installations.length, 1)
  await assert.rejects(f.call({ action: 'inspect', input, scope: 'workspace' }), /Select a Chat workspace/)
  await assert.rejects(f.call({ action: 'install', input: 'npx unknown add owner/repo' }), /supported/i)
  assert.equal(f.state.changes, 1)
})

test('policy confirms resolved mutations only; bypass is uninterrupted, deny and context changes preserve old files', async t => {
  const f = fixture(t), requests = []; let allow = true
  const wrapped = new f.HostToolRegistry({ scope: 'cowork', policies: { skill_install: { mode: 'confirm' } }, onConfirm: async request => { requests.push(request); return allow } }).add(f.tool).toRuntimeTools()[0]
  const call = async args => JSON.parse(await wrapped.execute(args))
  const preview = await call({ action: 'inspect', input }); await call({ action: 'list' }); assert.equal(requests.length, 0)
  allow = false
  await assert.rejects(call({ action: 'install', inspection_id: preview.inspection.id }), /denied/)
  assert.equal(f.state.changes, 0); assert.equal(requests[0].args.source.resolvedCommit, f.state.commit)
  assert.equal(requests[0].args.authoringRoot, join(f.workspace, '.agents/skills'))
  allow = true
  const record = (await call({ action: 'install', inspection_id: preview.inspection.id })).installation
  f.state.commit = '2'.repeat(40); allow = false
  await assert.rejects(call({ action: 'update', installation_id: record.id }), /denied/)
  assert.equal(requests.at(-1).args.previousSource.resolvedCommit, '1'.repeat(40)); assert.equal(requests.at(-1).args.source.resolvedCommit, '2'.repeat(40))
  assert.equal((await call({ action: 'list' })).installations[0].source.resolvedCommit, '1'.repeat(40))
  assert.equal(new f.HostToolRegistry({ scope: 'cowork', policies: { skill_install: { mode: 'disabled' } } }).add(f.tool).toRuntimeTools().length, 0)
  const bypass = new f.HostToolRegistry({ scope: 'cowork', onConfirm: async () => { throw Error('Must not confirm bypass') } }).add(f.tool).toRuntimeTools()[0]
  await bypass.execute({ action: 'remove', installation_id: record.id })
  f.state.intercept = async url => { if (url.includes('/zipball/')) f.state.identity = 'changed' }
  await assert.rejects(f.call({ action: 'install', input }), /context changed/)
  assert.equal(f.registry.catalog(f.workspace).skills.length, 0)
})

test('Pi tool cancellation during source fetch reaches installer and never publishes', async t => {
  const f = fixture(t), abort = new AbortController(); let enter
  const entered = new Promise(resolve => { enter = resolve })
  f.state.intercept = async (url, init) => {
    if (!url.includes('/zipball/')) return
    enter()
    await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled transport')), { once: true }))
  }
  const Type = { Object: x => x, String: () => ({}), Boolean: () => ({}), Number: () => ({}), Optional: x => x }
  const agent = new f.BaseAgent({ runtime: {}, buildTools: () => [f.tool], describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Fixture', supplier: 'test' }) })
  const bounded = agent.withToolTimeout(f.tool)
  const bound = f.bindPiTools({ defineTool: x => x }, Type, { tools: [bounded], scope: 'cowork' })[0]
  const pending = bound.execute('call', { action: 'install', input }, abort.signal)
  await entered; abort.abort()
  await assert.rejects(pending, /cancel/i)
  assert.equal(f.state.changes, 0); assert.equal(f.registry.catalog(f.workspace).skills.length, 0)
  assert.equal((await f.call({ action: 'list' })).installations.length, 0)
})

test('symlinked workspace authoring directory cannot reach institution storage', async t => {
  const f = fixture(t), outside = join(f.root, 'outside'); fs.mkdirSync(outside); fs.mkdirSync(join(f.workspace, '.agents'))
  fs.symlinkSync(outside, join(f.workspace, '.agents/skills'))
  await assert.rejects(f.call({ action: 'install', input }), /escapes/)
  assert.equal(f.state.requests, 0)
})
