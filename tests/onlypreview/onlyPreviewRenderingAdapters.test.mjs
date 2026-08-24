import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  buildRoot,
  createRendererStoreHarness,
  officeDescriptor,
  officePresentation,
  renderPreviewSurface
} from './onlyPreviewRenderingTest.helper.mjs';

test('DOCX renders through the document component instead of unsupported metadata', async () => {
  const descriptor = officeDescriptor('.docx', 'document');
  const html = await renderPreviewSurface({
    errorMessage: '',
    presentationError: '',
    errorCode: null,
    descriptor,
    descriptorType: 'DOCX',
    textContent: null,
    documentSession: {},
    documentContent: {},
    showsUnsupportedMetadata: false,
    loading: true,
    settings: {},
    selectionReportingRevision: '1'
  });

  assert.match(html, /name="onlypreview__documentPreview"/);
  assert.doesNotMatch(html, /name="onlypreview__unsupportedPreview"/);
});

test('DOCX loads its private asset and waits for mounted document readiness', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const originalDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const descriptor = {
      ...officeDescriptor('.docx', 'document'),
      assetUrl: `bitterless-preview://asset/${'d'.repeat(64)}/71-document`
    };
    const presentation = {
      ...officePresentation(descriptor, 71, 'docx-dom'),
      selectedTextAvailable: true
    };
    const harness = createRendererStoreHarness(presentation);
    harness.documentContent = {
      fragment: dom.window.document.createDocumentFragment(),
      cssText: '.onlypreview-docx { color: black; }',
      blobUrls: new Set()
    };
    globalThis.__onlyPreviewRendererStoreHarness = harness;
    const previewStoreRuntime = await import(
      `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?document=docx`
    );
    const store = previewStoreRuntime.onlyPreviewPreviewStore;

    await store.initialize();

    assert.equal(store.descriptor?.kind, 'document');
    assert.equal(store.showsUnsupportedMetadata, false);
    assert.equal(store.loading, true);
    assert.equal(harness.documentSessions.length, 1);
    assert.equal(harness.documentSessions[0].options.hostId, 'host-for-tests');
    assert.equal(harness.documentSessions[0].options.selectionRevision, 71);
    assert.deepEqual(harness.documentLoads[0], {
      assetUrl: descriptor.assetUrl,
      expectedSize: 4096,
      ownerDocument: dom.window.document
    });
    assert.equal(harness.readText.length, 0);
    assert.equal(harness.ready.length, 0);
    assert.equal(harness.errors.length, 0);

    const html = await renderPreviewSurface(store);
    assert.match(html, /name="onlypreview__documentPreview"/);
    store.reportDocumentReady('71');
    await new Promise((resolveWait) => setImmediate(resolveWait));
    assert.equal(store.loading, false);
    assert.deepEqual(
      harness.ready.map(({ request }) => request.selectionRevision),
      [71]
    );
    store.dispose();
    assert.equal(harness.documentDisposals, 1);
  } finally {
    globalThis.document = originalDocument;
  }
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

test('XLSX and XLSM load the private asset into the sheet session and wait for grid readiness', async () => {
  for (const [index, extension] of ['.xlsx', '.xlsm'].entries()) {
    const descriptor = {
      ...officeDescriptor(extension, 'sheet'),
      assetUrl: `bitterless-preview://asset/${'a'.repeat(64)}/${index + 1}-workbook`
    };
    const presentation = officePresentation(descriptor, index + 10, 'xlsx-grid');
    const harness = createRendererStoreHarness(presentation);
    globalThis.__onlyPreviewRendererStoreHarness = harness;
    const previewStoreRuntime = await import(
      `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?sheet=${extension.slice(1)}`
    );
    const store = previewStoreRuntime.onlyPreviewPreviewStore;

    await store.initialize();

    assert.equal(store.descriptor?.kind, 'sheet', extension);
    assert.equal(store.showsUnsupportedMetadata, false, extension);
    assert.equal(store.loading, true, extension);
    assert.equal(store.sheetManifest.acceptedCells, 1, extension);
    assert.deepEqual(harness.sheetLoads, [{ assetUrl: descriptor.assetUrl, expectedSize: 4096 }]);
    assert.equal(harness.sheetSessions[0].options.hostId, 'host-for-tests');
    assert.equal(
      harness.sheetSessions[0].options.selectionRevision,
      presentation.selectionRevision
    );
    assert.equal('runtimeId' in harness.sheetSessions[0].options, false);
    assert.equal(harness.ready.length, 0, extension);
    assert.equal(harness.errors.length, 0, extension);

    const html = await renderPreviewSurface(store);
    assert.match(html, /name="onlypreview__sheetPreview"/, extension);
    store.reportSheetReady(String(presentation.selectionRevision));
    await new Promise((resolveWait) => setImmediate(resolveWait));
    assert.equal(store.loading, false, extension);
    assert.deepEqual(
      harness.ready.map(({ request }) => request.selectionRevision),
      [presentation.selectionRevision],
      extension
    );
    store.dispose();
    assert.equal(harness.sheetDisposals, 1, extension);
    harness.sheetSessions[0].emitUnexpectedTerminal('SHEET_PARSE_FAILED');
    await new Promise((resolveWait) => setImmediate(resolveWait));
    assert.equal(harness.errors.length, 0, 'normal dispose must keep terminal observation silent');
  }
});

test('an unexpected current sheet terminal clears ready truth and reports one typed failure', async () => {
  const descriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    assetUrl: `bitterless-preview://asset/${'c'.repeat(64)}/81-workbook`
  };
  const presentation = officePresentation(descriptor, 81, 'xlsx-grid');
  const harness = createRendererStoreHarness(presentation);
  harness.reportErrorPromise = new Promise(() => {});
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?sheet-unexpected-terminal`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  store.reportSheetReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.loadedRevision, presentation.selectionRevision);
  assert.equal(harness.ready.length, 1);

  harness.sheetSessions[0].emitUnexpectedTerminal('SHEET_RENDER_TIMEOUT');

  assert.equal(store.sheetSession, null);
  assert.equal(store.sheetManifest, null);
  assert.equal(store.loading, false);
  assert.equal(store.loadedRevision, -1);
  assert.equal(store.errorCode, 'SHEET_RENDER_TIMEOUT');
  assert.notEqual(store.errorMessage, '');
  assert.deepEqual(harness.errors, [
    {
      hostToken: 'host-token-for-tests',
      selectionRevision: presentation.selectionRevision,
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      errorCode: 'SHEET_RENDER_TIMEOUT'
    }
  ]);

  harness.sheetSessions[0].emitUnexpectedTerminal('SHEET_PARSE_FAILED');
  store.reportSheetReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(harness.errors.length, 1, 'terminal observation and reporting are one-shot');
  assert.equal(harness.ready.length, 1, 'terminal local truth refuses stale ready');
});

test('an old sheet session terminal after selection change is silent', async () => {
  const firstDescriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    assetUrl: `bitterless-preview://asset/${'d'.repeat(64)}/91-workbook`
  };
  const firstPresentation = officePresentation(firstDescriptor, 91, 'xlsx-grid');
  const harness = createRendererStoreHarness(firstPresentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?sheet-stale-terminal`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  const oldSession = harness.sheetSessions[0];
  const nextDescriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    relativePath: 'fixtures/next.xlsx',
    name: 'next.xlsx',
    assetUrl: `bitterless-preview://asset/${'e'.repeat(64)}/92-workbook`
  };
  harness.presentation = officePresentation(nextDescriptor, 92, 'xlsx-grid');
  harness.subscriptions.get('onlypreview/previewPresentation')({
    params: { hostId: 'host-for-tests' }
  });
  for (let attempt = 0; attempt < 20 && harness.sheetSessions.length < 2; attempt += 1) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.equal(harness.sheetSessions.length, 2);
  const currentSession = harness.sheetSessions[1];
  assert.equal(store.sheetSession, currentSession);

  oldSession.emitUnexpectedTerminal('SHEET_PARSE_FAILED');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(store.sheetSession, currentSession);
  assert.equal(store.sheetManifest.acceptedCells, 1);
  assert.equal(store.errorCode, null);
  assert.equal(harness.errors.length, 0);
});

test('sheet surface errors install local truth and dispose before Main reporting settles', async () => {
  const descriptor = {
    ...officeDescriptor('.xlsx', 'sheet'),
    assetUrl: `bitterless-preview://asset/${'b'.repeat(64)}/77-workbook`
  };
  const presentation = officePresentation(descriptor, 77, 'xlsx-grid');
  const harness = createRendererStoreHarness(presentation);
  harness.reportErrorPromise = new Promise(() => {});
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const previewStoreRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?sheet-surface-error`
  );
  const store = previewStoreRuntime.onlyPreviewPreviewStore;

  await store.initialize();
  assert.equal(store.loading, true);
  assert.equal(store.sheetManifest.acceptedCells, 1);

  store.reportSurfaceError(String(presentation.selectionRevision), 'SHEET_PARSE_FAILED');

  assert.equal(store.loading, false);
  assert.equal(store.errorCode, 'SHEET_PARSE_FAILED');
  assert.notEqual(store.errorMessage, '');
  assert.equal(store.sheetSession, null);
  assert.equal(store.sheetManifest, null);
  assert.equal(harness.sheetDisposals, 1);
  assert.deepEqual(harness.errors, [
    {
      hostToken: 'host-token-for-tests',
      selectionRevision: presentation.selectionRevision,
      previewRuntimeToken: 'preview-runtime-token-for-tests',
      errorCode: 'SHEET_PARSE_FAILED'
    }
  ]);

  store.reportSheetReady(String(presentation.selectionRevision));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(harness.ready.length, 0, 'stale ready must not clear a terminal local sheet error');
});
