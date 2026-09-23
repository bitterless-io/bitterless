import type { LlmEffort, LlmEffortOption, LlmLoginMethod, LlmLoginProviderOption, LlmTarget } from '@maestro-shared/coach.api'
import { defaultLlmEffort } from '@maestro-shared/coach.api'

export interface LlmStoredTarget {
  provider: string
  model: string
  effort: LlmEffort
}

export type LlmCompressionPrefs = Record<string, number>

export interface LlmProviderDefinition {
  provider: string
  label: string
  authLabel: string
  hint?: string
}

// LLM backends. Codex uses coding-agent subscription OAuth in maestroAuthPath().
/**
 * 触发压缩时要留的余量,占窗口的百分比 —— **同时**是我们自己那条触发线和 pi 自带
 * auto-compaction 的 `reserveTokens` 来源(`piCompactionSettings.service.ts` 负责后者)。
 *
 * Ral 2026-09-11:「reserved token 数是 20%」。此前是 10 —— 在 272,000 窗口上等于烧到 244,800
 * 才动手,一个大 tool 结果就能在两次检查之间把窗口冲爆。20% ⇒ 触发线 217,600,正是他先给的
 * 那组固定值里的「超过 220k 就触发压缩」。
 */
export const DEFAULT_COMPRESSION_REMAINING_PERCENT = 20

/**
 * **`max` 这一档由预设放行**(`agentRuntime.types.ts` 的 `AgentRuntimeThinkingLevel` 注释:
 * 「`max` 位于 `xhigh` 之上,只有目录条目声明它的模型才接受 —— 预设的 effort 列表就是那道闸」)。
 *
 * 2026-09-11 实测 pi 目录(`getSupportedThinkingLevels`):`gpt-6-astra` 与 `gpt-5.6-*` 三个
 * **都支持 max**。此前 bl 一律只给到 `xhigh`,等于把这些模型
 * 最高一档算力关在外面。
 */
const CODEX_EFFORTS: LlmEffortOption[] = [
  { id: 'max', label: 'Max' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'high', label: 'high' },
  { id: 'medium', label: 'medium' },
  { id: 'low', label: 'low' }
]
const CODEX_SOL_EFFORTS: LlmEffortOption[] = CODEX_EFFORTS.filter((item) => item.id !== 'low')

/** Qwen 只有一档算力,给 picker 一个单元素列表而不是 Codex 那五档。 */
const DEFAULT_EFFORTS: LlmEffortOption[] = [{ id: 'default', label: 'Default' }]

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    provider: 'openai-codex',
    label: 'Codex',
    authLabel: 'Coding agent subscription'
  },
  /**
   * Bitterless 自家的 relay(上海 FC `bl-relay-sh`,`POST /v1/bailian/chat/completions`)。
   *
   * 与 Codex 的关键差别:**它不走 pi 的 OAuth**,凭据是用户在本应用里登录 Bitterless 拿到的
   * Core 会话 token(`customerSessionService`)。所以它**不进 `LLM_LOGIN_PROVIDERS`** ——
   * 那张表驱动的是 pi 的浏览器/设备码登录流程,给它挂一个按钮只会把人送进一条不存在的流程。
   * 没登录时由 `registerBitterlessProvider()` 抛出指明"去登录 Bitterless"的错误。
   *
   * 对照 micromeet-cowork 的 `ai-crms` provider:形状相同(relay + 会话 token + Qwen),
   * 区别只在后端是谁家的 relay,以及登录入口是宿主应用自己的。
   */
  {
    provider: 'bitterless',
    label: 'Bitterless',
    authLabel: 'Bitterless account'
  },
  // Claude 退役(Ral 2026-09-11:「bl cowork 都不用 claude 的了」)。此前它是"隐藏但保留 preset
  // 以便随时开回来";现在连 preset 一起删了,所以重新启用需要重写那几条,不是取消注释就行。
  // `normalizeLlmProvider` 里 claude → anthropic 的别名归一化**留着** —— 旧会话存过那个 target,
  // 删掉会让它们解析失败而不是优雅退回默认。
]

/**
 * 可选模型(Ral 2026-09-14 定):由上到下 Astra、Sol、Terra、Luna,退役的 Mini 不再可选。
 *
 * **`contextLengthK` / `contextLengthLabel` 只是兜底** —— 运行时由
 * `applyResolvedContextWindows()` 用 pi 目录里的真值覆盖。写 266 是因为实测这 4 个模型
 * 在 pi 里都是 `contextWindow = 272000`(≈266K);此前手写的 372K / 256K / 1M **全部是错的**,
 * 而压缩的触发线、reserve 预算、summary 上限都乘在这个数上 —— 372K 那三个模型的触发线
 * 曾落在真实窗口的 136%,也就是**永远不触发直到溢出**。
 */
export const LLM_PRESETS: LlmTarget[] = [
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    shortLabel: '6 Astra',
    // Ral 2026-09-11:「默认模型统一到 gpt-6-astra medium effort」(cowork 2026-09-07 已是此值)。
    // **不是 `efforts[0]`** —— 列表按降序给 picker 用,默认档可以落在中间,读它必须走 `defaultLlmEffort()`。
    effort: 'medium',
    efforts: CODEX_EFFORTS.slice(),
    contextLengthK: 266,
    contextLengthLabel: '266K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    shortLabel: '5.6 Sol',
    effort: 'medium',
    efforts: CODEX_SOL_EFFORTS.slice(),
    contextLengthK: 266,
    contextLengthLabel: '266K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    shortLabel: '5.6 Terra',
    effort: 'low',
    efforts: CODEX_EFFORTS.slice(),
    contextLengthK: 266,
    contextLengthLabel: '266K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    shortLabel: '5.6 Luna',
    effort: 'low',
    efforts: CODEX_EFFORTS.slice(),
    contextLengthK: 266,
    contextLengthLabel: '266K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  /**
   * Bitterless relay 的 Qwen。**排在 Codex 之后是刻意的** —— `normalizeLlmTarget()` 的最后一层
   * 兜底是 `LLM_PRESETS[0]`,把它们排到最前面会把"存量/异常 target 落到哪"从 Astra 悄悄改成
   * Qwen Max,而这次没人要求改默认模型。
   *
   * Ral 2026-09-23 指定先只开这两个;relay 端 `BAILIAN_ALLOWED_MODELS` 是真正的闸门,
   * 这里多写一个模型也不会被放行。
   */
  {
    provider: 'bitterless',
    providerLabel: 'Bitterless',
    model: 'qwen3.8-max',
    label: 'Qwen 3.8 Max',
    shortLabel: '3.8 Max',
    effort: 'default',
    efforts: DEFAULT_EFFORTS.slice(),
    contextLengthK: 256,
    contextLengthLabel: '256K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Bitterless account'
  },
  {
    provider: 'bitterless',
    providerLabel: 'Bitterless',
    model: 'qwen3.8-flash',
    label: 'Qwen 3.8 Flash',
    shortLabel: '3.8 Flash',
    effort: 'default',
    efforts: DEFAULT_EFFORTS.slice(),
    contextLengthK: 256,
    contextLengthLabel: '256K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Bitterless account'
  }
]

export const DEFAULT_PRESET_MODEL: Record<string, string> = {
  // 与 `BaseAgent.DEFAULT_MODEL_BY_PROVIDER` 保持一致 —— 两处此前分别指向 luna 与 astra,
  // 同一个"默认"指向两个模型(Ral 2026-09-11 定:统一到 astra)。
  'openai-codex': 'gpt-6-astra',
  bitterless: 'qwen3.8-max'
}

export const LLM_LOGIN_PROVIDERS: LlmLoginProviderOption[] = [
  {
    provider: 'openai-codex',
    label: 'Codex',
    methods: [
      { id: 'browser', label: 'Browser Login' },
      { id: 'device_code', label: 'Device code' }
    ]
  }
]

export const normalizeLlmProvider = (providerId: string): string => {
  const id = providerId.trim().toLowerCase()
  if (id === 'claude' || id === 'cloud' || id === 'claude-code') return 'anthropic'
  if (id === 'codex' || id === 'openai') return 'openai-codex'
  return id || 'openai-codex'
}

/** 仅归一化存量选择;新选择仍由 `requireSelectableLlmTarget` 按当前预设严格校验。 */
export const normalizeStoredLlmModel = (provider: string, model: string): string => {
  const id = model.trim()
  return provider === 'openai-codex' && id === 'gpt-5.4-mini' ? 'gpt-5.6-luna' : id
}

export const isLlmProviderSelectable = (providerId: string): boolean => {
  const provider = normalizeLlmProvider(providerId)
  return LLM_PROVIDERS.some((item) => item.provider === provider)
}

export const requireSelectableLlmProvider = (providerId: string): string => {
  const provider = normalizeLlmProvider(providerId)
  if (!isLlmProviderSelectable(provider)) throw new Error(`Unknown LLM provider: ${providerId}`)
  return provider
}

export const selectableLlmPresets = (presets: LlmTarget[] = LLM_PRESETS): LlmTarget[] =>
  presets.filter((preset) => isLlmProviderSelectable(preset.provider))

export const selectableLlmLoginProviders = (): LlmLoginProviderOption[] =>
  LLM_LOGIN_PROVIDERS.filter((provider) => isLlmProviderSelectable(provider.provider))

export const firstPresetForProvider = (provider: string): LlmTarget | undefined => LLM_PRESETS.find((item) => item.provider === provider)

export const modelPresetKey = (provider: string, model: string): string => `${provider}/${model}`

/**
 * pi 给不出窗口时的兜底(Ral 2026-09-11:「默认就是 256k,因为现在一般至少 256k 了」)。
 * **刻意不退回预设里那个手写值** —— 手写值正是这次要消除的失准来源。
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256 * 1024

/** token 数 → 给人看的标签:`262144 → '256K'`、`1048576 → '1M'`。 */
export const contextWindowLabel = (tokens: number): string => {
  const k = Math.round(tokens / 1024)
  return k >= 1024 && k % 1024 === 0 ? `${k / 1024}M` : `${k}K`
}

/**
 * 用 pi 解析出的**真实**窗口覆盖预设里配置的 `contextLengthK` / `contextLengthLabel`。
 *
 * 标签也一起派生,而不是保留配置里那个 —— 否则会出现「标签写 1M、数字算 256K」这种
 * 自相矛盾的显示。
 *
 * **pi 没给出值时退回这个预设自己配置的窗口,不是 `DEFAULT_CONTEXT_WINDOW_TOKENS`**
 * (Ral 2026-09-17:「你配置好就行」)。之前无条件退 256K,于是 `describeContextWindows` 每次
 * 超时(3s 上限)都把整批**降**到 256K —— 包括上面那 4 个 Codex 预设,它们配置的 266K 正是
 * 实测真值(pi 里 `contextWindow = 272000`,见 `LLM_PRESETS` 上方那段)。也就是说旧写法让一次
 * 3 秒抖动悄悄改掉压缩触发线、reserve 预算和 summary 上限,而配置里本来就是对的数。
 * `DEFAULT_CONTEXT_WINDOW_TOKENS` 只作为「预设自己也没有配」时的最后兜底。
 */
export const applyResolvedContextWindows = (
  presets: LlmTarget[],
  resolved: Record<string, number>
): LlmTarget[] =>
  presets.map((preset) => {
    const configured = preset.contextLengthK > 0 ? preset.contextLengthK * 1024 : 0
    const tokens =
      resolved[modelPresetKey(preset.provider, preset.model)] ||
      configured ||
      DEFAULT_CONTEXT_WINDOW_TOKENS
    return {
      ...preset,
      contextLengthK: Math.round(tokens / 1024),
      contextLengthLabel: contextWindowLabel(tokens)
    }
  })

export const normalizeCompressionRemainingPercent = (value: unknown): number => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_COMPRESSION_REMAINING_PERCENT
  return Math.max(1, Math.min(90, n))
}

export const parseStoredLlmCompressionPrefs = (options: unknown): LlmCompressionPrefs => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {}
  const out: LlmCompressionPrefs = {}
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    if (!key.includes('/')) continue
    out[key] = normalizeCompressionRemainingPercent(value)
  }
  return out
}

export const applyCompressionPrefs = (presets: LlmTarget[], prefs: LlmCompressionPrefs): LlmTarget[] =>
  presets.map((preset) => ({
    ...preset,
    compressionRemainingPercent: prefs[modelPresetKey(preset.provider, preset.model)] ?? preset.compressionRemainingPercent
  }))

export const parseStoredLlmTarget = (options: unknown): Partial<LlmStoredTarget> | null => {
  if (!options || typeof options !== 'object') return null
  const record = options as Record<string, unknown>
  return {
    provider: typeof record.provider === 'string' ? record.provider : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    effort: typeof record.effort === 'string' ? (record.effort as LlmEffort) : undefined
  }
}

export const normalizeLlmTarget = (value: { provider?: string; model?: string; effort?: LlmEffort | string }): LlmStoredTarget => {
  const provider = normalizeLlmProvider(value.provider || 'openai-codex')
  const presets = LLM_PRESETS.filter((item) => item.provider === provider)
  const fallback = presets[0] || LLM_PRESETS[0]
  const requestedModel = normalizeStoredLlmModel(provider, value.model || DEFAULT_PRESET_MODEL[provider] || fallback.model)
  const preset = presets.find((item) => item.model === requestedModel) || fallback
  const requestedEffort =
    value.effort === 'max' && !preset.efforts.some((item) => item.id === 'max') && preset.efforts.some((item) => item.id === 'xhigh')
      ? 'xhigh'
      : value.effort
  const defaultEffort = defaultLlmEffort(preset)
  const effort = preset.efforts.some((item) => item.id === requestedEffort) ? (requestedEffort as LlmEffort) : defaultEffort
  return {
    provider: preset.provider,
    model: preset.model,
    effort
  }
}

export const normalizeSelectableLlmTarget = (value: { provider?: string; model?: string; effort?: LlmEffort | string }): LlmStoredTarget => {
  const target = normalizeLlmTarget(value)
  return isLlmProviderSelectable(target.provider) ? target : normalizeLlmTarget({ provider: 'openai-codex' })
}

export const requireSelectableLlmTarget = (value: {
  provider?: string
  model?: string
  effort?: LlmEffort | string
}): LlmStoredTarget => {
  const provider = requireSelectableLlmProvider(value.provider || '')
  const model = String(value.model || '').trim()
  if (!LLM_PRESETS.some((preset) => preset.provider === provider && preset.model === model)) {
    throw new Error(`Unknown LLM model for ${provider}: ${model}`)
  }
  return normalizeLlmTarget({ provider, model, effort: value.effort })
}

export const resolveLoginMethod = (providerId: string, method?: string): LlmLoginMethod => {
  const provider = LLM_LOGIN_PROVIDERS.find((item) => item.provider === providerId)
  if (!provider) throw new Error(`Unknown LLM provider: ${providerId}`)
  const requested = method === 'device_code' ? 'device_code' : 'browser'
  return provider.methods.some((item) => item.id === requested) ? requested : provider.methods[0]?.id || 'browser'
}

/**
 * provider/model id → 人话,喂给 SDK BaseAgent 的 `describeTarget` 端口(「## Which model you are」那段)。
 *
 * 这个端口在 SDK 里**刻意没有默认值**:一个空的或错的后端身份块,曾让用户对着一条指名了根本
 * 没在用的 provider 的额度提示白等六天。宿主必须显式提供,编译期就挡住"忘了传"。
 */
export const describeLlmTarget = (
  providerId: string,
  modelId: string
): { providerLabel: string; modelLabel: string; supplier: string } => {
  const provider = normalizeLlmProvider(providerId)
  const preset = LLM_PRESETS.find((item) => item.provider === provider && item.model === modelId)
  return {
    providerLabel: preset?.providerLabel || providerLabel(provider),
    modelLabel: preset?.label || modelId,
    supplier:
      provider === 'bitterless'
        ? 'supplied by Bitterless through the signed-in Bitterless account (not a personal model subscription)'
        : provider === 'anthropic'
          ? "the user's own Claude subscription, signed in through the in-app browser login"
          : "the user's own ChatGPT/Codex subscription, signed in through the in-app browser login"
  }
}

export const providerLabel = (providerId: string): string => {
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT)'
  if (providerId === 'anthropic') return 'Claude'
  if (providerId === 'bitterless') return 'Bitterless'
  return providerId
}
