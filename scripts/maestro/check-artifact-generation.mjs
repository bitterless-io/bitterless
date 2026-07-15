import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const workspaceRoot = projectRoot
const moduleCache = new Map()

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

let pdfLoadUrl = ''
let pdfDestroyed = false
let pdfWindowOptions = null
let pdfRequestFilter = null
let pdfRequestCallback = null

class MockBrowserWindow {
  webContents = {
    session: {
      webRequest: {
        onBeforeRequest: (filter, callback) => {
          pdfRequestFilter = filter
          pdfRequestCallback = callback
        }
      }
    },
    printToPDF: async (options) => {
      assert(options?.printBackground === true, 'PDF should print backgrounds')
      return Buffer.from('%PDF-1.4\n% mock pdf\n')
    }
  }

  constructor(options) {
    pdfWindowOptions = options
  }

  async loadURL(url) {
    pdfLoadUrl = url
  }

  isDestroyed() {
    return pdfDestroyed
  }

  destroy() {
    pdfDestroyed = true
  }
}

const mocks = {
  electron: {
    BrowserWindow: MockBrowserWindow
  }
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
  if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
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

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const service = readFileSync(join(root, 'main/maestro/files/artifactWriter.service.ts'), 'utf8')
const maestro = readFileSync(join(root, 'main/maestro/windows/maestroWindow.helper.ts'), 'utf8')
const prompt = readFileSync(join(root, 'main/maestro/agent/prompt/maestroSysPrompt.ts'), 'utf8')
const catalog = readFileSync(join(root, 'main/maestro/agent/hostToolCatalog.ts'), 'utf8')
const workspaceDocs = readFileSync(join(workspaceRoot, 'docs/features/maestro.md'), 'utf8')

assert(pkg.dependencies?.exceljs, 'Excel artifact generation should depend on exceljs')
assert(pkg.dependencies?.docx, 'Word artifact generation should depend on docx')
assert(!pkg.dependencies?.pdfkit, 'PDF artifacts should use Electron Chromium printToPDF, not add pdfkit')
assert(!service.includes('playwright'), 'PDF artifacts should use Electron directly rather than Playwright')

assert(service.includes("export type ArtifactKind = 'xlsx' | 'docx' | 'pdf'"), 'artifact service should support xlsx/docx/pdf')
assert(service.includes("join(params.userDataPath, 'artifacts'"), 'artifact service should fall back to userData/artifacts')
assert(service.includes("return join('artifacts'"), 'workspace default artifacts should go under artifacts/')
assert(service.includes('normalizeTargetExtension(target, ext)'), 'artifact service should force filename extension to match artifact type')
assert(service.includes('new Workbook()') && service.includes('workbook.xlsx.writeBuffer()'), 'xlsx artifacts should be generated with exceljs')
assert(service.includes('new Document({') && service.includes('Packer.toBuffer(document)'), 'docx artifacts should be generated with docx')
assert(service.includes('new BrowserWindow({') && service.includes('printToPDF({'), 'pdf artifacts should render through Electron printToPDF')
assert(service.includes('partition: `coach-pdf-${randomUUID()}`'), 'pdf renderer should use an isolated temporary session partition')
assert(service.includes("webRequest.onBeforeRequest"), 'pdf renderer should intercept external resource requests')
assert(service.includes("['http://*/*', 'https://*/*', 'file://*/*', 'ftp://*/*']"), 'pdf renderer should block network/file resource schemes')
assert(service.includes('realpathSync(root)') && service.includes('nearestExistingAncestor'), 'artifact path should use realpath guardrails')
assert(service.includes('absolute artifact filenames require a selected workspace'), 'absolute paths should require a selected workspace')

assert(maestro.includes("name: 'create_artifact'"), 'Maestro should expose create_artifact')
assert(maestro.includes('this.toolCreateArtifact(sessionKey'), 'create_artifact tool should call main implementation')
assert(maestro.includes('userDataPath: maestroDataRoot()'), 'create_artifact should use the isolated Maestro data root')
assert(maestro.includes('this.recordAgentArtifact(artifact)'), 'create_artifact should record reply artifacts')
assert(prompt.includes('create_artifact to generate Excel/Word/PDF'), 'system prompt should mention artifact generation')
assert(catalog.includes("name: 'create_artifact'") && catalog.includes('Generate Excel, Word, PDF'), 'host tool catalog should list create_artifact')
assert(workspaceDocs.includes('workspace-scoped') && workspaceDocs.includes('file search/read/write; artifact'), 'embedded feature contract should preserve workspace file and artifact behavior')

const temp = mkdtempSync(join(tmpdir(), 'coach-artifacts-'))
try {
  const userData = join(temp, 'user-data')
  const workspace = join(temp, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const { writeArtifactFromJson } = loadTsModule('@maestro-main/files/artifactWriter.service')

  const userJson = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    artifactJson: JSON.stringify({
      type: 'json',
      filename: 'reports/patient-summary.txt',
      content: { patient: 'Jane', status: 'booked' }
    })
  })
  assert(userJson.ok, `userData json artifact should be created: ${userJson.error || ''}`)
  assert(userJson.path === join(userData, 'artifacts', 'chat-a', 'reports', 'patient-summary.json'), 'userData artifact should land under userData/artifacts/<session> and force .json extension')
  assert(JSON.parse(readFileSync(userJson.path, 'utf8')).patient === 'Jane', 'json artifact should preserve content')

  const xlsx = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    workspaceRoot: workspace,
    artifactJson: JSON.stringify({
      type: 'xlsx',
      filename: 'exports/patients.wrong',
      sheets: [{ name: 'Patients', rows: [{ name: 'Jane', phone: '+62' }] }]
    })
  })
  assert(xlsx.ok, `workspace xlsx artifact should be created: ${xlsx.error || ''}`)
  assert(xlsx.path === join(workspace, 'exports', 'patients.xlsx'), 'workspace artifact should land under selected workspace and force .xlsx extension')
  assert(readFileSync(xlsx.path).subarray(0, 2).toString('utf8') === 'PK', 'xlsx artifact should be an OOXML zip')

  const docx = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    workspaceRoot: workspace,
    artifactJson: JSON.stringify({
      type: 'docx',
      title: 'Booking Report',
      sections: [{ heading: 'Patients', table: { columns: ['name'], rows: [{ name: 'Jane' }] } }]
    })
  })
  assert(docx.ok, `workspace docx artifact should be created: ${docx.error || ''}`)
  assert(relative(workspace, docx.path).startsWith('artifacts/'), 'default workspace artifact should land under workspace/artifacts')
  assert(readFileSync(docx.path).subarray(0, 2).toString('utf8') === 'PK', 'docx artifact should be an OOXML zip')

  const pdf = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    workspaceRoot: workspace,
    artifactJson: JSON.stringify({
      type: 'pdf',
      filename: 'exports/booking.pdf',
      html: '<h1>Booking Report</h1><p>Jane booked.</p>'
    })
  })
  assert(pdf.ok, `workspace pdf artifact should be created: ${pdf.error || ''}`)
  assert(pdf.path === join(workspace, 'exports', 'booking.pdf'), 'pdf artifact should land under workspace')
  assert(readFileSync(pdf.path, 'utf8').startsWith('%PDF'), 'pdf artifact should be written from printToPDF output')
  assert(pdfLoadUrl.startsWith('data:text/html;charset=utf-8,'), 'pdf renderer should load an HTML data URL')
  assert(pdfWindowOptions?.webPreferences?.partition?.startsWith('coach-pdf-'), 'pdf renderer should use a temporary isolated session partition')
  assert(pdfWindowOptions?.webPreferences?.sandbox === true && pdfWindowOptions?.webPreferences?.javascript === false, 'pdf renderer should run sandboxed with JavaScript disabled')
  assert(Array.isArray(pdfRequestFilter?.urls) && pdfRequestFilter.urls.includes('https://*/*') && pdfRequestFilter.urls.includes('file://*/*'), 'pdf renderer should register a blocker for remote/file resources')
  let blocked = null
  pdfRequestCallback?.({ url: 'https://example.test/tracker.png' }, (result) => {
    blocked = result
  })
  assert(blocked?.cancel === true, 'pdf renderer should cancel external resource requests')
  assert(pdfDestroyed, 'pdf renderer window should be destroyed after printing')

  const absoluteWithoutWorkspace = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    artifactJson: JSON.stringify({ type: 'txt', filename: join(temp, 'outside.txt'), text: 'nope' })
  })
  assert(!absoluteWithoutWorkspace.ok && absoluteWithoutWorkspace.error?.includes('absolute artifact filenames require a selected workspace'), 'absolute filename without workspace should be rejected')

  const outsideWorkspace = await writeArtifactFromJson({
    userDataPath: userData,
    sessionKey: 'chat-a',
    workspaceRoot: workspace,
    artifactJson: JSON.stringify({ type: 'txt', filename: '../outside.txt', text: 'nope' })
  })
  assert(!outsideWorkspace.ok && outsideWorkspace.error?.includes('outside the allowed output root'), 'relative path escaping workspace should be rejected')

  for (const created of [userJson, xlsx, docx, pdf]) {
    assert(created.path && statSync(created.path).isFile(), `artifact should exist on disk: ${created.path}`)
    assert(created.size && created.size > 0, `artifact should report a positive size: ${created.path}`)
  }

  console.log('[check-artifact-generation] ok')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
