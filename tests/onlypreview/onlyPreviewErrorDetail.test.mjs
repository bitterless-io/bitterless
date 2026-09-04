/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-error-detail-'));
const bundlePath = join(buildRoot, 'errorDetail.mjs');
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.service.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const {
  describeOnlyPreviewErrorDetail,
  formatOnlyPreviewErrorDetail,
  isEmptyOnlyPreviewErrorDetail
} = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const AT = '2026-09-04T03:38:14.541Z';

test('a renderer bug keeps its name, message and stack', () => {
  // The case that prompted this: a ReferenceError from a bad rename read as "could not complete this
  // action" and said nothing at all.
  const error = new ReferenceError('deleteSelection is not defined');
  const detail = describeOnlyPreviewErrorDetail(error);
  assert.equal(detail.name, 'ReferenceError');
  assert.equal(detail.message, 'deleteSelection is not defined');
  assert.equal(detail.code, '');
  assert.ok(detail.stack.includes('ReferenceError'));
  const text = formatOnlyPreviewErrorDetail(detail, AT);
  assert.match(text, /^OnlyPreview error · 2026-09-04T03:38:14\.541Z$/m);
  assert.match(text, /^name: ReferenceError$/m);
  assert.match(text, /^message: deleteSelection is not defined$/m);
  assert.match(text, /^stack:$/m);
});

test('a typed contract failure keeps its code and carries no stack', () => {
  const error = Object.assign(new Error('The Project item is no longer available.'), {
    code: 'PATH_NOT_FOUND',
    name: 'OnlyPreviewContractError'
  });
  Object.setPrototypeOf(error, Error.prototype);
  const detail = describeOnlyPreviewErrorDetail(error);
  // Not an instance of the bundled class, so it takes the plain-Error branch — the point here is
  // that the formatter omits every empty field rather than printing blanks.
  const text = formatOnlyPreviewErrorDetail(
    { code: 'PATH_NOT_FOUND', name: 'OnlyPreviewContractError', message: detail.message, stack: '' },
    AT
  );
  assert.match(text, /^code: PATH_NOT_FOUND$/m);
  assert.doesNotMatch(text, /^stack:$/m);
});

test('a long message and a long stack are bounded', () => {
  const error = new Error('x'.repeat(5_000));
  error.stack = Array.from({ length: 60 }, (_unused, index) => `  at frame ${index}`).join('\n');
  const detail = describeOnlyPreviewErrorDetail(error);
  assert.ok(detail.message.length <= 2_001, 'the message is truncated with an ellipsis');
  assert.ok(detail.message.endsWith('…'));
  assert.ok(detail.stack.split('\n').length <= 12);
});

test('a thrown non-error still produces something copyable or nothing at all', () => {
  assert.equal(describeOnlyPreviewErrorDetail('boom').message, 'boom');
  assert.equal(isEmptyOnlyPreviewErrorDetail(describeOnlyPreviewErrorDetail(undefined)), true);
  assert.equal(isEmptyOnlyPreviewErrorDetail(null), true);
  assert.equal(isEmptyOnlyPreviewErrorDetail(describeOnlyPreviewErrorDetail('boom')), false);
});

test('every banner message passes through the capture', () => {
  const store = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  // One funnel, so no path can show a banner without its detail.
  assert.doesNotMatch(store, /const errorMessage = /);
  assert.match(store, /describeOnlyPreviewError\(error\)/);
  assert.match(store, /dismissError\(\)[\s\S]*onlyPreviewErrorDetail\.clear\(\)/);
  assert.ok(
    store.split(/\r?\n/).length < 800,
    'the shell store has to stay under its 800-line budget'
  );
  const detailStore = source('src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.store.ts');
  assert.match(detailStore, /navigator\.clipboard\.writeText\(text\)/);
  // A refused async clipboard still has to copy, so there is a permission-free fallback.
  assert.match(detailStore, /document\.execCommand\('copy'\)/);
});

test('the banner offers the detail only when there is one', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(app, /v-if="onlyPreviewErrorDetail\.available"/);
  assert.match(app, /name="onlypreview__copyIndexErrorDetail"/);
  assert.match(app, /onlyPreviewErrorDetail\.copy\(\)/);
  assert.match(app, /onlyPreviewI18n\.project\.copyErrorDetail/);
  const catalog = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  // Both catalogs, because the renderer owns these two strings.
  assert.equal((catalog.match(/copyErrorDetail:/g) ?? []).length, 2);
  assert.equal((catalog.match(/errorDetailCopied:/g) ?? []).length, 2);
});
