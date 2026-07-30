import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const workspaceRoot = projectRoot
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

const { CoachSettingsService, DEFAULT_START_URL, isDefaultStartUrl, normalizeUrl } = loadTsModule('@maestro-main/settings/coachSettings.service')
const { LLM_PRESETS, normalizeLlmTarget } = loadTsModule('@maestro-main/llm/llmModels')
const settingsSource = readFileSync(join(root, 'main/maestro/settings/coachSettings.service.ts'), 'utf8')
const controllerSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const browserViewSource = readFileSync(join(root, 'main/maestro/windows/main/maestroBrowserView.service.ts'), 'utf8')
const tabStoreSource = readFileSync(join(root, 'renderer/maestro/home/src/components/MenuBar/tab.store.ts'), 'utf8')
const startupDocs = readFileSync(join(workspaceRoot, 'docs/features/maestro.md'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'coach-startup-settings-'))

try {
  assert(settingsSource.includes('DEFAULT_COACH_START_URL'), 'main settings should use the shared startup sentinel')
  assert(tabStoreSource.includes('DEFAULT_COACH_START_URL'), 'renderer startup UI should use the shared startup sentinel')
  assert(!tabStoreSource.includes("settings.startUrl !== 'https://example.com'"), 'renderer should not hard-code the startup sentinel')
  assert(browserViewSource.includes('if (!this._state.hasCustomStartUrl()) return'), 'startup should not open a normal tab without a custom customer URL')
  assert(!browserViewSource.includes('hasCustomStartUrl() ? settings.startUrl : await') && !browserViewSource.includes('demo.start()'), 'startup should not default to local demo')
  const createMatch = controllerSource.match(/create\(\): BrowserWindow \{([\s\S]*?)\n  \}\n\n  async whenReady/)
  assert(createMatch, 'controller should keep a bounded create readiness flow')
  const createSource = createMatch?.[1] || ''
  assert(
    /loadURL\(AI_CRMS_URL\)[\s\S]*await this\.browserView\.openStartupTabIfNeeded\(\)/.test(createSource),
    'controller readiness should invoke the extracted custom-startup-tab flow after pinned AI-CRMS load'
  )
  assert(!createSource.includes('demo.start()'), 'controller readiness should not add a local-demo startup fallback')
  assert(startupDocs.includes('Pinned AI-CRMS tab'), 'embedded feature contract should preserve the pinned default tab')

  const service = new CoachSettingsService(dir)
  assert(service.read().startUrl === DEFAULT_START_URL, 'fresh settings should read the default startUrl')
  assert(service.read().llmModel === 'gpt-5.6-luna', 'fresh settings should keep the GPT-5.6 Luna default')
  assert(service.hasCustomStartUrl() === false, 'fresh settings should not be custom')
  assert(isDefaultStartUrl('') === true, 'blank startUrl should be treated as default')
  assert(isDefaultStartUrl(DEFAULT_START_URL) === true, 'default sentinel should be treated as no extra startup tab')
  assert(normalizeUrl('clinic.example.test') === 'http://clinic.example.test', 'schemeless host should normalize to http')

  const saved = service.save({ startUrl: 'clinic.example.test' })
  assert(saved.startUrl === 'http://clinic.example.test', 'custom startup host should normalize to http URL')
  assert(service.hasCustomStartUrl() === true, 'custom startup URL should be detected')

  const gpt55Preset = LLM_PRESETS.find((preset) => preset.provider === 'openai-codex' && preset.model === 'gpt-5.5')
  assert(gpt55Preset?.effort === 'low', 'Maestro should expose the preserved GPT-5.5 preset')
  const normalizedGpt55 = normalizeLlmTarget({
    provider: 'openai-codex',
    model: 'gpt-5.5',
    effort: 'xhigh'
  })
  assert(normalizedGpt55.model === 'gpt-5.5', 'Maestro target normalization should preserve stored GPT-5.5')
  assert(normalizedGpt55.effort === 'xhigh', 'Maestro should preserve a supported GPT-5.5 effort')
  const storedGpt55 = service.save({ llmModel: 'gpt-5.5', llmEffort: 'high' })
  assert(storedGpt55.llmModel === 'gpt-5.5', 'Maestro settings should preserve stored GPT-5.5')
  assert(storedGpt55.llmEffort === 'high', 'Maestro settings should preserve a supported GPT-5.5 effort')

  const reset = service.save({ startUrl: '' })
  assert(reset.startUrl === DEFAULT_START_URL, 'blank saved startUrl should reset to default')
  assert(service.hasCustomStartUrl() === false, 'reset startup URL should not be custom')

  console.log('[check-startup-settings] ok', JSON.stringify({
    defaultSentinel: DEFAULT_START_URL,
    defaultRoute: 'pinned-ai-crms',
    custom: saved.startUrl,
    reset: reset.startUrl,
    resetRoute: 'pinned-ai-crms'
  }))
} catch (err) {
  console.error('[check-startup-settings] failed')
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
