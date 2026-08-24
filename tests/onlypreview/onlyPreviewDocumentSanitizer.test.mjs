/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = process.cwd();
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-document-sanitizer-'));

await build({
  entryPoints: {
    documentSanitizer: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewDocumentSanitizer.service.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const sanitizer = await import(pathToFileURL(join(buildRoot, 'documentSanitizer.cjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const createDetachedContainers = () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const body = dom.window.document.createElement('div');
  const style = dom.window.document.createElement('div');
  return { body, dom, style };
};

const assertSanitizeFailure = (run) => {
  assert.throws(run, (error) => {
    assert.ok(error instanceof sanitizer.OnlyPreviewDocumentSanitizerError);
    assert.equal(error.name, 'OnlyPreviewDocumentSanitizerError');
    assert.equal(error.code, 'DOCUMENT_SANITIZE_FAILED');
    return true;
  });
};

test('sanitizer preserves bounded Word-like structure, layout CSS, and verified embedded images', () => {
  const { body, dom, style } = createDetachedContainers();
  const imageUrl = 'blob:https://onlypreview.invalid/embedded-image';
  body.innerHTML = `
    <div class="onlypreview-docx-wrapper">
      <section class="onlypreview-docx" style="width: 612pt; min-height: 792pt; padding: 72pt;">
        <header><p><span>Header</span></p></header>
        <article>
          <p class="onlypreview-docx_heading-1"><strong>Heading</strong></p>
          <ol><li><p><span>First item</span></p></li></ol>
          <table style="border-collapse: collapse">
            <colgroup><col style="width: 50%"></colgroup>
            <tbody><tr><th>Key</th><td colspan="2" rowspan="1">Value</td></tr></tbody>
          </table>
          <p><img alt="embedded" src="${imageUrl}" style="width: 24pt; height: 24pt"></p>
        </article>
        <footer><p><em>Footer</em></p></footer>
      </section>
    </div>`;
  style.innerHTML = `
    <!-- renderer marker -->
    <style>
      .onlypreview-docx-wrapper { display: flex; flex-flow: column; align-items: center; }
      .onlypreview-docx-wrapper > section.onlypreview-docx {
        background-color: white;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        margin-bottom: 30px;
      }
      .onlypreview-docx { color: black; hyphens: auto; --onlypreview-docx-bullet: url("${imageUrl}"); }
      .onlypreview-docx { --docx-majorHAnsi-font: "Aptos"; }
      .onlypreview-docx p { margin: 0pt; min-height: 1em; }
      .onlypreview-docx_heading-1 {
        font-family: var(--docx-majorHAnsi-font);
        font-size: 18pt;
        font-weight: 700;
      }
      .onlypreview-docx .first-row td { vertical-align: top; }
      .onlypreview-docx p:before { content: "\\9"; background: var(--onlypreview-docx-bullet); }
    </style>`;

  const result = sanitizer.sanitizeOnlyPreviewDocument(body, style, new Set([imageUrl]));

  assert.equal(result.fragment.ownerDocument, dom.window.document);
  assert.notEqual(result.fragment.firstElementChild, body.firstElementChild);
  assert.equal(result.fragment.querySelectorAll('section.onlypreview-docx').length, 1);
  assert.equal(result.fragment.querySelector('header')?.textContent, 'Header');
  assert.equal(result.fragment.querySelector('ol li')?.textContent, 'First item');
  assert.equal(result.fragment.querySelector('table td')?.getAttribute('colspan'), '2');
  assert.equal(result.fragment.querySelector('footer')?.textContent, 'Footer');
  assert.equal(result.fragment.querySelector('img')?.getAttribute('src'), imageUrl);
  assert.match(result.cssText, /\.onlypreview-docx-wrapper/);
  assert.match(result.cssText, /--onlypreview-docx-bullet:\s*url\("blob:/);
  assert.match(
    result.cssText,
    /font-family:\s*"Aptos", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;/
  );
  assert.doesNotMatch(result.cssText, /font-family:\s*var\(/);
  assert.doesNotMatch(result.cssText, /@import|https?:\/\/(?!onlypreview\.invalid)/i);
  assert.deepEqual([...result.usedBlobUrls], [imageUrl]);
  assert.equal(result.hasRenderableContent, true);

  body.querySelector('span').textContent = 'mutated input';
  assert.equal(result.fragment.querySelector('header')?.textContent, 'Header');
});

test('sanitizer flattens docx-preview exact not-print media rules without retaining an at-rule', () => {
  const { body, style } = createDetachedContainers();
  body.innerHTML = '<section class="onlypreview-docx"><p>Printable body</p></section>';
  style.innerHTML = `<style>
    .onlypreview-docx { color: black; }
    @media not print {
      .onlypreview-docx { min-height: 792pt; background-color: white; }
    }
  </style>`;

  const result = sanitizer.sanitizeOnlyPreviewDocument(body, style, new Set());

  assert.match(result.cssText, /min-height:\s*792pt/);
  assert.match(result.cssText, /background-color:\s*white/);
  assert.doesNotMatch(result.cssText, /@media/i);
});

test('sanitizer degrades ordinary hyperlinks to inert spans while preserving their text', () => {
  const { body, style } = createDetachedContainers();
  body.innerHTML = `<section class="onlypreview-docx"><p>
    Before <span id="bookmark-target">bookmark text</span>
    <a class="onlypreview-docx-link" href="https://example.com/path">linked text</a> after
  </p></section>`;

  const result = sanitizer.sanitizeOnlyPreviewDocument(body, style, new Set());
  const host = body.ownerDocument.createElement('div');
  host.append(result.fragment);

  assert.match(host.textContent, /Before bookmark text\s+linked text after/);
  assert.equal(host.querySelector('a'), null);
  assert.equal(host.querySelector('[href]'), null);
  assert.equal(host.querySelector('[id]'), null);
  assert.equal(host.querySelector('span.onlypreview-docx-link')?.textContent, 'linked text');
  assert.doesNotMatch(host.innerHTML, /https?:\/\//i);
});

test('sanitizer rejects every active or navigational element with one typed failure', () => {
  for (const tagName of [
    'script',
    'iframe',
    'frame',
    'object',
    'embed',
    'link',
    'meta',
    'form',
    'nav',
    'button',
    'input'
  ]) {
    const { body, style } = createDetachedContainers();
    const element = body.ownerDocument.createElement(tagName);
    element.textContent = 'hostile';
    body.append(element);
    assertSanitizeFailure(() => sanitizer.sanitizeOnlyPreviewDocument(body, style, new Set()));
  }
});

test('sanitizer rejects event, href, srcset, unknown attributes, and every unverified resource URL', () => {
  const cases = [
    ['<p onclick="alert(1)">event</p>', new Set()],
    ['<a href="https://example.com" onclick="alert(1)">event link</a>', new Set()],
    ['<p data-owned="yes">unknown</p>', new Set()],
    ['<img href="blob:https://onlypreview.invalid/a">', new Set()],
    ['<img srcset="blob:https://onlypreview.invalid/a 1x">', new Set()],
    ['<img src="https://example.com/remote.png">', new Set()],
    ['<img src="file:///tmp/private.png">', new Set()],
    ['<img src="custom://renderer/private.png">', new Set()],
    ['<img src="data:image/png;base64,AA==">', new Set()],
    ['<img src="blob:https://onlypreview.invalid/unverified">', new Set()]
  ];

  for (const [html, verified] of cases) {
    const { body, style } = createDetachedContainers();
    body.innerHTML = html;
    assertSanitizeFailure(() => sanitizer.sanitizeOnlyPreviewDocument(body, style, verified));
  }
});

test('sanitizer rejects unsafe, escaped, imported, unknown, or incompletely parsed CSS', () => {
  const unsafeCss = [
    '@import url("https://example.com/remote.css");',
    '@media screen { .onlypreview-docx { color: red; } }',
    '@media not print { @media not print { .onlypreview-docx { color: red; } } }',
    '.onlypreview-docx { background-image: url("https://example.com/remote.png"); }',
    '.onlypreview-docx { background-image: url("file:///tmp/private.png"); }',
    '.onlypreview-docx { background-image: url("custom://renderer/private.png"); }',
    '.onlypreview-docx { background-image: url("data:image/png;base64,AA=="); }',
    '.onlypreview-docx { background-image: url("blob:https://onlypreview.invalid/unverified"); }',
    '.onlypreview-docx { background: u/**/rl("blob:https://onlypreview.invalid/a"); }',
    '.onlypreview-docx { b\\61ckground: red; }',
    '.onlypreview-docx { behavior: url("blob:https://onlypreview.invalid/a"); }',
    '.onlypreview-docx { color: expression(alert(1)); }',
    '.onlypreview-docx:before { content: "blob:https://onlypreview.invalid/unverified"; }',
    '.onlypreview-docx:before { content: "custom://renderer/private"; }',
    '.onlypreview-docx { made-up-layout: 1; }',
    'body { color: red; }',
    '.onlypreview-docx { color: red; broken }'
  ];

  for (const cssText of unsafeCss) {
    const { body, style } = createDetachedContainers();
    body.innerHTML = '<section class="onlypreview-docx"><p>safe body</p></section>';
    const styleElement = body.ownerDocument.createElement('style');
    styleElement.textContent = cssText;
    style.append(styleElement);
    assertSanitizeFailure(() =>
      sanitizer.sanitizeOnlyPreviewDocument(
        body,
        style,
        new Set(['blob:https://onlypreview.invalid/a'])
      )
    );
  }
});

test('collect scans DOM attributes, inline styles, and style text for every blob reference', () => {
  const { body, style } = createDetachedContainers();
  const imageUrl = 'blob:https://onlypreview.invalid/image';
  const inlineUrl = 'blob:https://onlypreview.invalid/inline';
  const stylesheetUrl = 'blob:https://onlypreview.invalid/stylesheet';
  body.innerHTML = `
    <section class="onlypreview-docx">
      <img src="${imageUrl}">
      <p style="background-image: url('${inlineUrl}')">item</p>
    </section>`;
  style.innerHTML = `<style>
    .onlypreview-docx { --onlypreview-docx-bullet: url("${stylesheetUrl}"); }
  </style>`;

  assert.deepEqual(
    [...sanitizer.collectOnlyPreviewDocumentBlobUrls(body, style)].sort(),
    [imageUrl, inlineUrl, stylesheetUrl].sort()
  );
});

test('collect refuses non-blob resources and sanitizer reports an empty document truthfully', () => {
  const { body, style } = createDetachedContainers();
  body.innerHTML = '<section class="onlypreview-docx"><p>   </p></section>';
  const result = sanitizer.sanitizeOnlyPreviewDocument(body, style, new Set());
  assert.equal(result.hasRenderableContent, false);

  body.innerHTML = '<img src="https://example.com/remote.png">';
  assertSanitizeFailure(() => sanitizer.collectOnlyPreviewDocumentBlobUrls(body, style));
});
