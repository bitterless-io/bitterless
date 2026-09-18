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

/** 时间线上的错误卡。`detail` 是全文,只在弹窗里显示。 */
export interface ChatErrorCard {
  title: string
  subtitle?: string
  detail: string
}

export interface ChatMessage {
  id: string
  source: MessageSource
  role: MessageRole
  type?: 'text' | 'files' | 'compact' | 'task' | 'confirm' | 'error'
  /**
   * `type: 'error'` 那张卡的内容(Ral 2026-09-10)。
   *
   * 为什么要**结构化**而不是把错误塞进 `content`:一条 `An object could not be cloned.`
   * 混在正常气泡里就是一行红字,人看不出"这是哪一步失败的、要不要看全文"。
   * 卡片给出三样:一行标题(是什么坏了)、一行副标题(在哪一步)、以及全文按需展开 ——
   * 全文往往是几十行栈,直接铺在时间线上会把上下文顶掉。
   */
  errorCard?: ChatErrorCard
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
  /** Renderer-only notice; exclude it from every session save. */
  localOnly?: boolean
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
  /** Main-process generation claimed for this exact Turn; live broadcasts must match it. */
  generation: number
  /** Stable root request for this Turn. Steering messages never replace this retry anchor. */
  rootText: string
  rootHumanMessageId?: string
  /** The root came from the host (a settled workflow), not from the user typing. */
  hostAuthored?: boolean
  phase: TurnPhase
  assistantMessageId?: string
  /** Most recently sealed segment, used for metadata-only final replies without duplicating text. */
  lastAssistantMessageId?: string
  sealedAssistantSegments: number
  hasStreamedText: boolean
  /** False after renderer reconstruction: persisted/live deltas may cover only part of Main's reply. */
  streamCoverageComplete: boolean
  activity: AgentActivityStep[]
  thinking: boolean
  startedAt: number
  lastActivityAt: number
  aborting: boolean
  stopError?: string
  retry?: { attempt: number; max: number }
  steering?: {
    count: number
    pending: boolean
    pendingCount?: number
  }
}

export interface MessageSession {
  compactionRetry?: import('@shared/piCompaction.types').CompactionRetry & { startedAt: number }
  compacting?: boolean
  id: string
  source: MessageSource
  operationTabId: string
  title: string
  intent: MessageIntent
  placeholder: string
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

/**
 * 会话列表的一行(docs/features/maestro-session-list-unread.md #1)。
 * 三种状态互斥地决定排序:`unread` → `running` → 已读。
 */
export interface SessionListItem {
  id: string
  title: string
  preview: string
  updatedAt: number
  /** 这个会话此刻有回合在跑 —— 列表里转圈(灰的:在跑是「还没到你」)。 */
  running: boolean
  /** 有你没看过的结论 —— 蓝点,排最上。 */
  unread: boolean
  /**
   * 这个会话里有**还没回答的 confirm** —— 黄点。
   *
   * 和蓝点不是一回事:蓝点是「有新结论要看」,黄点是**挡住流程**,那一轮在等人点允许/拒绝。
   * 判据与确认卡、状态条同源(未被回答的 `type: 'confirm'` 消息),所以答完三处一起消失。
   */
  awaitingConfirm: boolean
}
