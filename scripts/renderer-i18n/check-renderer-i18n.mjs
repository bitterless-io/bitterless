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
  ['connector', 'src/renderer/connector/src/main.ts'],
  ['omniWindow', 'src/renderer/omni/omniWindow/src/main.ts'],
  ['omniControl', 'src/renderer/omni/omniControl/src/main.ts'],
  ['omniCell', 'src/renderer/omni/omniCell/src/main.ts'],
  ['maestroHome', 'src/renderer/maestro/home/src/main.ts'],
  ['maestroControl', 'src/renderer/maestro/control/src/control.ts'],
  ['maestroWorkbench', 'src/renderer/maestro/workbench/src/workbench.ts']
]

assert.equal(rendererEntries.length, 10, 'renderer i18n inventory must own exactly ten entries')
assert.equal(new Set(rendererEntries.map(([name]) => name)).size, rendererEntries.length)

for (const [name, path] of rendererEntries) {
  const source = readProject(path)
  const initializeIndex = source.indexOf('await initializeRendererLanguage()')
  const productImportIndex = source.indexOf("import('./")
  const createIndex = source.indexOf('createApp(')
  const pluginIndex = source.indexOf('.use(i18n)')
  const mountIndex = source.indexOf(".mount('#app')")

  assert(source.includes("@renderer/common/i18n/rendererLanguage"), `${name} must import shared language initialization`)
  assert(source.includes("@renderer/common/i18n/i18n.helper"), `${name} must import the shared Vue i18n plugin`)
  assert(initializeIndex >= 0, `${name} must await shared language initialization`)
  assert(productImportIndex > initializeIndex, `${name} must evaluate product UI only after language initialization`)
  assert(createIndex > initializeIndex, `${name} must initialize language before createApp`)
  assert(pluginIndex > createIndex && pluginIndex < mountIndex, `${name} must install Vue i18n before mount`)
  assert(mountIndex > pluginIndex, `${name} must mount only after language initialization and plugin install`)
}

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
const sqliteReadyIndex = appMain.indexOf('coreSqliteBoot.ready()')
const fallbackIndex = appMain.indexOf('initializeApplicationLanguageFallback();')
const startGuiIndex = appMain.indexOf('const startGui = async')
const firstStartGuiAwaitIndex = appMain.indexOf('await ', startGuiIndex)
const sqliteCreateIndex = appMain.indexOf('sqliteWindowHelper.create()', startGuiIndex)
const mainLanguageIndex = appMain.indexOf('applicationLanguageService.initialize()')
const homeCreateIndex = appMain.indexOf('await mainWindowHelper.create()')
const trayCreateIndex = appMain.indexOf('trayHelper.init(mainWindowHelper)')
const optionalStartIndex = appMain.indexOf('optionalIntegrationsLifecycle.start(')
const earlyQuitFallbackIndex = appMain.lastIndexOf(
  'initializeApplicationLanguageFallback();',
  appMain.indexOf('await dialogHelper.showQuitConfirmDialog()')
)
assert(sqliteReadyIndex >= 0, 'main startup must await core SQLite readiness')
assert(fallbackIndex > startGuiIndex, 'main startup must synchronously initialize a language fallback')
assert(fallbackIndex < firstStartGuiAwaitIndex, 'language fallback must precede the first GUI startup await')
assert(fallbackIndex < sqliteCreateIndex, 'language fallback must precede hidden SQLite creation')
assert(homeCreateIndex > sqliteCreateIndex, 'Home must follow the hidden SQLite document load')
assert(homeCreateIndex < sqliteReadyIndex, 'Core SQLite DAO readiness must not gate Home creation')
assert(homeCreateIndex < mainLanguageIndex, 'persisted language hydration must not gate Home creation')
assert(mainLanguageIndex > sqliteReadyIndex, 'persisted language may hydrate only after Core SQLite readiness')
assert(optionalStartIndex > homeCreateIndex, 'optional startup must begin only after Home creation')
assert(trayCreateIndex > fallbackIndex, 'Tray must be created after fallback language initialization')
assert(
  earlyQuitFallbackIndex >= 0,
  'early macOS quit must ensure fallback language before opening its localized dialog'
)

const mainWindow = readProject('src/main/windows/mainWindow.helper.ts')
assert(mainWindow.includes('MAIN_WINDOW_LAYOUT_TIMEOUT_MS'), 'saved layout reads need an explicit bound')
assert(
  mainWindow.includes('withStartupTimeout(this.loadLayout()'),
  'Home creation must bound the persisted layout read'
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
