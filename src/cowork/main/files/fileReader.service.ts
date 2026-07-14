import { readFile, stat } from 'fs/promises'
import { extname } from 'path'

// Parses a local file into AI-friendly TEXT for the agent's read_file tool.
// Conventions mirror mature coding agents (Claude Code / Codex / opencode):
//   - text/code → 1-based line numbers (cat -n style) with offset/limit paging,
//   - PDF → page-delimited extracted text,
//   - Excel → one markdown table per sheet,
//   - docx → raw paragraph text,
// and every cap appends an explicit truncation marker so the model knows it did
// not see everything. Parsers (unpdf / exceljs / mammoth) are pure-JS and bundled.

const MAX_BYTES = 25 * 1024 * 1024 // refuse files larger than this
const MAX_OUTPUT_CHARS = 120_000 // bound the tokens a single read can inject
const DEFAULT_TEXT_LINES = 2000 // text page size when no limit is given (Read-tool parity)
const MAX_PDF_PAGES = 100
const MAX_SHEETS = 20
const MAX_ROWS_PER_SHEET = 2000
const MAX_COLS = 60

export interface ReadFileOptions {
  /** 1-based first line for text files (default 1). Ignored for pdf/excel/docx. */
  offset?: number
  /** Max lines for text files (default 2000). Ignored for pdf/excel/docx. */
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

// Read-as-plain-text extensions (UTF-8). HTML/markdown ride through as-is — an LLM
// reads tags fine, and stripping risks losing structure.
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

export const SUPPORTED_EXTS: string[] = [
  'pdf', 'xlsx', 'xlsm', 'docx', ...Array.from(TEXT_EXTS)
]

const extOf = (path: string): string => {
  const ext = extname(path).replace(/^\./, '').toLowerCase()
  if (ext) return ext
  // Extension-less, well-known filenames (Dockerfile, Makefile) → treat as text.
  const base = path.split(/[\\/]/).pop()?.toLowerCase() || ''
  if (base === 'dockerfile' || base === 'makefile') return base
  return ''
}

const clampChars = (text: string): string =>
  text.length <= MAX_OUTPUT_CHARS
    ? text
    : text.slice(0, MAX_OUTPUT_CHARS) + `\n\n…[truncated: output exceeded ${MAX_OUTPUT_CHARS} characters]`

// 1-based line numbers, tab-separated, paged by offset/limit — the format coding
// agents are tuned to (lets the model cite/anchor by line).
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
    .map((line, i) => `${String(start + i).padStart(width, ' ')}\t${line}`)
    .join('\n')
  const more = end < total ? `\n\n…[truncated: showing lines ${start}-${end} of ${total}; pass offset/limit for more]` : ''
  return clampChars(body + more)
}

const parsePdf = async (buffer: Buffer): Promise<string> => {
  // unpdf is ESM-only; the main bundle is CJS, so load it lazily via import()
  // (same pattern BaseAgent uses for pi-coding-agent). Keeps it off the cold path.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.slice(0, MAX_PDF_PAGES)
  const parts = pages.map((page, i) => `----- Page ${i + 1}/${totalPages} -----\n${(page || '').trim()}`)
  if (totalPages > MAX_PDF_PAGES) parts.push(`…[truncated: ${totalPages - MAX_PDF_PAGES} more pages not shown]`)
  return clampChars(parts.join('\n\n'))
}

const escapeCell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()

const parseExcel = async (buffer: Buffer): Promise<string> => {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  // Cast across the @types/node Buffer skew between this file and exceljs's bundled types.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const out: string[] = []
  let sheetCount = 0
  wb.eachSheet((ws) => {
    if (sheetCount >= MAX_SHEETS) return
    sheetCount += 1
    const rowCount = Math.min(ws.rowCount, MAX_ROWS_PER_SHEET)
    const colCount = Math.min(ws.columnCount, MAX_COLS)
    out.push(`## Sheet: ${ws.name} (${ws.rowCount} rows × ${ws.columnCount} cols)`)
    if (rowCount === 0 || colCount === 0) {
      out.push('(empty)')
      return
    }
    const renderRow = (r: number): string => {
      const cells: string[] = []
      for (let c = 1; c <= colCount; c += 1) cells.push(escapeCell(String(ws.getRow(r).getCell(c).text ?? '')))
      return `| ${cells.join(' | ')} |`
    }
    out.push(renderRow(1)) // row 1 as header
    out.push(`| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`)
    for (let r = 2; r <= rowCount; r += 1) out.push(renderRow(r))
    if (ws.rowCount > MAX_ROWS_PER_SHEET) out.push(`…[truncated: ${ws.rowCount - MAX_ROWS_PER_SHEET} more rows]`)
    if (ws.columnCount > MAX_COLS) out.push(`…[truncated: ${ws.columnCount - MAX_COLS} more columns]`)
  })
  if (wb.worksheets.length > MAX_SHEETS) out.push(`…[truncated: ${wb.worksheets.length - MAX_SHEETS} more sheets]`)
  return clampChars(out.join('\n'))
}

const parseDocx = async (buffer: Buffer): Promise<string> => {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer } as unknown as Parameters<typeof mammoth.extractRawText>[0])
  return clampChars(value || '')
}

/**
 * Read & parse a local file into text for the agent. Throws FileReadError on
 * size/type/parse problems — the caller (read_file tool) turns that into a text
 * error for the model rather than throwing the turn.
 */
export const readFileForAgent = async (absPath: string, options?: ReadFileOptions): Promise<string> => {
  const stats = await stat(absPath).catch(() => null)
  if (!stats || !stats.isFile()) throw new FileReadError(`File not found: ${absPath}`, 'not-found')
  if (stats.size > MAX_BYTES) {
    throw new FileReadError(`File is ${(stats.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`, 'too-large')
  }
  if (stats.size === 0) throw new FileReadError('File is empty.', 'empty')

  const ext = extOf(absPath)
  try {
    if (ext === 'pdf') return await parsePdf(await readFile(absPath))
    if (ext === 'xlsx' || ext === 'xlsm') return await parseExcel(await readFile(absPath))
    if (ext === 'docx') return await parseDocx(await readFile(absPath))
    if (TEXT_EXTS.has(ext)) return formatText(await readFile(absPath, 'utf8'), options)
  } catch (err) {
    if (err instanceof FileReadError) throw err
    throw new FileReadError(`Failed to parse .${ext || '?'} file: ${err instanceof Error ? err.message : String(err)}`, 'parse-failed')
  }
  throw new FileReadError(
    `Unsupported file type ".${ext || '?'}". Supported: PDF, Excel (xlsx/xlsm), Word (docx), and text/code/csv/json/markdown/html.`,
    'unsupported'
  )
}
