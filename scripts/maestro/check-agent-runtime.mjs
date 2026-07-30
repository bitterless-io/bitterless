import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const workspaceRoot = projectRoot
const require = createRequire(import.meta.url)
const baseAgent = readFileSync(join(root, 'main/maestro/agent/BaseAgent.ts'), 'utf8')
const runtimeTypes = readFileSync(join(root, 'main/maestro/agent/runtime/agentRuntime.types.ts'), 'utf8')
const piRuntime = readFileSync(join(root, 'main/maestro/agent/runtime/piRuntimeAdapter.ts'), 'utf8')
const aiCrmsRuntime = readFileSync(join(root, 'main/maestro/agent/runtime/aiCrmsRuntimeAdapter.ts'), 'utf8')
const coachRuntime = readFileSync(join(root, 'main/maestro/agent/runtime/coachRuntimeAdapter.ts'), 'utf8')
const aiCrmsRuntimeCheck = readFileSync(join(projectRoot, 'scripts/maestro/check-ai-crms-runtime.mjs'), 'utf8')
const mediaResolver = readFileSync(join(root, 'main/maestro/agent/runtime/mediaRefResolver.ts'), 'utf8')
const mediaUpload = readFileSync(join(root, 'main/maestro/networking/api/mediaUpload.api.ts'), 'utf8')
const errorSanitizer = readFileSync(join(root, 'main/maestro/agent/runtime/errorSanitizer.ts'), 'utf8')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const maestroAgent = readFileSync(join(root, 'main/maestro/agent/maestroAgent.service.ts'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')
const coachHandler = readFileSync(join(root, 'main/maestro/xpc/coach.handler.ts'), 'utf8')
const messageStore = readFileSync(join(root, 'renderer/maestro/control/src/store/message.store.ts'), 'utf8')
const channelStore = readFileSync(join(root, 'renderer/maestro/control/src/store/channel.store.ts'), 'utf8')
const llmService = readFileSync(join(root, 'main/maestro/llm/maestroLlm.service.ts'), 'utf8')
const llmModels = readFileSync(join(root, 'main/maestro/llm/llmModels.ts'), 'utf8')
const packageJson = readFileSync(join(projectRoot, 'package.json'), 'utf8')
const piAiTypes = readFileSync(join(workspaceRoot, 'node_modules/@earendil-works/pi-ai/dist/types.d.ts'), 'utf8')
const piOpenAiCompletions = readFileSync(join(workspaceRoot, 'node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const loadBaseAgent = () => {
  const output = ts.transpileModule(baseAgent, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: 'BaseAgent.ts'
  }).outputText
  const mod = { exports: {} }
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: 'BaseAgent.ts' }
  )
  wrapped(
    mod.exports,
    (specifier) => {
      if (specifier === './runtime/coachRuntimeAdapter') return { CoachRuntimeAdapter: class CoachRuntimeAdapter {} }
      return require(specifier)
    },
    mod,
    'BaseAgent.ts',
    root
  )
  return mod.exports.BaseAgent
}

for (const forbidden of ['codex exec', '--ephemeral', 'execFile(', 'spawn(', 'spawnSync(']) {
  assert(!baseAgent.includes(forbidden), `BaseAgent must not use CLI per-message execution: ${forbidden}`)
  assert(!piRuntime.includes(forbidden), `PiRuntimeAdapter must not use CLI per-message execution: ${forbidden}`)
  assert(!aiCrmsRuntime.includes(forbidden), `AiCrmsRuntimeAdapter must not use CLI per-message execution: ${forbidden}`)
  assert(!coachRuntime.includes(forbidden), `CoachRuntimeAdapter must not use CLI per-message execution: ${forbidden}`)
}

assert(runtimeTypes.includes('export interface AgentRuntimeAdapter'), 'provider-neutral AgentRuntimeAdapter should exist')
assert(runtimeTypes.includes('createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession>'), 'runtime adapter should create reusable sessions')
assert(runtimeTypes.includes('subscribe: (listener: (event: AgentRuntimeEvent) => void)'), 'runtime session should expose event streaming')
assert(runtimeTypes.includes('export interface AgentRuntimeMediaRef'), 'runtime prompt should model generic media/file attachments')
assert(runtimeTypes.includes('export interface AgentRuntimeImage'), 'runtime prompt should keep a narrowed image ref type')
assert(runtimeTypes.includes('export interface AgentRuntimePrompt'), 'runtime prompt should support text plus media refs')
assert(runtimeTypes.includes("export type AgentRuntimeMediaKind = 'image' | 'file'"), 'runtime media refs should distinguish images from other files')
assert(runtimeTypes.includes('media?: AgentRuntimeMediaRef[]') && runtimeTypes.includes('images?: AgentRuntimeImage[]'), 'runtime prompt should carry generic media plus image refs')
assert(runtimeTypes.includes('path?: string') && runtimeTypes.includes('url?: string'), 'runtime media prompt should support path/url transports')
assert(!runtimeTypes.includes('data?: string'), 'runtime media prompt must not expose inline base64 data')
assert(runtimeTypes.includes('abort: () => Promise<void>'), 'runtime session should support abort')
assert(mediaResolver.includes("export type AgentRuntimeMediaTransport = 'path' | 'url'"), 'media resolver should explicitly choose path or url transport')
assert(mediaResolver.includes("id === 'openai-codex' || id === 'anthropic'") && mediaResolver.includes("return 'url'"), 'media resolver should prefer path for local agents and url for remote providers')
assert(mediaResolver.includes('remote_url=missing') && mediaResolver.includes('no upload/signed-URL resolver is configured yet'), 'remote providers without urls should get an explicit missing-url warning')
assert(!mediaResolver.includes('base64'), 'media resolver must not create inline media payloads')
assert(mediaUpload.includes('export const uploadMediaRefsForProvider'), 'media upload API should expose an optional path-to-url resolver')
assert(mediaUpload.includes('COACH_AI_CRMS_MEDIA_UPLOAD_URL') && mediaUpload.includes('COACH_MEDIA_UPLOAD_URL'), 'media upload endpoint should be explicitly configured by env')
assert(mediaUpload.includes('new FormData()') && mediaUpload.includes("form.set('file'"), 'media upload should use multipart form data')
assert(mediaUpload.includes('new File([readFileSync(ref.path)]'), 'media upload should send binary file data without string/base64 conversion')
assert(mediaUpload.includes('upload response did not include url/downloadUrl'), 'media upload should require a returned downloadable URL')
assert(!mediaUpload.includes('base64') && !mediaUpload.includes("toString('base64')"), 'media upload must not use base64')
assert(coachRuntime.includes('new AiCrmsRuntimeAdapter()') && coachRuntime.includes('new PiRuntimeAdapter()'), 'CoachRuntimeAdapter should route AI-CRMS natively and keep pi for subscription providers')
assert(coachRuntime.includes("providerId.trim().toLowerCase() === 'ai-crms'"), 'CoachRuntimeAdapter should select the native AI-CRMS adapter only for AI-CRMS')
assert(aiCrmsRuntime.includes("createXpcMainEmitter<SessionApi>('MaestroSessionDao')"), 'AI-CRMS runtime should read the isolated bridged login session')
assert(aiCrmsRuntime.includes('chatCompletionsUrl(endpoint.baseUrl)'), 'AI-CRMS runtime should call the relay chat.completions endpoint directly')
assert(aiCrmsRuntime.includes("Authorization: `Bearer ${this.params.session.jwt_token}`"), 'AI-CRMS runtime should use the current JWT bearer token')
assert(aiCrmsRuntime.includes("'x-workspace-id'") && aiCrmsRuntime.includes('normalizeCoachRegion'), 'AI-CRMS runtime should include dynamic region/workspace headers')
assert(aiCrmsRuntime.includes("type: 'image_url'") && aiCrmsRuntime.includes('ref.url'), 'AI-CRMS runtime should send URL-native image refs')
assert(aiCrmsRuntime.includes("tool_choice: 'auto'") && aiCrmsRuntime.includes('buildOpenAiTools'), 'AI-CRMS runtime should expose Coach tools as OpenAI function tools')
assert(aiCrmsRuntime.includes('spec.execute(call.args)') && aiCrmsRuntime.includes("type: 'tool_start'") && aiCrmsRuntime.includes("type: 'tool_end'"), 'AI-CRMS runtime should run Coach tools and emit tool events')
assert(aiCrmsRuntime.includes('parseOpenAiChatStream') && aiCrmsRuntime.includes("type: 'text_delta'") && aiCrmsRuntime.includes("type: 'thinking_delta'"), 'AI-CRMS runtime should normalize streaming text/thinking events')
assert(aiCrmsRuntime.includes('parseOpenAiChatJson') && aiCrmsRuntime.includes("application\\/json"), 'AI-CRMS runtime should handle non-streaming JSON fallbacks')
assert(aiCrmsRuntime.includes("data === '[DONE]'") && aiCrmsRuntime.includes("line.startsWith('data:')"), 'AI-CRMS runtime should parse OpenAI-compatible SSE')
assert(aiCrmsRuntime.includes('enable_thinking: enableThinking'), 'AI-CRMS runtime should pass Qwen thinking preference from the selected effort')
assert(errorSanitizer.includes('export const sanitizeRuntimeError') && errorSanitizer.includes('[REDACTED_JWT]'), 'runtime error sanitizer should redact common token patterns')
assert(aiCrmsRuntime.includes("sanitizeRuntimeError(text, 'AI-CRMS relay')") && aiCrmsRuntime.includes("sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')"), 'AI-CRMS runtime should sanitize relay and tool errors')
assert(piRuntime.includes("sanitizeRuntimeError(event.message.errorMessage, 'provider')") && piRuntime.includes("sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')"), 'pi runtime should sanitize provider and tool errors')
assert(!aiCrmsRuntime.includes("toString('base64')") && !aiCrmsRuntime.includes('base64,'), 'AI-CRMS runtime must not create base64 image payloads')
assert(packageJson.includes('"check:maestro": "node scripts/maestro/check-maestro.mjs"'), 'package scripts should expose the embedded Maestro parity suite')
assert(aiCrmsRuntimeCheck.includes('CoachRuntimeAdapter') && aiCrmsRuntimeCheck.includes('createServer') && aiCrmsRuntimeCheck.includes('writeSse') && aiCrmsRuntimeCheck.includes('JSON fallback ok.'), 'AI-CRMS runtime check should exercise router selection, SSE, and JSON fallback')
assert(aiCrmsRuntimeCheck.includes('"type":"image_url"') && aiCrmsRuntimeCheck.includes('!firstBodyText.includes(\'base64\')'), 'AI-CRMS runtime check should verify URL-native image payloads and no base64')
assert(aiCrmsRuntimeCheck.includes('toolArgs[0]?.query === \'cardio\'') && aiCrmsRuntimeCheck.includes('"role":"tool"'), 'AI-CRMS runtime check should verify tool-call assembly and tool-result replay')
assert(aiCrmsRuntimeCheck.includes('fail_secret') && aiCrmsRuntimeCheck.includes('tool error observations should not leak token values'), 'AI-CRMS runtime check should verify sanitized tool errors')
assert(piAiTypes.includes('export interface ImageContent') && piAiTypes.includes('data: string;') && !piAiTypes.includes('url: string;'), 'pi 0.79 ImageContent is base64-data only, not URL-native')
assert(piOpenAiCompletions.includes('url: `data:${item.mimeType};base64,${item.data}`'), 'pi openai-completions provider still serializes images as base64 data URLs')

assert(baseAgent.includes('private sessionPromise: Promise<AgentRuntimeSession> | null = null'), 'BaseAgent should keep one reusable session promise')
assert(baseAgent.includes('new CoachRuntimeAdapter()'), 'BaseAgent should use the Coach runtime router by default')
assert(baseAgent.includes('if (!this.sessionPromise) this.sessionPromise = this.startSession()'), 'ensureSession should be idempotent')
assert(baseAgent.includes('session = await withTimeout(') && baseAgent.includes('this.ensureSession()'), 'prompt should reuse the managed session')
assert(baseAgent.includes('if (options?.freshSession) this.reset()'), 'prompt should explicitly opt into fresh sessions only when requested')
assert(baseAgent.includes('this.sessionPromise = null') && baseAgent.includes('this.primed = false'), 'reset should drop session and system-prompt state')
assert(baseAgent.includes('async oneShot(prompt: string'), 'structured generation should remain separate one-shot behavior')
assert(baseAgent.includes('this.createSession(false)'), 'oneShot should use a throwaway no-tool session')
assert(baseAgent.includes('this.opts.onStream?.(event.delta)'), 'BaseAgent should stream text deltas to the UI')
assert(baseAgent.includes('this.opts.onThinking?.({ active, ts: Date.now() })') && baseAgent.includes("type === 'tool_start'"), 'BaseAgent should surface live thinking and tool activity')
assert(baseAgent.includes('media: options?.media') && baseAgent.includes('images: options?.images'), 'BaseAgent should pass current-turn media refs into the runtime prompt')

assert(piRuntime.includes("await import('@earendil-works/pi-coding-agent')"), 'pi runtime should use the SDK directly')
assert(piRuntime.includes('pi.createAgentSession'), 'pi runtime should create SDK sessions')
assert(!piRuntime.includes('buildPiImages'), 'pi runtime must not convert media refs into inline payloads')
assert(!piRuntime.includes("toString('base64')") && !piRuntime.includes('toString("base64")'), 'pi runtime must not base64 encode attachments')
assert(piRuntime.includes('this.session.prompt(message.text)'), 'pi runtime should keep media refs in the text/path boundary')
assert(piRuntime.includes('base64 payloads') && piRuntime.includes('textual @path note'), 'pi runtime should document why native media is not used')
assert(piRuntime.includes("sessionManager: pi.SessionManager.inMemory()"), 'pi runtime should keep session state in memory')
assert(piRuntime.includes("noTools: customTools.length > 0 ? 'builtin' : 'all'"), 'pi runtime should disable builtin coding tools while keeping Coach custom tools')
assert(piRuntime.includes("type === 'tool_execution_start'"), 'pi runtime should normalize tool events')
assert(piRuntime.includes("inner.type === 'text_delta'"), 'pi runtime should normalize streamed text')

assert(maestroAgent.includes('private readonly maestroAgents = new Map<string, MaestroAgent>()'), 'MaestroAgentService should cache agents by chat session id')
assert(maestroAgent.includes('private readonly hydratedMaestroAgentSessions = new Set<string>()'), 'MaestroAgentService should track which chat sessions have been hydrated')
assert(maestroAgent.includes('let agent = this.maestroAgents.get(key)'), 'MaestroAgentService should reuse cached chat agents')
assert(maestroAgent.includes('this.maestroAgents.set(key, agent)'), 'MaestroAgentService should cache new chat agents')
assert(maestroAgent.includes('includeConversationMemory = !this.hydratedMaestroAgentSessions.has(sessionKey)'), 'first turn should hydrate persisted chat memory once')
assert(maestroAgent.includes('const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)'), 'MaestroAgentService should build current-turn media refs from attached paths')
assert(maestroAgent.includes('resolveRuntimeMediaRefs({') && maestroAgent.includes('preferred transport:'), 'MaestroAgentService should resolve media transport per provider')
assert(maestroAgent.includes('uploadMediaRefsForProvider({') && maestroAgent.includes('mediaTransportForProvider(this.activeLlmProvider) === \'url\''), 'MaestroAgentService should try configured upload only for URL-first providers')
assert(maestroAgent.includes('mediaUploadSessionForProvider') && maestroAgent.includes("createXpcMainEmitter<SessionApi>('MaestroSessionDao')"), 'AI-CRMS media uploads should use the isolated bridged session for auth headers')
assert(maestroAgent.includes('media.push({'), 'MaestroAgentService should pass local path media refs instead of inline payloads')
assert(mediaResolver.includes('images.push({ ...next.ref, kind: \'image\', mimeType: next.ref.mimeType })'), 'media resolver should still provide narrowed image refs for future image-capable adapters')
assert(!maestroAgent.includes('images.push({ data: readFileSync(path)'), 'MaestroAgentService should not pass base64 image payloads')
assert(maestroWindow.includes('return await this.agentService.attachClipboardImage(params)'), 'Maestro controller should expose the clipboard attachment facade')
assert(maestroAgent.includes('async attachClipboardImage'), 'MaestroAgentService should materialize pasted screenshots in main')
assert(maestroAgent.includes("clipboard.readImage()"), 'pasted screenshots should be read from main clipboard without renderer bytes')
assert(maestroAgent.includes('onAgentSessionUsed: () => this.hydratedMaestroAgentSessions.add(sessionKey)'), 'successful turn should mark the agent session hydrated')
assert(maestroAgent.includes('freshSession: false') && maestroAgent.includes('media: turnMedia.media') && maestroAgent.includes('images: turnMedia.images'), 'normal chat turns should not force fresh sessions and should pass media refs')
assert(!coachApi.includes('resetAgentConversation'), 'public Coach XPC contract should not expose the removed reset conversation action')
assert(!coachHandler.includes('resetAgentConversation'), 'Coach XPC handler should not expose the removed reset conversation action')
assert(!maestroWindow.includes('resetAgentConversation'), 'main helper should not keep the removed reset conversation action')
assert(maestroAgent.includes('this.hydratedMaestroAgentSessions.delete(this.agentSessionKey(params?.sessionId))'), 'abort should clear hydration state')

assert(!messageStore.includes('await coach.resetAgentConversation({ sessionId: session.id })'), 'composer reset action should no longer reset the host agent session')
assert(!messageStore.includes('async reset(sessionId: string)'), 'message store should not keep the removed reset action')
assert(messageStore.includes('attachedPaths: attachedPaths?.length ? attachedPaths.slice() : undefined'), 'renderer should pass current-turn attached paths through context')
assert(channelStore.includes('latestActiveSessionForOperationTab'), 'reopened tabs should reuse persisted chat sessions')
assert(channelStore.includes('maestroSessionByTabId'), 'Control should keep one active Maestro session per operation tab')
assert(llmService.includes('this._state.resetLlmTurnState()'), 'provider/model changes should reset agent turn state')
assert(llmService.includes('this._state.resetLlmAgentSessions()'), 'logout should reset live agent sessions')
assert(llmModels.includes('Claude provider option is intentionally hidden') && llmModels.includes("provider: 'anthropic'"), 'Claude support should stay in code but the provider option should be hidden')
assert(
  llmService.includes('selectableLlmPresets()') &&
    llmService.includes('selectableLlmLoginProviders()') &&
    llmService.includes('normalizeSelectableLlmTarget'),
  'UI-facing LLM config should expose only selectable providers/presets while preserving hidden provider support'
)

const BaseAgent = loadBaseAgent()
const runtimeState = {
  createCalls: 0,
  checkCalls: 0,
  sessions: [],
  createOptions: []
}
class FakeRuntimeSession {
  listeners = new Set()
  prompts = []
  abortCalls = 0

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(message) {
    this.prompts.push(message)
    for (const listener of this.listeners) listener({ type: 'thinking_start' })
    for (const listener of this.listeners) listener({ type: 'thinking_delta', delta: 'reasoning' })
    for (const listener of this.listeners) listener({ type: 'text_delta', delta: `reply-${this.prompts.length}` })
    for (const listener of this.listeners) listener({ type: 'assistant_message_end', text: `final-${this.prompts.length}`, stopReason: 'stop' })
  }

  async abort() {
    this.abortCalls += 1
  }
}

const fakeRuntime = {
  async checkTarget(params) {
    runtimeState.checkCalls += 1
    return params.providerId === 'openai-codex' && params.modelId === 'gpt-test'
  },
  async createSession(options) {
    runtimeState.createCalls += 1
    runtimeState.createOptions.push(options)
    const session = new FakeRuntimeSession()
    runtimeState.sessions.push(session)
    return session
  }
}
const streamed = []
const activities = []
const thinkingStates = []
const agent = new BaseAgent({
  providerId: 'openai-codex',
  modelId: 'gpt-test',
  authPath: '/tmp/coach-auth.json',
  runtime: fakeRuntime,
  buildTools: () => [{ name: 'read_file', description: 'Read a file', params: [], execute: async () => 'ok' }],
  onStream: (delta) => streamed.push(delta),
  onActivity: (step) => activities.push(step),
  onThinking: (state) => thinkingStates.push(state)
})

const readiness = await agent.checkTarget()
assert(readiness.ready && readiness.providerId === 'openai-codex' && readiness.modelId === 'gpt-test', 'BaseAgent.checkTarget should delegate to the injected runtime')
const firstTurn = await agent.prompt('first', 2_000)
const secondTurn = await agent.prompt('second', 2_000)
assert(firstTurn.ok && secondTurn.ok, 'fake runtime turns should complete')
assert(runtimeState.createCalls === 1, 'BaseAgent should reuse the same runtime session across normal turns')
assert(runtimeState.sessions[0]?.prompts.length === 2, 'reused runtime session should receive both prompts')
assert(runtimeState.createOptions[0]?.tools?.length === 1, 'managed conversation sessions should include Coach tools')
assert(streamed.join('') === 'reply-1reply-2', 'BaseAgent should stream deltas from the runtime session')
assert(!activities.some((step) => step.phase === 'think'), 'BaseAgent should keep thinking out of persistent activity rows')
assert(thinkingStates.some((state) => state.active === true), 'BaseAgent should surface live thinking start state')
assert(thinkingStates.some((state) => state.active === false), 'BaseAgent should surface live thinking end state')
agent.reset()
await new Promise((resolve) => setTimeout(resolve, 0))
assert(runtimeState.sessions[0]?.abortCalls === 1, 'BaseAgent.reset should abort the dropped runtime session')
const thirdTurn = await agent.prompt('third', 2_000)
assert(thirdTurn.ok && runtimeState.createCalls === 2, 'prompt after reset should start a fresh runtime session')
assert(runtimeState.sessions[1]?.prompts.length === 1, 'fresh runtime session should receive the post-reset prompt')
const oneShot = await agent.oneShot('draft skill', 2_000)
assert(oneShot.ok && runtimeState.createCalls === 3, 'oneShot should use a throwaway runtime session')
assert(runtimeState.createOptions[2]?.tools?.length === 0, 'oneShot should not expose conversation tools')
assert(runtimeState.sessions[1]?.prompts.length === 1, 'oneShot should not reuse or mutate the managed conversation session')

console.log('[check-agent-runtime] ok')
