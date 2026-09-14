import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_COACH_START_URL, type CoachSettings, type LlmTarget } from '@maestro-shared/coach.api'
import { DEFAULT_PRESET_MODEL, LLM_PRESETS } from '@maestro-main/llm/llmModels'

export const DEFAULT_START_URL = DEFAULT_COACH_START_URL

const DEFAULT_SETTINGS: CoachSettings = {
  startUrl: DEFAULT_START_URL,
  llmProvider: 'openai-codex',
  // 与 `llmModels.DEFAULT_PRESET_MODEL` / `BaseAgent.DEFAULT_MODEL_BY_PROVIDER` 必须一致 ——
  // 三处此前有两个值(这里 luna,那两处 astra),表现是"新装的应用用 luna,归一化兜底用 astra",
  // 两边都不报错。`check-startup-settings.mjs` 钉住这个一致性。
  llmModel: 'gpt-6-astra',
  // 与 astra 预设声明的默认档一致(Ral 2026-09-11:「gpt-6-astra medium effort」)。
  llmEffort: 'medium'
}

/**
 * 默认模型与可选模型集**全部从预设派生**,这里不再自己列一份。
 *
 * 2026-09-11 之前这个文件手写了 `'openai-codex': 'gpt-5.6-luna'` 和一份四个模型的白名单,
 * 与 `llmModels.ts` 的预设各走各的。后果是两个**都不报错**的静默失配:
 *  · 默认模型有三处定义(这里 / `DEFAULT_PRESET_MODEL` / `BaseAgent.DEFAULT_MODEL_BY_PROVIDER`),
 *    退役 gpt-5.5、新增 gpt-6-astra 时只改了其中两处;
 *  · 白名单没跟上新增模型 ⇒ 存进来的 `gpt-6-astra` 会被 `normalizeLlmModel` **当成非法值丢掉**,
 *    静静回落到 luna —— 用户看到的是"选了模型但没生效"。
 *
 * 派生之后,新增/退役模型只需要动 `llmModels.ts` 一处。
 */
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = DEFAULT_PRESET_MODEL

const presetFor = (model: string): LlmTarget | undefined => LLM_PRESETS.find((preset) => preset.model === model)

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
  // 存量的退役 target(gpt-5.5、claude-*)在这里一并降级 —— 判据是"还是不是一个活着的预设",
  // 不再逐个点名,所以下次退役模型不用回来改这里。
  if (presetFor(trimmed)) return trimmed
  return presetFor(fallbackModel) ? fallbackModel : LLM_PRESETS[0]?.model || fallbackModel
}

function normalizeLlmProvider(provider: string): string {
  const trimmed = provider.trim().toLowerCase()
  if (trimmed === 'openai-codex' || trimmed === 'codex' || trimmed === 'openai') return 'openai-codex'
  // Claude is still supported in the runtime, but the Maestro selector is hidden for now.
  if (trimmed === 'anthropic' || trimmed === 'claude' || trimmed === 'cloud' || trimmed === 'claude-code') return 'openai-codex'
  return DEFAULT_SETTINGS.llmProvider
}

/**
 * effort 的合法集**按模型从预设取**,不再手写。
 *
 * 手写那版有两个死角:`gpt-5.6-sol` 不支持 `low` 要单独打补丁(那正是预设里
 * `CODEX_SOL_EFFORTS` 已经表达过的事),而 `gpt-5.4-mini` 不支持 `max` 却没人补 ——
 * 存一个 `max` 进去会原样留着,直到发消息时才被拒。
 */
function normalizeLlmEffort(effort: string | undefined, model: string): CoachSettings['llmEffort'] {
  const preset = presetFor(model)
  const supported = preset?.efforts || []
  if (supported.some((item) => item.id === effort)) return effort as CoachSettings['llmEffort']
  return (supported[0]?.id || preset?.effort || 'low') as CoachSettings['llmEffort']
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  // Keep an explicit http/https as typed (so a pasted https URL stays https); otherwise
  // default to http:// — schemeless hosts load over http and follow any redirect to https.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}
