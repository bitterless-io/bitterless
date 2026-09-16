import { countTokens } from 'gpt-tokenizer'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

/** Called at each model request boundary; the returned message is ephemeral, never rewrites history. */
export const appendCurrentSkillCatalog = (params: {
  messages: AgentMessage[]
  catalog: string
  contextWindow: number
  maxTokens: number
  systemPrompt: string
}): AgentMessage[] => {
  const window = params.contextWindow || 262144
  const needed = countTokens(params.catalog) + countTokens(JSON.stringify(params.messages)) + countTokens(params.systemPrompt) + Math.min(params.maxTokens || 8192, 8192)
  if (needed > window) throw new Error('The complete Skills catalog exceeds this model context budget. Choose a larger model or reduce the source catalog; no skills were silently omitted.')
  return [...params.messages, { role: 'user', content: params.catalog, timestamp: Date.now() }]
}
