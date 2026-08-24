import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bounds,
  createHarness,
  descriptorFor,
  fileRef,
  host,
  state
} from './onlyPreviewPreviewRegionTest.helper.mjs';

test('public and runtime-bound Vue snapshots whitelist descriptor metadata without local paths', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vueToken = state.vueViews[0].previewRuntimeToken;
  const canonicalPath = '/Users/ral/private/workspace/fixture.png';
  state.describe = async () => ({
    ...descriptorFor('images/fixture.png', 'image'),
    displayPath: canonicalPath,
    absolutePath: canonicalPath,
    canonicalPath,
    nestedLeak: { canonicalPath }
  });

  await service.present(host.hostToken, fileRef('images/fixture.png'));

  for (const snapshot of [
    service.snapshot(host.hostToken),
    service.snapshotForVue(host.hostToken, vueToken)
  ]) {
    assert.ok(snapshot.descriptor);
    assert.equal('displayPath' in snapshot.descriptor, false);
    assert.equal('absolutePath' in snapshot.descriptor, false);
    assert.equal('canonicalPath' in snapshot.descriptor, false);
    assert.equal('nestedLeak' in snapshot.descriptor, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /\/Users\/ral\/private/u);
  }
  service.destroy();
});
