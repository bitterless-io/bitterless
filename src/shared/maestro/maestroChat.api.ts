import type { AgentActivityStep, ReplayResult, SkillSummary, WorkspaceRef } from './coach.api'
import type { MaestroTaskConfirm, MaestroTaskPart } from './task.api'

export type MaestroChatRole = 'human' | 'ai'
// Persisted rows use the original source value; changing it requires a database migration.
export type MaestroChatSource = 'cowork'
export type MaestroChatMessageType = 'text' | 'files' | 'compact' | 'task' | 'confirm' | 'decision'

export interface MaestroChatConfirm {
  taskId: string
  confirmId: string
  title: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  /**
   * 这张卡怎么了结的。`expired` 是**重启后读回**的那种:没人回答过它,是主进程的任务注册表
   * 随进程消失了,所以这一问再也答不了。它和 `elsewhere` 必须分开 —— 后者是"有人替你答了/
   * 任务自己撤回了",把重启说成那个是在编造一件没发生的事
   * (docs/issues/confirm-card-survives-restart.md)。
   */
  answer?: 'confirm' | 'cancel' | 'elsewhere' | 'expired'
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
  /** 哪一种非普通条目(pi 的 `customType`)。判类的单一出口在渲染端 `store/messageClass.ts`。 */
  customType?: string
  compactSummary?: string
  compactUntilMessageId?: string
  tokenCount?: number
  ts: number
}

export interface MaestroChatDetail {
  compressedContext: string
  titleCustomized?: boolean
  /** Only new ordinary chats opt in; consumed by their first actual user message. */
  autoTitlePending?: boolean
  /** Monotonic across manual renames and their undo; protects against late generated titles. */
  titleRevision?: number
  /** Durable attempt marker. Reload never resumes or retries this request. */
  titleGeneration?: { requestId: string; firstMessageId: string; expectedRevision: number }
  draft?: { text: string; files: { name: string; path: string; isDirectory?: boolean }[]; skill?: { reference: string; name: string; layer: string; path: string } }
  compressedUntilMessageId?: string
  compressedAt?: number
  workspace?: WorkspaceRef
}

// Everything about a conversation except its messages. A save whose change was metadata carries
// only this, so it cannot cost anything proportional to the history
// (docs/issues/session-save-rewrites-the-whole-session.md).
export interface MaestroChatSessionMeta {
  id: string
  operationTabId: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  detail: MaestroChatDetail
}

export interface MaestroChatSession extends MaestroChatSessionMeta {
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
  // One session's summary through the same projection as `listSessions`, so a save can refresh the
  // row it touched without recounting every other conversation
  // (docs/issues/every-save-recounts-the-whole-history.md). `null` when the row is gone.
  getSessionSummary(params: { id: string }): Promise<MaestroChatSessionSummary | null>
  getSession(params: { id: string }): Promise<MaestroChatSession | null>
  // Metadata only — title, archive flag, workspace binding, plan. Touches no message row.
  saveSessionMeta(params: { session: MaestroChatSessionMeta }): Promise<{ ok: boolean }>
  // Upsert exactly these messages by id, plus the session row. `sortOrder` is the message's index
  // among the session's persisted messages; it is written on insert and kept on conflict.
  saveMessages(params: {
    session: MaestroChatSessionMeta
    messages: Array<MaestroChatMessage & { sortOrder: number }>
  }): Promise<{ ok: boolean }>
  // Full rewrite: creation, import and explicit repair only.
  saveSession(params: { session: MaestroChatSession }): Promise<{ ok: boolean }>
  deleteSession(params: { id: string; onlyIfEmpty?: boolean }): Promise<{ ok: boolean }>
}

/**
 * 压缩的领域词汇归 `@main/agent/compaction/compaction.types` 所有。这里 re-export,
 * 好让 renderer / preload 的 import 路径只认 `@shared/`。
 * 定义与理由见 `src/main/agent/compaction/compaction.types.ts`。
 *
 * **为什么 shared 能 import main 的类型**:这两组是**纯类型**,编译期擦除,不进 renderer 产物。
 * `tsconfig.web.json` 为此按需窄映射了这一个模块 —— **没有给 `@main/*`**:renderer 不该能解析
 * main,那条边界是刻意的。与 cowork 同一份设计(`areas/agent-runtime/agent-design-parity.md`)。
 */
export type {
  CompactionCutPoint,
  CompactionCutPointRequest,
  CompactionCutRejection,
  CompactionCutSource,
  CompactionReply,
  CompactionRequest,
  CompactionTriggerReply,
  CompactionTriggerRequest,
  CompactionUsage
} from '@main/agent/compaction/compaction.types'
// `export type {} from` 不把名字带进本地作用域,而下面的 MaestroCompactionApi 要用它们。
import type {
  CompactionCutPoint,
  CompactionCutPointRequest,
  CompactionReply,
  CompactionRequest,
  CompactionTriggerReply,
  CompactionTriggerRequest
} from '@main/agent/compaction/compaction.types'

/**
 * main 侧 `CompactionHandler` 的契约。renderer 用
 * `createXpcRendererEmitter<MaestroCompactionApi>('CompactionHandler')` 取它 ——
 * 字符串必须是 handler 的**类名**。
 *
 * 三个方法的边界(与 cowork 逐条相同):
 * · `shouldCompact` 读**真 usage**(`usageLedger` 逐轮累计)判触发线,拿不到账本报 `no-usage`
 *   让调用方退回本地估算 —— **不报一个零用量的「不用压」**,那与「上下文是空的」不可分而后果相反;
 * · `compact` 切点 → 选段 → 摘要 → 合并 → 路径清洗 → 落回 pi 会话;
 * · `cutPoint` 纯下标计算,**刻意不要求登录**:该在哪切与能不能摘要是两件事。
 */
export interface MaestroCompactionApi {
  shouldCompact(params: CompactionTriggerRequest): Promise<CompactionTriggerReply>
  compact(params: CompactionRequest): Promise<CompactionReply>
  cutPoint(params: CompactionCutPointRequest): Promise<CompactionCutPoint>
}
