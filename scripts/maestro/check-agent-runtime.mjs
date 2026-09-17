import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
// 读本仓的副本等于在检查一个不再被打包的文件,守卫会安静地失去意义。
const sdkRoot = join(projectRoot, 'src', 'main', 'agent')
const workspaceRoot = projectRoot
const require = createRequire(import.meta.url)
const baseAgent = readFileSync(join(root, 'main/agent/BaseAgent.ts'), 'utf8')
const runtimeTypes = readFileSync(join(root, 'main/agent/runtime/agentRuntime.types.ts'), 'utf8')
const piRuntime = readFileSync(join(root, 'main/agent/runtime/piRuntimeAdapter.ts'), 'utf8')
const piSession = readFileSync(join(root, 'main/agent/runtime/piRuntimeSession.ts'), 'utf8')
const piProtocol = readFileSync(join(root, 'main/agent/runtime/piRuntimeProtocol.ts'), 'utf8')
const hostToolExecution = readFileSync(join(root, 'main/agent/runtime/hostToolExecution.ts'), 'utf8')
const runtimeSystemPrompt = readFileSync(join(root, 'main/agent/runtime/runtimeSystemPrompt.ts'), 'utf8')
const agentService = readFileSync(join(root, 'main/agent/maestroAgent.service.ts'), 'utf8')
// 断言「某个文件保持删除状态」用它 —— 直接 readFileSync 会在文件不存在时抛，那是我们要的相反结果。
const readIfExists = (rel) => (existsSync(join(projectRoot, rel)) ? readFileSync(join(projectRoot, rel), 'utf8') : '')
const mediaResolver = readFileSync(join(root, 'main/agent/runtime/mediaRefResolver.ts'), 'utf8')
const mediaUpload = readFileSync(join(root, 'main/maestro/networking/api/mediaUpload.api.ts'), 'utf8')
const errorSanitizer = readFileSync(join(sdkRoot, 'runtime/errorSanitizer.ts'), 'utf8')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const maestroAgent = readFileSync(join(root, 'main/agent/maestroAgent.service.ts'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')
const coachHandler = readFileSync(join(root, 'main/maestro/xpc/coach.handler.ts'), 'utf8')
const messageStore = readFileSync(join(root, 'renderer/maestro/control/src/store/message.store.ts'), 'utf8')
const channelStore = readFileSync(join(root, 'renderer/maestro/control/src/store/channel.store.ts'), 'utf8')
const llmService = readFileSync(join(root, 'main/maestro/llm/maestroLlm.service.ts'), 'utf8')
const llmModels = readFileSync(join(root, 'main/maestro/llm/llmModels.ts'), 'utf8')
const packageJson = readFileSync(join(projectRoot, 'package.json'), 'utf8')
const piAiTypes = readFileSync(join(workspaceRoot, 'node_modules/@earendil-works/pi-ai/dist/types.d.ts'), 'utf8')
// pi-ai moved the OpenAI-completions request serializer out of dist/providers/ into dist/api/
// (0.80.x). Resolve the current location first, keep the pre-0.80 path as a fallback, and when a
// future upgrade moves it again skip the dependent assertion with a loud reason instead of
// crashing the whole script — an ENOENT here silently disabled every assertion in this file.
const piOpenAiCompletionsCandidates = [
  join(workspaceRoot, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'),
  join(workspaceRoot, 'node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js')
]
const piOpenAiCompletionsPath = piOpenAiCompletionsCandidates.find((candidate) => existsSync(candidate)) || null
const piOpenAiCompletions = piOpenAiCompletionsPath ? readFileSync(piOpenAiCompletionsPath, 'utf8') : null
if (!piOpenAiCompletionsPath) {
  console.warn(`[check-agent-runtime] SKIP pi openai-completions media-serialization assertion: no openai-completions.js under @earendil-works/pi-ai (looked in ${piOpenAiCompletionsCandidates.join(', ')}). Re-point this guard at the new pi-ai path.`)
}

/**
 * **收集全部失败,不在第一条就抛。**
 *
 * 2026-09-10 的教训:这个守卫原来是 fail-fast 的,而第 122 行那条
 * (`BaseAgent should use the Coach runtime router by default`)**本来就是红的** ——
 * BaseAgent 早就把 runtime 改成必填入参、没有默认值。于是它一抛,**后面所有断言从没执行过**,
 * 修好它之后立刻又冒出下一条早已过时的断言。
 *
 * bl 自己记过同一件事:`docs/issues/maestro-parity-guards-revived.md`
 * 「`check-maestro.mjs:13` 在遍历之前先调 assertMaestroAliasBoundary();这个断言在 HEAD 就是红的
 *  ⇒ 它一抛,后面 39 个检查一个都不会执行」。fail-fast 的守卫会把"一条坏了"伪装成"只有一条坏了"。
 */
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
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
    /**
     * BaseAgent 的相对 import 要在这里给桩 —— `require` 是相对**本守卫脚本**建的,
     * 解析不到 `./runtime/*`,而它们是 `.ts`、也不能直接 require。
     *
     * 2026-09-10:原来只桩了 `./runtime/coachRuntimeAdapter`,而 BaseAgent 后来新增的
     * `inputBudget` / `modelIoLog` 两个导入没人补 —— `loadBaseAgent()` 因此一直是坏的,
     * 只是它藏在那条早已变红的 fail-fast 断言后面**从没被执行过**。
     * 这两个桩只需满足"被调用不炸",守卫断言的是 BaseAgent 的会话行为,不是它们的行为。
     */
    (specifier) => {
      if (specifier === './runtime/inputBudget') {
        return {
          inputBudget: {
            line: () => '',
            report: () => undefined,
            reset: () => undefined,
            turnIndexNow: () => 0,
            turnStart: () => undefined
          }
        }
      }
      // BaseAgent 自 2026-09 起在构造期就 `new BackgroundContextInbox()`。没有这个桩,守卫在
      // require 阶段就抛 `Cannot find module`,连一条断言都跑不到 —— 而 check-maestro.mjs 会把
      // 每个 check-*.mjs 都拉起来,所以整条 `yarn check:maestro` 跟着红。
      // 守卫只关心 BaseAgent 把 cwd/system 提示词传下去,不关心追加消息的行为。
      if (specifier === './steering/backgroundContextInbox') {
        return {
          BackgroundContextInbox: class {
            flush() {}
            retain() {}
            reset() {}
          }
        }
      }
      // 真实语义的轻桩:cwd 必填这条是本守卫要盯的契约之一,桩里也必须保持,否则
      // 「BaseAgent 把 cwd 传下去」这类断言会在一个宽松的桩上假绿。
      if (specifier === './runtime/runtimeSystemPrompt') {
        return {
          requireSystemPrompt: (text) => text,
          resolveRuntimeSystemPrompt: ({ systemPrompt, cwd }) => {
            if (typeof cwd !== 'string' || !cwd.trim()) {
              throw new Error('cwd is required — the runtime must never fall back to the process working directory')
            }
            return {
              hostText: systemPrompt,
              cwd,
              finalSystemPrompt: `${systemPrompt}\nCurrent working directory: ${cwd}\n`
            }
          }
        }
      }
      // 覆盖 BaseAgent.runPrompt 真正调到的整个表面(isClosed / start / pause / next / consume /
      // cancel / enqueue)。缺任何一个,回合循环会在这个桩上提前断掉,守卫报的就不是它要守的东西了。
      // 行为取「从不插话」:队列恒空、pause 立即返回,于是回合按正常路径跑完。
      if (specifier === './steering/turnSteeringInbox') {
        return {
          TurnSteeringInbox: class {
            isClosed = false
            start() {}
            async pause() {}
            next() {
              return undefined
            }
            consume() {}
            cancel() {
              this.isClosed = true
            }
            async enqueue() {
              return { ok: false, error: 'steering is stubbed in this guard' }
            }
          }
        }
      }
      // 静态 system 提示词:守卫只关心 BaseAgent 把它传下去这件事,不关心内容。
      if (specifier === './prompt/projectInstructions') return { readProjectInstructions: async () => '' }
      if (specifier === './prompt/sysPrompt') {
        return { BASE_SYSTEM_PROMPT: 'STUB', A7_DISCIPLINE: 'DISCIPLINE STUB' }
      }
      if (specifier === './runtime/modelIoLog') {
        return {
          modelIoLog: {
            append: () => undefined,
            openSession: async () => undefined,
            sessionDir: null
          }
        }
      }
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
  assert(![piRuntime, piSession, piProtocol].some(source => source.includes(forbidden)), `pi runtime must not use CLI per-message execution: ${forbidden}`)
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
assert(mediaUpload.includes('COACH_MEDIA_UPLOAD_URL'), 'media upload endpoint should be explicitly configured by env')
assert(mediaUpload.includes('new FormData()') && mediaUpload.includes("form.set('file'"), 'media upload should use multipart form data')
assert(mediaUpload.includes('new File([readFileSync(ref.path)]'), 'media upload should send binary file data without string/base64 conversion')
assert(mediaUpload.includes('upload response did not include url/downloadUrl'), 'media upload should require a returned downloadable URL')
assert(!mediaUpload.includes('base64') && !mediaUpload.includes("toString('base64')"), 'media upload must not use base64')
// 2026-09-10:中间那层 `CoachRuntimeAdapter` 拆了 —— 它是 21 行纯转发(`select()` 恒返回同一个
// `PiRuntimeAdapter`),AI-CRMS 2026-09 退役后只剩 pi 一条路,那是为一个不存在的第二条路付抽象税。
// **原来那四条断言里只有一条还有意义**,就是"不许复活 AI-CRMS",迁到这里;
// 另外三条守的是被拆掉那层自己的形状(own the instance / keep the seam / route to pi),
// 随它一起作废 —— 守一个已经不存在的接缝,只会在下一次真要加接缝时挡路。
// 钉的是「不许有第二条运行时分支」,不是「不许提到 ai-crms」——
// 文件里那句 `ai-crms` 是历史注释(记 2026-09-08 那个 bug 曾在 ai-crms adapter 上原样复发),
// 按字面查会把它误判成复活路由。第一版就是这么写的,当场被自己的守卫抓住。
assert(
  !/from ['"].*aiCrms|new AiCrms|AiCrmsRuntimeAdapter/.test(piRuntime),
  'PiRuntimeAdapter must not resurrect the retired AI-CRMS runtime (import/instantiate)'
)
assert(
  !readIfExists('src/main/agent/runtime/coachRuntimeAdapter.ts'),
  'coachRuntimeAdapter.ts 应当保持删除状态 —— 它是纯转发层,重新引入会让每次加会话入参都多付一次过路费'
)
assert(
  agentService.includes('runtime: new PiRuntimeAdapter()'),
  'agentPorts() 应当直接持有 PiRuntimeAdapter(中间那层已拆)'
)
assert(errorSanitizer.includes('export const sanitizeRuntimeError') && errorSanitizer.includes('[REDACTED_JWT]'), 'runtime error sanitizer should redact common token patterns')
assert(piProtocol.includes("sanitizeRuntimeError(event.message.errorMessage, 'provider')") && hostToolExecution.includes("sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')"), 'pi protocol and host executor should sanitize provider and tool errors')
assert(piProtocol.includes('executeHostTool(spec, params') && piRuntime.includes('bindPiTools(pi, Type, options)'), 'pi adapter must use the protocol binding and shared host executor')
assert(runtimeTypes.includes('systemPrompt: string') && !runtimeTypes.includes('systemPrompt?: string'), 'runtime systemPrompt must be required')
assert(runtimeSystemPrompt.includes('typeof text !==') && runtimeSystemPrompt.includes('!text.trim()') && runtimeSystemPrompt.includes('return text'), 'runtime prompt contract must reject blank/missing text without rewriting it')
assert(piRuntime.indexOf('resolveRuntimeSystemPrompt(options)') < piRuntime.indexOf("await import('@earendil-works/pi-coding-agent')", piRuntime.indexOf('async createSession')), 'pi must validate host instructions before SDK/auth side effects')
assert(piRuntime.includes('const resources = createPiResourceLoader(pi, () => prompt.hostText, options.skillResources)') && piRuntime.includes('await resources.reload()') && piRuntime.includes('resourceLoader: resources') && piRuntime.includes('cwd: prompt.cwd'), 'pi must always use the host loader and resolved working directory')
assert(packageJson.includes('"check:maestro": "node scripts/maestro/check-maestro.mjs"'), 'package scripts should expose the embedded Maestro parity suite')
assert(piAiTypes.includes('export interface ImageContent') && piAiTypes.includes('data: string;') && !piAiTypes.includes('url: string;'), 'pi 0.79 ImageContent is base64-data only, not URL-native')
// 2026-08-28: re-pointed, NOT retired. The guarded fact still holds in pi-ai 0.80.10 — only the
// file moved (dist/providers/ -> dist/api/); the base64 data-URL serialization is unchanged at
// dist/api/openai-completions.js:747. This is why PiRuntimeSession.prompt() still sends a textual
// @path note instead of pi native media (piRuntimeSession.ts).
if (piOpenAiCompletions) {
  assert(piOpenAiCompletions.includes('url: `data:${item.mimeType};base64,${item.data}`'), 'pi openai-completions provider still serializes images as base64 data URLs')
}

assert(baseAgent.includes('private sessionPromise: Promise<AgentRuntimeSession> | null = null'), 'BaseAgent should keep one reusable session promise')
// **这条断言本来就是红的**(2026-09-10 发现):BaseAgent 早就把 runtime 改成必填入参
// (`this.runtime = opts.runtime`),没有任何默认值,而断言还在找那个已经不存在的
// `new CoachRuntimeAdapter()`。守一个不存在的默认值 = 这个守卫整体不可执行(assert 一抛就
// 停在这儿,后面的都不跑)。现在改成守真正的事实:**运行时是注入的,BaseAgent 不自己选**。
assert(
  baseAgent.includes('this.runtime = opts.runtime') && !baseAgent.includes('?? new '),
  'BaseAgent 的 runtime 必须是注入的、没有默认值 —— 选运行时不是它的职责'
)
assert(baseAgent.includes('if (!this.sessionPromise) this.sessionPromise = this.startSession()'), 'ensureSession should be idempotent')
assert(baseAgent.includes('session = await withTimeout(') && baseAgent.includes('this.ensureSession()'), 'prompt should reuse the managed session')
assert(baseAgent.includes('if (options?.freshSession) this.reset()'), 'prompt should explicitly opt into fresh sessions only when requested')
// **表 2 进 system 槽位** —— 2026-09-11 换掉了原来那条钉 `primed` 的断言。
// 旧机制:产品层拼在**第一条 user 消息**前面(`withSystemPreamble`,`primed` 守着只拼一次),
// 于是**一次压缩就把产品人格冲掉了**,而且此后不会补回来(压缩不走 reset)。
// 新机制:`fullSystemPrompt()` = 表 1 + 表 2,建会话时交给运行时,每轮由 pi 重发。
// 下面三条是**正向**守卫 —— 防止那套 user 前缀机制被重新引入。
assert(
  baseAgent.includes('private fullSystemPrompt(') && baseAgent.includes('[BASE_SYSTEM_PROMPT, projectInstructions, A7_DISCIPLINE, product]'),
  'BaseAgent 必须有 fullSystemPrompt(),且按顺序拼接 BASE_SYSTEM_PROMPT、A6 项目指令、A7 与产品层'
)
assert(
  baseAgent.includes('systemPrompt: this.fullSystemPrompt()'),
  'createSession 必须把完整那份(表 1 + 表 2)交给运行时 —— 只传表 1 等于产品层又回到 user 消息里'
)
assert(
  !baseAgent.includes('withSystemPreamble') && !baseAgent.includes('this.primed'),
  'user 消息前缀那套机制不许回来 —— 它会在压缩后静默丢掉产品人格'
)
assert(baseAgent.includes('this.sessionPromise = null'), 'reset should drop the session')
assert(baseAgent.includes('async oneShot(prompt: string'), 'structured generation should remain separate one-shot behavior')
assert(baseAgent.includes('this.createSession(false)'), 'oneShot should use a throwaway no-tool session')
assert(baseAgent.includes('this.opts.onStream?.(event.delta)'), 'BaseAgent should stream text deltas to the UI')
assert(baseAgent.includes('this.opts.onThinking?.({ active, ts: Date.now() })') && baseAgent.includes("type === 'tool_start'"), 'BaseAgent should surface live thinking and tool activity')
assert(baseAgent.includes('media: options?.media') && baseAgent.includes('images: options?.images'), 'BaseAgent should pass current-turn media refs into the runtime prompt')

assert(piRuntime.includes("await import('@earendil-works/pi-coding-agent')"), 'pi runtime should use the SDK directly')
assert(piRuntime.includes('pi.createAgentSession'), 'pi runtime should create SDK sessions')
assert(![piRuntime, piSession, piProtocol].some(source => source.includes('buildPiImages')), 'pi runtime must not convert media refs into inline payloads')
assert(![piRuntime, piSession, piProtocol].some(source => /toString\(['"]base64['"]\)/.test(source)), 'pi runtime must not base64 encode attachments')
// 判据是「媒体以 text/path 引用传递,不做 base64 内联」,不是那一行的字面写法。
// steering 改动给 prompt() 加了第二个入参({ streamingBehavior }),写死字面量会让这条
// 在语义完全没变的情况下变红 —— 而这套守卫恰好那段时间整套没在执行,所以没人发现。
assert(/this\.session\.prompt\(message\.text[,)]/.test(piSession), 'pi runtime should keep media refs in the text/path boundary')
assert(piSession.includes('base64 payloads') && piSession.includes('textual @path note'), 'pi runtime should document why native media is not used')
assert(piRuntime.includes("sessionManager: pi.SessionManager.inMemory()"), 'pi runtime should keep session state in memory')
assert(piRuntime.includes("noTools: customTools.length > 0 ? 'builtin' : 'all'"), 'pi runtime should disable builtin coding tools while keeping Coach custom tools')
assert(piProtocol.includes("type === 'tool_execution_start'"), 'pi runtime should normalize tool events')
assert(piProtocol.includes("inner.type === 'text_delta'"), 'pi runtime should normalize streamed text')

assert(maestroAgent.includes('private readonly maestroAgents = new Map<string, MaestroAgent>()'), 'MaestroAgentService should cache agents by chat session id')
assert(maestroAgent.includes('private readonly hydratedMaestroAgentSessions = new Set<string>()'), 'MaestroAgentService should track which chat sessions have been hydrated')
assert(maestroAgent.includes('let agent = this.maestroAgents.get(key)'), 'MaestroAgentService should reuse cached chat agents')
assert(maestroAgent.includes('this.maestroAgents.set(key, agent)'), 'MaestroAgentService should cache new chat agents')
assert(maestroAgent.includes('includeConversationMemory = !this.hydratedMaestroAgentSessions.has(sessionKey)'), 'first turn should hydrate persisted chat memory once')
assert(maestroAgent.includes('const mediaInput = await this.buildAgentMediaInput(sessionKey, context?.attachedPaths)'), 'MaestroAgentService should build current-turn media refs from attached paths')
assert(maestroAgent.includes('resolveRuntimeMediaRefs({') && maestroAgent.includes('preferred transport:'), 'MaestroAgentService should resolve media transport per provider')
assert(maestroAgent.includes('uploadMediaRefsForProvider({') && maestroAgent.includes('mediaTransportForProvider(this.activeLlmProvider) === \'url\''), 'MaestroAgentService should try configured upload only for URL-first providers')
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
// 措辞过时(2026-09-10 把这个守卫改成收集全部之后才露出来):`abortAgent` 早就把
// `agentSessionKey(...)` 提成了局部 `sessionKey`,断言还在找那个内联表达式。**行为一直是对的**
// —— 按会话清,不是整集清。所以钉的是那件事本身,而不是它当时的写法:
//  · `delete(sessionKey)` 必须在 abortAgent 里(停一个会话不该迫使别的会话重新注入记忆);
//  · abortAgent 里不许出现 `.clear()`(那就是整集清)。
const abortAgentBody = maestroAgent.slice(
  maestroAgent.indexOf('async abortAgent(params: {'),
  maestroAgent.indexOf('async abortDelegate(params?: {')
)
assert(
  abortAgentBody.includes('this.hydratedMaestroAgentSessions.delete(sessionKey)'),
  'abortAgent 必须按会话清 hydration 标记'
)
assert(
  !abortAgentBody.includes('hydratedMaestroAgentSessions.clear()'),
  'abortAgent 不许整集清 hydration —— 那会让停 A 迫使 B/C 重新注入会话记忆'
)

assert(!messageStore.includes('await coach.resetAgentConversation({ sessionId: session.id })'), 'composer reset action should no longer reset the host agent session')
assert(!messageStore.includes('async reset(sessionId: string)'), 'message store should not keep the removed reset action')
assert(messageStore.includes('attachedPaths: attachedPaths?.length ? attachedPaths.slice() : undefined'), 'renderer should pass current-turn attached paths through context')
assert(channelStore.includes('latestActiveSession()'), 'Control should restore recent chat sessions independently of tabs')
assert(!channelStore.includes('maestroSessionByTabId'), 'browser tabs must not own the selected chat')
assert(llmService.includes('this._state.resetLlmTurnState()'), 'provider/model changes should reset agent turn state')
assert(llmService.includes('this._state.resetLlmAgentSessions()'), 'logout should reset live agent sessions')
// **Claude 已退役**(Ral 2026-09-11:「bl cowork 都不用 claude 的了」)。此前这条钉的是
// 「留着 preset、只隐藏 provider 选项」—— 那个决定被推翻了,preset 也删了。
// 现在钉反过来的事实,防止有人把它当"漏删"又加回来:
// 先剥掉行注释再判 —— cowork 那边 `LLM_PROVIDERS` 里还留着一段注释掉的 anthropic 块作为史料,
// 不剥的话它会被当成"活着的 preset"而误报。
assert(
  !/provider: 'anthropic',/.test(llmModels.replace(/^\s*\/\/.*$/gm, '')),
  'Claude preset 已退役,不该回来'
)
// 别名归一化**要留着** —— 旧会话存过 anthropic 这个 target,删掉会让它们解析失败而不是优雅退回默认。
assert(llmModels.includes("=== 'claude'"), "claude → anthropic 的别名归一化要留着(旧会话存过那个 target)")
// 上下文窗口不许再手写死:它必须由 pi 目录解析(实测 2026-09-11 手写值 6 个全错,
// `gpt-5.6-*` 写 372K 而真值 272K ⇒ 触发线落在真实窗口的 136%,压缩永不触发)。
assert(llmModels.includes('applyResolvedContextWindows'), '上下文窗口必须由 pi 解析,不能只靠预设里手写的 contextLengthK')
assert(llmModels.includes('DEFAULT_CONTEXT_WINDOW_TOKENS = 256 * 1024'), '解析不到时退 256K(Ral 2026-09-11)')
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
  cwd: '/tmp/coach-fallback-workspace',
  runtime: fakeRuntime,
  describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Test', supplier: 'fixture' }),
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

// cwd:未绑项目时用宿主给的兜底,绑了就跟着项目根走。pi 在建会话时把 cwd 冻进 AgentSession._cwd
// 并烤进内置工具,所以它是**建会话时**读的 —— 这几条就是在钉这个时机。
// docs/features/agent-cwd-follows-workspace.md
assert(
  runtimeState.createOptions[0]?.cwd === '/tmp/coach-fallback-workspace',
  'BaseAgent should pass the host fallback cwd while no project is bound'
)
await agent.setProjectRoot('/tmp/coach-project-root')
agent.reset()
await new Promise((resolve) => setTimeout(resolve, 0))
const boundTurn = await agent.prompt('bound', 2_000)
assert(boundTurn.ok, 'a turn after binding a project should still complete')
assert(
  runtimeState.createOptions.at(-1)?.cwd === '/tmp/coach-project-root',
  'a session created after setProjectRoot should use the project root as cwd'
)
await agent.setProjectRoot(undefined)
agent.reset()
await new Promise((resolve) => setTimeout(resolve, 0))
const unboundTurn = await agent.prompt('unbound', 2_000)
assert(unboundTurn.ok, 'a turn after unbinding should still complete')
assert(
  runtimeState.createOptions.at(-1)?.cwd === '/tmp/coach-fallback-workspace',
  'unbinding the project should fall back to the host cwd, never to process.cwd()'
)

if (failures.length) {
  console.error(`[check-agent-runtime] FAILED — ${failures.length} 条`)
  for (const line of failures) console.error('  ✗ ' + line)
  process.exit(1)
}
console.log('[check-agent-runtime] ok')
