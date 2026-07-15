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

const { HostApprovalHistory } = loadTsModule('@maestro-main/agent/runtime/hostApprovalHistory')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')
const coachHandler = readFileSync(join(root, 'main/maestro/xpc/coach.handler.ts'), 'utf8')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/maestroWindow.helper.ts'), 'utf8')
const workbenchStore = readFileSync(join(root, 'renderer/maestro/workbench/src/workbench.store.ts'), 'utf8')
const toolsView = readFileSync(join(root, 'renderer/maestro/workbench/src/views/WorkbenchToolsView.vue'), 'utf8')

assert(coachApi.includes('exportHostApprovalEvents(): Promise<HostApprovalExportResult>'), 'XPC contract should expose approval export')
assert(coachHandler.includes('async exportHostApprovalEvents()'), 'XPC main handler should forward approval export')
assert(maestroWindow.includes('async exportHostApprovalEvents()') && maestroWindow.includes('coach-host-approvals-'), 'main should write host approval export JSON')
assert(workbenchStore.includes('async exportHostApprovalEvents()') && workbenchStore.includes('hostApprovalExporting'), 'Workbench store should expose export state/action')
assert(toolsView.includes('IconDownload') && toolsView.includes('@click="exportApprovals"'), 'Workbench Tools should render an export button')

const history = new HostApprovalHistory(2)
const first = history.push({
  kind: 'tool',
  status: 'pending',
  label: 'browser_exec',
  scope: 'cowork',
  toolName: 'browser_exec',
  detail: 'args: commands_json'
})
assert(first.id === 'approval-1', 'first approval id should be deterministic')
assert(!first.resolvedAt, 'pending approval should not have resolvedAt')

const approved = history.resolve(first.id, 'approved')
assert(approved?.status === 'approved', 'approval should resolve to approved')
assert(typeof approved?.resolvedAt === 'number', 'resolved approval should have resolvedAt')

history.push({
  kind: 'api',
  status: 'blocked',
  label: 'DELETE /api/bookings/:id',
  method: 'DELETE',
  path: '/api/bookings/:id',
  reason: 'matched recorded endpoint marked unsafe'
})
history.push({
  kind: 'api',
  status: 'denied',
  label: 'POST /api/patients',
  method: 'POST',
  path: '/api/patients',
  reason: 'unrecorded mutating endpoint requires confirmation'
})

const events = history.list()
assert(events.length === 2, 'history should cap to the latest max events')
assert(events[0].label === 'POST /api/patients', 'list should be newest first')
assert(events[1].label === 'DELETE /api/bookings/:id', 'oldest retained event should be second')
assert(!events.some((event) => event.id === first.id), 'oldest event should be evicted after cap')

const persisted = history.snapshot()
assert(persisted[0].label === 'DELETE /api/bookings/:id', 'snapshot should be chronological for storage')
assert(persisted[1].label === 'POST /api/patients', 'snapshot newest should be last')

const restored = new HostApprovalHistory(4)
const restoredList = restored.replace([
  { ...persisted[1], label: 'x'.repeat(500), path: '/api/patients?token=redacted-shape' },
  { ...persisted[0] },
  { id: 'bad', kind: 'api', status: 'approved', label: '', requestedAt: Date.now() }
])
assert(restoredList.length === 2, 'replace should drop malformed persisted events')
assert(restoredList.some((event) => event.label.length === 300), 'replace should clip long labels')
const exportedPayload = restored.exportPayload()
const exportedText = JSON.stringify(exportedPayload)
assert(exportedPayload.count === 2 && exportedPayload.events.length === 2, 'export payload should include the sanitized snapshot')
assert(typeof exportedPayload.exportedAt === 'number' && exportedPayload.exportedAt > 0, 'export payload should include exportedAt')
assert(!exportedText.includes('redacted-shape'), 'export payload should not contain raw token query values')
const next = restored.push({
  kind: 'tool',
  status: 'approved',
  label: 'ui_act',
  scope: 'cowork',
  toolName: 'ui_act'
})
assert(next.id === 'approval-4', 'restored seq should continue from persisted ids')

assert(history.clear().length === 0, 'clear should return an empty list')
assert(history.list().length === 0, 'clear should remove all events')

console.log('[check-host-approval-history] ok', JSON.stringify({
  approved: approved.status,
  retained: events.map((event) => event.status),
  restored: restored.list().map((event) => event.id)
}))
