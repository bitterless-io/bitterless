import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertManifestReleaseChannel,
  resolveUpdateDirectory
} from '../../src/main/updateHelper/updateChannel.service.ts';

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
