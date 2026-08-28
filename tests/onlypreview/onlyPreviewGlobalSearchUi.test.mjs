import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs';

test('result preview variants are lazy and active HTML cannot retain active content', () => {
  const host = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.vue'
  );
  const sanitizer = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/onlyPreviewStaticHtml.service.ts'
  );
  const rich = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/RichSearchPreview.vue'
  );

  assert.equal((host.match(/defineAsyncComponent\(/g) || []).length, 6);
  for (const variant of ['plain', 'markdown', 'html-static', 'directory', 'context', 'info']) {
    assert.match(host, new RegExp(`['"]?${variant.replace('-', '\\-')}['"]?`));
  }
  assert.doesNotMatch(host + rich, /<iframe|srcdoc/);
  assert.match(sanitizer, /ALLOWED_ATTR:\s*\[\]/);
  assert.match(sanitizer, /FORBID_TAGS/);
  for (const blocked of ['script', 'iframe', 'form', 'img', 'audio', 'video', 'style']) {
    assert.match(sanitizer, new RegExp(`'${blocked}'`));
  }
  assert.match(rich, /renderOnlyPreviewMarkdown/);
  assert.match(rich, /sanitizeOnlyPreviewStaticHtml/);
});

test('Files and Contents rows expose title, relative directory, snippet, and explicit open', () => {
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const row = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/SearchResultRow.vue'
  );
  assert.ok(workspace.indexOf('section="files"') < workspace.indexOf('section="contents"'));
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

test('Project selection is the only live Current directory sync path and folder reveal centers once', () => {
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
    /this\.treeSelectedRelativePath = entry\.relativePath[\s\S]*syncCurrentDirectory/
  );
  assert.doesNotMatch(focusOnly, /syncCurrentDirectory/);
  assert.doesNotMatch(moveFocus, /syncCurrentDirectory/);

  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(
    app,
    /consumeCenteredProjectPath\(\)[\s\S]*restoreOnlyPreviewGlobalSearchFocus\('discard'\)[\s\S]*focusTreePath\(centeredProjectPath, true\)/
  );
});

test('native shortcuts reserve only Shift+Cmd/Ctrl+F for Global Search', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const globalShortcut = helper.slice(
    helper.indexOf('const isGlobalSearchShortcut'),
    helper.indexOf('const isHiddenPreviewBounds')
  );
  assert.match(globalShortcut, /!input\.shift/);
  assert.match(globalShortcut, /input\.alt/);
  assert.doesNotMatch(globalShortcut, /input\.shift === input\.alt/);
  assert.match(helper, /if \(isGlobalSearchShortcut\(input\)\) return 'focus-search'/);
  assert.match(helper, /if \(isCurrentFileFindShortcut\(input\)\) return 'find-in-file'/);
});

test('Find to Global Search closes Find without hidden Preview focus for every shortcut origin', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const focusBranch = helper.slice(
    helper.indexOf("if (command === 'focus-search')"),
    helper.indexOf("if (command === 'focus-project')")
  );
  assert.ok(focusBranch.indexOf('closeFind(host.hostToken)') < focusBranch.indexOf('.capture('));
  assert.ok(focusBranch.indexOf('.capture(') < focusBranch.indexOf('shellView.webContents.focus()'));
  assert.ok(
    focusBranch.indexOf('shellView.webContents.focus()') <
      focusBranch.indexOf('ONLY_PREVIEW_FOCUS_SEARCH_EVENT')
  );
  assert.doesNotMatch(focusBranch, /focusActiveContent/);
  assert.match(helper, /bindNativeShortcuts\(webContents, host, 'chrome'\)/);
  assert.match(
    helper,
    /bindNativeShortcuts\(view\.webContents, host, mode === 'shell' \? 'shell' : 'vue'\)/
  );
  const shellEvents = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  assert.match(shellEvents, /event\.origin === 'shell'[\s\S]*event\.origin === 'vue'[\s\S]*event\.origin === 'chrome'/);
  assert.match(shellEvents, /handlers\.focusSearch\(params\.origin\)/);

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

test('removed Project Search style and catalog surface does not remain', () => {
  const style = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.doesNotMatch(style, /onlypreview-shell__(?:search|project-search-scope|scope-control|scope-label|scope-select|scope-target)/);
  assert.doesNotMatch(i18n, /projectSearch|Filter files and folders|筛选文件和文件夹/);
});
