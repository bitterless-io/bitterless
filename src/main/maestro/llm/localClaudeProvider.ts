import {
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_MODELS,
  CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
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
  thinkingLevelMap: Record<string, string>
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
  'claude-sonnet': 'Claude Sonnet 5',
  'claude-opus': 'Claude Opus 5',
}

/** The port is owner-configurable, so the URL is built per call, never frozen. */
export const localClaudeBaseUrl = (port: number = CLAUDE_SUBSCRIPTION_DEFAULT_PORT): string =>
  `http://${CLAUDE_SUBSCRIPTION_HOST}:${port}/v1`

export const buildLocalClaudePiProviderConfig = (
  compressionPrefs: LlmCompressionPrefs,
  port: number = CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
): LocalClaudePiProviderConfig => ({
  baseUrl: localClaudeBaseUrl(port),
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
      // pi's `getSupportedThinkingLevels` admits `xhigh` and `max` only when the model
      // names them here. Without this the local provider's own effort dropdown stopped
      // at `high`, silently — pi excluded the top two rungs rather than reporting them.
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max', minimal: 'low' },
      input: ['text'],
      // 200_000, the CLI's own `_er` baseline — not 200 * 1024, which overstated it by
      // 4800 tokens. The 1M beta is gated to claude-sonnet-4-6 and never applies here.
      contextWindow: 200_000,
      compressionRemainingPercent:
        compressionPrefs[modelPresetKey(LOCAL_LLM_PROVIDER, id)] ??
        DEFAULT_COMPRESSION_REMAINING_PERCENT,
      maxTokens: 32 * 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
  }),
})
