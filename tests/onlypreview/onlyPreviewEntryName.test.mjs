/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-entry-name-'));
const bundlePath = join(buildRoot, 'entryName.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/shared/onlypreview/onlyPreviewEntryName.shared.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const {
  ONLY_PREVIEW_ENTRY_NAME_MAX_BYTES,
  ONLY_PREVIEW_ENTRY_NAME_MAX_UTF16,
  ONLY_PREVIEW_UNTITLED_FOLDER_BASE,
  onlyPreviewUntitledFolderName,
  validateOnlyPreviewEntryName
} = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const reject = (value) => {
  const result = validateOnlyPreviewEntryName(value);
  assert.equal(result.ok, false, `${JSON.stringify(value)} should be rejected`);
  return result.reason;
};

const accept = (value) => {
  const result = validateOnlyPreviewEntryName(value);
  assert.equal(result.ok, true, `${JSON.stringify(value)} should be accepted`);
  return result.name;
};

test('ordinary names are accepted and trimmed', () => {
  assert.equal(accept('docs'), 'docs');
  assert.equal(accept('  spaced out  '), 'spaced out');
  assert.equal(accept('归档 2026'), '归档 2026');
  assert.equal(accept('.hidden'), '.hidden');
  assert.equal(accept('release-v1.2.3'), 'release-v1.2.3');
});

test('empty, whitespace-only, and relative components are rejected', () => {
  assert.equal(reject(''), 'empty');
  assert.equal(reject('   '), 'empty');
  assert.equal(reject(undefined), 'empty');
  assert.equal(reject(42), 'empty');
  assert.equal(reject('.'), 'dot');
  assert.equal(reject('..'), 'dot');
});

test('Windows reserved characters are rejected on every platform', () => {
  for (const character of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
    assert.equal(reject(`na${character}me`), 'reserved-character', `${character} must be rejected`);
  }
});

test('control characters are rejected', () => {
  assert.equal(reject('na\u0000me'), 'control-character');
  assert.equal(reject('na\u001fme'), 'control-character');
  assert.equal(reject('na\u007fme'), 'control-character');
  // A newline is a control character, not merely surrounding whitespace to trim.
  assert.equal(reject('two\nlines'), 'control-character');
});

test('a trailing dot is rejected because Windows silently strips it', () => {
  assert.equal(reject('folder.'), 'trailing-dot');
  assert.equal(reject('folder..'), 'trailing-dot');
  assert.equal(accept('folder.name'), 'folder.name');
});

test('Windows device names are rejected with or without an extension', () => {
  for (const value of ['CON', 'con', 'NUL', 'nul.txt', 'COM1', 'lpt9.log', 'AUX', 'PRN']) {
    assert.equal(reject(value), 'device-name', `${value} must be rejected`);
  }
  // Only the exact device stem is reserved.
  assert.equal(accept('CONSOLE'), 'CONSOLE');
  assert.equal(accept('COM10'), 'COM10');
  assert.equal(accept('nullable'), 'nullable');
});

test('both per-component length bounds apply', () => {
  assert.equal(accept('a'.repeat(ONLY_PREVIEW_ENTRY_NAME_MAX_UTF16)).length, 255);
  assert.equal(reject('a'.repeat(ONLY_PREVIEW_ENTRY_NAME_MAX_UTF16 + 1)), 'too-long');

  // 85 three-byte characters are 255 UTF-8 bytes but only 85 UTF-16 units: the byte bound is the
  // one that must catch this, which is why macOS needs its own rule.
  assert.equal(accept('中'.repeat(85)).length, 85);
  assert.equal(reject('中'.repeat(86)), 'too-long');
  assert.equal(ONLY_PREVIEW_ENTRY_NAME_MAX_BYTES, 255);
});

test('untitled folder sequencing starts unnumbered and then counts', () => {
  assert.equal(onlyPreviewUntitledFolderName(1), ONLY_PREVIEW_UNTITLED_FOLDER_BASE);
  assert.equal(onlyPreviewUntitledFolderName(0), ONLY_PREVIEW_UNTITLED_FOLDER_BASE);
  assert.equal(onlyPreviewUntitledFolderName(2), 'untitled folder 2');
  assert.equal(onlyPreviewUntitledFolderName(3), 'untitled folder 3');
  assert.equal(onlyPreviewUntitledFolderName(12), 'untitled folder 12');
  // Every generated name must itself satisfy the rules it will be created under.
  for (const index of [1, 2, 3, 99]) {
    assert.equal(validateOnlyPreviewEntryName(onlyPreviewUntitledFolderName(index)).ok, true);
  }
});
