/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-drawio-viewer-'));
const bundlePath = join(buildRoot, 'drawio-viewer.mjs');

await build({
  stdin: {
    contents: `
      export { renderOnlyPreviewDrawio } from './src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service';
      export { preflightOnlyPreviewDrawio } from './src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service';
      export { DrawioPreviewStore } from './src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.store';
    `,
    loader: 'ts',
    resolveDir: projectRoot,
    sourcefile: 'onlyPreviewDrawioViewer.test-entry.ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'onlypreview-drawio-store-harness',
      setup(buildContext) {
        buildContext.onResolve({ filter: /onlyPreviewPreview\.store$/ }, () => ({
          path: 'preview-store',
          namespace: 'onlypreview-drawio-test'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'onlypreview-drawio-test' }, () => ({
          loader: 'js',
          contents: `
              const harness = () => globalThis.__onlyPreviewDrawioStoreHarness;
              export const onlyPreviewPreviewStore = {
                reportSurfaceReady: (...args) => harness().ready.push(args),
                reportSurfaceError: (...args) => harness().errors.push(args)
              };
            `
        }));
      }
    }
  ]
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const createDom = () => {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="mount" class="base"></div></body></html>',
    {
      pretendToBeVisual: true,
      url: 'https://onlypreview.invalid/'
    }
  );
  Object.defineProperty(dom.window.document.querySelector('#mount'), 'offsetWidth', {
    configurable: true,
    value: 800
  });
  return dom;
};

const withElementGlobal = async (dom, run) => {
  const previous = globalThis.Element;
  globalThis.Element = dom.window.Element;
  try {
    return await run();
  } finally {
    if (previous) globalThis.Element = previous;
    else delete globalThis.Element;
    dom.window.close();
  }
};

const eventWasPrevented = (dom, target, type) => {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

const graphXml = (style = '') =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" ${style} parent="1" vertex="1"/></root></mxGraphModel>`;

const asArrayBuffer = (source) => {
  const bytes = Buffer.from(source, 'utf8');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const compressedPage = (xml) =>
  deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8'))
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');

const escapeXmlText = (source) =>
  source.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const drawioContent = (xml = graphXml()) => ({ xml, pageCount: 1, cellCount: 3 });
const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

const makeWidthControllable = (element, initialWidth = 0) => {
  let width = initialWidth;
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: () => width
  });
  return (nextWidth) => {
    width = nextWidth;
    element.setAttribute('data-test-width', String(nextWidth));
  };
};

test('viewer mounts read-only state and disposes graph, listeners, attributes, classes, and DOM once', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    let processClass = '';
    let originalInitializedCalls = 0;
    let destroyCalls = 0;
    const originalInitialized = () => {
      originalInitializedCalls += 1;
    };
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: (className) => {
        processClass = className;
        const target = dom.window.document.querySelector(`.${className}`);
        const anchor = dom.window.document.createElement('a');
        anchor.href = 'https://example.invalid/';
        target.append(anchor);
        graphViewer.viewerInitialized({
          graph: { container: target, destroy: () => (destroyCalls += 1) }
        });
      }
    };
    dom.window.GraphViewer = graphViewer;

    const xml = graphXml('value="Read only"');
    const handle = await runtime.renderOnlyPreviewDrawio(mount, {
      xml,
      pageCount: 1,
      cellCount: 3
    });

    assert.ok(processClass.startsWith('onlypreview-drawio-target-'));
    assert.ok(mount.classList.contains('mxgraph'));
    assert.ok(mount.classList.contains(processClass));
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    assert.equal(originalInitializedCalls, 1);
    assert.deepEqual(JSON.parse(mount.getAttribute('data-mxgraph')), {
      xml,
      highlight: 'none',
      lightbox: false,
      nav: false,
      toolbar: 'pages zoom layers',
      'auto-fit': true,
      'check-visible-state': false,
      resize: true,
      center: true
    });

    const anchor = mount.querySelector('a');
    for (const type of ['click', 'auxclick', 'dragstart']) {
      assert.equal(eventWasPrevented(dom, anchor, type), true);
    }

    handle.dispose();
    handle.dispose();
    assert.equal(destroyCalls, 1);
    assert.equal(mount.hasAttribute('data-mxgraph'), false);
    assert.equal(mount.classList.contains('mxgraph'), false);
    assert.equal(mount.classList.contains(processClass), false);
    assert.equal(mount.classList.contains('base'), true);
    assert.equal(mount.childNodes.length, 0);

    const afterDispose = dom.window.document.createElement('a');
    afterDispose.href = 'https://example.invalid/after';
    mount.append(afterDispose);
    for (const type of ['click', 'auxclick', 'dragstart']) {
      assert.equal(eventWasPrevented(dom, afterDispose, type), false);
    }
  });
});

test('viewer waits for visibility then disables official deferral before dynamic initialization', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    const setWidth = makeWidthControllable(mount);
    let processCalls = 0;
    let destroyCalls = 0;
    const originalInitialized = () => {};
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: (className) => {
        processCalls += 1;
        const target = dom.window.document.querySelector(`.${className}`);
        const config = JSON.parse(target.getAttribute('data-mxgraph'));
        assert.equal(config['check-visible-state'], false);
        graphViewer.viewerInitialized({
          graph: { container: target, destroy: () => (destroyCalls += 1) }
        });
      }
    };
    dom.window.GraphViewer = graphViewer;

    const pending = runtime.renderOnlyPreviewDrawio(mount, drawioContent(), { timeoutMs: 100 });
    await tick();
    assert.equal(processCalls, 0);
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    setWidth(800);

    const handle = await pending;
    assert.equal(processCalls, 1);
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    assert.equal(destroyCalls, 0);
    handle.dispose();
    assert.equal(destroyCalls, 1);
  });
});

test('viewer aborts a hidden mount before the vendor can create a late candidate', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    const setWidth = makeWidthControllable(mount);
    const controller = new AbortController();
    let processCalls = 0;
    const originalInitialized = () => {};
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: () => {
        processCalls += 1;
      }
    };
    dom.window.GraphViewer = graphViewer;

    const pending = runtime.renderOnlyPreviewDrawio(mount, drawioContent(), {
      signal: controller.signal,
      timeoutMs: 100
    });
    await tick();
    controller.abort();
    await assert.rejects(pending, (error) => error?.code === 'DIAGRAM_RENDER_TIMEOUT');
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    assert.equal(processCalls, 0);
    assert.equal(mount.hasAttribute('data-mxgraph'), false);
    assert.deepEqual([...mount.classList], ['base']);
    assert.equal(mount.childNodes.length, 0);
    setWidth(800);
    await tick();
    assert.equal(processCalls, 0);
  });
});

test('viewer initialization uses a finite non-renewing deadline and cleans the mount', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    makeWidthControllable(mount);
    let processCalls = 0;
    const originalInitialized = () => {};
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: () => {
        processCalls += 1;
      }
    };
    dom.window.GraphViewer = graphViewer;

    await assert.rejects(
      () => runtime.renderOnlyPreviewDrawio(mount, drawioContent(), { timeoutMs: 5 }),
      (error) => error?.code === 'DIAGRAM_RENDER_TIMEOUT'
    );
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    assert.equal(processCalls, 0);
    assert.equal(mount.hasAttribute('data-mxgraph'), false);
    assert.deepEqual([...mount.classList], ['base']);
    assert.equal(mount.childNodes.length, 0);
  });
});

test('store aborts a superseded deferred mount and suppresses stale ready and error reports', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    const setWidth = makeWidthControllable(mount);
    const renderedXml = [];
    let destroyCalls = 0;
    const originalInitialized = () => {};
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: (className) => {
        const target = dom.window.document.querySelector(`.${className}`);
        const config = JSON.parse(target.getAttribute('data-mxgraph'));
        renderedXml.push(config.xml);
        assert.equal(config['check-visible-state'], false);
        graphViewer.viewerInitialized({
          graph: { container: target, destroy: () => (destroyCalls += 1) }
        });
      }
    };
    dom.window.GraphViewer = graphViewer;
    globalThis.__onlyPreviewDrawioStoreHarness = { ready: [], errors: [] };
    const store = new runtime.DrawioPreviewStore();

    const firstXml = graphXml('value="first"');
    const secondXml = graphXml('value="second"');
    const first = store.mount(mount, drawioContent(firstXml), '41');
    await tick();
    assert.deepEqual(renderedXml, []);
    const second = store.mount(mount, drawioContent(secondXml), '42');
    await tick();
    assert.deepEqual(renderedXml, []);
    setWidth(800);

    await Promise.all([first, second]);
    assert.deepEqual(renderedXml, [secondXml]);
    assert.deepEqual(globalThis.__onlyPreviewDrawioStoreHarness.ready, [['42']]);
    assert.deepEqual(globalThis.__onlyPreviewDrawioStoreHarness.errors, []);
    assert.equal(destroyCalls, 0);
    store.dispose();
    assert.deepEqual(globalThis.__onlyPreviewDrawioStoreHarness.ready, [['42']]);
    assert.deepEqual(globalThis.__onlyPreviewDrawioStoreHarness.errors, []);
    assert.equal(destroyCalls, 1);
    delete globalThis.__onlyPreviewDrawioStoreHarness;
  });
});

test('visible unrelated mounts render concurrently through dynamic callback lookup', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const firstMount = dom.window.document.querySelector('#mount');
    const secondMount = dom.window.document.createElement('div');
    Object.defineProperty(secondMount, 'offsetWidth', { configurable: true, value: 800 });
    dom.window.document.body.append(secondMount);
    const initialized = [];
    let destroyCalls = 0;
    const originalInitialized = (viewer) => initialized.push(viewer.graph.container);
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: (className) => {
        const target = dom.window.document.querySelector(`.${className}`);
        graphViewer.viewerInitialized({
          graph: { container: target, destroy: () => (destroyCalls += 1) }
        });
      }
    };
    dom.window.GraphViewer = graphViewer;

    const [first, second] = await Promise.all([
      runtime.renderOnlyPreviewDrawio(firstMount, drawioContent()),
      runtime.renderOnlyPreviewDrawio(secondMount, drawioContent())
    ]);
    assert.deepEqual(initialized, [firstMount, secondMount]);
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    first.dispose();
    second.dispose();
    assert.equal(destroyCalls, 2);
  });
});

test('viewer rejection restores callback and leaves no mount state or external-action listener', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    const originalInitialized = () => {};
    const graphViewer = {
      viewerInitialized: originalInitialized,
      processElements: (className) => {
        const target = dom.window.document.querySelector(`.${className}`);
        target.append(dom.window.document.createElement('a'));
        throw new Error('rejected');
      }
    };
    dom.window.GraphViewer = graphViewer;

    await assert.rejects(
      () =>
        runtime.renderOnlyPreviewDrawio(mount, {
          xml: graphXml(),
          pageCount: 1,
          cellCount: 3
        }),
      (error) => error?.code === 'DIAGRAM_PARSE_FAILED'
    );
    assert.equal(graphViewer.viewerInitialized, originalInitialized);
    assert.equal(mount.hasAttribute('data-mxgraph'), false);
    assert.deepEqual([...mount.classList], ['base']);
    assert.equal(mount.childNodes.length, 0);

    const anchor = dom.window.document.createElement('a');
    mount.append(anchor);
    assert.equal(eventWasPrevented(dom, anchor, 'click'), false);
  });
});

test('entity-obfuscated image rejection never invokes the viewer double or script loader', async () => {
  const dom = createDom();
  await withElementGlobal(dom, async () => {
    const mount = dom.window.document.querySelector('#mount');
    let processCalls = 0;
    dom.window.GraphViewer = {
      viewerInitialized: () => {},
      processElements: () => {
        processCalls += 1;
      }
    };
    const encoded = graphXml(
      'style="&#00115;&#x00068;&#00097;&#X00070;&#00101;&#x0003D;&#00105;&#x006d;&#00097;&#x00067;&#00101;&#X00003B;&#x69;&#109;&#x61;&#103;&#x65;&#61;&#100;&#x61;&#116;&#x61;&#58;&#105;&#x6D;&#97;&#103;&#x65;&#47;png&#59;base64,AAAA"'
    );
    for (const page of [
      encoded,
      `<mxfile><diagram>${escapeXmlText(encoded)}</diagram></mxfile>`,
      `<mxfile><diagram>${compressedPage(encoded)}</diagram></mxfile>`
    ]) {
      await assert.rejects(
        async () => {
          const result = await runtime.preflightOnlyPreviewDrawio(asArrayBuffer(page));
          await runtime.renderOnlyPreviewDrawio(mount, {
            xml: page,
            pageCount: result.pageCount,
            cellCount: result.cellCount
          });
        },
        (error) => error?.code === 'DIAGRAM_LIMIT'
      );
    }
    assert.equal(processCalls, 0);
    assert.equal(dom.window.document.querySelector('script[data-onlypreview-drawio-viewer]'), null);
    assert.equal(mount.hasAttribute('data-mxgraph'), false);
  });
});
