/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-search-window-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/searchBootstrap.runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

after(() => rmSync(buildRoot, { recursive: true, force: true }));

test('search request scope is a strict project-or-relative-directory discriminator', () => {
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
      scope: { kind: 'directory', relativePath: '' }
    }).scope,
    { kind: 'directory', relativePath: '' }
  );
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
    { kind: 'directory' },
    { kind: 'directory', relativePath: '/absolute' },
    { kind: 'directory', relativePath: '../outside' },
    { kind: 'directory', relativePath: 'docs\\hidden' },
    { kind: 'directory', relativePath: 'docs//hidden' },
    { kind: 'unknown' }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewSearchRequest({ ...request, scope }),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }
  assert.throws(
    () => runtime.parseOnlyPreviewSearchRequest({ ...request, extra: true }),
    (error) => error?.code === 'INVALID_INPUT'
  );
});

test('browse requests expose only the opaque directory capability and workspace fence', () => {
  const request = {
    hostToken: 'host-token',
    workspaceId: 'workspace-token',
    generation: 1,
    directoryToken: 'opaque-directory-token'
  };
  assert.deepEqual(runtime.parseOnlyPreviewBrowseDirectoryRequest(request), request);
  for (const invalid of [
    { ...request, relativePath: 'private/directory' },
    { ...request, absolutePath: '/private/directory' },
    { ...request, directoryToken: '' },
    { ...request, generation: -1 },
    { hostToken: request.hostToken, workspaceId: request.workspaceId, generation: 1 }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewBrowseDirectoryRequest(invalid),
      (error) => error?.code === 'INVALID_INPUT'
    );
  }
});

test('watch reload gates selected paths, stale runtime events, and repeated quiet-edge revisions', () => {
  const active = { sessionId: 7, workspaceId: 'workspace-current', generation: 4 };
  assert.equal(
    runtime.isOnlyPreviewSearchRuntimeEventCurrent(active, 7, {
      workspaceId: 'workspace-current',
      generation: 4
    }),
    true
  );
  assert.equal(
    runtime.isOnlyPreviewSearchRuntimeEventCurrent(active, 6, {
      workspaceId: 'workspace-current',
      generation: 4
    }),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewSearchRuntimeEventCurrent(active, 7, {
      workspaceId: 'workspace-stale',
      generation: 4
    }),
    false
  );
  assert.equal(
    runtime.isOnlyPreviewSearchRuntimeEventCurrent(active, 7, {
      workspaceId: 'workspace-current',
      generation: 3
    }),
    false
  );

  let cursor = runtime.createOnlyPreviewWatchReloadCursor();
  const commit = (revision, changedRelativePaths, full = false) => ({
    workspaceId: 'workspace-current',
    generation: 4,
    revision,
    full,
    changedRelativePaths
  });
  let decision = runtime.evaluateOnlyPreviewWatchReload(
    cursor,
    commit(1, ['notes/other.txt']),
    'notes/selected.txt'
  );
  assert.equal(decision.reload, false, 'an unselected path must not reload Preview');
  cursor = decision.cursor;

  decision = runtime.evaluateOnlyPreviewWatchReload(
    cursor,
    commit(2, ['notes/selected.txt']),
    'notes/reselected.txt'
  );
  assert.equal(decision.reload, false, 'a stale selection must not reload its old file');
  cursor = decision.cursor;

  decision = runtime.evaluateOnlyPreviewWatchReload(
    cursor,
    commit(3, ['notes/selected.txt']),
    'notes/selected.txt'
  );
  assert.equal(decision.reload, true);
  cursor = decision.cursor;
  assert.equal(
    runtime.evaluateOnlyPreviewWatchReload(
      cursor,
      commit(3, ['notes/selected.txt']),
      'notes/selected.txt'
    ).reload,
    false,
    'one committed quiet-edge revision must reload exactly once'
  );

  decision = runtime.evaluateOnlyPreviewWatchReload(
    cursor,
    commit(4, ['notes/selected.txt']),
    'notes/selected.txt'
  );
  assert.equal(decision.reload, true, 'atomic rename/delete of the selected path reloads missing');
  cursor = decision.cursor;
  decision = runtime.evaluateOnlyPreviewWatchReload(
    cursor,
    commit(5, ['notes/selected.txt']),
    'notes/selected.txt'
  );
  assert.equal(decision.reload, true, 'a later recreate receives a new revision and reloads');
  cursor = decision.cursor;
  assert.equal(
    runtime.evaluateOnlyPreviewWatchReload(cursor, commit(6, [], true), 'notes/selected.txt')
      .reload,
    true,
    'a full reconcile invalidates the selected Preview'
  );
});

test('search bootstrap binds one private token to one live Content host and stable root database', async () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const bootstraps = new runtime.OnlyPreviewSearchBootstrapRegistry(hosts, workspaces);
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'onlypreview-search-workspace-'));
  const userData = resolve('/tmp/bitterless-user-data');
  try {
    const host = hosts.issue('standalone', 'content');
    const capability = bootstraps.issue(host.hostToken);
    const firstWorkspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);
    const first = bootstraps.resolve(capability.searchToken, firstWorkspace.workspaceId, userData);
    assert.deepEqual(Object.keys(first).sort(), ['databasePath', 'rootPath', 'workspaceId']);
    assert.equal(first.workspaceId, firstWorkspace.workspaceId);
    assert.equal(first.rootPath, realpathSync(workspaceRoot));
    assert.match(first.databasePath, /onlypreview[/\\]search-index-v6[/\\][a-f0-9]{64}\.sqlite$/);
    assert.equal(first.databasePath.startsWith(workspaceRoot), false);

    const secondWorkspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);
    const second = bootstraps.resolve(
      capability.searchToken,
      secondWorkspace.workspaceId,
      userData
    );
    assert.equal(second.databasePath, first.databasePath);
    assert.throws(() =>
      bootstraps.resolve(capability.searchToken, firstWorkspace.workspaceId, userData)
    );

    hosts.revoke(host.hostToken);
    assert.throws(() =>
      bootstraps.resolve(capability.searchToken, secondWorkspace.workspaceId, userData)
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('search bootstrap rejects cross-host workspaces without disclosing a path', async () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const bootstraps = new runtime.OnlyPreviewSearchBootstrapRegistry(hosts, workspaces);
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'onlypreview-search-cross-host-'));
  try {
    const firstHost = hosts.issue('standalone', 'content');
    const secondHost = hosts.issue('standalone', 'content');
    const capability = bootstraps.issue(firstHost.hostToken);
    const secondWorkspace = await workspaces.createForTarget(secondHost.hostToken, workspaceRoot);
    assert.throws(
      () => bootstraps.resolve(capability.searchToken, secondWorkspace.workspaceId, '/tmp/private'),
      (error) => error?.code === 'WORKSPACE_ACCESS_DENIED'
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('utility RPC rejects pending work on exit and forwards cancel without waiting for search', async () => {
  class FakeUtilityChild extends EventEmitter {
    messages = [];

    postMessage(message) {
      this.messages.push(message);
    }
  }

  const child = new FakeUtilityChild();
  const rpc = new runtime.OnlyPreviewSearchUtilityRpcService();
  let exits = 0;
  rpc.attach({
    hostToken: 'host-token',
    hostId: 'host-id',
    searchToken: 'private-search-token',
    child,
    broadcast: () => {},
    onUnexpectedExit: () => {
      exits += 1;
    }
  });
  await assert.rejects(
    rpc.call('other-host', 'cancel', { requestId: 'denied' }, 5_000),
    (error) => error?.code === 'HOST_ROLE_DENIED'
  );
  const search = rpc.call('host-token', 'search', { requestId: 'search-1' }, 5_000);
  const cancel = rpc.call('host-token', 'cancel', { requestId: 'search-1' }, 5_000);
  assert.deepEqual(
    child.messages.map(({ method }) => method),
    ['search', 'cancel'],
    'cancel uses an independent process message while search is still pending'
  );
  const cancelMessage = child.messages[1];
  child.emit('message', {
    type: 'onlypreview-search-utility-response',
    requestId: cancelMessage.requestId,
    result: { ok: true, value: undefined }
  });
  assert.deepEqual(await cancel, { ok: true, value: undefined });
  child.emit('exit', 1);
  await assert.rejects(search, /stopped unexpectedly/);
  assert.equal(exits, 1);

  const replacement = new FakeUtilityChild();
  rpc.attach({
    hostToken: 'replacement-host',
    hostId: 'replacement-id',
    searchToken: 'replacement-search-token',
    child: replacement,
    broadcast: () => {},
    onUnexpectedExit: () => {}
  });
  const replacementCall = rpc.call('replacement-host', 'cancel', { requestId: 'next' }, 5_000);
  replacement.emit('message', {
    type: 'onlypreview-search-utility-response',
    requestId: replacement.messages[0].requestId,
    result: { ok: true, value: undefined }
  });
  assert.deepEqual(await replacementCall, { ok: true, value: undefined });
  rpc.detach();

  const silent = new FakeUtilityChild();
  rpc.attach({
    hostToken: 'silent-host',
    hostId: 'silent-id',
    searchToken: 'silent-search-token',
    child: silent,
    broadcast: () => {},
    onUnexpectedExit: () => {}
  });
  await assert.rejects(
    rpc.call('silent-host', 'search', { requestId: 'timeout' }, 5),
    /request timed out/
  );
  rpc.detach();
});

test('utility RPC enriches initialize privately and relays only current valid raw events', async () => {
  class FakeUtilityChild extends EventEmitter {
    messages = [];
    postMessage(message) {
      this.messages.push(message);
    }
  }

  const child = new FakeUtilityChild();
  const broadcasts = [];
  const rpc = new runtime.OnlyPreviewSearchUtilityRpcService();
  rpc.attach({
    hostToken: 'host-token',
    hostId: 'bound-host-id',
    searchToken: 'private-search-token',
    child,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params }),
    onUnexpectedExit: () => {}
  });
  assert.equal(rpc.searchTokenForHost('host-token'), 'private-search-token');
  const bootstrap = {
    workspaceId: 'workspace-current',
    rootPath: '/private/root',
    databasePath: '/private/index.sqlite'
  };
  const initialize = rpc.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId: 'workspace-current', generation: 4 },
    5_000,
    bootstrap
  );
  assert.deepEqual(child.messages[0].bootstrap, bootstrap);
  assert.equal('searchToken' in child.messages[0].params, false);

  const validSnapshot = {
    workspaceId: 'workspace-current',
    generation: 4,
    state: 'building',
    index: {
      workspaceId: 'workspace-current',
      entries: [],
      truncated: false,
      limit: 20_000
    },
    memory: {
      measurementComplete: false,
      processRssBytes: null,
      workerHeapUsedBytes: null,
      workerExternalBytes: null,
      treeMetadataEntryCount: null,
      treeMetadataEstimatedBytes: null,
      filenameTierEstimatedBytes: null,
      diskIndexBytes: null,
      runtimeOneGiBWarning: false,
      runtimeTwoGiBLimitExceeded: false
    }
  };
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/search-snapshot',
    value: { snapshot: validSnapshot }
  });
  const validRootListing = {
    workspaceId: 'workspace-current',
    generation: 4,
    directoryToken: 'root-directory-token',
    relativePath: '',
    entries: [
      {
        relativePath: 'docs',
        parentRelativePath: '',
        name: 'docs',
        nodeKind: 'directory',
        size: 0,
        modifiedAt: 1,
        previewHint: 'unsupported',
        mediaType: 'unknown',
        isText: false,
        directoryToken: 'docs-directory-token'
      },
      {
        relativePath: 'readme.md',
        parentRelativePath: '',
        name: 'readme.md',
        nodeKind: 'file',
        size: 10,
        modifiedAt: 1,
        previewHint: 'text',
        mediaType: 'text',
        isText: true,
        directoryToken: null
      }
    ]
  };
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/browse-listing',
    value: { listing: validRootListing }
  });
  const validCountingProgress = {
    workspaceId: 'workspace-current',
    generation: 4,
    buildRevision: 1,
    phase: 'counting'
  };
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/search-progress',
    value: { progress: validCountingProgress }
  });
  const validIndexingProgress = {
    workspaceId: 'workspace-current',
    generation: 4,
    buildRevision: 1,
    phase: 'indexing',
    completed: 10,
    total: 20
  };
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/search-progress',
    value: { progress: validIndexingProgress }
  });
  for (const message of [
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-unknown',
      value: { snapshot: validSnapshot }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: { ...validSnapshot, generation: 3 } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: { workspaceId: 'workspace-current', generation: 4, state: 'ready' } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: { ...validSnapshot, entries: [] } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/browse-listing',
      value: { listing: { ...validRootListing, generation: 3 } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/browse-listing',
      value: { listing: { ...validRootListing, absolutePath: '/private/workspace' } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/browse-listing',
      value: {
        listing: {
          ...validRootListing,
          entries: [
            validRootListing.entries[0],
            { ...validRootListing.entries[1], directoryToken: 'docs-directory-token' }
          ]
        }
      }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-progress',
      value: { progress: { ...validCountingProgress, stale: true } }
    },
    {
      type: 'onlypreview-search-utility-event',
      eventName: 'onlypreview/search-progress',
      value: { progress: { ...validIndexingProgress, completed: 21 } }
    }
  ]) {
    child.emit('message', message);
  }
  assert.deepEqual(broadcasts, [
    {
      eventName: 'onlypreview/search-snapshot',
      params: { hostId: 'bound-host-id', snapshot: validSnapshot }
    },
    {
      eventName: 'onlypreview/browse-listing',
      params: { hostId: 'bound-host-id', listing: validRootListing }
    },
    {
      eventName: 'onlypreview/search-progress',
      params: { hostId: 'bound-host-id', progress: validCountingProgress }
    },
    {
      eventName: 'onlypreview/search-progress',
      params: { hostId: 'bound-host-id', progress: validIndexingProgress }
    }
  ]);

  child.emit('message', {
    type: 'onlypreview-search-utility-response',
    requestId: child.messages[0].requestId,
    result: { ok: true, value: validSnapshot }
  });
  assert.deepEqual(await initialize, { ok: true, value: validSnapshot });
  rpc.detach();

  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/search-snapshot',
    value: { snapshot: validSnapshot }
  });
  assert.equal(broadcasts.length, 4, 'events from a detached utility are stale and ignored');
});

test('window and preload source keep search authority utility-owned and Main search-I/O free', () => {
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const utilityLifecycle = source(
    'src/main/onlypreview/onlyPreviewSearchUtilityLifecycle.service.ts'
  );
  const preload = source('src/preload/onlypreview/onlypreview.preload.ts');
  const contentPreload = source('src/preload/onlypreview/onlypreviewContent.preload.ts');
  const preloadType = source('src/preload/onlypreview/onlypreview.preload.type.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const bootstrapTypes = source('src/shared/onlypreview/onlyPreviewSearchBootstrap.types.ts');
  const searchContract = source('src/shared/onlypreview/onlyPreviewSearch.contract.ts');
  const runtimeHandler = source('src/utility/onlypreview/onlyPreviewSearchRuntime.utility.ts');
  const runtimeCoordinator = source(
    'src/utility/onlypreview/onlyPreviewSearchCoordinator.utility.ts'
  );
  const runtimeEntry = source('src/utility/onlypreview/onlyPreviewSearch.utility.ts');
  const runtimeProxy = source('src/main/xpc/onlyPreviewSearchRuntime.handler.ts');
  const runtimeRpc = source('src/main/onlypreview/onlyPreviewSearchUtilityRpc.service.ts');
  const runtimeFence = source(
    'src/preload/onlypreview/search/onlyPreviewSearchRuntimeFence.service.ts'
  );
  const bridgeType = source(
    'src/renderer/onlypreview/common/contextBridge/onlyPreviewEnv.bridge.ts'
  );
  const vite = source('electron.vite.config.ts');

  assert.ok(windowHelper.split(/\r?\n/).length < 800);
  assert.match(windowHelper, /const PREVIEW_HEADER_HEIGHT = 43/);
  assert.match(
    windowHelper,
    /addChildView\(shellView\)[\s\S]*addChildView\(previewHeaderView\)[\s\S]*addChildView\(previewView\)/
  );
  assert.match(windowHelper, /sandbox: true/);
  assert.match(
    windowHelper,
    /mode === 'preview'[\s\S]*'\.\.\/preload\/onlypreviewContent\.js'[\s\S]*'\.\.\/preload\/onlypreview\.js'/
  );
  assert.match(
    windowHelper,
    /configureNavigationFence\(view\.webContents, target\.url, mode === 'shell'\)/
  );
  assert.match(
    windowHelper,
    /mode: 'shell' \| 'previewHeader' \| 'preview'[\s\S]*configureNavigationFence\(view\.webContents, target\.url, mode === 'shell'\)/
  );
  assert.match(windowHelper, /if \(url === expectedUrl\) return;[\s\S]*event\.preventDefault\(\)/);
  assert.match(
    windowHelper,
    /await onlyPreviewSearchUtilityLifecycleService\.start\(\{[\s\S]*host,[\s\S]*searchToken: searchBootstrap\.searchToken/
  );
  assert.match(windowHelper, /onlyPreviewSearchUtilityLifecycleService\.stop\(\)/);
  assert.doesNotMatch(
    windowHelper,
    /utilityProcess|waitForSearchUtilityReady|searchUtilityEnvironment/
  );
  assert.match(utilityLifecycle, /utilityProcess\.fork\(/);
  assert.doesNotMatch(utilityLifecycle, /--onlypreview-search-token=/);
  assert.match(utilityLifecycle, /await waitForSearchUtilityReady\(utility, instanceId\)/);
  assert.match(utilityLifecycle, /onlyPreviewSearchUtilityRpcService\.detach\(\)/);
  assert.match(
    windowHelper,
    /await this\.loadView\(previewView, 'preview'\);[\s\S]*await Promise\.all\(\[[\s\S]*this\.loadView\(shellView, 'shell'\)[\s\S]*this\.loadView\(previewHeaderView, 'previewHeader'\)/
  );
  assert.match(
    windowHelper,
    /previewView\.webContents\.openDevTools\(\{ mode: 'detach', activate: false \}\)/
  );
  assert.doesNotMatch(windowHelper, /readdir|readFile|node:sqlite|OnlyPreviewIndexService/);
  assert.doesNotMatch(
    handler,
    /OnlyPreviewIndexService|onlyPreviewIndexService|async buildIndex|async listDirectory/
  );
  assert.doesNotMatch(handler, /OnlyPreviewSearchAuthority/);
  assert.doesNotMatch(bootstrapTypes, /AuthorityApi|AuthorityRequest|searchToken/);
  assert.match(preloadType, /'previewHeader'/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^\n]*search/i);
  assert.doesNotMatch(preload, /OnlyPreviewSearchRuntimeHandler|onlypreview-search-token/);
  assert.match(contentPreload, /exposeOnlyPreviewEnv\(\)/);
  assert.doesNotMatch(
    contentPreload,
    /OnlyPreviewSearchRuntimeHandler|search-token|worker_threads/
  );
  assert.doesNotMatch(contentPreload, /exposeInMainWorld\([^\n]*search/i);
  assert.match(runtimeHandler, /class OnlyPreviewSearchRuntimeUtility/);
  assert.doesNotMatch(
    runtimeHandler,
    /electron-xpc|AUTHORITY_CHANNEL|node:worker_threads|new Worker/
  );
  assert.match(
    runtimeHandler,
    /async browseDirectory\([\s\S]*parseOnlyPreviewBrowseDirectoryRequest\(params\)[\s\S]*_requireActiveRequest\(request\)[\s\S]*coordinator\.browseDirectory\(request\)/
  );
  assert.match(
    runtimeHandler,
    /onBrowseListing: \(listing\) => \{[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent\(active, sessionId, listing\)[\s\S]*this\.registration\.emit\(ONLY_PREVIEW_BROWSE_LISTING_EVENT, \{ listing \}\)/
  );
  assert.match(
    runtimeHandler,
    /onProgress: \(progress\) => \{[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent\(active, sessionId, progress\)[\s\S]*this\.registration\.emit\(ONLY_PREVIEW_SEARCH_PROGRESS_EVENT, \{ progress \}\)/
  );
  assert.match(
    runtimeHandler,
    /onSearchBatch: \(batch\) => \{[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent\(active, sessionId, batch\)[\s\S]*this\.registration\.emit\(ONLY_PREVIEW_SEARCH_BATCH_EVENT, \{ batch \}\)/
  );
  assert.match(
    runtimeHandler,
    /onWatchCommit: \(commit:[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent\(active, sessionId, commit\)[\s\S]*this\.registration\.emit\(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT/
  );
  assert.match(runtimeFence, /active\.sessionId === sessionId/);
  assert.match(runtimeFence, /event\.workspaceId === active\.workspaceId/);
  assert.match(runtimeFence, /event\.generation === active\.generation/);
  assert.match(
    runtimeHandler,
    /this\.registration\.emit\(ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT, \{ snapshot \}\)/
  );
  assert.doesNotMatch(runtimeHandler, /readdir|readFile|node:sqlite|database\.exec/);
  assert.match(runtimeCoordinator, /new SharedArrayBuffer/);
  assert.match(runtimeCoordinator, /Atomics\.store\(state, 0, 1\)/);
  assert.match(runtimeEntry, /ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE/);
  assert.match(runtimeEntry, /ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE/);
  assert.doesNotMatch(runtimeEntry, /electron-xpc|xpcUtilityProcess/);
  assert.doesNotMatch(
    runtimeEntry,
    /registerHandlers|OnlyPreviewSearchRuntimeHandler\/|RUNTIME_CHANNEL_PREFIX/
  );
  assert.match(runtimeProxy, /class OnlyPreviewSearchRuntimeHandler/);
  assert.match(runtimeProxy, /onlyPreviewSearchBootstrapRegistry\.resolve\(/);
  assert.match(runtimeRpc, /this\._rejectPending\(active\)/);
  assert.match(runtimeRpc, /ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE/);
  assert.match(runtimeRpc, /ONLY_PREVIEW_BROWSE_LISTING_EVENT/);
  assert.match(runtimeRpc, /ONLY_PREVIEW_SEARCH_PROGRESS_EVENT/);
  assert.match(runtimeRpc, /method,[\s\S]*params/);
  const browseParser = searchContract.slice(
    searchContract.indexOf('export const parseOnlyPreviewBrowseDirectoryRequest'),
    searchContract.indexOf('export const parseOnlyPreviewSearchRequest')
  );
  assert.match(browseParser, /\['directoryToken', 'generation', 'hostToken', 'workspaceId'\]/);
  assert.doesNotMatch(browseParser, /relativePath|absolutePath|rootPath|displayPath/);
  assert.doesNotMatch(runtimeProxy, /readdir|readFile|node:sqlite|database\.exec/);
  assert.doesNotMatch(bridgeType, /searchToken|rootPath|databasePath/);
  assert.match(vite, /onlypreviewSearchUtility:\s*resolve\(/);
  assert.match(vite, /onlypreview\/onlyPreviewSearch\.utility\.ts/);
  const preloadConfigStart = vite.indexOf('  preload: {');
  const rendererConfigStart = vite.indexOf('\n  renderer:', preloadConfigStart);
  assert.ok(preloadConfigStart >= 0 && rendererConfigStart > preloadConfigStart);
  const preloadConfig = vite.slice(preloadConfigStart, rendererConfigStart);
  assert.match(
    preloadConfig,
    /input:\s*\{[\s\S]*onlypreview:\s*resolve\('src\/preload\/onlypreview\/onlypreview\.preload\.ts'\)[\s\S]*onlypreviewContent:\s*resolve\('src\/preload\/onlypreview\/onlypreviewContent\.preload\.ts'\)/
  );
  const sandboxPluginStart = vite.indexOf('const onlyPreviewSandboxPreloadPlugin');
  const nextPluginStart = vite.indexOf('const trenchSandboxPreloadPlugin', sandboxPluginStart);
  assert.ok(sandboxPluginStart >= 0 && nextPluginStart > sandboxPluginStart);
  const sandboxPlugin = vite.slice(sandboxPluginStart, nextPluginStart);
  assert.match(
    sandboxPlugin,
    /const onlyPreviewSandboxPreloadPlugin[\s\S]*async writeBundle\(\)[\s\S]*onlypreviewContent:[\s\S]*bundle: true[\s\S]*format: 'cjs'/
  );
  assert.match(sandboxPlugin, /onlypreview:\s*resolve\(/);
  assert.doesNotMatch(sandboxPlugin, /apply:\s*'build'/);
  assert.match(vite, /plugins: \[onlyPreviewSandboxPreloadPlugin, trenchSandboxPreloadPlugin\]/);
  assert.doesNotMatch(vite, /onlyPreviewPreloadPlugin/);
  assert.match(vite, /'onlypreview\/previewHeader'/);
});

test('Header receives display-only relative metadata and Content no longer renders Header DOM', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const header = source(
    'src/renderer/onlypreview/previewHeader/src/onlyPreviewPreviewHeader.store.ts'
  );
  const watchReload = source(
    'src/renderer/onlypreview/previewHeader/src/onlyPreviewWatchReload.service.ts'
  );
  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  const previewSurface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );

  assert.match(types, /ONLY_PREVIEW_HEADER_METADATA_EVENT/);
  assert.match(types, /action: 'render' \| 'reload' \| 'clear'/);
  assert.match(header, /ONLY_PREVIEW_PREVIEW_CONTROL_EVENT/);
  assert.match(header, /ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT/);
  assert.match(header, /isWatchCommitEvent/);
  assert.match(header, /evaluateOnlyPreviewWatchReload/);
  assert.match(watchReload, /relativePath === selectedRelativePath/);
  assert.match(watchReload, /selectedRelativePath\.startsWith\(`\$\{relativePath\}\/`\)/);
  assert.match(header, /revision: crypto\.randomUUID\(\),[\s\S]*action: 'reload'/);
  assert.match(header, /ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT/);
  assert.doesNotMatch(header, /displayPath|hostToken|describeFile|readText|onlyPreviewClient/);
  assert.match(previewStore, /fileName: descriptor\.name/);
  assert.match(previewStore, /relativePath: descriptor\.relativePath/);
  assert.doesNotMatch(previewStore, /subscribe\(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT/);
  assert.match(previewStore, /subscribe\(ONLY_PREVIEW_PREVIEW_CONTROL_EVENT/);
  assert.doesNotMatch(
    previewStore.slice(
      previewStore.indexOf('private broadcastHeaderMetadata'),
      previewStore.indexOf('private async refreshSettings')
    ),
    /displayPath|textContent|rootPath|databasePath/
  );
  assert.doesNotMatch(previewSurface, /onlypreview__previewHeader/);
  assert.match(previewSurface, /onlypreview__previewBody/);
});
