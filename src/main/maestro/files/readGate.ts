/**
 * 单次 `read_file` 能进上下文的**唯一闸门** —— 文本路与文档路共用这一个函数。
 *
 * 口径逐字对齐 pi 内置 `read`(`@earendil-works/pi-coding-agent/dist/core/tools/truncate.js:10-12`
 * 与 `tools/read.js`):**2000 行 ∧ 50KB,先撞先赢,永不返回半行**。
 *
 * **为什么是字节,不是字符**(2026-09-22 现场,`overmind:areas/agent-runtime/chat/file-reading.html`):
 * 一份 150 行的 HTML,`limit: 2000` 毫无约束力 —— 它的最长两行是 64,435 和 51,595 字符的
 * base64 字体。旧的 120,000 **字符**闸对那份文件等于 **72,541 token**(整个窗口的 27%),
 * 而文档正文一个字都没进来。字节是唯一能同时约束 ASCII / CJK / base64 的单位:
 * 50KB 在三者上都落在 12–17k token。
 *
 * **为什么闸只有一个函数**:同一个工具两套闸门就是 2026-09-22 那次事故的形状
 * (pi 的 `read` 50KB 双闸 vs 宿主 `read_file` 120k 字符单闸,模型挑哪个取决于文件要不要转换)。
 * 文本路与文档路都从这里出去,那个形状就长不回来。
 *
 * 契约:`docs/features/maestro-large-file-chunked-read.md` #1 #2。
 */

/** 与 pi `DEFAULT_MAX_LINES` 同值。 */
export const MAX_READ_LINES = 2000
/** 与 pi `DEFAULT_MAX_BYTES` 同值。 */
export const MAX_READ_BYTES = 50 * 1024

export interface ReadWindow {
  /** 1 起的首行。 */
  offset?: number
  /** 调用方要的行数。闸仍然生效 —— 两者取先到的那个。 */
  limit?: number
}

export interface ReadGateResult {
  text: string
  /** 还有没给出去的内容。 */
  truncated: boolean
  /** 下一次该从哪一行接上;没截断时 undefined。 */
  nextOffset?: number
}

/** 人读的字节数。与 pi `formatSize` 同形。 */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`

/**
 * 切行。**末尾那个因结尾换行产生的空元素要去掉** —— 否则 `of N` 会永远比真实行数多 1,
 * 而最后一页会多出一个空行。去掉它不会改变任何一行的编号,只让计数诚实。
 */
export const splitLines = (content: string): string[] => {
  const lines = content.split(/\r?\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * 把全文按窗口 + 双闸裁成一次能给模型的量,并在截断时**给出坐标与下一步**。
 *
 * 三种返回:
 *  · 正常截断 → 正文 + `…[PARTIAL: lines a-b of N …offset=b+1…]`;
 *  · 首行本身就超字节闸 → **不返回内容**,改给 `Use bash: sed -n 'Np' <path> | head -c …`
 *    (pi `tools/read.js` 的同款)。那一行几乎必然是 base64 或 minified 产物,
 *    读进来的 token 价值为零,而这句话直接把模型送上它最终自己会找到的那条路;
 *  · offset 越界 → 一句说明,不报错。
 */
export const applyReadGate = (content: string, path: string, window?: ReadWindow): ReadGateResult => {
  const lines = splitLines(content)
  const total = lines.length
  const start = Math.max(1, Math.floor(window?.offset || 1))
  if (start > total) {
    return { text: `(file has ${total} lines; offset ${start} is past the end)`, truncated: false }
  }

  const askedLimit = window?.limit ? Math.max(1, Math.floor(window.limit)) : 0
  const hardEnd = askedLimit ? Math.min(total, start - 1 + askedLimit) : total

  let bytes = 0
  let end = start - 1
  let stoppedBy: 'bytes' | 'lines' | null = null
  for (let i = start; i <= hardEnd; i += 1) {
    if (end - start + 1 >= MAX_READ_LINES) {
      stoppedBy = 'lines'
      break
    }
    // +1 = 行分隔符。按**渲染后**的字节算 —— 进上下文的就是这些字节。
    const cost = byteLength(lines[i - 1]) + 1
    if (bytes + cost > MAX_READ_BYTES) {
      stoppedBy = 'bytes'
      break
    }
    bytes += cost
    end = i
  }

  if (end < start) {
    const size = formatSize(byteLength(lines[start - 1]))
    return {
      text:
        `[Line ${start} is ${size}, exceeds ${formatSize(MAX_READ_BYTES)} limit. ` +
        `Use bash: sed -n '${start}p' ${path} | head -c ${MAX_READ_BYTES}]`,
      truncated: true,
      nextOffset: start + 1
    }
  }

  const body = lines.slice(start - 1, end).join('\n')
  if (end >= total) return { text: body, truncated: false }

  const reason =
    stoppedBy === 'bytes'
      ? ` (${formatSize(MAX_READ_BYTES)} limit)`
      : stoppedBy === 'lines'
        ? ` (${MAX_READ_LINES}-line limit)`
        : ''
  // 只写 "truncated" 的话,模型会拿一部分内容写一份读起来很完整的总结 —— 那比报错糟糕得多
  // (2026-09-02 现场:493k 字符的 docx 只读到 24%,总结却毫无保留)。所以三件事都要写进去:
  // 读到哪、怎么接着读、不许据此总结。
  return {
    text:
      `${body}\n\n` +
      `…[PARTIAL: lines ${start}-${end} of ${total}${reason}. The REST IS AVAILABLE — ` +
      `call read_file again with offset=${end + 1} to continue. ` +
      `Do NOT summarise from this fragment alone; either page through it or say which part you read.]`,
    truncated: true,
    nextOffset: end + 1
  }
}
