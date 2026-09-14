import { throws } from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  // 交给 SDK 的模块要在这里显式指路,否则守卫报的是 `Cannot find module '@main/agent/...'`,
  // 看着像桥坏了,其实只是解析器没跟上搬迁。
  if (specifier.startsWith('@main/')) return join(root, 'main', `${specifier.slice('@main/'.length)}.ts`)
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
const { DEFAULT_PRESET_MODEL, LLM_PRESETS, normalizeLlmTarget, requireSelectableLlmTarget } = loadTsModule('@maestro-main/llm/llmModels')
const { defaultLlmEffort } = loadTsModule('@maestro-shared/coach.api')
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
  // 固定首 tab 早已从远端 AI-CRMS 换成本地 Home,AI-CRMS 本身也于 2026-09 退役。
  // 守的仍是同一条时序:自定义启动 tab 必须排在固定首 tab 之后,不能抢它。
  assert(
    /loadPinnedHomeTab\(\)[\s\S]*this\.browserView\.openStartupTabIfNeeded\(/.test(createSource),
    'controller readiness should invoke the extracted custom-startup-tab flow after the pinned local Home load'
  )
  assert(!createSource.includes('demo.start()'), 'controller readiness should not add a local-demo startup fallback')
  assert(startupDocs.includes('Pinned local Bitterless Home tab'), 'embedded feature contract should preserve the pinned default tab')

  const service = new CoachSettingsService(dir)
  assert(service.read().startUrl === DEFAULT_START_URL, 'fresh settings should read the default startUrl')
  assert(service.read().llmModel === 'gpt-6-astra', 'fresh settings should keep the GPT-6 Astra default')
  assert(service.hasCustomStartUrl() === false, 'fresh settings should not be custom')
  assert(isDefaultStartUrl('') === true, 'blank startUrl should be treated as default')
  assert(isDefaultStartUrl(DEFAULT_START_URL) === true, 'default sentinel should be treated as no extra startup tab')
  assert(normalizeUrl('clinic.example.test') === 'http://clinic.example.test', 'schemeless host should normalize to http')

  const saved = service.save({ startUrl: 'clinic.example.test' })
  assert(saved.startUrl === 'http://clinic.example.test', 'custom startup host should normalize to http URL')
  assert(service.hasCustomStartUrl() === true, 'custom startup URL should be detected')

  // GPT-5.5 与 Claude 都已退役(Ral 2026-09-11:「应该也不用 gpt-5.5 了」「bl cowork 都不用 claude 的了」)。
  // 这里此前钉的是"保住 GPT-5.5 预设",那条随决定一起作废 —— 换成钉**退役之后的**两件事,
  // 因为它们才是会静默坏掉的:
  //   ① 预设列表里不再有它;
  //   ② 用户**已经存下**的 gpt-5.5 / claude target 仍要能优雅降级到一个活着的预设。
  //      漏掉 ② 的话老用户的设置会指向一个不存在的模型,而这不会报错 —— 只会在发消息时才炸。
  assert(
    !LLM_PRESETS.some((preset) => preset.model === 'gpt-5.5'),
    'GPT-5.5 已退役,不该再出现在预设列表里'
  )
  assert(
    JSON.stringify(LLM_PRESETS.filter((preset) => preset.provider === 'openai-codex').map((preset) => preset.model)) ===
      JSON.stringify(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']),
    'Codex choices must run from Astra through Sol and Terra to Luna, without retired Mini'
  )
  throws(
    () => requireSelectableLlmTarget({ provider: 'openai-codex', model: 'gpt-5.4-mini', effort: 'low' }),
    /Unknown LLM model/,
    'a new explicit model selection must reject retired Mini'
  )
  for (const retired of [
    { provider: 'openai-codex', model: 'gpt-5.5', effort: 'xhigh' },
    { provider: 'claude', model: 'claude-opus-4-8', effort: 'high' }
  ]) {
    const normalized = normalizeLlmTarget(retired)
    assert(
      LLM_PRESETS.some((preset) => preset.provider === normalized.provider && preset.model === normalized.model),
      `已存的退役 target ${retired.model} 必须降级到一个活着的预设,实得 ${normalized.provider}/${normalized.model}`
    )
    assert(normalized.effort === retired.effort, `降级应保留仍被支持的 effort ${retired.effort},实得 ${normalized.effort}`)
  }

  // 三处"默认模型"必须指同一个。它们分属设置初值、预设兜底、Agent 兜底,各自都能独立漂移,
  // 而漂移的表现是"新装的应用用 A,归一化兜底用 B" —— 没有任何一处会报错。
  assert(
    DEFAULT_PRESET_MODEL['openai-codex'] === service.read().llmModel,
    `设置初值与预设兜底必须一致:settings=${service.read().llmModel} preset=${DEFAULT_PRESET_MODEL['openai-codex']}`
  )
  assert(
    LLM_PRESETS.some((preset) => preset.model === DEFAULT_PRESET_MODEL['openai-codex']),
    '默认模型必须是一个真实存在的预设'
  )

  // Ral 2026-09-11:「默认模型统一到 gpt-6-astra medium effort」。
  // **默认档不是 `efforts[0]`** —— astra 的列表按降序给 picker 用(max..low),默认落在中间。
  // 2026-09-11 之前 bl 三处都写 `efforts[0]`,等于把 medium 静静改成 low,且**不报错**。
  const astra = LLM_PRESETS.find((preset) => preset.model === 'gpt-6-astra')
  assert(astra?.effort === 'medium', `astra 预设默认档必须是 medium,实得 ${astra?.effort}`)
  assert(defaultLlmEffort(astra) === 'medium', `defaultLlmEffort(astra) 必须是 medium,实得 ${defaultLlmEffort(astra)}`)
  assert(astra.efforts[0]?.id !== 'medium', '这条断言的前提是 medium 不是 efforts[0];前提没了就该重写它,而不是让它恒真')
  assert(service.read().llmEffort === 'medium', `新装设置的 effort 必须是 medium,实得 ${service.read().llmEffort}`)
  // 归一化路径也必须给出 medium:传一个该模型不支持的档,应回落到**声明的默认**而不是最低档。
  assert(
    normalizeLlmTarget({ provider: 'openai-codex', model: 'gpt-6-astra', effort: 'bogus' }).effort === 'medium',
    '非法 effort 应回落到预设声明的默认档(medium),不是 efforts[0]'
  )

  // 老设置必须从磁盘读出 Luna,随后保存也要落盘为 Luna;会话 target 走另一条归一化入口。
  const legacyDir = mkdtempSync(join(dir, 'legacy-model-'))
  const legacyFile = join(legacyDir, 'coach-settings.json')
  const legacyService = new CoachSettingsService(legacyDir)
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    writeFileSync(legacyFile, JSON.stringify({ llmProvider: 'codex', llmModel: ' gpt-5.4-mini ', llmEffort: effort }))
    const migrated = legacyService.read()
    assert(migrated.llmProvider === 'openai-codex' && migrated.llmModel === 'gpt-5.6-luna', 'saved Mini settings must load as Codex Luna')
    assert(migrated.llmEffort === effort, `saved Mini settings must retain supported effort ${effort}`)
    legacyService.save({ startUrl: 'clinic.example.test' })
    const persisted = JSON.parse(readFileSync(legacyFile, 'utf8'))
    assert(persisted.llmModel === 'gpt-5.6-luna' && persisted.llmEffort === effort, 'saving migrated settings must persist Luna and its effort')
    for (const provider of ['openai-codex', 'codex', 'openai']) {
      const target = normalizeLlmTarget({ provider, model: ' gpt-5.4-mini ', effort })
      assert(target.provider === 'openai-codex' && target.model === 'gpt-5.6-luna', `saved ${provider} Mini conversation targets must migrate to Luna`)
      assert(target.effort === effort, `migrated Mini conversation targets must retain supported effort ${effort}`)
    }
  }
  assert(
    normalizeLlmTarget({ provider: 'openai-codex', model: 'gpt-5.4-mini', effort: 'bogus' }).effort === 'low',
    'a migrated Mini target with unsupported effort must use the Luna default'
  )
  for (const preset of LLM_PRESETS) {
    for (const { id: effort } of preset.efforts) {
      const target = requireSelectableLlmTarget({ provider: preset.provider, model: preset.model, effort })
      assert(target.model === preset.model && target.effort === effort, `active ${preset.model}/${effort} targets must remain unchanged`)
      const activeSettings = legacyService.save({ llmProvider: preset.provider, llmModel: preset.model, llmEffort: effort })
      assert(activeSettings.llmModel === preset.model && activeSettings.llmEffort === effort, `active ${preset.model}/${effort} settings must remain unchanged`)
    }
  }

  const reset = service.save({ startUrl: '' })
  assert(reset.startUrl === DEFAULT_START_URL, 'blank saved startUrl should reset to default')
  assert(service.hasCustomStartUrl() === false, 'reset startup URL should not be custom')

  console.log('[check-startup-settings] ok', JSON.stringify({
    defaultSentinel: DEFAULT_START_URL,
    defaultRoute: 'pinned-local-home',
    custom: saved.startUrl,
    reset: reset.startUrl,
    resetRoute: 'pinned-local-home'
  }))
} catch (err) {
  console.error('[check-startup-settings] failed')
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
