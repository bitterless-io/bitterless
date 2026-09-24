import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { decisionHelper } from '@main/decision/decisionHelper';
import { chunkSnapshot } from '@maestro-main/drive/snapshotChunker';
import { PRUNE_MIN_BYTES, pruneSnapshot } from '@maestro-main/drive/snapshotPrune';

/**
 * 快照瘦身的**唯一**出口。两级,顺序固定:
 *
 *   ① 按角色裁剪(确定性,先做)—— 丢纯展示文字,保住**全部**可操作元素与数据行。
 *      实测 6 页省 27.3%–71.5%,零延迟零模型,且在 BJ1 切不出块的页面上照样生效。
 *   ② BJ1 按相关性选段(要 Jev,后做)—— 只有模型给了 `goal` 才可能发生。
 *
 * 为什么是这个顺序:裁剪的收益与选段同级而风险为零(对抗评审 2026-09-23 的结论,
 * 已用实测复核)。选段还欠着四条未解风险 —— 陈旧 ref 的静默点错、选错块只能整份重拍、
 * 运行时拼出的 criteria 是口味式的、弹窗会被并进无关块 —— 所以它排在后面,
 * 而且**默认不发生**(要 Decision 开关打开 + 模型主动传 goal)。
 *
 * 三条纪律贯穿两级:
 * · **只删不写。** 返回的字节永远是原文的子集。
 * · **路径永远给。** 完整快照落盘,路径写在头部,`read_file` 可直接读(支持 offset/limit)。
 * · **失败就放行原文。** 任何一步出问题都返回完整快照 —— fail 方向是"不优化",不是"丢数据"。
 */

const SNAPSHOT_DIR_NAME = 'snapshots';
let sequence = 0;

const snapshotDir = (): string => join(app.getPath('userData'), SNAPSHOT_DIR_NAME);
const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `<userData>/snapshots/<YYYYMMDD-HHmmss>-<seq>.yml`,与 longPaste 的落盘同形(含 0o600)。 */
const spill = (text: string): string => {
  sequence += 1;
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const absolutePath = join(snapshotDir(), `${stamp}-${sequence}.yml`);
  mkdirSync(snapshotDir(), { recursive: true });
  writeFileSync(absolutePath, text, { encoding: 'utf8', mode: 0o600 });
  return absolutePath;
};

/** 页头 5 行(tab/page/title/elements/snapshot)之后、树之前的那些 `#` 行是 NOTE / INCOMPLETE。 */
const splitHead = (text: string): { header: string[]; notes: string[]; body: string[] } => {
  const lines = text.split('\n');
  const header: string[] = [];
  const notes: string[] = [];
  let index = 0;
  // 5 行:tab / page / title / elements / snapshot(世代号)。数错会把世代号当成 NOTE 加后缀。
  for (; index < lines.length && header.length < 5; index++) {
    if (lines[index].startsWith('# ')) header.push(lines[index]);
    else if (lines[index].trim()) break;
  }
  for (; index < lines.length; index++) {
    if (lines[index].startsWith('#')) notes.push(lines[index]);
    else if (lines[index].trim()) break;
  }
  return { header, notes, body: lines.slice(index) };
};

export interface SegmentOutcome {
  text: string;
  /** 供日志:实际发生了什么。没瘦身时写明原因,便于回头核阈值。 */
  note: string;
}

/**
 * @param composed 页头 + yaml 的完整字符串(即不瘦身时直接返回的那一份)
 * @param goal     模型这次想找什么。**没有目标就不选段** —— 没有判准的 choice 只会保守地
 *                 乱选一块(实测:口味式判准 confidence 0.63,可验证判准 0.98)。裁剪不需要目标。
 */
export const segmentSnapshot = async (composed: string, goal?: string): Promise<SegmentOutcome> => {
  const wanted = (goal || '').trim();
  const willPrune = composed.length >= PRUNE_MIN_BYTES;
  if (!willPrune && !wanted) return { text: composed, note: 'unchanged (small snapshot, no goal)' };

  const { header, notes } = splitHead(composed);
  const fullElements = (header.find((line) => line.startsWith('# elements:')) || '')
    .replace('# elements:', '')
    .trim();

  let path = '';
  try {
    path = spill(composed);
  } catch (error) {
    // 落不了盘就什么都不做 —— 没有退路的瘦身就是丢数据。
    return { text: composed, note: `unchanged (spill failed: ${(error as Error).message})` };
  }

  // ① 确定性裁剪
  const pruned = pruneSnapshot(composed);
  const what: string[] = [];
  let working = composed;
  if (pruned.pruned) {
    working = pruned.text;
    what.push(
      `# REDUCED: display-only text was dropped; all ${pruned.keptActionable} actionable/data rows are kept. Do NOT conclude an element is absent.`
    );
  }

  // ② BJ1 选段(仅在模型给了目标时)
  let segNote = '';
  if (wanted) {
    const { lines, blocks, totalBytes, skip } = chunkSnapshot(working);
    if (skip) segNote = `not segmented (${skip})`;
    else {
      const criteria: Record<string, string> = { none: 'no block contains what the goal describes' };
      for (const block of blocks) criteria[block.id] = block.label;
      // 显式 0.7:大于它才采信选段 —— 保持迁移前的线,不跟着默认值变成 0.5(docs/features/decision-helper.md #4)。
      const outcome = await decisionHelper.choose(
        {
          name: 'block',
          instructions:
            'Which block contains the elements and text needed to carry out the goal? Judge by whether the controls/text the goal names would be inside that block, not by which block looks most important.',
          criteria
        },
        { goal: wanted, blocks: blocks.map((block) => ({ id: block.id, label: block.label })) },
        { threshold: 0.7 }
      );
      // 把握不够时 helper 也带回它选的那一块,所以先看选了哪块、再看把握够不够 —— 与迁移前的判断顺序相同。
      const picked =
        outcome.value && outcome.value !== 'none' ? blocks.find((block) => block.id === outcome.value) : undefined;
      // 这句只进 page_snapshot 的一条 `info` trace(requestExec.service.ts),不回模型,录制也不收
      // (capture.service.ts 的 `emitTrace` 丢掉 info);照样叫 decision maker(decision-maker-naming-and-approval-card.md #2)。
      // 拿不到判定就不选段、原样往下走(fail-open)—— 这是选段自己的决定,不在 helper 里。
      // 没过阈值(`low-confidence`)也算答了;没答时只写原因和 HTTP 状态,不带 message,relay 的原始报错只进日志
      // (docs/features/decision-helper.md #3 #4)。
      const answered = outcome.decided === true || outcome.reason === 'low-confidence';
      if (!answered)
        segNote = `not segmented (decision maker ${outcome.reason}${outcome.status ? ` ${outcome.status}` : ''})`;
      else if (!picked) segNote = 'not segmented (decision maker picked none)';
      else if (!outcome.decided) segNote = `not segmented (confidence ${outcome.confidence})`;
      else {
        working = lines.slice(picked.start, picked.end).join('\n');
        const savedPct = (((totalBytes - picked.bytes) / totalBytes) * 100).toFixed(0);
        what.push(
          `# SEGMENTED: showing 1 of ${blocks.length} page sections (${picked.label.split(' — ')[0]}), selected for: ${wanted}. The other sections are NOT shown.`
        );
        segNote = `segmented to ${picked.id} (${savedPct}% saved, confidence ${outcome.confidence})`;
      }
    }
  }

  if (!what.length) return { text: composed, note: segNote || 'unchanged (nothing to reduce)' };

  const split = splitHead(working);
  const body = split.body.length ? split.body : working.split('\n');
  const shown = body.filter((line) => /\[ref=e\d+\]/.test(line)).length;
  const text = [
    // `# elements` 必须重算:原值是全页保留节点数,抄到一份被削过的正文上方,页头与正文互相打脸。
    ...header.filter((line) => !line.startsWith('# elements:')),
    `# elements: ${shown} shown here (full page has ${fullElements})`,
    // 原始 NOTE / INCOMPLETE 的计数与样例串都是按**全树**算的,样例甚至可能已被削掉 ——
    // 原样抄等于让 agent 去它拿到的文本里找一个必然找不到的串。`# LOADING:` 例外:它不带计数,对削过的正文同样成立,原样保留。
    ...notes.map((line) => (line.startsWith('# LOADING:') ? line : `${line}   (applies to the FULL snapshot, not to the reduced view below)`)),
    ...what,
    `# Full snapshot: ${path}  — read it with read_file (offset/limit supported) when something you expect is missing.`,
    '',
    ...body
  ].join('\n');
  const savedPct = (((composed.length - text.length) / composed.length) * 100).toFixed(0);
  return {
    text,
    note: `${pruned.pruned ? 'pruned' : 'not pruned'}${segNote ? ` · ${segNote}` : ''} · ${savedPct}% saved`
  };
};
