import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const rootTmp = mkdtempSync(join(tmpdir(), 'coach-skill-import-'))
try {
  const userData = join(rootTmp, 'user-data')
  const exportRoot = join(rootTmp, 'exports')
  const packageDir = join(rootTmp, 'external-package')
  mkdirSync(exportRoot, { recursive: true })
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'SKILL.md'),
    [
      '---',
      'name: external-patient-check',
      'title: External Patient Check',
      'description: Review patient data from a portable external agent skill.',
      'aliases:',
      '  - patient review',
      'inputs:',
      '  patient:',
      '    label: Patient object',
      '    required: true',
      '---',
      '',
      '# External Patient Check',
      '',
      'Read the provided patient object and summarize missing fields.',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(join(packageDir, 'AGENTS.md'), '# External agent notes\n', 'utf8')

  const { SkillRegistryService } = loadTsModule('@maestro-main/skills/skillRegistry.service')
  const registry = new SkillRegistryService(userData)

  const recorded = registry.createRecordedSkill({
    name: 'Patient Booking',
    description: 'Create a patient booking from live patient details.',
    triggers: ['patient booking', 'book appointment'],
    inputs: [
      { name: 'patient.name', label: 'Patient name', required: true, type: 'string', example: 'Jane Recorded' },
      { name: 'patient.phone', label: 'Patient phone', required: true, type: 'string', example: '+62 812 9999 0000' },
      { name: 'appointment.time', label: 'Appointment time', required: true, type: 'string', example: '2026-07-01T15:00' }
    ],
    recipe: {
      id: 'recording/seed',
      name: 'Patient Booking',
      description: 'Create a patient booking from live patient details.',
      source: 'recording',
      sourceUrl: 'https://clinic.example.test/booking',
      createdAt: 1,
      updatedAt: 1,
      inputs: [
        { name: 'patient.name', label: 'Patient name', required: true, type: 'string', example: 'Jane Recorded' },
        { name: 'patient.phone', label: 'Patient phone', required: true, type: 'string', example: '+62 812 9999 0000' },
        { name: 'appointment.time', label: 'Appointment time', required: true, type: 'string', example: '2026-07-01T15:00' }
      ],
      aliases: ['booking pasien'],
      shortcuts: ['booking'],
      keywords: ['appointment'],
      triggers: ['patient booking', 'book appointment'],
      steps: [
        {
          action: 'fill',
          target: { tag: 'input', selector: '#patient-name', role: 'textbox', name: 'Patient name' },
          valueTemplate: 'Jane Recorded',
          originalValue: 'Jane Recorded',
          yaml: '- textbox "Patient name" [value="Jane Recorded"]',
          url: 'https://clinic.example.test/booking'
        },
        {
          action: 'fill',
          target: { tag: 'input', selector: '#patient-phone', role: 'textbox', name: 'Patient phone' },
          valueTemplate: '{{patient_phone}}',
          originalValue: '+62 812 9999 0000'
        }
      ],
      network: [
        {
          method: 'GET',
          url: 'https://clinic.example.test/api/departments',
          status: 200,
          resourceType: 'xhr',
          apiRole: 'option-read',
          replaySafety: 'safe',
          headers: { accept: 'application/json' },
          responseBodyPreview: '[{"id":"cardio","name":"Cardiology"}]'
        },
        {
          method: 'POST',
          url: 'https://clinic.example.test/api/bookings',
          status: 201,
          resourceType: 'xhr',
          apiRole: 'write',
          replaySafety: 'confirm',
          bodyKind: 'json',
          headers: {
            Authorization: 'Bearer eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc',
            Cookie: 'sid=secret',
            'content-type': 'application/json',
            'x-csrf-token': 'csrf-secret'
          },
          headerPolicy: [
            { header: 'Authorization', kind: 'bearer-token', storageKeys: ['access_token'], fallback: 'Bearer secret' },
            { header: 'x-csrf-token', kind: 'csrf-token', storageKeys: ['csrf'], fallback: 'csrf-secret' },
            { header: 'content-type', kind: 'static' }
          ],
          requestBody: '{"patient":{"name":"Jane Recorded","phone":"+62 812 9999 0000"},"appointment":{"time":"2026-07-01T15:00"},"confirmed":true,"count":7}',
          responseBodyPreview: '{"id":"booking-1","patient":"Jane Recorded"}'
        }
      ],
      snapshots: [
        {
          url: 'https://clinic.example.test/booking',
          title: 'Booking',
          yaml: '- textbox "Patient name" [value="Jane Recorded"]'
        }
      ],
      script: 'await api.fetch({ method: "POST", path: "/api/bookings", body: vars })',
      notes: 'Use only fresh patient values supplied by the user.'
    },
    body: [
      '# Patient Booking',
      '',
      'Use the live browser session and fresh user-provided values.',
      'Never reuse Authorization: Bearer eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc.',
      'Recorded identifiers such as 3201234567890001 and P00123456789 must not remain.'
    ].join('\n')
  })

  assert(recorded.source === 'recording', 'created recording skill should be marked recording')
  assert(recorded.domain === 'clinic.example.test', 'recording skill should be partitioned by source domain')
  assert(recorded.path.includes(`${join('skills', 'clinic.example.test')}`), 'recording skill should live under userData/skills/<domain>')
  assert(!recorded.path.includes(`${join('.agents', 'skills')}`), 'new recording skills should not be saved under legacy .agents')

  const recordedDir = dirname(recorded.path)
  for (const rel of ['SKILL.md', 'recipe.json', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'agents/openai.yaml', 'skill-audit.json']) {
    assert(existsSync(join(recordedDir, ...rel.split('/'))), `created recording skill should include ${rel}`)
  }

  const storedRecipeText = readFileSync(recorded.recipePath, 'utf8')
  const storedRecipe = JSON.parse(storedRecipeText)
  assert(!storedRecipeText.includes('Jane Recorded'), 'stored recipe should not contain recorded patient names')
  assert(!storedRecipeText.includes('+62 812'), 'stored recipe should not contain recorded patient phones')
  assert(!storedRecipeText.includes('eyJaaaaaaaaaaaa'), 'stored recipe should not contain JWT-like auth')
  assert(!storedRecipeText.includes('csrf-secret'), 'stored recipe should not contain recorded CSRF values')
  assert(storedRecipe.inputs.every((input) => !input.example), 'stored recipe inputs should not keep recorded examples')
  assert(storedRecipe.steps[0]?.valueTemplate === undefined, 'literal UI values should be dropped')
  assert(storedRecipe.steps[1]?.valueTemplate === '{{patient_phone}}', 'variable UI templates should be preserved')
  assert(storedRecipe.steps.every((step) => !step.originalValue && !step.yaml), 'recorded UI values and step YAML should be dropped')
  assert(storedRecipe.network[1]?.headers?.['content-type'] === 'application/json', 'static safe headers may remain')
  assert(!storedRecipe.network[1]?.headers?.Authorization && !storedRecipe.network[1]?.headers?.Cookie, 'dynamic auth headers should be dropped')
  assert(!storedRecipe.network[1]?.headerPolicy?.some((item) => item.fallback), 'dynamic header policy fallbacks should be dropped')
  assert(storedRecipe.network.every((item) => item.responseBodyPreview === null || item.responseBodyPreview === undefined), 'response bodies should not persist in skills')
  assert(storedRecipe.network[1]?.requestBody && !storedRecipe.network[1].requestBody.includes('Jane Recorded'), 'request body should keep shape without values')
  assert(!storedRecipe.snapshots[0]?.yaml.includes('[value='), 'snapshot values should be stripped')

  const storedSkillText = readFileSync(recorded.path, 'utf8')
  assert(!storedSkillText.includes('eyJaaaaaaaaaaaa'), 'stored SKILL.md should redact JWT-like literals')
  assert(!storedSkillText.includes('3201234567890001'), 'stored SKILL.md should redact 16-digit IDs')
  assert(!storedSkillText.includes('P00123456789'), 'stored SKILL.md should redact BPJS-like IDs')
  const storedReadmeText = readFileSync(join(recordedDir, 'README.md'), 'utf8')
  assert(storedReadmeText.includes('| Name | Type | Required | Description |'), 'recording README should describe inputs without example values')
  assert(!storedReadmeText.includes('| Name | Type | Required | Example |'), 'recording README should not include an Example column')
  assert(!storedReadmeText.includes('Jane Recorded') && !storedReadmeText.includes('+62 812'), 'recording README should not contain recorded patient values')

  mkdirSync(join(recordedDir, 'archive', '20260630 12-00-00'), { recursive: true })
  writeFileSync(join(recordedDir, 'archive', '20260630 12-00-00', 'SKILL.md'), '# old archived copy\n', 'utf8')

  const exported = registry.exportSkillPackage(recorded.id, exportRoot)
  assert(exported.ok, `recording export should succeed: ${exported.error || exported.message}`)
  for (const rel of ['SKILL.md', 'recipe.json', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'agents/openai.yaml', 'coach-export.json', 'skill-audit.json']) {
    assert(existsSync(join(exported.path, ...rel.split('/'))), `recording export should include ${rel}`)
  }
  assert(!existsSync(join(exported.path, 'archive')), 'recording export should not include archived prior versions')
  const exportedRecipeText = readFileSync(join(exported.path, 'recipe.json'), 'utf8')
  assert(!exportedRecipeText.includes('Jane Recorded') && !exportedRecipeText.includes('eyJaaaaaaaaaaaa'), 'exported recipe should stay redacted')
  const exportedReadmeText = readFileSync(join(exported.path, 'README.md'), 'utf8')
  assert(exportedReadmeText.includes('| Name | Type | Required | Description |'), 'exported README should describe inputs without example values')
  assert(!exportedReadmeText.includes('| Name | Type | Required | Example |'), 'exported README should not include an Example column')
  assert(!exportedReadmeText.includes('Jane Recorded') && !exportedReadmeText.includes('+62 812'), 'exported README should not contain recorded patient values')
  const sidecar = readFileSync(join(exported.path, 'agents', 'openai.yaml'), 'utf8')
  assert(sidecar.includes('display_name') && sidecar.includes('default_prompt'), 'OpenAI sidecar should be usable for Codex discovery')

  const importRegistry = new SkillRegistryService(join(rootTmp, 'import-user-data'))
  const importedRecording = importRegistry.importSkillPackage(exported.path)
  assert(importedRecording.ok, `recording import should succeed: ${importedRecording.error || importedRecording.message}`)
  assert(importedRecording.skill?.source === 'recording', 'recording import should remain executable')
  assert(importedRecording.skill?.id !== recorded.id, 'recording import should mint a fresh id')
  assert(importRegistry.listSkillsForDomain('https://clinic.example.test/booking').some((skill) => skill.id === importedRecording.skill.id), 'imported recording skill should join site-scoped executable catalog')

  const imported = registry.importSkillPackage(packageDir)

  assert(imported.ok, `external markdown import should succeed: ${imported.error || imported.message}`)
  assert(imported.skill?.source === 'external', 'imported markdown package should be marked external')
  assert(imported.skill?.domain === 'external', 'imported markdown package should live in the external domain')
  assert(!imported.skill?.recipePath, 'external markdown package should not synthesize a recipe path')
  assert(imported.skill?.inputs[0]?.name === 'patient', 'frontmatter inputs should be parsed')
  assert(imported.skill?.triggers.includes('patient review'), 'frontmatter aliases should become triggers')

  const detail = registry.readSkillDetail(imported.skill.id)
  assert(detail?.externalOnly === true, 'detail should mark external-only skills')
  assert(detail?.runtime === 'external', 'detail runtime should be external')
  assert(detail?.body.includes('External Patient Check'), 'detail should retain markdown body')

  const byDomain = registry.listSkillsForDomain('https://clinic.example.test/patients')
  assert(!byDomain.some((skill) => skill.id === imported.skill.id), 'external skills should not join site-scoped executable catalog')

  const installedAgents = join(dirname(imported.skill.path), 'AGENTS.md')
  assert(existsSync(installedAgents), 'external import should keep or create AGENTS.md')

  const exportedExternal = registry.exportSkillPackage(imported.skill.id, exportRoot)
  assert(exportedExternal.ok, `external markdown export should succeed: ${exportedExternal.error || exportedExternal.message}`)
  for (const rel of ['SKILL.md', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'agents/openai.yaml', 'coach-export.json', 'skill-audit.json']) {
    assert(existsSync(join(exportedExternal.path, ...rel.split('/'))), `external export should include ${rel}`)
  }
  assert(!existsSync(join(exportedExternal.path, 'recipe.json')), 'external markdown export should not synthesize recipe.json')

  const deleted = registry.deleteSkill(imported.skill.id)
  assert(deleted.ok, 'external user-managed skill should be deletable')
} finally {
  rmSync(rootTmp, { recursive: true, force: true })
}

console.log('skill external import checks passed')
