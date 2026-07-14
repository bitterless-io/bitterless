import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const moduleCache = new Map()

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@cowork-main/')) return join(root, 'main', `${specifier.slice('@cowork-main/'.length)}.ts`)
  if (specifier.startsWith('@cowork-shared/')) return join(root, 'shared', `${specifier.slice('@cowork-shared/'.length)}.ts`)
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

const tool = (name, output) => {
  let calls = 0
  return {
    spec: {
      name,
      description: `${name} test tool`,
      params: [{ name: 'value', required: false }],
      execute: async () => {
        calls += 1
        return output
      }
    },
    calls: () => calls
  }
}

const { readHostToolCatalog } = loadTsModule('@cowork-main/agent/hostToolCatalog')
const { HostToolRegistry } = loadTsModule('@cowork-main/agent/runtime/hostToolRegistry')
const { HostApprovalHistory } = loadTsModule('@cowork-main/agent/runtime/hostApprovalHistory')

const disabledTool = tool('write_file', 'write-ok')
const readTool = tool('read_file', 'read-ok')
const disabledRegistry = new HostToolRegistry({
  scope: 'cowork',
  policies: {
    write_file: { toolName: 'write_file', mode: 'disabled', updatedAt: 1 }
  }
})
disabledRegistry.add(disabledTool.spec, readTool.spec)
const disabledRuntime = disabledRegistry.toRuntimeTools()
assert(disabledRuntime.length === 1, 'disabled tool should be removed from runtime surface')
assert(disabledRuntime[0].name === 'read_file', 'read_file should remain available')
assert(disabledTool.calls() === 0, 'disabled tool executor must not run')

const confirmedTool = tool('browser_exec', 'browser-ok')
const confirmRequests = []
const confirmRegistry = new HostToolRegistry({
  scope: 'cowork',
  policies: {
    browser_exec: { toolName: 'browser_exec', mode: 'confirm', updatedAt: 1 }
  },
  onConfirm: async (request) => {
    confirmRequests.push(request)
    return true
  }
})
confirmRegistry.add(confirmedTool.spec)
const confirmedRuntime = confirmRegistry.toRuntimeTools()
assert(confirmedRuntime.length === 1, 'confirmed tool should stay in runtime surface')
const confirmedResult = await confirmedRuntime[0].execute({ value: 'ok' })
assert(confirmedResult === 'browser-ok', 'approved confirmed tool should return executor output')
assert(confirmedTool.calls() === 1, 'approved confirmed tool should run executor exactly once')
assert(confirmRequests.length === 1, 'confirmed tool should ask once before execution')
assert(confirmRequests[0].toolName === 'browser_exec', 'confirmation should name the tool')
assert(confirmRequests[0].args.value === 'ok', 'confirmation should receive tool args')

const deniedTool = tool('ui_act', 'ui-ok')
const denyRegistry = new HostToolRegistry({
  scope: 'cowork',
  policies: {
    ui_act: { toolName: 'ui_act', mode: 'confirm', updatedAt: 1 }
  },
  onConfirm: async () => false
})
denyRegistry.add(deniedTool.spec)
const deniedRuntime = denyRegistry.toRuntimeTools()
let deniedError = ''
try {
  await deniedRuntime[0].execute({ value: 'deny' })
} catch (err) {
  deniedError = err instanceof Error ? err.message : String(err)
}
assert(deniedError.includes('denied'), 'denied confirmed tool should throw a denial error')
assert(deniedTool.calls() === 0, 'denied confirmed tool must not run executor')

const firstDuplicate = tool('read_file', 'first')
const secondDuplicate = tool('read_file', 'second')
const warnings = []
const duplicateRegistry = new HostToolRegistry({
  scope: 'cowork',
  onWarning: (message, detail) => warnings.push({ message, detail })
})
duplicateRegistry.add(firstDuplicate.spec, secondDuplicate.spec)
const duplicateRuntime = duplicateRegistry.toRuntimeTools()
assert(duplicateRuntime.length === 1, 'duplicate tool names should keep one runtime tool')
assert(await duplicateRuntime[0].execute({}) === 'first', 'duplicate handling should keep the first tool')
assert(firstDuplicate.calls() === 1, 'first duplicate tool should run')
assert(secondDuplicate.calls() === 0, 'second duplicate tool should be ignored')
assert(warnings.some((item) => item.message.includes('duplicate')), 'duplicate tool should emit a warning')

const unknownWarnings = []
const unknownRegistry = new HostToolRegistry({
  scope: 'cowork',
  onWarning: (message, detail) => unknownWarnings.push({ message, detail })
})
unknownRegistry.add(tool('not_in_catalog', 'unknown').spec).toRuntimeTools()
assert(unknownWarnings.some((item) => item.message.includes('missing catalog')), 'unknown tool should warn about missing catalog entry')

const catalog = readHostToolCatalog({
  scope: 'cowork',
  policies: {
    browser_exec: { toolName: 'browser_exec', mode: 'confirm', updatedAt: 1 },
    write_file: { toolName: 'write_file', mode: 'disabled', updatedAt: 2 }
  }
})
const browserExec = catalog.tools.find((item) => item.name === 'browser_exec')
const writeFile = catalog.tools.find((item) => item.name === 'write_file')
assert(browserExec?.policy?.mode === 'confirm', 'catalog should expose confirm policy')
assert(writeFile?.policy?.mode === 'disabled', 'catalog should expose disabled policy')

const history = new HostApprovalHistory()
const leakedJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwYXRpZW50In0.signatureTOKEN'
history.push({
  kind: 'api',
  status: 'pending',
  label: `POST /api/bookings?token=live-secret`,
  detail: `Authorization: Bearer abcdefghijklmnop`,
  method: 'POST',
  path: `/api/bookings?jwt=${leakedJwt}`,
  reason: 'csrf=secret-value'
})
history.replace([
  {
    id: 'approval-99',
    kind: 'tool',
    status: 'approved',
    label: 'browser_exec token=restored-secret',
    detail: 'cookie=sessionid',
    toolName: 'browser_exec',
    requestedAt: Date.now(),
    resolvedAt: Date.now()
  }
])
const historyText = JSON.stringify({ list: history.list(), snapshot: history.snapshot() })
assert(historyText.includes('[REDACTED]') || historyText.includes('[REDACTED_JWT]'), 'approval history should redact secret-like values')
assert(!historyText.includes('live-secret'), 'approval history should not store token query values')
assert(!historyText.includes('abcdefghijklmnop'), 'approval history should not store bearer values')
assert(!historyText.includes('secret-value'), 'approval history should not store csrf values')
assert(!historyText.includes('restored-secret'), 'approval history restore should sanitize persisted secret-like values')
assert(!historyText.includes(leakedJwt), 'approval history should not store JWT values')

console.log('[check-host-tools] ok', JSON.stringify({
  runtimeToolsAfterDisable: disabledRuntime.map((item) => item.name),
  confirmRequests: confirmRequests.length,
  duplicateWarnings: warnings.length,
  catalogTools: catalog.total
}))
