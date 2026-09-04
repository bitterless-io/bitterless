import assert from 'node:assert/strict';
import { test } from 'node:test';
import { source } from './onlyPreviewCoreTest.helper.mjs';

test('Shell removes the Project filter and leaves Global Search to its native renderer', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const shell = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const globalSearchApp = source('src/renderer/onlypreview/globalSearch/src/App.vue');

  assert.doesNotMatch(app, /name="onlypreview__search"|ProjectSearchResults/);
  assert.doesNotMatch(shell, /searchQuery|onlyPreviewTreeFilter|onlyPreviewProjectSearchStore/);
  assert.doesNotMatch(app, /GlobalSearchWorkspace|onlyPreviewGlobalSearchStore/);
  assert.match(app, /<section name="onlypreview__previewRegion"/);
  assert.doesNotMatch(shell, /onlyPreviewGlobalSearchStore/);
  assert.match(globalSearchApp, /<GlobalSearchWorkspace \/>/);
  assert.ok(shell.split(/\r?\n/).length < 800);
});

test('Shell always reports live bounds and Main shares them with Preview and Global Search', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');

  assert.doesNotMatch(
    app,
    /onlyPreviewGlobalSearchStore|restorePreviewBounds|\{ x: 0, y: 0, width: 0, height: 0 \}/
  );
  assert.match(
    app,
    /getBoundingClientRect\(\)[\s\S]*reportPreviewBounds\(\{[\s\S]*x: bounds\.x[\s\S]*height: bounds\.height/
  );
  assert.match(app, /watch\([\s\S]*previewHostRef[\s\S]*resizeObserver\.observe\(host\)/);
  assert.doesNotMatch(windowHelper, /isHiddenPreviewBounds/);
  assert.match(
    windowHelper,
    /const bounds = clampPreviewBounds\(value, contentWidth, contentHeight\);[\s\S]*onlyPreviewPreviewRegionService\.updateBounds\(host\.hostToken, bounds\);[\s\S]*onlyPreviewGlobalSearchWindowService\.updateBounds\(host\.hostToken, bounds\)/
  );
});

test('Project tree keeps row ARIA ownership while its directory arrow toggles on one click', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const style = source('src/renderer/onlypreview/shell/src/App.less');
  const store = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const rowStart = app.indexOf(
    '<button\n            v-for="row in onlyPreviewShellStore.visibleRows"'
  );
  const row = app.slice(rowStart, app.indexOf('</button>', rowStart));
  const chevronStart = row.indexOf(
    '<span\n              v-if="row.entry.nodeKind === \'directory\'"'
  );
  const chevron = row.slice(chevronStart, row.indexOf('</span>', chevronStart));

  assert.ok(rowStart >= 0);
  assert.ok(chevronStart >= 0);
  assert.match(row, /name="onlypreview__treeRow"[\s\S]*role="treeitem"/);
  assert.match(row, /:aria-expanded=[\s\S]*:aria-selected=/);
  assert.match(
    chevron,
    /name="onlypreview__treeChevron"[\s\S]*@click\.stop="onlyPreviewShellStore\.handleTreeClick\(row\.entry, \$event\.detail, true\)"[\s\S]*@dblclick\.prevent\.stop/
  );
  assert.doesNotMatch(chevron, /<button|tabindex=|role=/);
  // The row delegates through a local wrapper so the row being renamed stays inert: a click there
  // blurs the input and commits, and re-activating on top of that would re-preview a path that is
  // about to change. The chevron keeps calling the store directly — it only toggles.
  assert.match(row, /@click="handleTreeRowClick\(row\.entry, \$event\)"/);
  assert.match(row, /@dblclick\.prevent="handleTreeRowDoubleClick\(row\.entry\)"/);
  assert.match(app, /const handleTreeRowClick[\s\S]*if \(isEditing\(entry\.relativePath\)\) return;/);
  assert.match(
    app,
    /const handleTreeRowDoubleClick[\s\S]*if \(isEditing\(entry\.relativePath\)\) return;/
  );
  assert.match(
    store,
    /handleTreeClick\(entry:[\s\S]*toggleDirectory = false[\s\S]*clickCount > 1[\s\S]*activateEntry\(entry, clickCount === 0 \|\| toggleDirectory, toggleDirectory\)/
  );
  assert.match(
    style,
    /\.onlypreview-shell__tree-chevron-hit \{[\s\S]*width: 17px;[\s\S]*height: 21px;[\s\S]*cursor: pointer;/
  );
  assert.match(
    style,
    /\.onlypreview-shell__tree-chevron-hit:hover \{[\s\S]*background: var\(--onlypreview-royal-soft\);/
  );
  assert.match(style, /\.onlypreview-shell__tree-chevron \{[\s\S]*flex: 0 0 13px;/);
});

test('Project errors are dismissible and Project tree typography increases by one step', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const style = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const store = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const errorStart = app.indexOf('name="onlypreview__indexError"');
  const errorMarkup = app.slice(errorStart, app.indexOf('</div>', errorStart));
  const treeRow = style.slice(
    style.indexOf('.onlypreview-shell__tree-row {'),
    style.indexOf('.onlypreview-shell__tree-row:hover')
  );

  assert.ok(errorStart >= 0);
  assert.match(errorMarkup, /role="alert"/);
  assert.match(
    errorMarkup,
    /name="onlypreview__dismissIndexError"[\s\S]*type="button"[\s\S]*:aria-label="onlyPreviewI18n\.project\.dismissError"[\s\S]*@click="onlyPreviewShellStore\.dismissError\(\)"/
  );
  assert.match(i18n, /dismissError:\s*'Dismiss Project error'/);
  assert.match(i18n, /dismissError:\s*'关闭项目错误提示'/);
  assert.match(
    i18n,
    /INDEX_PROTOCOL_ERROR:\s*'The Project search index returned an invalid response\.'/
  );
  assert.match(i18n, /INDEX_PROTOCOL_ERROR:\s*'项目搜索索引返回了无效响应。'/);
  assert.match(i18n, /PROTOCOL_ERROR:\s*'The preview data stream could not be opened\.'/);
  assert.match(i18n, /PROTOCOL_ERROR:\s*'无法打开预览数据流。'/);
  assert.match(store, /dismissError\(\): void \{\s*this\.errorMessage = '';\s*onlyPreviewErrorDetail\.clear\(\);\s*\}/);
  assert.match(
    style,
    /\.onlypreview-shell__inline-error-dismiss \{[\s\S]*width:\s*22px;[\s\S]*cursor:\s*pointer;/
  );
  assert.match(style, /\.onlypreview-shell__inline-error-dismiss:focus-visible \{/);
  assert.match(treeRow, /height:\s*27px/);
  assert.match(treeRow, /font-size:\s*13px/);
  assert.match(treeRow, /font-weight:\s*500/);
});

test('Global Search UI keeps parallel ledgers, bounded split, keyboard controls, and responsive motion rules', () => {
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const style = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less'
  );

  assert.ok(workspace.indexOf('section="contents"') < workspace.indexOf('section="files"'));
  assert.match(style, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(style, /\.onlypreview-global-search__results-pane[\s\S]*?overflow:\s*auto/);
  assert.match(
    style,
    /\.onlypreview-global-search__results-pane--files[\s\S]*?border-left:\s*1px solid var\(--onlypreview-divider\)/
  );
  assert.match(workspace, /@compositionstart/);
  assert.match(workspace, /@compositionend/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(workspace, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(workspace, /aria-valuemin="25"/);
  assert.match(workspace, /aria-valuemax="70"/);
  assert.match(style, /--onlypreview-search-preview-height/);
  assert.match(style, /@media \(max-width: 800px\)/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(style, /border-left: 3px solid var\(--onlypreview-royal\)/);
});
