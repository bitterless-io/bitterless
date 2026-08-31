// Running tasks — the data format for a long-running operation, and its shape inside a message.
// Contract: docs/features/maestro.md and docs/plan/tasks/maestro-cowork-chat-core-089.md.
//
// Modelled on opencode's message/part system (`sst/opencode`, packages/opencode/src/session/
// message-v2.ts; field names verified against its generated SDK types). Its load-bearing idea is
// that a tool call IS the task: `ToolPart.state` is a discriminated union over
// `pending | running | completed | error`, and PROGRESS is just the `running` state re-published with
// a fresh `title` + `metadata`.
//
// We keep those four status names verbatim and diverge in four places, each for a stated reason
// (table in the feature doc): a typed `progress` instead of prose in `title`; a BOUNDED output ring
// during the run instead of one `output` string at the end; `time.update` + `stalled` so a hung task
// is detectable; and `kind` to distinguish a BUILT-IN task (探站) from an agent-authored one.

/** opencode's four names, unchanged. `stalled` is a flag ON `running`, never a fifth status. */
export type MaestroTaskStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * builtin = the app owns the procedure (探站 / 摄取). agent = the model drove it.
 * Ral 2026-08-10:「探站是固有的任务,不是 agent 自己写代码执行的任务」.
 */
export type MaestroTaskKind = 'builtin' | 'agent'

/**
 * Typed progress. opencode puts this in a free-form `title`; a progress bar cannot be rendered from
 * prose, so the countable part is separate and `stage` keeps the human phrase.
 * A task that cannot know its total OMITS it rather than inventing one.
 */
export interface MaestroTaskProgress {
  done?: number
  total?: number
  /** 0..1 — only when it is genuinely known. */
  ratio?: number
  /** What it is doing right now, e.g. "客户管理 (12/47)". */
  stage?: string
  /**
   * 下面两个是**给状态条用的结构化位**,不是 `stage` 的复述。
   *
   * 为什么单列:`stage` 是给人读的一整句,底部状态条要按自己的排版拼「对象 · 进度 · token」,
   * 从那句话里正则抠字段既脆又会随文案漂(chat-response-status-bar-missing.md 的前置问题)。
   */
  /** 累计 token 消耗。钻探的真实预算是它,不是墙钟 —— 只显示时间会让人以为"还早"。 */
  tokens?: number
  /** 当前正在处理的对象:模块名 / 批次对象。短标签,不带进度数字。 */
  subject?: string
}

export interface MaestroTaskOutputLine {
  ts: number
  level: 'info' | 'warn' | 'error'
  text: string
}

/** A file the task produced. The PATH only — the agent fetches content through a task-specific tool. */
export interface MaestroTaskArtifact {
  label: string
  path: string
}

/**
 * A blocking yes/no the task is WAITING ON THE USER for — e.g. an apidoc ingest whose batch timed out
 * 10× asking "keep retrying?" (Ral 2026-08-11). While `pendingConfirm` is set the task is still
 * `running` but PAUSED on the human: the running-tasks card shows the content + Cancel/Confirm, the
 * stall watchdog holds off (waiting-on-you ≠ hung), and the runner's `requestConfirm()` promise stays
 * unresolved until the user clicks (renderer → `respondTaskConfirm`).
 */
/**
 * 确认里要摊开给人看的**一个字段**(Ral 2026-08-17:「Confirm 它的 payload 需要展示给我看一下,
 * 并展示 payload 中哪些字段是 AI 生成的」)。
 *
 * `provenance` 回答的**不是**「这个值是不是 AI 写的」—— `call_site_api` 的 payload 全部来自
 * agent 的工具入参,按字面 100% 都是,标出来没有信息量。它回答的是更有用的那个问题:
 * **这个值能不能在本站之前的接口返回里找到来源。** 系统提示词本就要求写之前先 ground
 * (先调读接口、读实到的返回),所以「找不到来源」精确地挑出了最危险的情形:
 * 一个 id / 状态码是 agent 凭空填的。
 *
 * 三档的措辞是刻意保守的:
 *   · `grounded`  —— 值在历史响应里出现过,且**足够长/高熵**;`source` 写明出处。
 *   · `unsourced` —— 没找到。**不叫「AI 编的」** —— 它可能来自页面 UI,或来自操作者自己给的值。
 *   · `unknown`   —— 值太短 / 布尔 / 个位数。`1`、`true`、`""` 在任何响应里都能撞上,
 *                    给这类值盖「有来源」的章 = 让标记假装安全,比不标更糟。
 *
 * 第三档是这套东西可信的关键:**宁可说「不知道」,也不要给一个会撞上的值盖章。**
 * 标记一旦被发现会误报,人就不看它了 —— 那时它比不存在更坏。
 */
export interface MaestroConfirmField {
  /** 点分路径,如 `body.staff_id` / `query.page`。 */
  path: string
  /** 值的可读渲染(已截断;绝不含凭据 —— 见 downloadGuard 的同类纪律)。 */
  value: string
  provenance: 'grounded' | 'unsourced' | 'unknown'
  /** `grounded` 时的出处,如 `GET /staff/list 07:41`。 */
  source?: string
}

export interface MaestroTaskConfirm {
  /** Unique per request — the renderer echoes it back so a stale card cannot resolve a newer ask. */
  id: string
  /** The content shown at the top of the card. */
  title: string
  /** Optional secondary line. */
  detail?: string
  confirmLabel: string
  cancelLabel: string
  createdAt: number
  /**
   * 这一问要执行的动作的原始 payload,逐字段摊开。有就展示,没有就不展示 ——
   * 预算确认这类没有 payload 的问,这里是空的。
   */
  payload?: {
    /**
     * **agent 用人话写的「即将做什么」** —— 卡片上最显眼的那一行(Ral 2026-08-17:
     * 「应该由 Agent 生成一个标题,说明即将执行的操作。点击标题可以展开详情」)。
     *
     * ⚠ 它是**这张卡上最不可核验的部分**:技术字段是宿主观察到的事实,而这一行是模型的自述。
     * 非技术用户恰恰只会读它 —— 一个友善但失真的标题盖在危险的 payload 上,比没有标题更糟。
     * 所以 UI 必须把它标成「agent 说这是」,并且**技术详情永远只差一次点击、不可移除**;
     * 收起态也要显示「几个字段 / 其中几个没来源」,让风险信号不依赖于人去展开。
     */
    intent?: string
    /** 一行摘要,如 `POST /customer/admin/staff/update`。 */
    summary: string
    fields: MaestroConfirmField[]
  }
}

export interface MaestroTaskState {
  status: MaestroTaskStatus
  /** Human one-liner for this moment — opencode's `title`. */
  title: string
  progress?: MaestroTaskProgress
  metadata?: Record<string, unknown>
  /** Set while the task is blocked awaiting a user Cancel/Confirm; cleared when they answer. */
  pendingConfirm?: MaestroTaskConfirm
  time: {
    start: number
    /** Refreshed on EVERY mutation — this is what the stall watchdog measures. */
    update: number
    end?: number
  }
  /**
   * Bounded tail, oldest dropped. This is what the agent reads —「读这个任务的输出(不是完整产物)」.
   * `droppedLines` keeps the truncation explicit.
   */
  output: MaestroTaskOutputLine[]
  droppedLines: number
  /** Short completion summary. NOT the artifact. */
  result?: string
  error?: string
  /**
   * 这个任务在【等别的东西】,不是在干活 —— 比如钻探在等摄取队列排空。
   *
   * 和 `pendingConfirm` 同级豁免看门狗:两者都是「在等」而不是「挂了」。为什么必须有它:
   * 摄取那几分钟钻探本来就不该有动作,45s 没心跳就被判 stalled(Ral 2026-08-14:「非常误导人」)。
   * **不能靠打假心跳糊过去** —— 那会把真挂起也一起掩盖,假阳性换成假阴性。
   */
  waitingFor?: string
  /** No update for longer than TASK_STALL_MS. Still `running` — an observation, not a verdict. */
  stalled?: boolean
}

export interface MaestroTask {
  /** Stable for the task's whole life, INCLUDING after the tool call that started it returned. */
  id: string
  /** The procedure's name, e.g. 'explore_site' — opencode's `tool`. */
  name: string
  kind: MaestroTaskKind
  /** The LLM tool call that started it, when there was one — opencode's `callID`. */
  callId?: string
  sessionId?: string
  messageId?: string
  /** The arguments it was started with — opencode's `input`. */
  input: Record<string, unknown>
  /**
   * 这个任务**不是一段要展示的工作,只是一次挂起** —— 时间线不给它建卡片。
   *
   * 为什么需要(2026-08-17):把三处原生模态搬进应用内确认流时,`taskRegistry.askOperator()`
   * 刻意走一个临时任务来复用现成管道(确认发布、confirmId 锚定、看门狗豁免、渲染层订阅
   * 全都围绕 task 建好了)。代价没预料到:那个临时任务同样会过 `bindTask`,于是一次审批
   * 产生三样东西 —— 审批任务卡(噪声)+ confirm 留档消息(要)+ 底部操作面(要)。
   * 那张卡没有阶段也没有产出,却占着时间线位置**把 confirm 留档往上顶** ——
   * 而「确认卡会被顶上去」恰恰是底部操作面要解决的问题。
   *
   * 判据必须是这个**结构化字段**,不许按任务名字面匹配(`name === 'approval'` 之类):
   * 下一个审批场景会起一个叫别的名字的任务,那时按名字的判据只会**静默**漏掉它 ——
   * 和幽灵模块换三种 query key 就绕过字面判据是同一个失败模式。
   *
   * 与 `kind: 'builtin' | 'agent'` 是**不同维度**:kind 说的是"谁拥有这个流程",
   * 这个说的是"它值不值得展示成一段工作"。不要挤进 kind。
   */
  transient?: boolean
  state: MaestroTaskState
  artifacts?: MaestroTaskArtifact[]
}

/**
 * A task inside a message. Mirrors opencode's `ToolPart`: the part carries a SNAPSHOT of the state,
 * so a stored transcript renders without the live registry, while the registry stays the source of
 * truth for as long as the task is alive.
 */
export interface MaestroTaskPart {
  type: 'task'
  taskId: string
  callId?: string
  name: string
  kind: MaestroTaskKind
  state: MaestroTaskState
}

/** Broadcast payload — whole snapshots, no reducer in the renderer (decision 9). */
export interface MaestroTaskSnapshot {
  tasks: MaestroTask[]
  ts: number
}

/** Lines kept per task. Past this the oldest go and `droppedLines` counts them. */
export const MAX_TASK_OUTPUT = 200

/** No `time.update` for this long → `stalled`. Observation only; the task is never killed. */
export const TASK_STALL_MS = 45_000

/** Finished tasks kept for the UI and for a late `task_output` read. */
export const MAX_FINISHED_TASKS = 20

export const isTaskLive = (task: MaestroTask): boolean => task.state.status === 'pending' || task.state.status === 'running'

/**
 * Cause-specific explanation shown when a task goes `stalled`. The cause differs by procedure and the
 * message MUST name it (Ral 2026-08-11「如果是 LLM 反馈慢就说是 llm 反馈慢,原因要能具体标记出来」):
 * an ingest waits on the LLM (slow model / slow network), while an explore drives pages (a page that
 * never loads / a link off-site). Single source of truth for all four render sites (main watchdog +
 * agent-facing describe + the two renderer cards). Returns both languages — the workbench card is CN,
 * the chat card is EN — so callers pick a field, not fork the copy.
 */
export const stallHint = (name: string): { zh: string; en: string } =>
  name === 'ingest_recording'
    ? {
        zh: '停止上报了 —— 通常是 LLM 反馈慢或暂时没响应。摄取会自动重试(慢网络下只是更久),任务不会被杀;先看批次进度,别急着重开。',
        en: 'Stopped reporting — usually the LLM is responding slowly or is briefly unavailable. Ingest retries on its own (a slow network just makes it take longer) and is not killed. Watch the batch progress before starting it again.'
      }
    : {
        zh: '停止推进了 —— 常见原因:某个页面一直加载不完,或者点到了跳出站外的链接。任务不会被自动杀掉(慢和挂从外面分不出来),先看输出。',
        en: 'Stopped making progress — usually a page that never finishes loading, or a link that left the site. It is not killed: from outside, slow and hung look the same. Read the output before starting it again.'
      }
