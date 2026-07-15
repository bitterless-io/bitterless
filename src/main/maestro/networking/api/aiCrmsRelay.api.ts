import type { AuthSession } from '@maestro-shared/session.api'
import { resolveAiCrmsRelayEndpoint } from '../clients/relay.client'

export interface AiCrmsPiProviderParams {
  session: AuthSession
  compressionRemainingPercent: number
}

export interface AiCrmsPiProviderConfig {
  baseUrl: string
  api: 'openai-completions'
  apiKey: string
  authHeader: true
  headers: Record<string, string>
  compat: {
    supportsStore: false
    supportsDeveloperRole: false
    supportsReasoningEffort: false
    supportsUsageInStreaming: true
    maxTokensField: 'max_tokens'
    thinkingFormat: 'qwen'
    supportsStrictMode: false
  }
  models: Array<{
    id: string
    name: string
    reasoning: false
    input: Array<'text' | 'image'>
    contextWindow: number
    compressionRemainingPercent: number
    maxTokens: number
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  }>
}

export const buildAiCrmsPiProviderConfig = ({ session, compressionRemainingPercent }: AiCrmsPiProviderParams): AiCrmsPiProviderConfig => {
  const endpoint = resolveAiCrmsRelayEndpoint(session)
  const headers: Record<string, string> = {
    'x-region': endpoint.region
  }
  if (session.tenant_id) headers['x-workspace-id'] = session.tenant_id
  return {
    baseUrl: endpoint.baseUrl,
    api: 'openai-completions',
    apiKey: session.jwt_token,
    authHeader: true,
    headers,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'qwen',
      supportsStrictMode: false
    },
    models: [
      {
        id: 'qwen3.7-plus',
        name: 'Qwen 3.7 Plus',
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 256 * 1024,
        compressionRemainingPercent,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ]
  }
}
