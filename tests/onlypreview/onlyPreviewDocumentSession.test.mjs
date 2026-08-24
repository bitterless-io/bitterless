import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as docxPreview from 'docx-preview';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import {
  FakeWorker,
  assertDocumentError,
  createDocumentFixture,
  createSession,
  fetchFixture,
  installDomGlobals,
  readyWorker,
  responseFor,
  runDocumentWorker
} from './onlyPreviewDocumentTest.helper.mjs';

test('preflight failure happens before engine import and transfers the exact ArrayBuffer once', async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
  const worker = new FakeWorker();
  let moduleLoads = 0;
  worker.onPost = (request, currentWorker) => {
    queueMicrotask(() => {
      currentWorker.emit(
        'message',
        responseFor(request, { type: 'error', errorCode: 'OOXML_ARCHIVE_INVALID' })
      );
    });
  };
  const session = createSession({
    fetchImpl: fetchFixture(bytes),
    workerFactory: () => worker,
    moduleLoader: async () => {
      moduleLoads += 1;
      return docxPreview;
    }
  });

  await assertDocumentError(
    session.load(
      'https://onlypreview.invalid/invalid.docx',
      bytes.byteLength,
      new JSDOM().window.document
    ),
    'OOXML_ARCHIVE_INVALID'
  );
  assert.equal(moduleLoads, 0);
  assert.equal(worker.messages.length, 1);
  assert.strictEqual(worker.messages[0].transfer[0], worker.messages[0].message.bytes);
  assert.equal(worker.terminated, true);
});

test('one-shot preflight Worker is hard-terminated after the exact 10-second outer deadline', async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
  const worker = new FakeWorker();
  let observedDelay = null;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    observedDelay = delay;
    queueMicrotask(() => callback(...args));
    return { delay };
  };
  globalThis.clearTimeout = () => undefined;
  try {
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: () => worker,
      moduleLoader: async () => docxPreview
    });
    await assertDocumentError(
      session.load(
        'https://onlypreview.invalid/timeout.docx',
        bytes.byteLength,
        new JSDOM().window.document
      ),
      'DOCUMENT_RENDER_TIMEOUT'
    );
    assert.equal(observedDelay, 10_000);
    assert.equal(worker.terminated, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('disposing an awaiting preflight settles only the stale revision immediately', async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
  const staleWorker = new FakeWorker();
  const currentWorker = readyWorker();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (_callback, delay) => ({ delay });
  globalThis.clearTimeout = () => undefined;
  try {
    const staleSession = createSession({
      selectionRevision: 8,
      fetchImpl: fetchFixture(bytes),
      workerFactory: () => staleWorker,
      moduleLoader: async () => docxPreview
    });
    const staleLoad = staleSession.load(
      'https://onlypreview.invalid/stale-preflight.docx',
      bytes.byteLength,
      new JSDOM().window.document
    );
    while (staleWorker.messages.length === 0) await Promise.resolve();
    staleSession.dispose();

    const staleOutcome = await Promise.race([
      staleLoad.then(
        () => ({ code: 'unexpected-ready' }),
        (error) => ({ code: error.code })
      ),
      new Promise((resolveOutcome) => setImmediate(() => resolveOutcome({ code: 'still-pending' })))
    ]);
    assert.deepEqual(staleOutcome, { code: 'DOCUMENT_RENDER_TIMEOUT' });
    assert.equal(staleWorker.terminated, true);

    const currentSession = createSession({
      selectionRevision: 9,
      fetchImpl: fetchFixture(bytes),
      workerFactory: () => currentWorker,
      moduleLoader: async () => ({
        renderAsync: async (_data, body) => {
          body.innerHTML = '<section class="onlypreview-docx"><p>Current revision</p></section>';
        }
      })
    });
    const current = await currentSession.load(
      'https://onlypreview.invalid/current-preflight.docx',
      bytes.byteLength,
      new JSDOM().window.document
    );
    assert.equal(current.fragment.textContent, 'Current revision');
    currentSession.dispose();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('engine rejection revokes detached blobs and returns DOCUMENT_PARSE_FAILED', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    const blobUrl = 'blob:https://onlypreview.invalid/rejected-image';
    const revoked = [];
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: readyWorker,
      moduleLoader: async () => ({
        renderAsync: async (_data, body) => {
          body.innerHTML = `<section class="onlypreview-docx"><img src="${blobUrl}"></section>`;
          throw new Error('engine failed after allocating image');
        }
      }),
      revokeObjectUrl: (url) => revoked.push(url)
    });

    await assertDocumentError(
      session.load(
        'https://onlypreview.invalid/rejected.docx',
        bytes.byteLength,
        environment.dom.window.document
      ),
      'DOCUMENT_PARSE_FAILED'
    );
    assert.deepEqual(revoked, [blobUrl]);
  } finally {
    environment.restore();
  }
});

test('empty sanitized output returns DOCUMENT_EMPTY without mounting a partial document', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: readyWorker,
      moduleLoader: async () => ({
        renderAsync: async (_data, body) => {
          body.innerHTML = '<section class="onlypreview-docx"><p>   </p></section>';
        }
      })
    });

    await assertDocumentError(
      session.load(
        'https://onlypreview.invalid/empty.docx',
        bytes.byteLength,
        environment.dom.window.document
      ),
      'DOCUMENT_EMPTY'
    );
  } finally {
    environment.restore();
  }
});

test('unsafe or incomplete detached output returns DOCUMENT_SANITIZE_FAILED and no render result', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: readyWorker,
      moduleLoader: async () => ({
        renderAsync: async (_data, body, style) => {
          body.innerHTML = `
            <section class="onlypreview-docx">
              <p>safe prefix</p>
              <script>globalThis.compromised = true</script>
              <img src="https://example.com/remote.png">
            </section>`;
          style.innerHTML = '<style>@import url("https://example.com/remote.css");</style>';
        }
      })
    });

    await assertDocumentError(
      session.load(
        'https://onlypreview.invalid/unsafe.docx',
        bytes.byteLength,
        environment.dom.window.document
      ),
      'DOCUMENT_SANITIZE_FAILED'
    );
    assert.equal(globalThis.compromised, undefined);
  } finally {
    delete globalThis.compromised;
    environment.restore();
  }
});

test('disposing during render rejects late output and revokes every blob it created', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    const blobUrl = 'blob:https://onlypreview.invalid/stale-image';
    const revoked = [];
    let finishRender;
    let renderStarted;
    const started = new Promise((resolveStarted) => {
      renderStarted = resolveStarted;
    });
    const rendering = new Promise((resolveRender) => {
      finishRender = resolveRender;
    });
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: readyWorker,
      moduleLoader: async () => ({
        renderAsync: async (_data, body) => {
          body.innerHTML = `<section class="onlypreview-docx"><img src="${blobUrl}"></section>`;
          renderStarted();
          await rendering;
        }
      }),
      revokeObjectUrl: (url) => revoked.push(url)
    });
    const load = session.load(
      'https://onlypreview.invalid/stale.docx',
      bytes.byteLength,
      environment.dom.window.document
    );
    await started;
    session.dispose();
    finishRender();

    await assertDocumentError(load, 'DOCUMENT_RENDER_TIMEOUT');
    assert.deepEqual(revoked, [blobUrl]);
  } finally {
    environment.restore();
  }
});

test('session disposal does not claim cancellation of a never-settling renderAsync call', async () => {
  const environment = installDomGlobals();
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    let renderStarted;
    const started = new Promise((resolveStarted) => {
      renderStarted = resolveStarted;
    });
    const renderingForever = new Promise(() => undefined);
    const session = createSession({
      fetchImpl: fetchFixture(bytes),
      workerFactory: readyWorker,
      moduleLoader: async () => ({
        renderAsync: async () => {
          renderStarted();
          await renderingForever;
        }
      })
    });
    const load = session.load(
      'https://onlypreview.invalid/non-abortable.docx',
      bytes.byteLength,
      environment.dom.window.document
    );
    await started;
    session.dispose();

    const outcome = await Promise.race([
      load.then(
        () => 'unexpected-ready',
        () => 'unexpected-rejection'
      ),
      new Promise((resolveOutcome) => setImmediate(() => resolveOutcome('still-pending')))
    ]);
    assert.equal(outcome, 'still-pending');
  } finally {
    environment.restore();
  }
});

test('built document Worker preflights required DOCX parts and returns ownership of the bytes', async () => {
  const fixture = await createDocumentFixture();
  const { response, worker } = await runDocumentWorker(fixture);
  try {
    assert.equal(response.type, 'preflight-ready');
    assert.equal(response.hostId, 'host-worker-test');
    assert.ok(response.bytes instanceof ArrayBuffer);
    assert.ok(response.bytes.byteLength > 4);
  } finally {
    await worker.terminate();
  }

  const archive = await JSZip.loadAsync(await createDocumentFixture());
  archive.remove('word/document.xml');
  const missingPart = await archive.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  const invalidRun = await runDocumentWorker(missingPart, 2);
  try {
    assert.equal(invalidRun.response.type, 'error');
    assert.equal(invalidRun.response.errorCode, 'OOXML_ARCHIVE_INVALID');
  } finally {
    await invalidRun.worker.terminate();
  }
});
