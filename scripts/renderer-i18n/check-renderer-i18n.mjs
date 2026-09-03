/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')

const rendererEntries = [
  ['home', 'src/renderer/home/src/main.ts'],
  ['todo', 'src/renderer/todo/src/main.ts'],
  ['eyesOnAgents', 'src/renderer/eyesOnAgents/src/main.ts'],
  ['translator', 'src/renderer/translator/src/main.ts'],
  ['motto', 'src/renderer/motto/src/main.ts'],
  ['connector', 'src/renderer/connector/src/main.ts'],
  ['omniWindow', 'src/renderer/omni/omniWindow/src/main.ts'],
  ['omniControl', 'src/renderer/omni/omniControl/src/main.ts'],
  ['omniCell', 'src/renderer/omni/omniCell/src/main.ts'],
  ['maestroHome', 'src/renderer/maestro/home/src/main.ts'],
  ['maestroControl', 'src/renderer/maestro/control/src/control.ts'],
  ['maestroWorkbench', 'src/renderer/maestro/workbench/src/workbench.ts'],
  ['onlyPreviewShell', 'src/renderer/onlypreview/shell/src/main.ts'],
  ['onlyPreviewPreview', 'src/renderer/onlypreview/preview/src/main.ts'],
  ['onlyPreviewSettings', 'src/renderer/onlypreview/settings/src/main.ts'],
  ['onlyPreviewGuide', 'src/renderer/onlypreview/guide/src/main.ts']
]

assert.equal(rendererEntries.length, 16, 'renderer i18n inventory must own exactly sixteen entries')
assert.equal(new Set(rendererEntries.map(([name]) => name)).size, rendererEntries.length)

for (const [name, path] of rendererEntries) {
  const source = readProject(path)
  const isOnlyPreview = name.startsWith('onlyPreview')
  const initializer = isOnlyPreview
    ? 'initializeOnlyPreviewI18n()'
    : 'initializeRendererLanguage()'
  const languageStartIndex = source.indexOf(initializer)
  const initializeIndex = source.indexOf(`await ${initializer}`)
  const productImportIndex = source.indexOf("import('./")
  const createIndex = source.indexOf('createApp(')
  const pluginIndex = source.indexOf('.use(i18n)')
  const mountIndex = source.indexOf(".mount('#app')")

  if (isOnlyPreview) {
    assert(
      source.includes("common/onlyPreviewI18n"),
      `${name} must import the OnlyPreview catalog backed by shared language initialization`
    )
  } else {
    assert(source.includes("@renderer/common/i18n/rendererLanguage"), `${name} must import shared language initialization`)
    assert(source.includes("@renderer/common/i18n/i18n.helper"), `${name} must import the shared Vue i18n plugin`)
  }
  assert(languageStartIndex >= 0, `${name} must start shared language initialization`)
  if (name === 'home') {
    assert.equal(initializeIndex, -1, 'home language initialization must not gate Vue mount')
    assert(
      source.includes('initializeRendererLanguage().catch('),
      'home must observe background language initialization failures'
    )
  } else {
    assert(initializeIndex >= 0, `${name} must await shared language initialization`)
  }
  assert(productImportIndex > languageStartIndex, `${name} must start language initialization before evaluating product UI`)
  assert(createIndex > languageStartIndex, `${name} must start language initialization before createApp`)
  if (isOnlyPreview) {
    const catalogIndex = source.indexOf(".provide('onlyPreviewI18n'")
    assert(catalogIndex > createIndex && catalogIndex < mountIndex, `${name} must provide its localized catalog before mount`)
    assert(mountIndex > catalogIndex, `${name} must mount only after catalog installation`)
  } else {
    assert(pluginIndex > createIndex && pluginIndex < mountIndex, `${name} must install Vue i18n before mount`)
    assert(mountIndex > pluginIndex, `${name} must mount only after plugin install`)
  }
}

const onlyPreviewCatalog = readProject('src/renderer/onlypreview/common/onlyPreviewI18n.ts')
assert(
  onlyPreviewCatalog.includes('await initializeRendererLanguage()'),
  'OnlyPreview must resolve language through the shared Main-owned language service'
)
assert(
  onlyPreviewCatalog.includes("const zh: Localized<typeof en>"),
  'OnlyPreview must keep its English and Chinese catalogs structurally aligned'
)
assert(!onlyPreviewCatalog.includes('navigator.language'), 'OnlyPreview must not infer language locally')
assert(!onlyPreviewCatalog.includes('localStorage'), 'OnlyPreview must not persist a renderer-local language')

const englishMessages = readProject('src/renderer/common/i18n/en.ts')
const chineseMessages = readProject('src/renderer/common/i18n/zh.ts')
for (const [language, source, updateTitle] of [
  ['en', englishMessages, 'Update to {version}'],
  ['zh', chineseMessages, '更新到 {version}']
]) {
  assert.match(
    source,
    /menuBar:\s*\{[\s\S]*?restartToUpdate: 'Update'/,
    `${language} must expose the exact compact update label`
  )
  assert.match(
    source,
    /menuBar:\s*\{[\s\S]*?downloadingUpdate: 'Downloading'/,
    `${language} must expose the exact compact downloading label`
  )
  assert(
    source.includes(`updateToVersion: '${updateTitle}'`),
    `${language} must localize the target-version update title`
  )
}

// Home and Omni only ever render the ready state, so they keep the bare interpolation. Maestro is
// the one surface that also shows the download in progress, so it selects between the two shared
// labels instead.
for (const [surface, path] of [
  ['Home', 'src/renderer/home/src/components/MenuBar/MenuBar.vue'],
  ['Omni', 'src/renderer/omni/omniWindow/src/App.vue']
]) {
  const source = readProject(path)
  assert(
    source.includes('{{ i18nHelper.menuBar.restartToUpdate }}'),
    `${surface} update action must use the shared compact label`
  )
}

const maestroMenuBar = readProject('src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue')
assert(
  maestroMenuBar.includes('i18nHelper.menuBar.downloadingUpdate') &&
    maestroMenuBar.includes('i18nHelper.menuBar.restartToUpdate'),
  'Maestro update action must select between the two shared compact labels'
)

const omniMenuBar = readProject('src/renderer/omni/omniWindow/src/App.vue')
assert(
  omniMenuBar.includes("i18nHelper.menuBar.updateToVersion.replace("),
  'Omni update title must interpolate shared renderer i18n'
)
assert(!omniMenuBar.includes('`Update to ${'), 'Omni update title must not hard-code English')

const rendererI18n = readProject('src/renderer/common/i18n/i18n.helper.ts')
assert(!rendererI18n.includes('navigator.language'), 'renderer i18n must not infer the runtime language from the browser')
assert(!rendererI18n.includes("localStorage.getItem('lang')"), 'renderer i18n must not read a renderer-local language')
assert(!rendererI18n.includes("localStorage.setItem('lang'"), 'renderer i18n must not persist a renderer-local language')
assert(
  rendererI18n.includes('document.documentElement.lang = language'),
  'every applied renderer language must update the document lang attribute'
)

const rendererBootstrap = readProject('src/renderer/common/i18n/rendererLanguage.ts')
assert(
  rendererBootstrap.indexOf('subscribeBeforeFetch()') < rendererBootstrap.indexOf('getCurrentLanguage()'),
  'renderer bootstrap must subscribe before fetching current language'
)
assert(rendererBootstrap.includes('snapshot.revision < appliedSnapshot.revision'), 'renderer bootstrap must reject stale fetch results')
assert(rendererBootstrap.includes('parseApplicationLanguageSnapshot'), 'renderer bootstrap must validate main snapshots')

const appMain = readProject('src/main/app.main.ts')
const startGuiIndex = appMain.indexOf('const startGui = async')
const optionalIntegrationsDefinitionIndex = appMain.indexOf(
  'const startOptionalIntegrations = async',
  startGuiIndex
)
const startGuiSource = appMain.slice(startGuiIndex, optionalIntegrationsDefinitionIndex)
const guiStartup = readProject('src/main/startup/guiStartup.service.ts')
const sqliteCreateIndex = appMain.indexOf('sqliteWindowHelper.create(')
const sqliteReadyIndex = appMain.indexOf('coreSqliteBoot.ready({ targetId })')
const mainLanguageIndex = appMain.indexOf('applicationLanguageService.initialize()')
const homeCreateIndex = appMain.indexOf('mainWindowHelper.create(')
const shimCreateIndex = appMain.indexOf('await mcpHandler.ensureShim()')
const trayCreateIndex = appMain.indexOf('trayHelper.init(mainWindowHelper)')
const optionalStartIndex = appMain.indexOf('optionalIntegrationsLifecycle.start(')
const earlyQuitFallbackIndex = appMain.lastIndexOf(
  'initializeApplicationLanguageFallback();',
  appMain.indexOf('await dialogHelper.showQuitConfirmDialog()')
)
assert(sqliteReadyIndex > sqliteCreateIndex, 'Core readiness must be observed after starting SQLite')
assert(
  startGuiSource.includes('initializeApplicationLanguageFallback()'),
  'normal GUI startup must initialize an in-memory language fallback'
)
assert(!appMain.includes('did-finish-load'), 'HTML load completion must not gate Core SQLite startup')
assert(guiStartup.indexOf('dependencies.startCoreSqlite()') < guiStartup.indexOf('dependencies.initializeLanguageFallback()'), 'SQLite must start before the foreground fallback')
assert(guiStartup.indexOf('dependencies.initializeLanguageFallback()') < guiStartup.indexOf('dependencies.createHome()'), 'fallback must initialize before Home')
assert(guiStartup.includes('void coreSqliteResult'), 'foreground startup must not await Core SQLite')
assert(mainLanguageIndex >= 0, 'persisted language must hydrate after Core success')
assert(shimCreateIndex > homeCreateIndex, 'MCP shim refresh must follow Home creation')
assert(trayCreateIndex > homeCreateIndex, 'Tray must follow Home creation')
assert(optionalStartIndex > homeCreateIndex, 'optional startup must begin only after Home creation')
assert(
  earlyQuitFallbackIndex >= 0,
  'early macOS quit must retain its localized-dialog fallback'
)
assert(appMain.includes("startupDiagnosticsService.report('core-sqlite', err)"), 'Core failure must publish a startup diagnostic')
assert(!appMain.includes('app.exit(1)'), 'Core failure must not exit the GUI')

const mainWindow = readProject('src/main/windows/mainWindow.helper.ts')
assert(
  mainWindow.indexOf('const window = super.create()') < mainWindow.indexOf('async hydratePersistedLayout()'),
  'Home must be created with default bounds before persisted layout hydration'
)
assert(
  !mainWindow.includes('withStartupTimeout(this.loadLayout()'),
  'persisted layout hydration must not gate foreground Home startup'
)
assert(
  mainWindow.includes('if (!canCreate()) return null'),
  'Home creation must stop if shutdown wins its persisted layout wait'
)

const sqliteWindow = readProject('src/main/windows/sqliteWindow.helper.ts')
assert(
  sqliteWindow.includes('protected showOnReady = false'),
  'the internal Core SQLite window must remain hidden in every environment'
)

const mainHandler = readProject('src/main/xpc/applicationLanguage.handler.ts')
assert(mainHandler.includes('implements ApplicationLanguageApi'), 'main language handler must implement the shared typed API')
assert(mainHandler.includes('applicationLanguageService.setLanguage'), 'Home changes must route through the main language service')

const mainCoordinator = readProject('src/shared/i18n/applicationLanguage.ts')
const persistIndex = mainCoordinator.indexOf('await this.persistence.write(language)')
const commitIndex = mainCoordinator.indexOf('this.snapshot = snapshot', persistIndex)
const applyIndex = mainCoordinator.indexOf('this.effects.apply(language)', persistIndex)
const broadcastIndex = mainCoordinator.indexOf('this.effects.broadcast(snapshot)', persistIndex)
assert(persistIndex >= 0, 'main coordination must await durable persistence')
assert(commitIndex > persistIndex, 'runtime language must change only after persistence')
assert(applyIndex > commitIndex, 'main i18n/tray update must follow committed runtime state')
assert(broadcastIndex > applyIndex, 'main broadcast must follow persistence and main effects')

const homeLanguageFiles = [
  'src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts',
  'src/renderer/home/src/views/setting/components/LanguageSetting/languageSetting.store.ts'
]
for (const path of homeLanguageFiles) {
  const source = readProject(path)
  assert(source.includes('requestApplicationLanguageChange'), `${path} must request changes from main`)
  assert(!source.includes("broadcast('language/changed'"), `${path} must not broadcast authoritative language changes`)
  assert(!source.includes("createXpcRendererEmitter<LanguageHandler>"), `${path} must not write durable language directly`)
}

const obsoleteSubscriberDirectories = [
  'src/renderer/home/src/xpc',
  'src/renderer/todo/src/xpc',
  'src/renderer/omni/omniWindow/src/xpc',
  'src/renderer/omni/omniControl/src/xpc',
  'src/renderer/omni/omniCell/src/xpc'
]
for (const directory of obsoleteSubscriberDirectories) {
  assert(
    !existsSync(join(projectRoot, directory, 'language.subscriber.ts')),
    `${directory} must use only the shared language subscriber`
  )
}

const transpiled = ts.transpileModule(mainCoordinator, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  },
  reportDiagnostics: true,
  fileName: 'applicationLanguage.ts'
})
assert.equal(
  transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length || 0,
  0,
  'application language contract must transpile without diagnostics'
)
const contractModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
)
const {
  ApplicationLanguageCoordinator,
  ApplicationLanguageContractError,
  resolveSystemAppLanguage
} = contractModule

assert.equal(resolveSystemAppLanguage('zh-CN'), 'zh')
assert.equal(resolveSystemAppLanguage('ZH_hant'), 'zh')
assert.equal(resolveSystemAppLanguage('en-US'), 'en')
assert.equal(resolveSystemAppLanguage('fr-FR'), 'en')
assert.equal(resolveSystemAppLanguage(undefined), 'en')

const fallbackEvents = []
let releaseFallbackRead
const fallbackReadGate = new Promise((resolveGate) => {
  releaseFallbackRead = resolveGate
})
const fallbackCoordinator = new ApplicationLanguageCoordinator(
  {
    read: async () => {
      fallbackEvents.push('read:start')
      const language = await fallbackReadGate
      fallbackEvents.push(`read:end:${language}`)
      return language
    },
    write: async () => undefined
  },
  {
    apply: (language) => fallbackEvents.push(`apply:${language}`),
    broadcast: (snapshot) => fallbackEvents.push(`broadcast:${snapshot.language}:${snapshot.revision}`)
  }
)
assert.deepEqual(fallbackCoordinator.initializeFallback('en'), { language: 'en', revision: 0 })
assert.deepEqual(fallbackCoordinator.getSnapshot(), { language: 'en', revision: 0 })
assert.deepEqual(fallbackEvents, ['apply:en'])
const pendingFallbackHydration = fallbackCoordinator.initialize()
await Promise.resolve()
assert.deepEqual(fallbackCoordinator.getSnapshot(), { language: 'en', revision: 0 })
assert.deepEqual(fallbackEvents, ['apply:en', 'read:start'])
releaseFallbackRead('zh')
assert.deepEqual(await pendingFallbackHydration, { language: 'zh', revision: 1 })
assert.deepEqual(fallbackEvents, [
  'apply:en',
  'read:start',
  'read:end:zh',
  'apply:zh',
  'broadcast:zh:1'
])

const sameFallbackEffects = []
const sameFallbackCoordinator = new ApplicationLanguageCoordinator(
  { read: async () => 'zh', write: async () => undefined },
  {
    apply: (language) => sameFallbackEffects.push(`apply:${language}`),
    broadcast: (snapshot) => sameFallbackEffects.push(`broadcast:${snapshot.language}`)
  }
)
sameFallbackCoordinator.initializeFallback('zh')
assert.deepEqual(await sameFallbackCoordinator.initialize(), { language: 'zh', revision: 0 })
assert.deepEqual(sameFallbackEffects, ['apply:zh'])

const invalidPersistedEffects = []
const invalidPersistedCoordinator = new ApplicationLanguageCoordinator(
  { read: async () => 'fr', write: async () => undefined },
  {
    apply: (language) => invalidPersistedEffects.push(`apply:${language}`),
    broadcast: (snapshot) => invalidPersistedEffects.push(`broadcast:${snapshot.language}`)
  }
)
invalidPersistedCoordinator.initializeFallback('en')
await assert.rejects(
  invalidPersistedCoordinator.initialize(),
  (error) => error instanceof ApplicationLanguageContractError && error.code === 'INVALID_APP_LANGUAGE'
)
assert.deepEqual(invalidPersistedCoordinator.getSnapshot(), { language: 'en', revision: 0 })
assert.deepEqual(invalidPersistedEffects, ['apply:en'])

const invalidFallbackCoordinator = new ApplicationLanguageCoordinator(
  { read: async () => 'en', write: async () => undefined },
  { apply: () => undefined, broadcast: () => undefined }
)
assert.throws(
  () => invalidFallbackCoordinator.initializeFallback('fr'),
  (error) => error instanceof ApplicationLanguageContractError && error.code === 'INVALID_APP_LANGUAGE'
)

const invalidCoordinator = new ApplicationLanguageCoordinator(
  { read: async () => 'fr', write: async () => undefined },
  { apply: () => undefined, broadcast: () => undefined }
)
await assert.rejects(
  invalidCoordinator.initialize(),
  (error) => error instanceof ApplicationLanguageContractError && error.code === 'INVALID_APP_LANGUAGE'
)

const events = []
let releasePersistence
const persistenceGate = new Promise((resolveGate) => {
  releasePersistence = resolveGate
})
const coordinator = new ApplicationLanguageCoordinator(
  {
    read: async () => {
      events.push('read')
      return 'en'
    },
    write: async (language) => {
      events.push(`persist:start:${language}`)
      await persistenceGate
      events.push(`persist:end:${language}`)
    }
  },
  {
    apply: (language) => events.push(`apply:${language}`),
    broadcast: (snapshot) => events.push(`broadcast:${snapshot.language}:${snapshot.revision}`)
  }
)

assert.deepEqual(await coordinator.initialize(), { language: 'en', revision: 0 })
assert.deepEqual(events, ['read', 'apply:en'])

const pendingChange = coordinator.setLanguage('zh')
await Promise.resolve()
assert.deepEqual(
  events,
  ['read', 'apply:en', 'persist:start:zh'],
  'main effects and broadcast must wait for persistence completion'
)
releasePersistence()
assert.deepEqual(await pendingChange, { language: 'zh', revision: 1 })
assert.deepEqual(events, [
  'read',
  'apply:en',
  'persist:start:zh',
  'persist:end:zh',
  'apply:zh',
  'broadcast:zh:1'
])

const eventCountAfterCommit = events.length
assert.deepEqual(await coordinator.setLanguage('zh'), { language: 'zh', revision: 1 })
assert.equal(events.length, eventCountAfterCommit, 'duplicate language delivery must be idempotent')

const overlappingEvents = []
let releaseFirstOverlappingWrite
const firstOverlappingWriteGate = new Promise((resolveGate) => {
  releaseFirstOverlappingWrite = resolveGate
})
let overlappingWriteCount = 0
const overlappingCoordinator = new ApplicationLanguageCoordinator(
  {
    read: async () => 'en',
    write: async (language) => {
      overlappingWriteCount += 1
      overlappingEvents.push(`persist:start:${language}`)
      if (overlappingWriteCount === 1) await firstOverlappingWriteGate
      overlappingEvents.push(`persist:end:${language}`)
    }
  },
  {
    apply: (language) => overlappingEvents.push(`apply:${language}`),
    broadcast: (snapshot) => overlappingEvents.push(`broadcast:${snapshot.language}:${snapshot.revision}`)
  }
)

await overlappingCoordinator.initialize()
overlappingEvents.length = 0
const earlierChange = overlappingCoordinator.setLanguage('zh')
await Promise.resolve()
assert.deepEqual(overlappingEvents, ['persist:start:zh'])

let newerChangeResolved = false
const newerChange = overlappingCoordinator.setLanguage('en').then((snapshot) => {
  newerChangeResolved = true
  return snapshot
})
await Promise.resolve()
await Promise.resolve()
assert.equal(
  newerChangeResolved,
  false,
  'a newer reverse change must wait for the earlier authoritative mutation'
)
assert.deepEqual(
  overlappingEvents,
  ['persist:start:zh'],
  'a newer reverse change must not compare against a stale committed snapshot'
)

releaseFirstOverlappingWrite()
assert.deepEqual(await earlierChange, { language: 'zh', revision: 1 })
assert.deepEqual(await newerChange, { language: 'en', revision: 2 })
assert.deepEqual(overlappingCoordinator.getSnapshot(), { language: 'en', revision: 2 })
assert.deepEqual(overlappingEvents, [
  'persist:start:zh',
  'persist:end:zh',
  'apply:zh',
  'broadcast:zh:1',
  'persist:start:en',
  'persist:end:en',
  'apply:en',
  'broadcast:en:2'
])

const failedEffects = []
const failedCoordinator = new ApplicationLanguageCoordinator(
  {
    read: async () => 'en',
    write: async () => {
      throw new Error('simulated persistence failure')
    }
  },
  {
    apply: (language) => failedEffects.push(`apply:${language}`),
    broadcast: (snapshot) => failedEffects.push(`broadcast:${snapshot.language}`)
  }
)
await failedCoordinator.initialize()
failedEffects.length = 0
await assert.rejects(failedCoordinator.setLanguage('zh'), /simulated persistence failure/)
assert.deepEqual(failedCoordinator.getSnapshot(), { language: 'en', revision: 0 })
assert.deepEqual(failedEffects, [], 'failed persistence must not update main state or broadcast')

console.log('[check-renderer-i18n] ok')
