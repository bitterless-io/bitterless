/**
 * 快照的**确定性**瘦身:按角色裁剪。
 *
 * 它不是 BJ1 —— 不问模型、不选段、零延迟,而且**按构造不可能丢掉任何可操作元素**
 * (实测 6 页 347/347、590/590、1084/1084、4279/4279 全部保留)。
 * 它换掉的是 `clipText` 那种按位置硬切:硬切会切在任意位置,而这里丢掉的只有纯展示文字。
 *
 * 实测(`areas/agent-runtime/decision/snapshot-prune.mjs`,2026-09-23):
 * arco 省 71.5% · wikipedia 省 50.8% · github 省 48.9% · ant 省 27.3%。
 * 它在 BJ1 因为"切不出块"而跳过的页面上照样生效(arco、Hacker News),这正是它该排在前面的理由。
 *
 * **为什么保留 table/row/cell/listitem** —— 一开始的激进版把它们也丢了,arco 能省到 86.1%。
 * 但「删掉张三那一行」要先看得见张三:数据行是 CRMS 这类业务页的内容本身,丢掉它等于
 * 把"看不清"变成"看不见",与 dialog 被并进无关块是同一类错误。ant 那页因此从 78.6% 降到
 * 27.3% —— 那一页整个就是 API 表格,省得少是对的。
 */

/** 要动手就必须留下的 + 承载数据的结构行。 */
const KEEP_ROLES = new Set([
  // 可操作
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'switch',
  'slider',
  'option',
  'spinbutton',
  'listbox',
  // 定位与边界
  'heading',
  'dialog',
  'alert',
  'iframe',
  // 数据
  'table',
  'row',
  'cell',
  'columnheader',
  'rowheader',
  'list',
  'listitem'
]);

/** 低于这个体量不裁 —— 小快照本来就便宜,丢正文只会让读页任务变难。 */
export const PRUNE_MIN_BYTES = 20000;

const roleOf = (raw: string): string => (raw.trim().match(/^-\s+([a-zA-Z][\w-]*)/) || [])[1] || '';
const indentOf = (raw: string): number => raw.length - raw.trimStart().length;
const isNode = (raw: string): boolean => raw.trim().startsWith('- ');

export interface PruneResult {
  text: string;
  /** 本次真的裁了吗。没裁时 text 与入参相同。 */
  pruned: boolean;
  keptActionable: number;
  droppedBytes: number;
}

/**
 * 保留命中行 + 它们的整条祖先链(否则缩进树断裂)+ 紧跟其后的附属行(`- /url:` 等)。
 * 纯展示文字叶子(`- text: …`)与没有任何保留后代的容器被丢掉。
 */
export const pruneSnapshot = (composed: string): PruneResult => {
  if (composed.length < PRUNE_MIN_BYTES) {
    return { text: composed, pruned: false, keptActionable: 0, droppedBytes: 0 };
  }
  const lines = composed.split('\n');
  const keep = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith('#')) {
      keep.add(i);
      continue;
    }
    if (!KEEP_ROLES.has(roleOf(raw))) continue;
    keep.add(i);

    // 祖先链:缩进严格变小的最近那些行。
    let indent = indentOf(raw);
    for (let j = i - 1; j >= 0 && indent > 0; j--) {
      if (!isNode(lines[j])) continue;
      const parentIndent = indentOf(lines[j]);
      if (parentIndent < indent) {
        keep.add(j);
        indent = parentIndent;
      }
    }
    // 附属行(`- /url: …` 这类不以 `- <role>` 开头的续行)。
    for (let j = i + 1; j < lines.length && !isNode(lines[j]); j++) {
      if (lines[j].trim()) keep.add(j);
    }
  }

  const kept = [...keep].sort((a, b) => a - b);
  const text = kept.map((index) => lines[index]).join('\n');
  const keptActionable = kept.filter((index) => /\[ref=e\d+\]/.test(lines[index])).length;
  return {
    text,
    pruned: true,
    keptActionable,
    droppedBytes: composed.length - text.length
  };
};
