import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeCurrentVue,
  bounds,
  ContractError,
  createHarness,
  deferred,
  descriptorFor,
  fileRef,
  host,
  presentationModule,
  source,
  state,
  tick,
  withFakeTimeouts
} from './onlyPreviewPreviewRegionTest.helper.mjs';

test('Preview open diagnostics terminate each revision once and stale revisions cannot finish the new trace', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);

  await service.present(host.hostToken, fileRef('notes/first.md'));
  const firstView = acknowledgeCurrentVue(service);
  let snapshot = service.snapshot(host.hostToken);
  service.reportVueReady(host.hostToken, snapshot.selectionRevision, firstView.previewRuntimeToken);
  assert.deepEqual(state.openTraceRecords[0].terminals, [
    { revision: snapshot.selectionRevision, surface: 'vue', outcome: 'ready' }
  ]);

  await service.present(host.hostToken, fileRef('notes/second.md'));
  const secondRevision = service.snapshot(host.hostToken).selectionRevision;
  await service.present(host.hostToken, fileRef('notes/third.md'));
  snapshot = service.snapshot(host.hostToken);
  assert.deepEqual(state.openTraceRecords[1].terminals, [
    { revision: secondRevision, surface: 'vue', outcome: 'superseded' }
  ]);
  assert.equal(state.openTraceRecords[2].terminals.length, 0);

  assert.throws(() =>
    service.reportVueReady(host.hostToken, secondRevision, firstView.previewRuntimeToken)
  );
  assert.equal(state.openTraceRecords[2].terminals.length, 0);
  assert.equal(snapshot.selectionRevision > secondRevision, true);
});

test('Preview open diagnostics cover Chrome ready/error and clear/destroy terminals', async () => {
  let harness = createHarness();
  harness.service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  await harness.service.present(host.hostToken, fileRef('page.html'));
  state.chromeViews[0].webContents.emit('did-finish-load');
  assert.deepEqual(state.openTraceRecords[0].terminals, [
    { revision: 1, surface: 'chrome', outcome: 'ready' }
  ]);

  harness = createHarness();
  harness.service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  state.nextChromeLoadError = new Error('fixture load failed');
  await harness.service.present(host.hostToken, fileRef('page.html'));
  assert.deepEqual(state.openTraceRecords[0].terminals, [
    { revision: 1, surface: 'chrome', outcome: 'error' }
  ]);

  harness = createHarness();
  harness.service.updateBounds(host.hostToken, bounds);
  await harness.service.present(host.hostToken, fileRef('clear.md'));
  harness.service.clearWorkspace(host.hostToken, 'workspace-id');
  assert.deepEqual(state.openTraceRecords[0].terminals, [
    { revision: 1, surface: 'vue', outcome: 'superseded' }
  ]);
  await harness.service.present(host.hostToken, fileRef('destroy.md'));
  harness.service.destroy();
  assert.deepEqual(state.openTraceRecords[1].terminals, [
    { revision: 3, surface: 'vue', outcome: 'superseded' }
  ]);
});

test('first valid bounds creates Vue detached and exact reset acknowledgement attaches it', () => {
  const { service, children, additions } = createHarness();
  assert.equal(state.vueViews.length, 0);
  assert.equal(children.size, 0);

  service.updateBounds(host.hostToken, bounds);
  assert.equal(state.vueViews.length, 1);
  assert.equal(state.vueLoads.length, 1);
  assert.equal(children.size, 0);
  assert.equal(additions.length, 0);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 0, state.vueViews[0].previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );

  const vue = acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
  assert.equal(additions.length, 1);
  assert.deepEqual(state.vueViews[0].bounds, bounds);
});

test('presentation broadcasts are host-only nudges and reject forged renderer state', () => {
  assert.equal(presentationModule.isOnlyPreviewPresentationNudge({ hostId: host.hostId }), true);
  assert.equal(
    presentationModule.isOnlyPreviewPresentationNudge({
      hostId: host.hostId,
      selectionRevision: Number.MAX_SAFE_INTEGER,
      status: 'ready'
    }),
    false
  );
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const vueStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(region, /broadcast\(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, \{\s*hostId:/);
  assert.match(shellStore, /previewPresentation:\s*\(\) => void this\.syncPreviewPresentation\(\)/);
  assert.match(shellStore, /previewPresentationFetchGeneration/);
  assert.match(vueStore, /presentationFetchGeneration/);
  assert.doesNotMatch(vueStore, /expectedRevision/);
});

test('bounds updates during describe cannot reattach the stale Vue surface', async () => {
  const { service, children, additions } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const oldVue = acknowledgeCurrentVue(service);
  const pendingDescribe = deferred();
  state.describe = async () => pendingDescribe.promise;

  const presentation = service.present(host.hostToken, fileRef('notes/readme.md'));
  await tick();
  assert.equal(children.has(oldVue), false);
  const additionsBeforeResize = additions.length;
  service.updateBounds(host.hostToken, { ...bounds, width: 680 });
  assert.equal(additions.length, additionsBeforeResize);

  pendingDescribe.resolve(descriptorFor('notes/readme.md', 'text'));
  await presentation;
  assert.equal(children.has(oldVue), false);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 1);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 0, oldVue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(oldVue), true);
});

test('presentation revalidates the opened identity before installing any descriptor authority', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('replaced.txt', 'text');
  state.assertOpenedFileCurrent = async () => {
    throw new ContractError('PATH_NOT_FOUND', 'replaced before presentation');
  };

  await service.present(host.hostToken, fileRef('replaced.txt'));

  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.error.code, 'PATH_NOT_FOUND');
  assert.equal(state.assetIssues.length, 0);
  assert.ok(state.documentRevocations > 0);
});

test('late HTML preview preparation is cancelled and cannot overwrite a newer Vue selection', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = acknowledgeCurrentVue(service);
  const prepare = { started: deferred(), completion: deferred() };
  state.nextPreviewPrepareDeferred = prepare;
  state.describe = async () => descriptorFor('stale.html', 'text');
  const stalePresentation = service.present(host.hostToken, fileRef('stale.html'));
  const staleGrant = await prepare.started.promise;

  state.describe = async () => descriptorFor('current.md', 'text');
  await service.present(host.hostToken, fileRef('current.md'));
  assert.equal(children.has(vue), false);
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'current.md');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);

  prepare.completion.resolve();
  await stalePresentation;
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'current.md');
  assert.equal(state.chromeViews.length, 0);
  assert.equal(state.protocolInstalls.length, 0);
  assert.equal(
    state.previewCancels.some(
      (request) =>
        request.grantId === staleGrant.grantId &&
        request.selectionRevision === staleGrant.selectionRevision
    ),
    true
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
});

test('Vue file transitions and workspace clear stay detached until the exact reset ack', async () => {
  const { service, children, additions } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = acknowledgeCurrentVue(service);

  state.describe = async () => descriptorFor('first.md', 'text');
  await service.present(host.hostToken, fileRef('first.md'));
  vue.renderedRevision = 1;
  assert.equal(children.has(vue), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);

  state.describe = async () => descriptorFor('second.md', 'text');
  await service.present(host.hostToken, fileRef('second.md'));
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  assert.equal(vue.renderedRevision, 1);
  assert.equal(children.has(vue), false);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 1, vue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.equal(children.has(vue), false);
  vue.renderedRevision = 2;
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);

  service.clearWorkspace(host.hostToken, 'workspace-id');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 3);
  assert.equal(children.has(vue), false);
  assert.throws(
    () => service.reportVueReset(host.hostToken, 2, vue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.equal(children.has(vue), false);
  vue.renderedRevision = 3;
  acknowledgeCurrentVue(service);
  assert.equal(children.has(vue), true);
  assert.equal(additions.at(-1), vue);
});

test('public presentation strips capabilities while the current Vue runtime receives media only', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vueToken = state.vueViews[0].previewRuntimeToken;
  state.describe = async () => descriptorFor('image.png', 'image');
  await service.present(host.hostToken, fileRef('image.png'));
  const mediaUrl =
    state.assetIssues.at(-1) && `bitterless-preview://asset/${'a'.repeat(64)}/1-image.png`;

  assert.equal(service.snapshot(host.hostToken).descriptor.assetUrl, undefined);
  assert.equal(service.snapshotForVue(host.hostToken, vueToken).descriptor.assetUrl, mediaUrl);

  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  assert.equal(service.snapshot(host.hostToken).descriptor.assetUrl, undefined);
  assert.equal(service.snapshotForVue(host.hostToken, vueToken).descriptor.assetUrl, undefined);
});

test('recognized unsupported media and classifier-terminal empty files issue no asset or player adapter', async () => {
  for (const [relativePath, unsupportedCategory] of [
    ['fixture.heic', 'image-format'],
    ['fixture.mkv', 'video-container'],
    ['fixture.bin', undefined]
  ]) {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => ({
      ...descriptorFor(relativePath, 'unsupported'),
      ...(unsupportedCategory ? { unsupportedCategory } : {})
    });
    await service.present(host.hostToken, fileRef(relativePath));
    const snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.adapterId, 'unsupported');
    assert.equal(snapshot.descriptor.unsupportedCategory, unsupportedCategory);
    assert.equal(snapshot.selectedTextAvailable, false);
    assert.equal(state.assetIssues.length, 0);
    service.destroy();
  }

  for (const [relativePath, kind, errorCode] of [
    ['empty.png', 'image', 'IMAGE_EMPTY'],
    ['empty.mp3', 'audio', 'MEDIA_EMPTY']
  ]) {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => ({
      ...descriptorFor(relativePath, kind),
      size: 0,
      previewError: { code: errorCode, message: 'empty' }
    });
    await service.present(host.hostToken, fileRef(relativePath));
    const snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.adapterId, 'unsupported');
    assert.equal(snapshot.error.code, errorCode);
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(state.assetIssues.length, 0);
    service.destroy();
  }
});

test('image and media reject wrong renderer error families without mutating loading or ready authority', async () => {
  for (const [relativePath, kind, rejectedErrorCodes] of [
    [
      'fixture.png',
      'image',
      ['MEDIA_NETWORK_FAILED', 'DOCUMENT_PARSE_FAILED', 'SHEET_PARSE_FAILED', 'OPERATION_FAILED']
    ],
    [
      'fixture.mp3',
      'audio',
      ['IMAGE_DECODE_FAILED', 'DOCUMENT_PARSE_FAILED', 'SHEET_PARSE_FAILED', 'OPERATION_FAILED']
    ],
    [
      'fixture.mp4',
      'video',
      ['IMAGE_DECODE_FAILED', 'DOCUMENT_PARSE_FAILED', 'SHEET_PARSE_FAILED', 'OPERATION_FAILED']
    ]
  ]) {
    for (const expectedStatus of ['loading', 'ready']) {
      const { service } = createHarness();
      service.updateBounds(host.hostToken, bounds);
      state.describe = async () => descriptorFor(relativePath, kind);
      await service.present(host.hostToken, fileRef(relativePath));
      const vue = acknowledgeCurrentVue(service);
      const revision = service.snapshot(host.hostToken).selectionRevision;
      if (expectedStatus === 'ready') {
        service.reportVueReady(host.hostToken, revision, vue.previewRuntimeToken);
      }

      for (const errorCode of rejectedErrorCodes) {
        const before = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
        const broadcastCount = state.broadcasts.length;
        const revokeCount = state.assetSelectionRevocations.length;
        assert.equal(before.status, expectedStatus);
        assert.throws(
          () =>
            service.reportVueError(host.hostToken, revision, vue.previewRuntimeToken, errorCode),
          (error) => error.code === 'INVALID_INPUT'
        );
        assert.deepEqual(service.snapshotForVue(host.hostToken, vue.previewRuntimeToken), before);
        assert.equal(state.broadcasts.length, broadcastCount);
        assert.equal(state.assetSelectionRevocations.length, revokeCount);
      }
      service.destroy();
    }
  }
});

test('unsupported descriptor errors accept only the exact Main-authored effective error', async () => {
  for (const [relativePath, kind, descriptorErrorCode, effectiveErrorCode] of [
    ['empty.png', 'image', 'IMAGE_EMPTY', 'IMAGE_EMPTY'],
    ['bad.png', 'image', 'SIGNATURE_MISMATCH', 'SIGNATURE_MISMATCH'],
    ['oversize.md', 'text', 'TEXT_TOO_LARGE', 'TEXT_TOO_LARGE'],
    ['codec.mp4', 'video', 'UNSUPPORTED_CODEC', 'OPERATION_FAILED']
  ]) {
    for (const expectedStatus of ['loading', 'ready']) {
      const { service } = createHarness();
      service.updateBounds(host.hostToken, bounds);
      state.describe = async () => ({
        ...descriptorFor(relativePath, kind),
        previewError: { code: descriptorErrorCode, message: 'classifier-terminal' }
      });
      await service.present(host.hostToken, fileRef(relativePath));
      const vue = acknowledgeCurrentVue(service);
      const revision = service.snapshot(host.hostToken).selectionRevision;
      if (expectedStatus === 'ready') {
        service.reportVueReady(host.hostToken, revision, vue.previewRuntimeToken);
      }

      const rejectedErrorCodes = [
        'IMAGE_DECODE_FAILED',
        'MEDIA_SOURCE_UNSUPPORTED',
        'DOCUMENT_PARSE_FAILED',
        'SHEET_PARSE_FAILED',
        'OPERATION_FAILED'
      ].filter((errorCode) => errorCode !== effectiveErrorCode);
      for (const errorCode of rejectedErrorCodes) {
        const before = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
        const broadcastCount = state.broadcasts.length;
        const revokeCount = state.assetSelectionRevocations.length;
        assert.equal(before.adapterId, 'unsupported');
        assert.equal(before.status, expectedStatus);
        assert.throws(
          () =>
            service.reportVueError(host.hostToken, revision, vue.previewRuntimeToken, errorCode),
          (error) => error.code === 'INVALID_INPUT'
        );
        assert.deepEqual(service.snapshotForVue(host.hostToken, vue.previewRuntimeToken), before);
        assert.equal(state.broadcasts.length, broadcastCount);
        assert.equal(state.assetSelectionRevocations.length, revokeCount);
      }

      service.reportVueError(host.hostToken, revision, vue.previewRuntimeToken, effectiveErrorCode);
      const unavailable = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
      assert.equal(unavailable.status, 'unavailable');
      assert.equal(unavailable.error.code, effectiveErrorCode);
      assert.equal(unavailable.descriptor.assetUrl, undefined);
      service.destroy();
    }
  }
});

test('image buffering revokes on ready while audio/video keep selection-lifetime Range authority', async () => {
  for (const [relativePath, kind, expectedLifetime] of [
    ['fixture.png', 'image', 'ttl'],
    ['fixture.mp3', 'audio', 'selection'],
    ['fixture.mp4', 'video', 'selection']
  ]) {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => descriptorFor(relativePath, kind);
    await service.present(host.hostToken, fileRef(relativePath));
    const vue = acknowledgeCurrentVue(service);
    const loading = service.snapshot(host.hostToken);
    const privateLoading = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);

    assert.equal(loading.adapterId, kind);
    assert.equal(loading.selectedTextAvailable, false);
    assert.equal('find' in loading, false);
    assert.equal(loading.descriptor.assetUrl, undefined);
    assert.match(privateLoading.descriptor.assetUrl, /^bitterless-preview:\/\/asset\//u);
    assert.deepEqual(state.assetIssues.at(-1).options, {
      selectionRevision: loading.selectionRevision,
      maxBytes: 3,
      lifetime: expectedLifetime
    });

    service.reportVueReady(host.hostToken, loading.selectionRevision, vue.previewRuntimeToken);
    const ready = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.selectedTextAvailable, false);
    assert.equal(
      typeof ready.descriptor.assetUrl === 'string',
      kind === 'audio' || kind === 'video'
    );
    assert.equal(
      state.assetSelectionRevocations.some(
        (entry) => entry.selectionRevision === loading.selectionRevision
      ),
      kind === 'image'
    );
    service.destroy();
  }
});

test('image/media errors remove dead capabilities, demote ready, and reject late ready resurrection', async () => {
  for (const [relativePath, kind, errorCode] of [
    ['fixture.png', 'image', 'IMAGE_DECODE_FAILED'],
    ['fixture.mp3', 'audio', 'MEDIA_NETWORK_FAILED'],
    ['fixture.mp4', 'video', 'MEDIA_SOURCE_UNSUPPORTED']
  ]) {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => descriptorFor(relativePath, kind);
    await service.present(host.hostToken, fileRef(relativePath));
    const vue = acknowledgeCurrentVue(service);
    const revision = service.snapshot(host.hostToken).selectionRevision;
    if (kind !== 'image') {
      service.reportVueReady(host.hostToken, revision, vue.previewRuntimeToken);
      assert.equal(service.snapshot(host.hostToken).status, 'ready');
    }

    service.reportVueError(host.hostToken, revision, vue.previewRuntimeToken, errorCode);
    let failed = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.error.code, errorCode);
    assert.equal(failed.descriptor.assetUrl, undefined);
    assert.equal(failed.selectedTextAvailable, false);
    assert.equal(
      state.assetSelectionRevocations.some((entry) => entry.selectionRevision === revision),
      true
    );

    service.reportVueReady(host.hostToken, revision, vue.previewRuntimeToken);
    failed = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.error.code, errorCode);
    assert.equal(failed.descriptor.assetUrl, undefined);
    service.destroy();
  }
});

test('XLSX stays on Vue, grants one bounded preload read, and rebuilds Vue on renderer failure', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = state.vueViews[0];
  state.describe = async () => descriptorFor('workbook.xlsx', 'sheet');
  await service.present(host.hostToken, fileRef('workbook.xlsx'));

  let snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.adapterId, 'ooxml-xlsx');
  assert.equal(snapshot.descriptor.assetUrl, undefined);
  assert.equal(
    service.snapshotForVue(host.hostToken, vue.previewRuntimeToken).descriptor.assetUrl,
    undefined
  );
  assert.equal(state.assetIssues.length, 0);
  assert.equal(state.officePrepares.at(-1).selectionRevision, snapshot.selectionRevision);
  assert.equal(state.officePrepares.at(-1).maxBytes, 25 * 1024 * 1024);

  acknowledgeCurrentVue(service);
  service.reportVueError(
    host.hostToken,
    snapshot.selectionRevision,
    vue.previewRuntimeToken,
    'SHEET_PARSE_FAILED'
  );
  assert.deepEqual(state.openTraceRecords[0].terminals, [
    { revision: 1, surface: 'office', outcome: 'error' }
  ]);
  snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.error.code, 'SHEET_PARSE_FAILED');
  assert.equal(snapshot.descriptor.assetUrl, undefined);
  assert.equal(vue.webContents.destroyed, true);
  assert.equal(state.vueViews.length, 2);
  assert.throws(
    () => service.snapshotForVue(host.hostToken, vue.previewRuntimeToken),
    (error) => error.code === 'HOST_ROLE_DENIED'
  );

  await service.present(host.hostToken, fileRef('workbook.xlsx'));
  snapshot = service.snapshot(host.hostToken);
  const replacementVue = acknowledgeCurrentVue(service);
  assert.throws(
    () =>
      service.reportVueReady(
        host.hostToken,
        snapshot.selectionRevision,
        replacementVue.previewRuntimeToken
      ),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.throws(
    () =>
      service.reportVueReady(
        host.hostToken,
        snapshot.selectionRevision,
        replacementVue.previewRuntimeToken,
        { kind: 'complete' },
        'monaco'
      ),
    (error) => error.code === 'INVALID_INPUT'
  );
  service.reportVueReady(
    host.hostToken,
    snapshot.selectionRevision,
    replacementVue.previewRuntimeToken,
    { kind: 'complete' },
    'office'
  );
  snapshot = service.snapshotForVue(host.hostToken, replacementVue.previewRuntimeToken);
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.descriptor.assetUrl, undefined);
  assert.ok(state.officeCancels.length >= 2);
});

test('Monaco readiness proves the exact registered content adapter before becoming find-ready', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vue = state.vueViews[0];
  state.describe = async () => descriptorFor('source.ts', 'text');
  await service.present(host.hostToken, fileRef('source.ts'));
  const snapshot = service.snapshot(host.hostToken);
  acknowledgeCurrentVue(service);

  assert.equal(snapshot.adapterId, 'monaco');
  assert.throws(
    () =>
      service.reportVueReady(host.hostToken, snapshot.selectionRevision, vue.previewRuntimeToken, {
        kind: 'complete'
      }),
    (error) => error.code === 'INVALID_INPUT'
  );
  assert.throws(
    () =>
      service.reportVueReady(
        host.hostToken,
        snapshot.selectionRevision,
        vue.previewRuntimeToken,
        { kind: 'complete' },
        'office'
      ),
    (error) => error.code === 'INVALID_INPUT'
  );
  service.reportVueReady(
    host.hostToken,
    snapshot.selectionRevision,
    vue.previewRuntimeToken,
    { kind: 'complete' },
    'monaco'
  );
  assert.equal(service.snapshot(host.hostToken).status, 'ready');
});

test('DOCX stays on Vue, grants one bounded preload read, and publishes ready only for its exact runtime', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    const vue = state.vueViews[0];
    state.describe = async () => descriptorFor('document.docx', 'document');
    await service.present(host.hostToken, fileRef('document.docx'));

    let snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.surface, 'vue');
    assert.equal(snapshot.adapterId, 'ooxml-docx');
    assert.equal(snapshot.selectedTextAvailable, true);
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(
      service.snapshotForVue(host.hostToken, vue.previewRuntimeToken).descriptor.assetUrl,
      undefined
    );
    assert.equal(state.assetIssues.length, 0);
    assert.equal(state.officePrepares.at(-1).selectionRevision, snapshot.selectionRevision);
    assert.equal(timers.filter((timer) => timer.delay === 30_000).length, 1);

    acknowledgeCurrentVue(service);
    service.reportVueReady(
      host.hostToken,
      snapshot.selectionRevision,
      vue.previewRuntimeToken,
      { kind: 'complete' },
      'office'
    );
    snapshot = service.snapshotForVue(host.hostToken, vue.previewRuntimeToken);
    assert.equal(snapshot.status, 'ready');
    assert.deepEqual(state.openTraceRecords[0].terminals, [
      { revision: 1, surface: 'office', outcome: 'ready' }
    ]);
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(timers[0].active, false);
    service.destroy();
  });
});

test('DOCX Main watchdog rebuilds an unresponsive Vue renderer without waiting for reset acknowledgement', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    const originalVue = state.vueViews[0];
    state.describe = async () => descriptorFor('document.docx', 'document');
    await service.present(host.hostToken, fileRef('document.docx'));

    const watchdog = timers.find((timer) => timer.delay === 30_000);
    assert.ok(watchdog);
    assert.equal(service.snapshot(host.hostToken).selectionRevision, 1);
    assert.equal(originalVue.webContents.destroyed, false);

    watchdog.callback(...watchdog.args);

    const snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.selectionRevision, 2);
    assert.equal(snapshot.adapterId, 'ooxml-docx');
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.error.code, 'DOCUMENT_RENDER_TIMEOUT');
    assert.equal(snapshot.descriptor.assetUrl, undefined);
    assert.equal(originalVue.webContents.destroyed, true);
    assert.equal(state.vueViews.length, 2);
    assert.notEqual(state.vueViews[1].previewRuntimeToken, originalVue.previewRuntimeToken);
    assert.deepEqual(state.openTraceRecords[0].terminals, [
      { revision: 1, surface: 'office', outcome: 'error' }
    ]);
    service.destroy();
  });
});

test('DOCX bounds and reset acknowledgement never renew the external rendering deadline', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => descriptorFor('document.docx', 'document');
    await service.present(host.hostToken, fileRef('document.docx'));
    const vue = state.vueViews[0];
    const revision = service.snapshot(host.hostToken).selectionRevision;

    service.updateBounds(host.hostToken, { ...bounds, width: 680 });
    service.updateBounds(host.hostToken, { ...bounds, height: 480 });
    service.reportVueReset(host.hostToken, revision, vue.previewRuntimeToken);
    service.reportVueReset(host.hostToken, revision, vue.previewRuntimeToken);

    assert.equal(timers.filter((timer) => timer.delay === 30_000).length, 1);
    assert.equal(timers[0].active, true);
    service.destroy();
    assert.equal(timers[0].active, false);
  });
});

test('leaving a loading DOCX rebuilds Vue for Markdown or empty without letting its stale timer kill the replacement', async () => {
  await withFakeTimeouts(async (timers) => {
    for (const target of ['markdown', 'empty']) {
      const { service } = createHarness();
      service.updateBounds(host.hostToken, bounds);
      state.describe = async () => descriptorFor('pending.docx', 'document');
      await service.present(host.hostToken, fileRef('pending.docx'));
      const originalVue = state.vueViews[0];
      const staleTimer = timers.at(-1);
      assert.equal(staleTimer.delay, 30_000);

      if (target === 'markdown') {
        state.describe = async () => descriptorFor('current.md', 'text');
        await service.present(host.hostToken, fileRef('current.md'));
      } else {
        service.clearWorkspace(host.hostToken, 'workspace-id');
      }

      const replacementVue = state.vueViews[1];
      assert.equal(originalVue.webContents.destroyed, true);
      assert.ok(replacementVue);
      assert.notEqual(replacementVue.previewRuntimeToken, originalVue.previewRuntimeToken);
      assert.equal(staleTimer.active, false);

      staleTimer.callback(...staleTimer.args);

      const snapshot = service.snapshot(host.hostToken);
      assert.equal(snapshot.selectionRevision, 2);
      assert.equal(snapshot.status, target === 'markdown' ? 'loading' : 'empty');
      assert.equal(replacementVue.webContents.destroyed, false);
      assert.equal(state.vueViews.length, 2);
      service.destroy();
    }
  });
});

test('DOCX engine and sanitizer failures rebuild only the Vue surface while empty output does not', async () => {
  for (const errorCode of ['DOCUMENT_PARSE_FAILED', 'DOCUMENT_SANITIZE_FAILED', 'DOCUMENT_EMPTY']) {
    await withFakeTimeouts(async () => {
      const { service } = createHarness();
      service.updateBounds(host.hostToken, bounds);
      state.describe = async () => descriptorFor('document.docx', 'document');
      await service.present(host.hostToken, fileRef('document.docx'));
      const vue = acknowledgeCurrentVue(service);
      const revision = service.snapshot(host.hostToken).selectionRevision;

      service.reportVueError(host.hostToken, revision, vue.previewRuntimeToken, errorCode);

      const snapshot = service.snapshot(host.hostToken);
      assert.equal(snapshot.status, 'unavailable');
      assert.equal(snapshot.error.code, errorCode);
      assert.equal(snapshot.descriptor.assetUrl, undefined);
      const requiresRebuild = errorCode !== 'DOCUMENT_EMPTY';
      assert.equal(vue.webContents.destroyed, requiresRebuild);
      assert.equal(state.vueViews.length, requiresRebuild ? 2 : 1);
      assert.equal(snapshot.selectionRevision, requiresRebuild ? revision + 1 : revision);
      service.destroy();
    });
  }
});

test('a stale Office prepare is cancelled and cannot replace the newer Markdown selection', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const prepare = { started: deferred(), completion: deferred() };
  state.nextOfficePrepareDeferred = prepare;
  const stalePresentation = service.present(host.hostToken, fileRef('stale.xlsx'));
  const staleGrant = await prepare.started.promise;

  state.describe = async () => descriptorFor('current.md', 'text');
  await service.present(host.hostToken, fileRef('current.md'));
  prepare.completion.resolve();
  await stalePresentation;

  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'current.md');
  assert.equal(
    state.officeCancels.some((request) => request.grantId === staleGrant.grantId),
    true
  );
});

test('canonical presentation validation accepts the sheet and ooxml-xlsx contract', () => {
  const descriptor = descriptorFor('workbook.xlsx', 'sheet');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-xlsx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'workbook.xlsx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: false
    }),
    true
  );
});

test('canonical presentation validation accepts the document and ooxml-docx contract', () => {
  const descriptor = descriptorFor('document.docx', 'document');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-docx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'document.docx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: true
    }),
    true
  );
});

test('canonical presentation validation accepts the presentation and ooxml-pptx contract', () => {
  const descriptor = descriptorFor('slides.pptx', 'presentation');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-pptx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'slides.pptx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: true
    }),
    true
  );
});

test('canonical presentation validation scopes recognized unsupported categories to unsupported descriptors', () => {
  const descriptor = {
    ...descriptorFor('fixture.heic', 'unsupported'),
    workspaceId: 'workspace-id-1234',
    unsupportedCategory: 'image-format'
  };
  const presentation = {
    hostId: 'host-id',
    workspaceId: 'workspace-id-1234',
    selectionRevision: 1,
    surface: 'vue',
    adapterId: 'unsupported',
    status: 'loading',
    fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'fixture.heic' },
    descriptor,
    error: null,
    selectedTextAvailable: false
  };
  assert.equal(presentationModule.isOnlyPreviewPresentation(presentation), true);
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      ...presentation,
      descriptor: { ...descriptor, unsupportedCategory: 'invented-category' }
    }),
    false
  );
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      ...presentation,
      descriptor: { ...descriptor, kind: 'image' }
    }),
    false
  );
  for (const forbidden of ['displayPath', 'absolutePath', 'canonicalPath']) {
    assert.equal(
      presentationModule.isOnlyPreviewPresentation({
        ...presentation,
        descriptor: { ...descriptor, [forbidden]: '/Users/ral/private/fixture.heic' }
      }),
      false,
      forbidden
    );
  }
});
