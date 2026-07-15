import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const moduleCache = new Map()

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@maestro-main/')) return join(root, 'main', 'maestro', `${specifier.slice('@maestro-main/'.length)}.ts`)
  if (specifier.startsWith('@maestro-shared/')) return join(root, 'shared', 'maestro', `${specifier.slice('@maestro-shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  const file = resolveTsModule(specifier, parentDir)
  if (!file) return require(specifier)
  if (moduleCache.has(file)) return moduleCache.get(file).exports

  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const source = readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: file
  }).outputText
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: file }
  )
  wrapped(
    mod.exports,
    (childSpecifier) => loadTsModule(childSpecifier, dirname(file)),
    mod,
    file,
    dirname(file)
  )
  return mod.exports
}

const writeMinimalPdf = (file, text) => {
  const objects = []
  const push = (body) => objects.push(body)
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${text}) Tj\nET\n`
  push(`4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`)
  push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body))
    body += object
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(file, body)
}

const temp = mkdtempSync(join(tmpdir(), 'coach-file-reading-'))
try {
  const { readFileForAgent, FileReadError } = loadTsModule('@maestro-main/files/fileReader.service')

  const textFile = join(temp, 'notes.md')
  writeFileSync(textFile, ['alpha', 'booking patient', 'gamma', 'delta'].join('\n'))
  const text = await readFileForAgent(textFile, { offset: 2, limit: 2 })
  assert(text.includes('2\tbooking patient') && text.includes('3\tgamma'), 'text files should be line-numbered with offset/limit paging')
  assert(!text.includes('1\talpha'), 'text offset should skip earlier lines')

  const exceljs = await import('exceljs')
  const Workbook = exceljs.Workbook || exceljs.default?.Workbook
  assert(typeof Workbook === 'function', 'exceljs should expose Workbook')
  const xlsxFile = join(temp, 'patients.xlsx')
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet('Patients')
  sheet.addRow(['name', 'phone'])
  sheet.addRow(['Jane Roe', '+62 812'])
  await workbook.xlsx.writeFile(xlsxFile)
  const xlsx = await readFileForAgent(xlsxFile)
  assert(xlsx.includes('## Sheet: Patients'), 'xlsx reader should include sheet headings')
  assert(xlsx.includes('| Jane Roe | +62 812 |'), 'xlsx reader should expose cell values as markdown tables')

  const { Document, Packer, Paragraph, TextRun } = await import('docx')
  const docxFile = join(temp, 'summary.docx')
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [new Paragraph({ children: [new TextRun('Booking summary for Jane Roe')] })]
      }
    ]
  })
  writeFileSync(docxFile, await Packer.toBuffer(doc))
  const docx = await readFileForAgent(docxFile)
  assert(docx.includes('Booking summary for Jane Roe'), 'docx reader should extract document text')

  const pdfFile = join(temp, 'summary.pdf')
  writeMinimalPdf(pdfFile, 'Hello PDF Coach')
  const pdf = await readFileForAgent(pdfFile)
  assert(pdf.includes('----- Page 1/1 -----') && pdf.includes('Hello PDF Coach'), 'pdf reader should extract page-delimited text')

  const unsupported = join(temp, 'archive.zip')
  writeFileSync(unsupported, 'zip-ish')
  let unsupportedCode = ''
  try {
    await readFileForAgent(unsupported)
  } catch (err) {
    unsupportedCode = err instanceof FileReadError ? err.code : ''
  }
  assert(unsupportedCode === 'unsupported', 'unsupported file types should raise a typed FileReadError')

  console.log('[check-file-reading] ok')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
