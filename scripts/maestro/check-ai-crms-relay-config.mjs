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

for (const file of [
  'main/networking/clients/relay.client.ts',
  'main/networking/api/aiCrmsRelay.api.ts',
  'renderer/common/networking/clients/endpoint.client.ts',
  'renderer/common/networking/api/coachEndpoint.api.ts',
  'shared/networking/coachEndpoint.ts',
  'shared/networking/coachRegion.ts'
]) {
  const [processName, ...rest] = file.split('/')
  assert(existsSync(join(root, processName, 'maestro', ...rest)), `networking layer file should exist: ${file}`)
}

const electronViteConfig = readFileSync(join(projectRoot, 'electron.vite.config.ts'), 'utf8')
const rendererEndpointClient = readFileSync(join(root, 'renderer/maestro/common/networking/clients/endpoint.client.ts'), 'utf8')
const rendererEndpointApi = readFileSync(join(root, 'renderer/maestro/common/networking/api/coachEndpoint.api.ts'), 'utf8')
const mainRelayClient = readFileSync(join(root, 'main/maestro/networking/clients/relay.client.ts'), 'utf8')

assert(electronViteConfig.includes('VITE_COACH_REGION'), 'build config should read VITE_COACH_REGION')
assert(electronViteConfig.includes('VITE_COACH_AI_CRMS_RELAY_BASE_URL_SG'), 'build config should read SG relay URL')
assert(electronViteConfig.includes('VITE_COACH_AI_CRMS_RELAY_BASE_URL_HK'), 'build config should read HK relay URL')
assert(electronViteConfig.includes('VITE_COACH_AI_CRMS_RELAY_BASE_URL_ID'), 'build config should read ID relay URL')
assert(rendererEndpointClient.includes('@maestro-shared/networking/coachEndpoint'), 'renderer networking client should share endpoint resolution code')
assert(rendererEndpointApi.includes('rendererEndpointClient'), 'renderer networking API should wrap the renderer client')
assert(mainRelayClient.includes('process.env.COACH_AI_CRMS_RELAY_BASE_URL'), 'main relay client should support runtime endpoint override')

const clearLoadedTsModules = () => {
  moduleCache.clear()
}

const setBuildConstants = (values) => {
  for (const key of [
    '__COACH_BUILD_REGION__',
    '__COACH_AI_CRMS_RELAY_BASE_URL__',
    '__COACH_AI_CRMS_RELAY_BASE_URL_SG__',
    '__COACH_AI_CRMS_RELAY_BASE_URL_HK__',
    '__COACH_AI_CRMS_RELAY_BASE_URL_ID__'
  ]) {
    if (Object.hasOwn(values, key)) globalThis[key] = values[key]
    else delete globalThis[key]
  }
}

process.env.COACH_AI_CRMS_RELAY_BASE_URL = 'https://id-relay.example.test/v1'

const { buildAiCrmsPiProviderConfig } = loadTsModule('@maestro-main/networking/api/aiCrmsRelay.api')

const config = buildAiCrmsPiProviderConfig({
  session: {
    jwt_token: 'relay-test-token',
    tenant_id: 'workspace-id-node',
    region: 'ID',
    ts: Date.now()
  },
  compressionRemainingPercent: 12
})
const model = config.models[0]

assert(config.baseUrl === 'https://id-relay.example.test/v1', 'runtime relay override should win')
assert(config.api === 'openai-completions', 'AI-CRMS relay must use OpenAI Chat Completions transport')
assert(config.apiKey === 'relay-test-token', 'session token should be used as provider apiKey')
assert(config.authHeader === true, 'provider should emit Authorization header through pi')
assert(config.headers['x-region'] === 'ID', 'ID region header should be preserved')
assert(config.headers['x-workspace-id'] === 'workspace-id-node', 'workspace header should be preserved')
assert(config.compat.supportsStore === false, 'relay should not receive OpenAI store flag')
assert(config.compat.supportsDeveloperRole === false, 'relay should receive system-compatible roles only')
assert(config.compat.supportsReasoningEffort === false, 'relay should not receive reasoning_effort')
assert(config.compat.supportsUsageInStreaming === true, 'relay should request streaming usage')
assert(config.compat.maxTokensField === 'max_tokens', 'relay should use max_tokens')
assert(config.compat.thinkingFormat === 'qwen', 'relay should use qwen thinking compatibility')
assert(config.compat.supportsStrictMode === false, 'relay tools should not receive strict flag')
assert(model.id === 'qwen3.7-plus', 'Qwen model id should remain stable')
assert(model.input.includes('text') && model.input.includes('image'), 'Qwen model should advertise text and image input')
assert(model.compressionRemainingPercent === 12, 'compression preference should be carried into pi model config')

delete process.env.COACH_AI_CRMS_RELAY_BASE_URL
clearLoadedTsModules()
setBuildConstants({})

const {
  coachAiCrmsRelayBaseUrls: defaultRelayBaseUrls,
  resolveCoachAiCrmsRelayBaseUrl: resolveDefaultCoachAiCrmsRelayBaseUrl
} = loadTsModule('@maestro-shared/networking/coachEndpoint')

assert(defaultRelayBaseUrls.SG === 'https://llm.micromeet.ai/v1/bailian', 'SG default relay should use the stable SG/custom domain')
assert(defaultRelayBaseUrls.HK === 'https://relay-prod-hk-oxhyewvkbw.cn-hongkong.fcapp.run/v1/bailian', 'HK default relay should target relay-prod-hk')
assert(defaultRelayBaseUrls.ID === 'https://relay-prod-id-oxhyexskbw.ap-southeast-5.fcapp.run/v1/bailian', 'ID default relay should target relay-prod-id')
assert(resolveDefaultCoachAiCrmsRelayBaseUrl('ID') === 'https://relay-prod-id-oxhyexskbw.ap-southeast-5.fcapp.run/v1/bailian', 'ID resolver should not fall back to SG when build env is missing')

clearLoadedTsModules()
setBuildConstants({
  __COACH_BUILD_REGION__: 'ID',
  __COACH_AI_CRMS_RELAY_BASE_URL__: 'https://shared-relay.example.test/v1',
  __COACH_AI_CRMS_RELAY_BASE_URL_SG__: 'https://sg-relay.example.test/v1/',
  __COACH_AI_CRMS_RELAY_BASE_URL_HK__: 'https://hk-relay.example.test/v1/',
  __COACH_AI_CRMS_RELAY_BASE_URL_ID__: 'https://id-build-relay.example.test/v1/'
})

const {
  coachBuildRegion,
  coachAiCrmsRelayBaseUrls,
  resolveCoachAiCrmsRelayBaseUrl,
  getCoachEndpointSnapshot
} = loadTsModule('@maestro-shared/networking/coachEndpoint')
const { buildAiCrmsPiProviderConfig: buildWithBuildConstants } = loadTsModule('@maestro-main/networking/api/aiCrmsRelay.api')
const hkConfig = buildWithBuildConstants({
  session: {
    jwt_token: 'relay-test-token',
    tenant_id: 'workspace-id-hk',
    region: 'HK',
    ts: Date.now()
  },
  compressionRemainingPercent: 15
})
const fallbackConfig = buildWithBuildConstants({
  session: {
    jwt_token: 'relay-test-token',
    tenant_id: '',
    region: 'unknown-region',
    ts: Date.now()
  },
  compressionRemainingPercent: 10
})
const snapshot = getCoachEndpointSnapshot()

assert(coachBuildRegion === 'ID', 'VITE_COACH_REGION define should set build region')
assert(coachAiCrmsRelayBaseUrls.SG === 'https://sg-relay.example.test/v1', 'SG build relay URL should trim trailing slash')
assert(coachAiCrmsRelayBaseUrls.HK === 'https://hk-relay.example.test/v1', 'HK build relay URL should trim trailing slash')
assert(coachAiCrmsRelayBaseUrls.ID === 'https://id-build-relay.example.test/v1', 'ID build relay URL should trim trailing slash')
assert(resolveCoachAiCrmsRelayBaseUrl('SG') === 'https://sg-relay.example.test/v1', 'SG resolver should select SG endpoint')
assert(resolveCoachAiCrmsRelayBaseUrl('HK') === 'https://hk-relay.example.test/v1', 'HK resolver should select HK endpoint')
assert(resolveCoachAiCrmsRelayBaseUrl('ID') === 'https://id-build-relay.example.test/v1', 'ID resolver should select ID endpoint')
assert(resolveCoachAiCrmsRelayBaseUrl('bad') === 'https://sg-relay.example.test/v1', 'invalid runtime region should fall back to SG endpoint')
assert(snapshot.buildRegion === 'ID', 'endpoint snapshot should expose build region')
assert(snapshot.aiCrmsRelayBaseUrls.ID === 'https://id-build-relay.example.test/v1', 'endpoint snapshot should expose per-region URLs')
assert(hkConfig.baseUrl === 'https://hk-relay.example.test/v1', 'main provider should use HK build relay when session region is HK')
assert(hkConfig.headers['x-region'] === 'HK', 'HK provider header should be preserved')
assert(fallbackConfig.baseUrl === 'https://sg-relay.example.test/v1', 'unknown session region should fall back to SG build relay')
assert(fallbackConfig.headers['x-region'] === 'SG', 'unknown session region header should normalize to SG')

console.log('[check-ai-crms-relay-config] ok', JSON.stringify({
  baseUrl: config.baseUrl,
  buildRegion: coachBuildRegion,
  hkBaseUrl: hkConfig.baseUrl,
  region: config.headers['x-region'],
  model: model.id,
  input: model.input
}))
