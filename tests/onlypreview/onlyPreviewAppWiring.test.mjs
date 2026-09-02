import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { classMethodNames, runtime, source } from './onlyPreviewCoreTest.helper.mjs';

test('argv routing accepts only absolute user targets and the open queue is ready-gated and serialized', async () => {
  const targetA = resolve('/tmp', 'one.txt');
  const targetB = resolve('/tmp', 'two.txt');
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      [
        '/electron',
        '/app',
        '--inspect=9229',
        '--mcp-helper',
        'relative.txt',
        `--onlypreview-open=${targetA}`,
        `--onlypreview-open=${targetA}`,
        `--onlypreview-open=${targetB}`
      ],
      { packaged: false, platform: process.platform }
    ),
    [targetA, targetB]
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      ['/Applications/Bitterless', '--user-data-dir=/tmp/profile', targetA],
      { packaged: true, platform: 'darwin' }
    ),
    []
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      ['/Program Files/Bitterless/Bitterless.exe', '--user-data-dir', '/profile', 'relative.txt'],
      {
        packaged: true,
        platform: 'win32',
        workingDirectory: '/fixtures'
      }
    ),
    ['/fixtures/relative.txt']
  );

  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolveGate) => {
    releaseFirst = resolveGate;
  });
  const queue = new runtime.OnlyPreviewOpenQueue(async (target) => {
    calls.push(`start:${target}`);
    if (target === targetA) await firstGate;
    calls.push(`end:${target}`);
  });
  queue.enqueue(targetA);
  queue.enqueue(targetB);
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, []);
  queue.markReady();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, [`start:${targetA}`]);
  releaseFirst();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, [
    `start:${targetA}`,
    `end:${targetA}`,
    `start:${targetB}`,
    `end:${targetB}`
  ]);
});

test('full-app E2E launchers require shared mock-Keychain isolation before Main readiness', () => {
  const launchArgs = source('tests/e2e/electronLaunchArgs.ts');
  const maestroFixture = source('tests/maestro/fixtures/bitterlessApp.fixture.ts');
  const onlyPreviewFixture = source('tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts');
  const appMain = source('src/main/app.main.ts');

  assert.doesNotMatch(launchArgs, /from ['"](?:electron|@playwright)/);
  assert.match(
    launchArgs,
    /platform === 'darwin' \? \['--use-mock-keychain'\] : \[\][\s\S]*applicationPath[\s\S]*\.\.\.applicationArguments/
  );

  for (const fixture of [maestroFixture, onlyPreviewFixture]) {
    assert.match(
      fixture,
      /import \{ buildBitterlessE2ELaunchArgs \} from '\.\.\/\.\.\/e2e\/electronLaunchArgs'/
    );
    const launchStart = fixture.indexOf('app = await electron.launch({');
    assert.ok(launchStart >= 0);
    const launchBody = fixture.slice(launchStart, fixture.indexOf('})', launchStart) + 2);
    assert.match(launchBody, /args: buildBitterlessE2ELaunchArgs\(\{/);
    assert.match(launchBody, /platform: process\.platform/);
    assert.match(launchBody, /applicationPath: projectRoot/);
    assert.doesNotMatch(launchBody, /args:\s*\[projectRoot/);
  }

  const guardStart = appMain.indexOf('const assertE2EKeychainIsolation');
  const guardCall = appMain.indexOf('assertE2EKeychainIsolation();');
  const configureE2ECall = appMain.indexOf('configureE2EUserData();');
  const firstWhenReady = appMain.indexOf('app.whenReady()');
  assert.ok(guardStart >= 0 && guardCall > guardStart);
  assert.ok(guardCall < configureE2ECall && guardCall < firstWhenReady);
  const guardBody = appMain.slice(guardStart, guardCall);
  assert.match(
    guardBody,
    /isHelperMode \|\| !isE2E \|\| app\.isPackaged \|\| process\.platform !== 'darwin'/
  );
  assert.match(guardBody, /app\.commandLine\.hasSwitch\('use-mock-keychain'\)/);
  assert.match(
    guardBody,
    /throw new Error\('BITTERLESS_E2E on macOS requires --use-mock-keychain'\)/
  );
});

test('recent-directory wiring stays Main-owned, value-free, and renderer-contract neutral', () => {
  const service = source('src/main/onlypreview/onlyPreviewRecentDirectory.service.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const explicitService = source('src/main/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const appMain = source('src/main/app.main.ts');
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');

  assert.match(
    service,
    /Pick<[\s\S]*SettingDao[\s\S]*'getStored' \| 'insertIfAbsent' \| 'compareAndSet'/
  );
  assert.match(service, /RECENT_DIRECTORY_KEY = 'onlypreview_workspace'/);
  assert.match(service, /RECENT_DIRECTORY_SUB_KEY = 'last_directory'/);
  assert.doesNotMatch(service, /storage\.get\(|\.upsert\(/);
  assert.doesNotMatch(service, /console\.(?:log|info|warn|error)/);
  assert.match(service, /private readonly restoreFlights = new Map/);
  assert.match(service, /hosts\.onRevoke\(\(host\) => this\.revokeHost\(host\.hostToken\)\)/);
  assert.match(service, /expectedSerializedValue: stored\.serializedValue[\s\S]*value: null/);
  assert.match(service, /!workspace\.selectedRelativePath && workspace\.displayPath === candidate/);

  const absoluteOpen = explicitService;
  assert.ok(
    absoluteOpen.indexOf('beginExplicitTarget()') < absoluteOpen.indexOf("ensureStandalone('explicit')"),
    'OS targets must suppress restore before mounting standalone renderers'
  );
  assert.match(handler, /restoreWorkspace\(host\.hostToken\)/);
  assert.match(handler, /createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>\('SettingDao'\)/);
  assert.match(
    appMain,
    /handleCoreSqliteReady:[\s\S]*onlyPreviewRecentDirectoryService\.markStorageReady\(\)/
  );
  assert.match(
    appMain,
    /handleCoreSqliteFailure:[\s\S]*onlyPreviewRecentDirectoryService\.markStorageFailed\(\)/
  );
  assert.doesNotMatch(types, /recentDirectory|directoryPath|last_directory/i);
});

test('OnlyPreview XPC prototype exposes the exact renderer allowlist and capability-gates Office chunks', () => {
  assert.deepEqual(classMethodNames('src/main/xpc/onlyPreview.handler.ts', 'OnlyPreviewHandler'), [
    'openOnlyPreviewWindow',
    'reportShellMounted',
    'chooseFolder',
    'restoreWorkspace',
    'selectStandaloneFile',
    'openCurrentOfficeRead',
    'readCurrentOfficeChunk',
    'cancelCurrentOfficeRead',
    'openCurrentPreviewText',
    'readCurrentPreviewTextChunk',
    'cancelCurrentPreviewText',
    'updatePreviewBounds',
    'getPreviewPresentation',
    'getVuePreviewPresentation',
    'reportPreviewReady',
    'reportPreviewReset',
    'reportPreviewError',
    'getPreviewFindSnapshot',
    'submitPreviewFind',
    'closePreviewFind',
    'reportGlobalSearchContext',
    'getGlobalSearchContext',
    'revealGlobalSearchDirectory',
    'reportGlobalSearchDirectoryReveal',
    'closeGlobalSearch',
    'reportPreviewFindResult',
    'minimizeWindow',
    'toggleMaximizeWindow',
    'closeWindow',
    'showFileContextMenu',
    'copyProjectItem',
    'showProjectRootContextMenu',
    'copyProjectRoot',
    'openExternally',
    'revealInFolder',
    'getSettings',
    'saveSettings',
    'openSettings',
    'closeSettings',
    'openAgentSkillGuide',
    'getAgentSkillGuideInfo'
  ]);
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const explicitOpen = source('src/main/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const classBody = handler.slice(
    handler.indexOf('class OnlyPreviewHandler'),
    handler.indexOf('export const onlyPreviewHandler')
  );
  assert.doesNotMatch(classBody, /absoluteTarget|destroyOnlyPreview|hostQuit|helperPath/i);
  const contentPreload = source('src/preload/onlypreview/onlypreviewContent.preload.ts');
  const envType = source('src/preload/onlypreview/onlypreview.preload.type.ts');
  assert.match(contentPreload, /onlypreview-office-broker-capability/);
  assert.match(contentPreload, /brokerCapability/);
  assert.doesNotMatch(envType, /brokerCapability|officeBroker/i);
});

test('OnlyPreview window commands stay host-capability scoped and Shell-owned', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');

  for (const method of ['minimizeWindow', 'toggleMaximizeWindow', 'closeWindow']) {
    assert.match(
      types,
      new RegExp(`${method}\\(params: OnlyPreviewHostRequest\\): Promise<OnlyPreviewResult<void>>`)
    );
    assert.match(handler, new RegExp(`params: ApiParams<'${method}'>`));
    assert.match(shellStore, new RegExp(`onlyPreviewClient\\.${method}\\(\\{ hostToken \\}\\)`));
  }

  assert.match(shellApp, /name="onlypreview__menuBar"/);
  assert.match(shellApp, /name="onlypreview__identity"/);
  assert.match(shellApp, /name="onlypreview__menuActions"/);
  assert.match(shellApp, /name="onlypreview__openFolder"[\s\S]*topbar\.openFolder/);
  assert.doesNotMatch(shellApp, /name="onlypreview__(?:openFile|refresh)"/);
  assert.match(
    shellApp,
    /name="onlypreview__settings"[\s\S]*:title="onlyPreviewI18n\.topbar\.settings"/
  );
  for (const control of ['minimize', 'maximize', 'close']) {
    assert.match(shellApp, new RegExp(`name="onlypreview__${control}"`));
    assert.match(i18n, new RegExp(`${control}: '.*OnlyPreview`));
  }
  assert.match(shellApp, /const isMac = onlyPreviewEnv\.platform === 'darwin'/);
  assert.match(shellApp, /const isWindows = onlyPreviewEnv\.platform === 'win32'/);
  assert.match(shellApp, /@dblclick="handleMenuBarDoubleClick"/);
  assert.match(
    shellApp,
    /closest\('\.onlypreview-shell__menu-actions'\)[\s\S]*toggleMaximizeWindow\(\)/
  );
  assert.doesNotMatch(shellApp, /eyesOnAgents|EyesOnAgents/);
  assert.doesNotMatch(shellStore, /eyesOnAgents|EyesOnAgents/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-bar \{[\s\S]*height:\s*32px/);
  assert.match(shellStyle, /background:\s*var\(--onlypreview-royal\)/);
  assert.match(shellStyle, /border-bottom:\s*1px solid #3d4666/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-bar--mac \{[\s\S]*padding-left:\s*78px/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-actions[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-actions \.arco-btn \{[\s\S]*height:\s*27px/);
  assert.match(shellStyle, /\.arco-btn:focus-visible[\s\S]*outline:\s*2px solid/);
});

test('workspace updates have one authoritative event path and stale search snapshots are discarded', () => {
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const broadcastWorkspaceBody = handler.slice(
    handler.indexOf('const broadcastWorkspace'),
    handler.indexOf('const recentDirectoryStorage')
  );
  assert.equal(
    (
      broadcastWorkspaceBody.match(/xpcMain\.broadcast\(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT/g) ??
      []
    ).length,
    1
  );
  assert.doesNotMatch(broadcastWorkspaceBody, /ONLY_PREVIEW_SELECTION_CHANGED_EVENT/);

  const selectStandaloneBody = handler.slice(
    handler.indexOf('async selectStandaloneFile('),
    handler.indexOf('async updatePreviewBounds(')
  );
  assert.match(
    handler,
    /onlyPreviewHostRegistry\.onRevoke[\s\S]*onlyPreviewSelectionCoordinator\.revoke/
  );
  assert.match(
    selectStandaloneBody,
    /onlyPreviewSelectionCoordinator\.beginSelection\(host\.hostToken, fileRef\)/
  );
  assert.match(selectStandaloneBody, /await fileSearchWindowService\.authorizeProjectItem/);
  assert.match(
    selectStandaloneBody,
    /if \(!onlyPreviewSelectionCoordinator\.isCurrent\(host\.hostToken, generation\)\) return;[\s\S]*onlyPreviewWorkspaceRegistry\.select[\s\S]*ONLY_PREVIEW_SELECTION_CHANGED_EVENT[\s\S]*finally[\s\S]*onlyPreviewSelectionCoordinator\.finishSelection\(host\.hostToken, generation\)/
  );

  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const chooseFolderBody = shellStore.slice(
    shellStore.indexOf('async chooseFolder()'),
    shellStore.indexOf('async refresh()')
  );
  assert.match(chooseFolderBody, /onlyPreviewClient\.chooseFolder/);
  assert.doesNotMatch(chooseFolderBody, /applyWorkspace\(|this\.workspace\s*=/);

  const initializeIndexBody = shellStore.slice(
    shellStore.indexOf('private async initializeIndex()'),
    shellStore.indexOf('private async refreshIndex()')
  );
  assert.match(initializeIndexBody, /const workspaceId = workspace\.workspaceId/);
  assert.match(initializeIndexBody, /const generation = this\.searchWorkspaceGeneration/);
  assert.match(
    initializeIndexBody,
    /onlyPreviewSearchClient\.initialize\(\{[\s\S]*hostToken,[\s\S]*workspaceId,[\s\S]*generation[\s\S]*\}\)/
  );
  assert.match(initializeIndexBody, /await this\.applySearchSnapshot\(snapshot\)/);

  const refreshIndexBody = shellStore.slice(
    shellStore.indexOf('private async refreshIndex()'),
    shellStore.indexOf('private async applySearchSnapshot(')
  );
  assert.match(
    refreshIndexBody,
    /onlyPreviewSearchClient\.refresh\(\{ hostToken, workspaceId, generation \}\)/
  );

  const applySnapshotBody = shellStore.slice(
    shellStore.indexOf('private async applySearchSnapshot('),
    shellStore.indexOf('private applyBrowseListing(')
  );
  assert.match(
    applySnapshotBody,
    /snapshot\.workspaceId !== workspace\.workspaceId[\s\S]*snapshot\.generation !== this\.searchWorkspaceGeneration[\s\S]*snapshot\.index\.workspaceId !== workspace\.workspaceId/
  );
  assert.match(applySnapshotBody, /snapshot\.state !== 'ready'/);
  assert.match(applySnapshotBody, /settleOnlyPreviewSearchProgress\(this\.indexProgressState\)/);
  assert.match(applySnapshotBody, /await this\.loadSelectedParentListings\(\)/);
  assert.doesNotMatch(
    applySnapshotBody,
    /searchSnapshotRevision|includeExplicitSelection|this\.index\s*=|snapshot\.index\.entries/
  );

  const selectFileBody = shellStore.slice(
    shellStore.indexOf('private async selectFile('),
    shellStore.indexOf('private expandSelectedParents()')
  );
  assert.match(selectFileBody, /const generation = \+\+this\.selectionGeneration/);
  assert.match(
    selectFileBody,
    /catch \(error\)[\s\S]*if \(generation !== this\.selectionGeneration\) return;[\s\S]*await this\.syncSelection\(\)/
  );
  assert.doesNotMatch(handler, /buildIndex/);
});

test('file-search browse and progress stay capability-scoped while the Project rail stays copy-free', () => {
  const searchTypes = source('src/shared/onlypreview/onlyPreviewSearch.type.ts');
  const mainTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const runtime = source('src/preload/fileSearch/fileSearchRuntime.ts');
  const rpc = source('src/main/fileSearch/fileSearchRuntimeRelay.service.ts');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellEvents = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  const browseProjection = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts'
  );
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');

  assert.match(searchTypes, /ONLY_PREVIEW_BROWSE_LISTING_EVENT = 'onlypreview\/browse-listing'/);
  assert.match(searchTypes, /ONLY_PREVIEW_SEARCH_PROGRESS_EVENT = 'onlypreview\/search-progress'/);
  const progressType = searchTypes.slice(
    searchTypes.indexOf('export type OnlyPreviewSearchBuildProgress'),
    searchTypes.indexOf('export interface OnlyPreviewSearchProgressEvent')
  );
  assert.match(progressType, /workspaceId: string/);
  assert.match(progressType, /generation: number/);
  assert.match(progressType, /buildRevision: number/);
  assert.match(progressType, /phase: 'counting'/);
  assert.match(progressType, /phase: 'indexing'/);
  assert.match(progressType, /completed: number/);
  assert.match(progressType, /total: number/);
  assert.doesNotMatch(
    progressType,
    /relativePath|absolutePath|displayPath|filename|content|settings/
  );
  const browseRequestType = searchTypes.slice(
    searchTypes.indexOf('export interface OnlyPreviewBrowseDirectoryRequest'),
    searchTypes.indexOf('export type OnlyPreviewSearchScope')
  );
  assert.match(browseRequestType, /hostToken: string/);
  assert.match(browseRequestType, /workspaceId: string/);
  assert.match(browseRequestType, /generation: number/);
  assert.match(browseRequestType, /directoryToken: string/);
  assert.doesNotMatch(browseRequestType, /relativePath|absolutePath|displayPath/);
  assert.doesNotMatch(mainTypes, /\blistDirectory\s*\(|\bbuildIndex\s*\(/);
  assert.doesNotMatch(handler, /\basync listDirectory\s*\(|\basync buildIndex\s*\(/);

  assert.match(
    runtime,
    /onBrowseListing:[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent[\s\S]*ONLY_PREVIEW_BROWSE_LISTING_EVENT/
  );
  assert.match(
    runtime,
    /onProgress:[\s\S]*isOnlyPreviewSearchRuntimeEventCurrent[\s\S]*ONLY_PREVIEW_SEARCH_PROGRESS_EVENT/
  );
  assert.match(rpc, /ONLY_PREVIEW_BROWSE_LISTING_EVENT/);
  assert.match(rpc, /ONLY_PREVIEW_SEARCH_PROGRESS_EVENT/);
  assert.doesNotMatch(rpc, /readdir|readFile|node:sqlite|database\.exec/);

  assert.ok(shellStore.split(/\r?\n/).length < 800);
  assert.match(shellEvents, /value\.hostId === hostId/);
  assert.match(shellEvents, /isOnlyPreviewBrowseListingEvent\(params\)/);
  assert.match(
    browseProjection,
    /onlyPreviewSearchClient\.browseDirectory\(\{[\s\S]*\.\.\.context,[\s\S]*directoryToken[\s\S]*\}\)/
  );
  assert.match(
    browseProjection,
    /requestRevisionByToken\.get\(directoryToken\) !== requestRevision[\s\S]*directoryTokenByPath\.get\(relativePath\) !== directoryToken[\s\S]*listing\.directoryToken !== directoryToken/
  );
  assert.match(browseProjection, /requestRevisionByToken\.delete\(listing\.directoryToken\)/);
  assert.match(shellEvents, /isOnlyPreviewSearchProgressEvent\(params\)/);
  assert.match(
    shellStore,
    /reduceOnlyPreviewSearchProgress\([\s\S]*workspaceId: workspace\.workspaceId,[\s\S]*generation: this\.searchWorkspaceGeneration/
  );
  assert.match(shellStore, /settleOnlyPreviewSearchProgress\(this\.indexProgressState\)/);

  const progressMarkup = shellApp.slice(
    shellApp.indexOf('name="onlypreview__indexProgress"'),
    shellApp.indexOf('</aside>')
  );
  assert.match(
    progressMarkup,
    /onlypreview-shell__index-progress--\$\{onlyPreviewShellStore\.indexProgress\.phase\}/
  );
  assert.match(progressMarkup, /:aria-label="onlyPreviewI18n\.project\.indexProgressLabel"/);
  assert.doesNotMatch(progressMarkup, /\{\{|\bv-text\b|>\s*[^<\s][^<]*</);
  assert.match(
    shellStyle,
    /\.onlypreview-shell__index-progress \{[\s\S]*height:\s*2px[\s\S]*flex:\s*0 0 2px[\s\S]*margin-top:\s*auto/
  );
  assert.match(shellStyle, /onlypreview-index-counting[\s\S]*infinite/);
  assert.match(
    shellStyle,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*index-progress--counting[\s\S]*animation:\s*none/
  );
  assert.doesNotMatch(shellApp, /onlypreview__truncated|index-state|indexStatus|truncatedMessage/);
  assert.doesNotMatch(
    shellApp,
    /indexPartial|indexReady|Search covers the first|搜索覆盖按层级排列的前/
  );
  assert.match(i18n, /indexProgressLabel:\s*'Building project search index'/);
  assert.match(i18n, /indexProgressLabel:\s*'正在建立项目搜索索引'/);
});

test('Project browse exclusion markers stay listing-only and survive the Renderer projection', () => {
  const searchTypes = source('src/shared/onlypreview/onlyPreviewSearch.type.ts');
  const indexTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const browseIndex = source('src/preload/onlypreview/search/core/browse-index.mjs');
  const relay = source('src/main/fileSearch/fileSearchRuntimeRelay.service.ts');
  const rendererValidator = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewBrowseListing.service.ts'
  );
  const browseProjection = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts'
  );
  const treeTypes = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.type.ts');
  const tree = source('src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts');

  const browseEntryType = searchTypes.slice(
    searchTypes.indexOf('export interface OnlyPreviewBrowseEntry'),
    searchTypes.indexOf('export interface OnlyPreviewDirectoryPreviewEntry')
  );
  assert.match(browseEntryType, /directoryToken: string \| null/);
  assert.match(browseEntryType, /searchExcluded: boolean/);
  const directoryPreviewEntryType = searchTypes.slice(
    searchTypes.indexOf('export interface OnlyPreviewDirectoryPreviewEntry'),
    searchTypes.indexOf('export interface OnlyPreviewBrowseListing')
  );
  assert.doesNotMatch(directoryPreviewEntryType, /searchExcluded/);
  assert.doesNotMatch(indexTypes, /searchExcluded/);

  assert.match(browseIndex, /const \{ relativePath, ancestorBlocked \} = capability/);
  assert.match(
    browseIndex,
    /ancestorBlocked \|\|[\s\S]*directlyExcluded &&[\s\S]*!this\.searchPolicy\.canTraverseExcludedDirectoryPath\(childRelativePath\)/
  );
  assert.match(browseIndex, /this\.pathByToken\.set\(token, \{ relativePath, ancestorBlocked \}\)/);

  assert.match(relay, /withDirectoryToken \? \['directoryToken', 'searchExcluded'\] : \[\]/);
  assert.match(relay, /withDirectoryToken && typeof value\.searchExcluded !== 'boolean'/);
  assert.match(
    rendererValidator,
    /'directoryToken',\s*'searchExcluded'[\s\S]*typeof value\.searchExcluded !== 'boolean'/
  );
  assert.match(
    rendererValidator,
    /value\.nodeKind === 'symlink'[\s\S]*value\.searchExcluded === false/
  );
  assert.match(browseProjection, /private readonly excludedPaths = new Set<string>\(\)/);
  assert.match(
    browseProjection,
    /if \(entry\.searchExcluded\) this\.excludedPaths\.add\(entry\.relativePath\)[\s\S]*entries\.push\(toIndexEntry\(entry\)\)/
  );
  assert.match(treeTypes, /searchExcluded: boolean/);
  assert.match(tree, /searchExcluded: searchExcludedPaths\.has\(entry\.relativePath\)/);
  assert.match(tree, /depth: 0,[\s\S]*hasChildren: true,[\s\S]*searchExcluded: false/);
});

test('OnlyPreview folder-first chrome, current-file locator, and native file menu stay capability scoped', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const explicitOpen = source('src/main/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const nativeActions = source('src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const previewSurface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  const previewStyle = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less'
  );
  const onlyPreviewI18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const nativeEnglish = source('src/renderer/common/i18n/en.ts');
  const nativeChinese = source('src/renderer/common/i18n/zh.ts');
  const workspaceRegistry = source('src/main/onlypreview/onlyPreviewWorkspace.registry.ts');

  assert.ok(handler.split(/\r?\n/).length < 800);
  const bindingBody = handler.slice(
    handler.indexOf('bindWorkspace: async (hostToken, workspace) =>'),
    handler.indexOf('onlyPreviewHostRegistry.onRevoke')
  );
  assert.ok(
    bindingBody.indexOf('bindProjectWorkspace') < bindingBody.indexOf('bindProjectAuthority')
  );
  assert.doesNotMatch(bindingBody, /bindPreviewReadWorkspace|bindOfficeWorkspace/);
  assert.match(
    bindingBody,
    /revokeProjectWorkspace\(\{[\s\S]*workspaceId: workspace\.workspaceId,[\s\S]*workspaceGeneration: binding\.workspaceGeneration/
  );
  assert.match(workspaceRegistry, /projectAuthorityPending: true/);
  assert.match(
    workspaceRegistry,
    /workspace\?\.kind === 'project' && !workspace\.projectAuthorityPending[\s\S]*\? toSnapshot\(workspace\)[\s\S]*: null/
  );

  assert.match(
    types,
    /chooseFolder\(\s*params: OnlyPreviewHostRequest\s*\): Promise<OnlyPreviewResult<OnlyPreviewWorkspace \| null>>/
  );
  assert.match(
    types,
    /showFileContextMenu\(\s*params: OnlyPreviewHostRequest & OnlyPreviewFileRef\s*\): Promise<OnlyPreviewResult<void>>/
  );
  assert.match(
    types,
    /copyProjectItem\(params: OnlyPreviewProjectItemCopyRequest\): Promise<OnlyPreviewResult<void>>/
  );
  assert.match(
    types,
    /showProjectRootContextMenu\([\s\S]*params: OnlyPreviewProjectRootRequest[\s\S]*Promise<OnlyPreviewResult<void>>/
  );
  assert.match(
    types,
    /copyProjectRoot\(params: OnlyPreviewProjectRootCopyRequest\): Promise<OnlyPreviewResult<void>>/
  );
  assert.doesNotMatch(types, /OnlyPreviewTargetKind|chooseTarget/);
  assert.doesNotMatch(handler, /parseTargetKind|chooseTarget/);
  assert.doesNotMatch(shellStore, /chooseTarget|chooseFile/);
  assert.match(handler, /properties:\s*\['openDirectory'\]/);
  assert.match(windowHelper, /if \(key === 'o'\) return 'choose-folder'/);
  assert.match(
    explicitOpen,
    /performOpenOnlyPreviewAbsoluteTarget[\s\S]*openExplicitTarget\([\s\S]*host\.hostToken,[\s\S]*target,[\s\S]*recentGeneration/
  );

  assert.match(shellApp, /name="onlypreview__openFolder"/);
  assert.doesNotMatch(shellApp, /name="onlypreview__(?:openFile|refresh)"/);
  assert.doesNotMatch(shellApp, /index\.entries\.length|project-count|preview\.readOnly/);
  assert.doesNotMatch(onlyPreviewI18n, /itemCount|openFile:\s*|refresh:\s*/);
  assert.doesNotMatch(previewSurface, /IconLock|badge--read-only|preview\.readOnly/);
  assert.doesNotMatch(previewStyle, /badge--read-only/);

  assert.match(shellApp, /IconCrosshair/);
  assert.match(shellApp, /name="onlypreview__locateCurrentFile"/);
  assert.match(shellApp, /:disabled="!onlyPreviewShellStore\.selectedEntry"/);
  assert.match(
    shellStore,
    /async locateSelectedFile\(\): Promise<string> \{[\s\S]*this\.expandSelectedParents\(\)[\s\S]*await this\.loadSelectedParentListings\(\)[\s\S]*this\.focusedRelativePath = this\.selectedEntry\.relativePath/
  );
  assert.match(shellApp, /scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(shellApp, /item\.focus\(center \? \{ preventScroll: true \} : undefined\)/);
  assert.match(shellStyle, /\.onlypreview-shell__project-action\.arco-btn \{[\s\S]*height:\s*27px/);
  assert.match(shellStyle, /\.onlypreview-shell__project-action\.arco-btn:focus-visible/);

  assert.match(
    shellApp,
    /@contextmenu\.prevent\.stop="onlyPreviewShellStore\.showFileContextMenu\(row\.entry\)"/
  );
  assert.match(
    shellStore,
    /showFileContextMenu\(entry: OnlyPreviewIndexEntry \| string\)[\s\S]*entry\.nodeKind === 'symlink'[\s\S]*onlyPreviewClient\.showFileContextMenu/
  );
  assert.doesNotMatch(shellStore, /clipboard|absolutePath/);
  const menuBody = nativeActions.slice(
    nativeActions.indexOf('async showFileContextMenu('),
    nativeActions.indexOf('async showProjectRootContextMenu(')
  );
  const deleteBody = nativeActions.slice(
    nativeActions.indexOf('private async deleteFileFromMenu('),
    nativeActions.indexOf('private requireCurrentItem(')
  );
  const copyBody = nativeActions.slice(
    nativeActions.indexOf('async copyProjectItemFromUi('),
    nativeActions.indexOf('async copyProjectRootFromUi(')
  );
  const rootMenuBody = nativeActions.slice(
    nativeActions.indexOf('async showProjectRootContextMenu('),
    nativeActions.indexOf('async copyProjectItemFromUi(')
  );
  const rootCopyBody = nativeActions.slice(
    nativeActions.indexOf('async copyProjectRootFromUi('),
    nativeActions.indexOf('async openExternally(')
  );
  const publicRootCopyBody = handler.slice(
    handler.indexOf('async copyProjectRoot('),
    handler.indexOf('async openExternally(')
  );
  assert.match(
    menuBody,
    /getProjectAuthorityItemRef\([\s\S]*fileSearchWindowService\.authorizeProjectItem\([\s\S]*requireCurrentItem\(authority\)/
  );
  assert.match(
    menuBody,
    /if \(item\.nodeKind === 'file'\)[\s\S]*onlypreview-preview[\s\S]*onlypreview-open-externally/
  );
  assert.match(
    menuBody,
    /onlypreview-reveal-in-folder[\s\S]*onlypreview-copy-item[\s\S]*onlypreview-copy-path[\s\S]*onlypreview-copy-relative-path[\s\S]*onlypreview-copy-name/
  );
  assert.match(menuBody, /item\.nodeKind === 'file' \? labels\.copyFile : labels\.copyFolder/);
  assert.match(menuBody, /if \(item\.nodeKind === 'file'\)[\s\S]*onlypreview-delete/);
  assert.match(menuBody, /i18nHelper\.getMessages\(\)\.app\.onlyPreviewFileMenu/);
  for (const id of [
    'onlypreview-preview',
    'onlypreview-open-externally',
    'onlypreview-reveal-in-folder',
    'onlypreview-copy-item',
    'onlypreview-copy-path',
    'onlypreview-copy-relative-path',
    'onlypreview-copy-name',
    'onlypreview-delete'
  ]) {
    assert.match(menuBody, new RegExp(`id: '${id}'`));
  }
  assert.match(menuBody, /click: \(\) => actions\.preview\(currentRequest\)/);
  assert.match(menuBody, /click: \(\) => actions\.openExternally\(currentRequest\)/);
  assert.match(menuBody, /click: \(\) => actions\.revealInFolder\(currentRequest\)/);
  assert.match(menuBody, /copyProjectItemFromUi\(window, currentRequest, 'item'\)/);
  assert.match(menuBody, /copyProjectItemFromUi\(window, currentRequest, 'absolute-path'\)/);
  assert.match(menuBody, /copyProjectItemFromUi\(window, currentRequest, 'relative-path'\)/);
  assert.match(menuBody, /copyProjectItemFromUi\(window, currentRequest, 'name'\)/);
  assert.match(menuBody, /accelerator: 'CommandOrControl\+C'/);
  assert.match(menuBody, /accelerator: 'CommandOrControl\+Shift\+C'/);
  assert.match(menuBody, /accelerator: 'CommandOrControl\+Alt\+C'/);
  assert.match(menuBody, /click: \(\) => void this\.deleteFileFromMenu\(window, currentRequest\)/);
  assert.match(
    menuBody,
    /onlypreview-reveal-in-folder[\s\S]*type: 'separator'[\s\S]*onlypreview-delete/
  );
  assert.match(menuBody, /Menu\.buildFromTemplate\([\s\S]*\.popup\(\{ window \}\)/);
  assert.doesNotMatch(menuBody, /realPath/);
  assert.doesNotMatch(types, /\bdeleteFile\s*\(/);
  assert.match(
    copyBody,
    /getProjectAuthorityItemRef\([\s\S]*authorizeProjectItem\([\s\S]*requireCurrentItem\(authority\)[\s\S]*onlyPreviewClipboardService\.copyProjectItem\([\s\S]*showCopyFailure/
  );
  const publicCopyBody = handler.slice(
    handler.indexOf('async copyProjectItem('),
    handler.indexOf('async showProjectRootContextMenu(')
  );
  assert.match(publicCopyBody, /parseOnlyPreviewProjectItemCopyRequest\(params\)/);
  assert.match(publicCopyBody, /onlyPreviewProjectNativeActionService\.copyProjectItemFromUi\(/);
  assert.doesNotMatch(publicCopyBody, /return .*Path|realPath/);
  assert.match(
    rootMenuBody,
    /getProjectAuthorityRootRef\([\s\S]*request\.hostToken,[\s\S]*request\.workspaceId[\s\S]*authorizeProjectRoot\([\s\S]*requireCurrentRoot\(authority\)/
  );
  assert.match(
    rootMenuBody,
    /onlypreview-reveal-project-root[\s\S]*onlypreview-copy-project-root[\s\S]*onlypreview-copy-project-root-path[\s\S]*onlypreview-copy-project-root-relative-path[\s\S]*onlypreview-copy-project-root-name/
  );
  assert.doesNotMatch(rootMenuBody, /onlypreview-delete|deleteOnlyPreviewFileFromMenu/);
  assert.match(publicRootCopyBody, /parseOnlyPreviewProjectRootCopyRequest\(params\)/);
  assert.match(
    publicRootCopyBody,
    /onlyPreviewProjectNativeActionService\.copyProjectRootFromUi\([\s\S]*request\.copyKind/
  );
  assert.match(
    rootCopyBody,
    /authorizeProjectRoot\([\s\S]*requireCurrentRoot\(authority\)[\s\S]*onlyPreviewClipboardService\.copyProjectItem/
  );
  assert.match(
    deleteBody,
    /getProjectAuthorityItemRef\([\s\S]*prepareProjectDelete\([\s\S]*dialog\.showMessageBox\(window/
  );
  assert.match(deleteBody, /buttons: \[labels\.deleteCancelButton, labels\.deleteConfirmButton\]/);
  assert.match(deleteBody, /defaultId: 0[\s\S]*cancelId: 0[\s\S]*destructiveId: 1/);
  assert.match(
    deleteBody,
    /if \(confirmation\.response !== 1\)[\s\S]*cancelDelete\(authority, prepared\.grantId\)[\s\S]*return/
  );
  assert.match(deleteBody, /getProjectAuthorityItemRef\([\s\S]*commitProjectDelete\(/);
  assert.match(
    deleteBody,
    /commitProjectDelete\([\s\S]*onlyPreviewSelectionCoordinator\.invalidatePendingSelection\(authority\.host\.hostToken[\s\S]*clearSelection\(authority\.host\.hostToken[\s\S]*clearWorkspace\([\s\S]*ONLY_PREVIEW_SELECTION_CHANGED_EVENT/
  );
  const preDeleteSuccessBody = deleteBody.slice(0, deleteBody.indexOf('commitProjectDelete({'));
  assert.doesNotMatch(preDeleteSuccessBody, /invalidatePendingSelection/);
  const postDeleteBody = deleteBody.slice(deleteBody.indexOf('commitProjectDelete({'));
  assert.doesNotMatch(postDeleteBody, /onlyPreviewSelectionCoordinator\.advance/);
  assert.doesNotMatch(handler, /selectionGenerationByHost/);
  assert.doesNotMatch(deleteBody, /broadcastWorkspace\(/);
  const projectAuthority = source('src/preload/fileSearch/fileSearchProjectAuthority.service.ts');
  const commitDeleteBody = projectAuthority.slice(
    projectAuthority.indexOf('async commitDelete('),
    projectAuthority.indexOf('cancelDelete(')
  );
  assert.match(commitDeleteBody, /requirePinnedDeleteIdentity\(prepared\)/);
  assert.match(commitDeleteBody, /isolateDeleteEntry\(prepared\.canonicalPath\)/);
  assert.match(commitDeleteBody, /requireIsolatedDeleteIdentity\(prepared, isolated, workspace\)/);
  assert.match(commitDeleteBody, /fileOperations\.unlink\(isolated\.entryPath\)/);
  assert.doesNotMatch(commitDeleteBody, /readFile|\.read\(/);
  assert.doesNotMatch(deleteBody, /deleteOpenedFile|onlyPreviewWorkspaceRegistry\.openFile/);
  for (const catalog of [nativeEnglish, nativeChinese]) {
    assert.match(
      catalog,
      /onlyPreviewFileMenu:[\s\S]*preview:[\s\S]*openExternally:[\s\S]*revealInFolder:[\s\S]*copyFile:[\s\S]*copyFolder:[\s\S]*copyPath:[\s\S]*copyRelativePath:[\s\S]*copyName:[\s\S]*copyFailureTitle:[\s\S]*delete:[\s\S]*deleteConfirmTitle:[\s\S]*deleteFailureTitle:/
    );
  }
});

test('OnlyPreview Settings restores size but derives parented work-area bounds on every open', () => {
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const boundsService = source('src/main/onlypreview/onlyPreviewWindowBounds.service.ts');
  const positioning = windowHelper.slice(
    windowHelper.indexOf('const settingsBoundsForParent'),
    windowHelper.indexOf('export class OnlyPreviewWindowHelper')
  );
  const openSettings = windowHelper.slice(
    windowHelper.indexOf('async openSettings('),
    windowHelper.indexOf('closeSettings(')
  );

  assert.match(positioning, /screen\.getDisplayMatching\(parentBounds\)\.workArea/);
  assert.match(positioning, /resolveOnlyPreviewSettingsBounds\(\{/);
  assert.match(positioning, /minWidth: MIN_WIDTH[\s\S]*minHeight: MIN_HEIGHT/);
  assert.match(
    boundsService,
    /Math\.min\(Math\.round\(request\.width\), Math\.max\(workArea\.width, minWidth\)\)/
  );
  assert.match(
    boundsService,
    /Math\.min\(Math\.round\(request\.height\), Math\.max\(workArea\.height, minHeight\)\)/
  );
  assert.match(boundsService, /Math\.min\(maxX, Math\.max\(workArea\.x, centeredX\)\)/);
  assert.match(boundsService, /Math\.min\(maxY, Math\.max\(workArea\.y, centeredY\)\)/);
  assert.match(
    openSettings,
    /const parentWindow = this\.requireStandaloneWindow\(sourceHostToken\)/
  );
  assert.match(openSettings, /restored\?\.bounds\.width[\s\S]*restored\?\.bounds\.height/);
  assert.doesNotMatch(openSettings, /restored\.bounds\.(?:x|y)/);
  assert.match(openSettings, /parent: parentWindow/);
  assert.match(openSettings, /settingsBoundsForParent\(parentWindow\.getBounds\(\)/);
  assert.match(openSettings, /window\.show\(\);[\s\S]*window\.focus\(\)/);
  assert.doesNotMatch(openSettings, /settingsWindowState\?\.show\(\)/);
});
