/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-file-search-window-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/searchBootstrap.runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'file-search-coordinator-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/fileSearchCoordinator$/ }, () => ({
          path: 'file-search-coordinator',
          namespace: 'file-search-window-test'
        }));
        buildContext.onLoad(
          { filter: /^file-search-coordinator$/, namespace: 'file-search-window-test' },
          () => ({
            contents: `export const createFileSearchCoordinator = () => {
              throw new Error('Window integration tests do not create the runtime coordinator.');
            };`
          })
        );
      }
    }
  ]
});

const runtime = await import(pathToFileURL(bundlePath).href);
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

after(() => rmSync(buildRoot, { recursive: true, force: true }));

test('search and browse requests keep strict relative capability shapes', () => {
  const request = {
    hostToken: 'host-token',
    workspaceId: 'workspace-token',
    generation: 1,
    requestId: 'request-id',
    query: 'needle',
    maxResults: 50,
    scope: { kind: 'project' }
  };
  assert.deepEqual(runtime.parseOnlyPreviewSearchRequest(request).scope, { kind: 'project' });
  assert.deepEqual(
    runtime.parseOnlyPreviewSearchRequest({
      ...request,
      scope: { kind: 'directory', relativePath: 'docs/.hidden' }
    }).scope,
    { kind: 'directory', relativePath: 'docs/.hidden' }
  );
  for (const scope of [
    undefined,
    { kind: 'project', relativePath: '' },
    { kind: 'directory', relativePath: '/absolute' },
    { kind: 'directory', relativePath: '../outside' },
    { kind: 'directory', relativePath: 'docs\\hidden' },
    { kind: 'unknown' }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewSearchRequest({ ...request, scope }),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }

  const browse = {
    hostToken: 'host-token',
    workspaceId: 'workspace-token',
    generation: 1,
    directoryToken: 'opaque-directory-token'
  };
  assert.deepEqual(runtime.parseOnlyPreviewBrowseDirectoryRequest(browse), browse);
  for (const invalid of [
    { ...browse, relativePath: 'private/directory' },
    { ...browse, absolutePath: '/private/directory' },
    { ...browse, directoryToken: '' }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewBrowseDirectoryRequest(invalid),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }

  const priority = {
    hostToken: 'host-token',
    workspaceId: 'workspace-token',
    generation: 1,
    relativePath: 'docs/readme.md'
  };
  assert.deepEqual(runtime.parseOnlyPreviewSearchPrioritizeFileRequest(priority), priority);
  for (const invalid of [
    { ...priority, relativePath: '/absolute.md' },
    { ...priority, relativePath: '../outside.md' },
    { ...priority, relativePath: 'docs\\readme.md' },
    { ...priority, absolutePath: '/private/workspace/docs/readme.md' }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewSearchPrioritizeFileRequest(invalid),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }
});

test('search bootstrap remains Main-private and host/workspace bound', async () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const bootstraps = new runtime.OnlyPreviewSearchBootstrapRegistry(hosts, workspaces);
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'onlypreview-search-workspace-'));
  const userData = resolve('/tmp/bitterless-user-data');
  try {
    const host = hosts.issue('standalone', 'content');
    const capability = bootstraps.issue(host.hostToken);
    const workspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);
    const bootstrap = bootstraps.resolve(capability.searchToken, workspace.workspaceId, userData);
    assert.deepEqual(Object.keys(bootstrap).sort(), ['databasePath', 'rootPath', 'workspaceId']);
    assert.equal(bootstrap.rootPath, realpathSync(workspaceRoot));
    assert.equal(bootstrap.databasePath.startsWith(workspaceRoot), false);
    hosts.revoke(host.hostToken);
    assert.throws(() =>
      bootstraps.resolve(capability.searchToken, workspace.workspaceId, userData)
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('hidden file-search owner uses exact lifecycle fencing and one terminal failure', () => {
  const failures = [];
  const expected = 'file:///app/out/renderer/fileSearch/index.html';
  const fence = new runtime.FileSearchLifecycleFence(expected, (message) => failures.push(message));
  assert.equal(fence.acceptNavigation(expected), true);
  assert.equal(fence.acceptNavigation(`${expected}?redirected=1`), false);
  fence.fail('late render-process-gone');
  assert.equal(failures.length, 1);
});

test('official graph owns search in top-level hidden preload over capability-bound XPC', () => {
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const fileSearchWindow = source('src/main/fileSearch/fileSearchWindow.service.ts');
  const relay = source('src/main/fileSearch/fileSearchRuntimeRelay.service.ts');
  const globalResultValidator = source('src/main/fileSearch/fileSearchGlobalResult.validator.ts');
  const eventHandler = source('src/main/fileSearch/fileSearchRuntimeEvent.handler.ts');
  const runtimePreload = source('src/preload/fileSearch/fileSearch.preload.ts');
  const runtimeTypes = source('src/shared/onlypreview/fileSearchRuntime.types.ts');
  const coordinator = source('src/preload/fileSearch/fileSearchCoordinator.ts');
  const publicHandler = source('src/main/xpc/onlyPreviewSearchRuntime.handler.ts');
  const visiblePreload = source('src/preload/onlypreview/onlypreview.preload.ts');
  const contentPreload = source('src/preload/onlypreview/onlypreviewContent.preload.ts');
  const bridgeType = source(
    'src/renderer/onlypreview/common/contextBridge/onlyPreviewEnv.bridge.ts'
  );
  const vite = source('electron.vite.config.ts');
  const logPolicy = source('src/main/logging/logPolicy.service.ts');
  const hiddenHtml = source('src/renderer/fileSearch/index.html');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const priorityService = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewSelectedFilePriority.service.ts'
  );
  const priorityLane = source(
    'src/preload/onlypreview/search/core/selected-file-priority-lane.mjs'
  );
  const searchEngine = source('src/preload/onlypreview/search/core/search-engine.mjs');
  const watchReconciler = source('src/preload/onlypreview/search/core/watch-reconciler.mjs');

  assert.match(windowHelper, /await fileSearchWindowService\.start\(\{/);
  assert.match(windowHelper, /fileSearchWindowService\.stop\(\)/);
  assert.doesNotMatch(windowHelper, /utilityProcess|readdir|readFile|node:sqlite/);

  for (const setting of [
    /show: false/,
    /skipTaskbar: true/,
    /sandbox: false/,
    /contextIsolation: true/,
    /nodeIntegration: false/,
    /webSecurity: true/,
    /backgroundThrottling: false/
  ]) {
    assert.match(fileSearchWindow, setting);
  }
  assert.match(fileSearchWindow, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(fileSearchWindow, /setMenuBarVisibility\(false\)/);
  assert.match(fileSearchWindow, /'will-navigate'/);
  assert.match(fileSearchWindow, /'will-redirect'/);
  assert.match(fileSearchWindow, /'did-fail-load'/);
  assert.match(fileSearchWindow, /'render-process-gone'/);
  assert.match(fileSearchWindow, /fileSearchRuntimeRelayService\.detach\(\)/);
  assert.match(
    fileSearchWindow,
    /createXpcMainEmitter<FileSearchRuntimePrivateApi>\([\s\S]*fileSearchRuntimeHandlerName\(capability\)/
  );
  assert.match(fileSearchWindow, /registerFileSearchRuntimeEventHandler\(capability\)/);
  assert.doesNotMatch(fileSearchWindow, /rootPath|databasePath|searchToken/);

  assert.match(runtimePreload, /extends XpcPreloadHandler/);
  assert.match(runtimePreload, /createXpcPreloadEmitter<FileSearchRuntimeEventApi>/);
  assert.match(runtimePreload, /registerFileSearchRuntime/);
  assert.match(runtimePreload, /'DOMContentLoaded'/);
  assert.match(runtimePreload, /requireCapability\(params\.capability\)/);
  assert.match(runtimePreload, /fileSearchRuntimeEventHandlerName\(runtimeCapability\)/);
  assert.match(
    runtimePreload,
    /Object\.defineProperty\(FileSearchRuntime, 'name',[\s\S]*fileSearchRuntimeHandlerName\(runtimeCapability\)/
  );
  assert.match(runtimePreload, /runtime\.initialize\(params\.request, params\.bootstrap\)/);
  assert.doesNotMatch(runtimePreload, /parentPort|utilityProcess|contextBridge/);
  assert.match(coordinator, /createLatestSingleFlight/);
  assert.match(coordinator, /priorityScheduler/);
  assert.match(coordinator, /await waitForLatestPriority\(\)/);
  assert.match(coordinator, /latestPriority = operation\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(coordinator, /beginBlock|suspend/);

  assert.match(relay, /active\.client\[method\]\(runtimeParams as never\)/);
  assert.match(relay, /message\.capability !== active\.capability/);
  assert.match(relay, /this\._isResponseResult\(result, expectation\)/);
  for (const validatorSource of [relay, globalResultValidator]) {
    assert.match(validatorSource, /PREVIEW_HINTS = new Set\(\[[\s\S]*'presentation'/);
  }
  assert.match(eventHandler, /extends XpcMainHandler/);
  assert.match(eventHandler, /fileSearchRuntimeEventHandlerName\(capability\)/);
  assert.doesNotMatch(runtimeTypes, /FILE_SEARCH_RUNTIME_HANDLER\s*=/);
  assert.doesNotMatch(runtimeTypes, /FILE_SEARCH_RUNTIME_EVENT_HANDLER\s*=/);
  assert.match(publicHandler, /onlyPreviewSearchBootstrapRegistry\.resolve\(/);
  assert.doesNotMatch(publicHandler, /readdir|readFile|node:sqlite|database\.exec/);
  assert.match(publicHandler, /parseOnlyPreviewSearchPrioritizeFileRequest\(params\)/);
  assert.match(publicHandler, /parseOnlyPreviewGlobalSearchPreviewRequest\(params\)/);
  assert.doesNotMatch(
    `${publicHandler}\n${relay}\n${globalResultValidator}`,
    /node:fs|node:sqlite|readFile|readdir|opendir|lstat|realpath/
  );

  assert.match(shellStore, /await onlyPreviewClient\.selectStandaloneFile\(/);
  assert.match(shellStore, /dispatchOnlyPreviewSelectedFilePriority\(/);
  assert.match(priorityService, /void onlyPreviewSearchClient[\s\S]*\.prioritizeFile\(/);
  assert.match(priorityLane, /isWorkspaceSearchPathWithinDepth\(relativePath/);
  assert.match(searchEngine, /createOnlyPreviewSearchWatchReconciler\(\{/);
  assert.match(searchEngine, /await this\.watchReconciler\.apply\(change\)/);
  assert.doesNotMatch(searchEngine, /async emitBrowseListingsForChangedPaths\(/);
  assert.match(
    watchReconciler,
    /async emitBrowseListingsForChangedPaths\(context, relativePaths\)/
  );
  assert.match(watchReconciler, /await context\.refreshFromWatchInternal\(\)/);
  assert.match(watchReconciler, /await context\.emitSnapshot\(\)/);

  assert.doesNotMatch(visiblePreload, /fileSearch|searchToken|rootPath|databasePath/);
  assert.doesNotMatch(contentPreload, /fileSearch|searchToken|rootPath|databasePath/);
  assert.doesNotMatch(bridgeType, /searchToken|rootPath|databasePath/);
  assert.match(vite, /fileSearch: resolve\('src\/preload\/fileSearch\/fileSearch\.preload\.ts'\)/);
  assert.match(vite, /fileSearch: resolve\('src\/renderer\/fileSearch\/index\.html'\)/);
  assert.doesNotMatch(vite, /onlypreviewSearchUtility|onlyPreviewSearch\.utility/);
  assert.match(logPolicy, /\/fileSearch\/index\.html/);
  assert.match(hiddenHtml, /default-src 'none'/);
  assert.doesNotMatch(hiddenHtml, /<script|id="app"/);
});

test('Preview routes selected-file watch commits through the Main-owned Region revision', () => {
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(region, /async handleWatchCommit\(/);
  assert.match(region, /fileRef\.workspaceId !== commit\.workspaceId/);
  assert.match(region, /commit\.changedRelativePaths\.some/);
  assert.match(region, /await this\.present\(runtime\.host\.hostToken, fileRef\)/);
  assert.doesNotMatch(previewStore, /SEARCH_WATCH_COMMIT|WatchReload/);
});
