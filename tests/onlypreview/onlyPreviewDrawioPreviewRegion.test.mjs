import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeCurrentVue,
  bounds,
  createHarness,
  descriptorFor,
  fileRef,
  host,
  presentationModule,
  state,
  withFakeTimeouts
} from './onlyPreviewPreviewRegionTest.helper.mjs';

test('Draw.io stays on Vue with one bounded asset, no Find adapter, and a one-shot watchdog', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    const vue = state.vueViews[0];
    state.describe = async () => descriptorFor('architecture.drawio', 'diagram');
    await service.present(host.hostToken, fileRef('architecture.drawio'));

    let snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.surface, 'vue');
    assert.equal(snapshot.adapterId, 'drawio-viewer');
    assert.equal(snapshot.selectedTextAvailable, false);
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(
      service
        .snapshotForVue(host.hostToken, vue.previewRuntimeToken)
        .descriptor.assetUrl?.startsWith('bitterless-preview://asset/'),
      true
    );
    assert.deepEqual(state.assetIssues.at(-1).options, {
      selectionRevision: snapshot.selectionRevision,
      maxBytes: 3
    });
    assert.equal(timers.filter((timer) => timer.delay === 30_000).length, 1);

    acknowledgeCurrentVue(service);
    service.reportVueReady(host.hostToken, snapshot.selectionRevision, vue.previewRuntimeToken);
    snapshot = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(timers[0].active, false);
    service.destroy();
  });
});

test('Draw.io timeout and adapter exit destroy the exact Vue runtime as the global cleanup fence', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    const originalVue = state.vueViews[0];
    state.describe = async () => descriptorFor('architecture.drawio', 'diagram');
    await service.present(host.hostToken, fileRef('architecture.drawio'));
    const watchdog = timers.find((timer) => timer.delay === 30_000);
    assert.ok(watchdog);
    watchdog.callback(...watchdog.args);

    let snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.adapterId, 'drawio-viewer');
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.error.code, 'DIAGRAM_RENDER_TIMEOUT');
    assert.equal(originalVue.webContents.destroyed, true);
    assert.equal(state.vueViews.length, 2);

    state.describe = async () => descriptorFor('second.drawio', 'diagram');
    await service.present(host.hostToken, fileRef('second.drawio'));
    const secondVue = state.vueViews.at(-1);
    acknowledgeCurrentVue(service);
    snapshot = service.snapshot(host.hostToken);
    service.reportVueReady(
      host.hostToken,
      snapshot.selectionRevision,
      secondVue.previewRuntimeToken
    );
    state.describe = async () => descriptorFor('current.md', 'text');
    await service.present(host.hostToken, fileRef('current.md'));
    assert.equal(secondVue.webContents.destroyed, true);
    assert.notEqual(state.vueViews.at(-1).previewRuntimeToken, secondVue.previewRuntimeToken);
    service.destroy();
  });
});

test('canonical presentation validation accepts the diagram and drawio-viewer contract', () => {
  const descriptor = descriptorFor('architecture.drawio', 'diagram');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'drawio-viewer',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'architecture.drawio' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: false
    }),
    true
  );
});
