import { open, readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { AnydocError, anydocToMarkdown } from '@maestro-main/files/anydoc.service'
import { isArchivePath } from '@maestro-main/files/archive.service'
import { applyReadGate, splitLines } from '@maestro-main/files/readGate'

// Text/code stays pageable and line-numbered. Other supported documents are converted to
// Markdown by the staged anydoc CLI child process.

const MAX_BYTES = 25 * 1024 * 1024
/**
 * anydoc **转换阶段**的工作上限 —— 不是进上下文的闸。
 *
 * 进上下文的闸在 `readGate.applyReadGate()`(2000 行 ∧ 50KB,与 pi 内置 `read` 同口径)。
 * 这个常量以前兼着两个角色,而 120,000 **字符**对 base64 等于 72,541 token(2026-09-22 现场)——
 * 字符数根本约束不住 token。分开之后它只管"别让 anydoc 无限转下去"。
 */
const MAX_OUTPUT_CHARS = 120_000
/**
 * 进**缓存**的文档全文上限(不是单次进上下文的上限)。缓存必须存全文,否则 `read_file` 的
 * offset/limit 翻页永远到不了后面的内容。2M 字符只是个防炸内存的天花板。
 */
const DOC_CACHE_MAX_CHARS = 2_000_000
const SNIFF_BYTES = 8192

export interface ReadFileOptions {
  /** 1-based first line (default 1). */
  offset?: number
  /** Max lines to return; the 2000-line / 50KB gate still applies, whichever comes first. */
  limit?: number
  /**
   * 返回**未截断**的全文,给 `documentReader` 写缓存用。
   *
   * 默认(false)由 `applyReadGate()` 按 2000 行 ∧ 50KB 裁一次 —— 那是"单次能往上下文里塞多少"。
   * 缓存要的是另一件事:存全文,才能让 offset/limit 翻到后面的内容。
   */
  fullDocument?: boolean
}

export class FileReadError extends Error {
  constructor(
    message: string,
    readonly code: 'too-large' | 'unsupported' | 'empty' | 'parse-failed' | 'not-found'
  ) {
    super(message)
    this.name = 'FileReadError'
  }
}

const TEXT_EXTS = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'rst',
  'csv', 'tsv', 'json', 'json5', 'jsonc', 'ndjson',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties',
  'xml', 'html', 'htm', 'svg', 'css', 'scss', 'sass', 'less',
  'js', 'cjs', 'mjs', 'jsx', 'ts', 'cts', 'mts', 'tsx', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'php', 'pl', 'lua', 'r', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql', 'gql', 'proto',
  'gradle', 'dockerfile', 'makefile', 'gitignore', 'editorconfig'
])

const DOCUMENT_EXTS = new Set([
  'doc', 'docx', 'docm',
  'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb',
  'odt', 'ods', 'odp',
  'rtf',
  'epub',
  'pdf'
])

export const SUPPORTED_EXTS: string[] = [...Array.from(DOCUMENT_EXTS), ...Array.from(TEXT_EXTS)]

export const SUPPORTED_FORMATS_TEXT =
  'Word (.doc/.docx/.docm), PowerPoint (.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm), ' +
  'Excel (.xls/.xlsx/.xlsm/.xlsb), OpenDocument (.odt/.ods/.odp), RTF, EPUB, PDF, ' +
  'and text/code/csv/json/markdown/html'

const extOf = (path: string): string => {
  const ext = extname(path).replace(/^\./, '').toLowerCase()
  if (ext) return ext
  const base = path.split(/[\\/]/).pop()?.toLowerCase() || ''
  if (base === 'dockerfile' || base === 'makefile') return base
  return ''
}

/**
 * 1-based line numbers, tab-separated — the format coding agents are tuned to.
 *
 * **整份编号,不分页** —— 编号宽度按全文行数算,所以同一行在第 1 页和第 9 页拿到的是同一个号。
 * 分页与截断一律交给 `applyReadGate()`。
 */
const numberLines = (content: string): string => {
  const lines = splitLines(content)
  const width = String(lines.length).length
  return lines.map((line, index) => `${String(index + 1).padStart(width, ' ')}\t${line}`).join('\n')
}

const formatText = (content: string, path: string, options?: ReadFileOptions): string => {
  const numbered = numberLines(content)
  return options?.fullDocument ? numbered : applyReadGate(numbered, path, options).text
}

const readHead = async (path: string, length: number): Promise<Buffer | null> => {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}

const looksLikeText = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, SNIFF_BYTES)
  if (sample.length === 0 || sample.includes(0)) return false
  const text = sample.toString('utf8')
  if (text.includes('\uFFFD')) return false
  let printable = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13 || code >= 32) printable += 1
  }
  return printable / text.length > 0.9
}

const describeAnydocFailure = (error: unknown, ext: string): string => {
  if (!(error instanceof AnydocError)) {
    return `Failed to parse .${ext} file: ${error instanceof Error ? error.message : String(error)}`
  }
  if (error.code === 'needsOcr') {
    return `This .${ext} has no usable text layer and needs OCR before its text can be extracted.`
  }
  if (error.code === 'timeout' || error.code === 'unavailable') {
    return `${error.message} You can retry once; if it fails again the file is likely the cause.`
  }
  if (error.code === 'usage') {
    return `The bundled document converter rejected this .${ext} invocation.`
  }
  return `Failed to parse .${ext} file: ${error.message}`
}

export const readFileForAgent = async (
  absPath: string,
  options?: ReadFileOptions
): Promise<string> => {
  const stats = await stat(absPath).catch(() => null)
  if (!stats || !stats.isFile()) {
    throw new FileReadError(`File not found: ${absPath}`, 'not-found')
  }

  // Route archives before the context-sized file gate. They never enter the
  // prompt and have a separate attachment ceiling.
  if (isArchivePath(absPath)) {
    throw new FileReadError(
      `"${basename(absPath)}" is an archive, so there is no text to read directly. Use list_archive to see what is inside, ` +
        'then extract_archive to unpack it into the workspace and read the files that come out.',
      'unsupported'
    )
  }
  if (stats.size > MAX_BYTES) {
    throw new FileReadError(
      `File is ${(stats.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
      'too-large'
    )
  }
  if (stats.size === 0) throw new FileReadError('File is empty.', 'empty')

  const ext = extOf(absPath)
  if (DOCUMENT_EXTS.has(ext)) {
    try {
      // `options.fullDocument` 时不在这里截断:调用方(documentReader)要把**全文**存进缓存,
      // 然后按 offset/limit 翻页。在这里截掉等于把翻页焊死。
      const { text } = await anydocToMarkdown(absPath, {
        maxChars: options?.fullDocument ? DOC_CACHE_MAX_CHARS : MAX_OUTPUT_CHARS
      })
      if (!text.trim()) {
        throw new FileReadError(
          `Parsed .${ext} but it contained no extractable text.`,
          'empty'
        )
      }
      return options?.fullDocument ? text : applyReadGate(text, absPath, options).text
    } catch (err) {
      if (err instanceof FileReadError) throw err
      throw new FileReadError(
        describeAnydocFailure(err, ext),
        'parse-failed'
      )
    }
  }

  if (TEXT_EXTS.has(ext)) {
    try {
      return formatText(await readFile(absPath, 'utf8'), absPath, options)
    } catch (err) {
      throw new FileReadError(
        `Failed to read .${ext} as UTF-8 text: ${err instanceof Error ? err.message : String(err)}`,
        'parse-failed'
      )
    }
  }

  const head = await readHead(absPath, SNIFF_BYTES)
  if (head && looksLikeText(head)) return formatText(await readFile(absPath, 'utf8'), absPath, options)

  throw new FileReadError(
    `Unsupported file type ".${ext || '?'}". Supported: ${SUPPORTED_FORMATS_TEXT}.`,
    'unsupported'
  )
}
