import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const serviceFile = join(root, 'src/main/agent/maestroAgent.service.ts')
const nodeRequire = createRequire(import.meta.url)

// Compile whole, unchanged production modules. Only the desktop/cloud/SDK shell is replaced;
// the registry, export method, prompt, BaseAgent provider wiring and Pi request hook execute.
const loader = (mocks, serviceDependencies) => {
  const cache = new Map()
  const load = file => {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, experimentalDecorators: true } })
    assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
    new Function('require', 'module', 'exports', compiled.outputText)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      if (file === serviceFile && !serviceDependencies.has(name)) return {}
      let next
      if (name.startsWith('.')) next = resolve(dirname(file), name)
      else if (name.startsWith('@main/')) next = join(root, 'src/main', name.slice(6))
      else if (name.startsWith('@maestro-main/')) next = join(root, 'src/main/maestro', name.slice(14))
      else if (name.startsWith('@maestro-shared/')) next = join(root, 'src/shared/maestro', name.slice(16))
      if (next) { if (!existsSync(next)) next += '.ts'; return load(next) }
      return nodeRequire(name)
    }, module, module.exports)
    return module.exports
  }
  return file => load(join(root, file))
}

const payloads = text => [...text.matchAll(/\[Current complete Skills catalog\]\n([^\n]+)/g)].map(match => match[1])
const textOf = message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text || '').join('\n')
const putSkill = (source, folder, name = folder) => {
  const dir = join(source, folder); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Instructions for ${name}\n---\nBody stays on demand.\n`)
  return dir
}

test('real view_context export and Pi request hook keep all 251 three-source skills identical across updates', async t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-skills-request-parity-')), data = join(base, 'userdata'), workspace = join(base, 'workspace')
  mkdirSync(data); mkdirSync(workspace)
  const institution = { accountScope: 'fixture-account', institutionId: '7', generation: 'generation-1', institutionName: 'Fixture' }
  let authorizationChecks = 0, cloudChecks = 0, sessionStarts = 0, nativeTransforms = 0
  const context = { current: () => institution, authorize: async () => { authorizationChecks++; return institution } }
  const clipboardWrites = [], history = [
    { role: 'user', content: 'Historical question', timestamp: 1 },
    { role: 'assistant', content: [{ type: 'text', text: 'Historical answer' }], timestamp: 2 },
    { role: 'toolResult', toolName: 'fixture_read', toolCallId: 'call-1', content: [{ type: 'text', text: 'Historical tool evidence' }], timestamp: 3 }
  ]
  const native = {
    isStreaming: false, isCompacting: false,
    setAutoCompactionEnabled(value) { this.autoCompactionEnabled = value },
    setSteeringMode(value) { this.steeringMode = value },
    agent: { state: { messages: history }, transformContext: async (messages, signal) => {
      nativeTransforms++; assert.ok(signal instanceof AbortSignal); return messages
    } },
    sessionManager: { buildContextEntries: () => history.map((message, index) => ({ type: 'message', id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null, message })) }
  }
  class CommonService { setState(value) { this._state = value } }
  const log = { append() {}, dirForSession: async () => null }
  const load = loader({
    electron: { clipboard: { writeText: text => clipboardWrites.push(text) } },
    'electron-xpc/main': { createXpcMainEmitter: () => ({}), xpcMain: { broadcast() {} } },
    inversify: { injectable: () => value => value },
    '@maestro-shared/iocHelper/ioc.helper': { CommonService },
    '@maestro-main/skills/skillScope.context': { skillScopeContext: context, onSkillContextChanged: () => () => {}, assertSkillContext: actual => assert.equal(actual, institution) },
    './skillScope.context': { skillScopeContext: context },
    '@maestro-main/skills/skillCloud.runtime': { skillCloud: { ensureCatalog: async () => { cloudChecks++ } } },
    './sessionIoInitialization': { SessionIoInitialization: class {} },
    '@main/agent/runtime/hostApprovalHistory': { HostApprovalHistory: class {} },
    './runtime/inputBudget': { inputBudget: {} },
    './runtime/modelIoLog': { modelIoLog: log },
    './prompt/projectInstructions': { readProjectInstructions: () => { throw Error('No project instruction IO is needed for this test') } },
    '@maestro-main/llm/llmPaths': { maestroUserChainDir: () => join(data, 'chain') },
    '@earendil-works/pi-coding-agent': {
      ModelRuntime: { create: async () => ({}) },
      ModelRegistry: class { find() { return { id: 'fixture-model', contextWindow: 1_000_000, maxTokens: 8192 } } hasConfiguredAuth() { return true } },
      SessionManager: { inMemory: () => ({}) }, createExtensionRuntime: () => ({}),
      createAgentSession: async () => { sessionStarts++; return { session: native } }
    },
    typebox: { Type: {} }
  }, new Set([
    'node:path', 'crypto', 'async_hooks', 'path', 'fs',
    '@main/agent/BaseAgent', '@main/agent/contextExport.service', './runtime/contextExportLimit.service',
    './prompt/sysPrompt', '@main/agent/runtime/agentPrompt', '@main/agent/deepFetch.skill',
    '@maestro-main/skills/skillContract.helper', './userChainStore.service'
  ]))
  const { SkillRegistryService } = load('src/main/maestro/skills/skillRegistry.service.ts')
  const { MaestroAgentService } = load('src/main/agent/maestroAgent.service.ts')
  const { BaseAgent } = load('src/main/agent/BaseAgent.ts')
  const { PiRuntimeAdapter } = load('src/main/agent/runtime/piRuntimeAdapter.ts')
  const registry = new SkillRegistryService(data, context)
  t.after(() => { registry.dispose(); rmSync(base, { recursive: true, force: true }) })
  const roots = [join(data, 'skill-library/shared'), join(workspace, '.agents/skills'), join(data, 'skill-library/fixture-account/7')]
  const changedDir = putSkill(roots[0], 'global-same', 'same-name')
  putSkill(roots[1], 'workspace-same', 'same-name'); putSkill(roots[2], 'institution-same', 'same-name')
  for (let i = 0; i < 248; i++) putSkill(roots[i % 3], `entry-${String(i).padStart(3, '0')}`)
  const initialSnapshot = registry.catalog(workspace)
  assert.equal(initialSnapshot.skills.length, 251)
  assert.equal(new Set(initialSnapshot.skills.map(skill => skill.reference)).size, 251)
  assert.equal(initialSnapshot.skills.filter(skill => skill.name === 'same-name').length, 3)
  assert.deepEqual([...new Set(initialSnapshot.skills.map(skill => skill.layer))].sort(), ['global', 'institution', 'workspace'])
  const agent = new BaseAgent({ runtime: new PiRuntimeAdapter(), buildTools: () => [], cwd: workspace,
    providerId: 'fixture-provider', modelId: 'fixture-model', authPath: join(base, 'nonexistent-auth.json'),
    describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Fixture', supplier: 'Fixture' }) })
  const service = new MaestroAgentService(), sessionId = 'fixture-chat'
  service.maestroAgents.set(sessionId, agent)
  service.setState({
    describeWindowTabs: () => ({ openTabs: [], activeTab: undefined }),
    syncWorkspaceFromContext: (id, selected) => { assert.equal(id, sessionId); assert.equal(selected.path, workspace) },
    projectRootForSession: id => { assert.equal(id, sessionId); return workspace },
    existingSkillRegistry: () => registry,
    agentBrowserSession: () => ({ tabs: [], selectedTabId: null }), currentUrl: 'https://unrelated-domain.invalid'
  })
  const selectedWorkspace = { path: workspace, name: 'Fixture', exists: true, updatedAt: 1 }
  // Actual turn setup registers the production catalog provider. Stop via its existing idle
  // steering branch before any model prompt; do not hand-wire a catalog string into the hook.
  const steering = await service.handleAgentTurn('Inspect all Skills', agent, { workspace: selectedWorkspace }, { sessionKey: sessionId, steeringOnly: true })
  assert.equal(steering.error, 'steer-failed')
  assert.equal(sessionStarts, 0)
  await agent.init() // Real BaseAgent -> real adapter -> installs the real transformContext closure.
  assert.equal(sessionStarts, 1)
  const initialHistory = JSON.stringify(history)
  const run = async () => {
    const exported = await service.copyNextTurnContext({ sessionId, draft: 'Inspect all Skills', context: { workspace: selectedWorkspace } })
    assert.equal(exported.ok, true, exported.error)
    const output = clipboardWrites.at(-1)
    assert.equal(exported.chars, output.length)
    const request = await native.agent.transformContext(history, new AbortController().signal)
    const exportCatalogs = payloads(output), requestCatalogs = request.flatMap(message => payloads(textOf(message)))
    assert.deepEqual(exportCatalogs, requestCatalogs, 'all historical and current catalog payload bytes match between real export and real request')
    const latest = JSON.parse(exportCatalogs.at(-1)), snapshot = registry.catalog(workspace)
    assert.equal(latest.catalogRevision, snapshot.revision)
    assert.equal(latest.workspace, workspace)
    assert.equal(latest.institution, '7')
    assert.equal(latest.skills.length, 251)
    assert.equal(new Set(latest.skills.map(skill => skill.ref)).size, 251)
    const actual = new Map(latest.skills.map(skill => [skill.ref, skill]))
    for (const row of snapshot.skills) assert.deepEqual(actual.get(row.reference), {
      name: row.canonicalName || row.name, ...(row.displayName ? { displayName: row.displayName } : {}), description: row.description,
      source: row.layer, ref: row.reference, path: row.path, revision: row.skillRevision, allowImplicitInvocation: row.allowImplicitInvocation
    })
    assert.ok(!output.includes('Body stays on demand.'))
    assert.equal(request.length, history.length + 1)
    return { latest, catalog: request.at(-1).content, snapshot }
  }
  const first = await run()
  assert.equal(JSON.stringify(history), initialHistory)
  // A previous successful request is now historical evidence. A refresh must preserve it,
  // while both real outputs append the same new current revision.
  history.push({ role: 'user', content: first.catalog, timestamp: 4 })
  const retainedHistory = JSON.stringify(history)
  writeFileSync(join(changedDir, 'SKILL.md'), '---\nname: same-name\ndescription: Updated global instructions\n---\nBody stays on demand.\n')
  writeFileSync(join(changedDir, 'resource.txt'), 'Updated auxiliary resource')
  const second = await run()
  assert.notEqual(second.latest.catalogRevision, first.latest.catalogRevision)
  assert.equal(JSON.stringify(history), retainedHistory)
  const before = new Map(first.latest.skills.map(skill => [skill.ref, skill]))
  const changes = second.latest.skills.filter(skill => JSON.stringify(skill) !== JSON.stringify(before.get(skill.ref)))
  assert.equal(changes.length, 1)
  assert.equal(changes[0].source, 'global')
  assert.equal(changes[0].description, 'Updated global instructions')
  assert.notEqual(changes[0].revision, before.get(changes[0].ref).revision)
  assert.equal(sessionStarts, 1, 'no session reset on Skill refresh')
  assert.equal(nativeTransforms, 2, 'the native transform remains chained for every request')
  assert.equal(authorizationChecks, 5); assert.equal(cloudChecks, 5)
})
