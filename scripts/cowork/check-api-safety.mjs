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

const { classifySkillApiCall, isMutatingHttpMethod, normalizeHttpMethod } = loadTsModule('@cowork-main/drive/apiSafety')

const recipe = {
  id: 'recording/test',
  name: 'Patient Booking',
  description: 'Create booking',
  source: 'recording',
  createdAt: 1,
  updatedAt: 1,
  inputs: [],
  aliases: [],
  shortcuts: [],
  keywords: [],
  triggers: [],
  steps: [],
  snapshots: [],
  network: [
    {
      method: 'GET',
      url: 'https://clinic.example.test/api/departments',
      apiRole: 'option-read',
      replaySafety: 'safe',
      bodyKind: 'none'
    },
    {
      method: 'POST',
      url: 'https://clinic.example.test/api/bookings',
      apiRole: 'write',
      replaySafety: 'confirm',
      bodyKind: 'json'
    },
    {
      method: 'DELETE',
      url: 'https://clinic.example.test/api/bookings/123456',
      apiRole: 'write',
      replaySafety: 'unsafe',
      bodyKind: 'none'
    }
  ]
}

const readDecision = classifySkillApiCall(recipe, { method: 'GET', url: '/api/departments' })
assert(readDecision.matched, 'relative read should match recorded absolute endpoint')
assert(readDecision.safety === 'safe', 'option read should be safe')
assert(readDecision.role === 'option-read', 'option read role should be preserved')

const writeDecision = classifySkillApiCall(recipe, { method: 'post', url: '/api/bookings', body: { patient: 'x' } })
assert(writeDecision.matched, 'relative write should match recorded endpoint')
assert(writeDecision.method === 'POST', 'method should normalize to uppercase')
assert(writeDecision.safety === 'confirm', 'recorded write should require confirmation')

const unsafeDecision = classifySkillApiCall(recipe, { method: 'DELETE', url: '/api/bookings/987654' })
assert(unsafeDecision.matched, 'dynamic id segments should match recorded endpoint')
assert(unsafeDecision.safety === 'unsafe', 'unsafe recorded endpoint should remain unsafe')

const unrecordedWrite = classifySkillApiCall(recipe, { method: 'PATCH', url: '/api/patients/888888' })
assert(!unrecordedWrite.matched, 'unrecorded write should not match')
assert(unrecordedWrite.safety === 'confirm', 'unrecorded mutating endpoint should require confirmation')

const externalSamePath = classifySkillApiCall(recipe, { method: 'POST', url: 'https://other.example.test/api/bookings' })
assert(!externalSamePath.matched, 'absolute call to a different host should not match recorded host')
assert(externalSamePath.safety === 'confirm', 'different-host mutating endpoint still requires confirmation')

const unrecordedRead = classifySkillApiCall(recipe, { method: 'GET', url: '/api/pricing-list' })
assert(!unrecordedRead.matched, 'unrecorded read should not match')
assert(unrecordedRead.safety === 'safe', 'unrecorded read-like endpoint should remain allowed')

assert(isMutatingHttpMethod('delete'), 'DELETE should be mutating')
assert(!isMutatingHttpMethod('GET'), 'GET should not be mutating')
assert(normalizeHttpMethod(' post ') === 'POST', 'method normalization should trim and uppercase')

console.log('[check-api-safety] ok', JSON.stringify({
  read: readDecision.safety,
  write: writeDecision.safety,
  unsafe: unsafeDecision.safety,
  unrecordedWrite: unrecordedWrite.safety
}))
