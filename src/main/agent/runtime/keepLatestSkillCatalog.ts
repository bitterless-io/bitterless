/**
 * 一个会话里只留**一份**技能目录(Ral 2026-09-22:「技能目录在一个会话里应该只有一份」)。
 *
 * **为什么需要这个函数**:目录是随每条用户消息拼进去的,而历史消息不会被回头清理,
 * 于是聊到第 N 轮上下文里就有 N 份同样的目录。2026-09-22 的一次 BL 会话实测:
 * 4 轮短对话,每轮 57,083 tok,其中 52,556 tok(92.1%)是目录;四轮合计 228,312 tok,
 * 越过 256K 窗口留 20% 的 204,800 触发线 —— 用户实际打的字约 100 个字符。
 *
 * **为什么是替换而不是删除**:模型需要知道"这里原本有东西、它去哪了",否则前文引用
 * 目录里的技能时会显得凭空;留一行指路比留一个洞更稳。
 *
 * **为什么挂在 `transformContext`**:那个钩子只改发给 provider 的 payload,
 * **不回写** `currentContext.messages`(`pi-agent-core/dist/agent-loop.js:180`)。
 * 所以会话文件里的历史仍然完整,被裁掉的只是重复发出去的那几份。
 */

/** 与宿主渲染目录时用的围栏一致。两端共用同一对标记,本函数才能两端通吃。 */
export const SKILL_CATALOG_START = '<host_skill_catalog>';
export const SKILL_CATALOG_END = '</host_skill_catalog>';

/** 占位行的固定前缀,同时是本函数判断"已经处理过"的幂等标记。 */
const SUPERSEDED_MARKER = '[skill-catalog superseded]';

type ContentBlock = { readonly type?: string; readonly text?: string };
type CatalogMessage = { readonly role?: string; readonly content?: unknown };

const blockTexts = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block && typeof block.text === 'string') out.push(block.text);
  }
  return out;
};

const hasCatalog = (content: unknown): boolean =>
  blockTexts(content).some(text => text.includes(SKILL_CATALOG_START) && text.includes(SKILL_CATALOG_END));

/**
 * 从目录 JSON 里取 `catalogRevision`,用于占位行。取不到就不写版本号 ——
 * 宁可少一句话,也不要在占位行里写一个可能是错的版本。
 */
const revisionOf = (catalog: string): string => {
  const match = /"catalogRevision"\s*:\s*"([^"]{1,128})"/.exec(catalog);
  return match ? match[1] : '';
};

/** 把一段文本里的目录换成占位行。文本里可能有多段,全部替换。 */
const supersede = (text: string, revision: string): string => {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(SKILL_CATALOG_START, cursor);
    if (start < 0) break;
    const end = text.indexOf(SKILL_CATALOG_END, start);
    if (end < 0) break;
    out += text.slice(cursor, start);
    out += revision
      ? `${SUPERSEDED_MARKER} 这条消息当时附带的技能目录已移除,当前完整目录见本次请求最后一条消息(revision ${revision})。`
      : `${SUPERSEDED_MARKER} 这条消息当时附带的技能目录已移除,当前完整目录见本次请求最后一条消息。`;
    cursor = end + SKILL_CATALOG_END.length;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
};

/**
 * 只保留**最后**一条带目录的用户消息里的那一份,更早的全部换成占位行。
 *
 * 纯函数、幂等:入参不被改动;重复调用不会二次替换(占位行里没有围栏,自然不再命中)。
 */
export const keepLatestSkillCatalog = <T>(messages: readonly T[]): T[] => {
  if (!Array.isArray(messages) || messages.length === 0) return messages as T[];

  let latest = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as CatalogMessage;
    if (message?.role === 'user' && hasCatalog(message.content)) {
      latest = index;
      break;
    }
  }
  // 0 份或仅 1 份 —— 没有可裁的,原样返回(调用侧用 `!==` 判断这轮有没有动过)。
  if (latest <= 0) return messages as T[];

  const revision = revisionOf(blockTexts((messages[latest] as CatalogMessage).content).join('\n'));
  const next = messages.slice();
  let changed = false;
  for (let index = 0; index < latest; index++) {
    const message = next[index] as CatalogMessage;
    if (message?.role !== 'user' || !hasCatalog(message.content)) continue;
    const content = message.content;
    next[index] = {
      ...(message as object),
      content: typeof content === 'string'
        ? supersede(content, revision)
        : (content as ContentBlock[]).map(block =>
            block && typeof block.text === 'string'
              ? { ...block, text: supersede(block.text, revision) }
              : block)
    } as unknown as T;
    changed = true;
  }
  return changed ? next : (messages as T[]);
};

/** 裁掉了几份、省了多少字符。用于诊断事件,不参与决策。 */
export const measureSkillCatalogs = (before: readonly unknown[], after: readonly unknown[]): { supersededMessages: number; beforeChars: number; afterChars: number } => {
  const chars = (list: readonly unknown[]): number => {
    let total = 0;
    for (const message of list) for (const text of blockTexts((message as CatalogMessage)?.content)) total += text.length;
    return total;
  };
  let supersededMessages = 0;
  if (before.length === after.length) {
    for (let index = 0; index < after.length; index++) {
      if (hasCatalog((before[index] as CatalogMessage)?.content)
        && !hasCatalog((after[index] as CatalogMessage)?.content)) supersededMessages++;
    }
  }
  return { supersededMessages, beforeChars: chars(before), afterChars: chars(after) };
};
