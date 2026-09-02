import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8')
const require = createRequire(import.meta.url)
const {
  OSS_MULTIPART_PARALLEL,
  OSS_MULTIPART_PART_SIZE_BYTES,
  OSS_MULTIPART_THRESHOLD_BYTES,
  OSS_REQUEST_TIMEOUT_MS,
  assertNoCrossChannelIdentityReuse,
  assertNoRemoteDowngrade,
  assertReleaseOrder,
  parseUserKeychainSearchList,
  publishRelease,
  selectDeveloperIdApplicationIdentity,
  uploadFile,
  uploadReleaseFiles,
  withTemporaryUserKeychainSearchList,
} = require('../publish.js')
const {
  assertLocalReleaseMatchesDist,
  artifactNameMatchesVersion,
  createVersionInfoForUpload,
  releaseChannelConfigs,
  validateUpdaterArtifacts,
} = require('../release/releaseChannel.cjs')
const {
  isTransientNetworkFailure,
  parseNotarizationStatus,
  parseSubmissionId,
} = require('../notarize.js')
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

test('publish preflight exits before build, signing, or upload', () => {
  const source = read('scripts/publish.js')
  const mainSource = source.slice(source.indexOf('const main = async () =>'))
  const remoteGuardIndex = mainSource.indexOf('await assertNoRemoteDowngrade')
  const preflightIndex = mainSource.indexOf('if (options.preflightOnly)')
  const buildIndex = mainSource.indexOf('runBuild(options)')

  assert(remoteGuardIndex >= 0)
  assert(preflightIndex > remoteGuardIndex)
  assert(buildIndex > preflightIndex)
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
  assert.equal(pkg.scripts['prebuild_preview:mac_arm'], 'yarn audit:sqlite-migrations')
  assert.equal(pkg.scripts['prebuild_preview:mac_intel'], 'yarn audit:sqlite-migrations')
  assert.equal(pkg.scripts['prebuild_preview:win'], 'yarn audit:sqlite-migrations')
})

test('Preview publish aliases build and publish current local source without Git operations', () => {
  const pkg = JSON.parse(read('package.json'))
  const expected = {
    'publish_preview:mac_arm': 'mac_arm',
    'publish_preview:mac_intel': 'mac_intel',
    'publish_preview:win': 'win64',
  }
  assert.equal(pkg.scripts.publish_preview, 'yarn publish_preview:mac_arm')
  for (const [script, platform] of Object.entries(expected)) {
    assert.equal(
      pkg.scripts[script],
      `yarn install --frozen-lockfile && node scripts/publish.js --env preview --platform ${platform} --build`,
    )
    assert.doesNotMatch(pkg.scripts[script], /git|pull|reset|restore/)
  }
})

test('one explicit release cut owns the shared version counter for every platform publisher', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['release:cut'], 'node scripts/patch.js')
  const publishers = Object.keys(pkg.scripts).filter((name) => /^publish(_dev|_preview)?(:|$)/.test(name))
  assert(publishers.length >= 10)
  for (const name of publishers) {
    assert.doesNotMatch(pkg.scripts[name], /--bump|patch\.js/, `${name} must not mint a version`)
  }
})

test('Stable publish aliases rebuild the selected production artifact before upload', () => {
  const pkg = JSON.parse(read('package.json'))
  const expected = {
    'publish:mac_arm': 'mac_arm',
    'publish:mac_intel': 'mac_intel',
    'publish:win': 'win64',
  }
  for (const [script, platform] of Object.entries(expected)) {
    assert.equal(
      pkg.scripts[script],
      `node scripts/publish.js --env prod --platform ${platform} --build`,
    )
  }
})

test('fast mac ARM publish uses local source and locked dependencies before patch, build, and publish', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(
    pkg.scripts['fast_publish:mac_arm'],
    'yarn install --frozen-lockfile && node scripts/patch.js && DEBUG=electron-osx-sign yarn publish:mac_arm',
  )
  assert.doesNotMatch(pkg.scripts['fast_publish:mac_arm'], /git_pull\.js/)
  assert.match(pkg.scripts['publish:mac_arm'], /--env prod --platform mac_arm --build$/)
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

test('release ordering rejects semantic downgrade and conflicting version reuse', () => {
  const remote = { version: '0.0.58', versionCode: '260731183355' }

  assert.doesNotThrow(() => {
    assertReleaseOrder(
      { version: '0.0.59', version_code: '260802120000' },
      remote,
    )
  })
  assert.doesNotThrow(() => {
    assertReleaseOrder(
      { version: remote.version, version_code: remote.versionCode },
      remote,
    )
  })
  assert.throws(
    () => assertReleaseOrder({ version: '0.0.56', version_code: '260802120000' }, remote),
    /semantic version downgrade/,
  )
  assert.throws(
    () => assertReleaseOrder({ version: remote.version, version_code: '260802120000' }, remote),
    /semantic version reuse/,
  )
  assert.throws(
    () => assertReleaseOrder({ version: '0.0.59', version_code: '260730120000' }, remote),
    /version_code downgrade/,
  )
})

test('publisher validates the exact existing Preview manifest before logging release order', async (t) => {
  const requestedKeys = []
  const logs = []
  const client = {
    async get(objectKey) {
      requestedKeys.push(objectKey)
      return {
        content: Buffer.from(JSON.stringify({
          version: '0.0.79',
          versionCode: '260831120000',
        })),
      }
    },
  }
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')))

  await assertNoRemoteDowngrade(
    client,
    'bitterless/distro/preview/mac_arm',
    { version: '0.0.80', version_code: '260901100018' },
  )

  assert.deepEqual(requestedKeys, [
    'bitterless/distro/preview/mac_arm/version_info.json',
  ])
  assert.deepEqual(logs, [
    '[publish.js] Version order verified: local 0.0.80 (260901100018), remote 0.0.79 (260831120000)',
  ])
})

test('publisher requires package and dist to describe the exact same release', () => {
  assert.doesNotThrow(() => {
    assertLocalReleaseMatchesDist(
      { version: '0.0.60', version_code: '260802114545' },
      { version: '0.0.60', versionCode: '260802114545' },
    )
  })
  assert.throws(
    () => assertLocalReleaseMatchesDist(
      { version: '0.0.60', version_code: '260802114545' },
      { version: '0.0.59', versionCode: '260802111453' },
    ),
    /Stale dist release metadata/,
  )
  assert.doesNotThrow(() => assertLocalReleaseMatchesDist(
    { version: '0.0.60', version_code: '260802114545' },
    { version: '0.0.60', versionCode: '260802114545', channel: 'preview' },
    'preview',
  ))
  assert.throws(
    () => assertLocalReleaseMatchesDist(
      { version: '0.0.60', version_code: '260802114545' },
      { version: '0.0.60', versionCode: '260802114545', channel: 'prod' },
      'preview',
    ),
    /expected channel preview/,
  )
})

test('local release artifacts use distinct Stable, Development, and Preview directories', () => {
  const projectRoot = join(import.meta.dirname, '..', '..')
  assert.equal(releaseChannelConfigs.prod.distDir, join(projectRoot, 'dist'))
  assert.equal(releaseChannelConfigs.dev.distDir, join(projectRoot, 'dist', 'dev'))
  assert.equal(releaseChannelConfigs.preview.distDir, join(projectRoot, 'dist', 'preview'))
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(releaseChannelConfigs).map(([channel, config]) => [
        channel,
        config.outputDirectory,
      ]),
    ),
    {
      dev: 'dist/dev',
      preview: 'dist/preview',
      prod: 'dist',
    },
  )
})

test('publisher emits exact additive Preview installer metadata', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-preview-manifest-'))
  const installer = join(tempDir, 'Bitterless-Preview-0.0.79.dmg')
  const versionInfo = join(tempDir, 'version_info.json')
  try {
    writeFileSync(installer, 'preview-installer')
    writeFileSync(versionInfo, JSON.stringify({
      version: '0.0.79',
      versionCode: '260831120000',
      channel: 'preview',
      releaseNotes: 'Preview',
    }))
    const output = createVersionInfoForUpload({
      env: 'preview',
      platform: 'mac_arm',
      prefix: 'bitterless/distro',
      publicBaseUrl: 'https://assets.terncloud.com',
    }, [installer], tempDir)
    const manifest = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(manifest.channel, 'preview')
    assert.equal(manifest.platform, 'mac_arm')
    assert.equal(manifest.installerName, 'Bitterless-Preview-0.0.79.dmg')
    assert.equal(
      manifest.installerUrl,
      'https://assets.terncloud.com/bitterless/distro/preview/mac_arm/Bitterless-Preview-0.0.79.dmg',
    )
    assert.equal(manifest.installerSize, statSync(installer).size)
    assert.match(manifest.installerSha512, /^[A-Za-z0-9+/]+={0,2}$/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('publisher validates updater references and required blockmaps', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-updater-test-'))
  const updater = join(tempDir, 'latest-mac.yml')
  const zip = join(tempDir, 'Bitterless-0.0.60-arm64-mac.zip')
  const dmg = join(tempDir, 'Bitterless-0.0.60.dmg')
  const zipBlockmap = `${zip}.blockmap`
  const dmgBlockmap = `${dmg}.blockmap`
  const artifacts = [updater, zip, dmg, zipBlockmap, dmgBlockmap]

  try {
    const writeUpdater = (zipReference) => writeFileSync(updater, [
        'version: 0.0.60',
        'files:',
        `  - url: ${zipReference}`,
        '  - url: Bitterless-0.0.60.dmg',
        `path: ${zipReference}`,
        '',
      ].join('\n'))
    writeUpdater('Bitterless-0.0.60-arm64-mac.zip')
    for (const artifact of artifacts.slice(1)) writeFileSync(artifact, 'artifact')

    assert.doesNotThrow(() => validateUpdaterArtifacts('mac_arm', '0.0.60', artifacts))
    assert.throws(
      () => validateUpdaterArtifacts('mac_arm', '0.0.60', artifacts.filter((item) => item !== zip)),
      /references missing artifact/,
    )
    assert.throws(
      () => validateUpdaterArtifacts(
        'mac_arm',
        '0.0.60',
        artifacts.filter((item) => item !== dmgBlockmap),
      ),
      /missing required blockmap/,
    )
    assert.throws(
      () => validateUpdaterArtifacts('mac_arm', '0.0.59', artifacts),
      /version mismatch/,
    )
    for (const invalidReference of [
      'subdir/Bitterless-0.0.60-arm64-mac.zip',
      'https://other.example/Bitterless-0.0.60-arm64-mac.zip',
    ]) {
      writeUpdater(invalidReference)
      assert.throws(
        () => validateUpdaterArtifacts('mac_arm', '0.0.60', artifacts),
        /only plain filenames are allowed/,
      )
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('publisher uses multipart upload for large artifacts and verifies remote size', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-publish-test-'))
  const smallFile = join(tempDir, 'latest.yml')
  const largeFile = join(tempDir, 'Bitterless-test.dmg')
  const calls = []
  const uploadedSizes = new Map()
  const client = {
    async put(objectKey, filePath, options) {
      calls.push({ method: 'put', objectKey, options })
      uploadedSizes.set(objectKey, statSync(filePath).size)
    },
    async multipartUpload(objectKey, filePath, options) {
      calls.push({ method: 'multipartUpload', objectKey, options })
      uploadedSizes.set(objectKey, statSync(filePath).size)
      await options.progress(0.5)
    },
    async head(objectKey, options) {
      calls.push({ method: 'head', objectKey, options })
      return {
        res: {
          headers: {
            'content-length': String(uploadedSizes.get(objectKey)),
          },
        },
      }
    },
  }

  try {
    writeFileSync(smallFile, 'metadata')
    writeFileSync(largeFile, '')
    truncateSync(largeFile, OSS_MULTIPART_THRESHOLD_BYTES)

    await uploadFile(client, 'release/latest.yml', smallFile, false)
    await uploadFile(client, 'release/Bitterless-test.dmg', largeFile, false)

    const putCall = calls.find((call) => call.method === 'put')
    const multipartCall = calls.find((call) => call.method === 'multipartUpload')
    const headCalls = calls.filter((call) => call.method === 'head')
    assert.equal(putCall.options.timeout, OSS_REQUEST_TIMEOUT_MS)
    assert.equal(multipartCall.options.timeout, OSS_REQUEST_TIMEOUT_MS)
    assert.equal(multipartCall.options.parallel, OSS_MULTIPART_PARALLEL)
    assert.equal(multipartCall.options.partSize, OSS_MULTIPART_PART_SIZE_BYTES)
    assert.equal(headCalls.length, 2)
    assert.ok(headCalls.every((call) => call.options.timeout === OSS_REQUEST_TIMEOUT_MS))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('publisher rejects an OSS object whose remote size does not match', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-publish-size-test-'))
  const filePath = join(tempDir, 'version_info.json')
  const client = {
    async put() {},
    async head() {
      return { res: { headers: { 'content-length': '1' } } }
    },
  }

  try {
    writeFileSync(filePath, '{"version":"0.0.59"}')
    await assert.rejects(
      uploadFile(client, 'release/version_info.json', filePath, false),
      /Uploaded size mismatch/,
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('publisher aborts an incomplete multipart upload and preserves the original failure', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-publish-abort-test-'))
  const filePath = join(tempDir, 'Bitterless-test.dmg')
  const calls = []
  const uploadError = new Error('multipart upload failed')
  const client = {
    async multipartUpload(objectKey, _filePath, options) {
      calls.push({ method: 'multipartUpload', objectKey })
      await options.progress(0, { uploadId: 'upload-123' })
      throw uploadError
    },
    async abortMultipartUpload(objectKey, uploadId, options) {
      calls.push({ method: 'abortMultipartUpload', objectKey, uploadId, options })
    },
    async head() {
      throw new Error('head must not run after multipart failure')
    },
  }

  try {
    writeFileSync(filePath, '')
    truncateSync(filePath, OSS_MULTIPART_THRESHOLD_BYTES)
    await assert.rejects(
      uploadFile(client, 'release/Bitterless-test.dmg', filePath, false),
      (error) => error === uploadError,
    )
    assert.deepEqual(calls, [
      { method: 'multipartUpload', objectKey: 'release/Bitterless-test.dmg' },
      {
        method: 'abortMultipartUpload',
        objectKey: 'release/Bitterless-test.dmg',
        uploadId: 'upload-123',
        options: { timeout: OSS_REQUEST_TIMEOUT_MS },
      },
    ])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('publisher preserves the upload failure when multipart cleanup also fails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-publish-abort-failure-test-'))
  const filePath = join(tempDir, 'Bitterless-test.dmg')
  const uploadError = new Error('multipart upload failed')
  const client = {
    async multipartUpload(_objectKey, _filePath, options) {
      await options.progress(0, { uploadId: 'upload-456' })
      throw uploadError
    },
    async abortMultipartUpload() {
      throw Object.assign(new Error('cleanup failed'), { code: 'CleanupFailed' })
    },
  }

  try {
    writeFileSync(filePath, '')
    truncateSync(filePath, OSS_MULTIPART_THRESHOLD_BYTES)
    await assert.rejects(
      uploadFile(client, 'release/Bitterless-test.dmg', filePath, false),
      (error) => error === uploadError,
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('release uploads artifacts before the manifest and refreshes only afterward', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bitterless-publish-order-test-'))
  const artifact = join(tempDir, 'Bitterless-test.zip.blockmap')
  const manifest = join(tempDir, 'version_info.json')
  const calls = []
  const sizes = new Map()
  const client = {
    async put(objectKey, filePath) {
      calls.push(`put:${objectKey}`)
      sizes.set(objectKey, statSync(filePath).size)
    },
    async head(objectKey) {
      calls.push(`head:${objectKey}`)
      return { res: { headers: { 'content-length': String(sizes.get(objectKey)) } } }
    },
  }

  try {
    writeFileSync(artifact, 'artifact')
    writeFileSync(manifest, '{"version":"0.0.60"}')
    await publishRelease({
      client,
      objectPrefix: 'release',
      artifacts: [artifact],
      versionInfoPath: manifest,
      dryRun: false,
      refresh: async () => calls.push('refresh'),
    })
    assert.deepEqual(calls, [
      'put:release/Bitterless-test.zip.blockmap',
      'head:release/Bitterless-test.zip.blockmap',
      'put:release/version_info.json',
      'head:release/version_info.json',
      'refresh',
    ])

    calls.length = 0
    await uploadReleaseFiles(null, 'release', [artifact], manifest, true)
    assert.deepEqual(calls, [])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
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

test('mac application and DMG notarization use one logged network-retry workflow', () => {
  const builder = read('electron-builder.tmp.yml')
  const notarizeSource = read('scripts/notarize.js')
  const publishSource = read('scripts/publish.js')
  const releaseChannelSource = read('scripts/release/releaseChannel.cjs')
  const pkg = JSON.parse(read('package.json'))
  const submitStart = notarizeSource.indexOf('const submitWithRetry = async')
  const waitStart = notarizeSource.indexOf('const waitWithRetry = async')
  const submitSource = notarizeSource.slice(submitStart, waitStart)

  assert.match(builder, /^afterSign: scripts\/notarize\.js$/m)
  assert.match(builder, /^  notarize: false$/m)
  assert.doesNotMatch(builder, /--no-s3-acceleration/)
  assert.match(notarizeSource, /const SUBMIT_RETRY_DELAYS_MS = \[[^\]]+\]/)
  assert.match(notarizeSource, /const WAIT_RETRY_DELAYS_MS = \[[^\]]+\]/)
  assert.match(notarizeSource, /const NETWORK_FAILURE_PATTERNS = \[/)
  assert.match(notarizeSource, /transient submit transport failure/)
  assert.match(notarizeSource, /without uploading again/)
  assert.match(notarizeSource, /S3 acceleration enabled/)
  assert.match(notarizeSource, /'--s3-acceleration'/)
  assert.doesNotMatch(notarizeSource, /--no-s3-acceleration/)
  assert.match(submitSource, /'notarytool',\s*'submit'/)
  assert.doesNotMatch(submitSource, /'--wait'/)
  assert.match(notarizeSource, /'notarytool',\s*'wait',\s*submissionId/)
  assert.match(notarizeSource, /status === 'Accepted'/)
  assert.match(notarizeSource, /status === 'Invalid' \|\| status === 'Rejected'/)
  assert.match(notarizeSource, /fetchNotarizationLog\(submissionId, credentials\)/)
  assert.match(notarizeSource, /\[\$\{timestamp\(\)\}\] \[notarize\]/)
  assert.doesNotMatch(notarizeSource, /console\.(?:log|warn|error)\([^\n]*(?:appleId|appPassword)/)
  assert.match(notarizeSource, /mkdtempSync/)
  assert.match(notarizeSource, /\['-c', '-k', '--keepParent', '--sequesterRsrc', exactAppPath, zipPath\]/)
  assert.match(notarizeSource, /\['stapler', 'staple', targetPath\]/)
  assert.match(notarizeSource, /\['stapler', 'validate', targetPath\]/)
  assert.match(notarizeSource, /module\.exports = \{\s*afterSign,/)
  assert.match(notarizeSource, /--file <path>/)
  assert.equal(pkg.scripts['notarize:file'], 'node scripts/notarize.js --file')
  assert.equal(pkg.scripts['notarize:mac_arm'], 'node scripts/notarize.js --dist dist/mac-arm64')
  assert.equal(pkg.scripts['notarize:mac_x64'], 'node scripts/notarize.js --dist dist/mac')
  assert.match(publishSource, /const \{ notarizeDmg \} = require\('\.\/notarize\.js'\)/)
  assert.match(publishSource, /const finalizeMacDmg = async/)
  assert.match(publishSource, /await notarizeDmg\(dmgPath\)/)
  assert.match(publishSource, /await finalizeMacDmg\(options\.platform, targetDistDir\)/)
  assert.match(releaseChannelSource, /artifactNameMatchesVersion\(name, version\)/)
  assert.match(releaseChannelSource, /Expected exactly one DMG artifact for version/)
})

test('notarization retry classification is limited to concrete transient transport failures', () => {
  const transientFixtures = [
    'abortedUpload(resumeRequest: ..., error: HTTPClientError.deadlineExceeded)',
    'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
    'request failed with ECONNRESET',
    'HTTP status code: 429 Too Many Requests',
    'HTTP response 503 Service Unavailable',
    'Timed out while waiting for notarization status',
    'polling timeout while reading notarization status',
  ]
  for (const fixture of transientFixtures) {
    assert.equal(isTransientNetworkFailure(fixture), true, fixture)
  }

  const permanentFixtures = [
    'HTTPClientError.unauthorized',
    'abortedUpload(resumeRequest: ..., error: malformed package)',
    'SotoS3 error: HTTP status code: 403 AccessDenied',
    'Error Domain=NSURLErrorDomain Code=-1202 "The certificate for this server is invalid."',
    'TLS handshake failed: certificate verify failed',
    'Preflight check failed: the package is invalid',
    'HTTP status code: 401 Unauthorized',
  ]
  for (const fixture of permanentFixtures) {
    assert.equal(isTransientNetworkFailure(fixture), false, fixture)
  }
})

test('notarization output parsers retain the submission ID and final status', () => {
  const submissionId = 'c0cdb8d3-3003-47aa-a5b2-8e7447d9c963'
  assert.equal(parseSubmissionId(`Submission ID received\nid: ${submissionId}`), submissionId)
  assert.equal(
    parseNotarizationStatus('Current status: In Progress\nstatus: Accepted'),
    'Accepted',
  )
})

test('artifact version matching rejects prefix collisions', () => {
  assert.equal(artifactNameMatchesVersion('Bitterless-0.0.49.dmg', '0.0.49'), true)
  assert.equal(artifactNameMatchesVersion('Bitterless-0.0.49-arm64-mac.zip', '0.0.49'), true)
  assert.equal(artifactNameMatchesVersion('Bitterless-0.0.49.dmg.blockmap', '0.0.49'), true)
  assert.equal(artifactNameMatchesVersion('Bitterless-0.0.490.dmg', '0.0.49'), false)
  assert.equal(artifactNameMatchesVersion('Bitterless-0.0.41.dmg', '0.0.4'), false)
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

const createManifestClient = (manifests, requestedKeys = []) => ({
  requestedKeys,
  async get(objectKey) {
    requestedKeys.push(objectKey)
    if (!Object.hasOwn(manifests, objectKey)) {
      const error = new Error(`NoSuchKey: ${objectKey}`)
      error.code = 'NoSuchKey'
      throw error
    }
    return { content: Buffer.from(JSON.stringify(manifests[objectKey])) }
  },
})

const previewPublishOptions = {
  env: 'preview',
  platform: 'mac_arm',
  prefix: 'bitterless/distro',
}

test('publisher refuses a version_code another channel already published', async () => {
  const client = createManifestClient({
    'bitterless/distro/prod/mac_arm/version_info.json': {
      version: '0.0.84',
      versionCode: '260901164356',
    },
  })

  await assert.rejects(
    () => assertNoCrossChannelIdentityReuse(client, previewPublishOptions, {
      version: '0.0.85',
      version_code: '260901164356',
    }),
    /Refusing cross-channel version_code reuse: 260901164356 is already published as prod\/mac_arm 0\.0\.84/,
  )
})

test('publisher refuses a version another channel already published under a different code', async () => {
  const client = createManifestClient({
    'bitterless/distro/dev/mac_arm/version_info.json': {
      version: '0.0.84',
      versionCode: '260901100000',
    },
  })

  await assert.rejects(
    () => assertNoCrossChannelIdentityReuse(client, previewPublishOptions, {
      version: '0.0.84',
      version_code: '260901164356',
    }),
    /Refusing cross-channel version reuse: 0\.0\.84 is already published as dev\/mac_arm with version_code 260901100000/,
  )
})

test('publisher allows an unused identity and inspects only the other channels of one platform', async (t) => {
  const logs = []
  const client = createManifestClient({
    'bitterless/distro/preview/mac_arm/version_info.json': {
      version: '0.0.84',
      versionCode: '260901164356',
    },
    'bitterless/distro/prod/mac_intel/version_info.json': {
      version: '0.0.85',
      versionCode: '260902090000',
    },
  })
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')))

  await assertNoCrossChannelIdentityReuse(client, previewPublishOptions, {
    version: '0.0.85',
    version_code: '260902090000',
  })

  assert.deepEqual(client.requestedKeys, [
    'bitterless/distro/dev/mac_arm/version_info.json',
    'bitterless/distro/prod/mac_arm/version_info.json',
  ])
  assert.deepEqual(logs, [
    '[publish.js] Cross-channel identity verified: 0.0.85 (260902090000) is unused outside preview',
  ])
})

test('publisher refuses to publish when another channel manifest cannot be read', async () => {
  const transportFailure = new Error('RequestTimeoutError')
  transportFailure.code = 'RequestTimeoutError'
  const client = {
    async get() {
      throw transportFailure
    },
  }

  await assert.rejects(
    () => assertNoCrossChannelIdentityReuse(client, previewPublishOptions, {
      version: '0.0.85',
      version_code: '260902090000',
    }),
    /RequestTimeoutError/,
  )
})

test('publish runs the cross-channel identity guard in the same preflight as the order guard', () => {
  const source = read('scripts/publish.js')
  const mainSource = source.slice(source.indexOf('const main = async () =>'))
  const orderIndex = mainSource.indexOf('await assertNoRemoteDowngrade')
  const identityIndex = mainSource.indexOf('await assertNoCrossChannelIdentityReuse')
  const preflightIndex = mainSource.indexOf('if (options.preflightOnly)')
  const uploadIndex = mainSource.indexOf('await publishRelease({')

  assert(identityIndex > orderIndex)
  assert(preflightIndex > identityIndex)
  assert.equal(mainSource.split('await assertNoCrossChannelIdentityReuse').length - 1, 2)
  assert(mainSource.lastIndexOf('await assertNoCrossChannelIdentityReuse') < uploadIndex)
})
