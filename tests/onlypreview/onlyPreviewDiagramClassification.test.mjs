/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-diagram-classification-'));
const bundlePath = join(buildRoot, 'classifier.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/onlyPreviewClassifier.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { classifyOnlyPreviewExtension, resolveOnlyPreviewKind, hasOnlyPreviewDiagramRoot } =
  await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const bytes = (text) => new TextEncoder().encode(text);
const MXFILE = bytes('<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net">');
const PLAIN_XML = bytes('<?xml version="1.0"?>\n<configuration><item value="1" /></configuration>');

test('every draw.io save name reaches the diagram path', () => {
  // `extname` only ever returns the last segment, so `foo.drawio.xml` used to resolve to `.xml` and
  // open as plain text in Monaco — the diagram path was never entered at all.
  assert.equal(classifyOnlyPreviewExtension('a/diagram.drawio'), 'diagram');
  assert.equal(classifyOnlyPreviewExtension('a/diagram.drawio.xml'), 'diagram');
  assert.equal(classifyOnlyPreviewExtension('a/DIAGRAM.DRAWIO.XML'), 'diagram');
});

test('an ordinary XML stays text without its bytes and is decided by them when present', () => {
  assert.equal(classifyOnlyPreviewExtension('a/config.xml'), 'text');
  assert.equal(resolveOnlyPreviewKind('a/config.xml'), 'text', 'no sample means no promotion');
  assert.equal(resolveOnlyPreviewKind('a/config.xml', PLAIN_XML), 'text');
  assert.equal(resolveOnlyPreviewKind('a/config.xml', MXFILE), 'diagram');
});

test('the sniff is the draw.io root element and nothing looser', () => {
  assert.equal(hasOnlyPreviewDiagramRoot(MXFILE), true);
  assert.equal(hasOnlyPreviewDiagramRoot(bytes('﻿<mxfile>')), true, 'a BOM is stripped');
  assert.equal(hasOnlyPreviewDiagramRoot(PLAIN_XML), false);
  // A word that merely starts the same must not match, or an unrelated schema would open as a
  // diagram and fail there instead of rendering as text.
  assert.equal(hasOnlyPreviewDiagramRoot(bytes('<mxfileset>')), false);
  assert.equal(hasOnlyPreviewDiagramRoot(bytes('')), false);
});

test('only a bare XML is sniffed, and only the head of it', () => {
  // Promoting any other text extension on content would make every large file pay for a scan.
  assert.equal(resolveOnlyPreviewKind('a/notes.md', MXFILE), 'text');
  assert.equal(resolveOnlyPreviewKind('a/script.ts', MXFILE), 'text');
  const late = bytes(`${'<!-- pad -->'.repeat(600)}<mxfile>`);
  assert.equal(hasOnlyPreviewDiagramRoot(late), false, 'the root has to be near the start');
});

test('an extension-decided kind is never overridden by the sample', () => {
  assert.equal(resolveOnlyPreviewKind('a/diagram.drawio', PLAIN_XML), 'diagram');
  assert.equal(resolveOnlyPreviewKind('a/report.pdf', MXFILE), 'pdf');
  assert.equal(resolveOnlyPreviewKind('a/photo.png', MXFILE), 'image');
});
