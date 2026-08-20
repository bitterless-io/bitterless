/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { parse } from '@vue/compiler-sfc';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-rendering-'));

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
      return {
        loader: 'js',
        contents: `
            const harness = () => globalThis.__onlyPreviewRendererStoreHarness;
            const success = (value) => ({ ok: true, value });
            export const onlyPreviewClient = {
              getVuePreviewPresentation: async () => success(harness().presentation),
              getSettings: async () => success(harness().settings),
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

const characterCount = await import(pathToFileURL(join(buildRoot, 'characterCount.mjs')).href);
const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
const markdown = await import(pathToFileURL(join(buildRoot, 'markdown.mjs')).href);
const previewSurfaceSource = readFileSync(
  join(
    projectRoot,
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  ),
  'utf8'
);
const previewSurfaceTemplate = parse(previewSurfaceSource).descriptor.template?.content;

assert.ok(previewSurfaceTemplate, 'PreviewSurface must keep an executable Vue template');

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const render = (source, sourceSize = Buffer.byteLength(source)) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return {
    dom,
    result: markdown.renderOnlyPreviewMarkdown(source, sourceSize, dom.window)
  };
};

const officeDescriptor = (extension, kind) => ({
  workspaceId: 'workspace-generation-for-tests',
  relativePath: `fixtures/example${extension}`,
  name: `example${extension}`,
  displayPath: `/fixtures/example${extension}`,
  extension,
  kind,
  mimeType: 'application/octet-stream',
  language: '',
  size: 4096,
  modifiedAt: 1_700_000_000_000
});

const officePresentation = (descriptor, selectionRevision) => ({
  hostId: 'host-for-tests',
  workspaceId: descriptor.workspaceId,
  selectionRevision,
  surface: 'vue',
  adapterId: 'unsupported',
  status: 'loading',
  fileRef: {
    workspaceId: descriptor.workspaceId,
    relativePath: descriptor.relativePath
  },
  descriptor,
  error: null,
  selectedTextAvailable: false
});

const createRendererStoreHarness = (presentation) => ({
  presentation,
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
  errors: []
});

const renderPreviewSurface = async (store) => {
  const app = createSSRApp({
    template: previewSurfaceTemplate,
    setup: () => ({
      onlyPreviewPreviewStore: store,
      onlyPreviewI18n: {
        preview: {
          failedTitle: 'Preview failed',
          unsupportedTitle: 'Unsupported preview',
          unsupportedBody: 'Metadata only',
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
      previewLimitMessage: '',
      formatOnlyPreviewBytes: (size) => `${size} bytes`,
      formatOnlyPreviewDate: (modifiedAt) => `date:${modifiedAt}`
    })
  });
  for (const componentName of [
    'IconAlertTriangle',
    'IconFileSearch',
    'IconFileUnknown',
    'IconMusic',
    'MarkdownPreview',
    'MonacoTextPreview'
  ]) {
    app.component(componentName, { template: '<span></span>' });
  }
  return await renderToString(app);
};

test('Markdown keeps semantic reading structure and strips every attribute', () => {
  const source = `# Heading

Paragraph with **strong**, *emphasis*, ~~deleted~~, and [documentation](https://example.com).

> A quoted line

- first
- second

| Name | Value |
| --- | ---: |
| Alpha | 1 |

\`inline\`

\`\`\`ts
const answer = 42;
\`\`\`
`;
  const { dom, result } = render(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  dom.window.document.body.innerHTML = result.html;
  const document = dom.window.document;
  for (const selector of [
    'h1',
    'p',
    'strong',
    'em',
    'del',
    'a',
    'blockquote',
    'ul',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'pre',
    'code'
  ]) {
    assert.ok(document.querySelector(selector), `${selector} should remain semantic`);
  }
  assert.equal(document.querySelector('a')?.textContent, 'documentation');
  assert.equal(document.querySelector('a')?.attributes.length, 0);
  for (const element of document.body.querySelectorAll('*')) {
    assert.equal(element.attributes.length, 0, `${element.tagName} must have zero attributes`);
  }
});

test('Markdown makes hostile HTML, links, and images inert without loading resources', () => {
  const source = `<script src="https://example.com/x.js">alert(1)</script>
<style>body { background: url(file:///tmp/private.png) }</style>
<iframe src="data:text/html,owned">frame</iframe>
<form action="https://example.com"><input onfocus="alert(1)"></form>
<svg onload="alert(1)"><foreignObject>svg</foreignObject></svg>
<math><mi>math</mi></math>
<div onclick="alert(1)" style="color:red">raw html</div>

[javascript](javascript:alert(1))
[data](data:text/html,owned)
[remote](https://example.com/path)
[local](file:///tmp/private.txt)
![remote image](https://example.com/pixel.png "tracking")
![data image](data:image/svg+xml,owned)

<broken attr="unterminated
`;
  const { dom, result } = render(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  dom.window.document.body.innerHTML = result.html;
  const document = dom.window.document;
  assert.equal(
    document.querySelectorAll('script, style, iframe, frame, form, input, svg, math, img').length,
    0
  );
  assert.equal(document.querySelectorAll('[href], [src], [style], [onload], [onclick]').length, 0);
  for (const element of document.body.querySelectorAll('*')) {
    assert.equal(element.attributes.length, 0, `${element.tagName} must have zero attributes`);
  }

  const text = document.body.textContent || '';
  assert.match(text, /<script src="https:\/\/example\.com\/x\.js">/);
  assert.match(text, /<style>body \{ background: url\(file:\/\/\/tmp\/private\.png\) \}<\/style>/);
  assert.match(text, /<iframe src="data:text\/html,owned">frame<\/iframe>/);
  assert.match(text, /<form action="https:\/\/example\.com">/);
  assert.match(text, /<svg onload="alert\(1\)">/);
  assert.match(text, /<math><mi>math<\/mi><\/math>/);
  assert.match(text, /<div onclick="alert\(1\)" style="color:red">raw html<\/div>/);
  assert.match(text, /javascript/);
  assert.match(text, /data/);
  assert.match(text, /remote/);
  assert.match(text, /local/);
  assert.match(text, /\[Image: remote image\]/);
  assert.match(text, /\[Image: data image\]/);
  assert.doesNotMatch(text, /tracking/);
});

test('Markdown admits by the original file-byte size without re-encoding tolerant text', () => {
  const withinLimit = render('small', 1024 * 1024).result;
  assert.equal(withinLimit.ok, true);

  const declaredTooLarge = render('small', 1024 * 1024 + 1).result;
  assert.deepEqual(declaredTooLarge, { ok: false, reason: 'too-large' });

  const replacementExpanded = render('\uFFFD'.repeat(400_000), 1024 * 1024).result;
  assert.equal(replacementExpanded.ok, true);
});

test('raw HTML is intentionally absent from the Vue rendering bundle', () => {
  assert.doesNotMatch(previewSurfaceSource, /HtmlPreview|v-html=.*html/i);
});

test('unsupported Office adapters render metadata instead of the generic empty state', async () => {
  const cases = [
    ['.xlsx', 'sheet'],
    ['.xlsm', 'sheet'],
    ['.docx', 'document']
  ];

  for (const [extension, kind] of cases) {
    const descriptor = officeDescriptor(extension, kind);
    const html = await renderPreviewSurface({
      errorMessage: '',
      presentationError: '',
      errorCode: null,
      descriptor,
      descriptorType: extension.slice(1).toUpperCase(),
      textContent: null,
      showsUnsupportedMetadata: true,
      loading: false,
      settings: {},
      selectionReportingRevision: '1'
    });

    assert.match(html, /name="onlypreview__unsupportedPreview"/, extension);
    assert.doesNotMatch(html, /name="onlypreview__previewEmpty"/, extension);
    assert.match(html, new RegExp(extension.slice(1).toUpperCase()), extension);
    assert.match(html, /4096 bytes/, extension);
    assert.match(html, /date:1700000000000/, extension);
  }
});

test('unsupported Office adapters become ready only as a rendered metadata fallback', async () => {
  const cases = [
    ['.xlsx', 'sheet'],
    ['.xlsm', 'sheet'],
    ['.docx', 'document']
  ];

  for (const [index, [extension, kind]] of cases.entries()) {
    const descriptor = officeDescriptor(extension, kind);
    const presentation = officePresentation(descriptor, index + 1);
    const harness = createRendererStoreHarness(presentation);
    globalThis.__onlyPreviewRendererStoreHarness = harness;
    const previewStoreRuntime = await import(
      `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?office=${extension.slice(1)}`
    );
    const store = previewStoreRuntime.onlyPreviewPreviewStore;
    harness.captureReady = () => ({
      descriptorKind: store.descriptor?.kind,
      loading: store.loading,
      showsUnsupportedMetadata: store.showsUnsupportedMetadata
    });

    await store.initialize();

    assert.equal(store.descriptor?.kind, kind, extension);
    assert.equal(store.showsUnsupportedMetadata, true, extension);
    assert.equal(store.loading, false, extension);
    assert.equal(harness.readText.length, 0, extension);
    assert.equal(harness.errors.length, 0, extension);
    assert.deepEqual(
      harness.ready.map(({ request }) => request.selectionRevision),
      [presentation.selectionRevision],
      extension
    );
    assert.deepEqual(
      harness.ready[0]?.snapshot,
      {
        descriptorKind: kind,
        loading: false,
        showsUnsupportedMetadata: true
      },
      extension
    );
  }
});

test('character count uses grapheme clusters and sums every non-empty selection', () => {
  assert.equal(characterCount.countOnlyPreviewGraphemes(''), 0);
  assert.equal(characterCount.countOnlyPreviewGraphemes('ASCII'), 5);
  assert.equal(characterCount.countOnlyPreviewGraphemes('中文'), 2);
  assert.equal(characterCount.countOnlyPreviewGraphemes('e\u0301'), 1);
  assert.equal(characterCount.countOnlyPreviewGraphemes('👨‍👩‍👧‍👦'), 1);
  assert.equal(characterCount.countOnlyPreviewGraphemes(' \n\t'), 3);
  assert.equal(
    characterCount.countOnlyPreviewSelectionTexts(['A', '', '中文', 'e\u0301', '👨‍👩‍👧‍👦']),
    5
  );
});

test('character count falls back to Unicode code points only without Segmenter', () => {
  assert.equal(characterCount.countOnlyPreviewGraphemes('e\u0301', null), 2);
  assert.equal(characterCount.countOnlyPreviewGraphemes('👨‍👩‍👧‍👦', null), 7);
  assert.equal(characterCount.countOnlyPreviewSelectionTexts(['界', '😀'], null), 2);
});

test('DOM selection counts only when both endpoints remain inside the preview body', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><article id="preview"><span>hello 世界</span></article><p id="outside">outside</p></body></html>'
  );
  const document = dom.window.document;
  const preview = document.querySelector('#preview');
  const insideText = preview.querySelector('span').firstChild;
  const outsideText = document.querySelector('#outside').firstChild;
  const selection = dom.window.getSelection();

  const insideRange = document.createRange();
  insideRange.setStart(insideText, 0);
  insideRange.setEnd(insideText, 8);
  selection.removeAllRanges();
  selection.addRange(insideRange);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 8);

  const outsideRange = document.createRange();
  outsideRange.setStart(insideText, 0);
  outsideRange.setEnd(outsideText, 3);
  selection.removeAllRanges();
  selection.addRange(outsideRange);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 0);

  selection.collapse(insideText, 2);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 0);
});

test('character-count gates reject deferred old reports until the current source is ready', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(sourceGate.beginTransition('revision-a'), true);
  assert.equal(hostGate.beginTransition('revision-a'), true);
  assert.equal(sourceGate.arm('revision-a'), true);
  assert.equal(hostGate.acceptReady('revision-a'), true);
  assert.equal(hostGate.resume('revision-a'), true);
  assert.equal(sourceGate.canReport('revision-a', 7), true);
  assert.equal(hostGate.canAcceptCount(7), true);

  assert.equal(hostGate.beginTransition('revision-b'), true);
  assert.equal(hostGate.canAcceptCount(0), true, 'old zero may clear but never arms');
  assert.equal(hostGate.canAcceptCount(7), false, 'old nonzero is blocked during restore');
  assert.equal(sourceGate.beginTransition('revision-b'), true);
  assert.equal(sourceGate.canReport('revision-a', 7), false);
  assert.equal(sourceGate.canReport('revision-a', 0), false);

  assert.equal(sourceGate.arm('revision-b'), true);
  assert.equal(hostGate.acceptReady('revision-b'), true);
  assert.equal(hostGate.canAcceptCount(9), false, 'ready waits for Shell restore completion');
  assert.equal(hostGate.canBufferCount(9), true, 'first current selection can wait for Shell');
  assert.equal(hostGate.resume('revision-b'), true);
  assert.equal(sourceGate.canReport('revision-b', 9), true);
  assert.equal(hostGate.canAcceptCount(9), true);
});

test('opaque revisions reject rapid stale readiness and resynchronize either renderer', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('revision-b'), true);
  assert.equal(sourceGate.beginTransition('revision-b'), true);
  assert.equal(hostGate.beginTransition('revision-c'), true);
  assert.equal(sourceGate.beginTransition('revision-c'), true);
  assert.equal(sourceGate.arm('revision-b'), false);
  assert.equal(hostGate.acceptReady('revision-b'), false);
  assert.equal(hostGate.resume('revision-b'), false);
  assert.equal(sourceGate.arm('revision-c'), true);
  assert.equal(hostGate.acceptReady('revision-c'), true);
  assert.equal(hostGate.resume('revision-c'), true);
  assert.equal(hostGate.canAcceptCount(12), true);

  const reloadedSource = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  assert.equal(hostGate.isSuspended(), false);
  assert.equal(
    hostGate.beginTransition('revision-d'),
    true,
    'a live host rotates on Preview reload'
  );
  assert.equal(hostGate.resume('revision-d'), true);
  assert.equal(reloadedSource.beginTransition(hostGate.revisionForSync()), true);
  assert.equal(reloadedSource.arm('revision-d'), true);
  assert.equal(hostGate.acceptReady('revision-d'), true);

  const reloadedHost = new characterCountGate.OnlyPreviewCharacterCountHostGate();
  assert.equal(reloadedHost.beginTransition('revision-e'), true);
  assert.equal(reloadedSource.beginTransition('revision-e'), true);
  assert.equal(reloadedSource.arm('revision-e'), true);
  assert.equal(reloadedHost.acceptReady('revision-e'), true);
  assert.equal(reloadedHost.resume('revision-e'), true);
  assert.equal(reloadedHost.canAcceptCount(4), true);
});

test('a local pending revision invalidates an older selection restore before Main responds', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('event-b'), true);
  assert.equal(sourceGate.beginTransition('event-b'), true);
  assert.equal(sourceGate.arm('event-b'), true);
  assert.equal(hostGate.acceptReady('event-b'), true);

  assert.equal(
    hostGate.beginTransition('pending-c'),
    true,
    'local C click rotates without broadcast'
  );
  assert.equal(hostGate.resume('event-b'), false, 'B finally cannot re-arm after the C click');
  assert.equal(hostGate.acceptReady('event-b'), false);
  assert.equal(hostGate.canAcceptCount(8), false);
  assert.equal(sourceGate.canReport('event-b', 8), true, 'Preview remains B until Main confirms C');

  assert.equal(hostGate.beginTransition('event-c'), true);
  assert.equal(sourceGate.beginTransition('event-c'), true);
  assert.equal(sourceGate.arm('event-c'), true);
  assert.equal(hostGate.acceptReady('event-c'), true);
  assert.equal(hostGate.resume('event-c'), true);
  assert.equal(hostGate.canAcceptCount(11), true);

  assert.equal(hostGate.beginTransition('pending-d'), true);
  assert.equal(hostGate.resume('event-c'), false);
  assert.equal(
    hostGate.beginTransition('recovery-c'),
    true,
    'failed D gets a fresh recovery fence'
  );
  assert.equal(sourceGate.beginTransition('recovery-c'), true);
  assert.equal(sourceGate.arm('recovery-c'), true);
  assert.equal(hostGate.acceptReady('recovery-c'), true);
  assert.equal(hostGate.resume('recovery-c'), true);
});

test('a native refresh transition reloads Preview before accepting its next count', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('before-refresh'), true);
  assert.equal(sourceGate.beginTransition('before-refresh'), true);
  assert.equal(sourceGate.arm('before-refresh'), true);
  assert.equal(hostGate.acceptReady('before-refresh'), true);
  assert.equal(hostGate.resume('before-refresh'), true);

  assert.equal(hostGate.beginTransition('native-refresh'), true);
  assert.equal(hostGate.canAcceptCount(6), false);
  assert.equal(sourceGate.beginTransition('native-refresh'), true);
  assert.equal(sourceGate.canReport('before-refresh', 6), false);
  assert.equal(sourceGate.arm('native-refresh'), true);
  assert.equal(hostGate.acceptReady('native-refresh'), true);
  assert.equal(hostGate.canBufferCount(7), true);
  assert.equal(hostGate.resume('native-refresh'), true);
  assert.equal(hostGate.canAcceptCount(7), true);
});
