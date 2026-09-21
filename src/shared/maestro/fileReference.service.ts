/**
 * 聊天正文里的「文件:行号」引用 —— **maestro 树自己的那一份**。
 *
 * 为什么是一份副本而不是 import `@shared/onlypreview/onlyPreviewLine.shared`:
 * `check:maestro` 的别名边界禁止 maestro 树引用宿主的 `@shared/onlypreview/*`
 * (`scripts/maestro/_harness.mjs` 的 `assertMaestroAliasBoundary`)。那条边界正是为了不让
 * 整棵 onlypreview 子树被拖进 maestro 的打包里,所以这里照它的规矩走:
 * **判断「哪一段文本是一个文件引用」是纯函数,复制它不会把任何宿主实现带过来。**
 *
 * 「打开」不复制 —— 那一步走已有的 `MaestroPreviewOpener` 端口(`previewOpener.api.ts`),
 * maestro 至今不知道宿主的预览应用是谁。
 */

/** Monaco 的行号从 1 开始;这里同样是 1-based。 */
export const normalizeOnlyPreviewLine = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const line = typeof value === 'number' ? value : Number(String(value).trim())
  // 非整数、0、负数、NaN、Infinity 一律当作没给 —— 不抛错,因为「行号不对」不该让文件打不开。
  if (!Number.isSafeInteger(line) || line < 1) return undefined
  return line
}

/**
 * 行号超出文件实际行数时,同样当作没给。
 *
 * **不钳到最后一行**:跳到末行会让人以为那就是目标,而这里的真相是「这个行号在这个文件里不存在」。
 * 安静地不跳,比跳到一个错的地方好 —— 后者没有任何提示说它是错的。
 */
export const lineWithinDocument = (line: number | undefined, totalLines: number): number | undefined =>
  line !== undefined && totalLines > 0 && line <= totalLines ? line : undefined

/**
 * 聊天正文里的「文件:行号」引用。
 *
 * 只认**绝对路径**,而且必须带一个已知的文本/源码扩展名 —— 这两条是为了不误伤普通句子。
 * 中文正文里「见第 3 章:12 页」这类写法不该被当成文件引用,而 `/Users/…/http.ts:340` 必须被认出来。
 *
 * 行号部分可选:`/abs/path/file.ts` 本身也是一个合法引用(打开,不跳行)。
 */
const TEXTUAL_EXTENSIONS =
  'ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|json|jsonc|md|markdown|txt|log|yml|yaml|toml|ini|conf|css|less|scss|html|htm|xml|svg|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sql|env'

/**
 * 前面必须是行首、空白或常见标点。
 *
 * 少了这条,`src/http.ts:340` 这种**相对**路径会从中间的 `/` 开始匹配成 `/http.ts:340` ——
 * 一个不存在的绝对路径。引用必须是整段的,不能是从别人身体里切出来的一段。
 */
const REFERENCE_SOURCE =
  `(?:^|(?<=[\\s(\\[{"'\`，。、；;]))(/(?:[^\\s:*?"<>|]+/)*[^\\s:*?"<>|]+\\.(?:${TEXTUAL_EXTENSIONS}))(?::(\\d{1,7}))?(?![\\w/])`

export const ONLY_PREVIEW_REFERENCE_PATTERN = new RegExp(REFERENCE_SOURCE, 'g')

export interface OnlyPreviewReference {
  path: string
  line?: number
  /** 原文里的起止位置,渲染层用它切分文本。 */
  start: number
  end: number
}

/**
 * 正文里**不能改写**的区段:围栏代码块、行内代码、已有的 Markdown 链接。
 *
 * 代码块尤其重要 —— `quick_scan` / `code_review` 的输出里成片都是代码,把里面的路径改写成链接会
 * 直接改掉代码本身的字面内容。行内代码同理:人写 `` `src/a.ts` `` 是在**引用一个名字**,不是要个按钮。
 * 已有链接则是避免把 `[x](/a/b.ts)` 的 href 再包一层。
 */
const PROTECTED_SPANS = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\[[^\]]*\]\([^)]*\)/g

const protectedRanges = (text: string): Array<[number, number]> => {
  const ranges: Array<[number, number]> = []
  for (const match of text.matchAll(PROTECTED_SPANS)) {
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

/**
 * 把正文里的 `绝对路径[:行号]` 改写成 Markdown 链接,href 用**自有 scheme**。
 *
 * 用自有 scheme 而不是 `file://`:聊天里原本就有一类本地文件链接(产出物那类),**单击**是「在 Finder 里定位」。
 * 这里新加的引用要求的是**双击**(Ral 指定),两者必须能在同一个事件处理里区分开 —— 靠 href 区分
 * 最稳,不依赖 DOM 结构或渲染库的版本。
 */
export const ONLY_PREVIEW_REFERENCE_SCHEME = 'onlypreview-ref:'

export const onlyPreviewReferenceHref = (path: string, line?: number): string =>
  `${ONLY_PREVIEW_REFERENCE_SCHEME}${encodeURIComponent(path)}${line ? `?line=${line}` : ''}`

export const parseOnlyPreviewReferenceHref = (
  href: string
): { path: string; line?: number } | null => {
  if (!href.startsWith(ONLY_PREVIEW_REFERENCE_SCHEME)) return null
  const rest = href.slice(ONLY_PREVIEW_REFERENCE_SCHEME.length)
  const [encoded, query] = rest.split('?')
  if (!encoded) return null
  try {
    return {
      path: decodeURIComponent(encoded),
      line: normalizeOnlyPreviewLine(query?.startsWith('line=') ? query.slice(5) : undefined)
    }
  } catch {
    // `decodeURIComponent` 对畸形转义会抛 —— 那就当作不是一个引用,别让一条链接毁掉整条消息。
    return null
  }
}

export const linkifyOnlyPreviewReferences = (text: string): string => {
  if (!text) return text
  const skip = protectedRanges(text)
  const references = findOnlyPreviewReferences(text)
    .filter(reference => !skip.some(([from, to]) => reference.start < to && reference.end > from))
  if (!references.length) return text
  let out = ''
  let cursor = 0
  for (const reference of references) {
    const label = text.slice(reference.start, reference.end)
    out += text.slice(cursor, reference.start)
    out += `[${label}](${onlyPreviewReferenceHref(reference.path, reference.line)})`
    cursor = reference.end
  }
  return out + text.slice(cursor)
}

/** 从一段正文里找出所有文件引用。顺序与出现顺序一致,互不重叠。 */
export const findOnlyPreviewReferences = (text: string): OnlyPreviewReference[] => {
  if (!text) return []
  const found: OnlyPreviewReference[] = []
  // 每次新建正则:`g` 标志带 `lastIndex` 状态,共用一个实例会让并发调用互相干扰。
  const pattern = new RegExp(REFERENCE_SOURCE, 'g')
  for (const match of text.matchAll(pattern)) {
    const path = match[1]
    if (!path) continue
    const width = path.length + (match[2] ? match[2].length + 1 : 0)
    const start = match.index + match[0].length - width
    found.push({
      path,
      line: normalizeOnlyPreviewLine(match[2]),
      start,
      end: start + width
    })
  }
  return found
}
