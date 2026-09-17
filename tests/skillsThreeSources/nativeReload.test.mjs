import test from 'node:test'
import assert from 'node:assert/strict'
import * as nativePi from '@earendil-works/pi-coding-agent'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const app = resolve(import.meta.dirname, '../..')
const compiled = await build({ tsconfig: join(app, 'tsconfig.node.json'), stdin: { contents: [
  "export { SkillRegistryService } from './src/main/maestro/skills/skillRegistry.service'",
  "export { createPiResourceLoader } from './src/main/agent/runtime/piRuntimeProtocol'",
  "export { PiRuntimeSession } from './src/main/agent/runtime/piRuntimeSession'"
].join('\n'), resolveDir: app, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'], plugins: [{ name: 'scope', setup(builder) {
  builder.onResolve({ filter: /skillScope\.context$/ }, () => ({ path: 'scope', namespace: 'host' }))
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export const skillScopeContext={current:()=>null,authorize:async()=>null}' }))
} }] })
const module = { exports: {} }, require = createRequire(import.meta.url)
let scans = 0
const countedPi = { ...nativePi, loadSkillsFromDir: options => { scans++; return nativePi.loadSkillsFromDir(options) } }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => ['@earendil-works/pi-coding-agent', 'virtual:bitterless-pi-skills'].includes(name) ? countedPi : require(name), process, Buffer, console })
const { SkillRegistryService, createPiResourceLoader, PiRuntimeSession } = module.exports

test('real native session.reload applies changed cached skills and preserves tools and history', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bl-native-reload-')), data = join(root, 'data'), workspace = join(root, 'workspace')
  mkdirSync(workspace); const directory = join(data, 'skill-library/shared/sample'); mkdirSync(directory, { recursive: true })
  const file = join(directory, 'SKILL.md')
  writeFileSync(file, '---\nname: sample\ndescription: Before refresh\n---\nFixture body')
  const registry = new SkillRegistryService(data)
  t.after(() => { registry.dispose(); rmSync(root, { recursive: true, force: true }) })
  const skillResources = { revision: () => registry.resourceRevision(workspace), getSkills: () => registry.getPiSkills(workspace), reload: () => { registry.reload(workspace) } }
  const resources = createPiResourceLoader(nativePi, 'Fixture host instructions', skillResources)
  const modelRuntime = await nativePi.ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json'), refreshOnCreate: false })
  const manager = nativePi.SessionManager.inMemory(workspace)
  manager.appendMessage({ role: 'user', content: 'Retained prior message', timestamp: 1 })
  const { session } = await nativePi.createAgentSession({ cwd: workspace, agentDir: join(root, 'agent'), modelRuntime,
    model: { id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'fixture', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    resourceLoader: resources, tools: ['read', 'bash'], settingsManager: nativePi.SettingsManager.inMemory(), sessionManager: manager })
  t.after(() => session.dispose())
  const tools = session.getActiveToolNames(), history = JSON.stringify(session.messages), entries = JSON.stringify(manager.getEntries())
  let reloads = 0
  const reload = session.reload.bind(session)
  session.reload = async () => { reloads++; await reload() }
  // Exercise production prompt lifecycle without asking a provider to generate a response.
  session.prompt = async () => undefined
  const runtime = new PiRuntimeSession(session, undefined, { hostText: 'Fixture host instructions', cwd: workspace, resourceRevision: skillResources.revision })
  const initialScans = scans
  await runtime.prompt({ text: 'Unchanged turn' }); await runtime.prompt({ text: 'Another unchanged turn' })
  assert.equal(scans, initialScans); assert.equal(reloads, 0)
  writeFileSync(file, '---\nname: sample\ndescription: After explicit refresh\n---\nFixture body')
  await runtime.prompt({ text: 'External edit remains cached' })
  assert.ok(session.systemPrompt.includes('Before refresh')); assert.equal(scans, initialScans)
  registry.reload(workspace)
  const refreshedScans = scans
  await runtime.prompt({ text: 'Apply explicit refresh' })
  assert.equal(reloads, 1); assert.equal(scans, refreshedScans, 'native reload consumes the refreshed snapshot without another scan')
  assert.ok(session.systemPrompt.includes('After explicit refresh')); assert.ok(!session.systemPrompt.includes('Before refresh'))
  registry.invalidate()
  resources.getSkills() // A new host context has already been consumed by the SDK.
  writeFileSync(file, '---\nname: sample\ndescription: Explicit native reload after context read\n---\nFixture body')
  await session.reload()
  assert.ok(session.systemPrompt.includes('Explicit native reload after context read'))
  assert.deepEqual(session.getActiveToolNames(), tools)
  assert.equal(JSON.stringify(session.messages), history); assert.equal(JSON.stringify(manager.getEntries()), entries)
})
