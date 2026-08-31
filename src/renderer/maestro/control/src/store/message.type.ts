import type { AgentActivityStep, ReplayResult, SkillSummary } from '@maestro-shared/coach.api'
import type { MaestroChatConfirm, MaestroChatDetail, MaestroChatSessionSummary } from '@maestro-shared/maestroChat.api'
import type { MaestroTaskPart } from '@maestro-shared/task.api'

export type MessageSource = 'cowork' | 'connector'
export type MessageRole = 'human' | 'ai'
export type MessageIntent = 'chat'

export interface ChatAttachment {
  name: string
  // Absolute path of the picked/dropped file (from webUtils via the preload bridge).
  // Sent to main as a path on send — never the bytes.
  path: string
  isDirectory?: boolean
}

export interface ChatFile {
  name: string
  // Absolute path; rendered as an @path reference in the prompt and read by read_file.
  path?: string
  kind?: 'attachment' | 'artifact'
  action?: 'created' | 'updated'
  size?: number
  isDirectory?: boolean
}

export interface ChatMessage {
  id: string
  source: MessageSource
  role: MessageRole
  type?: 'text' | 'files' | 'compact' | 'task' | 'confirm'
  content: string
  files?: ChatFile[]
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  streaming: boolean
  thinking?: boolean
  error?: boolean
  activity?: AgentActivityStep[]
  tasks?: MaestroTaskPart[]
  confirm?: MaestroChatConfirm
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

export type TurnPhase = 'accepted' | 'thinking' | 'streaming'
export type TurnEndReason = 'completed' | 'stopped' | 'idle-timeout' | 'turn-timeout'

export interface Turn {
  id: string
  /** Stable root request for this Turn. Steering messages never replace this retry anchor. */
  rootText: string
  rootHumanMessageId?: string
  phase: TurnPhase
  assistantMessageId?: string
  activity: AgentActivityStep[]
  thinking: boolean
  startedAt: number
  lastActivityAt: number
  aborting: boolean
  retry?: { attempt: number; max: number }
  steering?: {
    count: number
    pending: boolean
  }
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
  turn?: Turn
  retryable?: { attempt: number; max: number; rootText: string; rootHumanMessageId: string }
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type MessageSessionSummary = MaestroChatSessionSummary
