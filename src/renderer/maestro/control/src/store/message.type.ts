import type { AgentActivityStep, ReplayResult, SkillSummary } from '@maestro-shared/coach.api'
import type { MaestroChatDetail, MaestroChatSessionSummary } from '@maestro-shared/maestroChat.api'

export type MessageSource = 'cowork' | 'connector'
export type MessageRole = 'human' | 'ai'
export type MessageIntent = 'chat'

export interface ChatAttachment {
  name: string
  // Absolute path of the picked/dropped file (from webUtils via the preload bridge).
  // Sent to main as a path on send — never the bytes.
  path: string
}

export interface ChatFile {
  name: string
  // Absolute path; rendered as an @path reference in the prompt and read by read_file.
  path?: string
  kind?: 'attachment' | 'artifact'
  action?: 'created' | 'updated'
  size?: number
}

export interface ChatMessage {
  id: string
  source: MessageSource
  role: MessageRole
  type?: 'text' | 'files' | 'compact'
  content: string
  files?: ChatFile[]
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  streaming: boolean
  thinking?: boolean
  error?: boolean
  activity?: AgentActivityStep[]
  compressed?: boolean
  promptExcluded?: boolean
  compactSummary?: string
  compactUntilMessageId?: string
  tokenCount?: number
  ts: number
}

export interface ChatContextUsage {
  usedTokens: number
  maxTokens: number
  ratio: number
  percent: number
  label: string
  compressionRemainingPercent: number
  compressionTriggerPercent: number
  compressionTriggered: boolean
}

export interface MessageSession {
  id: string
  source: MessageSource
  operationTabId: string
  title: string
  intent: MessageIntent
  placeholder: string
  welcome: string
  allowFiles: boolean
  messages: ChatMessage[]
  detail: MaestroChatDetail
  contextUsage: ChatContextUsage
  busy: boolean
  aborting: boolean
  activeTurnId?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type MessageSessionSummary = MaestroChatSessionSummary
