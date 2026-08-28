import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  buildRoot,
  createRendererStoreHarness,
  officeDescriptor,
  officePresentation,
  renderPreviewSurface
} from './onlyPreviewRenderingTest.helper.mjs';

test('DOCX renders through the shared Office component instead of unsupported metadata', async () => {
  const descriptor = officeDescriptor('.docx', 'document');
  const html = await renderPreviewSurface({
    errorMessage: '',
    presentationError: '',
    errorCode: null,
    descriptor,
    descriptorType: 'DOCX',
    textContent: null,
    officeSession: {},
    showsUnsupportedMetadata: false,
    loading: true,
    settings: {},
    selectionReportingRevision: '1'
  });

  assert.match(html, /name="onlypreview__officePreview"/);
  assert.doesNotMatch(html, /name="onlypreview__unsupportedPreview"/);
});

test('DOCX creates one revision-bound OOXML session and waits for Office readiness', async () => {
  const descriptor = {
    ...officeDescriptor('.docx', 'document'),
    assetUrl: `bitterless-preview://asset/${'d'.repeat(64)}/71-document`
  };
  const presentation = {
    ...officePresentation(descriptor, 71, 'ooxml-docx'),
    selectedTextAvailable: true
  };
  const harness = createRendererStoreHarness(presentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office=docx`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();

  assert.equal(store.descriptor?.kind, 'document');
  assert.equal(store.showsUnsupportedMetadata, false);
  assert.equal(store.loading, true);
  assert.equal(harness.officeSessions.length, 1);
  assert.deepEqual(
    {
      hostId: harness.officeSessions[0].options.hostId,
      selectionRevision: harness.officeSessions[0].options.selectionRevision,
      kind: harness.officeSessions[0].options.kind,
      assetUrl: harness.officeSessions[0].options.assetUrl,
      expectedSize: harness.officeSessions[0].options.expectedSize
    },
    {
      hostId: 'host-for-tests',
      selectionRevision: 71,
      kind: 'docx',
      assetUrl: descriptor.assetUrl,
      expectedSize: 4096
    }
  );
  assert.equal(harness.readText.length, 0);
  assert.equal(harness.ready.length, 0);
  assert.equal(harness.errors.length, 0);

  assert.match(await renderPreviewSurface(store), /name="onlypreview__officePreview"/);
  store.reportOfficeReady('71');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.loading, false);
  assert.deepEqual(harness.ready.map(({ request }) => request), [
    {
      hostToken: 'host-token-for-tests',
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      selectionRevision: 71,
      findCoverage: { kind: 'complete' },
      findAdapter: 'office'
    }
  ]);
  store.dispose();
  assert.equal(harness.officeDisposals, 1);
});

test('image Store truth stays loading through decode until the connected component reports ready', async () => {
  const descriptor = {
    ...officeDescriptor('.png', 'image'),
    mimeType: 'image/png',
    assetUrl: `bitterless-preview://asset/${'f'.repeat(64)}/101-image`
  };
  const presentation = officePresentation(descriptor, 101, 'image');
  const harness = createRendererStoreHarness(presentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?image=truth`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  assert.equal(store.loading, true);
  assert.equal(store.loadedRevision, -1);
  assert.equal(harness.ready.length, 0);
  assert.deepEqual(harness.imageLoads, [
    { assetUrl: descriptor.assetUrl, expectedSize: 4096, mimeType: 'image/png' }
  ]);
  assert.match(await renderPreviewSurface(store), /name="onlypreview__imagePreview"/);

  store.reportSurfaceReady('101');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.loading, false);
  assert.deepEqual(
    harness.ready.map(({ request }) => request.selectionRevision),
    [101]
  );

  const bufferedDescriptor = { ...descriptor };
  delete bufferedDescriptor.assetUrl;
  harness.presentation = { ...presentation, status: 'ready', descriptor: bufferedDescriptor };
  harness.subscriptions.get('onlypreview/previewPresentation')({
    params: { hostId: 'host-for-tests' }
  });
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.descriptor.assetUrl, undefined);
  assert.match(await renderPreviewSurface(store), /name="onlypreview__imagePreview"/);
  store.dispose();
  assert.equal(harness.imageDisposals, 1);
});

test('media Store truth waits for metadata, demotes ready on error, and ignores old revision events', async () => {
  const firstDescriptor = {
    ...officeDescriptor('.mp3', 'audio'),
    mimeType: 'audio/mpeg',
    assetUrl: `bitterless-preview://asset/${'a'.repeat(64)}/111-audio`
  };
  const firstPresentation = officePresentation(firstDescriptor, 111, 'audio');
  const harness = createRendererStoreHarness(firstPresentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?media=truth`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  assert.equal(store.loading, true);
  assert.equal(store.mediaPrepared, true);
  assert.equal(harness.ready.length, 0);
  assert.deepEqual(harness.mediaPrepares, [
    { assetUrl: firstDescriptor.assetUrl, expectedSize: 4096 }
  ]);
  assert.match(await renderPreviewSurface(store), /name="onlypreview__mediaPreview"/);

  const secondDescriptor = {
    ...officeDescriptor('.mp4', 'video'),
    mimeType: 'video/mp4',
    relativePath: 'fixtures/current.mp4',
    name: 'current.mp4',
    assetUrl: `bitterless-preview://asset/${'b'.repeat(64)}/112-video`
  };
  harness.presentation = officePresentation(secondDescriptor, 112, 'video');
  harness.subscriptions.get('onlypreview/previewPresentation')({
    params: { hostId: 'host-for-tests' }
  });
  for (let attempt = 0; attempt < 20 && harness.mediaSessions.length < 2; attempt += 1) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.equal(harness.mediaSessions.length, 2);
  assert.equal(harness.mediaDisposals, 1);
  store.reportSurfaceReady('111');
  store.reportSurfaceError('111', 'MEDIA_NETWORK_FAILED');
  assert.equal(store.loading, true);
  assert.equal(store.errorCode, null);
  assert.equal(harness.ready.length, 0);
  assert.equal(harness.errors.length, 0);

  store.reportSurfaceReady('112');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.loading, false);
  assert.equal(harness.ready.length, 1);
  store.reportSurfaceError('112', 'MEDIA_NETWORK_FAILED');
  assert.equal(store.loading, false);
  assert.equal(store.errorCode, 'MEDIA_NETWORK_FAILED');
  assert.equal(store.mediaPrepared, false);
  assert.equal(store.mediaSession, null);
  assert.equal(harness.mediaDisposals, 2);
  assert.deepEqual(harness.errors, [
    {
      hostToken: 'host-token-for-tests',
      selectionRevision: 112,
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      errorCode: 'MEDIA_NETWORK_FAILED'
    }
  ]);
  store.reportSurfaceReady('112');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(harness.ready.length, 1);
});

test('all Office formats create the matching lazy OOXML session and report complete Find', async () => {
  const formats = [
    ['.xlsx', 'sheet', 'ooxml-xlsx', 'xlsx'],
    ['.xlsm', 'sheet', 'ooxml-xlsx', 'xlsx'],
    ['.docx', 'document', 'ooxml-docx', 'docx'],
    ['.pptx', 'presentation', 'ooxml-pptx', 'pptx']
  ];
  for (const [index, [extension, descriptorKind, adapterId, sessionKind]] of formats.entries()) {
    const descriptor = {
      ...officeDescriptor(extension, descriptorKind),
      assetUrl: `bitterless-preview://asset/${'a'.repeat(64)}/${index + 1}-office`
    };
    const presentation = officePresentation(descriptor, index + 10, adapterId);
    const harness = createRendererStoreHarness(presentation);
    globalThis.__onlyPreviewRendererStoreHarness = harness;
    const previewStoreRuntime = await import(
      `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office-format=${extension.slice(1)}`
    );
    const store = previewStoreRuntime.onlyPreviewPreviewStore;

    await store.initialize();

    assert.equal(store.descriptor?.kind, descriptorKind, extension);
    assert.equal(store.showsUnsupportedMetadata, false, extension);
    assert.equal(store.loading, true, extension);
    assert.equal(harness.officeSessions.length, 1, extension);
    assert.equal(harness.officeSessions[0].options.hostId, 'host-for-tests');
    assert.equal(harness.officeSessions[0].options.selectionRevision, presentation.selectionRevision);
    assert.equal(harness.officeSessions[0].options.kind, sessionKind);
    assert.equal(harness.officeSessions[0].options.assetUrl, descriptor.assetUrl);
    assert.equal(harness.officeSessions[0].options.expectedSize, 4096);
    assert.equal(harness.ready.length, 0, extension);
    assert.equal(harness.errors.length, 0, extension);

    const html = await renderPreviewSurface(store);
    assert.match(html, /name="onlypreview__officePreview"/, extension);
    store.reportOfficeReady(String(presentation.selectionRevision));
    await new Promise((resolveWait) => setImmediate(resolveWait));
    assert.equal(store.loading, false, extension);
    assert.equal(harness.ready[0].request.selectionRevision, presentation.selectionRevision);
    assert.deepEqual(harness.ready[0].request.findCoverage, { kind: 'complete' });
    assert.equal(harness.ready[0].request.findAdapter, 'office');
    store.dispose();
    assert.equal(harness.officeDisposals, 1, extension);
  }
});

test('a current Office runtime failure clears ready truth and reports one typed failure', async () => {
  const descriptor = {
    ...officeDescriptor('.pptx', 'presentation'),
    assetUrl: `bitterless-preview://asset/${'c'.repeat(64)}/81-presentation`
  };
  const presentation = officePresentation(descriptor, 81, 'ooxml-pptx');
  const harness = createRendererStoreHarness(presentation);
  harness.reportErrorPromise = new Promise(() => {});
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office-runtime-terminal`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  store.reportOfficeReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.loadedRevision, presentation.selectionRevision);
  assert.equal(harness.ready.length, 1);

  harness.officeSessions[0].options.onRuntimeError('PRESENTATION_RENDER_TIMEOUT');

  assert.equal(store.officeSession, null);
  assert.equal(store.loading, false);
  assert.equal(store.loadedRevision, -1);
  assert.equal(store.errorCode, 'PRESENTATION_RENDER_TIMEOUT');
  assert.notEqual(store.errorMessage, '');
  assert.deepEqual(harness.errors, [
    {
      hostToken: 'host-token-for-tests',
      selectionRevision: presentation.selectionRevision,
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      errorCode: 'PRESENTATION_RENDER_TIMEOUT'
    }
  ]);

  store.reportOfficeReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.ready.length, 1, 'terminal local truth refuses stale ready');
});

test('an old Office session failure after selection change is silent', async () => {
  const firstDescriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    assetUrl: `bitterless-preview://asset/${'d'.repeat(64)}/91-workbook`
  };
  const firstPresentation = officePresentation(firstDescriptor, 91, 'ooxml-xlsx');
  const harness = createRendererStoreHarness(firstPresentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office-stale-terminal`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  const oldSession = harness.officeSessions[0];
  const nextDescriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    relativePath: 'fixtures/next.xlsx',
    name: 'next.xlsx',
    assetUrl: `bitterless-preview://asset/${'e'.repeat(64)}/92-workbook`
  };
  harness.presentation = officePresentation(nextDescriptor, 92, 'ooxml-xlsx');
  harness.subscriptions.get('onlypreview/previewPresentation')({
    params: { hostId: 'host-for-tests' }
  });
  for (let attempt = 0; attempt < 20 && harness.officeSessions.length < 2; attempt += 1) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.equal(harness.officeSessions.length, 2);
  const currentSession = harness.officeSessions[1];
  assert.equal(store.officeSession, currentSession);

  oldSession.options.onRuntimeError('SHEET_PARSE_FAILED');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.officeSession, currentSession);
  assert.equal(store.errorCode, null);
  assert.equal(harness.errors.length, 0);
});

test('Office surface errors install local truth and dispose before Main reporting settles', async () => {
  const descriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    assetUrl: `bitterless-preview://asset/${'b'.repeat(64)}/77-workbook`
  };
  const presentation = officePresentation(descriptor, 77, 'ooxml-xlsx');
  const harness = createRendererStoreHarness(presentation);
  harness.reportErrorPromise = new Promise(() => {});
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office-surface-error`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  assert.equal(store.loading, true);
  assert.equal(store.officeSession, harness.officeSessions[0]);

  store.reportSurfaceError(String(presentation.selectionRevision), 'SHEET_PARSE_FAILED');

  assert.equal(store.loading, false);
  assert.equal(store.errorCode, 'SHEET_PARSE_FAILED');
  assert.notEqual(store.errorMessage, '');
  assert.equal(store.officeSession, null);
  assert.equal(harness.officeDisposals, 1);
  assert.deepEqual(harness.errors, [
    {
      hostToken: 'host-token-for-tests',
      selectionRevision: presentation.selectionRevision,
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      errorCode: 'SHEET_PARSE_FAILED'
    }
  ]);

  store.reportOfficeReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(harness.ready.length, 0, 'stale ready must not clear a terminal local Office error');
});
