import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_COACH_START_URL, type CoachSettings } from '@maestro-shared/coach.api'

export const DEFAULT_START_URL = DEFAULT_COACH_START_URL

const DEFAULT_SETTINGS: CoachSettings = {
  startUrl: DEFAULT_START_URL,
  llmProvider: 'openai-codex',
  llmModel: 'gpt-5.6-luna',
  llmEffort: 'low'
}

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  'ai-crms': 'qwen3.7-plus',
  'openai-codex': 'gpt-5.6-luna',
  local: 'claude-sonnet'
}

const OPENAI_CODEX_MODELS = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'] as const
const LOCAL_CLAUDE_MODELS = ['claude-sonnet', 'claude-opus', 'claude-haiku'] as const

export class CoachSettingsService {
  private readonly file: string

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'coach-settings.json')
  }

  read(): CoachSettings {
    if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CoachSettings>
      return normalizeSettings(parsed)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(patch: Partial<CoachSettings>): CoachSettings {
    const next = normalizeSettings({ ...this.read(), ...patch })
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  hasCustomStartUrl(): boolean {
    return !isDefaultStartUrl(this.read().startUrl)
  }
}

function normalizeSettings(value: Partial<CoachSettings>): CoachSettings {
  const provider = normalizeLlmProvider(value.llmProvider || DEFAULT_SETTINGS.llmProvider)
  const fallbackModel = DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_SETTINGS.llmModel
  const rawModel = (value.llmModel || fallbackModel).trim()
  const llmModel = normalizeLlmModel(rawModel, fallbackModel)
  return {
    startUrl: normalizeStartUrl(value.startUrl),
    llmProvider: provider,
    llmModel,
    llmEffort: normalizeLlmEffort(value.llmEffort, llmModel)
  }
}

function normalizeStartUrl(url?: string): string {
  const normalized = normalizeUrl(url || '')
  return isDefaultStartUrl(normalized) ? DEFAULT_START_URL : normalized
}

export function isDefaultStartUrl(url?: string): boolean {
  const normalized = normalizeUrl(url || '')
  return !normalized || normalized === DEFAULT_START_URL
}

function normalizeLlmModel(model: string, fallbackModel: string): string {
  const trimmed = model.trim()
  if (OPENAI_CODEX_MODELS.some((item) => item === trimmed)) return trimmed
  if (LOCAL_CLAUDE_MODELS.some((item) => item === trimmed)) return trimmed
  if (OPENAI_CODEX_MODELS.some((item) => item === fallbackModel)) return fallbackModel
  if (LOCAL_CLAUDE_MODELS.some((item) => item === fallbackModel)) return fallbackModel
  if (model.trim().toLowerCase().startsWith('claude-')) return fallbackModel
  return trimmed || fallbackModel
}

function normalizeLlmProvider(provider: string): string {
  const trimmed = provider.trim().toLowerCase()
  if (trimmed === 'ai-crms' || trimmed === 'aicrms' || trimmed === 'ai crms' || trimmed === 'acms') return 'ai-crms'
  if (trimmed === 'openai-codex' || trimmed === 'codex' || trimmed === 'openai') return 'openai-codex'
  if (trimmed === 'local' || trimmed === 'bitterless' || trimmed === 'bitterless-local') return 'local'
  // Claude is still supported in the runtime, but the Maestro selector is hidden for now.
  if (trimmed === 'anthropic' || trimmed === 'claude' || trimmed === 'cloud' || trimmed === 'claude-code') return 'openai-codex'
  return DEFAULT_SETTINGS.llmProvider
}

function normalizeLlmEffort(effort: string | undefined, model: string): CoachSettings['llmEffort'] {
  const normalized = effort === 'default' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max' ? effort : 'low'
  if (model === 'gpt-5.6-sol' && normalized === 'low') return 'medium'
  return normalized
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  // Keep an explicit http/https as typed (so a pasted https URL stays https); otherwise
  // default to http:// — schemeless hosts load over http and follow any redirect to https.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}
