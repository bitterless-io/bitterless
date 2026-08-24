import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as docxPreview from 'docx-preview';
import {
  createDocumentFixture,
  createSession,
  documentPreviewSource,
  fetchFixture,
  importDocumentPreviewRuntime,
  installDomGlobals,
  projectRoot,
  readyWorker
} from './onlyPreviewDocumentTest.helper.mjs';

test('real docx-preview 0.4.0 renders a rich DOCX into sanitized paginated detached output', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = await createDocumentFixture();
    const worker = readyWorker();
    const revoked = [];
    let options;
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: () => worker,
      moduleLoader: async () => ({
        renderAsync: async (data, body, style, renderOptions) => {
          options = renderOptions;
          return await docxPreview.renderAsync(data, body, style, renderOptions);
        }
      }),
      revokeObjectUrl: (url) => revoked.push(url)
    });

    const result = await session.load(
      'https://onlypreview.invalid/document.docx',
      bytes.byteLength,
      environment.dom.window.document
    );
    const host = environment.dom.window.document.createElement('div');
    host.append(result.fragment);

    assert.match(host.textContent, /Fixture Heading/);
    assert.match(host.textContent, /Fixture list item/);
    assert.match(host.textContent, /Fixture Key/);
    assert.match(host.textContent, /Fixture Value/);
    assert.match(host.textContent, /Fixture Header/);
    assert.match(host.textContent, /Fixture Footer/);
    assert.match(host.textContent, /Fixture Second Page/);
    assert.match(host.textContent, /Fixture Link/);
    assert.match(host.textContent, /Fixture Bookmark/);
    assert.match(host.textContent, /Fixture Bookmark Link/);
    assert.ok(host.querySelectorAll('section.onlypreview-docx').length >= 2);
    assert.ok(host.querySelector('table'));
    assert.ok(host.querySelector('header'));
    assert.ok(host.querySelector('footer'));
    assert.ok(host.querySelector('img[src^="blob:"]'));
    assert.equal(host.querySelector('a'), null);
    assert.equal(host.querySelector('[href]'), null);
    assert.equal(host.querySelector('[id]'), null);
    assert.doesNotMatch(result.cssText, /@media|@import/i);
    assert.match(
      readFileSync(
        join(
          projectRoot,
          'src/renderer/onlypreview/preview/src/components/DocumentPreview/DocumentPreview.less'
        ),
        'utf8'
      ),
      /-apple-system/
    );
    assert.deepEqual(options, {
      className: 'onlypreview-docx',
      ignoreFonts: true,
      renderHeaders: true,
      renderFooters: true,
      renderChanges: false,
      renderComments: false,
      renderAltChunks: false,
      useBase64URL: false,
      experimental: false,
      debug: false
    });
    assert.equal(worker.messages.length, 1);
    assert.strictEqual(worker.messages[0].transfer[0], worker.messages[0].message.bytes);
    assert.equal(worker.terminated, true);
    assert.ok(result.blobUrls.size >= 1);
    assert.deepEqual([...result.blobUrls].sort(), environment.createdBlobUrls.sort());
    assert.deepEqual(revoked, []);

    session.dispose();
    assert.deepEqual(revoked.sort(), environment.createdBlobUrls.sort());
  } finally {
    environment.restore();
  }
});

test('DocumentPreview emits ready only after connected DOM mount and nextTick', async () => {
  const emitsDeclaration = documentPreviewSource.match(/defineEmits<\{([\s\S]*?)\}>\(\)/)?.[1];
  assert.ok(emitsDeclaration);
  assert.match(emitsDeclaration, /\bready\s*:\s*\[\]/);
  assert.doesNotMatch(emitsDeclaration, /\berror\s*:/);
  assert.equal((documentPreviewSource.match(/emit\(\s*['"]error['"]/g) ?? []).length, 0);
  assert.equal(
    (documentPreviewSource.match(/onlyPreviewPreviewStore\.reportSurfaceError\(/g) ?? []).length,
    2
  );
  assert.equal((documentPreviewSource.match(/'DOCUMENT_SANITIZE_FAILED'/g) ?? []).length, 2);

  const environment = installDomGlobals();
  try {
    globalThis.__onlyPreviewDocumentComponentHarness = {
      arms: [],
      characterCounts: [],
      surfaceErrors: []
    };
    const runtime = await importDocumentPreviewRuntime('connected');
    const fragment = environment.dom.window.document.createDocumentFragment();
    const page = environment.dom.window.document.createElement('section');
    page.className = 'onlypreview-docx';
    page.textContent = 'Mounted document body';
    fragment.append(page);
    const root = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(root);
    const events = [];
    const app = runtime.createApp(runtime.default, {
      content: {
        fragment,
        cssText: '.onlypreview-docx { color: black; }',
        blobUrls: new Set()
      },
      reportingRevision: '91',
      onReady: () => events.push('ready')
    });

    app.mount(root);
    assert.deepEqual(events, []);
    await runtime.nextTick();
    await runtime.nextTick();

    assert.deepEqual(events, ['ready']);
    assert.equal(root.querySelector('[name="onlypreview__documentBody"]')?.isConnected, true);
    assert.equal(
      root.querySelector('[name="onlypreview__documentBody"]')?.textContent,
      'Mounted document body'
    );
    assert.deepEqual(globalThis.__onlyPreviewDocumentComponentHarness.arms, [['91']]);
    app.unmount();
    assert.deepEqual(globalThis.__onlyPreviewDocumentComponentHarness.characterCounts.at(-1), [
      0,
      '91'
    ]);

    const emptyRoot = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(emptyRoot);
    const emptyEvents = [];
    const emptyApp = runtime.createApp(runtime.default, {
      content: {
        fragment: environment.dom.window.document.createDocumentFragment(),
        cssText: '.onlypreview-docx { color: red; }',
        blobUrls: new Set()
      },
      reportingRevision: '92',
      onReady: () => emptyEvents.push('ready')
    });
    emptyApp.mount(emptyRoot);
    await runtime.nextTick();
    await runtime.nextTick();

    assert.deepEqual(emptyEvents, []);
    assert.deepEqual(globalThis.__onlyPreviewDocumentComponentHarness.surfaceErrors, [
      ['92', 'DOCUMENT_SANITIZE_FAILED']
    ]);
    assert.equal(
      emptyRoot.querySelector('[name="onlypreview__documentBody"]')?.childNodes.length,
      0
    );
    assert.equal(emptyRoot.querySelector('style'), null);
    emptyApp.unmount();
  } finally {
    delete globalThis.__onlyPreviewDocumentComponentHarness;
    environment.restore();
  }
});
