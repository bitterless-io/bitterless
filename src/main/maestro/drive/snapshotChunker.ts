/**
 * BJ1 的切块器(overmind `areas/agent-runtime/decision/browser-use.html` #1 / #2.2)。
 *
 * **纯函数,不碰网络也不碰模型** —— 它只负责把一份快照切成候选块。选哪一块是 Jev 的事,
 * 复制哪些字节是 `snapshotSegment.ts` 的事。三件分开,是因为只有这一件能写单测。
 *
 * 规则与阈值全部来自实测(脚本 `areas/agent-runtime/decision/snapshot-chunker.mjs`,
 * 9 个真实页面,2026-09-23):
 * · landmark 优先 —— 页面自己声明的区域划分比任何体量启发式都可靠;
 * · **切分而非覆盖** —— github 首页三个 landmark 只占 69.1%,中间那片营销网格不属于任何
 *   landmark。只拿 landmark 成块,那 26.5% 不在任何块里,选段就等于把它悄悄删掉;
 * · 扁平树回落 —— arco 组件文档页塌缩后顶层切出 4589 块,纯顶层规则不成立;
 * · 跳过的判据是**省下的字节**,不是占比 —— ant.design 那页最大块占 62.4%,按占比闸会被
 *   挡掉,可 218KB 的 37.6% 是 82KB(约 2 万 token),是实测里最大的一笔。
 */

/** 页面自己声明的区域划分。 */
const LANDMARKS = new Set([
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
  'region',
  'dialog',
  'form',
  'search'
]);

/** 小于总量这个比例的块并进邻居 —— 选项太碎,choice 的概率分布就没有意义。 */
const MIN_SHARE = 0.05;
/** 选一块却几乎等于整页,那不叫选。 */
const MAX_SHARE = 0.85;
const MIN_BLOCKS = 3;
/** 低于这个体量的快照根本不进这一格:给 1KB 的快照加 0.5 秒是十倍开销。 */
const MIN_SNAPSHOT_BYTES = 8000;
/**
 * 保底能省下的字节。低门槛是算出来的:一次判定 ≈1K token 且**只付一次**,而省下的字节
 * **每圈都省**(这条回路的成本函数是 字节 × 剩余圈数)。按 4 字符≈1 token,8KB ≈ 2K token,
 * 单圈就赚回判定成本。
 */
const MIN_SAVED_BYTES = 8000;

export interface SnapshotBlock {
  id: string;
  /** 原文行区间 [start, end),用于原样复制 —— 绝不重新渲染。 */
  start: number;
  end: number;
  bytes: number;
  share: number;
  /** 给 Jev 看的一句话描述。 */
  label: string;
}

export interface ChunkResult {
  lines: string[];
  blocks: SnapshotBlock[];
  totalBytes: number;
  /** 非空 = 这份快照不该走选段,原因写在里面(会记进日志,便于回头看阈值定得对不对)。 */
  skip: string;
}

interface Line {
  raw: string;
  bytes: number;
  indent: number;
  isNode: boolean;
  role: string;
  name: string;
}

const parseLines = (yaml: string): Line[] =>
  yaml.split('\n').map((raw) => {
    const trimmed = raw.trim();
    return {
      raw,
      bytes: raw.length + 1,
      indent: raw.length - raw.trimStart().length,
      isNode: trimmed.startsWith('- '),
      role: (trimmed.match(/^-\s+([a-zA-Z][\w-]*)/) || [])[1] || '',
      name: (trimmed.match(/^-\s+[a-zA-Z][\w-]*\s+"((?:[^"\\]|\\.)*)"/) || [])[1] || ''
    };
  });

/** 一个节点的整棵子树 = 它自己 + 后面所有缩进更深的行。 */
const subtreeEnd = (lines: Line[], start: number): number => {
  let end = start + 1;
  while (end < lines.length && (!lines[end].isNode || lines[end].indent > lines[start].indent)) end++;
  return end;
};

const sumBytes = (lines: Line[], start: number, end: number): number =>
  lines.slice(start, end).reduce((total, line) => total + line.bytes, 0);

export const chunkSnapshot = (yaml: string): ChunkResult => {
  const lines = parseLines(yaml);
  const bodyStart = lines.findIndex((line) => line.isNode && line.indent === 0);
  if (bodyStart < 0) {
    return { lines: lines.map((line) => line.raw), blocks: [], totalBytes: 0, skip: 'no nodes' };
  }
  const totalBytes = sumBytes(lines, bodyStart, lines.length);

  // landmark:深度优先找**最外层**的,找到就不再往它里面找。
  const found: { start: number; end: number }[] = [];
  const scan = (from: number, to: number): void => {
    let cursor = from;
    while (cursor < to) {
      if (!lines[cursor].isNode) {
        cursor++;
        continue;
      }
      const end = subtreeEnd(lines, cursor);
      if (LANDMARKS.has(lines[cursor].role)) found.push({ start: cursor, end });
      else scan(cursor + 1, end); // 非 landmark 的容器往里找,它自己不成块
      cursor = end;
    }
  };
  scan(bodyStart, lines.length);
  const covered = found.reduce((total, block) => total + sumBytes(lines, block.start, block.end), 0);

  let ranges: { start: number; end: number }[];
  if (covered / totalBytes >= 0.5 && found.length >= MIN_BLOCKS) {
    // **切分,不是覆盖** —— landmark 之间的空隙必须各自成块,否则那些字节不在任何块里。
    const ordered = [...found].sort((a, b) => a.start - b.start);
    ranges = [];
    let cursor = bodyStart;
    for (const block of ordered) {
      if (block.start > cursor) ranges.push({ start: cursor, end: block.start });
      ranges.push(block);
      cursor = block.end;
    }
    if (cursor < lines.length) ranges.push({ start: cursor, end: lines.length });
    ranges = ranges.filter((range) => lines.slice(range.start, range.end).some((line) => line.isNode));
  } else {
    // 回落:顶层子树 + 相邻归并。
    const tops: { start: number; end: number }[] = [];
    let cursor = bodyStart;
    while (cursor < lines.length) {
      if (!lines[cursor].isNode) {
        cursor++;
        continue;
      }
      const end = subtreeEnd(lines, cursor);
      tops.push({ start: cursor, end });
      cursor = end;
    }
    ranges = [];
    for (const top of tops) {
      const size = sumBytes(lines, top.start, top.end);
      const last = ranges[ranges.length - 1];
      if (last && size / totalBytes < MIN_SHARE) last.end = top.end;
      else ranges.push({ ...top });
    }
  }

  const blocks: SnapshotBlock[] = ranges.map((range, index) => {
    const bytes = sumBytes(lines, range.start, range.end);
    const head = lines[range.start];
    const names = lines
      .slice(range.start, range.end)
      .filter((line) => line.name)
      .slice(0, 5)
      .map((line) => line.name);
    const title = head.name ? `${head.role} "${head.name}"` : head.role || 'section';
    return {
      id: `b${index + 1}`,
      start: range.start,
      end: range.end,
      bytes,
      share: bytes / totalBytes,
      label: `${title} — ${bytes} chars: ${names.join(' / ').slice(0, 180)}`
    };
  });

  const biggest = blocks.reduce((max, block) => (block.share > max ? block.share : max), 0);
  const saved = Math.round(totalBytes - biggest * totalBytes);
  const skip =
    totalBytes < MIN_SNAPSHOT_BYTES
      ? `snapshot ${totalBytes}B < ${MIN_SNAPSHOT_BYTES}B`
      : blocks.length < MIN_BLOCKS
        ? `blocks ${blocks.length} < ${MIN_BLOCKS}`
        : biggest > MAX_SHARE
          ? `biggest block ${(biggest * 100).toFixed(1)}% > ${MAX_SHARE * 100}%`
          : saved < MIN_SAVED_BYTES
            ? `would save ${saved}B < ${MIN_SAVED_BYTES}B`
            : '';

  return { lines: lines.map((line) => line.raw), blocks, totalBytes, skip };
};
