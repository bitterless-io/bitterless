import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'fs'
import { Workbook } from 'exceljs'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

export type ArtifactKind = 'xlsx' | 'docx' | 'pdf' | 'html' | 'txt' | 'md' | 'json'

export interface ArtifactWriteRequest {
  userDataPath: string
  sessionKey: string
  workspaceRoot?: string
  artifactJson: string
}

export interface ArtifactWriteResult {
  ok: boolean
  action?: 'created' | 'updated'
  path?: string
  root?: string
  name?: string
  type?: ArtifactKind
  size?: number
  error?: string
}

interface ArtifactPayload {
  type?: string
  kind?: string
  filename?: string
  title?: string
  text?: string
  markdown?: string
  html?: string
  content?: unknown
  sheets?: SheetPayload[]
  rows?: unknown[]
  columns?: string[]
  sections?: SectionPayload[]
}

interface SheetPayload {
  name?: string
  rows?: unknown[]
  columns?: string[]
}

interface SectionPayload {
  heading?: string
  title?: string
  text?: string
  paragraphs?: string[]
  bullets?: string[]
  table?: TablePayload
}

interface TablePayload {
  columns?: string[]
  rows?: unknown[]
}

interface ResolvedArtifactTarget {
  root: string
  path: string
  rel: string
  type: ArtifactKind
}

const ARTIFACT_EXTENSIONS: Record<ArtifactKind, string> = {
  xlsx: '.xlsx',
  docx: '.docx',
  pdf: '.pdf',
  html: '.html',
  txt: '.txt',
  md: '.md',
  json: '.json'
}

const TEXT_TYPES = new Set<ArtifactKind>(['html', 'txt', 'md', 'json'])

export const writeArtifactFromJson = async (request: ArtifactWriteRequest): Promise<ArtifactWriteResult> => {
  let payload: ArtifactPayload
  try {
    payload = JSON.parse(request.artifactJson || '{}') as ArtifactPayload
  } catch {
    return { ok: false, error: 'artifact_json is not valid JSON.' }
  }

  const type = normalizeArtifactKind(payload.type || payload.kind || payload.filename)
  if (!type) return { ok: false, error: 'artifact_json.type must be one of: xlsx, docx, pdf, html, txt, md, json.' }

  const target = resolveArtifactTarget({
    type,
    filename: payload.filename,
    title: payload.title,
    userDataPath: request.userDataPath,
    sessionKey: request.sessionKey,
    workspaceRoot: request.workspaceRoot
  })
  if (!target.ok) return { ok: false, error: target.error }

  try {
    const parent = dirname(target.path)
    const existed = existsSync(target.path)
    if (existsSync(target.path) && statSync(target.path).isDirectory()) return { ok: false, error: `"${target.rel}" is a directory.` }
    mkdirSync(parent, { recursive: true })

    if (TEXT_TYPES.has(type)) {
      writeFileSync(target.path, renderTextPayload(payload, type), 'utf8')
    } else if (type === 'xlsx') {
      const workbookBuffer = await buildWorkbookBuffer(payload)
      writeFileSync(target.path, workbookBuffer)
    } else if (type === 'docx') {
      const docxBuffer = await buildDocxBuffer(payload)
      writeFileSync(target.path, docxBuffer)
    } else if (type === 'pdf') {
      const html = payload.html || renderHtmlDocument(payload)
      const pdfBuffer = await renderPdfBuffer(html)
      writeFileSync(target.path, pdfBuffer)
    }

    const stats = statSync(target.path)
    return {
      ok: true,
      action: existed ? 'updated' : 'created',
      path: target.path,
      root: target.root,
      name: basename(target.path),
      type,
      size: stats.size
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const normalizeArtifactKind = (value: unknown): ArtifactKind | null => {
  const raw = String(value || '').trim().toLowerCase()
  const ext = raw.startsWith('.') ? raw : extname(raw).toLowerCase()
  const candidate = raw && !ext ? raw : ext.replace(/^\./, '')
  if (candidate === 'excel') return 'xlsx'
  if (candidate === 'word' || candidate === 'doc') return 'docx'
  if (candidate === 'markdown') return 'md'
  return Object.prototype.hasOwnProperty.call(ARTIFACT_EXTENSIONS, candidate) ? (candidate as ArtifactKind) : null
}

const resolveArtifactTarget = (params: {
  type: ArtifactKind
  filename?: string
  title?: string
  userDataPath: string
  sessionKey: string
  workspaceRoot?: string
}): { ok: true } & ResolvedArtifactTarget | { ok: false; error: string } => {
  const workspaceRoot = params.workspaceRoot ? resolve(params.workspaceRoot) : ''
  const root = workspaceRoot || join(params.userDataPath, 'artifacts', sanitizePathSegment(params.sessionKey || 'default'))
  const ext = ARTIFACT_EXTENSIONS[params.type]
  const filename = normalizeArtifactFilename(params.filename, params.title, params.type)
  if (!workspaceRoot && isAbsolute(filename)) return { ok: false, error: 'absolute artifact filenames require a selected workspace.' }
  const target = isAbsolute(filename) ? resolve(filename) : resolve(root, filename)
  const withExt = normalizeTargetExtension(target, ext)
  if (!isInsideRoot(root, withExt)) return { ok: false, error: 'artifact path is outside the allowed output root.' }
  if (withExt === root) return { ok: false, error: 'artifact path must be a file, not the output root.' }

  try {
    if (workspaceRoot) {
      if (!statSync(root).isDirectory()) return { ok: false, error: 'selected workspace is not a directory.' }
    } else {
      mkdirSync(root, { recursive: true })
    }
  } catch {
    return { ok: false, error: workspaceRoot ? 'selected workspace is unavailable.' : 'could not create artifact output root.' }
  }

  const existing = nearestExistingAncestor(withExt)
  try {
    const realRoot = realpathSync(root)
    const realExisting = realpathSync(existing)
    if (!isInsideRoot(realRoot, realExisting)) return { ok: false, error: 'artifact path resolves outside the output root.' }
  } catch {
    return { ok: false, error: 'artifact output root is unavailable.' }
  }

  return { ok: true, root, path: withExt, rel: relative(root, withExt) || basename(withExt), type: params.type }
}

const normalizeArtifactFilename = (filename: string | undefined, title: string | undefined, type: ArtifactKind): string => {
  const raw = String(filename || '').trim().replace(/^@/, '')
  if (raw) return raw
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const titlePart = sanitizePathSegment(title || 'artifact')
  return join('artifacts', `${stamp}-${titlePart || randomUUID().slice(0, 8)}${ARTIFACT_EXTENSIONS[type]}`)
}

const normalizeTargetExtension = (target: string, expectedExt: string): string => {
  const actualExt = extname(target)
  if (!actualExt) return target + expectedExt
  if (actualExt.toLowerCase() === expectedExt) return target
  return target.slice(0, -actualExt.length) + expectedExt
}

const sanitizePathSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact'

const nearestExistingAncestor = (target: string): string => {
  let current = target
  for (;;) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

const isInsideRoot = (root: string, target: string): boolean => {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

const renderTextPayload = (payload: ArtifactPayload, type: ArtifactKind): string => {
  if (type === 'html') return payload.html || renderHtmlDocument(payload)
  if (type === 'json') return JSON.stringify(payload.content ?? payload, null, 2)
  if (type === 'md') return payload.markdown || payload.text || renderMarkdownDocument(payload)
  return payload.text || payload.markdown || (typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content ?? payload, null, 2))
}

const buildWorkbookBuffer = async (payload: ArtifactPayload): Promise<Buffer> => {
  const workbook = new Workbook()
  workbook.creator = 'Bitterless Maestro'
  workbook.created = new Date()
  const sheets = normalizeSheets(payload)
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name || 'Sheet')
    const rows = sheet.rows || []
    const columns = sheet.columns && sheet.columns.length ? sheet.columns : inferObjectColumns(rows)
    if (columns.length > 0) {
      worksheet.addRow(columns)
      for (const row of rows) {
        if (isRecord(row)) worksheet.addRow(columns.map((key) => cellValue(row[key])))
        else if (Array.isArray(row)) worksheet.addRow(row.map(cellValue))
        else worksheet.addRow([cellValue(row)])
      }
      worksheet.getRow(1).font = { bold: true }
      columns.forEach((_column, index) => {
        const col = worksheet.getColumn(index + 1)
        col.width = Math.max(12, Math.min(42, String(columns[index]).length + 8))
      })
    } else {
      for (const row of rows) worksheet.addRow(Array.isArray(row) ? row.map(cellValue) : [cellValue(row)])
    }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

const normalizeSheets = (payload: ArtifactPayload): SheetPayload[] => {
  if (Array.isArray(payload.sheets) && payload.sheets.length > 0) {
    return payload.sheets.map((sheet, index) => ({
      name: sanitizeWorksheetName(sheet.name || (index === 0 ? payload.title || 'Sheet 1' : `Sheet ${index + 1}`)),
      columns: Array.isArray(sheet.columns) ? sheet.columns.map(String) : undefined,
      rows: Array.isArray(sheet.rows) ? sheet.rows : []
    }))
  }
  return [
    {
      name: sanitizeWorksheetName(payload.title || 'Sheet 1'),
      columns: Array.isArray(payload.columns) ? payload.columns.map(String) : undefined,
      rows: Array.isArray(payload.rows) ? payload.rows : []
    }
  ]
}

const sanitizeWorksheetName = (name: string): string => name.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Sheet'

const inferObjectColumns = (rows: unknown[]): string[] => {
  const columns: string[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

const buildDocxBuffer = async (payload: ArtifactPayload): Promise<Buffer> => {
  const children = buildDocxChildren(payload)
  const document = new Document({
    sections: [
      {
        properties: {},
        children: children.length ? children : [new Paragraph('')]
      }
    ]
  })
  return await Packer.toBuffer(document)
}

const buildDocxChildren = (payload: ArtifactPayload): Array<Paragraph | Table> => {
  const children: Array<Paragraph | Table> = []
  if (payload.title) {
    children.push(new Paragraph({ text: payload.title, heading: HeadingLevel.HEADING_1 }))
  }
  for (const line of splitParagraphs(payload.markdown || payload.text || (typeof payload.content === 'string' ? payload.content : ''))) {
    children.push(new Paragraph({ children: [new TextRun(line)] }))
  }
  for (const section of payload.sections || []) {
    const heading = section.heading || section.title
    if (heading) children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }))
    for (const line of splitParagraphs(section.text || '')) children.push(new Paragraph({ children: [new TextRun(line)] }))
    for (const line of section.paragraphs || []) children.push(new Paragraph({ children: [new TextRun(String(line))] }))
    for (const bullet of section.bullets || []) children.push(new Paragraph({ text: String(bullet), bullet: { level: 0 } }))
    if (section.table) children.push(buildDocxTable(section.table))
  }
  return children
}

const buildDocxTable = (table: TablePayload): Table => {
  const rows = table.rows || []
  const columns = table.columns && table.columns.length ? table.columns.map(String) : inferObjectColumns(rows)
  const tableRows: TableRow[] = []
  if (columns.length) {
    tableRows.push(new TableRow({ children: columns.map((key) => buildDocxCell(key, true)) }))
    for (const row of rows) {
      const values = isRecord(row) ? columns.map((key) => row[key]) : Array.isArray(row) ? row : [row]
      tableRows.push(new TableRow({ children: values.map((value) => buildDocxCell(cellValue(value))) }))
    }
  } else {
    for (const row of rows) {
      const values = Array.isArray(row) ? row : [row]
      tableRows.push(new TableRow({ children: values.map((value) => buildDocxCell(cellValue(value))) }))
    }
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows.length ? tableRows : [new TableRow({ children: [buildDocxCell('')] })]
  })
}

const buildDocxCell = (value: string, bold = false): TableCell =>
  new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: value, bold })] })]
  })

const renderPdfBuffer = async (html: string): Promise<Buffer> => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: `coach-pdf-${randomUUID()}`,
      sandbox: true,
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ftp://*/*'] },
      (_details, callback) => callback({ cancel: true })
    )
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ensureHtmlDocument(html)))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
    return Buffer.from(pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const renderHtmlDocument = (payload: ArtifactPayload): string => {
  const body: string[] = []
  if (payload.title) body.push(`<h1>${escapeHtml(payload.title)}</h1>`)
  for (const line of splitParagraphs(payload.markdown || payload.text || (typeof payload.content === 'string' ? payload.content : ''))) {
    body.push(`<p>${escapeHtml(line)}</p>`)
  }
  for (const section of payload.sections || []) {
    const heading = section.heading || section.title
    if (heading) body.push(`<h2>${escapeHtml(heading)}</h2>`)
    for (const line of splitParagraphs(section.text || '')) body.push(`<p>${escapeHtml(line)}</p>`)
    for (const line of section.paragraphs || []) body.push(`<p>${escapeHtml(String(line))}</p>`)
    if (section.bullets?.length) body.push(`<ul>${section.bullets.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`)
    if (section.table) body.push(renderHtmlTable(section.table))
  }
  return ensureHtmlDocument(body.join('\n') || '<p></p>')
}

const renderMarkdownDocument = (payload: ArtifactPayload): string => {
  const lines: string[] = []
  if (payload.title) lines.push(`# ${payload.title}`, '')
  if (payload.text || payload.markdown) lines.push(payload.markdown || payload.text || '', '')
  for (const section of payload.sections || []) {
    const heading = section.heading || section.title
    if (heading) lines.push(`## ${heading}`, '')
    if (section.text) lines.push(section.text, '')
    for (const paragraph of section.paragraphs || []) lines.push(String(paragraph), '')
    for (const bullet of section.bullets || []) lines.push(`- ${bullet}`)
    if (section.bullets?.length) lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

const renderHtmlTable = (table: TablePayload): string => {
  const rows = table.rows || []
  const columns = table.columns && table.columns.length ? table.columns.map(String) : inferObjectColumns(rows)
  const head = columns.length ? `<thead><tr>${columns.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>` : ''
  const body = rows
    .map((row) => {
      const values = isRecord(row) && columns.length ? columns.map((key) => row[key]) : Array.isArray(row) ? row : [row]
      return `<tr>${values.map((value) => `<td>${escapeHtml(cellValue(value))}</td>`).join('')}</tr>`
    })
    .join('')
  return `<table>${head}<tbody>${body}</tbody></table>`
}

const ensureHtmlDocument = (html: string): string => {
  if (/<html[\s>]/i.test(html)) return html
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 40px; line-height: 1.5; }
    h1 { font-size: 28px; margin: 0 0 20px; }
    h2 { font-size: 18px; margin: 28px 0 10px; }
    p { margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0 22px; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; }
  </style>
</head>
<body>${html}</body>
</html>`
}

const splitParagraphs = (text: string): string[] =>
  String(text || '')
    .split(/\n{2,}|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const cellValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const escapeHtml = (value: string): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
