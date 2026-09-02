import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  buildRoot,
  createRendererStoreHarness,
  officeDescriptor,
  officePresentation,
  previewSurfaceSource,
  render,
  renderPreviewSurface
} from './onlyPreviewRenderingTest.helper.mjs';

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

const SKILL_FRONT_MATTER = `---
name: aliyun-ops
description: >-
  Multi-account Aliyun operations from the overmind keychain.
  Deployment planning starts from the overmind \`ops/\` inventory.
user-invocable: true
---

# aliyun-ops

Body paragraph.

## Section
`;

test('YAML front matter leaves the Markdown parser instead of becoming a setext heading', () => {
  const { result } = render(SKILL_FRONT_MATTER);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The closing `---` used to underline the accumulated front-matter paragraph into one huge <h2>.
  assert.doesNotMatch(result.html, /<hr>/);
  assert.equal((result.html.match(/<h2[ >]/g) ?? []).length, 1);
  assert.match(result.html.trimStart(), /^<h1>aliyun-ops<\/h1>/);
  assert.doesNotMatch(result.html, /name: aliyun-ops/);
  assert.doesNotMatch(result.html, /Multi-account Aliyun operations/);
  assert.doesNotMatch(result.html, /user-invocable/);
});

test('BOM, CRLF, and the YAML document-end delimiter still produce body-only Markdown', () => {
  const { result } = render('\uFEFF---\r\nname: hidden\r\n...\r\n\r\n# Visible body\r\n');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.html, /<h1>Visible body<\/h1>/);
  assert.doesNotMatch(result.html, /name: hidden|<hr>/);
});

test('a leading rule without a closing delimiter stays a thematic break', () => {
  const { result } = render('---\n\nJust a document.\n');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.html, /<hr>/);
});

test('a setext underline inside the body is not mistaken for front matter', () => {
  const { result } = render('Intro paragraph.\n\nUnderlined title\n---\n\nBody.\n');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.html, /<h2>Underlined title<\/h2>/);
});

test('the Markdown component and renderer expose no front-matter presentation model', () => {
  const projectRoot = resolve(import.meta.dirname, '../..');
  const component = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue'
    ),
    'utf8'
  );
  const service = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts'),
    'utf8'
  );

  const styles = readFileSync(
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.less'
    ),
    'utf8'
  );
  const i18n = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/common/onlyPreviewI18n.ts'),
    'utf8'
  );

  assert.doesNotMatch(component, /frontMatter|frontmatter|FRONT MATTER/i);
  assert.doesNotMatch(styles, /frontMatter|frontmatter/i);
  assert.doesNotMatch(i18n, /frontMatterTitle|frontMatterTruncated/);
  assert.doesNotMatch(service, /parseYaml|stringifyYaml|OnlyPreviewMarkdownFrontMatter/);
  assert.match(service, /stripOnlyPreviewFrontMatter/);
  assert.match(service, /\| \{ ok: true; html: string \}/);
  assert.match(service, /ALLOWED_ATTR: \[\]/);
  assert.doesNotMatch(service, /ALLOWED_ATTR: \['/);
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

test('direct unsupported and typed renderer failures share one truthful metadata surface', async () => {
  const cases = [
    {
      id: 'unsupported',
      extension: '.bin',
      kind: 'unsupported',
      adapterId: 'unsupported',
      errorCode: null,
      reason: 'This file type is not rendered in Bitterless. You can open it with its default app.'
    },
    {
      id: 'unsupported-image',
      extension: '.heic',
      kind: 'unsupported',
      adapterId: 'unsupported',
      unsupportedCategory: 'image-format',
      errorCode: null,
      reason:
        'This image format is recognized but has no built-in decoder. Open it with its default app.'
    },
    {
      id: 'unsupported-video',
      extension: '.mkv',
      kind: 'unsupported',
      adapterId: 'unsupported',
      unsupportedCategory: 'video-container',
      errorCode: null,
      reason:
        'This media container is recognized but has no built-in player. Open it with its default app.'
    },
    {
      id: 'image-read',
      extension: '.png',
      kind: 'image',
      adapterId: 'image',
      errorCode: 'IMAGE_READ_FAILED',
      reason: 'The image data stream could not be read completely.'
    },
    {
      id: 'image-decode',
      extension: '.png',
      kind: 'image',
      adapterId: 'image',
      errorCode: 'IMAGE_DECODE_FAILED',
      reason: 'Chromium could not decode this image.'
    },
    {
      id: 'image-empty',
      extension: '.png',
      kind: 'image',
      adapterId: 'unsupported',
      errorCode: 'IMAGE_EMPTY',
      reason: 'This image file is empty.'
    },
    {
      id: 'media-read',
      extension: '.mp3',
      kind: 'audio',
      adapterId: 'audio',
      errorCode: 'MEDIA_READ_FAILED',
      reason: 'The media data stream could not be opened.'
    },
    {
      id: 'media-decode',
      extension: '.mp3',
      kind: 'audio',
      adapterId: 'audio',
      errorCode: 'MEDIA_DECODE_FAILED',
      reason: 'Chromium could not decode this media stream.'
    },
    {
      id: 'media-source',
      extension: '.mp4',
      kind: 'video',
      adapterId: 'video',
      errorCode: 'MEDIA_SOURCE_UNSUPPORTED',
      reason: 'Chromium does not support this media source or codec.'
    },
    {
      id: 'media-empty',
      extension: '.mp4',
      kind: 'video',
      adapterId: 'unsupported',
      errorCode: 'MEDIA_EMPTY',
      reason: 'This media file is empty.'
    },
    {
      id: 'document-parse',
      extension: '.docx',
      kind: 'document',
      adapterId: 'ooxml-docx',
      errorCode: 'DOCUMENT_PARSE_FAILED',
      reason: 'The document could not be parsed.'
    },
    {
      id: 'document-empty',
      extension: '.docx',
      kind: 'document',
      adapterId: 'ooxml-docx',
      errorCode: 'DOCUMENT_EMPTY',
      reason: 'This document has no content to preview.'
    },
    {
      id: 'document-sanitize',
      extension: '.docx',
      kind: 'document',
      adapterId: 'ooxml-docx',
      errorCode: 'DOCUMENT_SANITIZE_FAILED',
      reason: 'The document output did not pass the preview safety checks.'
    },
    {
      id: 'document-timeout',
      extension: '.docx',
      kind: 'document',
      adapterId: 'ooxml-docx',
      errorCode: 'DOCUMENT_RENDER_TIMEOUT',
      reason: 'Document preview took too long and was stopped.'
    },
    {
      id: 'sheet-parse',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'ooxml-xlsx',
      errorCode: 'SHEET_PARSE_FAILED',
      reason: 'The workbook could not be parsed.'
    },
    {
      id: 'sheet-empty',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'ooxml-xlsx',
      errorCode: 'SHEET_EMPTY',
      reason: 'This workbook has no cells to preview.'
    },
    {
      id: 'sheet-timeout',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'ooxml-xlsx',
      errorCode: 'SHEET_RENDER_TIMEOUT',
      reason: 'Workbook preview took too long and was stopped.'
    },
    {
      id: 'archive-limit',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'ooxml-xlsx',
      errorCode: 'OOXML_ARCHIVE_LIMIT',
      reason: 'This Office file expands beyond the safe preview limits.'
    },
    {
      id: 'archive-encrypted',
      extension: '.docx',
      kind: 'document',
      adapterId: 'unsupported',
      errorCode: 'OOXML_ENCRYPTED',
      reason: 'Encrypted Office files cannot be previewed.'
    },
    {
      id: 'archive-invalid',
      extension: '.docx',
      kind: 'document',
      adapterId: 'ooxml-docx',
      errorCode: 'OOXML_ARCHIVE_INVALID',
      reason: 'This Office package is damaged or has an unsupported ZIP structure.'
    },
    {
      id: 'presentation-parse',
      extension: '.pptx',
      kind: 'presentation',
      adapterId: 'ooxml-pptx',
      errorCode: 'PRESENTATION_PARSE_FAILED',
      reason: 'The presentation could not be parsed.'
    },
    {
      id: 'presentation-empty',
      extension: '.pptx',
      kind: 'presentation',
      adapterId: 'ooxml-pptx',
      errorCode: 'PRESENTATION_EMPTY',
      reason: 'The presentation has no slides to preview.'
    },
    {
      id: 'presentation-timeout',
      extension: '.pptx',
      kind: 'presentation',
      adapterId: 'ooxml-pptx',
      errorCode: 'PRESENTATION_RENDER_TIMEOUT',
      reason: 'Presentation preview took too long and was stopped.'
    },
    {
      id: 'signature',
      extension: '.png',
      kind: 'image',
      adapterId: 'unsupported',
      errorCode: 'SIGNATURE_MISMATCH',
      reason: 'The file contents do not match its extension.'
    },
    {
      id: 'size',
      extension: '.md',
      kind: 'text',
      adapterId: 'unsupported',
      errorCode: 'TEXT_TOO_LARGE',
      reason: 'This file is larger than its preview limit.'
    },
    {
      id: 'unsupported-codec',
      extension: '.mp4',
      kind: 'video',
      adapterId: 'unsupported',
      errorCode: 'OPERATION_FAILED',
      reason: 'OnlyPreview could not complete this action.'
    }
  ];

  for (const [index, fixture] of cases.entries()) {
    const descriptor = {
      ...officeDescriptor(fixture.extension, fixture.kind),
      ...(fixture.unsupportedCategory ? { unsupportedCategory: fixture.unsupportedCategory } : {})
    };
    const presentation = {
      ...officePresentation(descriptor, 800 + index, fixture.adapterId),
      ...(fixture.errorCode
        ? {
            status: 'unavailable',
            error: { code: fixture.errorCode, message: 'Main detail is not renderer copy.' }
          }
        : {})
    };
    const harness = createRendererStoreHarness(presentation);
    globalThis.__onlyPreviewRendererStoreHarness = harness;
    const runtime = await import(
      `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?metadata=${fixture.id}`
    );
    const store = runtime.onlyPreviewPreviewStore;

    await store.initialize();
    const html = await renderPreviewSurface(store);

    assert.equal((html.match(/name="onlypreview__previewMetadata"/gu) ?? []).length, 1, fixture.id);
    assert.match(html, new RegExp(`example${fixture.extension.replace('.', '\\.')}`, 'u'));
    assert.match(html, new RegExp(fixture.extension.slice(1).toUpperCase(), 'u'));
    assert.match(html, /4096 bytes/u);
    assert.match(html, /date:1700000000000/u);
    assert.match(html, new RegExp(fixture.reason.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.equal(
      (html.match(/name="onlypreview__previewOpenExternally"/gu) ?? []).length,
      1,
      fixture.id
    );
    assert.equal((html.match(/<button/gu) ?? []).length, 1, fixture.id);
    assert.match(html, /Open in default app/u);
    assert.doesNotMatch(html, /FileActions|onlypreview__reveal|\/Users\//u);
    assert.equal(store.previewMetadata?.name, `example${fixture.extension}`);
    assert.equal(store.previewMetadata?.variant, fixture.errorCode ? 'error' : 'unsupported');
    store.dispose();
  }
});

test('metadata recovery opens exactly the current capability-scoped file reference', async () => {
  const descriptor = officeDescriptor('.bin', 'unsupported');
  const presentation = officePresentation(descriptor, 1_001, 'unsupported');
  const harness = createRendererStoreHarness(presentation);
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const runtime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?open-externally=exact-ref`
  );
  const store = runtime.onlyPreviewPreviewStore;

  await store.initialize();
  await store.openExternally();

  assert.deepEqual(harness.openExternally, [
    {
      hostToken: 'host-token-for-tests',
      workspaceId: descriptor.workspaceId,
      relativePath: descriptor.relativePath
    }
  ]);
  assert.equal(Object.keys(harness.openExternally[0]).length, 3);
  assert.equal(store.openingExternally, false);
  assert.equal(store.openExternallyError, '');

  harness.openExternallyResult = {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Main process detail must remain private.' }
  };
  await store.openExternally();
  assert.equal(store.openExternallyError, 'Could not open this file in its default app.');
  const html = await renderPreviewSurface(store);
  assert.match(html, /name="onlypreview__previewOpenExternallyError"/u);
  assert.match(html, /Could not open this file in its default app\./u);
  assert.doesNotMatch(html, /Main process detail must remain private/u);
  store.dispose();
});

test('metadata recovery prevents duplicate opens and fences a late failure after selection change', async () => {
  const descriptorA = officeDescriptor('.bin', 'unsupported');
  const presentationA = officePresentation(descriptorA, 1_101, 'unsupported');
  const harness = createRendererStoreHarness(presentationA);
  let settleOpen;
  harness.openExternallyPromise = new Promise((resolve) => {
    settleOpen = resolve;
  });
  globalThis.__onlyPreviewRendererStoreHarness = harness;
  const runtime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?open-externally=selection-fence`
  );
  const store = runtime.onlyPreviewPreviewStore;

  await store.initialize();
  const firstOpen = store.openExternally();
  await store.openExternally();
  assert.equal(harness.openExternally.length, 1);
  assert.equal(store.openingExternally, true);

  const descriptorB = {
    ...officeDescriptor('.dat', 'unsupported'),
    relativePath: 'fixtures/second.dat',
    name: 'second.dat'
  };
  harness.presentation = officePresentation(descriptorB, 1_102, 'unsupported');
  harness.subscriptions.get('onlypreview/previewPresentation')?.({
    params: { hostId: 'host-for-tests' }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(store.currentRef, {
    workspaceId: descriptorB.workspaceId,
    relativePath: descriptorB.relativePath
  });
  assert.equal(store.openingExternally, false);
  assert.equal(store.openExternallyError, '');

  settleOpen({
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Late failure for the previous file.' }
  });
  await firstOpen;
  assert.equal(store.openExternallyError, '');
  assert.equal(store.openingExternally, false);
  store.dispose();
});

test('non-file generic errors and ordinary preview states do not render the recovery action', async () => {
  const genericPresentation = officePresentation(
    officeDescriptor('.bin', 'unsupported'),
    1_201,
    'unsupported'
  );
  const genericHarness = createRendererStoreHarness(genericPresentation);
  genericHarness.presentationResult = {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Presentation lookup failed.' }
  };
  globalThis.__onlyPreviewRendererStoreHarness = genericHarness;
  const genericRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?open-externally=generic-error`
  );
  const genericStore = genericRuntime.onlyPreviewPreviewStore;
  await genericStore.initialize();
  const genericHtml = await renderPreviewSurface(genericStore);
  assert.match(genericHtml, /name="onlypreview__previewError"/u);
  assert.doesNotMatch(genericHtml, /onlypreview__previewOpenExternally/u);
  genericStore.dispose();

  const readyDescriptor = {
    ...officeDescriptor('.png', 'image'),
    assetUrl: 'onlypreview-file://host-for-tests/asset.png'
  };
  const readyHarness = createRendererStoreHarness(
    officePresentation(readyDescriptor, 1_202, 'image')
  );
  globalThis.__onlyPreviewRendererStoreHarness = readyHarness;
  const readyRuntime = await import(
    `${pathToFileURL(join(buildRoot, 'previewStore.mjs')).href}?open-externally=ready-preview`
  );
  const readyStore = readyRuntime.onlyPreviewPreviewStore;
  await readyStore.initialize();
  const readyHtml = await renderPreviewSurface(readyStore);
  assert.match(readyHtml, /name="onlypreview__imagePreview"/u);
  assert.doesNotMatch(readyHtml, /onlypreview__previewOpenExternally/u);
  readyStore.dispose();
});
