import type { AgentActivityStep, ReplayResult, SkillSummary, WorkspaceRef } from './coach.api'
import type { MaestroTaskConfirm, MaestroTaskPart } from './task.api'

export type MaestroChatRole = 'human' | 'ai'
// Persisted rows use the original source value; changing it requires a database migration.
export type MaestroChatSource = 'cowork'
export type MaestroChatMessageType = 'text' | 'files' | 'compact' | 'task' | 'confirm'

export interface MaestroChatConfirm {
  taskId: string
  confirmId: string
  title: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  answer?: 'confirm' | 'cancel' | 'elsewhere'
  payload?: MaestroTaskConfirm['payload']
}

export interface MaestroChatFile {
  name: string
  path?: string
  kind?: 'attachment' | 'artifact'
  action?: 'created' | 'updated'
  size?: number
  /** Directory attachment. Older persisted rows simply omit this optional field. */
  isDirectory?: boolean
}

export interface MaestroChatMessage {
  id: string
  source: MaestroChatSource
  role: MaestroChatRole
  type?: MaestroChatMessageType
  content: string
  files?: MaestroChatFile[]
  skill?: SkillSummary
  skills?: SkillSummary[]
  replay?: ReplayResult
  streaming: boolean
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

export interface MaestroChatDetail {
  compressedContext: string
  compressedUntilMessageId?: string
  compressedAt?: number
  workspace?: WorkspaceRef
}

export interface MaestroChatSession {
  id: string
  operationTabId: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  detail: MaestroChatDetail
  messages: MaestroChatMessage[]
}

export interface MaestroChatSessionSummary {
  id: string
  operationTabId: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  messageCount: number
  preview: string
}

export interface MaestroChatApi {
  listSessions(params?: { operationTabId?: string }): Promise<MaestroChatSessionSummary[]>
  getSession(params: { id: string }): Promise<MaestroChatSession | null>
  saveSession(params: { session: MaestroChatSession }): Promise<{ ok: boolean }>
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>
}
