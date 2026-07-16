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

test('signedBuild cannot invoke electron-builder before the audit', () => {
  const source = read('scripts/signedBuild.js')
  const auditIndex = source.indexOf("spawnSync(auditCommand, ['audit:sqlite-migrations']")
  const builderIndex = source.lastIndexOf('spawnSync(electronBuilderCommand')
  assert(auditIndex >= 0)
  assert(builderIndex > auditIndex)
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

test('migration audit is pure Node and uses runtime manifests', () => {
  const source = read('scripts/sqlite-migrations/auditRunner.ts')
  assert.match(source, /coreSqliteMigrations/)
  assert.match(source, /maestroSqliteMigrations/)
  assert.doesNotMatch(source, /from ['"]electron['"]/)
  assert.doesNotMatch(source, /electron-vite|BrowserWindow/)
})
