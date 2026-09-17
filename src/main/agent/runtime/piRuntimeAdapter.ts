import { appendCurrentSkillCatalog } from './skillCatalogRequest'
import { describeAuthFile } from './authDiagnostic'
import type { AgentRuntimeAdapter, AgentRuntimeSession, AgentRuntimeSessionOptions } from './agentRuntime.types'
import type { CodexDebugEvent } from './runtime.types'
import { bindPiTools, createPiResourceLoader, type PiModule, type TypeBoxFactory } from './piRuntimeProtocol'
import { applyPiSessionPolicy, PiRuntimeSession, type PiSession } from './piRuntimeSession'
import { resolveRuntimeToolPolicy } from './runtimeSessionPolicy'
import { resolveRuntimeSystemPrompt } from './runtimeSystemPrompt'

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
 * `allowModelNetwork` 不传 —— 0.85.1 的默认值是 false,与我们一直设的 `PI_OFFLINE=1` 同义。
 */
const createModelRuntime = async (
  pi: PiModule,
  authPath: string,
  modelsPath?: string,
  options?: { refreshOnCreate?: boolean }
) => await pi.ModelRuntime.create({ authPath, modelsPath, ...options })

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
    const { session } = await pi.createAgentSession({
      model,
      modelRuntime,
      thinkingLevel: options.target.thinkingLevel,
      // pi's allowlist filters custom tools too; host policy includes every selected tool.
      ...(allowedToolNames ? { tools: allowedToolNames } : { noTools: customTools.length > 0 ? 'builtin' : 'all' }),
      cwd: prompt.cwd,
      ...(options.agentDir ? { agentDir: options.agentDir } : {}),
      customTools,
      // pi adds cwd metadata itself; the host text is passed through without trimming.
      resourceLoader: createPiResourceLoader(pi, () => prompt.hostText),
      // Without this, pi reads `<cwd>/.pi/settings.json` as TRUSTED project settings
      // (sdk.js:73 `options.settingsManager ?? SettingsManager.create(cwd, agentDir)`;
      // settings-manager.js:169 `projectTrusted ?? true`), and that file supplies the bash tool's
      // shellCommandPrefix + shellPath (agent-session.js:2184-2185 → tools/bash.js:156). Harmless
      // while cwd was `/`; once cwd follows the workspace, any repository opened here could inject a
      // shell wrapper into every bash call. The workflow path already does this
      // (workflowEngine/piAgentSession.ts). See docs/features/agent-cwd-follows-workspace.md.
      settingsManager: pi.SettingsManager.inMemory(),
      sessionManager: pi.SessionManager.inMemory()
    })
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
        const catalog = await options.beforeModelRequest?.()
        if (!catalog) return current
        const latest = appendCurrentSkillCatalog({ messages: current, catalog, contextWindow: model.contextWindow, maxTokens: model.maxTokens, systemPrompt: options.systemPrompt })
        options.onDebug?.({ scope: options.scope, phase: 'skills-catalog-request', level: 'info', message: 'Complete current Skills catalog attached to model request.', detail: { catalog }, ts: Date.now() })
        return latest
      }
    }
    applyPiSessionPolicy(session as PiSession, debug)
    return new PiRuntimeSession(session as PiSession, debug, prompt)
  }
}

const providerDisplayName = (providerId: string): string => {
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT subscription)'
  if (providerId === 'anthropic') return 'Claude'
  return providerId
}
