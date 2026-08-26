/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { parse } from '@vue/compiler-sfc';

export const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
export const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-rendering-'));

const rendererStoreHarnessPlugin = {
  name: 'onlypreview-renderer-store-harness',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
      path: 'electron-xpc-renderer',
      namespace: 'onlypreview-renderer-harness'
    }));
    buildContext.onResolve({ filter: /onlyPreviewClient$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-client', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewEnv\.bridge$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-env', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewSheet\.service$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-sheet', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewDocument\.service$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-document', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewImage\.service$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-image', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewMedia\.service$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-media', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onResolve({ filter: /onlyPreviewFindAdapter\.service$/ }, ({ importer }) =>
      importer.endsWith('onlyPreviewPreview.store.ts')
        ? { path: 'onlypreview-find-adapter', namespace: 'onlypreview-renderer-harness' }
        : null
    );
    buildContext.onLoad({ filter: /.*/, namespace: 'onlypreview-renderer-harness' }, ({ path }) => {
      if (path === 'electron-xpc-renderer') {
        return {
          loader: 'js',
          contents: `
              const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
              export const xpcRenderer = {
                broadcast: (...args) => harness().broadcasts.push(args),
                subscribe: (eventName, callback) => harness().subscriptions.set(eventName, callback)
              };
              export const createXpcRendererEmitter = () => ({});
            `
        };
      }
      if (path === 'onlypreview-env') {
        return {
          loader: 'js',
          contents: `
              export const onlyPreviewEnv = {
                hostToken: 'host-token-for-tests',
                hostId: 'host-for-tests',
                previewRuntimeToken: 'preview-runtime-token-for-tests'
              };
            `
        };
      }
      if (path === 'onlypreview-sheet') {
        return {
          loader: 'js',
          resolveDir: projectRoot,
          contents: `
              import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
              const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
              export class OnlyPreviewSheetSession {
                constructor(options) {
                  this.options = options;
                  harness().sheetSessions.push(this);
                }
                async load(assetUrl, expectedSize) {
                  harness().sheetLoads.push({ assetUrl, expectedSize });
                  return harness().sheetManifest;
                }
                dispose() {
                  harness().sheetDisposals += 1;
                }
                emitUnexpectedTerminal(errorCode) {
                  this.options.onUnexpectedTerminal?.(
                    new OnlyPreviewContractError(errorCode, 'Workbook session failed.')
                  );
                }
              }
            `
        };
      }
      if (path === 'onlypreview-document') {
        return {
          loader: 'js',
          contents: `
              const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
              export class OnlyPreviewDocumentSession {
                constructor(options) {
                  this.options = options;
                  harness().documentSessions.push(this);
                }
                async load(assetUrl, expectedSize, ownerDocument) {
                  harness().documentLoads.push({ assetUrl, expectedSize, ownerDocument });
                  return harness().documentContent;
                }
                dispose() {
                  harness().documentDisposals += 1;
                }
              }
            `
        };
      }
      if (path === 'onlypreview-image') {
        return {
          loader: 'js',
          contents: `
              const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
              export class OnlyPreviewImageSession {
                constructor() {
                  harness().imageSessions.push(this);
                }
                async load(assetUrl, expectedSize, mimeType) {
                  harness().imageLoads.push({ assetUrl, expectedSize, mimeType });
                  return harness().imageContent;
                }
                dispose() {
                  harness().imageDisposals += 1;
                }
              }
            `
        };
      }
      if (path === 'onlypreview-media') {
        return {
          loader: 'js',
          contents: `
              const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
              export class OnlyPreviewMediaSession {
                constructor() {
                  harness().mediaSessions.push(this);
                }
                async prepare(assetUrl, expectedSize) {
                  harness().mediaPrepares.push({ assetUrl, expectedSize });
                }
                dispose() {
                  harness().mediaDisposals += 1;
                }
              }
            `
        };
      }
      if (path === 'onlypreview-find-adapter') {
        return {
          loader: 'js',
          contents: `
              export const onlyPreviewFindAdapterBridge = {
                initialize() {},
                clear() {}
              };
            `
        };
      }
      return {
        loader: 'js',
        contents: `
            const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
            const success = (value) => ({ ok: true, value });
            export const onlyPreviewClient = {
              getVuePreviewPresentation: async () => success(harness().presentation),
              getSettings: async () => success(harness().settings),
              getPreviewFindSnapshot: async () => success(harness().findSnapshot),
              readText: async (request) => {
                harness().readText.push(request);
                throw new Error('unsupported adapters must not read text');
              },
              reportPreviewReset: async (request) => {
                harness().resets.push(request);
                return success(undefined);
              },
              reportPreviewReady: async (request) => {
                const snapshot = harness().captureReady ? harness().captureReady() : null;
                harness().ready.push({ request, snapshot });
                return success(undefined);
              },
              reportPreviewError: async (request) => {
                harness().errors.push(request);
                if (harness().reportErrorPromise) return harness().reportErrorPromise;
                return success(undefined);
              }
            };
          `
      };
    });
  }
};

await build({
  entryPoints: {
    characterCount: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts'
    ),
    characterCountGate: join(
      projectRoot,
      'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
    ),
    markdown: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts'
    ),
    previewStore: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [rendererStoreHarnessPlugin]
});

export const characterCount = await import(
  pathToFileURL(join(buildRoot, 'characterCount.mjs')).href
);
export const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
export const markdown = await import(pathToFileURL(join(buildRoot, 'markdown.mjs')).href);
export const previewSurfaceSource = readFileSync(
  join(
    projectRoot,
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  ),
  'utf8'
);
export const previewSurfaceTemplate = parse(previewSurfaceSource).descriptor.template?.content;

assert.ok(previewSurfaceTemplate, 'PreviewSurface must keep an executable Vue template');

after(() => rmSync(buildRoot, { recursive: true, force: true }));

export const render = (source, sourceSize = Buffer.byteLength(source)) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return {
    dom,
    result: markdown.renderOnlyPreviewMarkdown(source, sourceSize, dom.window)
  };
};

export const officeDescriptor = (extension, kind) => ({
  workspaceId: 'workspace-generation-for-tests',
  relativePath: `fixtures/example${extension}`,
  name: `example${extension}`,
  extension,
  kind,
  mimeType: 'application/octet-stream',
  language: '',
  size: 4096,
  modifiedAt: 1_700_000_000_000
});

export const officePresentation = (descriptor, selectionRevision, adapterId = 'unsupported') => ({
  hostId: 'host-for-tests',
  workspaceId: descriptor.workspaceId,
  selectionRevision,
  surface: 'vue',
  adapterId,
  status: 'loading',
  fileRef: {
    workspaceId: descriptor.workspaceId,
    relativePath: descriptor.relativePath
  },
  descriptor,
  error: null,
  selectedTextAvailable: false
});

export const createRendererStoreHarness = (presentation) => ({
  presentation,
  findSnapshot: {
    state: {
      state: 'pending',
      hostId: presentation.hostId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: 0
    },
    open: false,
    query: '',
    caseSensitive: false,
    result: null
  },
  settings: {
    theme: 'light',
    editorFontSize: 13,
    wordWrap: false,
    showHiddenFiles: true,
    openFilesWithSingleClick: true
  },
  broadcasts: [],
  subscriptions: new Map(),
  captureReady: null,
  readText: [],
  resets: [],
  ready: [],
  errors: [],
  reportErrorPromise: null,
  sheetSessions: [],
  sheetLoads: [],
  sheetDisposals: 0,
  documentSessions: [],
  documentLoads: [],
  documentDisposals: 0,
  documentContent: null,
  drawioContent: null,
  imageSessions: [],
  imageLoads: [],
  imageDisposals: 0,
  imageContent: {
    objectUrl: 'blob:onlypreview-rendering-test',
    naturalWidth: 10,
    naturalHeight: 10
  },
  mediaSessions: [],
  mediaPrepares: [],
  mediaDisposals: 0,
  sheetManifest: {
    sheets: [{ id: 0, name: 'Sheet 1', rowCount: 1, columnCount: 1 }],
    acceptedCells: 1,
    coverage: { kind: 'complete' }
  }
});

export const renderPreviewSurface = async (store) => {
  const app = createSSRApp({
    template: previewSurfaceTemplate,
    setup: () => ({
      onlyPreviewPreviewStore: store,
      onlyPreviewI18n: {
        preview: {
          failedTitle: 'Preview failed',
          unsupportedTitle: 'Unsupported preview',
          unsupportedBody: 'Metadata only',
          unsupportedImageBody: 'Unsupported image',
          unsupportedVideoBody: 'Unsupported video',
          type: 'Type',
          size: 'Size',
          modified: 'Modified',
          emptyTitle: 'No selection',
          emptyBody: 'Choose a file',
          loading: 'Loading'
        }
      },
      isMarkdown: false,
      selectionPreviewKey: 'selection',
      imageAlt: '',
      unsupportedBody: 'Metadata only',
      previewLimitMessage: '',
      formatOnlyPreviewBytes: (size) => `${size} bytes`,
      formatOnlyPreviewDate: (modifiedAt) => `date:${modifiedAt}`
    })
  });
  for (const componentName of [
    'IconAlertTriangle',
    'IconFileSearch',
    'IconFileUnknown',
    'MarkdownPreview',
    'MonacoTextPreview'
  ]) {
    // eslint-disable-next-line vue/one-component-per-file
    app.component(componentName, { template: '<span></span>' });
  }
  // eslint-disable-next-line vue/one-component-per-file
  app.component('SheetPreview', {
    props: {
      session: { type: Object, required: true },
      manifest: { type: Object, required: true }
    },
    template: '<section name="onlypreview__sheetPreview"></section>'
  });
  // eslint-disable-next-line vue/one-component-per-file
  app.component('DocumentPreview', {
    props: {
      content: { type: Object, required: true },
      reportingRevision: { type: String, required: true }
    },
    template: '<section name="onlypreview__documentPreview"></section>'
  });
  // eslint-disable-next-line vue/one-component-per-file
  app.component('DrawioPreview', {
    props: {
      content: { type: Object, required: true },
      reportingRevision: { type: String, required: true }
    },
    template: '<section name="onlypreview__drawioPreview"></section>'
  });
  // eslint-disable-next-line vue/one-component-per-file
  app.component('ImagePreview', {
    props: {
      content: { type: Object, required: true },
      alt: { type: String, required: true },
      reportingRevision: { type: String, required: true }
    },
    template: '<section name="onlypreview__imagePreview"></section>'
  });
  // eslint-disable-next-line vue/one-component-per-file
  app.component('MediaPreview', {
    props: {
      kind: { type: String, required: true },
      assetUrl: { type: String, required: true },
      name: { type: String, required: true },
      reportingRevision: { type: String, required: true }
    },
    template: '<section name="onlypreview__mediaPreview"></section>'
  });
  return await renderToString(app);
};
