import type { LlmEffort, LlmEffortOption, LlmLoginMethod, LlmLoginProviderOption, LlmTarget } from '@maestro-shared/coach.api'

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

// LLM backends. AI-CRMS auth is the embedded app session; Codex/Claude use coding-agent
// subscription OAuth in maestroAuthPath().
export const DEFAULT_COMPRESSION_REMAINING_PERCENT = 10

const DEFAULT_EFFORT: LlmEffortOption[] = [{ id: 'default', label: 'Default' }]
const CODEX_EFFORTS: LlmEffortOption[] = [
  { id: 'low', label: 'low' },
  { id: 'medium', label: 'medium' },
  { id: 'high', label: 'high' },
  { id: 'xhigh', label: 'extra high' }
]
const CLAUDE_EFFORTS: LlmEffortOption[] = [
  { id: 'low', label: 'low' },
  { id: 'medium', label: 'medium' },
  { id: 'high', label: 'high' },
  { id: 'xhigh', label: 'extra high' }
]

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    provider: 'ai-crms',
    label: 'Micromeet',
    authLabel: 'AI-CRMS session'
  },
  {
    provider: 'openai-codex',
    label: 'Codex',
    authLabel: 'Coding agent subscription'
  },
  // Claude provider option is intentionally hidden in Maestro for now. Keep the runtime,
  // preset, and login plumbing below so it can be re-enabled by uncommenting this block.
  // {
  //   provider: 'anthropic',
  //   label: 'Claude',
  //   authLabel: 'Coding agent subscription'
  // }
]

export const LLM_PRESETS: LlmTarget[] = [
  {
    provider: 'ai-crms',
    providerLabel: 'Micromeet',
    model: 'qwen3.7-plus',
    label: 'Qwen 3.7 Plus',
    shortLabel: 'Qwen 3.7 Plus',
    effort: 'default',
    efforts: DEFAULT_EFFORT.slice(),
    contextLengthK: 256,
    contextLengthLabel: '256K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'AI-CRMS session'
  },
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-5.5',
    label: 'GPT-5.5',
    shortLabel: '5.5',
    effort: 'low',
    efforts: CODEX_EFFORTS.slice(),
    contextLengthK: 256,
    contextLengthLabel: '256K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'openai-codex',
    providerLabel: 'Codex',
    model: 'gpt-5.4',
    label: 'GPT-5.4',
    shortLabel: '5.4',
    effort: 'low',
    efforts: CODEX_EFFORTS.slice(),
    contextLengthK: 256,
    contextLengthLabel: '256K',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    shortLabel: 'Opus 4.8',
    effort: 'low',
    efforts: CLAUDE_EFFORTS.slice(),
    contextLengthK: 1024,
    contextLengthLabel: '1M',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    shortLabel: 'Sonnet 4.6',
    effort: 'low',
    efforts: CLAUDE_EFFORTS.slice(),
    contextLengthK: 1024,
    contextLengthLabel: '1M',
    compressionRemainingPercent: DEFAULT_COMPRESSION_REMAINING_PERCENT,
    authLabel: 'Coding agent subscription'
  }
]

export const DEFAULT_PRESET_MODEL: Record<string, string> = {
  'ai-crms': 'qwen3.7-plus',
  'openai-codex': 'gpt-5.5',
  anthropic: 'claude-opus-4-8'
}

export const LLM_LOGIN_PROVIDERS: LlmLoginProviderOption[] = [
  {
    provider: 'ai-crms',
    label: 'Micromeet',
    methods: [{ id: 'browser', label: 'Browser Login' }]
  },
  {
    provider: 'openai-codex',
    label: 'Codex',
    methods: [
      { id: 'browser', label: 'Browser Login' },
      { id: 'device_code', label: 'Device code' }
    ]
  },
  {
    provider: 'anthropic',
    label: 'Claude',
    methods: [{ id: 'browser', label: 'Browser Login' }]
  }
]

export const normalizeLlmProvider = (providerId: string): string => {
  const id = providerId.trim().toLowerCase()
  if (id === 'claude' || id === 'cloud' || id === 'claude-code') return 'anthropic'
  if (id === 'ai-crms' || id === 'aicrms' || id === 'ai crms' || id === 'acms') return 'ai-crms'
  if (id === 'codex' || id === 'openai') return 'openai-codex'
  return id || 'openai-codex'
}

export const isLlmProviderSelectable = (providerId: string): boolean => {
  const provider = normalizeLlmProvider(providerId)
  return LLM_PROVIDERS.some((item) => item.provider === provider)
}

export const selectableLlmPresets = (presets: LlmTarget[] = LLM_PRESETS): LlmTarget[] =>
  presets.filter((preset) => isLlmProviderSelectable(preset.provider))

export const selectableLlmLoginProviders = (): LlmLoginProviderOption[] =>
  LLM_LOGIN_PROVIDERS.filter((provider) => isLlmProviderSelectable(provider.provider))

export const firstPresetForProvider = (provider: string): LlmTarget | undefined => LLM_PRESETS.find((item) => item.provider === provider)

export const modelPresetKey = (provider: string, model: string): string => `${provider}/${model}`

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
  const requestedModel = (value.model || DEFAULT_PRESET_MODEL[provider] || fallback.model).trim()
  const preset = presets.find((item) => item.model === requestedModel) || fallback
  const requestedEffort = value.effort === 'max' && preset.efforts.some((item) => item.id === 'xhigh') ? 'xhigh' : value.effort
  const defaultEffort = preset.efforts[0]?.id || preset.effort
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

export const resolveLoginMethod = (providerId: string, method?: string): LlmLoginMethod => {
  const provider = LLM_LOGIN_PROVIDERS.find((item) => item.provider === providerId)
  if (!provider) throw new Error(`Unknown LLM provider: ${providerId}`)
  const requested = method === 'device_code' ? 'device_code' : 'browser'
  return provider.methods.some((item) => item.id === requested) ? requested : provider.methods[0]?.id || 'browser'
}

export const providerLabel = (providerId: string): string => {
  if (providerId === 'ai-crms') return 'Micromeet'
  if (providerId.startsWith('openai')) return 'OpenAI Codex (ChatGPT)'
  if (providerId === 'anthropic') return 'Claude'
  return providerId
}
