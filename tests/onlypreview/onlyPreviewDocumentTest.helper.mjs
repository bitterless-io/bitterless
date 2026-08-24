/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nodeRequire = createRequire(import.meta.url);
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-document-preview-'));
const sessionPath = join(buildRoot, 'document-session.mjs');
const workerBuildRoot = join(buildRoot, 'worker');
const documentPreviewPath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/components/DocumentPreview/DocumentPreview.vue'
);

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/preview/src/onlyPreviewDocument.service.ts')
  ],
  outfile: sessionPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'external-postcss',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^postcss$/ }, () => ({
          path: nodeRequire.resolve('postcss'),
          external: true
        }));
      }
    }
  ]
});

await build({
  entryPoints: {
    worker: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewDocumentPreflight.worker.ts'
    )
  },
  outdir: workerBuildRoot,
  entryNames: '[name]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

export const documentPreviewSource = readFileSync(documentPreviewPath, 'utf8');
const documentPreviewDescriptor = parse(documentPreviewSource, {
  filename: documentPreviewPath
}).descriptor;
const documentPreviewScript = compileScript(documentPreviewDescriptor, {
  id: 'onlypreview-document-test',
  genDefaultAs: '__documentPreview'
});
const documentPreviewTemplate = compileTemplate({
  id: 'onlypreview-document-test',
  filename: documentPreviewPath,
  source: documentPreviewDescriptor.template.content,
  compilerOptions: { bindingMetadata: documentPreviewScript.bindings }
});
assert.deepEqual(documentPreviewTemplate.errors, []);
const documentPreviewCompiled = `${documentPreviewScript.content}\n${documentPreviewTemplate.code}\n__documentPreview.render = render;\nexport default __documentPreview;\nexport { createApp, nextTick } from 'vue';\n`;

await build({
  entryPoints: { documentPreview: documentPreviewPath },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'compile-document-preview',
      setup(buildContext) {
        buildContext.onLoad({ filter: /DocumentPreview\.vue$/ }, (args) => {
          if (args.path !== documentPreviewPath) return null;
          return {
            contents: documentPreviewCompiled,
            loader: 'ts',
            resolveDir: dirname(documentPreviewPath)
          };
        });
        buildContext.onResolve({ filter: /onlyPreviewI18n$/ }, () => ({
          path: 'document-i18n',
          namespace: 'document-preview-test'
        }));
        buildContext.onResolve({ filter: /onlyPreviewPreview\.store$/ }, () => ({
          path: 'document-store',
          namespace: 'document-preview-test'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'document-preview-test' }, ({ path }) => {
          if (path === 'document-i18n') {
            return {
              loader: 'js',
              contents: `
                export const onlyPreviewI18n = { preview: { documentLabel: 'Document preview' } };
              `
            };
          }
          return {
            loader: 'js',
            contents: `
              const harness = () => globalThis.__onlyPreviewDocumentComponentHarness;
              export const onlyPreviewPreviewStore = {
                reportCharacterCount: (...args) => harness().characterCounts.push(args),
                armCharacterCountReporting: (...args) => harness().arms.push(args),
                reportSurfaceError: (...args) => harness().surfaceErrors.push(args)
              };
            `
          };
        });
      }
    }
  ]
});

const bootstrapPath = join(workerBuildRoot, 'node-worker-bootstrap.mjs');
writeFileSync(
  bootstrapPath,
  `
    import { parentPort } from 'node:worker_threads';
    const pending = [];
    const listeners = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
    globalThis.addEventListener = (type, listener) => {
      if (type !== 'message') return;
      listeners.push(listener);
      while (pending.length) listener({ data: pending.shift() });
    };
    parentPort.on('message', (data) => {
      if (!listeners.length) pending.push(data);
      else for (const listener of listeners) listener({ data });
    });
    await import('./worker.mjs');
  `
);

const sessionRuntime = await import(pathToFileURL(sessionPath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n9sAAAAASUVORK5CYII=',
  'base64'
);

const asArrayBuffer = (value) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);

export const createDocumentFixture = async () => {
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12_240, height: 15_840 },
            margin: { top: 720, right: 720, bottom: 720, left: 720 }
          }
        },
        headers: {
          default: new Header({
            children: [new Paragraph('Fixture Header')]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph('Fixture Footer')]
          })
        },
        children: [
          new Paragraph({ text: 'Fixture Heading', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: 'Fixture list item', bullet: { level: 0 } }),
          new Paragraph({
            children: [
              new TextRun('Before '),
              new ExternalHyperlink({
                link: 'https://example.com/document-link',
                children: [new TextRun('Fixture Link')]
              }),
              new TextRun(' after')
            ]
          }),
          new Paragraph({
            children: [
              new Bookmark({
                id: 'fixture-bookmark',
                children: [new TextRun('Fixture Bookmark')]
              }),
              new TextRun(' '),
              new InternalHyperlink({
                anchor: 'fixture-bookmark',
                children: [new TextRun('Fixture Bookmark Link')]
              })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Fixture Key')] }),
                  new TableCell({ children: [new Paragraph('Fixture Value')] })
                ]
              })
            ]
          }),
          new Paragraph({
            children: [
              new ImageRun({
                data: onePixelPng,
                transformation: { width: 18, height: 18 },
                type: 'png'
              })
            ]
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph('Fixture Second Page')
        ]
      }
    ]
  });
  return asArrayBuffer(await Packer.toBuffer(document));
};

export class FakeWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  onPost = null;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
    this.onPost?.(message, this);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, data) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

export const responseFor = (request, response) => ({
  hostId: request.hostId,
  runtimeId: request.runtimeId,
  selectionRevision: request.selectionRevision,
  workerGeneration: request.workerGeneration,
  requestId: request.requestId,
  ...response
});

export const readyWorker = () => {
  const worker = new FakeWorker();
  worker.onPost = (request, currentWorker) => {
    queueMicrotask(() => {
      currentWorker.emit(
        'message',
        responseFor(request, { type: 'preflight-ready', bytes: request.bytes })
      );
    });
  };
  return worker;
};

export const installDomGlobals = () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://onlypreview.invalid/'
  });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    SVGElement: dom.window.SVGElement,
    Document: dom.window.Document,
    DocumentFragment: dom.window.DocumentFragment,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    MutationObserver: dom.window.MutationObserver,
    Blob: dom.window.Blob,
    URL: dom.window.URL,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  let nextBlob = 0;
  const createdBlobUrls = [];
  dom.window.URL.createObjectURL = () => {
    const value = `blob:https://onlypreview.invalid/document-${++nextBlob}`;
    createdBlobUrls.push(value);
    return value;
  };
  dom.window.URL.revokeObjectURL = () => undefined;
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    createdBlobUrls,
    dom,
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  };
};

export const fetchFixture = (bytes) => async () => new Response(bytes.slice(0), { status: 200 });

export const createSession = (overrides = {}) =>
  new sessionRuntime.OnlyPreviewDocumentSession({
    hostId: 'host-for-document-tests',
    selectionRevision: 7,
    ...overrides
  });

export const assertDocumentError = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

export const runDocumentWorker = async (bytes, requestId = 1) => {
  const worker = new NodeWorker(bootstrapPath, { type: 'module' });
  const request = {
    hostId: 'host-worker-test',
    runtimeId: 'runtime-worker-test',
    selectionRevision: 12,
    workerGeneration: 3,
    requestId,
    type: 'preflight',
    bytes
  };
  const response = new Promise((resolveResponse, rejectResponse) => {
    worker.once('message', resolveResponse);
    worker.once('error', rejectResponse);
  });
  worker.postMessage(request, [bytes]);
  assert.equal(bytes.byteLength, 0);
  return { response: await response, worker };
};

export const importDocumentPreviewRuntime = async (label) =>
  await import(`${pathToFileURL(join(buildRoot, 'documentPreview.mjs')).href}?mount=${label}`);
