import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8')
const require = createRequire(import.meta.url)
const {
  parseUserKeychainSearchList,
  selectDeveloperIdApplicationIdentity,
  withTemporaryUserKeychainSearchList,
} = require('../publish.js')
const { createCodesignRetryExecutor } = require('../codesignRetry.helper.js')

test('publish audits SQLite before build, signing, or upload', () => {
  const source = read('scripts/publish.js')
  const mainSource = source.slice(source.indexOf('const main = async () =>'))
  const auditIndex = mainSource.indexOf("run('yarn', ['audit:sqlite-migrations'])")
  const buildIndex = mainSource.indexOf('runBuild(options)')
  const publishConfigIndex = mainSource.indexOf('createPublishConfig(options)')
  assert(auditIndex >= 0)
  assert(buildIndex > auditIndex)
  assert(publishConfigIndex > auditIndex)
})

test('direct package scripts have migration pre-hooks', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const script of [
    'unpack',
    'win',
    'mac_arm',
    'mac_x64',
    'mac_intel',
    'linux_x64',
    'linux_arm64',
  ]) {
    assert.equal(pkg.scripts[`prebuild:${script}`], 'yarn audit:sqlite-migrations')
  }
  assert.equal(pkg.scripts['prebuild_dev:mac_arm'], 'yarn audit:sqlite-migrations')
  assert.equal(pkg.scripts['prebuild_dev:win'], 'yarn audit:sqlite-migrations')
})

test('fast mac ARM publish syncs source and locked dependencies before patch, build, and publish', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(
    pkg.scripts['fast_publish:mac_arm'],
    'node scripts/git_pull.js && yarn install --frozen-lockfile && node scripts/patch.js && DEBUG=electron-osx-sign yarn build:mac_arm && yarn publish:mac_arm',
  )
})

test('desktop runtime pins Electron 40 and SQLite 12.11 without the Electron 43 ABI override', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = read('yarn.lock')

  assert.equal(pkg.devDependencies.electron, '40.10.6')
  assert.equal(pkg.dependencies['better-sqlite3-multiple-ciphers'], '12.11.1')
  assert.equal(pkg.resolutions['node-abi'], undefined)
  assert.match(lock, /^electron@40\.10\.6:\n  version "40\.10\.6"$/m)
  assert.match(
    lock,
    /^better-sqlite3-multiple-ciphers@12\.11\.1:\n  version "12\.11\.1"$/m,
  )
  assert.doesNotMatch(lock, /^electron@43\.2\.0:/m)
  assert.doesNotMatch(lock, /node-abi@\^4\.33\.0/)
})

test('signedBuild cannot invoke electron-builder before the audit', () => {
  const source = read('scripts/signedBuild.js')
  const auditIndex = source.indexOf("spawnSync(auditCommand, ['audit:sqlite-migrations']")
  const builderIndex = source.lastIndexOf('spawnSync(electronBuilderCommand')
  assert(auditIndex >= 0)
  assert(builderIndex > auditIndex)
  assert.match(source, /codesignRetry\.preload\.js/)
  assert.match(source, /env\.NODE_OPTIONS/)
})

test('release version codes use the common comparison library', () => {
  const paths = [
    'src/preload/common/sqliteMigration.service.ts',
    'src/main/updateHelper/update.service.ts',
    'scripts/patch.js',
    'scripts/publish.js',
  ]
  for (const path of paths) {
    assert.match(read(path), /compareVersions/)
  }
  const releaseSources = paths.map(read).join('\n')
  assert.doesNotMatch(releaseSources, /\.versionCode\s*[<>]/)
  assert.doesNotMatch(releaseSources, /versionCode\s*-\s*/)
})

test('DMG signing uses a private disposable keychain', () => {
  const source = read('scripts/publish.js')
  assert.match(source, /withTemporarySigningKeychain/)
  assert.match(source, /withTemporaryUserKeychainSearchList/)
  assert.match(source, /\['create-keychain', '-p', keychainPassword, keychainPath\]/)
  assert.match(source, /\['import', certificatePath, '-k', keychainPath, '-P', certificatePassword/)
  assert.match(source, /'find-identity'/)
  assert.match(source, /'codesigning'/)
  assert.match(source, /\['--verify', '--verbose=4', dmgPath\]/)
  assert.match(source, /\['delete-keychain', keychainPath\]/)
  assert.match(source, /finally\s*{/)
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:certificatePassword|keychainPassword)/)
})

test('DMG notarization waits for acceptance and staples the artifact', () => {
  const source = read('scripts/publish.js')
  const start = source.indexOf('const notarizeDmg =')
  const end = source.indexOf('const regenerateBlockmap =', start)
  const notarizeSource = source.slice(start, end)

  assert(start >= 0)
  assert(end > start)
  assert.match(notarizeSource, /'--wait'/)
  assert.match(notarizeSource, /parsed\.status !== 'Accepted'/)
  assert.match(notarizeSource, /\['stapler', 'staple', dmgPath\]/)
  assert.match(notarizeSource, /\['stapler', 'validate', dmgPath\]/)
})

test('temporary signing keychain restores the exact user search list', () => {
  const writes = []
  const dependencies = {
    readSearchList: () => ['/Users/test/login.keychain-db', '/Library/Keychains/System.keychain'],
    setSearchList: (value) => writes.push([...value]),
  }

  assert.equal(
    withTemporaryUserKeychainSearchList('/tmp/release.keychain-db', () => 'signed', dependencies),
    'signed',
  )
  assert.deepEqual(writes, [
    [
      '/tmp/release.keychain-db',
      '/Users/test/login.keychain-db',
      '/Library/Keychains/System.keychain',
    ],
    ['/Users/test/login.keychain-db', '/Library/Keychains/System.keychain'],
  ])
})

test('temporary signing keychain restores the user search list when signing fails', () => {
  const writes = []
  const dependencies = {
    readSearchList: () => ['/Users/test/login.keychain-db'],
    setSearchList: (value) => writes.push([...value]),
  }

  assert.throws(
    () => withTemporaryUserKeychainSearchList('/tmp/release.keychain-db', () => {
      throw new Error('sign failed')
    }, dependencies),
    /sign failed/,
  )
  assert.deepEqual(writes, [
    ['/tmp/release.keychain-db', '/Users/test/login.keychain-db'],
    ['/Users/test/login.keychain-db'],
  ])
})

test('DMG signing selects one imported Developer ID identity for the app team', () => {
  const output = [
    '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example One (TEAMONE123)"',
    '  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Example Two (TEAMTWO456)"',
    '     2 valid identities found',
  ].join('\n')

  assert.equal(
    selectDeveloperIdApplicationIdentity(output, 'TEAMTWO456'),
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  )
  assert.throws(
    () => selectDeveloperIdApplicationIdentity(output, 'MISSING123'),
    /found 0/,
  )
  assert.deepEqual(
    parseUserKeychainSearchList('    "/Users/test/login.keychain-db"\n    "/Library/Keychains/System.keychain"\n'),
    ['/Users/test/login.keychain-db', '/Library/Keychains/System.keychain'],
  )
})

test('codesign retries only transient Apple timestamp failures', async () => {
  const calls = []
  const delays = []
  const retries = []
  const execute = async (file) => {
    calls.push(file)
    if (calls.length < 3) {
      const error = new Error('The timestamp service is not available.')
      error.stderr = 'The timestamp service is not available.'
      throw error
    }
    return 'signed'
  }
  const retryingExecute = createCodesignRetryExecutor(execute, {
    retryDelaysMs: [2, 5],
    delay: async (ms) => delays.push(ms),
    onRetry: (event) => retries.push(event),
  })

  assert.equal(await retryingExecute('codesign', ['--timestamp'], {}), 'signed')
  assert.deepEqual(calls, ['codesign', 'codesign', 'codesign'])
  assert.deepEqual(delays, [2, 5])
  assert.deepEqual(retries, [
    { attempt: 2, maxAttempts: 3, retryDelayMs: 2 },
    { attempt: 3, maxAttempts: 3, retryDelayMs: 5 },
  ])
})

test('codesign retry does not mask permanent or non-codesign failures', async () => {
  let calls = 0
  const permanentFailure = createCodesignRetryExecutor(async () => {
    calls++
    throw new Error('invalid signature')
  }, {
    retryDelaysMs: [1, 1],
    delay: async () => {},
  })
  await assert.rejects(() => permanentFailure('codesign', [], {}), /invalid signature/)
  assert.equal(calls, 1)

  const nonCodesignFailure = createCodesignRetryExecutor(async () => {
    calls++
    throw new Error('The timestamp service is not available.')
  }, {
    retryDelaysMs: [1, 1],
    delay: async () => {},
  })
  await assert.rejects(() => nonCodesignFailure('security', [], {}), /timestamp service/)
  assert.equal(calls, 2)
})

test('migration audit is pure Node and uses runtime manifests', () => {
  const source = read('scripts/sqlite-migrations/auditRunner.ts')
  assert.match(source, /coreSqliteMigrations/)
  assert.match(source, /maestroSqliteMigrations/)
  assert.match(source, /todoistSyncMigrations/)
  assert.doesNotMatch(source, /from ['"]electron['"]/)
  assert.doesNotMatch(source, /electron-vite|BrowserWindow/)
})
