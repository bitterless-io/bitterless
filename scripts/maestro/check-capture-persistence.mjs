import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const moduleCache = new Map()

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

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const { buildPersistedRawCaptureRecords } = loadTsModule('@maestro-main/capture/captureRecordPersistence')
const maestroWindowSource = readFileSync(join(root, 'main/maestro/windows/maestroWindow.helper.ts'), 'utf8')

const persisted = buildPersistedRawCaptureRecords(
  [
    {
      kind: 'action',
      type: 'click',
      desc: 'Click button',
      target: { selector: '#submit', selectors: ['#submit'], tag: 'button' },
      step: { action: 'click', target: { selector: '#submit', selectors: ['#submit'], tag: 'button' }, yaml: '- button "Submit" [ref=e1]' },
      shot: 'data:image/png;base64,abc',
      ts: 100
    },
    {
      kind: 'snapshot',
      url: 'https://example.test',
      title: 'Example',
      nodeCount: 1,
      yaml: '- document [ref=e1]',
      shot: 'data:image/png;base64,def',
      ts: 110
    },
    {
      kind: 'net.request',
      requestId: 'r1',
      url: 'https://example.test/api/bookings',
      method: 'POST',
      headers: { authorization: '[redacted]' },
      ts: 120
    }
  ],
  90,
  130
)

assert(persisted, 'non-empty events should build persisted records')
assert(persisted.records.length === 3, 'all trace events should be preserved as ingest records')
assert(persisted.startedAt === 90, 'startedAt should be carried')
assert(persisted.updatedAt === 130, 'updatedAt should be carried')
assert(persisted.records[0].event.kind === 'action', 'first event should remain an action')
assert(!('shot' in persisted.records[0].event) || persisted.records[0].event.shot === undefined, 'action shot should not persist')
assert(persisted.records[1].event.kind === 'snapshot', 'second event should remain a snapshot')
assert(!('shot' in persisted.records[1].event) || persisted.records[1].event.shot === undefined, 'snapshot shot should not persist')
assert(persisted.records[2].event.kind === 'net.request', 'network request should persist')
assert(persisted.records[2].event.headers.authorization === '[redacted]', 'non-display event data should persist unchanged')

const noStartedAt = buildPersistedRawCaptureRecords([{ kind: 'error', msg: 'x', ts: 1 }], 0, 2)
assert(noStartedAt?.startedAt === undefined, 'invalid startedAt should be omitted')

const empty = buildPersistedRawCaptureRecords([], 1, 2)
assert(empty === null, 'empty event list should not persist latest evidence')

assert(
  maestroWindowSource.includes('if (this.capturing) await this.discardActiveCaptureForRestart()'),
  'startCapture should restart a live capture instead of reusing the old trace'
)
assert(
  maestroWindowSource.includes('private async discardActiveCaptureForRestart()'),
  'capture restart cleanup helper should exist'
)
assert(
  /discardActiveCaptureForRestart\(\)[\s\S]*this\.traceEvents = \[\]/.test(maestroWindowSource),
  'capture restart should clear in-memory trace events'
)
assert(
  /startCapture\(params[\s\S]*await this\.clearCaptureRecordEdits\(\)[\s\S]*xpcMain\.broadcast\('coach\/capture-started'/.test(maestroWindowSource),
  'fresh capture start should clear persisted record edits before broadcasting capture-started'
)

console.log('[check-capture-persistence] ok', JSON.stringify({
  records: persisted.records.length,
  startedAt: persisted.startedAt,
  updatedAt: persisted.updatedAt,
  restart: true
}))
