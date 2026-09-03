/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-global-search-office-renderer-'));
const outfile = join(buildRoot, 'office-read.mjs');
const calls = { cancel: [], open: [], read: [] };

globalThis.window = {
  onlyPreviewEnv: {
    hostId: 'global-search-host',
    hostToken: 'global-search-token-000000',
    mode: 'globalSearch',
    platform: 'darwin'
  }
};
globalThis.__onlyPreviewGlobalSearchOfficeRuntime = {
  openOfficeRead: async (request) => {
    calls.open.push(request);
    return await globalThis.__onlyPreviewGlobalSearchOfficeOpen(request);
  },
  readOfficeChunk: async (request) => {
    calls.read.push(request);
    return await globalThis.__onlyPreviewGlobalSearchOfficeRead(request);
  },
  cancelOfficeRead: async (request) => {
    calls.cancel.push(request);
    return { ok: true, value: undefined };
  }
};

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchOfficeRead.service.ts'
    )
  ],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'global-search-office-xpc-stub',
      setup(context) {
        context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'renderer',
          namespace: 'global-search-office-test'
        }));
        context.onLoad(
          { filter: /^renderer$/, namespace: 'global-search-office-test' },
          () => ({
            contents: `
              export const createXpcRendererEmitter = () =>
                globalThis.__onlyPreviewGlobalSearchOfficeRuntime;
            `
          })
        );
      }
    }
  ]
});

const { OnlyPreviewGlobalSearchOfficeReadSession } = await import(pathToFileURL(outfile).href);

after(() => {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__onlyPreviewGlobalSearchOfficeOpen;
  delete globalThis.__onlyPreviewGlobalSearchOfficeRead;
  delete globalThis.__onlyPreviewGlobalSearchOfficeRuntime;
  delete globalThis.window;
});

const preview = Object.freeze({
  kind: 'office',
  adapter: 'xlsx',
  name: 'report.xlsx',
  sourceExtension: '.xlsx',
  size: 6,
  modifiedAt: 1,
  workspaceId: 'workspace-office',
  generation: 4,
  requestId: 'request-office',
  resultToken: 'result-office',
  readGrant: 'grant-office'
});

const identity = {
  workspaceId: preview.workspaceId,
  generation: preview.generation,
  requestId: preview.requestId,
  resultToken: preview.resultToken,
  readGrant: preview.readGrant
};

const resetCalls = () => {
  calls.cancel.length = 0;
  calls.open.length = 0;
  calls.read.length = 0;
};

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

test('Search Office reader assembles exact ordered frames through the Search runtime only', async () => {
  resetCalls();
  globalThis.__onlyPreviewGlobalSearchOfficeOpen = async () => ({
    ok: true,
    value: { ...identity, totalBytes: 6 }
  });
  globalThis.__onlyPreviewGlobalSearchOfficeRead = async ({ offset }) => ({
    ok: true,
    value: {
      ...identity,
      offset,
      bytes: Uint8Array.from(offset === 0 ? [1, 2, 3] : [4, 5, 6]).buffer,
      eof: offset === 3
    }
  });

  const session = new OnlyPreviewGlobalSearchOfficeReadSession(preview);
  assert.deepEqual([...new Uint8Array(await session.readBytes())], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    calls.read.map(({ offset }) => offset),
    [0, 3]
  );
  assert.equal(calls.cancel.length, 0);
  await assert.rejects(() => session.readBytes(), /single-use/);
});

test('invalid Search Office frames fail closed and revoke the read grant', async () => {
  resetCalls();
  globalThis.__onlyPreviewGlobalSearchOfficeOpen = async () => ({
    ok: true,
    value: { ...identity, totalBytes: 6 }
  });
  globalThis.__onlyPreviewGlobalSearchOfficeRead = async () => ({
    ok: true,
    value: {
      ...identity,
      offset: 1,
      bytes: Uint8Array.from([1, 2, 3]).buffer,
      eof: false
    }
  });

  const session = new OnlyPreviewGlobalSearchOfficeReadSession(preview);
  await assert.rejects(() => session.readBytes(), /frame is invalid/);
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(calls.cancel.length, 1);
  assert.deepEqual(calls.cancel[0], {
    hostToken: 'global-search-token-000000',
    ...identity
  });
});

test('unmount-style cancellation fences a late open response and does not start chunk reads', async () => {
  resetCalls();
  const open = deferred();
  globalThis.__onlyPreviewGlobalSearchOfficeOpen = async () => await open.promise;
  globalThis.__onlyPreviewGlobalSearchOfficeRead = async () =>
    assert.fail('cancelled Search Office read must not request a frame');

  const session = new OnlyPreviewGlobalSearchOfficeReadSession(preview);
  const read = session.readBytes();
  await new Promise((resolveTick) => setImmediate(resolveTick));
  await session.cancel();
  open.resolve({ ok: true, value: { ...identity, totalBytes: 6 } });
  await assert.rejects(() => read, /superseded/);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.read.length, 0);
});

test('Global Search keeps Office lazy, keyed, disposable, and separate from current-file Find', () => {
  const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');
  const host = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.vue'
  );
  const office = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/OfficeSearchPreview.vue'
  );
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const html = source('src/renderer/onlypreview/globalSearch/index.html');
  const config = source('electron.vite.config.ts');

  assert.match(host, /office: defineAsyncComponent\(\(\) => import\('\.\/OfficeSearchPreview\.vue'\)\)/);
  assert.match(host, /:key="previewComponentKey"/);
  assert.match(host, /previewRevision: onlyPreviewGlobalSearchStore\.previewComponentRevision/);
  assert.match(office, /new OnlyPreviewOfficeSession\(/);
  assert.match(office, /void readSession\.cancel\(\)[\s\S]*officeSession\.dispose\(\)/);
  assert.doesNotMatch(office, /onlyPreviewPreviewStore|onlyPreviewFindAdapterBridge|register\(/);
  assert.match(
    workspace,
    /closest\('\[name="onlypreview__globalSearchPreviewPane"\]'\)\) return;[\s\S]*ArrowDown/
  );
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(html, /worker-src 'self' blob:/);
  assert.match(config, /\['shell', 'preview', 'globalSearch', 'alert', 'settings', 'guide'\]/);
  assert.match(config, /mode === 'preview' \|\| mode === 'globalSearch'/);
});
