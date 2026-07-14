import type { AgentActivityStep, ReplayResult, SkillSummary, WorkspaceRef } from './coach.api'

export type CoworkChatRole = 'human' | 'ai'
export type CoworkChatSource = 'cowork'
export type CoworkChatMessageType = 'text' | 'files' | 'compact'

export interface CoworkChatFile {
  name: string
  path?: string
  kind?: 'attachment' | 'artifact'
  action?: 'created' | 'updated'
  size?: number
}

export interface CoworkChatMessage {
  id: string
  source: CoworkChatSource
  role: CoworkChatRole
  type?: CoworkChatMessageType
  content: string
  files?: CoworkChatFile[]
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  streaming: boolean
  error?: boolean
  activity?: AgentActivityStep[]
  compressed?: boolean
  promptExcluded?: boolean
  compactSummary?: string
  compactUntilMessageId?: string
  tokenCount?: number
  ts: number
}

export interface CoworkChatDetail {
  compressedContext: string
  compressedUntilMessageId?: string
  compressedAt?: number
  workspace?: WorkspaceRef
}

export interface CoworkChatSession {
  id: string
  operationTabId: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  detail: CoworkChatDetail
  messages: CoworkChatMessage[]
}

export interface CoworkChatSessionSummary {
  id: string
  operationTabId: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  messageCount: number
  preview: string
}

export interface CoworkChatApi {
  listSessions(params?: { operationTabId?: string }): Promise<CoworkChatSessionSummary[]>
  getSession(params: { id: string }): Promise<CoworkChatSession | null>
  saveSession(params: { session: CoworkChatSession }): Promise<{ ok: boolean }>
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>
}
