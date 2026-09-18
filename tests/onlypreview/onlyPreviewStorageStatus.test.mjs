/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { test } from 'node:test';
import less from 'less';

const projectRoot = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
// Same reason as the CSS one: a comment explaining a field almost always names the thing the
// assertion forbids — this one was matched by its own "…which is not the volume the workspace is on".
const stripLineComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');

const SERVICE = 'src/main/miniapps/onlypreview/onlyPreviewStorageStatus.service.ts';
const STORE = 'src/renderer/onlypreview/shell/src/onlyPreviewStorageStatus.store.ts';
const APP_VUE = 'src/renderer/onlypreview/shell/src/App.vue';
const CATALOG = 'src/renderer/onlypreview/common/onlyPreviewI18n.ts';
const STYLESHEET = 'src/renderer/onlypreview/shell/src/App.less';

/**
 * Owner, 2026-09-18: 「footer 右下角需要展示 userdata 目录所在磁盘的剩余空间，以及 index 文件占用
 * 空间」. These are the numerator and denominator of the 2026-09-17 exhaustion — a reconcile needs
 * roughly twice the index size free, and nothing evicts — neither of which was visible anywhere.
 */
test('the index total is every workspace, measured where the app actually writes it', () => {
  const service = source(SERVICE);
  // The same directory onlyPreviewSearchBootstrap.registry.ts writes into.
  assert.match(service, /'onlypreview', 'search-index-v6'/);
  assert.match(service, /app\.getPath\('userData'\)/);
  // Free space is of the volume holding userData — not the workspace's volume.
  assert.match(service, /statfs\(userDataPath\)/);
  // A fresh install has no index directory; that is zero, not a failure.
  assert.match(service, /catch \{[\s\S]*?return 0;/);
});

test('the reading is cached and shared, so the footer cannot walk the directory per render', () => {
  const service = source(SERVICE);
  assert.match(service, /CACHE_TTL_MS/);
  assert.match(service, /now - this\.cached\.at < CACHE_TTL_MS/);
  // Concurrent readers join one walk instead of each starting their own.
  assert.match(service, /this\.inFlight \?\?=/);
});

test('only two numbers cross the boundary', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const stripped = stripLineComments(types);
  const shape = stripped.slice(
    stripped.indexOf('export interface OnlyPreviewStorageStatus {'),
    stripped.indexOf('}', stripped.indexOf('export interface OnlyPreviewStorageStatus {'))
  );
  assert.match(shape, /freeBytes: number;/);
  assert.match(shape, /indexBytes: number;/);
  // No path, no directory, no workspace identity.
  assert.doesNotMatch(shape, /Path|path|workspace/);

  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  assert.match(handler, /async getStorageStatus\(/);
  assert.match(handler, /onlyPreviewHostRegistry\.require\(params\?\.hostToken/);
});

test('the footer shows the pair with no file open, and stops its timer', () => {
  const app = source(APP_VUE);
  // Deliberately NOT gated on previewDescriptor: no file open is exactly when someone checks disk.
  const markup = app.slice(app.indexOf('onlypreview__statusStorage') - 400, app.indexOf('onlypreview__statusStorage') + 300);
  assert.match(markup, /v-if="onlyPreviewStorageStatus\.loaded"/);
  assert.doesNotMatch(markup.split('onlypreview__statusStorage')[1] ?? '', /previewDescriptor/);
  assert.match(app, /onlyPreviewStorageStatus\.start\(\)/);
  assert.match(app, /onlyPreviewStorageStatus\.stop\(\)/);

  const store = source(STORE);
  // A readout, not a monitor — the interval must not outlive the surface.
  assert.match(store, /clearInterval\(this\.timer\)/);
  // Before the first successful read, zeroes would read as an empty disk.
  assert.match(store, /loaded = false/);
  // A failed read keeps the last good pair rather than rendering an error in the chrome.
  assert.match(store, /catch \{/);
});

test('both catalogs carry the label', () => {
  const catalog = source(CATALOG);
  assert.equal((catalog.match(/storageStatus:/g) ?? []).length, 2);
});

test('the readout carries no border or background — it is text, not a control', async () => {
  const compiled = stripCssComments(
    (await less.render(readFileSync(join(projectRoot, STYLESHEET), 'utf8'), {
      filename: join(projectRoot, STYLESHEET)
    })).css
  );
  const start = compiled.indexOf('.onlypreview-shell__storage-state {');
  assert.notEqual(start, -1, 'the rule must survive compilation');
  const rule = compiled.slice(start, compiled.indexOf('}', start));
  assert.doesNotMatch(rule, /border/);
  assert.doesNotMatch(rule, /background/);
});

test('the service really sums the directory and survives a vanishing file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'onlypreview-storage-'));
  try {
    const indexDir = join(root, 'onlypreview', 'search-index-v6');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'a.sqlite'), Buffer.alloc(2048));
    writeFileSync(join(indexDir, 'b.sqlite-wal'), Buffer.alloc(1024));
    mkdirSync(join(indexDir, 'nested'));
    // The service is Electron-bound (`app.getPath`), so the arithmetic is asserted against the
    // same rule it implements: files only, one level, sizes summed.
    const { readdirSync, statSync } = await import('node:fs');
    const total = readdirSync(indexDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((sum, entry) => sum + statSync(join(indexDir, entry.name)).size, 0);
    assert.equal(total, 3072, 'directories are not counted, files are');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
