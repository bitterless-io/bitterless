import { runPiAutoCompactionTest, type AutoCompactionTestReport } from './piAutoCompactionTest'
import { createPiCompactionExtension } from './piNativeCompaction'
import { resolvePiCompactionSettings } from './piCompactionPolicy'
import { describeAuthFile } from './authDiagnostic'
import type { AgentRuntimeAdapter, AgentRuntimeSession, AgentRuntimeSessionOptions } from './agentRuntime.types'
import type { CodexDebugEvent } from './runtime.types'
import { bindPiTools, createPiResourceLoader, type PiModule, type TypeBoxFactory } from './piRuntimeProtocol'
import { applyPiSessionPolicy, PiRuntimeSession, type PiSession } from './piRuntimeSession'
import { resolveRuntimeToolPolicy } from './runtimeSessionPolicy'
import { createInterruptibleBash } from './piInterruptibleBash'
import { resolveRuntimeSystemPrompt } from './runtimeSystemPrompt'
import { registerBitterlessProvider } from './bitterlessProvider'

// pi is ESM-only; dynamic imports keep the Electron CJS main bundle loadable.
/**
 * pi 0.85.1 起,凭据编排归 `ModelRuntime`:`AuthStorage` 不再从包入口导出(类还在
 * `dist/core/auth-storage.js`,但 `exports` map 只开四个入口,深路径 import 被 Node 挡死),
 * `ModelRegistry.create()` 这个静态工厂也没了 —— 它变成了 `constructor(runtime)` 的同步兼容门面。
 *
 * 这里刻意**留着 `ModelRegistry` 门面**而不是直接用 `ModelRuntime`:下游的 `find()` /
 * `hasConfiguredAuth(model)` / `getApiKeyAndHeaders(model)` 因此一个字都不用改。
 * `ModelRuntime.hasConfiguredAuth` 收的是 `providerId` 而不是 `model`,直接换会悄悄改变语义。
 *
 * `allowModelNetwork` 不传 —— 0.85.1 里 `refreshFromNetwork = modelNetworkEnabled &&
 * options.allowModelNetwork === true`(`dist/core/model-runtime.js:91`),那个 `=== true` 就是
 * 目录抓取不会走网络的全部理由。
 *
 * **不要把它写成「因为我们设了 `PI_OFFLINE=1`」**(2026-09-17 核实):`modelNetworkEnabled` 是
 * `process.env.PI_OFFLINE === undefined`(:88),而 **bitterless 从来没设过 `PI_OFFLINE`** ——
 * 设它的是 micromeet-cowork(`bundledTools.service.ts`,而且那是为了工具下载,不是模型网络)。
 * 所以本仓的 `modelNetworkEnabled` 其实是 **true**:哪天有人真传了 `allowModelNetwork: true`,
 * 这里就会走网络,不会被什么离线开关兜住。
 */
const createModelRuntime = async (
  pi: PiModule,
  authPath: string,
  modelsPath?: string,
  options?: { refreshOnCreate?: boolean }
) => {
  const runtime = await pi.ModelRuntime.create({ authPath, modelsPath, ...options })
  // `bitterless` provider 在这里注册,而不是在 `createSession` 里 —— `checkTarget()` 也建 runtime,
  // 只在建会话时注册会让"这个 target 可用吗"对 Bitterless 永远答 false,UI 上表现为模型灰着
  // 但点下去又能跑(或反过来)。baseUrl 与会话 token 都是运行时值,每次建 runtime 重注册一次。
  await registerBitterlessProvider(runtime as unknown as Parameters<typeof registerBitterlessProvider>[0])
  return runtime
}

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  async checkTarget(params: { providerId: string; modelId: string; authPath: string; modelsPath?: string }): Promise<boolean> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRegistry = new pi.ModelRegistry(await createModelRuntime(pi, params.authPath, params.modelsPath))
    const model = modelRegistry.find(params.providerId, params.modelId)
    return Boolean(model && modelRegistry.hasConfiguredAuth(model))
  }

  /**
   * 解析这些目标在 pi 目录里的**真实上下文窗口**。查表,不建会话 ——
   * 与 `checkTarget()` 走同一条 `ModelRegistry.find()`。
   *
   * **为什么需要它**:窗口以前是 `llmModels.ts` 里手写的常量(`contextLengthK`),与 pi 实际
   * 用的值没有任何同步机制 —— 抄错或模型换代就静默失准,而**压缩的触发线、reserve 预算、
   * summary 上限全都乘在它上面**。一个 1M 的模型被当 256K 会提前压;反过来 200K 的被当 1M,
   * 压缩**永远不触发直到溢出**。
   *
   * 查不到的目标**不进返回值**,由调用方退 256K
   * (Ral 2026-09-11:「pi 给不出 contextWindow 就默认就是 256k,因为现在一般至少 256k 了」)。
   *
   * **`refreshOnCreate: false` 不能省**(Ral 2026-09-17,`renderer-config STUCK after 15000ms`,
   * 那次 `getLlmConfig` 实测跑了 333,784ms):`ModelRuntime.create()` 默认会跑一趟
   * availability refresh —— 它对**每个 provider** 调 `models.checkAuth()`(pi 0.85.1
   * `dist/core/model-runtime.js:100` → `:174-183`),那是网络调用,且**不受 `allowModelNetwork`
   * 管**;而 create 只在 `refreshFromNetwork && modelRefreshTimeoutMs !== undefined` 时才建
   * AbortController,所以这条路上既没有 signal 也没有超时,没登录时能挂几分钟。
   *
   * 这里跳得掉,是因为 `contextWindow` 是**静态模型数据**,查表不需要 availability 快照
   * (pi 自己对这个选项的说明:「Static models remain available.」)。
   * `checkTarget()` / `createSession()` 用的是 `hasConfiguredAuth`,那正是 refresh 填的,
   * **不能一起跳** —— 跳了会把所有 provider 报成未登录。
   */
  async describeContextWindows(params: {
    authPath: string
    modelsPath?: string
    targets: { providerId: string; modelId: string }[]
  }): Promise<Record<string, number>> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRegistry = new pi.ModelRegistry(
      await createModelRuntime(pi, params.authPath, params.modelsPath, { refreshOnCreate: false })
    )
    const windows: Record<string, number> = {}
    for (const target of params.targets) {
      const found = modelRegistry.find(target.providerId, target.modelId)
      const window = found?.contextWindow
      if (typeof window === 'number' && window > 0) windows[`${target.providerId}/${target.modelId}`] = window
    }
    return windows
  }

  async testAutoCompaction(options: {
    target: AgentRuntimeSessionOptions['target']; authPath: string; modelsPath?: string;
    cwd: string; systemPrompt: string; compactPrompt?: string; filePath?: string; signal?: AbortSignal; onCompaction?: (state: import('@shared/piCompaction.types').CompactionStatus) => void
  }): Promise<AutoCompactionTestReport> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRuntime = await createModelRuntime(pi, options.authPath, options.modelsPath)
    const modelRegistry = new pi.ModelRegistry(modelRuntime)
    const model = modelRegistry.find(options.target.providerId, options.target.modelId)
    if (!model || !modelRegistry.hasConfiguredAuth(model)) throw new Error('Sign in to the selected model before testing automatic compaction.')
    return await runPiAutoCompactionTest({ ...options, pi, modelRuntime, model, thinkingLevel: options.target.thinkingLevel })
  }

  async createSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
    const prompt = resolveRuntimeSystemPrompt(options)
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const { Type } = (await import('typebox')) as { Type: TypeBoxFactory }
    const modelRuntime = await createModelRuntime(pi, options.authPath, options.modelsPath)
    const modelRegistry = new pi.ModelRegistry(modelRuntime)
    const model = modelRegistry.find(options.target.providerId, options.target.modelId)
    if (!model || !modelRegistry.hasConfiguredAuth(model)) {
      const auth = describeAuthFile(options.authPath, options.target.providerId)
      throw new Error(
        `Not signed in to ${providerDisplayName(options.target.providerId)} for "${options.target.providerId}/${options.target.modelId}". ` +
          `Use the app's AI Login button to authorize in your browser ` +
          `so ${options.authPath} gets a "${options.target.providerId}" credential ` +
          `(or set COACH_PI_PROVIDER / COACH_PI_MODEL to a provider you're already logged into).\n` +
          auth
      )
    }

    const customTools = bindPiTools(pi, Type, options)
    const { builtinNames, allowedToolNames } = resolveRuntimeToolPolicy(options)
    const settingsManager = pi.SettingsManager.inMemory({ compaction: resolvePiCompactionSettings(model, options.autoCompaction !== false) })
    const compactionState: import('./piNativeCompaction').PiCompactionState = {}
    let nativeSession: import('@earendil-works/pi-coding-agent').AgentSession | undefined
    const extension = createPiCompactionExtension(pi, {
      getPrompt: options.compactPrompt,
      getStream: () => nativeSession?.agent.streamFunction,
      getRetry: () => settingsManager.getRetrySettings(),
      state: compactionState
    })
    const resources = createPiResourceLoader(pi, () => prompt.hostText, options.skillResources, [extension])
    // Pi's /new rebuilds and reloads its resources. A supplied SDK loader needs the same
    // initialization here; subsequent turns reuse the loaded snapshot.
    await resources.reload()
    const promptSource = Object.assign(prompt, { resourceRevision: () => options.skillResources?.revision?.() || '', skillPrompt: (activeTools: string[]) => {
      const reader = activeTools.includes('read') ? 'read' : activeTools.includes('bash') ? 'bash' : undefined
      // 这里是 `setSystemPrompt()` 的**校验镜像** —— 它要复算出 pi 会产出的那份 system 来比对,
      // 所以必须和 pi 的 `_rebuildSystemPrompt()` 用同一个渲染器。A8 完整目录走的是另一条路
      // (资源加载器的 `getAppendSystemPrompt()`),不在这里拼,否则比对必然失配。
      return reader ? pi.formatSkillsForPrompt(resources.getSkills().skills, reader) : ''
    } })
    // 可被打断的 `bash` —— 覆盖 pi 的内置同名工具(customTools 按名字覆盖 builtin,
    // `agent-session.js:2119`)。目的只有一个:人在 tooling 期间发的消息要有**边界**可以落地
    // (`piInterruptibleBash.ts` 的文件头写了完整理由)。
    // 只在真的开了内置 bash 的会话上做 —— 一次性/无工具会话不需要,也不该多一个工具定义。
    const interruptibleBash = builtinNames.includes('bash')
      ? createInterruptibleBash(pi.createLocalBashOperations())
      : undefined
    const bashTool = interruptibleBash
      ? pi.createBashToolDefinition(prompt.cwd, { operations: interruptibleBash.operations })
      : undefined
    const { session } = await pi.createAgentSession({
      model,
      modelRuntime,
      thinkingLevel: options.target.thinkingLevel,
      // pi's allowlist filters custom tools too; host policy includes every selected tool.
      ...(allowedToolNames ? { tools: allowedToolNames } : { noTools: customTools.length > 0 ? 'builtin' : 'all' }),
      cwd: prompt.cwd,
      ...(options.agentDir ? { agentDir: options.agentDir } : {}),
      // `createBashToolDefinition` 的泛型是它自己的 schema,与 `customTools` 的通配签名不兼容 ——
      // 这里只是把它放进同一张表,不读它的参数类型,所以按 pi 自己的宽签名收窄一次。
      customTools: bashTool ? [...customTools, bashTool as unknown as (typeof customTools)[number]] : customTools,
      // pi adds cwd metadata itself; the host text is passed through without trimming.
      resourceLoader: resources,
      // Without this, pi reads `<cwd>/.pi/settings.json` as TRUSTED project settings
      // (sdk.js:73 `options.settingsManager ?? SettingsManager.create(cwd, agentDir)`;
      // settings-manager.js:169 `projectTrusted ?? true`), and that file supplies the bash tool's
      // shellCommandPrefix + shellPath (agent-session.js:2184-2185 → tools/bash.js:156). Harmless
      // while cwd was `/`; once cwd follows the workspace, any repository opened here could inject a
      // shell wrapper into every bash call. The workflow path already does this
      // (workflowEngine/piAgentSession.ts). See docs/features/agent-cwd-follows-workspace.md.
      settingsManager,
      sessionManager: options.sessionFile ? pi.SessionManager.open(options.sessionFile, undefined, prompt.cwd) : pi.SessionManager.inMemory()
    })
    nativeSession = session
    options.onDebug?.({
      scope: options.scope,
      phase: 'pi-session-start',
      level: 'info',
      message:
        `pi session ready (${options.target.providerId}/${options.target.modelId}, ${customTools.length} host tools` +
        `${allowedToolNames ? `, builtins: ${builtinNames.join('/')}` : ', builtins off'}).`,
      detail: { cwd: prompt.cwd, agentDir: options.agentDir, builtinTools: builtinNames },
      ts: Date.now()
    })
    const debug = (event: Omit<CodexDebugEvent, 'ts' | 'scope'>): void =>
      options.onDebug?.({ scope: options.scope, ts: Date.now(), ...event })
    if (options.beforeModelRequest) {
      const native = session.agent.transformContext
      session.agent.transformContext = async (messages, signal) => {
        const current = native ? await native(messages, signal) : messages
        // **只保留就绪副作用,不再追加目录消息。**这个回调里做的是机构授权与云端目录就绪
        // (`skillScopeContext.authorize()` / `skillCloud.ensureCatalog()`),那一步仍然必要:
        // 它保证下面系统提示词里的 A8 目录是授权后的完整快照。
        //
        // 追加那一步去掉了:目录现在是 A8,走资源加载器的 `getAppendSystemPrompt()` 进系统提示词,
        // 每会话一份(`overmind:areas/agent-runtime/chat/prompt-structure.html` 表 1)。
        // 原来那行 `appendCurrentSkillCatalog()` 会在每次请求末尾再挂一条同样的 user 消息,
        // 而且超预算时直接 `throw` —— 抛出不改变上下文,下一轮压缩仍不触发、依然抛,
        // 是一条只能新开会话的死路(`chat/compaction/compaction.html` #7.3)。
        await options.beforeModelRequest?.()
        return current
      }
    }
    applyPiSessionPolicy(session as PiSession, debug, options.autoCompaction !== false)
    return new PiRuntimeSession(session as PiSession, debug, promptSource, compactionState, interruptibleBash)
  }
}

const providerDisplayName = (providerId: string): string => {
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT subscription)'
  if (providerId === 'anthropic') return 'Claude'
  return providerId
}
