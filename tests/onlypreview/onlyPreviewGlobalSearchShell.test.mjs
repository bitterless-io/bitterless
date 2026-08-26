import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-global-search-shell-'));
const subscriptions = new Map();
const searchCalls = [];
const previewCalls = [];
const runtime = {
  search: async (request) => {
    searchCalls.push(request);
    return await globalThis.__globalSearchResponder(request);
  },
  preview: async (request) => {
    previewCalls.push(request);
    return await globalThis.__globalPreviewResponder(request);
  },
  cancel: async () => ({ ok: true, value: undefined }),
  shutdown: async () => ({ ok: true, value: undefined })
};

globalThis.window = {
  onlyPreviewEnv: {
    hostId: 'host-global-search',
    hostToken: 'host-token-global-search-000000',
    mode: 'standalone',
    platform: 'darwin'
  }
};
globalThis.__onlyPreviewGlobalSearchRuntime = runtime;
globalThis.__onlyPreviewGlobalSearchSubscriptions = subscriptions;

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts'
    )
  ],
  outfile: join(buildRoot, 'store.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'global-search-xpc-stub',
      setup(context) {
        context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'renderer',
          namespace: 'global-search-test'
        }));
        context.onLoad(
          { filter: /^renderer$/, namespace: 'global-search-test' },
          () => ({
            contents: `
              export const createXpcRendererEmitter = () => globalThis.__onlyPreviewGlobalSearchRuntime;
              export const xpcRenderer = {
                subscribe(name, listener) {
                  globalThis.__onlyPreviewGlobalSearchSubscriptions.set(name, listener);
                }
              };
            `
          })
        );
      }
    }
  ]
});

const { onlyPreviewGlobalSearchStore: store } = await import(
  pathToFileURL(join(buildRoot, 'store.mjs')).href
);

after(() => {
  store.exit();
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__globalSearchResponder;
  delete globalThis.__globalPreviewResponder;
  delete globalThis.__onlyPreviewGlobalSearchRuntime;
  delete globalThis.__onlyPreviewGlobalSearchSubscriptions;
  delete globalThis.window;
});

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

const fileResult = (resultToken) => ({
  section: 'files',
  resultToken,
  name: 'README.md',
  relativePath: 'docs/README.md',
  parentRelativePath: 'docs',
  nodeKind: 'file',
  previewHint: 'text',
  mediaType: 'text'
});

test('terminal token replacement refetches preview and fences the revoked early preview', async () => {
  const terminal = deferred();
  const earlyPreview = deferred();
  globalThis.__globalSearchResponder = async () => await terminal.promise;
  globalThis.__globalPreviewResponder = async (request) => {
    if (request.resultToken === 'early-result-token') return await earlyPreview.promise;
    return {
      ok: true,
      value: {
        kind: 'text',
        adapter: 'markdown',
        name: 'README.md',
        text: '# authoritative',
        truncated: false
      }
    };
  };

  const context = {
    workspaceId: 'workspace-global-search',
    generation: 7,
    ready: true,
    rootName: 'bitterless',
    focusedRelativePath: 'docs',
    focusedNodeKind: 'directory',
    selectedRelativePath: ''
  };
  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.subscribe();
  store.enter();
  store.setQuery('readme');
  const dispatch = store.dispatchLatest();
  await Promise.resolve();
  const request = searchCalls.at(-1);
  assert.ok(request);

  subscriptions.get('onlypreview/search-batch')({
    params: {
      hostId: 'host-global-search',
      batch: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        requestId: request.requestId,
        files: [fileResult('early-result-token')],
        contents: []
      }
    }
  });
  await Promise.resolve();
  assert.equal(store.selectedResult.resultToken, 'early-result-token');
  assert.equal(previewCalls.at(-1).resultToken, 'early-result-token');

  terminal.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [fileResult('terminal-result-token')],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  await dispatch;
  await Promise.resolve();
  assert.equal(store.selectedResult.resultToken, 'terminal-result-token');
  assert.equal(previewCalls.at(-1).resultToken, 'terminal-result-token');
  assert.equal(store.preview.text, '# authoritative');

  earlyPreview.resolve({
    ok: true,
    value: {
      kind: 'text',
      adapter: 'plain',
      name: 'README.md',
      text: 'revoked early preview',
      truncated: false
    }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.preview.text, '# authoritative');
});

test('every fresh Global Search entry expands Files and Contents and keeps the opener origin', () => {
  store.exit();
  store.enter('chrome');
  store.setPreviewPercent(61);
  store.toggleGroup('files', false);
  store.toggleGroup('contents', false);
  assert.equal(store.filesCollapsed, true);
  assert.equal(store.contentsCollapsed, true);
  assert.equal(store.openerOrigin, 'chrome');

  store.exit();
  store.enter('vue');
  assert.equal(store.filesCollapsed, false);
  assert.equal(store.contentsCollapsed, false);
  assert.equal(store.openerOrigin, 'vue');
  assert.equal(store.previewPercent, 61);
});

test('Shell, Vue, and Chrome entries keep the first Escape for clear and the second for close', () => {
  for (const origin of ['shell', 'vue', 'chrome']) {
    store.exit();
    store.enter(origin);
    store.setQuery('needle');
    store.handleEscape();
    assert.equal(store.active, true);
    assert.equal(store.query, '');
    store.handleEscape();
    assert.equal(store.active, false);
  }
});
