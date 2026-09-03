/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs';

test('result preview uses lazy Vue Preview-style file surfaces and inert HTML', () => {
  const host = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.vue'
  );
  const style = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.less'
  );
  const sanitizer = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/onlyPreviewStaticHtml.service.ts'
  );
  const rich = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/RichSearchPreview.vue'
  );

  assert.equal((host.match(/defineAsyncComponent\(/g) || []).length, 6);
  for (const variant of ['plain', 'markdown', 'html-static', 'directory', 'office', 'info']) {
    assert.match(host, new RegExp(`['"]?${variant.replace('-', '\\-')}['"]?`));
  }
  assert.doesNotMatch(host + rich + style, /ContextSearchPreview|globalSearchContextPreview/);
  assert.doesNotMatch(host + rich, /<iframe|srcdoc/);
  assert.match(sanitizer, /ALLOWED_ATTR:\s*\[\]/);
  assert.match(sanitizer, /FORBID_TAGS/);
  for (const blocked of ['script', 'iframe', 'form', 'img', 'audio', 'video', 'style']) {
    assert.match(sanitizer, new RegExp(`'${blocked}'`));
  }
  assert.match(rich, /renderOnlyPreviewMarkdown/);
  assert.match(rich, /sanitizeOnlyPreviewStaticHtml/);
  assert.match(rich, /onlypreview-markdown__document/);
  assert.match(
    style,
    /@import '\.\.\/\.\.\/\.\.\/\.\.\/preview\/src\/components\/MarkdownPreview\/MarkdownPreview\.less'/
  );
  assert.match(
    style,
    /\.onlypreview-search-preview__plain\s*\{[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*1\.55;[\s\S]*white-space:\s*pre;/
  );
  assert.match(style, /\.onlypreview-search-preview__plain\s*\{[\s\S]*background:\s*#fff;/);
});

test('directory Preview entries use 13px semibold typography', () => {
  const style = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.less'
  );

  assert.match(
    style,
    /\.onlypreview-search-preview__directory-entry\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?font-weight:\s*600;[\s\S]*?\}/
  );
});

test('Contents and Files rows expose title, relative directory, snippet, and explicit open', () => {
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const row = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/SearchResultRow.vue'
  );
  assert.ok(workspace.indexOf('section="contents"') < workspace.indexOf('section="files"'));
  assert.match(row, /name="onlypreview__globalSearchResultTitle"/);
  assert.match(row, /result\.parentRelativePath \|\| '\.'/);
  assert.match(row, /splitOnlyPreviewContentMatch/);
  assert.match(row, /getOnlyPreviewGlobalSearchDisplayType/);
  assert.match(row, /\{\{ displayType \}\}/);
  assert.doesNotMatch(row, /\{\{ result\.mediaType \}\}/);
  assert.match(row, /@click="select"/);
  assert.match(row, /@dblclick\.prevent="open"/);
  assert.match(row, /@keydown\.enter\.exact\.prevent="select"/);
});

test('Global Search renders equal Contents-left and Files-right independent result panes', () => {
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const style = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less'
  );
  const contentsPane = workspace.indexOf('name="onlypreview__globalSearchContentsPane"');
  const filesPane = workspace.indexOf('name="onlypreview__globalSearchFilesPane"');
  const pending = workspace.indexOf('name="onlypreview__globalSearchPending"');
  const split = workspace.indexOf('name="onlypreview__globalSearchSplit"');
  const preview = workspace.indexOf('name="onlypreview__globalSearchPreviewPane"');

  assert.ok(contentsPane > -1 && contentsPane < filesPane);
  assert.ok(workspace.indexOf('section="contents"', contentsPane) < filesPane);
  assert.ok(workspace.indexOf('section="files"', filesPane) < pending);
  assert.ok(pending < split && split < preview);
  assert.match(
    style,
    /\.onlypreview-global-search__results\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    style,
    /\.onlypreview-global-search__results-pane\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/
  );
  assert.match(
    style,
    /\.onlypreview-global-search__results-pane--files\s*\{[\s\S]*?border-left:\s*1px solid var\(--onlypreview-divider\);/
  );
  assert.match(style, /\.onlypreview-global-search__status\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
  assert.match(
    style,
    /\.onlypreview-global-search__state\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*1 \/ -1;/
  );
});

test('Project selection owns Current directory and native folder reveal centers after success', () => {
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const activateEntry = shellStore.slice(
    shellStore.indexOf('private async activateEntry'),
    shellStore.indexOf('async openGlobalSearchResult')
  );
  const focusOnly = shellStore.slice(
    shellStore.indexOf('setFocusedPath'),
    shellStore.indexOf('async locateSelectedFile')
  );
  const moveFocus = shellStore.slice(
    shellStore.indexOf('moveTreeFocus'),
    shellStore.indexOf('handleTreeClick')
  );
  assert.match(
    activateEntry,
    /this\.treeSelectedRelativePath = entry\.relativePath[\s\S]*reportGlobalSearchContext\(\)/
  );
  assert.doesNotMatch(focusOnly, /syncCurrentDirectory/);
  assert.doesNotMatch(moveFocus, /syncCurrentDirectory/);

  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellReveal = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchShell.service.ts'
  );
  assert.match(
    app,
    /onlyPreviewShellStore\.centerProjectRevision[\s\S]*focusTreePath\(onlyPreviewShellStore\.centerProjectRelativePath, true\)/
  );
  assert.match(shellReveal, /if \(succeeded\) options\.onRevealed\(action\.relativePath\)/);
  assert.match(shellReveal, /completeDirectoryReveal\(action, succeeded\)/);
});

test('native shortcuts reserve only Shift+Cmd/Ctrl+F for Global Search', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  // Scoped to the predicate itself: the region between it and the bounds helper now holds the other
  // shortcut matchers, whose modifier rules are their own and are asserted with them.
  const globalShortcut = helper.slice(
    helper.indexOf('const isGlobalSearchShortcut'),
    helper.indexOf('const isProjectItemCopyShortcut')
  );
  assert.match(globalShortcut, /!input\.shift/);
  assert.match(globalShortcut, /input\.alt/);
  assert.doesNotMatch(globalShortcut, /input\.shift === input\.alt/);
  assert.match(helper, /if \(isGlobalSearchShortcut\(input\)\) return 'focus-search'/);
  assert.match(helper, /if \(isCurrentFileFindShortcut\(input\)\) return 'find-in-file'/);
});

test('Find to Global Search closes Find and delegates native overlay focus for every origin', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const windowService = source(
    'src/main/onlypreview/views/onlyPreviewGlobalSearchWindow.service.ts'
  );
  const viewService = source('src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts');
  const focusBranch = helper.slice(
    helper.indexOf("if (command === 'focus-search')"),
    helper.indexOf("if (command === 'focus-project')")
  );
  assert.ok(
    focusBranch.indexOf('closeFind(host.hostToken)') <
      focusBranch.indexOf('onlyPreviewGlobalSearchWindowService.open(host, origin, opener)')
  );
  assert.doesNotMatch(focusBranch, /shellView\.webContents\.focus|\.capture\(|xpcMain\.broadcast/);
  assert.doesNotMatch(focusBranch, /focusActiveContent/);
  assert.match(helper, /bindNativeShortcuts\(webContents, host, 'chrome'\)/);
  assert.match(helper, /mode === 'shell' \? 'shell' : mode === 'preview' \? 'vue' : 'search'/);
  assert.match(
    windowService,
    /if \(origin !== 'search'\)[\s\S]*\.capture\(host\.hostToken, origin, opener\)/
  );
  assert.match(windowService, /origin === 'search' \? 'shell' : origin/);
  assert.match(viewService, /view\.webContents\.focus\(\)[\s\S]*ONLY_PREVIEW_FOCUS_SEARCH_EVENT/);
  const shellEvents = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  assert.doesNotMatch(shellEvents, /focusSearch|ONLY_PREVIEW_FOCUS_SEARCH_EVENT/);
  assert.match(shellEvents, /ONLY_PREVIEW_GLOBAL_SEARCH_REVEAL_DIRECTORY_EVENT/);

  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  assert.match(
    workspace,
    /event\.key === 'Escape'[\s\S]*onlyPreviewGlobalSearchStore\.handleEscape\(\)/
  );
  const findService = source('src/main/onlypreview/views/onlyPreviewFind.service.ts');
  const closeFind = findService.slice(
    findService.indexOf('close(): void'),
    findService.indexOf('isOpen(): boolean')
  );
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.match(closeFind, /this\.findOpen = false[\s\S]*this\.publishState\(\)/);
  assert.match(shellStore, /findState: \(\) => void this\.syncFindState\(\)/);
});

test('Global Search focus service restores exact Vue or Chrome openers and rejects invalid ones', () => {
  const service = new runtime.OnlyPreviewGlobalSearchFocusService();
  const focused = [];
  const view = (name, destroyed = false) => ({
    focus: () => focused.push(name),
    isDestroyed: () => destroyed
  });

  service.capture('host', 'vue', view('vue'));
  service.capture('host', 'chrome', view('replacement'));
  assert.equal(service.restoreOpener('host'), true);
  assert.deepEqual(focused, ['vue']);

  service.capture('host', 'chrome', view('chrome'));
  assert.equal(service.restoreOpener('host'), true);
  assert.deepEqual(focused, ['vue', 'chrome']);

  service.capture('host', 'shell', view('shell'));
  assert.equal(service.restoreOpener('host'), false);
  service.capture('host', 'vue', view('destroyed', true));
  assert.equal(service.restoreOpener('host'), false);
  service.capture('host', 'vue', view('wrong-host'));
  assert.equal(service.restoreOpener('other-host'), false);
  assert.deepEqual(focused, ['vue', 'chrome']);
});

test('native Global Search pulls context, nudges by revision, and closes to the selected surface', () => {
  const client = source(
    'src/renderer/onlypreview/globalSearch/src/onlyPreviewGlobalSearchHost.client.ts'
  );
  const app = source('src/renderer/onlypreview/globalSearch/src/main.ts');

  assert.match(
    client,
    /ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT[\s\S]*refreshContext\(onContext, onVisibility, onLayout\)[\s\S]*await this\.refreshContext\(onContext, onVisibility, onLayout\)/
  );
  assert.match(client, /onLayout\(snapshot\.layout\)/);
  assert.match(
    client,
    /ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT[\s\S]*acceptVisibility\(params, onVisibility\)/
  );
  assert.match(
    client,
    /ONLY_PREVIEW_GLOBAL_SEARCH_LAYOUT_EVENT[\s\S]*parseGlobalSearchLayoutEvent\(params\)[\s\S]*onLayout\(event\.layout\)/
  );
  assert.match(client, /if \(snapshot\.revision < this\.snapshot\.revision\) return/);
  assert.match(client, /if \(event\.revision < this\.snapshot\.revision\) return/);
  assert.match(
    client,
    /result\.nodeKind === 'directory'[\s\S]*revealGlobalSearchDirectory[\s\S]*if \(!revealed\) return false[\s\S]*mode: 'project'/
  );
  assert.match(
    client,
    /selectStandaloneFile[\s\S]*closeGlobalSearch\(\{ hostToken, mode: 'preview' \}\)/
  );
  assert.match(
    app,
    /await onlyPreviewGlobalSearchHostClient\.initialize[\s\S]*if \(active\)[\s\S]*onlyPreviewGlobalSearchStore\.enter\(\)[\s\S]*onlyPreviewGlobalSearchStore\.exit\(false\)/
  );
  assert.doesNotMatch(app, /\n\s*onlyPreviewGlobalSearchStore\.enter\(\);/);
});

test('Global Search alone renders as one inset transparent floating surface', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const app = source('src/renderer/onlypreview/globalSearch/src/App.vue');
  const canvasStyle = source('src/renderer/onlypreview/globalSearch/src/App.less');
  const viewService = source('src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts');
  const workspaceStyle = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less'
  );
  const createView = helper.slice(
    helper.indexOf('private createView('),
    helper.indexOf('private async loadView(')
  );
  const workspaceStart = workspaceStyle.indexOf('.onlypreview-global-search {');
  const workspace = workspaceStyle.slice(
    workspaceStart,
    workspaceStyle.indexOf('\n}', workspaceStart) + 2
  );

  // Two transparent overlays now: Global Search and the alert layer. Both draw their own surface,
  // and an opaque view would blank the window behind it.
  assert.equal((helper.match(/setBackgroundColor\(/g) ?? []).length, 2);
  assert.match(helper, /if \(mode === 'alert'\) view\.setBackgroundColor\('#00000000'\);/);
  assert.match(
    createView,
    /if \(mode === 'globalSearch'\) view\.setBackgroundColor\('#00000000'\);/
  );
  assert.match(canvasStyle, /html,\s*\nbody,\s*\n#app\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(canvasStyle, /html,\s*\nbody\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(canvasStyle, /body\s*\{[\s\S]*?margin:\s*0;/);
  assert.doesNotMatch(canvasStyle, /body\s*\{[\s\S]*?padding:\s*24px;/);
  assert.match(canvasStyle, /#app\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(
    canvasStyle,
    /\.onlypreview-global-search-canvas\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/
  );
  assert.match(workspace, /overflow:\s*hidden;/);
  assert.match(workspace, /border-radius:\s*14px;/);
  assert.match(workspace, /background:\s*var\(--onlypreview-canvas\);/);
  assert.match(
    workspace,
    /box-shadow:\s*\n\s*0 12px 24px -12px rgb\(37 40 58 \/ 36%\),\s*\n\s*0 3px 8px rgb\(37 40 58 \/ 16%\);/
  );
  assert.equal((workspace.match(/rgb\(/g) ?? []).length, 2);
  assert.doesNotMatch(workspace, /(?:backdrop-)?filter\s*:/);

  assert.match(app, /FLOATING_GUTTER_PX = 24/);
  assert.match(app, /bounds\.x \+ FLOATING_GUTTER_PX/);
  assert.match(app, /bounds\.y \+ FLOATING_GUTTER_PX/);
  assert.match(app, /bounds\.width - FLOATING_GUTTER_PX \* 2/);
  assert.match(app, /bounds\.height - FLOATING_GUTTER_PX \* 2/);
  assert.match(app, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(
    app,
    /event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*onlyPreviewGlobalSearchStore\.dismiss\(\)/
  );
  assert.match(app, /class="onlypreview-global-search-canvas"/);
  assert.match(app, /@click="dismissFromTransparentCanvas"/);
  assert.match(viewService, /view\.setBounds\(\{ \.\.\.bounds \}\)/);
  assert.match(helper, /\{ x: 0, y: 0, width: contentWidth, height: contentHeight \}/);
});

test('Global Search context snapshot carries exact versioned visibility state', () => {
  const snapshot = {
    revision: 7,
    active: true,
    layout: {
      viewBounds: { x: 0, y: 0, width: 1200, height: 800 },
      workspaceBounds: { x: 280, y: 75, width: 920, height: 725 }
    },
    workspace: {
      workspaceId: 'workspace-global-search-000000',
      generation: 3,
      ready: true,
      rootName: 'bitterless',
      currentDirectoryRelativePath: 'src'
    }
  };
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchContextSnapshot(snapshot), snapshot);
  for (const invalid of [
    { ...snapshot, active: 'true' },
    { revision: snapshot.revision, workspace: snapshot.workspace },
    {
      ...snapshot,
      layout: {
        ...snapshot.layout,
        workspaceBounds: { x: 1100, y: 75, width: 920, height: 725 }
      }
    },
    { ...snapshot, extra: false }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewGlobalSearchContextSnapshot(invalid),
      (error) => error.code === 'INVALID_INPUT'
    );
  }
});

test('the full-window Search renderer retires the Shell dismissal scrim', () => {
  const shared = source('src/shared/onlypreview/onlyPreview.types.ts');
  const viewService = source('src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts');
  const shellEvents = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const style = source('src/renderer/onlypreview/shell/src/App.less');
  const searchApp = source('src/renderer/onlypreview/globalSearch/src/App.vue');

  assert.match(shared, /ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT/);
  assert.match(
    shared,
    /OnlyPreviewGlobalSearchVisibilityEvent[\s\S]*revision: number[\s\S]*active: boolean/
  );
  assert.match(
    viewService,
    /reportContext[\s\S]*broadcastVisibility\(runtime\)[\s\S]*show\([\s\S]*broadcastVisibility\(runtime\)/
  );
  assert.match(
    viewService,
    /close\([\s\S]*setActive\(false\)[\s\S]*broadcastVisibility\(runtime\)/
  );
  assert.doesNotMatch(shellEvents, /ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT/);
  assert.doesNotMatch(app, /globalSearchScrim|dismissOnlyPreviewGlobalSearch/);
  assert.doesNotMatch(style, /onlypreview-shell__global-search-scrim/);
  assert.match(searchApp, /onlyPreviewGlobalSearchStore\.dismiss\(\)/);
  assert.match(searchApp, /event\.stopImmediatePropagation\(\)/);
});

test('removed Project Search style and catalog surface does not remain', () => {
  const style = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.doesNotMatch(
    style,
    /onlypreview-shell__(?:search|project-search-scope|scope-control|scope-label|scope-select|scope-target)/
  );
  assert.doesNotMatch(i18n, /projectSearch|Filter files and folders|筛选文件和文件夹/);
});
