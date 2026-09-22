/**
 * 历史轮次的快照类工具输出直接裁剪,不送进压缩。
 *
 * 设计依据:`areas/agent-runtime/chat/compaction/compaction.html` #7(已定 2026-09-22)。
 * Ral 2026-09-22:「不应该压缩没必要压缩的东西」/「历史的一些输出不用参加压缩,而是直接裁剪掉」。
 *
 * **为什么不能靠 pi 自己做**:pi 的压缩只按**位置**挑内容 —— `isCutPointMessage` 对 `toolResult`
 * 一律 `return false`,`findCutPoint` 只往回累加到 `keepRecentTokens` 为止,没有任何按工具名、
 * 按体积、按新旧的筛选。唯一的旋钮 `keepRecentTokens` 调大只会让**更多**全文留在上下文里,
 * 方向相反。所以"哪些输出没必要留"这件事只能由宿主在上游表达。
 *
 * **为什么裁的是历史而不是入库时封顶**:当前轮确实需要 `page_snapshot` 全文才能操作页面
 * (Ral:「上下文中确实需要 page_snapshot 的全部结果」)。入库封顶会砍掉正在用的那一份;
 * 单条过大是另一个病灶,在工具返回层单独治。
 */

/**
 * 快照类工具:返回体积由页面/文件大小决定,而非模型的决策内容;历史轮次保留全文无价值。
 * 名单是白名单而非黑名单 —— 新工具漏登记时退化为"不裁",偏安全方向。
 */
export const PRUNABLE_TOOL_NAMES: readonly string[] = ['page_snapshot', 'read_file'];

/**
 * 保留全文的**工具轮次**数(Ral 2026-09-22:「最近 2 轮」)。
 *
 * 一轮 = 一次 assistant 响应连同它的工具结果,**不是**一次用户回合。按用户回合算的话,
 * 故障会话里 26 条快照全在"最近 1 轮"内,一条都裁不掉 —— 那个读法解不了要解的问题。
 */
export const PRUNE_KEEP_RECENT_ROUNDS = 2;

/** 占位行的固定前缀。既是给模型的说明,也是本函数判断"已经裁过"的幂等标记。 */
const PRUNED_MARKER = '[pruned-tool-output]';

type ContentBlock = { readonly type?: string; readonly text?: string };
type PrunableMessage = {
  readonly role?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly content?: unknown;
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content as ContentBlock[]) {
    if (block && block.type === 'text' && typeof block.text === 'string') out += block.text;
  }
  return out;
};

const isAlreadyPruned = (content: unknown): boolean => textOf(content).startsWith(PRUNED_MARKER);

/**
 * 只保留能用来重新取值的那几个参数。整份 arguments 可能本身就很大(例如 write_file 的正文),
 * 把它原样塞进占位行等于没裁。
 */
const RECOVERY_ARG_KEYS: readonly string[] = ['path', 'file', 'filePath', 'url', 'tabId', 'target'];

const recoveryHint = (args: unknown): string => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const parts: string[] = [];
  for (const key of RECOVERY_ARG_KEYS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) parts.push(`${key}=${value}`);
    else if (typeof value === 'number') parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
};

/** 从 assistant 的 toolCall 块收集 toolCallId → 可用于重新取值的参数提示。 */
const collectRecoveryHints = (messages: readonly unknown[]): Map<string, string> => {
  const hints = new Map<string, string>();
  for (const message of messages) {
    const m = message as { role?: string; content?: unknown };
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const block of m.content as { type?: string; id?: string; arguments?: unknown }[]) {
      if (block && block.type === 'toolCall' && typeof block.id === 'string') {
        hints.set(block.id, recoveryHint(block.arguments));
      }
    }
  }
  return hints;
};

/**
 * 把超出最近 `PRUNE_KEEP_RECENT_ROUNDS` 轮的快照类工具输出换成一行占位。
 *
 * 纯函数、幂等:重复调用不会二次裁剪,也不会改动入参。两个钩子
 * (`prepareNextTurnWithContext` 与 `transformContext`)共用同一次实现,正是靠这两条性质。
 */
export const pruneToolOutputs = <T>(
  messages: readonly T[],
  keepRecentRounds: number = PRUNE_KEEP_RECENT_ROUNDS,
  prunableToolNames: readonly string[] = PRUNABLE_TOOL_NAMES,
): T[] => {
  // 先校验后走快路径:配置错了就该报,不该因为这次消息恰好为空而蒙过去。
  if (!Number.isSafeInteger(keepRecentRounds) || keepRecentRounds < 0) {
    throw new RangeError('Invalid keepRecentRounds: expected a non-negative safe integer');
  }
  if (!Array.isArray(messages) || messages.length === 0) return messages as T[];
  const prunable = new Set(prunableToolNames);
  if (prunable.size === 0) return messages.slice();

  const hints = collectRecoveryHints(messages);
  const next = messages.slice();
  let changed = false;
  // 倒序:一条工具结果之后出现过几次 assistant 响应,就说明它落在第几轮之前。
  let assistantsAfter = 0;
  for (let index = next.length - 1; index >= 0; index--) {
    const message = next[index] as PrunableMessage;
    if (message?.role === 'assistant') {
      assistantsAfter++;
      continue;
    }
    if (message?.role !== 'toolResult') continue;
    if (assistantsAfter < keepRecentRounds) continue;
    if (typeof message.toolName !== 'string' || !prunable.has(message.toolName)) continue;
    if (isAlreadyPruned(message.content)) continue;
    const original = textOf(message.content);
    if (original.length === 0) continue;
    const hint = message.toolCallId ? hints.get(message.toolCallId) || '' : '';
    next[index] = {
      ...(message as object),
      content: [{
        type: 'text',
        text: `${PRUNED_MARKER} ${message.toolName}${hint} —— 原文 ${original.length} 字符已从上下文移除(超出最近 ${keepRecentRounds} 轮)。需要当前内容时重新调用该工具。`,
      }],
    } as unknown as T;
    changed = true;
  }
  // 无变更时**返回原引用**,不返回副本:调用侧用 `!== ` 判断"这次到底裁没裁",
  // 副本会让那个判断恒为真,于是每一轮工具调用都白算一次 measurePrune(它要把整个上下文
  // 拼成字符串,200K 上下文上就是每轮两次近 MB 级的拼接)。
  return changed ? next : (messages as T[]);
};

/**
 * 裁剪前后的字符数,用于诊断事件。不参与裁剪决策。
 *
 * `prunedMessages` 只数**本次新裁**的那些。裁剪结果会持久到 `currentContext`,所以第二轮起
 * 入参里本来就带着上几轮的占位行;直接数占位行会把它们一起算上,让日志每轮都报一个越来越大
 * 的数(明明这轮只新裁了一条)。裁剪只替换、不删改位置,因此逐位比对是可行的。
 */
export const measurePrune = (before: readonly unknown[], after: readonly unknown[]): { beforeChars: number; afterChars: number; prunedMessages: number } => {
  let beforeChars = 0;
  let afterChars = 0;
  let prunedMessages = 0;
  for (const message of before) beforeChars += textOf((message as PrunableMessage)?.content).length;
  for (const message of after) afterChars += textOf((message as PrunableMessage)?.content).length;
  if (before.length === after.length) {
    for (let index = 0; index < after.length; index++) {
      if (isAlreadyPruned((after[index] as PrunableMessage)?.content)
        && !isAlreadyPruned((before[index] as PrunableMessage)?.content)) prunedMessages++;
    }
  }
  return { beforeChars, afterChars, prunedMessages };
};
