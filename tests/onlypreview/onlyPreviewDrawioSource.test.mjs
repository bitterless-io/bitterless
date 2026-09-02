/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { source } from './onlyPreviewCoreTest.helper.mjs';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('pins the official local viewer and license with a remote-free iframe-free mount', () => {
  const viewerPath = 'src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js';
  const licensePath = 'src/renderer/onlypreview/preview/src/vendor/drawio/LICENSE';
  assert.equal(
    sha256(viewerPath),
    '2fabaaa3e28d5f80f943285a2ce19c22cf870857203255f1e0347ef93693a297'
  );
  assert.equal(
    sha256(licensePath),
    '43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1'
  );

  const service = source('src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts');
  assert.match(
    service,
    /new URL\('\.\/vendor\/drawio\/viewer-static\.min\.js', import\.meta\.url\)/
  );
  assert.match(service, /assetRoot[\s\S]*ownerWindow\.PROXY_URL[\s\S]*ownerWindow\.STENCIL_PATH/);
  assert.match(service, /setAttribute\([\s\S]*'data-mxgraph'/);
  assert.match(service, /toolbar: 'pages zoom layers'/);
  assert.match(service, /graphViewer\.processElements\(targetClass\)/);
  assert.doesNotMatch(service, /createElement\(['"]iframe|<iframe|innerHTML/iu);

  const component = source(
    'src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.vue'
  );
  assert.doesNotMatch(component, /iframe|webview/iu);
  assert.doesNotMatch(component, /defineEmits|emit\(/u);
  assert.match(component, /onBeforeUnmount[\s\S]*drawioPreviewStore\.dispose\(\)/);
  const controller = source(
    'src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.store.ts'
  );
  assert.match(controller, /reportSurfaceReady\(reportingRevision\)/);
  assert.match(controller, /reportSurfaceError\([\s\S]*reportingRevision/);
  assert.match(controller, /new AbortController\(\)/);
  assert.match(controller, /mountAbortController\?\.abort\(\)/);
  assert.match(controller, /signal: abortController\.signal/);

  const html = source('src/renderer/onlypreview/preview/index.html');
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /img-src[^;]*https?:/u);
  assert.doesNotMatch(html, /connect-src[^;]*https?:/u);
});

test('uses one typed size-policy dictionary with 10 MiB fallback and 20 MiB Draw.io override', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  assert.match(types, /ONLY_PREVIEW_DEFAULT_FILE_SIZE_LIMIT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(
    types,
    /ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES = \{[\s\S]*'drawio-viewer': 20 \* 1024 \* 1024/
  );
  assert.match(types, /satisfies Partial<Record<OnlyPreviewPreviewAdapterId, number \| null>>/);
  assert.match(types, /getOnlyPreviewFileSizeLimit/);
  assert.match(types, /audio: null,[\s\S]*video: null/);

  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  assert.match(classifier, /DIAGRAM_EXTENSIONS = new Set\(\['\.drawio'\]\)/);
  assert.match(classifier, /kind === 'diagram'\) return 'drawio-viewer'/);
  assert.match(classifier, /getOnlyPreviewFileSizeLimit\(adapterId\)/);
  assert.match(classifier, /if \(kind === 'diagram'\) return descriptor/);

  const adapter = source('src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts');
  assert.match(adapter, /descriptor\.kind === 'diagram'[\s\S]*adapterId: 'drawio-viewer'/);
  assert.match(adapter, /adapterId === 'drawio-viewer'/);
  const delivery = source('src/main/onlypreview/views/onlyPreviewSelectionDelivery.service.ts');
  assert.match(delivery, /adapter\.adapterId === 'drawio-viewer'[\s\S]*getOnlyPreviewFileSizeLimit/);

  const registry = source('src/shared/onlypreview/onlyPreviewFind.registry.ts');
  assert.match(registry, /'drawio-viewer': \{ surface: 'vue', find: \{ mode: 'none' \} \}/);
});

test('lazy-loads every format SFC and loads the viewer only after bounded preflight', () => {
  const surface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  for (const component of [
    'MarkdownPreview',
    'MonacoTextPreview',
    'OfficePreview',
    'DrawioPreview',
    'ImagePreview',
    'MediaPreview'
  ]) {
    assert.match(surface, new RegExp(`const ${component} = defineAsyncComponent`));
    assert.doesNotMatch(surface, new RegExp(`import ${component} from`));
  }

  const store = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(store, /this\.drawioSelection\.start/);
  assert.match(store, /this\.drawioContent = markRaw\(content\)/);
  const selection = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewDrawioSelection.store.ts'
  );
  assert.match(selection, /new OnlyPreviewDrawioSession/);
  assert.match(selection, /session\.load\(assetUrl, expectedSize\)/);

  const session = source('src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts');
  assert.match(session, /worker\.postMessage\(request, \[bytes\]\)/);
  assert.match(session, /this\.cancelPendingPreflight = \(\) =>/);
  assert.match(session, /this\.cancelPendingPreflight\?\.\(\)/);
  assert.match(session, /ONLY_PREVIEW_DRAWIO_PREFLIGHT_TIMEOUT_MS/);

  const view = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  assert.match(view, /getDiagramLoadingRevision/);
  assert.match(view, /'DIAGRAM_RENDER_TIMEOUT'/);
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  assert.match(region, /presentation\.adapterId === 'drawio-viewer'[\s\S]*destroyVuePreviewView/);
});

test('Draw.io preflight is streaming, bounded to 32 MiB, and rejects image-bearing XML', () => {
  const contract = source(
    'src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioWorker.contract.ts'
  );
  assert.match(contract, /ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES = 32 \* 1024 \* 1024/);

  const preflight = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts'
  );
  assert.match(preflight, /INPUT_CHUNK_BYTES = 64 \* 1024/);
  assert.match(preflight, /class StreamingCompressedPageScanner/);
  assert.match(preflight, /class StreamingPercentUtf8Decoder/);
  assert.match(preflight, /new DecompressionStream\('deflate-raw'\)/);
  assert.match(preflight, /const canonicalizeXmlReferences/);
  assert.match(preflight, /isXmlCharacter/);
  assert.match(preflight, /const tagHasImageContent/);
  assert.ok(preflight.includes('data:image'));
  assert.ok(preflight.includes('shape'));
  assert.doesNotMatch(
    preflight,
    /decodeURIComponent|\batob\(|\.matchAll\(|TextEncoder|chunks:\s*Uint8Array\[\]|compact\s*=|Array\.from\(|\.join\(''\)/u
  );
});

test('Draw.io remediation keeps every authored implementation and focused test below 800 lines', () => {
  for (const path of [
    'src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts',
    'src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts',
    'src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts',
    'src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts',
    'src/renderer/onlypreview/preview/src/onlyPreviewDrawioSelection.store.ts',
    'src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.store.ts',
    'src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.vue',
    'tests/onlypreview/onlyPreviewPreviewRegion.test.mjs',
    'tests/onlypreview/onlyPreviewDrawioPreviewRegion.test.mjs',
    'tests/onlypreview/onlyPreviewDrawioViewer.test.mjs'
  ]) {
    assert.ok(source(path).trimEnd().split('\n').length <= 800, `${path} exceeds 800 lines`);
  }
});
