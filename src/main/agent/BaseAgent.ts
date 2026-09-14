import { homedir } from 'os'
import { join } from 'path'
import { BASE_SYSTEM_PROMPT } from './prompt/sysPrompt'
import { inputBudget } from './runtime/inputBudget'
import { modelIoLog } from './runtime/modelIoLog'
import type { AgentActivityStep, AgentThinkingState, CodexDebugEvent, LlmEffort } from './runtime/runtime.types'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeContextSurface,
  AgentRuntimeEvent,
  AgentRuntimeImage,
  AgentRuntimeMediaRef,
  AgentRuntimePrompt,
  AgentRuntimeSession,
  AgentRuntimeThinkingLevel,
  AgentRuntimeUsage,
  AgentToolParamSpec,
  AgentToolSpec,
  AgentTurnReply
} from './runtime/agentRuntime.types'

export type PiParamSpec = AgentToolParamSpec
export type PiToolSpec = AgentToolSpec
export type PiAgentReply = AgentTurnReply

export interface BaseAgentPromptOptions {
  freshSession?: boolean
  media?: AgentRuntimeMediaRef[]
  images?: AgentRuntimeImage[]
}

/**
 * `steerActiveTurn()` 的结果。
 *
 * - `idle` —— 当下**没有**活跃回合。调用方应当走原来的 `prompt()`(steer-003「要点」第 3 条)。
 * - `delivered` —— 已把原话交给**当前**那个活会话,它是这个回合的一部分,没有自己的回复。
 * - `failed` —— 有活跃回合但投递失败;回合本身**没有被动过**。
 */
export type BaseAgentSteerOutcome = 'idle' | 'delivered' | 'failed'

export interface BaseAgentSteerResult {
  outcome: BaseAgentSteerOutcome
  error?: string
}

/**
 * 有活跃回合、但那个回合**还没进入流式** —— 消息**一个字都没排进去**(见 `steerActiveTurn` 注释
 * 第 4 条:那个窗口里投出去会角色反转,留下一个无人订阅的孤儿 run)。
 *
 * 导出仅为可测:守卫要能断言「非流式时报的正是这一档 `failed`」,而不是把这句话在两处各抄一遍。
 */
export const STEER_NOT_STREAMING = 'active turn has not started streaming yet — nothing was queued'

export interface BaseAgentOptions {
  /** pi-ai provider id. Default 'openai-codex'. Env: COACH_PI_PROVIDER. */
  providerId?: string
  /** Model id for the provider (openai-codex default: gpt-6-astra). Env: COACH_PI_MODEL. */
  modelId?: string
  /** Thinking/effort level for the provider. */
  effort?: LlmEffort
  /** pi auth store path. Cowork passes a userData path (coworkAuthPath); populated by the in-app
   * browser login (AuthStorage.login), NOT the `pi` CLI. Defaults to ~/.pi/agent/auth.json. */
  authPath?: string
  /** Optional pi models.json path for app-local custom providers. */
  modelsPath?: string
  /** pi agent dir (auth/sessions/managed bin). Cowork passes `<userData>/.pi`. */
  agentDir?: string
  /** cwd for pi's builtin file tools. Cowork passes `<userData>/skills` (has the preset node_modules). */
  cwd?: string
  /** pi builtin tools to enable (read/bash/edit/write/grep/find/ls). Empty/absent = host tools only. */
  builtinTools?: string[]
  /**
   * 一整个回合(整条 ReAct)的墙钟上限(per-session)。省略 → 环境变量 → 默认 600s。
   * 钻探的探索回合是几十页的一次遍历,600s 不够(它真正的边界是 exploreSession 自己的 120min
   * 预算 + 无进展检测)。抬高见 CoworkAgent。
   */
  turnTimeoutMs?: number
  /**
   * 运行时适配器。**必填,没有默认值。**
   *
   * 曾经默认 `new CoworkRuntimeAdapter()`,那让 SDK 反向依赖宿主:那个路由器会 eager
   * `new` 出宿主的运行时 → `electron-xpc/main` → `electron`。更要紧的是,给它一个
   * 「pi 兜底」的默认值会让非 pi 的目标**静默走错路由** —— 宁可编译期报错。
   */
  runtime: AgentRuntimeAdapter
  /**
   * 把 provider/model id 翻成人话,供「## Which model you are」那一段用。**必填,刻意不给默认值。**
   *
   * 不给默认的理由就写在 `targetBlock()` 上面:一个空的或错的后端身份块,曾让用户对着一条
   * 指名了根本没在用的 provider 的额度提示白等六天。静默降级 = 把那次事故装回去。
   * 宿主传自己的 `describeLlmTarget`。
   */
  describeTarget: (providerId: string, modelId: string) => { providerLabel: string; modelLabel: string; supplier: string }
  /** Lazily supplies this instance's tools (called when a session starts). */
  buildTools: () => PiToolSpec[]
  /** Debug-log scope label for this instance (e.g. 'agent' chat vs 'summarize' generation). */
  scope?: CodexDebugEvent['scope']
  /** Streamed assistant text deltas (for the chat UI). */
  onStream?: (delta: string) => void
  /** Live low-priority activity shown above the assistant message. */
  onActivity?: (step: AgentActivityStep) => void
  /** Live provider thinking state; not persisted as message activity. */
  onThinking?: (state: Omit<AgentThinkingState, 'sessionId'>) => void
  /**
   * 每轮模型往返的用量。`delta` 是这一轮的,`total` 是**本回合到目前为止的累计**。
   * 钻探的 token 预算靠它(见 runtime/usageLedger.ts)——所以是逐轮回调,不是回合结束才给一次:
   * 一个钻探回合能跑两小时,等结束再报用量,预算就永远来不及触发。
   */
  onUsage?: (delta: AgentRuntimeUsage, total: AgentRuntimeUsage) => void
  onDebug?: (event: CodexDebugEvent) => void
}

// LLM provider/model are env-switchable. Subscription OAuth tokens are created by the in-app
// browser login — AuthStorage.login — into the coach's userData auth store, NOT the `pi` CLI.
const DEFAULT_PROVIDER = 'openai-codex'
// Claude 退役(Ral 2026-09-11),所以这里只剩 codex 一条。
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  'openai-codex': 'gpt-6-astra'
}
const DEFAULT_SESSION_START_TIMEOUT_MS = 45_000
// pi's own builtin tools, all on (Ral 2026-07-27: 全开,后续按需删减). pi registers all seven but
// only activates read/bash/edit/write by default, so grep/find/ls MUST be named explicitly.
// The adapter merges this list with every host tool name — pi's allowlist filters builtin AND
// custom tools alike, so a builtin-only list would silently disable the host tools.
export const DEFAULT_PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sessionStartTimeoutMs = (): number => {
  const raw = Number(process.env.COACH_PI_SESSION_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_START_TIMEOUT_MS
}

// Per-tool-call wall clock. A single tool that hangs (a stuck read/parse, a runaway
// scan, a wedged page action) would otherwise freeze the whole turn with no error;
// this makes it surface as a tool error the agent can react to. Override via env.
const toolTimeoutMs = (): number => {
  const raw = Number(process.env.COACH_TOOL_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000
}

/**
 * Runs a provider-neutral agent runtime in-process (no CLI, no exec) and lets the
 * selected adapter run its ReAct/tool loop. The coach's recorded skills are the
 * agent's ONLY tools — provider built-in read/bash/edit/write surfaces are disabled.
 */
export class BaseAgent {
  private sessionPromise: Promise<AgentRuntimeSession> | null = null
  private readonly runtime: AgentRuntimeAdapter
  private busy = false
  // Runtime overrides set by the UI provider switch; take precedence over env/opts.
  private providerOverride?: string
  private modelOverride?: string
  private effortOverride?: LlmEffort

  constructor(protected readonly opts: BaseAgentOptions) {
    this.runtime = opts.runtime
  }

  /**
   * The agent's system prompt (markdown). Subclasses OVERRIDE this with a template literal to
   * give the agent its role + instructions; returning '' omits this product layer. Both reusable
   * and one-shot sessions receive the complete host system prompt (base + product) separately
   * from user messages. Runtime adapters preserve it across turns and compaction.
   */
  protected systemPrompt(): string {
    return ''
  }

  /**
   * 当前后端的事实块。**每个会话都要重新拼** —— 换 provider 会 `setTarget()` → `reset()`,
   * 下一轮重新 prime,所以这里读的永远是活的目标。
   *
   * 为什么必须存在:提示词里不写,agent 判断自己是谁就只能靠对话历史里的旧痕迹。实测从 Codex
   * 换到 Micromeet 的 Qwen 之后,它把 Qwen 侧的用量限制转述成「你的 OpenAI Codex 额度到上限了」,
   * 还建议人去登录一个根本没在用的账号 —— 文案通顺、有时间戳,人不会怀疑,只会白等六天
   * (agent-unaware-of-current-model-provider.md)。最后那句「不要参考更早对话里的 provider」
   * 是关键:误判的来源就是历史,不点名它就挡不住。
   */
  private targetBlock(): string {
    const providerId = this.resolveProvider()
    const modelId = this.resolveModel(providerId)
    const described = this.opts.describeTarget(providerId, modelId)
    return [
      '## Which model you are',
      '',
      `You are running on **${described.providerLabel} · ${described.modelLabel}** — provider id \`${providerId}\`, model id \`${modelId}\`, ${described.supplier}.`,
      '',
      'Every question about quota, usage limits, rate limiting, login, or authentication for the model refers to THIS backend. The operator can switch backends mid-conversation, and the chat history keeps whatever was used before — so NEVER name a provider because it appears earlier in this conversation. If a host error message names a provider, repeat that one verbatim; otherwise use the one above.'
    ].join('\n')
  }

  /** systemPrompt() + 当前后端事实块。空提示词的 agent 不加(它本来就没有 preamble)。 */
  protected composeSystemPrompt(): string {
    const sys = this.systemPrompt().trim()
    return sys ? `${this.targetBlock()}\n\n${sys}` : sys
  }

  /**
   * **交给运行时的完整 system 提示词 = 表 1 + 表 2。**
   *
   * 表 1 = `BASE_SYSTEM_PROMPT`(`prompt/sysPrompt.ts`,进程级,所有 agent 共用);
   * 表 2 = 本子类的 `composeSystemPrompt()`(后端事实块 + `systemPrompt()` 的产品层)。
   * 分层见 `overmind:areas/agent-runtime/chat/prompt-structure.html` #2。
   *
   * 2026-09-11 起表 2 **进 system 槽位**,不再拼在第一条 user 消息上 —— 那种做法一次压缩
   * 就把产品人格冲掉了(`primed` 机制连同它那个坑一起删掉了)。
   */
  private fullSystemPrompt(): string {
    const product = this.composeSystemPrompt().trim()
    return product ? `${BASE_SYSTEM_PROMPT}\n\n${product}` : BASE_SYSTEM_PROMPT
  }

  /**
   * The composed system prompt this agent injects — read from the LIVE instance, so the
   * Workbench Prompt tab and `/view_context` can never drift from what actually runs.
   * **返回的是完整那份(表 1 + 表 2)**,即运行时真正收到的字符串。
   */
  composedSystemPrompt(): string {
    return this.fullSystemPrompt()
  }

  /** Switch the LLM backend live. Drops the session so the next turn rebuilds it. */
  setTarget(providerId?: string, modelId?: string, effort?: LlmEffort): void {
    this.providerOverride = providerId?.trim() || undefined
    this.modelOverride = modelId?.trim() || undefined
    this.effortOverride = effort || undefined
    this.reset()
  }

  private resolveProvider(): string {
    return this.providerOverride || process.env.COACH_PI_PROVIDER || this.opts.providerId || DEFAULT_PROVIDER
  }

  private resolveModel(providerId: string): string {
    return (
      this.modelOverride ||
      process.env.COACH_PI_MODEL ||
      this.opts.modelId ||
      DEFAULT_MODEL_BY_PROVIDER[providerId] ||
      'gpt-6-astra'
    )
  }

  private resolveEffort(): LlmEffort {
    return this.effortOverride || this.opts.effort || 'low'
  }

  private resolveThinkingLevel(): AgentRuntimeThinkingLevel {
    const effort = this.resolveEffort()
    // `max` passes THROUGH (pi ≥ 0.80.6 has it as a real level). Whether the active model accepts
    // it is decided upstream by the preset's effort list — normalizeLlmTarget degrades `max` to
    // `xhigh` for models that stop there, so a downgrade here would make the top effort of
    // gpt-5.6-*/gpt-6-* unreachable.
    if (effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max') return effort
    return 'low'
  }

  /** Resolve the active target + whether it has a usable credential (no OAuth refresh). */
  async checkTarget(): Promise<{ providerId: string; modelId: string; effort: LlmEffort; ready: boolean }> {
    const providerId = this.resolveProvider()
    const modelId = this.resolveModel(providerId)
    const effort = this.resolveEffort()
    try {
      const authPath = this.opts.authPath ?? join(homedir(), '.pi', 'agent', 'auth.json')
      const ready = await this.runtime.checkTarget({ providerId, modelId, authPath, modelsPath: this.opts.modelsPath })
      return { providerId, modelId, effort, ready }
    } catch {
      return { providerId, modelId, effort, ready: false }
    }
  }

  /**
   * Initialize this agent's session. IDEMPOTENT — an instance holds AT MOST ONE session, so a
   * second init() keeps the same one. Optional to call directly: prompt() inits lazily if you
   * skip it. Use reset() to drop the session; a later init()/prompt() starts a fresh one.
   * (oneShot() is separate — it runs a throwaway session and never touches this managed one.)
   */
  async init(): Promise<void> {
    await this.ensureSession()
  }

  /**
   * 这个 agent **已经存在**的运行时会话的上下文条目面 —— 上下文压缩的候选批与落点
   * (docs/features/cowork-context-compaction.md「候选批的来源」)。
   *
   * 三条刻意的性质:
   *
   * 1. **绝不建会话。** 用 `this.sessionPromise` 而不是 `ensureSession()`:开一个 pi 会话只为
   *    「看看有没有上下文可压」是本末倒置 —— 没有会话就等于模型侧没有上下文,压缩无事可做。
   * 2. **`busy` 为真时不交出去。** 写入(`appendCompaction` / `appendCustomMessage`)会推进 pi 的
   *    `leafId`,对着一个正在流式的回合做等于在它脚下换地板。压缩的两个调用点
   *    (`turn.service.ts:234` 发送前 / `:310` 回合结束后)都在回合之外,所以这道闸只会挡住误用。
   * 3. **拿不到就返回 null,不抛。** 运行时不实现这个面也是一个合法答案:
   *    调用方据此如实报「这条运行时没有可压的上下文」,而不是假装压了。
   */
  async existingContextSurface(): Promise<AgentRuntimeContextSurface | null> {
    if (this.busy) return null
    const live = this.sessionPromise
    if (!live) return null
    try {
      return (await live).context ?? null
    } catch {
      return null
    }
  }

  private async ensureSession(): Promise<AgentRuntimeSession> {
    if (!this.sessionPromise) this.sessionPromise = this.startSession()
    return this.sessionPromise
  }

  private async startSession(): Promise<AgentRuntimeSession> {
    return await this.createSession(true)
  }

  private async createSession(withTools: boolean): Promise<AgentRuntimeSession> {
    const authPath = this.opts.authPath ?? join(homedir(), '.pi', 'agent', 'auth.json')
    const providerId = this.resolveProvider()
    const modelId = this.resolveModel(providerId)
    const specs = withTools ? this.opts.buildTools().map((spec) => this.withToolTimeout(spec)) : []
    return await this.runtime.createSession({
      target: { providerId, modelId, thinkingLevel: this.resolveThinkingLevel() },
      authPath,
      modelsPath: this.opts.modelsPath,
      tools: specs,
      scope: this.scope(),
      onDebug: this.opts.onDebug,
      // App-specific paths stay OUT of BaseAgent: cowork passes agentDir=<userData>/.pi and
      // cwd=<userData>/skills at construction. (「必须 electron-free」这句在 2026-09-08 之前是**假的** ——
      // 默认的 CoworkRuntimeAdapter 和 modelIoLog 都能摸到 electron,check-agent-runtime.mjs:95
      // 正是为此打了 electron 桩。runtime/describeTarget 改必填 + modelIoLog 落点注入之后才成真。)
      agentDir: this.opts.agentDir,
      cwd: this.opts.cwd,
      // Builtins only make sense alongside host tools (a tool-less session is a pure LLM call).
      builtinTools: withTools ? (this.opts.builtinTools ?? DEFAULT_PI_BUILTIN_TOOLS) : undefined,
      /**
       * **接管 pi 的 system 槽位**(`prompt/sysPrompt.ts`,契约
       * `docs/features/maestro-system-prompt-layers.md`)。传了它,pi 就不再生成原厂那段
       * A1–A5 —— 我们逐字照搬 A1–A4、删掉 A5 那 1408 字符的 pi 文档索引。
       *
       * **无工具会话也传**(`withTools === false`,`oneShot()` 那条路)。这里有一处已知的
       * 不精确:那种会话里 A2 的工具表列的是它并没有激活的内置工具。仍然传,因为
       * 不传的代价更大 —— 不传就退回 pi 原厂,连 A5 一起拿回来。
       */
      systemPrompt: this.fullSystemPrompt()
    })
  }

  // Wrap a tool so a hang surfaces as a tool error instead of freezing the turn silently.
  // NOTE: this only rescues tools that yield (async I/O); a tool that blocks the main thread
  // synchronously must be fixed at the source (e.g. async fs in search) — the timer can't fire
  // while the event loop is blocked.
  private withToolTimeout(spec: PiToolSpec): PiToolSpec {
    // A tool may declare its own budget. The env override still wins when explicitly set, so an
    // operator can clamp everything; otherwise a long-by-nature tool keeps its declared wall clock
    // instead of being cut off at 120 s while its work carries on unseen.
    const envOverride = Number(process.env.COACH_TOOL_TIMEOUT_MS)
    const ms = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : spec.timeoutMs || toolTimeoutMs()
    const hint = spec.timeoutHint || 'it may be reading a very large file or scanning a huge directory. Try a narrower path or a specific file.'
    return {
      ...spec,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        try {
          return await withTimeout(
            Promise.resolve(spec.execute(args)),
            ms,
            `tool "${spec.name}" timed out after ${Math.round(ms / 1000)}s — ${hint}`
          )
        } catch (err) {
          if (isTimeoutError(err)) return `ERROR: ${err instanceof Error ? err.message : String(err)}`
          throw err
        }
      }
    }
  }

  // Wraps the ENTIRE ReAct turn (every page_snapshot + ui_act round-trip + tool time),
  // not a single model call — multi-step UI automation through a proxy can need several
  // minutes. Override via COACH_PI_TURN_TIMEOUT_MS.
  async prompt(
    message: string,
    // per-session 覆盖优先(钻探探索回合要几十页,600s 不够),否则环境变量,否则默认 600s。
    timeoutMs = this.opts.turnTimeoutMs ?? (Number(process.env.COACH_PI_TURN_TIMEOUT_MS) || 600_000),
    options?: BaseAgentPromptOptions
  ): Promise<AgentTurnReply> {
    if (this.busy) return { ok: false, text: '', error: 'agent is already handling a message' }
    this.busy = true
    const startedAt = Date.now()
    try {
      if (options?.freshSession) this.reset()
      inputBudget.turnStart()
      // 提示词原文落盘。这是"喂给模型的内容"里我们自己拼的那一半(系统提示 + 本轮指令),
      // 它不在录制里、也不在任何别的地方 —— 不记就永远看不到。
      modelIoLog.append({
        kind: 'prompt',
        name: this.opts.scope || 'agent',
        subject: `chars=${message.length}`,
        text: message,
        turn: inputBudget.turnIndexNow
      })
      let session: AgentRuntimeSession
      try {
        session = await withTimeout(
          this.ensureSession(),
          sessionStartTimeoutMs(),
          `agent runtime session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
        )
      } catch (err) {
        // A failed session start (e.g. missing pi login) must not poison future
        // attempts — drop the rejected promise so the next prompt retries.
        this.sessionPromise = null
        throw err
      }
      const turn = await this.runPrompt(session, { text: message, media: options?.media, images: options?.images }, timeoutMs)
      // 上下文归因(Ral 2026-08-20:「我得知道是什么太大导致的,然后才能让 agent 制定拆分的方案」)。
      // **每回合都记**,不是只在出错时记 —— 撑爆上下文是累积的结果,只在爆掉那一刻看一眼,
      // 看到的是终局而不是过程,而拆分方案要的是过程(哪个工具在涨、涨得多快)。
      // 上下文超限时抬到 warn:那一条要能在日志里一眼找到。
      const overflow = /context_length_exceeded|context window|maximum context/i.test(turn.errorMessage || '')
      this.debug('turn-input-budget', overflow ? 'warn' : 'info', inputBudget.line(), {
        ...inputBudget.report(),
        // 把 jsonl 的位置一起打出来:出事时"去哪看原文"必须是日志里现成的一行,
        // 而不是让人去猜 userData 在哪。
        modelIoDir: modelIoLog.sessionDir
      })
      modelIoLog.append({
        kind: 'turn_end',
        name: overflow ? 'context_length_exceeded' : turn.errorMessage ? 'error' : 'ok',
        subject: inputBudget.line(),
        text: turn.errorMessage || '',
        turn: inputBudget.turnIndexNow,
        detail: inputBudget.report()
      })
      this.debug(turn.errorMessage ? 'agent-turn-error' : 'agent-turn-complete', turn.errorMessage ? 'warn' : 'info', 'agent runtime turn completed.', {
        durationMs: Date.now() - startedAt,
        outputChars: turn.text.length,
        streamedChars: turn.streamedChars,
        finalChars: turn.finalChars,
        toolCalls: turn.toolCalls,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      })
      return {
        ok: true,
        text: turn.text,
        toolCalls: turn.toolCalls,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // After a timeout the in-flight turn's state is unknown — start fresh.
      if (isTimeoutError(err)) this.reset()
      this.debug('agent-error', 'error', 'agent runtime prompt failed.', { error, durationMs: Date.now() - startedAt })
      return { ok: false, text: '', error }
    } finally {
      this.busy = false
    }
  }

  /**
   * 回合活跃时的**第二条消息**入口(steer-003 · `docs/features/cowork-turn-steering.md`「三道闸」)。
   *
   * `prompt()` 的第一行是 `if (this.busy) return … 'agent is already handling a message'`,于是
   * 回合活跃时的第二条 prompt **根本到不了** `PiRuntimeSession.prompt()` —— steer-001 写好的投递
   * 策略永远不会被触发。这个入口就是那道闸的绕行:**不吃 `busy` 锁,但打到同一个活会话**。
   *
   * 和 `scopedRun()` 的分别:后者也不吃锁,但它 `createSession(true)` 开的是一次性 throwaway 会话,
   * 用完即弃 —— 形状不对。steering 的消息必须落在**当前**这个会话上,否则模型根本看不到它。
   *
   * 三条硬约束(steer-003「要点」):
   *
   * 1. **不新起一份回合记账。** 这条消息是**当前**回合的一部分(契约「一个活跃回合」不变),
   *    所以这里刻意**不经过 `runPrompt()`**:那条路上有回合计时、`inputBudget.turnStart()`、
   *    `modelIoLog` 的 prompt/turn_end 两条,以及把 usage 账本归零的那次 `onUsage` 基线回调。
   *    走一遍等于给同一个回合记第二份账 —— 钻探的 token 预算取的正是那个基线,会当场失真。
   * 2. **不吃 `busy` 锁,也不清它。** 置位/清位仍然只由 `prompt()` 的 `finally` 与 `abort()` 负责。
   *    这里若顺手清一下,真正在跑的那个回合就失去了互斥保护,下一条普通消息会撞进它。
   * 3. **`busy` 为假时不走这条路。** 那时没有活跃回合,返回 `idle` 让调用方回到 `prompt()`。
   *
   * 文本**逐字**交给会话:不加系统前缀(系统提示词在建会话时就进 system 槽位了)、不套回合模板 —— 压缩契约要求
   * steering 消息原样进「② 用户原话链」。投递方式(steer / followUp)由适配器里的策略决定
   * (`steering/steeringPolicy.ts`),这里不判断,也不给调用方任何选择的口子。
   *
   * ## 4. **投递之前**必须确认会话真的在流式(steer-003 review F1)
   *
   * 「`busy` 已置位但 pi 还没进入流式」**不是几毫秒**:首个回合的 `await ensureSession()` 是整个
   * pi 会话创建,上界 `DEFAULT_SESSION_START_TIMEOUT_MS = 45_000`;之后 pi 自己还有 skill 展开 /
   * 模型校验 / `_checkCompaction`(可能先跑一整轮压缩)才到 `isStreaming = true`。用户「发完立刻
   * 补一句」正落在这段里。
   *
   * 而在那个窗口里投出去,后果不是「等一会儿」,是**角色反转 + 孤儿 run**:
   *
   * 1. pi 只在 `isStreaming` 为真时走入队分支(`agent-session.js:737`),非流式就走完整路径 ——
   *    **steering 这条变成了这个回合的 prompt**,抢走 `activeRun`。
   * 2. 真正的第一条随后到达时 `isStreaming` 已为真 → 它被当成 steer **入队,立刻 resolve**。
   * 3. 于是外层 `runPrompt` 的 `await session.prompt()` 瞬间返回 → `finally` 拆掉订阅、
   *    `prompt()` 的 `finally` 清掉 `busy`。
   *
   * ⇒ pi 那次 run 还在跑却**没有任何订阅者**:文字不外播(UI 静默)、`usage` 事件不累加
   * (`usageLedger` 少记一整轮,压缩触发线读到偏低的上下文)、`busy` 已清(互斥失效)。
   *
   * 所以非流式时**不投**,直接报 `failed` —— 此刻什么都还没排进去,说「没投出去」是诚实的。
   *
   * **不要把它改成投递超时。** 超时会给一条其实已经排进队的消息编一个不存在的结局;判定放在
   * 交出去**之前**就没有这个问题。会话投递本身照旧不设超时:pi 在流式中只是入队,立刻返回。
   */
  async steerActiveTurn(message: string): Promise<BaseAgentSteerResult> {
    if (!this.busy) return { outcome: 'idle' }
    const live = this.sessionPromise
    // `busy` 为真但会话已被撤掉 —— 会话启动失败时 `prompt()` 先把 sessionPromise 清成 null,
    // 隔几行才在 finally 里清 busy。这几毫秒里既没有活会话可投,也不该退回 prompt() 去撞那道闸。
    if (!live) return { outcome: 'failed', error: 'no live runtime session to steer' }
    try {
      const session = await withTimeout(
        live,
        sessionStartTimeoutMs(),
        `agent runtime session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
      )
      // ⚠ 顺序是判据的一部分:这一句必须排在 `session.prompt()` **之前**(理由见上面第 4 条)。
      if (session.isStreaming !== true) {
        this.debug('agent-steer-not-streaming', 'warn', 'active turn has not started streaming — steering message was NOT queued.', { chars: message.length })
        return { outcome: 'failed', error: STEER_NOT_STREAMING }
      }
      await session.prompt({ text: message })
      this.debug('agent-steer', 'info', 'steering message handed to the live turn.', { chars: message.length })
      return { outcome: 'delivered' }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // 失败也**不 reset()、不清 busy** —— 那个回合还在跑,动它等于把人正看着的输出掐掉,
      // 而这里失败的只是"多发的这一条"。
      this.debug('agent-steer-error', 'warn', 'steering message was not delivered.', { error })
      return { outcome: 'failed', error }
    }
  }

  /**
   * One-shot prompt on a FRESH throwaway session — no tools, no carried context.
   * For structured generation calls (skill drafts/refines) that must not bleed
   * state between invocations. Independent of the conversational session.
   */
  async oneShot(prompt: string, timeoutMs = 120_000): Promise<AgentTurnReply> {
    const startedAt = Date.now()
    let session: AgentRuntimeSession | null = null
    try {
      session = await withTimeout(
        this.createSession(false),
        sessionStartTimeoutMs(),
        `agent runtime one-shot session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
      )
      const turn = await this.runPrompt(session, { text: prompt }, timeoutMs)
      this.debug(turn.errorMessage ? 'agent-oneshot-error' : 'agent-oneshot-complete', turn.errorMessage ? 'warn' : 'info', 'agent runtime one-shot completed.', {
        durationMs: Date.now() - startedAt,
        outputChars: turn.text.length,
        finalChars: turn.finalChars,
        stopReason: turn.stopReason,
        errorMessage: turn.errorMessage || undefined
      })
      return { ok: true, text: turn.text, errorMessage: turn.errorMessage || undefined }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (session && isTimeoutError(err)) {
        await Promise.race([session.abort(), sleep(1500)]).catch(() => undefined)
      }
      this.debug('agent-oneshot-error', 'error', 'agent runtime one-shot failed.', { error, durationMs: Date.now() - startedAt })
      return { ok: false, text: '', error }
    }
  }

  /**
   * Tool-enabled ReAct run on a FRESH throwaway session — the full agent loop (page_snapshot +
   * ui_act + browser_exec + api_exec + run_request_script …) scoped to ONE goal, WITHOUT touching
   * the conversational session. This is the workflow engine's "AI node":
   * an `llm_reason` step, a maturity-dial `llm`-mode step, or a deterministic step's self-heal —
   * the agent observes+acts on the live page in an isolated thread that never pollutes the
   * operator's chat context. Does NOT take the `busy` lock (may run nested in an outer turn / a
   * workflow run). The throwaway session is disposed after so its output is never reused as context.
   */
  async scopedRun(goal: string, timeoutMs = Number(process.env.COACH_PI_TURN_TIMEOUT_MS) || 600_000): Promise<AgentTurnReply> {
    const startedAt = Date.now()
    let session: AgentRuntimeSession | null = null
    try {
      session = await withTimeout(
        this.createSession(true),
        sessionStartTimeoutMs(),
        `agent runtime scoped session start timed out after ${Math.round(sessionStartTimeoutMs() / 1000)}s`
      )
      // 不再手工拼前缀:这个一次性会话在 createSession 时就带上了表 1 + 表 2。
      const turn = await this.runPrompt(session, { text: goal }, timeoutMs)
      this.debug(
        turn.errorMessage ? 'agent-scoped-error' : 'agent-scoped-complete',
        turn.errorMessage ? 'warn' : 'info',
        'agent runtime scoped run completed.',
        { durationMs: Date.now() - startedAt, outputChars: turn.text.length, toolCalls: turn.toolCalls, stopReason: turn.stopReason, errorMessage: turn.errorMessage || undefined }
      )
      return { ok: true, text: turn.text, toolCalls: turn.toolCalls, stopReason: turn.stopReason, errorMessage: turn.errorMessage || undefined }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.debug('agent-scoped-error', 'error', 'agent runtime scoped run failed.', { error, durationMs: Date.now() - startedAt })
      return { ok: false, text: '', error }
    } finally {
      if (session) await Promise.race([session.abort(), sleep(1500)]).catch(() => undefined)
    }
  }

  /** Drop the current conversation; the next prompt starts a fresh session. */
  reset(): void {
    const existing = this.sessionPromise
    this.sessionPromise = null
    // 会话没了,累计数也要归零 —— 不清的话下一个会话的"累计"里混着上一个的,
    // 而那个数字是用来判断"该不该压缩/拆分"的,串味等于判据失效。
    inputBudget.reset()
    // 同时开一份新的 io 目录:一份 jsonl 对应一个会话,查的时候不用在一堆行里分辨"这是哪一轮的"。
    void modelIoLog.openSession(this.opts.scope || 'agent')
    if (existing) void existing.then((session) => session.abort()).catch(() => undefined)
  }

  /**
   * Stop the in-flight turn (if any): tell the live runtime session to abort and go idle, which
   * resolves the pending prompt() so the turn ends with whatever partial output it has. Then drop
   * the session so aborted output is never reused as later model context. No-op when idle.
   */
  async abort(): Promise<void> {
    if (!this.busy || !this.sessionPromise) return
    try {
      const session = await Promise.race([this.sessionPromise, sleep(500).then(() => null)])
      if (session) await Promise.race([session.abort(), sleep(1500)])
    } catch {
      /* best effort — the turn may already be resolving */
    } finally {
      this.reset()
      this.busy = false
    }
  }


  private async runPrompt(session: AgentRuntimeSession, message: AgentRuntimePrompt, timeoutMs: number): Promise<PiTurnResult> {
    let streamed = ''
    let finalText = ''
    let stopReason = ''
    let errorMessage = ''
    let toolCalls = 0
    // 上下文曲线用(见下面 'usage' 分支):轮次 + 峰值上下文。压缩成功后峰值重置成压后的值。
    let rounds = 0
    let peakContext = 0
    let thinkingActive = false
    // 逐轮累加,**不是取最后一条** —— 一个 ReAct 回合里每轮工具循环都结束一条 assistant message,
    // 各带自己的 usage。钻探能循环上百轮(COWORK_CHAT_MAX_TOOL_ROUNDS=200),取最后一条会把
    // 用量少算两个数量级,token 预算就形同虚设。
    const usage: AgentRuntimeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
    const addUsage = (delta?: AgentRuntimeUsage): void => {
      if (!delta) return
      usage.input += delta.input
      usage.output += delta.output
      usage.cacheRead += delta.cacheRead
      usage.cacheWrite += delta.cacheWrite
      usage.totalTokens += delta.totalTokens
      usage.costUsd += delta.costUsd
      this.opts.onUsage?.(delta, usage)
    }
    // 回合一开始就把账本清零。不清的话账本里留着【上一回合】的余额,而钻探是在回合中途开的 ——
    // 它取基线时会拿到上一回合的总数,之后做差恒为负、被 clamp 成 0,token 预算就永远不触发。
    this.opts.onUsage?.({ ...usage }, { ...usage })
    const toolStartedAt = new Map<string, number[]>()
    const setThinking = (active: boolean): void => {
      if (thinkingActive === active) return
      thinkingActive = active
      this.opts.onThinking?.({ active, ts: Date.now() })
    }
    // 压缩期间运行时会把【摘要】当成 assistant 文字流出来 —— 实测一整段「对话上下文详细摘要 /
    // 任务概述 / 执行流程 …」几千字,直接落进了聊天气泡。它是内部产物:给人看是噪声,回灌进提示词
    // 又白占上下文(压缩的目的正好相反)。所以压缩窗口内的文字**既不外播也不计入本轮产出**,
    // 只在日志里记它有多长,免得"摘要没生成"和"摘要被吞了"分不开。
    let compacting = false
    let compactedChars = 0
    const unsubscribe = session.subscribe((event: AgentRuntimeEvent) => {
      const type = event?.type
      if (type === 'text_delta') {
        if (compacting) {
          compactedChars += event.delta.length
          return
        }
        setThinking(false)
        streamed += event.delta
        this.opts.onStream?.(event.delta)
      } else if (type === 'thinking_start') {
        setThinking(true)
      } else if (type === 'thinking_delta') {
        setThinking(true)
      } else if (type === 'thinking_end') {
        setThinking(false)
      } else if (type === 'assistant_done') {
        if (event.text) finalText = event.text
        if (event.stopReason) stopReason = event.stopReason
        if (event.errorMessage) errorMessage = event.errorMessage
      } else if (type === 'assistant_message_end') {
        // The terminal assistant message — the most reliable source of the final
        // text AND of provider errors (e.g. a 403), which some providers report
        // late with no provider-specific done/error event. Role-guarding happens in
        // the runtime adapter so BaseAgent only sees assistant terminals.
        if (event.text) finalText = event.text
        if (event.stopReason) stopReason = event.stopReason
        if (event.errorMessage) errorMessage = event.errorMessage
      } else if (type === 'usage') {
        // 每次模型往返一条,逐轮累加(见上面 addUsage 的说明)。
        addUsage(event.usage)
        // 上下文曲线:每轮把"这一轮往返带了多少上下文"打出来。钻探是单个上百轮的回合,
        // 累计 input 是主导项,只看总量看不出它是平的还是在涨 —— 涨说明压缩没起作用。
        rounds += 1
        const ctx = (event.usage.input || 0) + (event.usage.cacheRead || 0)
        if (ctx > peakContext) peakContext = ctx
        this.debug('context-round', 'info', `round ${rounds}: context ${Math.round(ctx / 1000)}k (in ${Math.round((event.usage.input || 0) / 1000)}k + cacheRead ${Math.round((event.usage.cacheRead || 0) / 1000)}k) · out ${event.usage.output || 0} · peak ${Math.round(peakContext / 1000)}k`, { round: rounds, contextTokens: ctx, input: event.usage.input, cacheRead: event.usage.cacheRead, output: event.usage.output })
      } else if (type === 'compaction_start') {
        // 压缩开始/结束必须留痕:这是回合内唯一会让上下文变小的事件,看不见它就无法判断
        // "上下文一直在涨"是压缩没触发,还是触发了但压不动。
        compacting = true
        compactedChars = 0
        this.debug('compaction-start', 'info', `pi auto-compaction started (${event.reason || 'threshold'}) at round ${rounds}, peak context ${Math.round(peakContext / 1000)}k`, { reason: event.reason, round: rounds, peakContextTokens: peakContext })
      } else if (type === 'compaction_end') {
        const shrink = event.beforeTokens && event.afterTokens ? ` ${Math.round(event.beforeTokens / 1000)}k → ${Math.round(event.afterTokens / 1000)}k` : ''
        this.debug('compaction-end', event.ok === false ? 'warn' : 'info', `pi auto-compaction ${event.ok === false ? 'FAILED' : 'done'} (${event.reason || 'threshold'})${shrink}`, { reason: event.reason, ok: event.ok, beforeTokens: event.beforeTokens, afterTokens: event.afterTokens })
        compacting = false
        if (compactedChars) this.debug('compaction-summary-withheld', 'info', `held back ${compactedChars} chars of compaction summary — internal product, not a reply`, { chars: compactedChars })
        if (event.ok !== false) peakContext = event.afterTokens || 0
      } else if (type === 'tool_start') {
        toolCalls += 1
        const toolName = event.toolName || 'tool'
        const starts = toolStartedAt.get(toolName) || []
        starts.push(Date.now())
        toolStartedAt.set(toolName, starts)
        const activity = activityForTool(event.toolName, event.args)
        this.activity(activity.phase, activity.label)
        this.debug('agent-tool', 'info', `tool → ${toolName}`, { args: clip(event.args) })
      } else if (type === 'tool_end') {
        const toolName = event.toolName || 'tool'
        const starts = toolStartedAt.get(toolName)
        const started = starts?.shift()
        const detail = started ? { durationMs: Date.now() - started } : undefined
        if (starts && starts.length === 0) toolStartedAt.delete(toolName)
        if (event.isError) {
          // 失败行同样带上目标 —— 「read 失败」和「read ~/Downloads/a.pdf 失败」差着能不能定位。
          const failed = activityForTool(event.toolName, event.args)
          this.activity(failed.phase, `${failed.label} failed`, false)
        }
        this.debug('agent-tool-end', event.isError ? 'warn' : 'info', `tool ${toolName} ${event.isError ? 'errored' : 'ok'}`, detail)
      }
    })
    try {
      await withTimeout(session.prompt(message), timeoutMs, `pi agent turn timed out after ${Math.round(timeoutMs / 1000)}s`)
    } catch (err) {
      if (isTimeoutError(err)) {
        await Promise.race([session.abort(), sleep(1500)]).catch(() => undefined)
      }
      throw err
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe()
      setThinking(false)
    }
    const text = streamed.trim() || finalText.trim()
    return { text, streamedChars: streamed.length, finalChars: finalText.length, toolCalls, stopReason, errorMessage, usage }
  }

  private scope(): CodexDebugEvent['scope'] {
    return this.opts.scope ?? 'agent'
  }

  private debug(phase: string, level: CodexDebugEvent['level'], message: string, detail?: unknown): void {
    this.opts.onDebug?.({ scope: this.scope(), phase, level, message, detail, ts: Date.now() })
  }

  private activity(phase: AgentActivityStep['phase'], label: string, ok = true): void {
    const compact = compactActivityLabel(label)
    if (!compact) return
    this.opts.onActivity?.({ phase, label: compact, ok, ts: Date.now() })
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

interface PiTurnResult {
  text: string
  streamedChars: number
  finalChars: number
  toolCalls: number
  stopReason: string
  errorMessage: string
  usage: AgentRuntimeUsage
}

const clip = (value: unknown, max = 300): string => {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

const compactActivityLabel = (value: string, max = 180): string => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

/**
 * 参数里那个"这次到底作用在什么上"的键,按优先级排。
 *
 * Ral 2026-08-31:「调用工具的时候,用户无法理解含义 …… 这里应该显示工具使用的描述才对」——
 * 三行 `tool read` 对人是零信息:同一个工具连读三个文件,活动行长得一模一样。工具名只说了"用了哪把
 * 工具",而人要看的是"读了哪个文件"。
 */
const ACTIVITY_ARG_KEYS = [
  // 有 pattern / query 的工具(grep / find / search_files)里,人要看的是"搜什么",不是"在哪搜" ——
  // 所以它们排在 path 前面。只有 path 的(read / ls)自然落到 path。
  'pattern',
  'query',
  'command',
  'path',
  'file_path',
  'url',
  'archive',
  'inputs',
  'filename',
  'skill_id',
  'skill_name',
  'task_id',
  'ref',
  'action',
  'name'
]

/**
 * 反过来,**永远不许**进活动行的键:凭据,和整份 payload。
 *
 * 活动行是给人看的一行字,不是日志:把 `content` / `html` 塞进去等于把刚写的文件正文糊在聊天里,
 * 把 `password` 塞进去等于把密码显示在屏幕上(归档工具真的收这个参数)。
 */
const ACTIVITY_ARG_DENY = /password|passphrase|token|secret|credential|authorization|cookie|api[_-]?key|content|artifact_json|html|markdown|body|old_?text|new_?text/i

const activityArgValue = (raw: string): string => {
  const text = raw.replace(/\s+/g, ' ').trim()
  const home = homedir()
  const short = home && text.startsWith(home) ? `~${text.slice(home.length)}` : text
  return short.length > 80 ? `${short.slice(0, 80)}…` : short
}

const activityArgSummary = (args: unknown): string => {
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  for (const key of ACTIVITY_ARG_KEYS) {
    const value = rec[key]
    if (typeof value === 'string' && value.trim()) return activityArgValue(value)
  }
  // 未登记的键也给一次机会 —— 新工具不必先改这张表就能有描述。长值直接放弃:那不是"作用在什么上",
  // 而是 payload,截断了也读不出意思。
  for (const [key, value] of Object.entries(rec)) {
    if (ACTIVITY_ARG_DENY.test(key)) continue
    if (typeof value === 'string' && value.trim() && value.length <= 120) return activityArgValue(value)
  }
  return ''
}

const activityForTool = (toolName?: string, args?: unknown): { phase: AgentActivityStep['phase']; label: string } => {
  if (!toolName) return { phase: 'tool', label: 'tool' }
  if (toolName === 'browser_exec') return browserExecActivity(args)
  if (toolName === 'api_exec') return apiExecActivity(args)
  // Show the raw tool name under its tag (e.g. "tool" + "page_snapshot" → tool:page_snapshot),
  // NOT a remapped semantic verb ("see"/"do") or a "call …" prefix — the record is the tool called.
  // 工具名后面接它这次作用的目标(`read ~/Downloads/a.pdf`),没有可说的目标时退回纯工具名。
  const summary = activityArgSummary(args)
  return { phase: activityPhaseForTool(toolName), label: summary ? `${toolName} ${summary}` : toolName }
}

const activityPhaseForTool = (toolName: string): AgentActivityStep['phase'] => {
  if (toolName === 'get_skill_contract' || toolName === 'get_skill_detail' || toolName === 'run_skill_script' || toolName === 'replay_skill_ui' || toolName === 'delete_skill') {
    return 'skill'
  }
  return 'tool'
}

const apiExecActivity = (args: unknown): { phase: AgentActivityStep['phase']; label: string } => {
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  let req: Record<string, unknown> = {}
  try {
    const parsed = typeof rec.request_json === 'string' ? JSON.parse(rec.request_json) : rec.request_json
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) req = parsed as Record<string, unknown>
  } catch {
    req = {}
  }
  const method = String(req.method || (req.body != null ? 'POST' : 'GET')).toUpperCase()
  const phase: AgentActivityStep['phase'] = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'api-read' : 'api-call'
  return { phase, label: `curl ${method} ${activityEndpoint(String(req.url || ''))}` }
}

const browserExecActivity = (args: unknown): { phase: AgentActivityStep['phase']; label: string } => {
  const commands = parseBrowserExecCommands(args)
  const fetches = commands.filter((cmd) => cmd.command === 'fetch')
  if (!commands.length) return { phase: 'tool', label: 'call browser_exec' }
  if (!fetches.length) return { phase: 'tool', label: 'read browser context' }
  const first = fetches[0]
  const method = (first.method || 'GET').toUpperCase()
  const phase: AgentActivityStep['phase'] = ['GET', 'HEAD', 'OPTIONS'].includes(method) && fetches.every((cmd) => ['GET', 'HEAD', 'OPTIONS'].includes((cmd.method || 'GET').toUpperCase()))
    ? 'api-read'
    : 'api-call'
  const more = fetches.length > 1 ? ` +${fetches.length - 1}` : ''
  return { phase, label: `${method} ${activityEndpoint(first.url || '')}${more}` }
}

const parseBrowserExecCommands = (args: unknown): { command: string; method?: string; url?: string }[] => {
  const rec = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const raw = rec.commands_json
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const readOne = (item: unknown): { command: string; method?: string; url?: string }[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      const command = String(record.command || '')
      if (command === 'parallel' && Array.isArray(record.commands)) return record.commands.flatMap(readOne)
      return [
        {
          command,
          method: typeof record.method === 'string' ? record.method : undefined,
          url: typeof record.url === 'string' ? record.url : undefined
        }
      ]
    }
    return list.flatMap(readOne).filter((item) => item.command)
  } catch {
    return []
  }
}

const activityEndpoint = (url: string): string => {
  try {
    const parsed = new URL(url, 'https://cowork.local')
    const keys = Array.from(parsed.searchParams.keys())
    const query = keys.map((key) => `${encodeURIComponent(key)}=<${activityVarName(key) || 'value'}>`).join('&')
    return `${sanitizeActivityPath(parsed.pathname)}${query ? `?${query}` : ''}`
  } catch {
    return url || '/api'
  }
}

const sanitizeActivityPath = (path: string): string => {
  return path
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (/^[0-9]{5,}$/.test(decoded) || /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) || /^[A-Za-z0-9_-]{16,}$/.test(decoded)) return ':id'
      return segment
    })
    .join('/')
}

const activityVarName = (label: string): string => {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const isTimeoutError = (err: unknown): boolean => err instanceof TimeoutError || /timed out/i.test(err instanceof Error ? err.message : String(err))

const withTimeout = <T>(promise: Promise<T>, ms: number, message = `operation timed out after ${Math.round(ms / 1000)}s`): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
