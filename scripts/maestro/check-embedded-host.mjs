import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { assert, assertMaestroAliasBoundary, assertNoStandaloneEntry, readMaestro, readProject } from './_harness.mjs'

const require = createRequire(import.meta.url)

assertMaestroAliasBoundary()
assertNoStandaloneEntry()

const handler = readProject('src/main/xpc/maestroWindow.handler.ts')
const appMain = readProject('src/main/app.main.ts')
const dataRoot = readMaestro('main/data/maestroDataRoot.ts')
const vite = readProject('electron.vite.config.ts')
const card = readProject('src/renderer/home/src/views/miniApp/MiniApp.vue')
const apps = readProject('src/renderer/home/src/views/miniApp/miniApps.constant.ts')
const builder = readProject('electron-builder.yml')
const prepareCli = readProject('scripts/prepare-maestro-cli.cjs')
const sqliteKey = readMaestro('main/security/sqliteKey.service.ts')
const sqlitePreload = readMaestro('preload/sqlite.preload.ts')
const maestroWindow = readMaestro('main/windows/maestroWindow.helper.ts')
const windowHelper = readMaestro('main/windows/window.helper.ts')
const workbenchStore = readMaestro('renderer/workbench/src/workbench.store.ts')

assert(handler.includes('async openMaestroWindow()'), 'host must expose the Maestro open operation')
assert(handler.includes('current && !current.isDestroyed()') && handler.includes('maestroWindowHelper.show()'), 'repeat open must focus the existing Maestro instance')
assert(handler.includes("window.once('closed'") && handler.includes('destroyMaestroRuntime()'), 'Maestro close must clean its full runtime')
assert(handler.includes('destroyForHostQuit()') && appMain.includes('await maestroWindowHandler.destroyForHostQuit()'), 'host quit must await Maestro cleanup')
assert(appMain.includes("if (app.isPackaged)") && appMain.includes('BITTERLESS_E2E is unavailable in packaged builds'), 'test-only network/auth controls must be impossible in packaged builds')
assert(appMain.includes("session.fromPartition(MAESTRO_PARTITION).protocol.handle"), 'E2E network isolation must cover the Maestro partition before opening the app')
assert(appMain.includes('return Response.error()'), 'unknown E2E HTTP(S) requests must fail closed')
assert(readProject('src/main/updateHelper/update.service.ts').includes('this.disabledForE2E ? 0 : this.getCurrentVersionCode()'), 'E2E updater disablement must not read package metadata or start transport')
assert(handler.includes("createXpcMainEmitter<SessionApi>('MaestroSessionDao')"), 'Maestro session storage must use an isolated channel')
assert(dataRoot.includes("join(app.getPath('userData'), 'cowork')"), 'Maestro files must live below Bitterless userData/cowork')
assert(dataRoot.includes("persist:bitterless-cowork"), 'Maestro web state must use an isolated persistent partition')
assert(sqliteKey.includes("process.env.BITTERLESS_E2E === '1'") && sqliteKey.includes('randomBytes(32)'), 'E2E SQLCipher key must be process-random')
assert(sqliteKey.includes('if (app.isPackaged)') && sqliteKey.includes('E2E key mode is unavailable in packaged builds'), 'E2E SQLCipher key mode must be unavailable in packages')
assert(sqliteKey.includes("viteEnv === 'prod'") && sqliteKey.includes("viteEnv === 'dev'"), 'SQLite key storage must branch explicitly on VITE_ENV prod/dev')
assert(sqliteKey.includes("PRODUCTION_SQLITE_KEY_FILE = 'sqlite-key.bin'") && sqliteKey.includes("DEVELOPMENT_SQLITE_KEY_FILE = 'sqlite-key.dev.hex'"), 'development and production SQLite keys must use distinct files')
assert(sqliteKey.includes("flag: 'wx'") && sqliteKey.includes('mode: 0o600'), 'SQLite key creation must be owner-only and must not overwrite an existing key')
assert(sqliteKey.includes("'production SQLCipher key file'") && sqliteKey.includes('isAlreadyExistsError'), 'production keys must be format-validated and creation races must converge')
assert(!sqliteKey.includes('micromeet9527'), 'embedded Maestro must not retain the upstream fixed E2E key')
assert(sqlitePreload.includes("location.pathname.endsWith('/maestro/sqlite/index.html')"), 'SQLite preload must not consume its bootstrap token in the initial about:blank document')
assert(maestroWindow.includes("process.env.BITTERLESS_E2E !== '1' && (is.dev || process.env.COACH_DEVTOOLS === '1')"), 'E2E mode must not open detached Maestro Control DevTools')
assert(windowHelper.includes("win.show()\n      if (process.platform === 'darwin') {\n        app.focus({ steal: true })\n        win.moveTop()\n      }\n      win.focus()"), 'repeat Open must show Maestro, activate and raise it on macOS, then focus Maestro')
assert(workbenchStore.includes('captureConfig.whitelist.map((rule) => ({ ...rule }))') && workbenchStore.includes('captureConfig.blacklist.map((rule) => ({ ...rule }))'), 'Workbench must send structured-cloneable capture rules over XPC')
assert(vite.includes("'app.main': resolve('src/main/app.main.ts')") && !vite.includes("resolve('src/main/maestro/app.main.ts')"), 'build must keep one Electron main entry')
for (const entry of ['maestroHome', 'maestroControl', 'maestroWorkbench', 'maestroSqlite']) {
  assert(vite.includes(`${entry}: resolve(`), `renderer build must include ${entry}`)
}
assert(vite.includes("maestroCoach: resolve('src/preload/maestro/coach.preload.ts')") && vite.includes("maestroSqlite: resolve('src/preload/maestro/sqlite.preload.ts')"), 'build must include both Maestro preloads')
assert(vite.includes('bytecode: false'), 'main bytecode must stay disabled for the embedded dynamic runtime')
assert(card.includes(':data-mini-app-id="app.id"'), 'Mini Apps cards need stable E2E identities')
assert(apps.includes("id: 'maestro'") && apps.includes('action: openMaestro'), 'Mini Apps must expose Maestro through its host action')
assert(builder.includes('from: build/maestro-tools') && builder.includes('to: maestro-tools'), 'packaging must include the Maestro CLI bundle')
assert(prepareCli.includes("packages', 'micromeet-cli'"), 'CLI preparation must source the vendored workspace package')

const setE2eEnvironment = (enabled) => {
  const previous = process.env.BITTERLESS_E2E
  if (enabled) process.env.BITTERLESS_E2E = '1'
  else delete process.env.BITTERLESS_E2E
  return () => {
    if (previous === undefined) delete process.env.BITTERLESS_E2E
    else process.env.BITTERLESS_E2E = previous
  }
}

const createSafeStorageSpy = ({ available = true, forbidden = false } = {}) => {
  const calls = { isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }
  const record = (method) => {
    calls[method] += 1
    if (forbidden) throw new Error(`safeStorage.${method} must not be called`)
  }
  return {
    calls,
    api: {
      isEncryptionAvailable() {
        record('isEncryptionAvailable')
        return available
      },
      encryptString(value) {
        record('encryptString')
        return Buffer.from(`protected:${value}`, 'utf8')
      },
      decryptString(value) {
        record('decryptString')
        const serialized = value.toString('utf8')
        if (!serialized.startsWith('protected:')) throw new Error('invalid protected test value')
        return serialized.slice('protected:'.length)
      }
    }
  }
}

const loadSqliteKeyHarness = ({ viteEnv, dataRoot, e2e = false, packaged = false, safeStorage, fsOverrides = {} }) => {
  const restoreE2e = setE2eEnvironment(e2e)
  try {
    const envLiteral = viteEnv === undefined ? 'undefined' : JSON.stringify(viteEnv)
    const executableSource = sqliteKey.replaceAll('import.meta.env.VITE_ENV', envLiteral)
    const output = ts.transpileModule(executableSource, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      },
      fileName: 'sqliteKey.service.ts'
    }).outputText
    const mod = { exports: {} }
    const wrapped = vm.runInThisContext(
      `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
      { filename: 'sqliteKey.service.ts' }
    )
    const localRequire = (specifier) => {
      if (specifier === 'electron') return { app: { isPackaged: packaged }, safeStorage }
      if (specifier === 'electron-xpc/main') return { XpcMainHandler: class {} }
      if (specifier === './sqliteBootstrap.service') return { isSqliteBootstrapTokenValid: () => true }
      if (specifier === '@maestro-main/data/maestroDataRoot') return { maestroDataRoot: () => dataRoot }
      if (specifier === 'fs') return { ...require('fs'), ...fsOverrides }
      return require(specifier)
    }
    wrapped(mod.exports, localRequire, mod, 'sqliteKey.service.ts', dirname('sqliteKey.service.ts'))
    const service = mod.exports.sqliteKeyService
    return {
      async getKey() {
        const restore = setE2eEnvironment(e2e)
        try {
          return await service.getSqliteKey({ bootstrapToken: 'focused-check' })
        } finally {
          restore()
        }
      }
    }
  } finally {
    restoreE2e()
  }
}

const expectFailure = async (run, expectedMessage) => {
  let error = null
  try {
    await run()
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, `expected failure containing: ${expectedMessage}`)
  assert(error.message.includes(expectedMessage), `expected "${expectedMessage}", got "${error.message}"`)
}

const simulatedFsError = (code) => Object.assign(new Error(`simulated ${code}`), { code })

const assertSafeStorageUntouched = (spy, branch) => {
  assert(
    Object.values(spy.calls).every((count) => count === 0),
    `${branch} must not call any safeStorage method: ${JSON.stringify(spy.calls)}`
  )
}

const assertOwnerOnlyModes = (directory, file) => {
  if (process.platform === 'win32') return
  assert((statSync(directory).mode & 0o777) === 0o700, `expected ${directory} mode 0700`)
  assert((statSync(file).mode & 0o777) === 0o600, `expected ${file} mode 0600`)
}

const runSqliteKeyBranchChecks = async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'bitterless-cowork-sqlite-key-'))
  try {
    const devRoot = join(tempRoot, 'dev', 'cowork')
    const devSpy = createSafeStorageSpy({ forbidden: true })
    const dev = loadSqliteKeyHarness({ viteEnv: 'dev', dataRoot: devRoot, safeStorage: devSpy.api })
    const firstDevKey = await dev.getKey()
    const secondDevKey = await dev.getKey()
    const devConfig = join(devRoot, 'config')
    const devKeyFile = join(devConfig, 'sqlite-key.dev.hex')
    assert(/^[0-9a-f]{64}$/.test(firstDevKey), 'development key must contain 32 random bytes as hexadecimal')
    assert(firstDevKey === secondDevKey, 'development key must persist across reads')
    assert(readFileSync(devKeyFile, 'utf8') === firstDevKey, 'development key file must contain the selected key')
    assert(!existsSync(join(devConfig, 'sqlite-key.bin')), 'development must not create the production key file')
    assertOwnerOnlyModes(devConfig, devKeyFile)
    assertSafeStorageUntouched(devSpy, 'development')

    const convergedDevRoot = join(tempRoot, 'converged-dev', 'cowork')
    const convergedDevKeyFile = join(convergedDevRoot, 'config', 'sqlite-key.dev.hex')
    const winningDevKey = 'b'.repeat(64)
    let convergedDevWrites = 0
    const convergedDevSpy = createSafeStorageSpy({ forbidden: true })
    const convergedDev = loadSqliteKeyHarness({
      viteEnv: 'dev',
      dataRoot: convergedDevRoot,
      safeStorage: convergedDevSpy.api,
      fsOverrides: {
        writeFileSync(path, value, options) {
          if (path === convergedDevKeyFile && options?.flag === 'wx') {
            convergedDevWrites += 1
            writeFileSync(path, winningDevKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
            throw simulatedFsError('EEXIST')
          }
          return writeFileSync(path, value, options)
        }
      }
    })
    assert(await convergedDev.getKey() === winningDevKey, 'development EEXIST loser must read the winning key')
    assert(convergedDevWrites === 1, 'development convergence must attempt one exclusive create')
    assert(readFileSync(convergedDevKeyFile, 'utf8') === winningDevKey, 'development convergence must not overwrite the winner')
    assert(!existsSync(join(convergedDevRoot, 'config', 'config.db')), 'development convergence must not create a database')
    assertSafeStorageUntouched(convergedDevSpy, 'development convergence')

    const deniedDevRoot = join(tempRoot, 'denied-dev', 'cowork')
    const deniedDevKeyFile = join(deniedDevRoot, 'config', 'sqlite-key.dev.hex')
    const deniedDevSpy = createSafeStorageSpy({ forbidden: true })
    const deniedDev = loadSqliteKeyHarness({
      viteEnv: 'dev',
      dataRoot: deniedDevRoot,
      safeStorage: deniedDevSpy.api,
      fsOverrides: {
        writeFileSync(path, value, options) {
          if (path === deniedDevKeyFile && options?.flag === 'wx') throw simulatedFsError('EACCES')
          return writeFileSync(path, value, options)
        }
      }
    })
    await expectFailure(() => deniedDev.getKey(), 'simulated EACCES')
    assert(!existsSync(deniedDevKeyFile), 'development must rethrow non-EEXIST creation failures without a key')
    assertSafeStorageUntouched(deniedDevSpy, 'development non-EEXIST failure')

    const invalidDevRoot = join(tempRoot, 'invalid-dev', 'cowork')
    const invalidDevConfig = join(invalidDevRoot, 'config')
    mkdirSync(invalidDevConfig, { recursive: true })
    const invalidDevKeyFile = join(invalidDevConfig, 'sqlite-key.dev.hex')
    const invalidDevDb = join(invalidDevConfig, 'config.db')
    writeFileSync(invalidDevKeyFile, 'not-a-sqlcipher-key', 'utf8')
    writeFileSync(invalidDevDb, 'existing-development-db', 'utf8')
    const invalidDevSpy = createSafeStorageSpy({ forbidden: true })
    const invalidDev = loadSqliteKeyHarness({ viteEnv: 'dev', dataRoot: invalidDevRoot, safeStorage: invalidDevSpy.api })
    await expectFailure(() => invalidDev.getKey(), 'development SQLCipher key file is invalid')
    assert(readFileSync(invalidDevKeyFile, 'utf8') === 'not-a-sqlcipher-key', 'invalid development key must not be overwritten')
    assert(readFileSync(invalidDevDb, 'utf8') === 'existing-development-db', 'development DB must not be modified')
    assertSafeStorageUntouched(invalidDevSpy, 'invalid development key')

    const missingDevRoot = join(tempRoot, 'missing-dev', 'cowork')
    const missingDevConfig = join(missingDevRoot, 'config')
    mkdirSync(missingDevConfig, { recursive: true })
    const missingDevDb = join(missingDevConfig, 'config.db')
    writeFileSync(missingDevDb, 'development-db-with-production-key-only', 'utf8')
    writeFileSync(join(missingDevConfig, 'sqlite-key.bin'), 'protected:unused-production-key', 'utf8')
    const missingDevSpy = createSafeStorageSpy({ forbidden: true })
    const missingDev = loadSqliteKeyHarness({ viteEnv: 'dev', dataRoot: missingDevRoot, safeStorage: missingDevSpy.api })
    await expectFailure(() => missingDev.getKey(), 'development key file is missing')
    assert(!existsSync(join(missingDevConfig, 'sqlite-key.dev.hex')), 'missing development key must not be regenerated over an existing DB')
    assert(readFileSync(missingDevDb, 'utf8') === 'development-db-with-production-key-only', 'missing-key development DB must not be modified')
    assertSafeStorageUntouched(missingDevSpy, 'development missing key')

    const prodRoot = join(tempRoot, 'prod', 'cowork')
    const prodSpy = createSafeStorageSpy()
    const prod = loadSqliteKeyHarness({ viteEnv: 'prod', dataRoot: prodRoot, safeStorage: prodSpy.api })
    const firstProdKey = await prod.getKey()
    const secondProdKey = await prod.getKey()
    const prodConfig = join(prodRoot, 'config')
    const prodKeyFile = join(prodConfig, 'sqlite-key.bin')
    assert(/^[0-9a-f]{64}$/.test(firstProdKey), 'production key must contain 32 random bytes as hexadecimal')
    assert(firstProdKey === secondProdKey, 'production key must round-trip through safeStorage')
    assert(readFileSync(prodKeyFile, 'utf8') !== firstProdKey, 'production key file must not contain plaintext key material')
    assert(prodSpy.calls.isEncryptionAvailable === 2, 'production must check safeStorage before encrypt and decrypt')
    assert(prodSpy.calls.encryptString === 1 && prodSpy.calls.decryptString === 1, 'production must encrypt once and decrypt on reuse')
    assert(!existsSync(join(prodConfig, 'sqlite-key.dev.hex')), 'production must not create the development key file')
    assertOwnerOnlyModes(prodConfig, prodKeyFile)

    const convergedProdRoot = join(tempRoot, 'converged-prod', 'cowork')
    const convergedProdKeyFile = join(convergedProdRoot, 'config', 'sqlite-key.bin')
    const winningProdKey = 'c'.repeat(64)
    let convergedProdWrites = 0
    const convergedProdSpy = createSafeStorageSpy()
    const convergedProd = loadSqliteKeyHarness({
      viteEnv: 'prod',
      dataRoot: convergedProdRoot,
      safeStorage: convergedProdSpy.api,
      fsOverrides: {
        writeFileSync(path, value, options) {
          if (path === convergedProdKeyFile && options?.flag === 'wx') {
            convergedProdWrites += 1
            writeFileSync(path, `protected:${winningProdKey}`, { flag: 'wx', mode: 0o600 })
            throw simulatedFsError('EEXIST')
          }
          return writeFileSync(path, value, options)
        }
      }
    })
    assert(await convergedProd.getKey() === winningProdKey, 'production EEXIST loser must decrypt and validate the winning key')
    assert(convergedProdWrites === 1, 'production convergence must attempt one exclusive create')
    assert(readFileSync(convergedProdKeyFile, 'utf8') === `protected:${winningProdKey}`, 'production convergence must not overwrite the winner')
    assert(!existsSync(join(convergedProdRoot, 'config', 'config.db')), 'production convergence must not create a database')
    assert(convergedProdSpy.calls.encryptString === 1 && convergedProdSpy.calls.decryptString === 1, 'production convergence must encrypt the candidate then decrypt the winner')

    const deniedProdRoot = join(tempRoot, 'denied-prod', 'cowork')
    const deniedProdKeyFile = join(deniedProdRoot, 'config', 'sqlite-key.bin')
    const deniedProdSpy = createSafeStorageSpy()
    const deniedProd = loadSqliteKeyHarness({
      viteEnv: 'prod',
      dataRoot: deniedProdRoot,
      safeStorage: deniedProdSpy.api,
      fsOverrides: {
        writeFileSync(path, value, options) {
          if (path === deniedProdKeyFile && options?.flag === 'wx') throw simulatedFsError('EACCES')
          return writeFileSync(path, value, options)
        }
      }
    })
    await expectFailure(() => deniedProd.getKey(), 'simulated EACCES')
    assert(!existsSync(deniedProdKeyFile), 'production must rethrow non-EEXIST creation failures without a key')
    assert(deniedProdSpy.calls.encryptString === 1 && deniedProdSpy.calls.decryptString === 0, 'production non-EEXIST failure must not read a winner')

    const malformedProdRoot = join(tempRoot, 'malformed-prod', 'cowork')
    const malformedProdConfig = join(malformedProdRoot, 'config')
    mkdirSync(malformedProdConfig, { recursive: true })
    const malformedProdKeyFile = join(malformedProdConfig, 'sqlite-key.bin')
    const malformedProdDb = join(malformedProdConfig, 'config.db')
    writeFileSync(malformedProdKeyFile, 'protected:not-a-sqlcipher-key', 'utf8')
    writeFileSync(malformedProdDb, 'existing-production-db', 'utf8')
    const malformedProdKeyBytes = readFileSync(malformedProdKeyFile)
    const malformedProdDbBytes = readFileSync(malformedProdDb)
    const malformedProdSpy = createSafeStorageSpy()
    const malformedProd = loadSqliteKeyHarness({ viteEnv: 'prod', dataRoot: malformedProdRoot, safeStorage: malformedProdSpy.api })
    await expectFailure(() => malformedProd.getKey(), 'production SQLCipher key file is invalid')
    assert(readFileSync(malformedProdKeyFile).equals(malformedProdKeyBytes), 'malformed production key bytes must remain unchanged')
    assert(readFileSync(malformedProdDb).equals(malformedProdDbBytes), 'production DB bytes must remain unchanged after malformed-key rejection')

    const malformedProdKeyOnlyRoot = join(tempRoot, 'malformed-prod-key-only', 'cowork')
    const malformedProdKeyOnlyConfig = join(malformedProdKeyOnlyRoot, 'config')
    mkdirSync(malformedProdKeyOnlyConfig, { recursive: true })
    const malformedProdKeyOnlyFile = join(malformedProdKeyOnlyConfig, 'sqlite-key.bin')
    writeFileSync(malformedProdKeyOnlyFile, 'protected:short', 'utf8')
    const malformedProdKeyOnlyBytes = readFileSync(malformedProdKeyOnlyFile)
    const malformedProdKeyOnlySpy = createSafeStorageSpy()
    const malformedProdKeyOnly = loadSqliteKeyHarness({
      viteEnv: 'prod',
      dataRoot: malformedProdKeyOnlyRoot,
      safeStorage: malformedProdKeyOnlySpy.api
    })
    await expectFailure(() => malformedProdKeyOnly.getKey(), 'production SQLCipher key file is invalid')
    assert(readFileSync(malformedProdKeyOnlyFile).equals(malformedProdKeyOnlyBytes), 'key-only malformed production bytes must remain unchanged')
    assert(!existsSync(join(malformedProdKeyOnlyConfig, 'config.db')), 'malformed production key must not create a database')

    const unavailableProdRoot = join(tempRoot, 'unavailable-prod', 'cowork')
    const unavailableProdSpy = createSafeStorageSpy({ available: false })
    const unavailableProd = loadSqliteKeyHarness({ viteEnv: 'prod', dataRoot: unavailableProdRoot, safeStorage: unavailableProdSpy.api })
    await expectFailure(() => unavailableProd.getKey(), 'safeStorage is not available')
    assert(unavailableProdSpy.calls.isEncryptionAvailable === 1, 'production must probe safeStorage availability')
    assert(unavailableProdSpy.calls.encryptString === 0 && unavailableProdSpy.calls.decryptString === 0, 'unavailable safeStorage must fail before encryption')
    assert(!existsSync(join(unavailableProdRoot, 'config', 'sqlite-key.bin')), 'unavailable safeStorage must not create a production key')

    const missingProdRoot = join(tempRoot, 'missing-prod', 'cowork')
    const missingProdConfig = join(missingProdRoot, 'config')
    mkdirSync(missingProdConfig, { recursive: true })
    const missingProdDb = join(missingProdConfig, 'config.db')
    const existingDevKey = 'a'.repeat(64)
    writeFileSync(missingProdDb, 'production-db-with-development-key-only', 'utf8')
    writeFileSync(join(missingProdConfig, 'sqlite-key.dev.hex'), existingDevKey, 'utf8')
    const missingProdSpy = createSafeStorageSpy()
    const missingProd = loadSqliteKeyHarness({ viteEnv: 'prod', dataRoot: missingProdRoot, safeStorage: missingProdSpy.api })
    await expectFailure(() => missingProd.getKey(), 'encrypted key file is missing')
    assert(!existsSync(join(missingProdConfig, 'sqlite-key.bin')), 'missing production key must not be regenerated over an existing DB')
    assert(readFileSync(missingProdDb, 'utf8') === 'production-db-with-development-key-only', 'missing-key production DB must not be modified')
    assert(readFileSync(join(missingProdConfig, 'sqlite-key.dev.hex'), 'utf8') === existingDevKey, 'production must not migrate the development key')
    assertSafeStorageUntouched(missingProdSpy, 'production missing key')

    const e2eRoot = join(tempRoot, 'e2e', 'cowork')
    const e2eSpy = createSafeStorageSpy({ forbidden: true })
    const e2e = loadSqliteKeyHarness({ viteEnv: 'dev', dataRoot: e2eRoot, e2e: true, safeStorage: e2eSpy.api })
    const firstE2eKey = await e2e.getKey()
    const secondE2eKey = await e2e.getKey()
    assert(/^[0-9a-f]{64}$/.test(firstE2eKey), 'E2E key must contain 32 random bytes as hexadecimal')
    assert(firstE2eKey === secondE2eKey, 'E2E key must remain module-cached for the process')
    assert(!existsSync(e2eRoot), 'E2E key mode must remain process-ephemeral')
    assertSafeStorageUntouched(e2eSpy, 'E2E')

    const packagedE2eSpy = createSafeStorageSpy({ forbidden: true })
    const packagedE2e = loadSqliteKeyHarness({
      viteEnv: 'prod',
      dataRoot: join(tempRoot, 'packaged-e2e', 'cowork'),
      e2e: true,
      packaged: true,
      safeStorage: packagedE2eSpy.api
    })
    await expectFailure(() => packagedE2e.getKey(), 'E2E key mode is unavailable in packaged builds')
    assertSafeStorageUntouched(packagedE2eSpy, 'packaged E2E')

    const unknownRoot = join(tempRoot, 'unknown', 'cowork')
    const unknownSpy = createSafeStorageSpy({ forbidden: true })
    const unknown = loadSqliteKeyHarness({ viteEnv: 'staging', dataRoot: unknownRoot, safeStorage: unknownSpy.api })
    await expectFailure(() => unknown.getKey(), 'unsupported VITE_ENV')
    assert(!existsSync(unknownRoot), 'unknown environment must not select or create a key store')
    assertSafeStorageUntouched(unknownSpy, 'unknown environment')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

await runSqliteKeyBranchChecks()

console.log('[check-embedded-host] ok')
