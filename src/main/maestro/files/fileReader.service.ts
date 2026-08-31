import { open, readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { AnydocError, anydocToMarkdown } from '@maestro-main/files/anydoc.service'
import { isArchivePath } from '@maestro-main/files/archive.service'

// Text/code stays pageable and line-numbered. Other supported documents are converted to
// Markdown by the staged anydoc CLI child process.

const MAX_BYTES = 25 * 1024 * 1024
const MAX_OUTPUT_CHARS = 120_000
const SNIFF_BYTES = 8192
const DEFAULT_TEXT_LINES = 2000

export interface ReadFileOptions {
  /** 1-based first line for text files (default 1). Ignored for documents. */
  offset?: number
  /** Max lines for text files (default 2000). Ignored for documents. */
  limit?: number
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

const clampChars = (text: string): string =>
  text.length <= MAX_OUTPUT_CHARS
    ? text
    : text.slice(0, MAX_OUTPUT_CHARS) + `\n\n…[truncated: output exceeded ${MAX_OUTPUT_CHARS} characters]`

const formatText = (content: string, options?: ReadFileOptions): string => {
  const lines = content.split(/\r?\n/)
  const total = lines.length
  const start = Math.max(1, Math.floor(options?.offset || 1))
  const limit = Math.max(1, Math.floor(options?.limit || DEFAULT_TEXT_LINES))
  const end = Math.min(total, start - 1 + limit)
  if (start > total) return `(file has ${total} lines; offset ${start} is past the end)`
  const width = String(end).length
  const body = lines
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(width, ' ')}\t${line}`)
    .join('\n')
  const more = end < total
    ? `\n\n…[truncated: showing lines ${start}-${end} of ${total}; pass offset/limit for more]`
    : ''
  return clampChars(body + more)
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
      const { text } = await anydocToMarkdown(absPath, { maxChars: MAX_OUTPUT_CHARS })
      if (!text.trim()) {
        throw new FileReadError(
          `Parsed .${ext} but it contained no extractable text.`,
          'empty'
        )
      }
      return text
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
      return formatText(await readFile(absPath, 'utf8'), options)
    } catch (err) {
      throw new FileReadError(
        `Failed to read .${ext} as UTF-8 text: ${err instanceof Error ? err.message : String(err)}`,
        'parse-failed'
      )
    }
  }

  const head = await readHead(absPath, SNIFF_BYTES)
  if (head && looksLikeText(head)) return formatText(await readFile(absPath, 'utf8'), options)

  throw new FileReadError(
    `Unsupported file type ".${ext || '?'}". Supported: ${SUPPORTED_FORMATS_TEXT}.`,
    'unsupported'
  )
}
