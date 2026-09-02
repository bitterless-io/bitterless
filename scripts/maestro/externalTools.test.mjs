import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const {
  ANYDOC_BUNDLE_FILES,
  BINARY_TOOL_NAMES,
  INVENTORY,
  MANIFEST_FILENAME,
  createManifest,
  initializePlatform,
  normalizePackageTarget,
  payloadSpecsForPlatform,
  replacePlatformDirectory,
  stageExternalTools,
  validateExternalStore,
  verifyStagedExternalTools
} = require('./externalTools.cjs')
const { commandsForHost } = require('../prepare-maestro-package-tools.cjs')

const EXPECTED_BINARY_TARGETS = {
  bun: {
    version: '1.3.14',
    versionKey: 'bun_version',
    targets: {
      mac_arm: {
        archive: 'bun-darwin-aarch64.zip',
        archiveSha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
        inner: 'bun-darwin-aarch64/bun',
        output: 'bun',
        sha256: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip'
      },
      mac_intel: {
        archive: 'bun-darwin-x64.zip',
        archiveSha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
        inner: 'bun-darwin-x64/bun',
        output: 'bun',
        sha256: 'ea2f223e94bb2f4bf3050895113c3cf346438f6fa0501c8532284e063f72f7a0',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-x64.zip'
      },
      win: {
        archive: 'bun-windows-x64.zip',
        archiveSha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
        inner: 'bun-windows-x64/bun.exe',
        output: 'bun.exe',
        sha256: '0187f68d843f825a72ada4a7eca60db896ed753759a7f8252edcd31ac1bf1b9c',
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64.zip'
      }
    }
  },
  rg: {
    version: '14.1.1',
    versionKey: 'rg_version',
    targets: {
      mac_arm: {
        archive: 'ripgrep-14.1.1-aarch64-apple-darwin.tar.gz',
        archiveSha256: '24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be',
        inner: 'ripgrep-14.1.1-aarch64-apple-darwin/rg',
        output: 'rg',
        sha256: '0e0cb83f5195f1f51bb8feef1fff5b0b171e82bd1db6bd35deee701a3e7102f8',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'ripgrep-14.1.1-x86_64-apple-darwin.tar.gz',
        archiveSha256: 'fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3',
        inner: 'ripgrep-14.1.1-x86_64-apple-darwin/rg',
        output: 'rg',
        sha256: '923dcc25cab57d33f4e7dd0476d4b74a554401a38817e246a8d6101dcd51c50f',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'ripgrep-14.1.1-x86_64-pc-windows-msvc.zip',
        archiveSha256: 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1',
        inner: 'ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe',
        output: 'rg.exe',
        sha256: 'f162b54de2adfc72d78adb1dbada2dedda111ae0a5e2f6e9500f4f909664c5d2',
        url: 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip'
      }
    }
  },
  fd: {
    version: '10.5.0',
    versionKey: 'fd_version',
    targets: {
      mac_arm: {
        archive: 'fd-v10.5.0-aarch64-apple-darwin.tar.gz',
        archiveSha256: 'b67e1836c468e42e411984b56e52fa7abec08c2bd22c867398e7cc134aac5e12',
        inner: 'fd-v10.5.0-aarch64-apple-darwin/fd',
        output: 'fd',
        sha256: 'cf3bde435da174f41cf9589a2efeaf03804df7c250fc15e8b8a1e9bfc66ebc9a',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'fd-v10.5.0-x86_64-apple-darwin.tar.gz',
        archiveSha256: '7e31028c62c6955877735d0406807aa484c2a5e6f86235a59e26c29c301da590',
        inner: 'fd-v10.5.0-x86_64-apple-darwin/fd',
        output: 'fd',
        sha256: '7ca13c0959482c381a4de9b85fe8bef4233ab7e5232761e958ed0df3583baa89',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'fd-v10.5.0-x86_64-pc-windows-msvc.zip',
        archiveSha256: 'a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7',
        inner: 'fd-v10.5.0-x86_64-pc-windows-msvc/fd.exe',
        output: 'fd.exe',
        sha256: 'd67d27a8e375ed7e9bca2b506a9dd5082bc24547aeba908b863f6f8b8ab0c3b9',
        url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip'
      }
    }
  },
  ouch: {
    version: '0.8.2',
    versionKey: 'ouch_version',
    targets: {
      mac_arm: {
        archive: 'ouch-aarch64-apple-darwin.tar.gz',
        archiveSha256: '36d912a6739ccec6889b6e67cfe24d503e889b61c6da556b840a5e4e7e39a2e0',
        inner: 'ouch-aarch64-apple-darwin/ouch',
        output: 'ouch',
        sha256: 'b98e45e41dbbcfb6b0301b597c9fd8da4572e2e1813e18e4d578384fd386c1b0',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-aarch64-apple-darwin.tar.gz'
      },
      mac_intel: {
        archive: 'ouch-x86_64-apple-darwin.tar.gz',
        archiveSha256: 'db1f4eef469f481d3f609c00bbd64d6b981b61b1945f8d64f92cd622df515eab',
        inner: 'ouch-x86_64-apple-darwin/ouch',
        output: 'ouch',
        sha256: '5ace4075984e1e68926a3f90ab25dd56093133e304c2804cdaf3ee28ddfa36d7',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-x86_64-apple-darwin.tar.gz'
      },
      win: {
        archive: 'ouch-x86_64-pc-windows-msvc.zip',
        archiveSha256: '0a7d7570d272e7ef563a14fb8cbdddb55d2f532f35ce07544207d4c462dc00ab',
        inner: 'ouch-x86_64-pc-windows-msvc/ouch.exe',
        output: 'ouch.exe',
        sha256: '21d4c284813dfafb58a1fbdfb8f6c6d423fea37ee3b56b8a21a796fd95105b36',
        url: 'https://github.com/ouch-org/ouch/releases/download/0.8.2/ouch-x86_64-pc-windows-msvc.zip'
      }
    }
  }
}

const EXPECTED_ANYDOC = {
  version: '0.2.4',
  versionKey: 'anydoc_version',
  packageArchive: {
    filename: 'anydoc-0.2.4.tgz',
    sha256: '625bf6cdc24cc91eee8fbfe084c1fa56c71b17f034341d4a23bc8df0fdee31bd',
    sha512: 'rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==',
    url: 'https://registry.npmjs.org/@firecrawl/anydoc/-/anydoc-0.2.4.tgz'
  },
  bundle: {
    'anydoc.js': { sha256: '0203401be69a3d64dc45e45c3d0c4340afd97a4417ae40f76c4393d033e97b59' },
    'cli.js': { sha256: 'cc50a40f8710fc365230fb56625340f012b9ddd02315078e2947199f70652bd5' },
    'index.js': { sha256: '8a9d648382a789edbddd9207d7a2d4002963a862e5818e8ce9e981c2e6df7cf2' },
    'package.json': { sha256: '00305842980d83a2e066eb08be59b72ee66fc2a4e7170df4130a996f93e8411d' }
  },
  targets: {
    mac_arm: {
      asset: 'anydoc.darwin-arm64.node',
      output: 'anydoc/anydoc.node',
      sha256: '97477757b633802facbb344125ffade35bb4dea547e1f7c01e29c9924451f0d5',
      url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.darwin-arm64.node'
    },
    mac_intel: {
      asset: 'anydoc.darwin-x64.node',
      output: 'anydoc/anydoc.node',
      sha256: '5c211f9557e824dbf8d9e5ef8d8150813da910f4e9636e28ec82808fc583329b',
      url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.darwin-x64.node'
    },
    win: {
      asset: 'anydoc.win32-x64-msvc.node',
      output: 'anydoc/anydoc.node',
      sha256: '2883dbec5426f5e438489fef6186e3ced2b6ee1cb5deeb6524342eaf57635d19',
      url: 'https://github.com/firecrawl/anydoc/releases/download/v0.2.4/anydoc.win32-x64-msvc.node'
    }
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const cloneInventory = () => JSON.parse(JSON.stringify(INVENTORY))
const write = (filePath, contents) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents)
}

const writePackageJson = (root, inventory) => {
  const pkg = {}
  for (const tool of [...BINARY_TOOL_NAMES, 'anydoc']) {
    pkg[inventory[tool].versionKey] = inventory[tool].version
  }
  write(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
}

const setFixtureHashes = (inventory, platform) => {
  for (const tool of BINARY_TOOL_NAMES) {
    const contents = Buffer.from(`${platform}:${tool}:fixture`)
    inventory[tool].targets[platform].sha256 = sha256(contents)
  }
  const bundleContents = {
    'anydoc.js': Buffer.from('module.exports = {}\n'),
    'cli.js': Buffer.from('#!/usr/bin/env node\n'),
    'index.js': Buffer.from('module.exports = {}\n'),
    'package.json': Buffer.from(
      `${JSON.stringify({ name: '@firecrawl/anydoc', version: inventory.anydoc.version })}\n`
    )
  }
  for (const name of ANYDOC_BUNDLE_FILES) {
    inventory.anydoc.bundle[name].sha256 = sha256(bundleContents[name])
  }
  const nativeContents = Buffer.from(`${platform}:anydoc-native:fixture`)
  inventory.anydoc.targets[platform].sha256 = sha256(nativeContents)
  return { bundleContents, nativeContents }
}

const writeStore = (root, platform, inventory) => {
  const { bundleContents, nativeContents } = setFixtureHashes(inventory, platform)
  const directory = join(root, 'external_tools', platform)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  write(join(directory, '.gitkeep'), '')
  for (const tool of BINARY_TOOL_NAMES) {
    write(
      join(directory, inventory[tool].targets[platform].output),
      Buffer.from(`${platform}:${tool}:fixture`)
    )
  }
  for (const [name, contents] of Object.entries(bundleContents)) {
    write(join(directory, 'anydoc', name), contents)
  }
  write(join(directory, inventory.anydoc.targets[platform].output), nativeContents)
  const manifest = createManifest(directory, platform, inventory)
  write(join(directory, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`)
  return directory
}

const writeCliStage = (root, packageTarget) => {
  const stage = join(root, 'build', 'maestro-tools')
  mkdirSync(stage, { recursive: true })
  const staged = packageTarget === 'win64' ? 'micromeet.exe' : 'micromeet'
  write(join(stage, staged), 'fixture CLI')
  write(
    join(stage, 'manifest.json'),
    `${JSON.stringify({ platform: packageTarget, staged, cliTarget: packageTarget }, null, 2)}\n`
  )
  return { stage, staged }
}

const makeFixture = (platform = 'mac_arm') => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-external-tools-test-'))
  const inventory = cloneInventory()
  writePackageJson(root, inventory)
  const directory = writeStore(root, platform, inventory)
  return { directory, inventory, root }
}

test('package target mapping uses the three requested external_tools directories', () => {
  assert.deepEqual(normalizePackageTarget('mac_arm'), {
    packageTarget: 'mac_arm',
    storePlatform: 'mac_arm'
  })
  assert.deepEqual(normalizePackageTarget('mac_intel'), {
    packageTarget: 'mac_intel',
    storePlatform: 'mac_intel'
  })
  assert.deepEqual(normalizePackageTarget('win64'), {
    packageTarget: 'win64',
    storePlatform: 'win'
  })
  assert.throws(() => normalizePackageTarget('linux_x64'), /platform must be one of/)
})

test('release inventory locks every platform asset, archive hash, output, and payload hash', () => {
  for (const [tool, expected] of Object.entries(EXPECTED_BINARY_TARGETS)) {
    assert.deepEqual(INVENTORY[tool], expected, `${tool} release inventory drifted`)
  }
  assert.deepEqual(INVENTORY.anydoc, EXPECTED_ANYDOC, 'AnyDoc release inventory drifted')
})

test('unpack dispatcher preserves external-tools hosts and the legacy Linux tool path', () => {
  assert.deepEqual(
    commandsForHost('darwin', 'arm64').map((entry) => entry.args),
    [
      ['scripts/maestro/externalTools.cjs', 'stage', 'mac_arm'],
      ['scripts/maestro/externalTools.cjs', 'verify-stage', 'mac_arm']
    ]
  )
  assert.deepEqual(
    commandsForHost('darwin', 'x64').map((entry) => entry.args),
    [
      ['scripts/maestro/externalTools.cjs', 'stage', 'mac_intel'],
      ['scripts/maestro/externalTools.cjs', 'verify-stage', 'mac_intel']
    ]
  )
  assert.deepEqual(
    commandsForHost('win32', 'x64').map((entry) => entry.args),
    [
      ['scripts/maestro/externalTools.cjs', 'stage', 'win64'],
      ['scripts/maestro/externalTools.cjs', 'verify-stage', 'win64']
    ]
  )
  for (const [arch, target] of [
    ['arm64', 'linux_arm'],
    ['x64', 'linux_x64']
  ]) {
    assert.deepEqual(
      commandsForHost('linux', arch).map((entry) => entry.args),
      [
        ['scripts/prepare-maestro-anydoc.cjs', target],
        ['scripts/prepare-maestro-archive.cjs', target],
        ['scripts/prepare-maestro-anydoc.cjs', target, '--verify']
      ]
    )
  }
  assert.throws(() => commandsForHost('linux', 'ia32'), /unsupported unpack host/)
  assert.throws(() => commandsForHost('freebsd', 'x64'), /unsupported unpack host/)
})

test('platform replacement installs atomically and restores the old directory on install failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-external-tools-atomic-test-'))
  try {
    const destination = join(root, 'mac_arm')
    const replacement = join(root, '.mac_arm.init-success')
    mkdirSync(destination)
    mkdirSync(replacement)
    write(join(destination, 'old'), 'old')
    write(join(replacement, 'new'), 'new')
    replacePlatformDirectory(replacement, destination)
    assert.equal(existsSync(join(destination, 'old')), false)
    assert.equal(readFileSync(join(destination, 'new'), 'utf8'), 'new')
    assert.equal(existsSync(replacement), false)
    assert.deepEqual(readdirSync(root), ['mac_arm'])

    const failedReplacement = join(root, '.mac_arm.init-failure')
    mkdirSync(failedReplacement)
    write(join(failedReplacement, 'never-installed'), 'newer')
    let renameCount = 0
    const failInstallationRename = (source, target) => {
      renameCount += 1
      if (renameCount === 2) throw new Error('fixture install failure')
      renameSync(source, target)
    }
    assert.throws(
      () =>
        replacePlatformDirectory(failedReplacement, destination, {
          rename: failInstallationRename
        }),
      /fixture install failure/
    )
    assert.equal(readFileSync(join(destination, 'new'), 'utf8'), 'new')
    assert.equal(existsSync(failedReplacement), false)
    assert.deepEqual(readdirSync(root), ['mac_arm'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('initializePlatform is idempotent for a valid non-force store without entering downloads', () => {
  const fixture = makeFixture()
  try {
    let initializerCalls = 0
    const failIfCalled = () => {
      initializerCalls += 1
      throw new Error('download path must not run')
    }
    const initialized = initializePlatform(
      fixture.root,
      'mac_arm',
      false,
      fixture.inventory,
      {
        initializeBinary: failIfCalled,
        initializeDocumentTool: failIfCalled,
        replaceDirectory: failIfCalled
      }
    )
    assert.equal(initialized, false)
    assert.equal(initializerCalls, 0)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('strict store validation rejects missing, tampered, and symlinked payloads', () => {
  const fixture = makeFixture()
  try {
    assert.doesNotThrow(() => validateExternalStore(fixture.root, 'mac_arm', fixture.inventory))

    const bun = join(fixture.directory, 'bun')
    write(bun, 'tampered')
    assert.throws(
      () => validateExternalStore(fixture.root, 'mac_arm', fixture.inventory),
      /size mismatch|sha256 mismatch/
    )

    writeStore(fixture.root, 'mac_arm', fixture.inventory)
    rmSync(join(fixture.directory, 'rg'))
    assert.throws(
      () => validateExternalStore(fixture.root, 'mac_arm', fixture.inventory),
      /unexpected files/
    )

    writeStore(fixture.root, 'mac_arm', fixture.inventory)
    rmSync(join(fixture.directory, 'fd'))
    symlinkSync(join(fixture.directory, 'rg'), join(fixture.directory, 'fd'))
    assert.throws(
      () => validateExternalStore(fixture.root, 'mac_arm', fixture.inventory),
      /symlinks are forbidden/
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

for (const [storePlatform, packageTarget] of [
  ['mac_arm', 'mac_arm'],
  ['mac_intel', 'mac_intel'],
  ['win', 'win64']
]) {
  test(`offline ${storePlatform} store stages and verifies only its ${packageTarget} filenames`, () => {
    const fixture = makeFixture(storePlatform)
    try {
      const cli = writeCliStage(fixture.root, packageTarget)
      const stale = storePlatform === 'win'
        ? ['bun', 'rg', 'fd', 'ouch']
        : ['bun.exe', 'rg.exe', 'fd.exe', 'ouch.exe']
      for (const filename of stale) write(join(cli.stage, filename), 'stale')

      stageExternalTools(fixture.root, packageTarget, fixture.inventory)
      assert.equal(readFileSync(join(cli.stage, cli.staged), 'utf8'), 'fixture CLI')
      for (const filename of stale) assert.equal(existsSync(join(cli.stage, filename)), false)
      for (const spec of payloadSpecsForPlatform(storePlatform, fixture.inventory)) {
        assert.equal(existsSync(join(cli.stage, spec.path)), true, `${spec.path} was not staged`)
      }
      assert.doesNotThrow(() =>
        verifyStagedExternalTools(fixture.root, packageTarget, fixture.inventory)
      )

      const rg = fixture.inventory.rg.targets[storePlatform].output
      write(join(cli.stage, rg), 'tampered after staging')
      assert.throws(
        () => verifyStagedExternalTools(fixture.root, packageTarget, fixture.inventory),
        /size mismatch|sha256 mismatch/
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
}

test('source packaging contract is offline, target-scoped, ignored, and externally resourced', () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.anydoc_version, '0.2.4')
  assert.equal(pkg.ouch_version, '0.8.2')
  assert.equal(pkg.bun_version, '1.3.14')
  assert.equal(pkg.rg_version, '14.1.1')
  assert.equal(pkg.fd_version, '10.5.0')
  assert.equal(pkg.scripts['external-tools:init'], 'node scripts/maestro/externalTools.cjs init')

  const unpack = pkg.scripts['_package:unpack']
  assert.ok(
    unpack.indexOf('prepare:maestro-cli') < unpack.indexOf('prepare-maestro-package-tools.cjs'),
    '_package:unpack must prepare the CLI before dispatching host tools'
  )
  assert.doesNotMatch(unpack, /prepare-maestro-(anydoc|archive)\.cjs|externalTools\.cjs/)

  for (const scriptName of ['_package:mac_arm', '_package:mac_x64', '_package:win']) {
    const script = pkg.scripts[scriptName]
    const cli = script.indexOf('prepare:maestro-cli') >= 0
      ? script.indexOf('prepare:maestro-cli')
      : script.indexOf('prepare-maestro-cli.cjs')
    const stage = script.indexOf('external-tools:stage') >= 0
      ? script.indexOf('external-tools:stage')
      : script.indexOf('externalTools.cjs stage')
    const verify = script.indexOf('external-tools:verify') >= 0
      ? script.indexOf('external-tools:verify')
      : script.indexOf('externalTools.cjs verify-stage')
    assert.ok(cli >= 0 && cli < stage && stage < verify, `${scriptName} must run CLI → stage → verify`)
    assert.doesNotMatch(script, /prepare-maestro-(anydoc|archive)\.cjs/)
  }
  assert.match(pkg.scripts['_package:linux_x64'], /prepare-maestro-anydoc\.cjs linux_x64/)
  assert.match(pkg.scripts['_package:linux_arm64'], /prepare-maestro-anydoc\.cjs linux_arm/)

  const builder = readFileSync(join(projectRoot, 'electron-builder.tmp.yml'), 'utf8')
  for (const sourceExclusion of ["'!external_tools/**'", "'!prebuilt/**'"]) {
    assert.ok(builder.includes(sourceExclusion))
  }
  assert.match(builder, /from: build\/maestro-tools\s+to: maestro-tools/)
  for (const binary of ['micromeet', 'bun', 'rg', 'fd', 'anydoc/anydoc.node', 'ouch']) {
    assert.ok(builder.includes(`Contents/Resources/maestro-tools/${binary}`))
  }

  for (const directory of ['mac_arm', 'mac_intel', 'win']) {
    assert.equal(existsSync(join(projectRoot, 'external_tools', directory, '.gitkeep')), true)
    const ignored = spawnSync(
      'git',
      ['check-ignore', '--no-index', `external_tools/${directory}/runtime-binary`],
      { cwd: projectRoot }
    )
    assert.equal(ignored.status, 0, `${directory} payload must be ignored`)
    const gitkeep = spawnSync(
      'git',
      ['check-ignore', '--no-index', `external_tools/${directory}/.gitkeep`],
      { cwd: projectRoot }
    )
    assert.equal(gitkeep.status, 1, `${directory}/.gitkeep must stay tracked`)
  }
  const rogue = spawnSync('git', ['check-ignore', '--no-index', 'external_tools/rogue'], {
    cwd: projectRoot
  })
  assert.equal(rogue.status, 0, 'rogue external_tools root entries must be ignored')

  execFileSync(process.execPath, ['--check', 'scripts/maestro/externalTools.cjs'], {
    cwd: projectRoot,
    stdio: 'pipe'
  })
  execFileSync(process.execPath, ['--check', 'scripts/prepare-maestro-package-tools.cjs'], {
    cwd: projectRoot,
    stdio: 'pipe'
  })
})
