/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-rendering-'));

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
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const characterCount = await import(pathToFileURL(join(buildRoot, 'characterCount.mjs')).href);
const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
const markdown = await import(pathToFileURL(join(buildRoot, 'markdown.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const render = (source, sourceSize = Buffer.byteLength(source)) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return {
    dom,
    result: markdown.renderOnlyPreviewMarkdown(source, sourceSize, dom.window)
  };
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

test('Markdown refuses content above the 1 MiB source boundary', () => {
  const withinLimit = render('small', 1024 * 1024).result;
  assert.equal(withinLimit.ok, true);

  const declaredTooLarge = render('small', 1024 * 1024 + 1).result;
  assert.deepEqual(declaredTooLarge, { ok: false, reason: 'too-large' });

  const encodedTooLarge = render('界'.repeat(349_526), 1).result;
  assert.deepEqual(encodedTooLarge, { ok: false, reason: 'too-large' });
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
  assert.equal(hostGate.beginTransition('revision-d'), true, 'a live host rotates on Preview reload');
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
