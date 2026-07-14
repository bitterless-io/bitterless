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

const { validateSkillVars, runSkillScript } = loadTsModule('@cowork-main/drive/skillScript')

const inputs = [
  { name: 'patient.name', label: 'Patient name', required: true, type: 'string' },
  { name: 'patient.age', label: 'Patient age', required: true, type: 'number' },
  { name: 'patient.vip', label: 'VIP', required: false, type: 'boolean' },
  { name: 'department.code', label: 'Department code', required: true, type: 'enum', enum: ['cardiology', 'radiology'] }
]

const flat = validateSkillVars(inputs, {
  'patient.name': 'Jane Doe',
  'patient.age': '42',
  'patient.vip': 'false',
  'department.code': 'cardiology',
  note: 'preserved'
})
assert(flat.ok, 'flat dotted vars should validate')
assert(flat.data['patient.name'] === 'Jane Doe', 'flat value should remain addressable by dotted key')
assert(flat.data.patient.name === 'Jane Doe', 'flat dotted value should also become nested')
assert(flat.data.patient.age === 42, 'number value should coerce inside nested object')
assert(flat.data.patient.vip === false, 'boolean false string should coerce to false')
assert(flat.data.department.code === 'cardiology', 'enum value should become nested')
assert(flat.data.note === 'preserved', 'unknown passthrough vars should survive')

const nested = validateSkillVars(inputs, {
  patient: { name: 'Budi', age: 33 },
  department: { code: 'radiology' }
})
assert(nested.ok, 'nested vars should validate')
assert(nested.data['patient.name'] === 'Budi', 'nested value should also become dotted key')
assert(nested.data.patient.age === 33, 'nested number should remain available')

const missing = validateSkillVars(inputs, {
  patient: { name: 'Budi' },
  department: { code: 'radiology' }
})
assert(!missing.ok, 'missing nested required input should fail')
assert(missing.errors.some((line) => line.startsWith('patient.age:')), 'missing error should mention dotted input path')

const badEnum = validateSkillVars(inputs, {
  patient: { name: 'Budi', age: 33 },
  department: { code: 'neurology' }
})
assert(!badEnum.ok, 'invalid enum should fail')
assert(badEnum.errors.some((line) => line.startsWith('department.code:')), 'enum error should mention dotted input path')

const run = await runSkillScript({
  script: 'return { flat: vars["patient.name"], nested: vars.patient.name, age: vars.patient.age, dept: vars.department.code }',
  replay: {},
  vars: flat.data
})
assert(run.ok, 'script should run with normalized nested vars')
assert(run.result.flat === 'Jane Doe', 'script should read dotted alias')
assert(run.result.nested === 'Jane Doe', 'script should read nested object')
assert(run.result.age === 42, 'script should read coerced nested number')
assert(run.result.dept === 'cardiology', 'script should read nested enum')

console.log('[check-skill-input-vars] ok')
