/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-search-shell-'));
export const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

globalThis.window = {
  onlyPreviewEnv: {
    hostId: 'host-search-shell',
    hostToken: 'host-token-search-shell-000000000000',
    mode: 'standalone',
    platform: 'darwin'
  }
};

export const searchCalls = [];
export const cancelCalls = [];
export const shutdownCalls = [];
export const rendererSubscriptions = new Map();
export const searchResponderState = {
  current: async () => {
    throw new Error('Search responder was not configured.');
  }
};

globalThis.__onlyPreviewSearchRuntime = {
  initialize: async () => {
    throw new Error('Unexpected initialize call.');
  },
  refresh: async () => {
    throw new Error('Unexpected refresh call.');
  },
  search: async (request) => {
    searchCalls.push(request);
    return searchResponderState.current(request);
  },
  cancel: async (request) => {
    cancelCalls.push(request);
    return { ok: true, value: undefined };
  },
  shutdown: async (request) => {
    shutdownCalls.push(request);
    return { ok: true, value: undefined };
  }
};
globalThis.__onlyPreviewRendererSubscriptions = rendererSubscriptions;

await build({
  entryPoints: {
    highlight: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/onlyPreviewSearchHighlight.service.ts'
    ),
    projectSearchStore: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts'
    ),
    snapshot: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewSearchSnapshot.service.ts'
    ),
    progress: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewSearchProgress.service.ts'
    ),
    browseListing: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewBrowseListing.service.ts'
    ),
    tree: join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts'),
    characterCountGate: join(
      projectRoot,
      'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'onlypreview-search-xpc-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'electron-xpc-renderer',
          namespace: 'onlypreview-test'
        }));
        buildContext.onLoad(
          { filter: /^electron-xpc-renderer$/, namespace: 'onlypreview-test' },
          () => ({
            contents: `export const createXpcRendererEmitter = () => globalThis.__onlyPreviewSearchRuntime;
               export const xpcRenderer = {
                 subscribe(eventName, listener) {
                   globalThis.__onlyPreviewRendererSubscriptions.set(eventName, listener);
                 },
                 broadcast() {}
               };`
          })
        );
      }
    }
  ]
});

export const highlight = await import(pathToFileURL(join(buildRoot, 'highlight.mjs')).href);
export const projectSearchModule = await import(
  pathToFileURL(join(buildRoot, 'projectSearchStore.mjs')).href
);
export const snapshot = await import(pathToFileURL(join(buildRoot, 'snapshot.mjs')).href);
export const progress = await import(pathToFileURL(join(buildRoot, 'progress.mjs')).href);
export const browseListing = await import(pathToFileURL(join(buildRoot, 'browseListing.mjs')).href);
export const tree = await import(pathToFileURL(join(buildRoot, 'tree.mjs')).href);
export const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
export const projectSearchStore = projectSearchModule.onlyPreviewProjectSearchStore;

after(() => {
  projectSearchStore.exit();
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__onlyPreviewSearchRuntime;
  delete globalThis.__onlyPreviewRendererSubscriptions;
  delete globalThis.window;
});

export const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

export const responseFor = (request, results = []) => ({
  ok: true,
  value: {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    results,
    truncated: false
  }
});

export const batchFor = (request, results = []) => ({
  workspaceId: request.workspaceId,
  generation: request.generation,
  requestId: request.requestId,
  results
});

export const textResult = (relativePath, contentMatch = null) => ({
  fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
  relativePath,
  mediaType: 'text',
  contentMatch
});

export const searchSnapshotEntry = (overrides = {}) => ({
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  name: 'readme.md',
  nodeKind: 'file',
  size: 128,
  modifiedAt: 1_725_000_000_000,
  previewHint: 'text',
  mediaType: 'text',
  isText: true,
  ...overrides
});

export const searchSnapshotMemory = (overrides = {}) => ({
  measurementComplete: true,
  processRssBytes: 512_000_000,
  workerHeapUsedBytes: 64_000_000,
  workerExternalBytes: 8_000_000,
  treeMetadataEntryCount: 30_000,
  treeMetadataEstimatedBytes: 14_000_000,
  filenameTierEstimatedBytes: 12_000_000,
  diskIndexBytes: 1_400_000_000,
  runtimeOneGiBWarning: false,
  runtimeTwoGiBLimitExceeded: false,
  ...overrides
});

export const searchSnapshotEvent = () => ({
  hostId: 'host-search-shell',
  snapshot: {
    workspaceId: 'workspace-search-shell',
    generation: 7,
    state: 'ready',
    index: {
      workspaceId: 'workspace-search-shell',
      entries: [searchSnapshotEntry()],
      truncated: false,
      limit: 1
    },
    memory: searchSnapshotMemory()
  }
});

export const resetProjectSearch = (resolveContext) => {
  projectSearchStore.exit();
  searchCalls.length = 0;
  cancelCalls.length = 0;
  shutdownCalls.length = 0;
  let scheduled = 0;
  const selected = [];
  projectSearchStore.configure(resolveContext, (relativePath) => selected.push(relativePath));
  projectSearchStore.configureScheduler(() => {
    scheduled += 1;
  });
  projectSearchStore.enter();
  return { scheduled: () => scheduled, selected };
};

export const projectSearchContext = (overrides = {}) => ({
  workspaceId: 'workspace-search-shell',
  generation: 7,
  ready: true,
  rootName: 'overmind',
  focusedRelativePath: '',
  focusedNodeKind: null,
  selectedRelativePath: '',
  ...overrides
});
