import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  assertManifestReleaseChannel,
  resolveUpdateDirectory
} from '../../src/main/updateHelper/updateChannel.service.ts';

const require = createRequire(import.meta.url);
const {
  RELEASE_BASE_URL,
  resolveUpdateDirectory: resolvePackagingUpdateDirectory,
  resolveUpdatePlatform
} = require('../../scripts/release/releaseChannel.cjs');

test('Preview update metadata is pinned to its exact channel and platform directory', () => {
  const expected = resolveUpdateDirectory('preview', 'mac_arm');
  const manifest = {
    channel: 'preview',
    platform: 'mac_arm',
    downloadUrl: expected,
    installerUrl: `${expected}/Bitterless-Preview-0.0.79.dmg`
  };
  assert.doesNotThrow(() => assertManifestReleaseChannel(manifest, 'preview', 'mac_arm'));
  for (const mismatch of [
    { ...manifest, channel: 'prod' },
    { ...manifest, platform: 'mac_intel' },
    { ...manifest, downloadUrl: resolveUpdateDirectory('prod', 'mac_arm') },
    { ...manifest, installerUrl: `${resolveUpdateDirectory('prod', 'mac_arm')}/Bitterless.dmg` },
    { ...manifest, installerUrl: `${expected}/nested/Bitterless-Preview.dmg` }
  ]) {
    assert.throws(() => assertManifestReleaseChannel(mismatch, 'preview', 'mac_arm'), /manifest/);
  }
  assert.throws(
    () =>
      assertManifestReleaseChannel({ ...manifest, installerUrl: undefined }, 'preview', 'mac_arm'),
    /declare installerUrl/
  );
});

test('Stable accepts legacy metadata only inside the exact Stable platform directory', () => {
  const stableDirectory = resolveUpdateDirectory('prod', 'win64');
  assert.doesNotThrow(() =>
    assertManifestReleaseChannel({ downloadUrl: stableDirectory }, 'prod', 'win64')
  );
  assert.throws(
    () =>
      assertManifestReleaseChannel(
        { downloadUrl: resolveUpdateDirectory('preview', 'win64') },
        'prod',
        'win64'
      ),
    /must equal/
  );
});

test('packaging and the running application resolve the same updater directory', () => {
  for (const channel of ['dev', 'preview', 'prod']) {
    for (const platform of ['mac_arm', 'mac_intel', 'win64']) {
      assert.equal(
        resolvePackagingUpdateDirectory(channel, platform),
        resolveUpdateDirectory(channel, platform)
      );
    }
  }
  assert.equal(resolveUpdateDirectory('preview', 'mac_arm'), `${RELEASE_BASE_URL}/preview/mac_arm`);
  assert.throws(() => resolvePackagingUpdateDirectory('beta', 'mac_arm'), /release channel/);
  assert.throws(() => resolvePackagingUpdateDirectory('prod', 'linux_x64'), /release platform/);
});

test('packaging resolves the platform tokens the running application detects', () => {
  assert.equal(resolveUpdatePlatform('darwin', 'arm64'), 'mac_arm');
  assert.equal(resolveUpdatePlatform('darwin', 'x64'), 'mac_intel');
  assert.equal(resolveUpdatePlatform('win32', 'x64'), 'win64');
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['win32', 'arm64'],
    ['darwin', 'ia32']
  ]) {
    assert.throws(
      () => resolveUpdatePlatform(platform, arch),
      /Unsupported update platform target/
    );
  }

  const updateService = readFileSync(
    new URL('../../src/main/updateHelper/update.service.ts', import.meta.url),
    'utf-8'
  );
  assert.match(updateService, /arch === 'arm64' \? 'mac_arm' : 'mac_intel'/);
  assert.match(updateService, /platform === 'win32'\) \{\s+return 'win64';/);
});

test('the packaged updater configuration template never ships a placeholder host', () => {
  const builderTemplate = readFileSync(
    new URL('../../electron-builder.tmp.yml', import.meta.url),
    'utf-8'
  );
  assert.match(builderTemplate, /^ {2}provider: generic$/m);
  assert.match(builderTemplate, new RegExp(`^ {2}url: ${RELEASE_BASE_URL}$`, 'm'));
  assert.doesNotMatch(builderTemplate, /example\.com/);
});
