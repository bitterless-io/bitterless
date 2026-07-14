import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
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

const json = async (res) => {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`response is not JSON (${res.status}): ${text.slice(0, 200)}`)
  }
}

const { BookingDemoService } = loadTsModule('@cowork-main/demo/bookingDemo.service')
const dir = mkdtempSync(join(tmpdir(), 'coach-demo-api-'))
const service = new BookingDemoService(dir)

try {
  const url = await service.start()
  const base = new URL(url)
  const authHeaders = { authorization: 'Bearer smoke-token' }

  const departments = await fetch(new URL('/api/departments', base), { headers: authHeaders }).then(json)
  assert(departments.ok === true, 'departments response must be ok')
  const departmentIds = new Set((departments.departments || []).map((item) => item.id))
  for (const id of ['cardiology', 'radiology', 'orthopedics', 'general-medicine', 'pediatrics']) {
    assert(departmentIds.has(id), `missing department ${id}`)
  }

  const prices = await fetch(new URL('/api/pricing-list', base), { headers: authHeaders }).then(json)
  assert(prices.ok === true, 'pricing response must be ok')
  const priceCodes = new Set((prices.items || []).map((item) => item.code))
  for (const code of ['CT26', 'CT29', 'CT23', 'CT18', 'CT30', 'XR11', 'XR13', 'MR01', 'US05', 'MMG01']) {
    assert(priceCodes.has(code), `missing price item ${code}`)
  }

  const createPayload = {
    patient_name: 'Smoke Test',
    patient_phone: '+62 812 0000 0000',
    hkid: 'X123456(7)',
    appointment_time: '2026-07-01T15:00',
    department_or_doctor: 'cardiology',
    item_code: 'CT26'
  }
  const created = await fetch(new URL('/api/bookings', base), {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(createPayload)
  }).then(json)
  assert(created.ok === true, 'booking create response must be ok')
  assert(created.booking?.department?.id === 'cardiology', 'created booking should resolve cardiology')
  assert(created.booking?.priceItem?.code === 'CT26', 'created booking should resolve CT26')

  const list = await fetch(new URL('/api/bookings', base), { headers: authHeaders }).then(json)
  assert(list.ok === true, 'booking list response must be ok')
  assert((list.bookings || []).some((item) => item.bookingId === created.bookingId), 'created booking should appear in list')

  console.log('[check-demo-api] ok', JSON.stringify({
    departments: departmentIds.size,
    pricingItems: priceCodes.size,
    bookingId: created.bookingId
  }))
} catch (err) {
  console.error('[check-demo-api] failed')
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  service.stop()
  rmSync(dir, { recursive: true, force: true })
}
