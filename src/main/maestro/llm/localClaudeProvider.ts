import {
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_MODELS,
  CLAUDE_SUBSCRIPTION_PORT,
} from '@shared/claudeSubscription/claudeSubscription.contract'
import type { LlmCompressionPrefs } from './llmModels'
import {
  DEFAULT_COMPRESSION_REMAINING_PERCENT,
  LOCAL_LLM_PROVIDER,
  modelPresetKey,
} from './llmModels'

interface LocalClaudePiModel {
  id: string
  name: string
  reasoning: true
  input: Array<'text'>
  contextWindow: number
  compressionRemainingPercent: number
  maxTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export interface LocalClaudePiProviderConfig {
  baseUrl: string
  api: 'openai-responses'
  apiKey: 'local'
  authHeader: false
  models: LocalClaudePiModel[]
}

const LOCAL_MODEL_NAMES: Record<keyof typeof CLAUDE_SUBSCRIPTION_MODELS, string> = {
  'claude-sonnet': 'Claude Sonnet',
  'claude-opus': 'Claude Opus',
  'claude-haiku': 'Claude Haiku',
}

export const LOCAL_CLAUDE_BASE_URL =
  `http://${CLAUDE_SUBSCRIPTION_HOST}:${CLAUDE_SUBSCRIPTION_PORT}/v1` as const

export const buildLocalClaudePiProviderConfig = (
  compressionPrefs: LlmCompressionPrefs,
): LocalClaudePiProviderConfig => ({
  baseUrl: LOCAL_CLAUDE_BASE_URL,
  api: 'openai-responses',
  // Pi requires configured auth before it will construct a custom-provider session. The local
  // server ignores credentials; authHeader:false prevents this sentinel from being transmitted.
  apiKey: 'local',
  authHeader: false,
  models: Object.keys(CLAUDE_SUBSCRIPTION_MODELS).map((model) => {
    const id = model as keyof typeof CLAUDE_SUBSCRIPTION_MODELS
    return {
      id,
      name: LOCAL_MODEL_NAMES[id],
      reasoning: true,
      input: ['text'],
      contextWindow: 200 * 1024,
      compressionRemainingPercent:
        compressionPrefs[modelPresetKey(LOCAL_LLM_PROVIDER, id)] ??
        DEFAULT_COMPRESSION_REMAINING_PERCENT,
      maxTokens: 32 * 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
  }),
})
