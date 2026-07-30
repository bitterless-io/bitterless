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

const { extractVariablesFromMessage } = loadTsModule('@maestro-main/agent/naturalLanguageVariables')
const agentPromptSource = readFileSync(join(root, 'main/maestro/agent/runtime/agentPrompt.ts'), 'utf8')

const bookingRecipe = {
  inputs: [
    { name: 'patient_name', label: 'Patient name', required: true },
    { name: 'patient_phone', label: 'Patient phone', required: true },
    { name: 'appointment_time', label: 'Appointment time', required: true },
    { name: 'department_or_doctor', label: 'Department or doctor', required: true },
    { name: 'gender', label: 'Jenis Kelamin', required: false },
    { name: 'nik', label: 'NIK', required: false },
    { name: 'ihs_number', label: 'IHS Number', required: false },
    { name: 'address', label: 'Alamat', required: false }
  ]
}

const nestedRecipe = {
  inputs: [
    { name: 'patient.name', label: 'Patient name', required: true },
    { name: 'patient.phone', label: 'Patient phone', required: true },
    { name: 'appointment.time', label: 'Appointment time', required: true },
    { name: 'appointment.department', label: 'Department or doctor', required: true },
    { name: 'identity.nik', label: 'NIK', required: false },
    { name: 'identity.ihs_number', label: 'IHS Number', required: false }
  ]
}

const fixedNow = new Date(2026, 5, 29, 9, 0, 0)
const cases = [
  {
    name: 'English partial booking keeps patient name',
    message: 'book for jane',
    expected: { patient_name: 'jane' }
  },
  {
    name: 'Chinese booking extracts all obvious slots',
    message: 'booking 李四 +89 998292833 明天 下午 3 点，心脏科',
    expected: {
      patient_name: '李四',
      patient_phone: '+89 998292833',
      appointment_time: '2026-06-30T15:00',
      department_or_doctor: 'cardiology'
    }
  },
  {
    name: 'Indonesian radiology alias maps to live demo option',
    message: 'booking untuk Budi 081234567890 besok jam 10 pagi radiologi',
    expected: {
      patient_name: 'Budi',
      patient_phone: '081234567890',
      appointment_time: '2026-06-30T10:00',
      department_or_doctor: 'radiology'
    }
  },
  {
    name: 'General practice alias maps to general medicine option',
    message: 'book for Maya +62 812 0000 9999 tomorrow 2pm dokter umum',
    expected: {
      patient_name: 'Maya',
      patient_phone: '+62 812 0000 9999',
      appointment_time: '2026-06-30T14:00',
      department_or_doctor: 'general-medicine'
    }
  },
  {
    name: 'Pediatric alias maps to pediatrics option',
    message: '预约 张三 13800138000 明天 上午 9 点 儿科',
    expected: {
      patient_name: '张三',
      patient_phone: '13800138000',
      appointment_time: '2026-06-30T09:00',
      department_or_doctor: 'pediatrics'
    }
  },
  {
    name: 'Indonesian patient text extracts identity fields',
    message:
      'Nama Lengkap: Siti Aminah\nJenis Kelamin: Perempuan\nTelepon: 0812-3456-7890\nNIK: 3201234567890001\nIHS Number: P00123456789\nAlamat: Jl. Melati No. 12',
    expected: {
      patient_name: 'Siti Aminah',
      gender: 'Perempuan',
      patient_phone: '0812-3456-7890',
      nik: '3201234567890001',
      ihs_number: 'P00123456789',
      address: 'Jl. Melati No. 12'
    }
  },
  {
    name: 'JSON object values are preserved',
    message: '{"patient_name":"Jane Doe","department_or_doctor":"cardiology"}',
    expected: {
      patient_name: 'Jane Doe',
      department_or_doctor: 'cardiology'
    }
  },
  {
    name: 'Nested JSON object values flatten to dotted keys',
    recipe: nestedRecipe,
    message: '{"patient":{"name":"Jane Doe","phone":"+62 812 3333"},"appointment":{"time":"2026-07-01T10:30","department":"radiology"},"identity":{"nik":"3201234567890001","ihs_number":"P00123456789"}}',
    expected: {
      'patient.name': 'Jane Doe',
      'patient.phone': '+62 812 3333',
      'appointment.time': '2026-07-01T10:30',
      'appointment.department': 'radiology',
      'identity.nik': '3201234567890001',
      'identity.ihs_number': 'P00123456789'
    }
  },
  {
    name: 'Natural text can fill dotted input names',
    recipe: nestedRecipe,
    message: 'booking untuk Budi 081234567890 besok jam 10 pagi radiologi',
    expected: {
      'patient.name': 'Budi',
      'patient.phone': '081234567890',
      'appointment.time': '2026-06-30T10:00',
      'appointment.department': 'radiology'
    }
  }
]

const failures = []
for (const item of cases) {
  const actual = extractVariablesFromMessage(item.message, item.recipe || bookingRecipe, fixedNow)
  for (const [key, expected] of Object.entries(item.expected)) {
    if (actual[key] !== expected) {
      failures.push(`${item.name}: expected ${key}=${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`)
    }
  }
}

if (failures.length) {
  console.error('[check-natural-language-vars] failed')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

if (!/const seed = Object\.keys\(brief\.seed\)\.length[\s\S]*?clipInline\(JSON\.stringify\(brief\.seed\), MAX_AGENT_SKILL_INLINE_CHARS\)[\s\S]*?: 'none'/.test(agentPromptSource)) {
  console.error('[check-natural-language-vars] failed')
  console.error('- empty per-turn message_seed should be rendered as "none", and non-empty seeds should be clipped')
  process.exit(1)
}

const skillIndexChecks = [
  ['MAX_AGENT_SKILL_BRIEFS = 40', 'per-turn skill catalog should cap the number of listed skills'],
  ['const selectedBriefs = selectAgentSkillBriefs(params.briefs, params.message)', 'per-turn skill catalog should rank/select briefs by the current message'],
  ['const scoreAgentSkillBrief = (', 'skill catalog ranking should be centralized'],
  ['MAX_AGENT_SKILL_INPUTS', 'skill catalog inputs should be capped'],
  ['MAX_AGENT_SKILL_DESCRIPTION_CHARS', 'skill catalog descriptions should be capped'],
  ['lower-relevance skills omitted from this turn', 'prompt should explain omitted lower-relevance skills'],
  ['const clipInline = (value: unknown, max: number): string =>', 'skill catalog inline fields should be clipped']
]
for (const [needle, message] of skillIndexChecks) {
  if (!agentPromptSource.includes(needle)) {
    console.error('[check-natural-language-vars] failed')
    console.error(`- ${message}`)
    process.exit(1)
  }
}

console.log(`[check-natural-language-vars] ok (${cases.length} cases)`)
