import assert from 'node:assert/strict';
import { join } from 'node:path';
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
      reason: 'This file type is not rendered in Bitterless. You can open it with its system app.'
    },
    {
      id: 'unsupported-image',
      extension: '.heic',
      kind: 'unsupported',
      adapterId: 'unsupported',
      unsupportedCategory: 'image-format',
      errorCode: null,
      reason:
        'This image format is recognized but has no built-in decoder. Open it with its system app.'
    },
    {
      id: 'unsupported-video',
      extension: '.mkv',
      kind: 'unsupported',
      adapterId: 'unsupported',
      unsupportedCategory: 'video-container',
      errorCode: null,
      reason:
        'This media container is recognized but has no built-in player. Open it with its system app.'
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
      adapterId: 'docx-dom',
      errorCode: 'DOCUMENT_PARSE_FAILED',
      reason: 'The document could not be parsed.'
    },
    {
      id: 'document-empty',
      extension: '.docx',
      kind: 'document',
      adapterId: 'docx-dom',
      errorCode: 'DOCUMENT_EMPTY',
      reason: 'This document has no content to preview.'
    },
    {
      id: 'document-sanitize',
      extension: '.docx',
      kind: 'document',
      adapterId: 'docx-dom',
      errorCode: 'DOCUMENT_SANITIZE_FAILED',
      reason: 'The document output did not pass the preview safety checks.'
    },
    {
      id: 'document-timeout',
      extension: '.docx',
      kind: 'document',
      adapterId: 'docx-dom',
      errorCode: 'DOCUMENT_RENDER_TIMEOUT',
      reason: 'Document preview took too long and was stopped.'
    },
    {
      id: 'sheet-parse',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'xlsx-grid',
      errorCode: 'SHEET_PARSE_FAILED',
      reason: 'The workbook could not be parsed.'
    },
    {
      id: 'sheet-empty',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'xlsx-grid',
      errorCode: 'SHEET_EMPTY',
      reason: 'This workbook has no cells to preview.'
    },
    {
      id: 'sheet-timeout',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'xlsx-grid',
      errorCode: 'SHEET_RENDER_TIMEOUT',
      reason: 'Workbook preview took too long and was stopped.'
    },
    {
      id: 'archive-limit',
      extension: '.xlsx',
      kind: 'sheet',
      adapterId: 'xlsx-grid',
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
      adapterId: 'docx-dom',
      errorCode: 'OOXML_ARCHIVE_INVALID',
      reason: 'This Office package is damaged or has an unsupported ZIP structure.'
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
    assert.doesNotMatch(
      html,
      /<button|FileActions|onlypreview__openExternally|onlypreview__reveal/u
    );
    assert.equal(store.previewMetadata?.name, `example${fixture.extension}`);
    assert.equal(store.previewMetadata?.variant, fixture.errorCode ? 'error' : 'unsupported');
    store.dispose();
  }
});
