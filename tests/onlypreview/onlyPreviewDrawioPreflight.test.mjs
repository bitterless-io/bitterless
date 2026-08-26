/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-drawio-preflight-'));
const bundlePath = join(buildRoot, 'drawio-preflight.mjs');

await build({
  stdin: {
    contents: `
      export * from './src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service';
      export * from './src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioWorker.contract';
    `,
    loader: 'ts',
    resolveDir: projectRoot,
    sourcefile: 'onlyPreviewDrawioPreflight.test-entry.ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const graph = (label = 'OnlyPreview') =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" parent="1" vertex="1"/></root></mxGraphModel>`;

const escapeXmlText = (source) =>
  source.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const asArrayBuffer = (value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const compressedPage = (xml) =>
  deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8'))
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');

const compressedAsciiPage = (bytes) =>
  deflateRawSync(bytes)
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');

const preflight = async (xml) => await runtime.preflightOnlyPreviewDrawio(asArrayBuffer(xml));

const expectCode = async (value, code) => {
  await assert.rejects(
    () => runtime.preflightOnlyPreviewDrawio(asArrayBuffer(value)),
    (error) => error instanceof runtime.OnlyPreviewDrawioPreflightError && error.code === code
  );
};

test('accepts direct, uncompressed, escaped, compressed, and multi-page Draw.io XML', async () => {
  assert.deepEqual(await preflight(graph()), {
    pageCount: 1,
    cellCount: 3,
    expandedBytes: Buffer.byteLength(graph())
  });

  const uncompressed = `<mxfile><diagram id="one">${graph('Page one')}</diagram><diagram id="two">${graph('Page two')}</diagram></mxfile>`;
  const uncompressedResult = await preflight(uncompressed);
  assert.equal(uncompressedResult.pageCount, 2);
  assert.equal(uncompressedResult.cellCount, 6);

  const escapedGraph = graph('A &amp; B')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
  assert.equal(
    (await preflight(`<mxfile><diagram>${escapedGraph}</diagram></mxfile>`)).cellCount,
    3
  );

  const compressed = `<mxfile compressed="true"><diagram>${compressedPage(
    graph('Compressed')
  )}</diagram></mxfile>`;
  const compressedResult = await preflight(compressed);
  assert.equal(compressedResult.pageCount, 1);
  assert.equal(compressedResult.cellCount, 3);
});

test('admits a valid Draw.io document above the default 10 MiB file policy', async () => {
  const cells = Array.from(
    { length: 18_000 },
    (_, index) => `<mxCell id="${index + 2}" value="${'x'.repeat(600)}" parent="1" vertex="1"/>`
  ).join('');
  const largeGraph = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
  const result = await preflight(largeGraph);
  assert.equal(result.pageCount, 1);
  assert.equal(result.cellCount, 18_002);
  assert.ok(result.expandedBytes > 10 * 1024 * 1024);
});

test('rejects every image-bearing graph before the viewer can decode or rasterize it', async () => {
  for (const imageGraph of [
    graph('image').replace(
      'vertex="1"',
      'style="shape=image;image=data:image/png;base64,iVBORw0KGgo=" width="999999" height="999999" vertex="1"'
    ),
    graph('external').replace(
      'vertex="1"',
      'style="shape=image;image=https://example.invalid/hostile.png" vertex="1"'
    ),
    graph('shape-source').replace(
      'vertex="1"',
      'shape="image" source="https://example.invalid/hostile.png" vertex="1"'
    ),
    graph('svg').replace(
      'vertex="1"',
      'value="&lt;svg width=&quot;999999&quot; height=&quot;999999&quot;&gt;&lt;/svg&gt;" vertex="1"'
    ),
    graph('text-resource').replace(
      '</root>',
      '<UserObject><resource>data:image/png;base64,iVBORw0KGgo=</resource></UserObject></root>'
    ),
    `<mxGraphModel><root><mxCell id="0"/><mxImage src="blob:hostile"/></root></mxGraphModel>`
  ]) {
    await expectCode(imageGraph, 'DIAGRAM_LIMIT');
    await expectCode(
      `<mxfile><diagram>${compressedPage(imageGraph)}</diagram></mxfile>`,
      'DIAGRAM_LIMIT'
    );
  }
});

test('rejects entity-canonicalized image semantics in direct, escaped, and compressed pages', async () => {
  const encodedStyles = [
    'shape&#61;image&#59;image&#61;data&#58;image/png&#59;base64,AAAA',
    [
      '&#00115;',
      '&#x00068;',
      '&#00097;',
      '&#X00070;',
      '&#00101;',
      '&#x0003D;',
      '&#00105;',
      '&#x006d;',
      '&#00097;',
      '&#x00067;',
      '&#00101;',
      '&#X00003B;',
      '&#x00069;',
      '&#00109;',
      '&#X00061;',
      '&#00103;',
      '&#x00065;',
      '&#00061;',
      '&#00100;',
      '&#x00061;',
      '&#00116;',
      '&#X00061;',
      '&#x0003A;',
      '&#00105;',
      '&#x006D;',
      '&#00097;',
      '&#00103;',
      '&#x00065;',
      '&#X0002F;png',
      '&#x003B;base64&#00044;AAAA'
    ].join('')
  ];
  for (const style of encodedStyles) {
    const imageGraph = graph('entity-image').replace('vertex="1"', `style="${style}" vertex="1"`);
    for (const page of [
      imageGraph,
      `<mxfile><diagram>${escapeXmlText(imageGraph)}</diagram></mxfile>`,
      `<mxfile><diagram>${compressedPage(imageGraph)}</diagram></mxfile>`
    ]) {
      await expectCode(page, 'DIAGRAM_LIMIT');
    }
  }
});

test('rejects empty, invalid UTF-8, declarations, malformed roots, and compressed payload errors', async () => {
  await expectCode(Buffer.alloc(0), 'DIAGRAM_EMPTY');
  await expectCode(Buffer.from([0xff, 0xfe, 0xfd]), 'DIAGRAM_PARSE_FAILED');
  await expectCode(
    `<!DOCTYPE mxfile [<!ENTITY x "boom">]><mxfile><diagram>${graph('&x;')}</diagram></mxfile>`,
    'DIAGRAM_PARSE_FAILED'
  );
  await expectCode('<html></html>', 'DIAGRAM_PARSE_FAILED');
  await expectCode(
    graph('unknown').replace('vertex="1"', 'value="&unknown;" vertex="1"'),
    'DIAGRAM_PARSE_FAILED'
  );
  await expectCode(
    graph('surrogate').replace('vertex="1"', 'value="&#xD800;" vertex="1"'),
    'DIAGRAM_PARSE_FAILED'
  );
  await expectCode('<mxfile><diagram>not-base64!</diagram></mxfile>', 'DIAGRAM_PARSE_FAILED');
  await expectCode('<mxfile><diagram></diagram></mxfile>', 'DIAGRAM_EMPTY');
});

test('rejects compressed expansion beyond 32 MiB without assembling an inflated page', async () => {
  const expanded = Buffer.concat([
    Buffer.from('<mxGraphModel><root>', 'ascii'),
    Buffer.alloc(runtime.ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES, 0x78),
    Buffer.from('<mxCell id="0"/></root></mxGraphModel>', 'ascii')
  ]);
  await expectCode(
    `<mxfile><diagram>${compressedAsciiPage(expanded)}</diagram></mxfile>`,
    'DIAGRAM_LIMIT'
  );
});

test('enforces page and complete cell-model structural caps without partial success', async () => {
  const pages = Array.from(
    { length: runtime.ONLY_PREVIEW_DRAWIO_MAX_PAGES + 1 },
    (_, index) => `<diagram id="p${index}">${graph()}</diagram>`
  ).join('');
  await expectCode(`<mxfile>${pages}</mxfile>`, 'DIAGRAM_LIMIT');

  const cells = Array.from(
    { length: runtime.ONLY_PREVIEW_DRAWIO_MAX_CELLS + 1 },
    (_, index) => `<mxCell id="${index}"/>`
  ).join('');
  await expectCode(`<mxGraphModel><root>${cells}</root></mxGraphModel>`, 'DIAGRAM_LIMIT');
});
