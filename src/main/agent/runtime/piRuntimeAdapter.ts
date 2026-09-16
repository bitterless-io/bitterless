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
const createModelRuntime = async (pi: PiModule, authPath: string, modelsPath?: string) =>
  await pi.ModelRuntime.create({ authPath, modelsPath })

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
   */
  async describeContextWindows(params: {
    authPath: string
    modelsPath?: string
    targets: { providerId: string; modelId: string }[]
  }): Promise<Record<string, number>> {
    const pi: PiModule = await import('@earendil-works/pi-coding-agent')
    const modelRegistry = new pi.ModelRegistry(await createModelRuntime(pi, params.authPath, params.modelsPath))
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
