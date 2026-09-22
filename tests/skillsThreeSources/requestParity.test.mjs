import * as nativePi from '@earendil-works/pi-coding-agent'
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

test('new native Chat reloads external skills once; existing Chat turns reuse snapshots', async t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-new-chat-skills-')), data = join(base, 'data'), workspace = join(base, 'workspace')
  mkdirSync(workspace)
  const nativeSessions = [], requests = []
  let scans = 0, reloads = 0
  const model = { id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'fixture', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const load = loader({
    './skillScope.context': { skillScopeContext: { current: () => null } },
    'virtual:bitterless-pi-skills': { ...nativePi, loadSkillsFromDir: options => { scans++; return nativePi.loadSkillsFromDir(options) } },
    typebox: await import('typebox'),
    '@earendil-works/pi-coding-agent': {
      ...nativePi,
      // Keep real native sessions/resources. Only model authorization and generation are offline.
      ModelRuntime: { create: options => nativePi.ModelRuntime.create({ ...options, refreshOnCreate: false }) },
      ModelRegistry: class { find() { return model } hasConfiguredAuth() { return true } },
      createAgentSession: async options => {
        const result = await nativePi.createAgentSession(options)
        nativeSessions.push(result.session)
        result.session.prompt = async text => {
          const messages = [{ role: 'user', content: text, timestamp: 1 }]
          requests.push(await result.session.agent.transformContext(messages, new AbortController().signal))
        }
        return result
      }
    }
  }, new Set())
  const { SkillRegistryService } = load('src/main/maestro/skills/skillRegistry.service.ts')
  const { PiRuntimeAdapter } = load('src/main/agent/runtime/piRuntimeAdapter.ts')
  const registry = new SkillRegistryService(data)
  t.after(() => { nativeSessions.forEach(session => session.dispose()); registry.dispose(); rmSync(base, { recursive: true, force: true }) })
  const original = putSkill(join(data, 'skill-library/shared'), 'original')
  registry.catalog(workspace) // The application already has a shared catalog before New Chat.
  const options = {
    target: { providerId: 'fixture', modelId: 'fixture', thinkingLevel: 'off' },
    authPath: join(base, 'auth.json'), modelsPath: join(base, 'models.json'), agentDir: join(base, 'agent'), cwd: workspace,
    systemPrompt: 'Fixture host instructions', scope: 'maestro', builtinTools: ['read', 'bash'],
    tools: [{ name: 'fixture_tool', description: 'Fixture', params: [], execute: async () => 'Unused' }],
    beforeModelRequest: async () => registry.catalogPrompt(workspace),
    // A8:完整目录经资源加载器的 getAppendSystemPrompt() 进**系统提示词**,不再每请求挂一条消息。
    skillResources: { revision: () => registry.resourceRevision(workspace), getSkills: () => registry.getPiSkills(workspace), reload: () => { reloads++; registry.reload(workspace) }, catalogText: () => registry.catalogPrompt(workspace) }
  }
  const adapter = new PiRuntimeAdapter(), first = await adapter.createSession(options)
  assert.equal(reloads, 1)
  const originalScans = scans
  writeFileSync(join(original, 'SKILL.md'), '---\nname: original\ndescription: Edited before New Chat\n---\nBody stays on demand.')
  putSkill(join(workspace, '.agents/skills'), 'external-added')
  await first.prompt({ text: 'Continue existing Chat' })
  assert.ok(!nativeSessions[0].systemPrompt.includes('external-added'))
  // 目录在系统提示词里,不在请求消息里 —— 每轮该带的只有 D1–D4(prompt-structure.html 表 3)。
  assert.ok(!textOf(requests.at(-1).at(-1)).includes('<host_skill_catalog>'), '请求消息里不该有完整目录')
  assert.ok(!nativeSessions[0].systemPrompt.includes('"name":"external-added"'), '已建会话的 system 也不该凭空多出新技能')
  assert.equal(scans, originalScans); assert.equal(reloads, 1)

  const second = await adapter.createSession(options)
  assert.equal(reloads, 2, 'each newly initialized native Chat reloads once')
  assert.ok(scans > originalScans, 'New Chat reads disk rather than only returning the shared cached catalog')
  assert.ok(nativeSessions[1].systemPrompt.includes('external-added'))
  assert.ok(nativeSessions[1].systemPrompt.includes('Edited before New Chat'))
  const afterNewChat = scans
  await second.prompt({ text: 'First turn in new Chat' })
  // New Chat 重新组装:新会话的系统提示词里带着完整目录,且含新加的技能。
  assert.ok(nativeSessions[1].systemPrompt.includes('<host_skill_catalog>'), 'A8 完整目录必须在系统提示词里')
  assert.ok(JSON.parse(payloads(nativeSessions[1].systemPrompt)[0]).skills.some(skill => skill.name === 'external-added'))
  assert.ok(!textOf(requests.at(-1).at(-1)).includes('<host_skill_catalog>'), '仍然不进请求消息')
  await second.prompt({ text: 'Next turn in new Chat' })
  await first.prompt({ text: 'Return to previously initialized Chat' })
  assert.equal(scans, afterNewChat, 'ordinary turns and returning to an existing Chat do not scan disk')
  assert.equal(reloads, 2)
})

for (const hasInstitution of [true, false]) test(`real view_context and Pi request keep the complete current catalog; institution=${hasInstitution}`, async t => {
  const base = mkdtempSync(join(tmpdir(), 'bl-skills-request-parity-')), data = join(base, 'userdata'), workspace = join(base, 'workspace')
  mkdirSync(data); mkdirSync(workspace)
  let currentWorkspace = workspace
  let institution = hasInstitution ? { accountScope: 'fixture-account', institutionId: '7', generation: 'generation-1', institutionName: 'Fixture' } : null
  const skillCount = hasInstitution ? 251 : 168
  let authorizationChecks = 0, cloudChecks = 0, sessionStarts = 0, nativeTransforms = 0, resources, nativeReloads = 0, nativeScans = 0
  const context = { current: () => institution, authorize: async () => { authorizationChecks++; return institution } }
  const clipboardWrites = [], history = [
    { role: 'user', content: 'Historical question', timestamp: 1 },
    { role: 'assistant', content: [{ type: 'text', text: 'Historical answer' }], timestamp: 2 },
    { role: 'toolResult', toolName: 'fixture_read', toolCallId: 'call-1', content: [{ type: 'text', text: 'Historical tool evidence' }], timestamp: 3 }
  ]
  const activeTools = ['read', 'bash'], sentSystemPrompts = []
  const native = {
    systemPrompt: '',
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName(names) {
      assert.deepEqual(names, activeTools, 'catalog refresh preserves selected tools')
      native.systemPrompt = resources.getSystemPrompt() + nativePi.formatSkillsForPrompt(resources.getSkills().skills, 'read') + '\nCurrent working directory: ' + workspace + '\n'
    },
    reload: async () => { nativeReloads++; await resources.reload(); native.setActiveToolsByName(activeTools) },
    prompt: async () => { sentSystemPrompts.push(native.systemPrompt) },
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
    'virtual:bitterless-pi-skills': { ...nativePi, loadSkillsFromDir: options => { nativeScans++; return nativePi.loadSkillsFromDir(options) } },
    // The send path gained `applicationAuth.assertReady()` after this harness was written; the
    // harness returns `{}` for any un-listed service import, so the call landed on `undefined` and
    // both parity cases failed. Auth readiness is desktop shell, exactly what this harness replaces.
    '@main/auth/applicationAuth.service': { applicationAuth: { assertReady: () => {} } },
    './runtime/inputBudget': { inputBudget: {} },
    './runtime/skillAuthoring': { skillAuthoringRuntime: globalRoot => ({ globalRoot, bunPath: '/fixture/bun' }) },
    './runtime/modelIoLog': { modelIoLog: log },
    // Was a throw asserting "this test needs no project-instruction IO". That assumption is stale:
    // `BaseAgent.setProjectRoot` reads the project's AGENTS.md **between turns** by design
    // (BaseAgent.ts:252-258), and this harness now drives a real turn, so the throw fired on a
    // legitimate call. Still a stub — the harness replaces shell IO, and reading AGENTS.md is shell
    // IO — but it returns empty instead of failing, so the subject (catalog parity) is what is tested.
    './prompt/projectInstructions': { readProjectInstructions: async () => '' },
    '@maestro-main/llm/llmPaths': { maestroUserChainDir: () => join(data, 'chain') },
    '@earendil-works/pi-coding-agent': {
      ...nativePi,
      loadSkillsFromDir: options => { nativeScans++; return nativePi.loadSkillsFromDir(options) },
      SettingsManager: { inMemory: () => ({}) },
      ModelRuntime: { create: async () => ({}) },
      ModelRegistry: class { find() { return { id: 'fixture-model', contextWindow: 1_000_000, maxTokens: 8192 } } hasConfiguredAuth() { return true } },
      SessionManager: { inMemory: () => ({}) }, createExtensionRuntime: () => ({}),
      createAgentSession: async options => { resources = options.resourceLoader; sessionStarts++; native.setActiveToolsByName(activeTools); return { session: native } }
    },
    typebox: { Type: {} },
    // 没选工作区时 agent 的 cwd 兜底。真模块会拉进 pathHelper 的别名(本 loader 解析不了),
    // 而具体是哪个目录跟目录平价无关 —— 给一个固定路径即可。不给的话 loader 会把它换成 `{}`,
    // 建 agent 时报 "ensureDefaultWorkspace is not a function"。
    '@maestro-main/files/defaultWorkspace': { ensureDefaultWorkspace: () => '/fixture/default-workspace' }
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
  assert.equal(initialSnapshot.skills.length, skillCount)
  assert.equal(new Set(initialSnapshot.skills.map(skill => skill.reference)).size, skillCount)
  assert.equal(initialSnapshot.skills.filter(skill => skill.name === 'same-name').length, hasInstitution ? 3 : 2)
  assert.deepEqual([...new Set(initialSnapshot.skills.map(skill => skill.layer))].sort(), hasInstitution ? ['global', 'institution', 'workspace'] : ['global', 'workspace'])
  const agent = new BaseAgent({ runtime: new PiRuntimeAdapter(), buildTools: () => [], cwd: workspace,
    providerId: 'fixture-provider', modelId: 'fixture-model', authPath: join(base, 'nonexistent-auth.json'),
    describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Fixture', supplier: 'Fixture' }) })
  const service = new MaestroAgentService(), sessionId = 'fixture-chat'
  service.maestroAgents.set(sessionId, agent)
  service.setState({
    describeWindowTabs: () => ({ openTabs: [], activeTab: undefined }),
    syncWorkspaceFromContext: (id, selected) => { assert.equal(id, sessionId); assert.equal(selected.path, workspace) },
    projectRootForSession: id => { assert.equal(id, sessionId); return currentWorkspace },
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
  assert.equal(resources.getSkills().skills.length, skillCount)
  let reloads = 0; registry.onChanged(() => reloads++)
  await resources.reload()
  assert.equal(reloads, 1)
  assert.equal(resources.getSkills().skills.filter(skill => skill.name === 'same-name').length, hasInstitution ? 3 : 2)
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
    assert.equal(latest.institution, hasInstitution ? '7' : null)
    assert.equal(latest.skills.length, skillCount)
    assert.equal(new Set(latest.skills.map(skill => skill.ref)).size, skillCount)
    const actual = new Map(latest.skills.map(skill => [skill.ref, skill]))
    for (const row of snapshot.skills) assert.deepEqual(actual.get(row.reference), {
      name: row.canonicalName || row.name, ...(row.displayName ? { displayName: row.displayName } : {}), description: row.description,
      source: row.layer, ref: row.reference, path: row.path, revision: row.skillRevision, allowImplicitInvocation: row.allowImplicitInvocation
    })
    assert.ok(!output.includes('Body stays on demand.'))
    assert.equal(request.length, history.length + 1)
    return { latest, catalog: request.at(-1).content, snapshot }
  }
  const scansBeforeRead = nativeScans
  const first = await run()
  assert.equal(nativeScans, scansBeforeRead, 'export, model callback and catalog reads use the loaded snapshot')
  assert.equal(JSON.stringify(history), initialHistory)
  // A previous successful request is now historical evidence. A refresh must preserve it,
  // while both real outputs append the same new current revision.
  history.push({ role: 'user', content: first.catalog, timestamp: 4 })
  const retainedHistory = JSON.stringify(history)
  writeFileSync(join(changedDir, 'SKILL.md'), '---\nname: same-name\ndescription: Updated global instructions\n---\nBody stays on demand.\n')
  writeFileSync(join(changedDir, 'resource.txt'), 'Updated auxiliary resource')
  assert.equal(registry.catalog(workspace).revision, first.latest.catalogRevision, 'an external edit is invisible until explicit refresh')
  registry.reload(workspace)
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
  assert.equal(authorizationChecks, hasInstitution ? 5 : 0); assert.equal(cloudChecks, hasInstitution ? 5 : 0)
  const runtime = await agent.sessionPromise
  await runtime.prompt({ text: 'Next idle turn' })
  assert.ok(sentSystemPrompts.at(-1).includes('<available_skills>'))
  assert.ok(sentSystemPrompts.at(-1).includes('Updated global instructions'))
  const idleScans = nativeScans, idleReloads = nativeReloads
  await runtime.prompt({ text: 'Unchanged next turn' })
  assert.equal(nativeScans, idleScans)
  assert.equal(nativeReloads, idleReloads)
  const retainedBeforeRebuild = JSON.stringify(history)
  writeFileSync(join(changedDir, 'SKILL.md'), '---\nname: same-name\ndescription: Latest idle-turn instructions\n---\nBody stays on demand.\n')
  await runtime.prompt({ text: 'External edit before refresh' })
  assert.ok(sentSystemPrompts.at(-1).includes('Updated global instructions'))
  assert.equal(nativeScans, idleScans)
  registry.reload(workspace)
  institution = null
  await runtime.prompt({ text: 'Turn after edit and logout' })
  assert.ok(sentSystemPrompts.at(-1).includes('Latest idle-turn instructions'))
  assert.ok(!sentSystemPrompts.at(-1).includes('Updated global instructions'))
  assert.ok(!sentSystemPrompts.at(-1).includes('/skill-library/fixture-account/7/'))
  currentWorkspace = join(base, 'second-workspace')
  putSkill(join(currentWorkspace, '.agents/skills'), 'new-workspace-skill')
  await runtime.prompt({ text: 'Turn after Chat workspace switch' })
  assert.ok(sentSystemPrompts.at(-1).includes('new-workspace-skill'))
  assert.ok(!sentSystemPrompts.at(-1).includes(workspace + '/.agents/skills/'))
  runtime.setSystemPrompt('Updated host system instructions')
  assert.ok(native.systemPrompt.startsWith('Updated host system instructions'))
  assert.ok(native.systemPrompt.includes('Latest idle-turn instructions'))
  assert.equal(JSON.stringify(history), retainedBeforeRebuild, 'system skill refresh preserves all historical messages')
})
