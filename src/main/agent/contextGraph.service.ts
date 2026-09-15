import {
  CONTEXT_GRAPH_MATCH_HEAD_CHARS,
  type ContextGraphBlockView,
  type ContextGraphTypeTotalView,
  type ContextGraphView
} from '@maestro-shared/coach.api'
import { compactionBoundary } from '@main/agent/compaction/compactionEntries'
import { flattenEntryRows, type ContextExportInput } from '@main/agent/contextExport.service'

/**
 * 「此刻的上下文长什么结构」——**有界**的结构投影,给 `/view_context_graph` 用。
 *
 * 与 `buildContextRecord` 的分工:那份是**正文**(逐字、不截断、进剪贴板);这份是**结构**
 * (类型、体量、回合、压缩边界),每条只带一小段 preview。两者共用同一个展平映射
 * (`flattenEntryRows`),所以类型口径不会漂。
 *
 * 契约:`docs/features/maestro-context-graph.md`。四件事值得在这里就说清:
 *
 * **① 已被压缩吸收的条目只汇总,不逐条列。** 不是为了省流量 —— 它们**模型已经看不到了**,
 * 逐条列出来就是把"上下文的结构"画错。判据用 pi 自己的 `CompactionEntry.firstKeptEntryId`
 * (经 `compactionBoundary`),不是我们推的边界。顺带把载荷的上界钉住,于是不需要一个人为的
 * "最多 N 条"。
 *
 * **② 回合是「上下文回合」,不是渲染层那个 `Turn`。** 全仓没有 turn 身份,而渲染层推不出可靠的
 * 分组键(中途 steering 会在回合内插一条 user 消息,事后与开启回合的那条无法区分)。这里数的是
 * **模型看到的**回合边界:一条**存活的** user 条目开启一轮。名字刻意不同,避免第二个真相源。
 *
 * **③ 纯函数。** 不读时钟、不碰文件系统 —— 与 `buildContextRecord` 同一条理由:守卫要能拿到确定输出。
 *
 * **④ 直接产出 xpc 契约里的 `ContextGraphView`,不另立一套 main 侧同形类型。** cowork 那边是两张
 * 结构相同的表(`ContextGraph` + `ContextGraphView`),要靠人手同步;这里只有一张,因为这个函数
 * 的**唯一**出口就是那条 xpc。少一张表 = 少一处会静默漂的地方。
 */

/** preview 的上限。够认出"这是哪一块",不够当正文用 —— 正文去 `/view_context`。 */
export const CONTEXT_GRAPH_PREVIEW_CHARS = 160

/**
 * 渲染层送上来的消息摘要 —— **join 在 main 做**,不在渲染层。
 *
 * 因为 `user` 条目的正文**不是**用户那句话:它是整块拼装后的 turn prompt(系统提示词 + 每轮注入的
 * 上下文 + 末尾的用户消息)。前缀匹配因此必然失败,而**持有完整条目正文的这一侧**只要做一次
 * `includes(head)` 就能确定归属。渲染层反过来做,只能拿到 preview,那是同一个信息的更差版本。
 */
export interface ContextGraphMessageDigest {
  id: string
  role: 'human' | 'ai'
  /** 消息正文的前 `CONTEXT_GRAPH_MATCH_HEAD_CHARS` 个字符(原样,不做空白折叠)——
   *  那个常量在 `@maestro-shared/coach.api` 里,因为截取在渲染层、比对在这里,**两侧只能有一个数**。 */
  head: string
}

const previewOf = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, CONTEXT_GRAPH_PREVIEW_CHARS)

const totalsOf = (blocks: { type: string; chars: number }[]): ContextGraphTypeTotalView[] => {
  const byType = new Map<string, ContextGraphTypeTotalView>()
  for (const block of blocks) {
    const total = byType.get(block.type) || { type: block.type, blocks: 0, chars: 0 }
    total.blocks += 1
    total.chars += block.chars
    byType.set(block.type, total)
  }
  // 按字符降序 —— 这张表是拿来回答"谁在吃窗口"的,条数不是那个答案。
  return [...byType.values()].sort((a, b) => b.chars - a.chars || (a.type < b.type ? -1 : 1))
}

export interface ContextGraphInput extends ContextExportInput {
  /** 渲染层的消息摘要,按时间顺序。缺省 = 所有块都不可点。 */
  messages?: ContextGraphMessageDigest[]
}

/**
 * 认领:按**顺序**在候选里找第一条 role 匹配、且其 `head` 出现在条目正文里的消息。
 *
 * 游标只前进 —— 同一条消息不会被两块认领,而"后面的块不会认领前面的消息"正是顺序应当给的保证。
 */
const claimMessageId = (
  entryText: string,
  wanted: 'human' | 'ai',
  digests: ContextGraphMessageDigest[],
  cursor: { at: number }
): string | undefined => {
  for (let index = cursor.at; index < digests.length; index += 1) {
    const digest = digests[index]
    if (digest.role !== wanted) continue
    // 截一刀而不是原样用:这是**进程边界**,渲染层送多长由它自己说。送 5 万字符过来会把
    // `includes` 变成"整条消息完全相等"这种事实上永不成立的判据 —— 症状是块莫名不可点。
    const head = (digest.head || '').trim().slice(0, CONTEXT_GRAPH_MATCH_HEAD_CHARS)
    if (!head || !entryText.includes(head)) continue
    cursor.at = index + 1
    return digest.id
  }
  return undefined
}

export const buildContextGraph = (input: ContextGraphInput): ContextGraphView => {
  const rows = flattenEntryRows(input.entries)
  const digests = input.messages || []
  const cursor = { at: 0 }
  /**
   * 压缩边界用**本仓自己的** `compactionBoundary()`,不移植 cowork 的 `absorbedBoundaryIndex()`。
   *
   * 差别在一个真实分支上:`firstKeptEntryId` **找不到**(上一轮把尾部清空了 ⇒ 那个 id 故意匹配
   * 不到任何 entry)时,这份退到 `previousCompactionIndex + 1`,与 pi 未导出的 `prepareCompaction`
   * 同一个分支;cowork 那份在同样情形下退成 `0`,也就是**报告"什么都没被吸收"** —— 一个只在
   * 压缩过的长会话里出现、方向是"少报"的偏差(契约 #2.1,回流待办记在契约 #8)。
   */
  const boundary = compactionBoundary(input.entries).startIndex
  const idIndex = new Map<string, number>()
  for (let index = 0; index < input.entries.length; index += 1) {
    const id = (input.entries[index] as unknown as { id?: string }).id
    // 首次出现胜出:同一个 id 重复出现时后面那条不该改写前面那条的位置(边界判定按位置做)。
    if (typeof id === 'string' && !idIndex.has(id)) idIndex.set(id, index)
  }

  const live: ContextGraphBlockView[] = []
  const absorbedRows: { type: string; chars: number }[] = []
  let turn = 0
  for (const { row, entryId, parentId } of rows) {
    const at = idIndex.get(entryId)
    // `compaction` 条目自己**永不算被吸收** —— 它携带的就是 summary,是上下文里活着的那一块。
    // 这条豁免不是可选的:上面那个 fallback 边界恰好落在**它后面**(`previousCompactionIndex + 1`),
    // 所以少了豁免,那条 compaction 一定会被算进被吸收的一段,而被吸收的段是不逐条列的 ⇒
    // 整份结构里会缺掉模型此刻真正在读的那块摘要。
    // `at === undefined`(条目没有 id)按**存活**算:定位不了的行宁可列出来,也不要被静默折进
    // 只给合计的那一段 —— 那样它就从结构里消失了。
    const isAbsorbed = row.type !== 'compaction' && at !== undefined && at < boundary
    if (isAbsorbed) {
      absorbedRows.push({ type: row.type, chars: row.chars })
      continue
    }
    // 回合只由**存活的** user 条目开启 —— 被吸收的那些已经不在上下文里,给它们编号会让
    // "第 N 轮"和模型看到的对不上。
    if (row.type === 'user') turn += 1
    // 只有 user / assistant 可能有界面载体;tool_call / tool_result / compaction / 其余条目
    // 传 `null` ⇒ 不参与认领,也就**不会推进游标**(否则一条工具块会吃掉一条真消息的名额)。
    const wanted = row.type === 'user' ? 'human' : row.type === 'assistant' ? 'ai' : null
    live.push({
      i: live.length + 1,
      messageId: wanted ? claimMessageId(row.text, wanted, digests, cursor) : undefined,
      entryId,
      parentId,
      type: row.type,
      tool: row.tool || undefined,
      chars: row.chars,
      turn,
      preview: previewOf(row.text)
    })
  }

  const draft = input.pending?.draft || undefined
  const attachments = input.pending?.attachments?.length ? input.pending.attachments : undefined
  const pendingChars = (draft?.length || 0) + (attachments?.join('\n').length || 0)
  return {
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    systemChars: input.systemPrompt.length,
    systemPreview: previewOf(input.systemPrompt),
    blocks: live,
    absorbed: absorbedRows.length
      ? {
          blocks: absorbedRows.length,
          chars: absorbedRows.reduce((sum, row) => sum + row.chars, 0),
          byType: totalsOf(absorbedRows)
        }
      : undefined,
    turns: turn,
    // 被吸收的字符**不计入** totalChars —— 它们已经不在上下文里,加进来画的是"我们存了什么"。
    totalChars:
      input.systemPrompt.length + live.reduce((sum, block) => sum + block.chars, 0) + pendingChars,
    byType: totalsOf(live),
    pending: { workspace: input.pending?.workspace, attachments, draft, chars: pendingChars },
    // `ContextExportInput` 带的 `ioLogDir` / `contextWindow` 在这里**刻意不出现**:
    // 前者由 /copy_session_path 与 /view_context 提供，结构图不重复展示(契约 #2.5)；
    // 后者的单位是 token 而这份投影的单位是字符,写成一个比值看着精确、实际是两个单位相除。
    noHistory: rows.length === 0
  }
}
