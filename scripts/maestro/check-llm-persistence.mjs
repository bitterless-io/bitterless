import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const read = (relativePath) => {
  const [processName, ...rest] = relativePath.split('/')
  return readFileSync(join(root, processName, 'maestro', ...rest), 'utf8')
}
const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')

const controlApp = read('renderer/control/src/ControlApp.vue')
const llmService = read('main/llm/maestroLlm.service.ts')
const configApi = read('shared/config.api.ts')
const embeddedFeature = readProject('docs/features/maestro.md')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(configApi.includes("export const LLM_CONFIG_DOMAIN = 'llm'"), 'shared config should define the llm domain')
assert(configApi.includes("export const LLM_TARGET_KEY = 'active-target'"), 'shared config should define the active target key')
assert(llmService.includes('private async readStoredLlmTarget'), 'main LLM service should read persisted target')
assert(llmService.includes('parseStoredLlmTarget(fromDb?.options)'), 'main LLM service should parse active target from ConfigDao')
assert(llmService.includes('configStore.upsert({ domain: LLM_CONFIG_DOMAIN, key: LLM_TARGET_KEY, options: target })'), 'setLlmConfig should persist active target to ConfigDao')
assert(llmService.includes('fallback.llmProvider') && llmService.includes('fallback.llmModel'), 'main LLM service should keep legacy settings fallback for migration')
assert(controlApp.includes('const cfg = await coach.getLlmConfig()'), 'Control startup should load LLM target from main config')
assert(!controlApp.includes('coach.prefs'), 'Control must not persist LLM target in renderer localStorage')
assert(!controlApp.includes('saveLlmPrefs'), 'Control must not mirror LLM target into local prefs')
assert(!/loadControlConfig[\s\S]*coach\.setLlmConfig/.test(controlApp), 'Control startup must not overwrite ConfigDao with stale renderer prefs')
assert(controlApp.includes('needsLlmLogin') && controlApp.includes('loginActiveProvider'), 'Control should show a login entry when the selected model is not ready')
assert(embeddedFeature.includes('provider/model/effort/compression selection'), 'embedded feature contract should preserve model selection')

console.log('[check-llm-persistence] ok')
